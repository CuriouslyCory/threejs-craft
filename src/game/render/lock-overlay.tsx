"use client";

/**
 * Plain HTML overlays for the pointer-lock lifecycle — rendered as siblings
 * of `<Canvas>` (not inside it), driven purely by `lockState`, which is React
 * state that only changes on user-facing transitions (click, Esc, a lock
 * denial). None of this re-renders per frame; `useFrame` in
 * `player-controller.tsx` never touches this state.
 */

import type { LockState } from "~/game/render/player-controller";

export interface LockOverlayProps {
  readonly state: LockState;
  readonly onRequestLock: () => void;
  readonly onDismissDenied: () => void;
}

const overlayBaseClass =
  "pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/60 text-center text-white";

export function LockOverlay({
  state,
  onRequestLock,
  onDismissDenied,
}: LockOverlayProps) {
  if (state === "playing") {
    return null;
  }

  if (state === "start") {
    return (
      <div className={overlayBaseClass} onClick={onRequestLock} role="button">
        <p className="text-xl font-bold">Click to play</p>
        <p className="max-w-sm text-sm text-white/70">
          Mouse look + WASD to move, Shift to sprint, Space to jump (double-tap
          to toggle fly), Ctrl to descend while flying. Esc pauses.
        </p>
      </div>
    );
  }

  if (state === "paused") {
    return (
      <div className={overlayBaseClass} onClick={onRequestLock} role="button">
        <p className="text-xl font-bold">Paused</p>
        <p className="text-sm text-white/70">Click to resume</p>
      </div>
    );
  }

  // state === "denied" — non-trapping: offer both a retry and a dismiss path
  // rather than only re-showing the same click target that just failed.
  return (
    <div className={overlayBaseClass}>
      <p className="text-xl font-bold">Pointer lock was blocked</p>
      <p className="max-w-sm text-sm text-white/70">
        Your browser refused the pointer-lock request. You can try again, or
        dismiss this and explore with the camera unlocked.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          className="pointer-events-auto rounded bg-white/10 px-4 py-2 hover:bg-white/20"
          onClick={onRequestLock}
        >
          Try again
        </button>
        <button
          type="button"
          className="pointer-events-auto rounded px-4 py-2 text-white/70 hover:text-white"
          onClick={onDismissDenied}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
