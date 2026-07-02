"use client";

/**
 * 6-slot hotbar HUD — a plain DOM overlay (sibling of `<Canvas>`) driven by
 * `useSyncExternalStore(store.subscribe, store.getInventorySnapshot)`. It
 * only re-renders when `WorldStore.apply` actually changes the inventory
 * (see `world-store.ts`'s `notify()`), never per frame — the per-frame
 * raycast/outline path in `block-target.tsx` never touches this component.
 */

import { useSyncExternalStore } from "react";

import { BlockRegistry } from "~/game/blocks";
import type { WorldStore } from "~/game/store/world-store";

export interface HotbarHudProps {
  readonly store: WorldStore;
}

export function HotbarHud({ store }: HotbarHudProps) {
  const inventory = useSyncExternalStore(
    store.subscribe,
    store.getInventorySnapshot,
  );

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center gap-2">
      {inventory.slots.map((slot, index) => {
        const selected = index === inventory.selected;
        return (
          <div
            key={index}
            className={`flex h-14 w-14 flex-col items-center justify-center rounded border bg-black/50 text-xs text-white ${
              selected ? "border-white" : "border-white/30"
            }`}
          >
            {slot.block !== null ? (
              <>
                <span className="truncate">
                  {BlockRegistry[slot.block].name}
                </span>
                <span className="text-white/70">{slot.count}</span>
              </>
            ) : (
              <span className="text-white/30">{index + 1}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
