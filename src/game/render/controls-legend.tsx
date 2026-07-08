"use client";

/**
 * Dismissible controls legend (#11) — a plain DOM overlay (sibling of
 * `<Canvas>`, like `lock-overlay.tsx`/`hotbar-hud.tsx`), shown on first run
 * and gated by `localStorage` thereafter so a returning player doesn't see
 * it every load. Rendered above `LockOverlay`'s full-screen backdrop (a
 * higher `z-index`) so it's visible — and dismissible — even before the
 * player has clicked to play.
 *
 * `game-scene.tsx` (this component's only caller) is only ever mounted
 * client-side, via `next/dynamic`'s `{ ssr: false }` in `src/app/game/
 * page.tsx` (per the threejs skill's Next.js integration guidance), so
 * `window`/`localStorage` are always available by the time this component's
 * body runs — but the reads/writes below are still wrapped defensively
 * (private browsing, storage quota, or a disabled storage API should never
 * crash the game, just fail to persist the dismissal).
 */

import { useCallback, useState } from "react";

const STORAGE_KEY = "threejs-craft:controls-legend-dismissed-v1";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage unavailable (private mode, quota, disabled) — dismissal just
    // won't persist across reloads, which is an acceptable degrade, not a
    // crash: the legend simply reappears next time.
  }
}

interface ControlRow {
  readonly keys: string;
  readonly action: string;
}

const CONTROLS: readonly ControlRow[] = [
  { keys: "WASD", action: "Move" },
  { keys: "Mouse", action: "Look" },
  { keys: "Left click", action: "Break block" },
  { keys: "Right click", action: "Place block" },
  { keys: "1 – 6", action: "Select hotbar slot" },
  { keys: "Esc", action: "Pause menu" },
];

export function ControlsLegend() {
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    writeDismissed();
  }, []);

  if (dismissed) {
    return null;
  }

  return (
    <div className="pointer-events-auto absolute top-4 right-4 z-30 w-64 rounded-lg border border-white/20 bg-black/70 p-4 text-white shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-sm font-bold">
          <span aria-hidden="true">🐾 </span>
          Controls
        </p>
        <button
          type="button"
          aria-label="Dismiss controls legend"
          className="pointer-events-auto rounded px-1.5 leading-none text-white/60 hover:text-white"
          onClick={handleDismiss}
        >
          ×
        </button>
      </div>
      <ul className="space-y-1 text-xs text-white/80">
        {CONTROLS.map(({ keys, action }) => (
          <li key={keys} className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-white">{keys}</span>
            <span className="text-right">{action}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
