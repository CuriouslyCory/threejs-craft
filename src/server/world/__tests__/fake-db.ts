/**
 * A minimal in-memory stand-in for `ActiveWorldDb` (`../active-world`), used
 * by both this directory's `active-world.test.ts` and the router's
 * `src/server/api/routers/__tests__/world.test.ts` — one fake, two
 * consumers, so both suites exercise the exact same persistence semantics
 * (including the cascade-on-delete behavior the real Postgres schema's
 * `onDelete: Cascade` provides) rather than two subtly different mocks.
 *
 * Deliberately not a real Prisma mock/spy library: `ActiveWorldDb` is a
 * small structural interface, and a plain class satisfying it is both
 * simpler and a stronger guarantee that `active-world.ts`/`world.ts` only
 * ever call the methods this interface declares.
 */

import type {
  ActiveWorldDb,
  ActiveWorldTx,
  ChunkDeltaRow,
  SavedWorldRow,
} from "../active-world";

function deltaMapKey(savedWorldId: string, chunkKey: string): string {
  return `${savedWorldId} ${chunkKey}`;
}

/** In-memory fake satisfying `ActiveWorldDb`. `$transaction` here is NOT
 *  atomic (it just invokes the callback against `this`) — fine for unit
 *  tests of the sequencing/business logic, which is all this module needs;
 *  real atomicity is Postgres's job via the generated `PrismaClient`. */
export class FakeActiveWorldDb implements ActiveWorldDb {
  /** Keyed by `userId` — mirrors `SavedWorld.userId @unique`. */
  private readonly worldsByUser = new Map<string, SavedWorldRow>();
  private readonly deltas = new Map<string, ChunkDeltaRow>();
  private nextIdNum = 1;

  private freshId(): string {
    const id = `world-${this.nextIdNum}`;
    this.nextIdNum += 1;
    return id;
  }

  readonly savedWorld: ActiveWorldDb["savedWorld"] = {
    findUnique: ({ where: { userId } }) => {
      return Promise.resolve(this.worldsByUser.get(userId) ?? null);
    },
    upsert: ({ where: { userId }, create, update }) => {
      const existing = this.worldsByUser.get(userId);
      if (existing) {
        // Every current call site (`loadWorld`) passes `update: {}`, so
        // this is a no-op merge in practice — spelled out generically to
        // mirror Prisma's actual partial-update semantics rather than
        // hard-coding "return existing unchanged".
        const merged: SavedWorldRow = { ...existing, ...update };
        this.worldsByUser.set(userId, merged);
        return Promise.resolve(merged);
      }
      const row: SavedWorldRow = {
        id: this.freshId(),
        userId,
        seed: create.seed,
        version: 1,
        updatedAt: new Date(),
      };
      this.worldsByUser.set(userId, row);
      return Promise.resolve(row);
    },
    create: ({ data }) => {
      // Mirrors the `userId @unique` constraint real Postgres enforces:
      // a second `create` for a `userId` that already has a row must
      // fail, not silently overwrite it (only `newGame` calls `create`,
      // always right after `deleteMany` purges any existing row first).
      if (this.worldsByUser.has(data.userId)) {
        throw new Error(
          `FakeActiveWorldDb: SavedWorld already exists for userId "${data.userId}"`,
        );
      }
      const row: SavedWorldRow = {
        id: this.freshId(),
        userId: data.userId,
        seed: data.seed,
        version: 1,
        updatedAt: new Date(),
      };
      this.worldsByUser.set(data.userId, row);
      return Promise.resolve(row);
    },
    update: ({ where: { id }, data }) => {
      const existing = [...this.worldsByUser.values()].find(
        (row) => row.id === id,
      );
      if (!existing) {
        throw new Error(`FakeActiveWorldDb: no SavedWorld with id "${id}"`);
      }
      const updated: SavedWorldRow = {
        ...existing,
        version: existing.version + data.version.increment,
        updatedAt: new Date(),
      };
      this.worldsByUser.set(existing.userId, updated);
      return Promise.resolve(updated);
    },
    deleteMany: ({ where: { userId } }) => {
      const existing = this.worldsByUser.get(userId);
      if (!existing) {
        return Promise.resolve({ count: 0 });
      }
      this.worldsByUser.delete(userId);
      // Mirror the schema's `onDelete: Cascade` on `ChunkDelta.savedWorld`.
      for (const key of [...this.deltas.keys()]) {
        if (key.startsWith(`${existing.id} `)) {
          this.deltas.delete(key);
        }
      }
      return Promise.resolve({ count: 1 });
    },
  };

  readonly chunkDelta: ActiveWorldDb["chunkDelta"] = {
    findMany: ({ where: { savedWorldId } }) => {
      return Promise.resolve(
        [...this.deltas.values()].filter(
          (row) => row.savedWorldId === savedWorldId,
        ),
      );
    },
    upsert: ({ where, create, update }) => {
      const key = deltaMapKey(
        where.savedWorldId_chunkKey.savedWorldId,
        where.savedWorldId_chunkKey.chunkKey,
      );
      const existing = this.deltas.get(key);
      const row: ChunkDeltaRow = existing
        ? { ...existing, data: update.data }
        : {
            savedWorldId: create.savedWorldId,
            chunkKey: create.chunkKey,
            data: create.data,
          };
      this.deltas.set(key, row);
      return Promise.resolve(row);
    },
    deleteMany: ({ where: { savedWorldId, chunkKey } }) => {
      const key = deltaMapKey(savedWorldId, chunkKey);
      const existed = this.deltas.delete(key);
      return Promise.resolve({ count: existed ? 1 : 0 });
    },
  };

  $transaction<T>(fn: (tx: ActiveWorldTx) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
