import { describe, expect, it, vi } from "vitest";

import type { Command } from "~/game/command";
import { createPersistQueue } from "~/game/persistence/persist-queue";

function breakAt(x: number): Command {
  return { type: "BreakBlock", at: { x, y: 0, z: 0 } };
}

/** A promise plus its externally-callable resolve/reject, so a test can
 *  control exactly when a fake `persist` call settles. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createPersistQueue — FIFO ordering", () => {
  it("op#2 does not start until op#1 settles", async () => {
    const deferredFirst = createDeferred<void>();
    const started: number[] = [];
    const persist = vi.fn((command: Command) => {
      const x = (command as { at: { x: number } }).at.x;
      started.push(x);
      return x === 1 ? deferredFirst.promise : Promise.resolve();
    });
    const queue = createPersistQueue(persist);

    queue.enqueue(breakAt(1));
    queue.enqueue(breakAt(2));

    // Give microtasks a chance to run; op#2's persist must NOT have started
    // yet because op#1's promise is still pending.
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([1]);

    deferredFirst.resolve();
    await queue.flush();

    expect(started).toEqual([1, 2]);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("records call order across three enqueued ops", async () => {
    const order: number[] = [];
    const persist = vi.fn(async (command: Command) => {
      order.push((command as { at: { x: number } }).at.x);
    });
    const queue = createPersistQueue(persist);

    queue.enqueue(breakAt(1));
    queue.enqueue(breakAt(2));
    queue.enqueue(breakAt(3));

    await queue.flush();

    expect(order).toEqual([1, 2, 3]);
  });
});

describe("createPersistQueue — flush()", () => {
  it("resolves immediately when the queue is empty", async () => {
    const persist = vi.fn(() => Promise.resolve());
    const queue = createPersistQueue(persist);

    await expect(queue.flush()).resolves.toBeUndefined();
    expect(persist).not.toHaveBeenCalled();
  });

  it("awaits in-flight and queued work", async () => {
    const deferred = createDeferred<void>();
    const persist = vi.fn(() => deferred.promise);
    const queue = createPersistQueue(persist);

    queue.enqueue(breakAt(1));
    let flushed = false;
    const flushPromise = queue.flush().then(() => {
      flushed = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(flushed).toBe(false);

    deferred.resolve();
    await flushPromise;
    expect(flushed).toBe(true);
  });
});

describe("createPersistQueue — pendingCount()", () => {
  it("counts queued + in-flight ops and drains back to 0", async () => {
    const deferred = createDeferred<void>();
    const persist = vi.fn(() => deferred.promise);
    const queue = createPersistQueue(persist);

    expect(queue.pendingCount()).toBe(0);

    queue.enqueue(breakAt(1));
    queue.enqueue(breakAt(2));
    expect(queue.pendingCount()).toBe(2);

    deferred.resolve();
    await queue.flush();

    expect(queue.pendingCount()).toBe(0);
  });
});

describe("createPersistQueue — lastError()", () => {
  it("is undefined until a persist exhausts its retries", async () => {
    const persist = vi.fn(() => Promise.resolve());
    const queue = createPersistQueue(persist);

    expect(queue.lastError()).toBeUndefined();

    queue.enqueue(breakAt(1));
    await queue.flush();

    expect(queue.lastError()).toBeUndefined();
  });

  it("is set once a persist fails after exhausting bounded retries, edits still applied locally", async () => {
    const error = new Error("network down");
    const persist = vi.fn(() => Promise.reject(error));
    const queue = createPersistQueue(persist, {
      maxAttempts: 2,
      retryDelayMs: () => 0,
    });

    queue.enqueue(breakAt(1));
    await queue.flush();

    expect(queue.lastError()).toBe(error);
    // Bounded retry: 1 initial attempt + 1 retry = maxAttempts calls, not
    // unbounded.
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("a later successful persist clears a prior lastError", async () => {
    const error = new Error("network down");
    let callCount = 0;
    const persist = vi.fn((_command: Command) => {
      callCount += 1;
      // Op #1 (first enqueue) always fails; op #2 always succeeds.
      return callCount === 1 ? Promise.reject(error) : Promise.resolve();
    });
    const queue = createPersistQueue(persist, {
      maxAttempts: 1,
      retryDelayMs: () => 0,
    });

    queue.enqueue(breakAt(1));
    await queue.flush();
    expect(queue.lastError()).toBe(error);

    queue.enqueue(breakAt(2));
    await queue.flush();
    expect(queue.lastError()).toBeUndefined();
  });

  it("retries a failing op before giving up, and a within-budget success clears the error", async () => {
    const error = new Error("flaky");
    let attempts = 0;
    const persist = vi.fn(() => {
      attempts += 1;
      if (attempts < 3) {
        return Promise.reject(error);
      }
      return Promise.resolve();
    });
    const queue = createPersistQueue(persist, {
      maxAttempts: 3,
      retryDelayMs: () => 0,
    });

    queue.enqueue(breakAt(1));
    await queue.flush();

    expect(attempts).toBe(3);
    expect(queue.lastError()).toBeUndefined();
  });
});
