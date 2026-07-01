"use client";

/**
 * Center-screen crosshair — a plain DOM overlay (sibling of `<Canvas>`, like
 * `lock-overlay.tsx`), not a 3D object. It's static (always screen-center by
 * construction of being centered CSS), so unlike `BlockTargeting`'s 3D
 * outline it needs no per-frame updates at all.
 */

export interface CrosshairOverlayProps {
  /** Only shown while actively playing (pointer-locked) — hidden on the
   *  start/paused/denied overlays so it doesn't clutter that UI. */
  readonly visible: boolean;
}

export function CrosshairOverlay({ visible }: CrosshairOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="relative h-4 w-4">
        <div className="absolute top-1/2 left-1/2 h-px w-3.5 -translate-x-1/2 -translate-y-1/2 bg-white/80 shadow-[0_0_1px_black]" />
        <div className="absolute top-1/2 left-1/2 h-3.5 w-px -translate-x-1/2 -translate-y-1/2 bg-white/80 shadow-[0_0_1px_black]" />
      </div>
    </div>
  );
}
