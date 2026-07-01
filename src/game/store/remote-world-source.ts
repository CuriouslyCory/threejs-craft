/**
 * Identity-adapter `WorldSource` (#10). `RemoteWorldSource` satisfies the
 * same `WorldSource` interface as `LocalWorldSource`
 * (`~/game/store/local-world-store.ts`) by delegating every call to an
 * internal `LocalWorldSource` — it does not call the stub `worldRouter`
 * (`~/server/api/routers/world.ts`) or do any networking. Its entire job is
 * to prove that the composition root's factory swap point
 * (`WORLD_SOURCE_CTOR` in `src/app/game/game-scene.tsx`) compiles and runs
 * the game unchanged no matter which `WorldSource` implementation is
 * chosen there. A real remote source — one that actually talks to a
 * multiplayer backend — is future work; see
 * `docs/adr/0001-multiplayer-persistence-edit-deltas.md` for the persistence
 * model it will eventually sit in front of.
 */

import type {
  ChunkSourceEntry,
  WorldSource,
} from "~/game/store/local-world-store";
import { LocalWorldSource } from "~/game/store/local-world-store";
import type { World } from "~/game/world";

export class RemoteWorldSource implements WorldSource {
  private readonly delegate: LocalWorldSource;

  constructor(world: World) {
    this.delegate = new LocalWorldSource(world);
  }

  /** Pass-through to the internal `LocalWorldSource` — see the module
   *  doc comment for why this doesn't do anything remote (yet). */
  chunkEntries(): ChunkSourceEntry[] {
    return this.delegate.chunkEntries();
  }
}
