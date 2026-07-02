/**
 * `WorldStore` — the one deep module for world state: it owns the `World` +
 * `Inventory` for a play session, exposes `apply(command)` built directly on
 * `applyCommand` (the mutation seam a future remote adapter per ADR-0001
 * will stand behind), and exposes a single versioned, key-carrying
 * `getSnapshot()`/`subscribe()` pair for `useSyncExternalStore`.
 *
 * This module merges what used to be three shallow pieces: the mutation
 * store (`GameStore`, #8), the read-only chunk-enumeration surface
 * (`WorldSource`/`LocalWorldSource`/`createLocalWorldStore`, #6/#10), and the
 * identity pass-through `RemoteWorldSource` (#10) that merely proved the
 * read surface was swappable. Folding them into one `WorldStore` also fixes
 * a render bug: because the old read surface (`LocalWorldSource.chunkEntries()`)
 * was snapshotted once at mount in `game-scene.tsx`, a chunk first created by
 * an edit (e.g. building up past existing terrain into a new chunk layer)
 * was mutated correctly but never entered the mounted chunk list, so no mesh
 * was ever mounted for it. Here, chunk *existence* is part of the same
 * versioned `getSnapshot()` the render layer subscribes to via
 * `useSyncExternalStore`, so a newly created chunk appears on the very next
 * render.
 *
 * `getSnapshot()` is rebuilt only inside `apply()` on a successful mutation,
 * and reuses the cached entry object for any chunk whose `(chunk, version)`
 * pair didn't change — preserving the O(dirty-chunks) rebuild invariant
 * (`ChunkMesh`'s `useMemo([chunk, origin, version])` only recomputes for the
 * chunk(s) that actually changed) and satisfying `useSyncExternalStore`'s
 * "getSnapshot must be cached" contract (a stable reference when nothing
 * changed).
 */

import {
  applyCommand,
  DEFAULT_REACH,
  type Command,
  type CommandResult,
  type Vec3,
} from "~/game/command";
import type { Chunk } from "~/game/chunk";
import { CHUNK_SIZE, chunkKey, type ChunkKey } from "~/game/coords";
import {
  createInventory,
  cycleSelection as cycleInventorySelection,
  selectSlot as selectInventorySlot,
  type Inventory,
} from "~/game/inventory";
import type { World } from "~/game/world";

/** World-space coordinate of a chunk's local (0,0,0) voxel. */
export interface ChunkOrigin {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * One loaded chunk in the versioned snapshot: its `ChunkKey` (identity
 * computed once, here — never reconstructed from `origin` downstream), its
 * world-space origin, the live `Chunk` (mutated in place by `apply`), and
 * its per-chunk version (bumped once per successful `apply` that lists this
 * chunk in `CommandResult.changed`).
 */
export interface WorldChunkEntry {
  readonly key: ChunkKey;
  readonly origin: ChunkOrigin;
  readonly chunk: Chunk;
  readonly version: number;
}

export class WorldStore {
  private readonly world: World;
  private inventory: Inventory;
  /** Per-chunk version counter, bumped once per `apply` call whose
   *  `CommandResult.changed` includes that chunk. Surfaced per-entry via
   *  `WorldChunkEntry.version` so only dirty chunks recompute their
   *  instance buffers — never the whole world. */
  private readonly chunkVersions = new Map<ChunkKey, number>();
  /** Cache of the last-built `WorldChunkEntry` per key, so `rebuildSnapshot`
   *  can reuse the same object (and thus preserve `ChunkMesh`'s memo) for
   *  any chunk that didn't change. */
  private readonly entryCache = new Map<ChunkKey, WorldChunkEntry>();
  /** The cached `getSnapshot()` return value — replaced only inside
   *  `rebuildSnapshot`, so it's identity-stable across renders where
   *  nothing changed (required by `useSyncExternalStore`). */
  private snapshot: readonly WorldChunkEntry[];
  private readonly listeners = new Set<() => void>();

  constructor(world: World, inventory: Inventory = createInventory()) {
    this.world = world;
    this.inventory = inventory;
    this.snapshot = this.rebuildSnapshot();
  }

  /** Apply a command against this store's world + inventory. `playerPosition`
   *  (feet position) is only consulted for `PlaceBlock`'s player-clip check
   *  — see `applyCommand`'s doc comment — and defaults to `from` so
   *  `BreakBlock` call sites don't need to pass it. */
  apply(
    command: Command,
    from: Vec3,
    reach: number = DEFAULT_REACH,
    playerPosition: Vec3 = from,
  ): CommandResult {
    const { result, inventory } = applyCommand(
      this.world,
      this.inventory,
      command,
      from,
      reach,
      playerPosition,
    );

    if (result.ok) {
      this.inventory = inventory;
      for (const key of result.changed) {
        this.chunkVersions.set(key, (this.chunkVersions.get(key) ?? 0) + 1);
      }
      this.rebuildSnapshot();
      this.notify();
    }

    return result;
  }

  /** Select a hotbar slot by absolute index (number keys 1-6 -> 0..5).
   *  Notifies subscribers (the HUD) when the selection actually changes;
   *  a no-op index change doesn't notify, matching `apply`'s "only notify
   *  on a real change" behavior. Does not rebuild the chunk snapshot — an
   *  inventory-only change leaves `getSnapshot()` identity-stable. */
  selectSlot(index: number): void {
    const next = selectInventorySlot(this.inventory, index);
    if (next === this.inventory) {
      return;
    }
    this.inventory = next;
    this.notify();
  }

  /** Cycle the hotbar selection by `delta`'s sign, wrapping at both ends
   *  (mouse wheel). Same no-op/notify semantics as `selectSlot`. */
  cycleSelection(delta: number): void {
    const next = cycleInventorySelection(this.inventory, delta);
    if (next === this.inventory) {
      return;
    }
    this.inventory = next;
    this.notify();
  }

  /** `useSyncExternalStore` snapshot — a stable reference until the next
   *  successful `apply`, so React only re-renders subscribers on real
   *  changes. */
  getInventorySnapshot = (): Inventory => this.inventory;

  /**
   * THE versioned snapshot: existence + per-chunk version, each entry
   * carrying its own key. Identity-stable between renders when nothing
   * changed; a new array only after a successful `apply` that added a
   * chunk or bumped a chunk's version. A chunk that didn't exist at mount
   * appears here as soon as an `apply` creates it — this is what fixes the
   * new-chunk render bug.
   */
  getSnapshot = (): readonly WorldChunkEntry[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Rebuild the cached entry list from the live World, reusing the
   *  existing entry object for any chunk whose (chunk instance, version) is
   *  unchanged so its identity — and thus `ChunkMesh`'s memo — survives.
   *  Only called from the constructor and from a successful `apply`. */
  private rebuildSnapshot(): readonly WorldChunkEntry[] {
    const next: WorldChunkEntry[] = [];
    for (const { cx, cy, cz, chunk } of this.world.chunkEntries()) {
      const key = chunkKey(cx, cy, cz);
      const version = this.chunkVersions.get(key) ?? 0;
      const cached = this.entryCache.get(key);
      if (cached?.chunk === chunk && cached.version === version) {
        next.push(cached);
        continue;
      }
      const entry: WorldChunkEntry = {
        key,
        origin: { x: cx * CHUNK_SIZE, y: cy * CHUNK_SIZE, z: cz * CHUNK_SIZE },
        chunk,
        version,
      };
      this.entryCache.set(key, entry);
      next.push(entry);
    }
    this.snapshot = next;
    return next;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createWorldStore(
  world: World,
  inventory?: Inventory,
): WorldStore {
  return new WorldStore(world, inventory);
}
