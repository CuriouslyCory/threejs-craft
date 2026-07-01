/**
 * `GameStore` — the mutable seam between the pure domain core
 * (`command.ts`/`inventory.ts`) and the render layer: it owns the one
 * `World` + `Inventory` for a play session, exposes `apply(command)` built
 * directly on `applyCommand`, and tracks **dirty chunks** plus a
 * `useSyncExternalStore`-compatible `subscribe`/snapshot pair for the hotbar
 * HUD.
 *
 * Deliberately a separate file from `local-world-store.ts` (#6's
 * `LocalWorldSource`/`LocalWorldStore`, which is explicitly scoped to
 * "just enough read-only surface for #6's static render") rather than an
 * extension of it — this is the mutation/notification surface #8 adds on
 * top, composed alongside #6's store in `game-scene.tsx`, not folded into
 * its narrower contract.
 */

import {
  applyCommand,
  DEFAULT_REACH,
  type Command,
  type CommandResult,
  type Vec3,
} from "~/game/command";
import type { ChunkKey } from "~/game/coords";
import { createInventory, type Inventory } from "~/game/inventory";
import type { World } from "~/game/world";

export class GameStore {
  private readonly world: World;
  private inventory: Inventory;
  /** Per-chunk version counter, bumped once per `apply` call whose
   *  `CommandResult.changed` includes that chunk. Consumed by the render
   *  layer (`ChunkMesh`'s `version` prop) so only dirty chunks recompute
   *  their instance buffers — never the whole world. */
  private readonly chunkVersions = new Map<ChunkKey, number>();
  /** Monotonic counter bumped on every successful `apply` — the single
   *  value `useSyncExternalStore` watches to know "something changed",
   *  independent of which chunk. */
  private version = 0;
  private readonly listeners = new Set<() => void>();

  constructor(world: World, inventory: Inventory = createInventory()) {
    this.world = world;
    this.inventory = inventory;
  }

  /** Apply a command against this store's world + inventory. */
  apply(command: Command, from: Vec3, reach: number = DEFAULT_REACH): CommandResult {
    const { result, inventory } = applyCommand(
      this.world,
      this.inventory,
      command,
      from,
      reach,
    );

    if (result.ok) {
      this.inventory = inventory;
      for (const key of result.changed) {
        this.chunkVersions.set(key, (this.chunkVersions.get(key) ?? 0) + 1);
      }
      this.version += 1;
      this.notify();
    }

    return result;
  }

  /** Current version of a given chunk — 0 if it's never been dirtied. */
  getChunkVersion(key: ChunkKey): number {
    return this.chunkVersions.get(key) ?? 0;
  }

  /** `useSyncExternalStore` snapshot — a stable reference until the next
   *  successful `apply`, so React only re-renders subscribers on real
   *  changes. */
  getInventorySnapshot = (): Inventory => this.inventory;

  /** `useSyncExternalStore` snapshot for "did anything change" (chunk
   *  rebuild triggers) independent of the HUD's inventory subscription. */
  getVersionSnapshot = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createGameStore(
  world: World,
  inventory?: Inventory,
): GameStore {
  return new GameStore(world, inventory);
}
