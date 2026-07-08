/**
 * Pure serial persist queue (#20): turns a stream of successful local edits
 * (`WorldStore`'s `onCommit`, one `Command` per successful `apply`) into a
 * single FIFO chain of calls to an injected `persist` function, entirely off
 * the render path. No DOM, no tRPC import here — the caller (`game-scene.tsx`)
 * injects `persist = (command) => api.world.applyEdit.mutateAsync({ worldId,
 * command })`, keeping this module trivially unit-testable with a fake.
 *
 * FIFO matters beyond ordering aesthetics: op N+1 only starts once op N has
 * fully settled (success or exhausted retries), which is the lost-update
 * guard on the wire for two edits landing in the same chunk back-to-back —
 * the server always sees them in the order the player made them.
 *
 * A failing `persist` never breaks the chain or the local game: `apply` has
 * already mutated the in-memory `World` before `onCommit` even fires (see
 * `world-store.ts`), so a persist failure only means the *server* copy is
 * behind — surfaced via `lastError()` for the caller (e.g. a future "sync
 * failed" HUD indicator) to read, never thrown back into game code.
 */

import type { Command } from "~/game/command";

export interface PersistQueueOptions {
  /** Total attempts per command, including the first — bounds retry so a
   *  persistently-failing edit doesn't retry forever. Defaults to 3. */
  readonly maxAttempts?: number;
  /** Delay (ms) before retry attempt `attempt` (1-based, `attempt` is the
   *  attempt about to run, so the first retry is `attempt === 2`). Defaults
   *  to a short exponential backoff; tests override with a zero-delay
   *  function to stay fast. */
  readonly retryDelayMs?: (attempt: number) => number;
}

export interface PersistQueue {
  /** Enqueue one successful command for persistence. Never throws — a
   *  failing `persist` is caught internally, retried per
   *  `maxAttempts`/`retryDelayMs`, and (if still failing) surfaced via
   *  `lastError()`. The edit itself is already applied locally by the time
   *  this is called; enqueueing only ever affects the server copy. */
  enqueue(command: Command): void;
  /** Resolves once every enqueued (including in-flight) op has settled.
   *  Resolves immediately if the queue is currently empty. */
  flush(): Promise<void>;
  /** Number of ops enqueued but not yet settled (queued + in-flight). */
  pendingCount(): number;
  /** The most recent persist failure once its retries were exhausted, or
   *  `undefined` if there's no outstanding failure — cleared by any later
   *  op that persists successfully. */
  lastError(): unknown;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 2000;
const BASE_BACKOFF_MS = 250;

function defaultRetryDelayMs(attempt: number): number {
  // attempt is 1-based; the delay before attempt 2 is BASE, before attempt 3
  // is 2*BASE, etc., capped at MAX_BACKOFF_MS.
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 2), MAX_BACKOFF_MS);
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPersistQueue(
  persist: (command: Command) => Promise<unknown>,
  options: PersistQueueOptions = {},
): PersistQueue {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;

  // The FIFO backbone: each enqueue chains its work onto this promise and
  // replaces it, so the next enqueue's work can only start after this one's
  // settles (success, or all retries exhausted) — `attempt` below never
  // rejects, so `chain` itself never rejects either.
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;
  let error: unknown = undefined;

  async function attempt(command: Command, attemptNumber: number): Promise<void> {
    try {
      await persist(command);
      error = undefined;
    } catch (err) {
      if (attemptNumber < maxAttempts) {
        await delay(retryDelayMs(attemptNumber + 1));
        await attempt(command, attemptNumber + 1);
        return;
      }
      error = err;
    }
  }

  return {
    enqueue(command: Command): void {
      pending += 1;
      chain = chain
        .then(() => attempt(command, 1))
        .finally(() => {
          pending -= 1;
        });
    },
    flush(): Promise<void> {
      return chain;
    },
    pendingCount(): number {
      return pending;
    },
    lastError(): unknown {
      return error;
    },
  };
}
