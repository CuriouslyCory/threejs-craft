"use client";

/**
 * Center-screen crosshair — a plain DOM overlay (sibling of `<Canvas>`, like
 * `lock-overlay.tsx`), not a 3D object. It's static (always screen-center by
 * construction of being centered CSS), so unlike `BlockTargeting`'s 3D
 * outline it needs no per-frame updates at all.
 *
 * #11: a cat-paw reticle (one main pad + four toe beans) instead of a plain
 * cross, drawn as inline SVG shapes (no new deps, no shipped image asset —
 * consistent with the atlas's "no raster files" rule). A CSS `drop-shadow`
 * filter (not a plain `fill`/`stroke` shadow trick) keeps it readable when
 * it lands over pale grass/leaves, since a drop-shadow silhouettes the
 * whole paw shape rather than just outlining individual fills.
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
      <svg
        viewBox="0 0 24 24"
        className="h-7 w-7 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
        aria-hidden="true"
      >
        {/* Main pad. */}
        <ellipse
          cx="12"
          cy="15.5"
          rx="5.1"
          ry="4.2"
          fill="white"
          fillOpacity="0.9"
          stroke="black"
          strokeOpacity="0.55"
          strokeWidth="0.6"
        />
        {/* Toe beans, arced above the pad. */}
        <circle
          cx="6.1"
          cy="8.9"
          r="2.15"
          fill="white"
          fillOpacity="0.9"
          stroke="black"
          strokeOpacity="0.55"
          strokeWidth="0.5"
        />
        <circle
          cx="11.2"
          cy="6.2"
          r="2.35"
          fill="white"
          fillOpacity="0.9"
          stroke="black"
          strokeOpacity="0.55"
          strokeWidth="0.5"
        />
        <circle
          cx="16.5"
          cy="7"
          r="2.25"
          fill="white"
          fillOpacity="0.9"
          stroke="black"
          strokeOpacity="0.55"
          strokeWidth="0.5"
        />
        <circle
          cx="19.6"
          cy="10.9"
          r="1.9"
          fill="white"
          fillOpacity="0.9"
          stroke="black"
          strokeOpacity="0.55"
          strokeWidth="0.5"
        />
      </svg>
    </div>
  );
}
