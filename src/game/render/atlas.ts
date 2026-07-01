/**
 * Procedural runtime texture atlas: paints every tile in `atlas-layout.ts`
 * onto a `<canvas>` at runtime and wraps it in a `THREE.CanvasTexture`. No
 * shipped image files — every pixel is drawn here, deterministically (a
 * hash-based dither, not `Math.random`, so repeated builds are visually
 * identical — handy for it not being a moving target while iterating).
 *
 * Filtering/color-space per the threejs skill's textures reference
 * (`references/textures.md` → "Filtering and mipmaps" and "The colorSpace
 * rule"): `magFilter`/`minFilter = NearestFilter` for the blocky pixel-art
 * look, `colorSpace = SRGBColorSpace` because this texture's pixels *are*
 * visible color data (not a normal/roughness/AO data map), and
 * `generateMipmaps = false` since nearest-filtered pixel art is always
 * meant to be viewed without mip blending.
 *
 * Only this module (plus `chunk-mesh.tsx`) touches `document`/canvas in the
 * render layer — both are only ever invoked client-side, from inside
 * `game-scene.tsx`'s `"use client"` boundary (loaded via `next/dynamic`
 * `{ ssr: false }`), so there's no server-render-time `document` access.
 */

import * as THREE from "three";

import {
  ATLAS_COLS,
  ATLAS_ROWS,
  ATLAS_TILE_PX,
  TILE_LAYOUT,
  type TileName,
} from "~/game/render/atlas-layout";

export interface BlockAtlas {
  readonly texture: THREE.CanvasTexture;
}

type RGB = readonly [number, number, number];

/** Deterministic pseudo-random value in [0,1) for a pixel coordinate. */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function toCss([r, g, b]: RGB): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [
    lerpChannel(a[0], b[0], t),
    lerpChannel(a[1], b[1], t),
    lerpChannel(a[2], b[2], t),
  ];
}

/** Fill a `size x size` tile with a speckled base color for a pixel-art feel. */
function paintSpeckled(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  size: number,
  base: RGB,
  variants: readonly RGB[],
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = hash2(x0 + x, y0 + y);
      const color =
        h < 0.65 ? base : (variants[Math.floor(h * variants.length) % variants.length] ?? base);
      ctx.fillStyle = toCss(color);
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
}

const DIRT: RGB = [122, 82, 48];
const DIRT_DARK: RGB = [96, 62, 34];
const DIRT_LIGHT: RGB = [143, 100, 62];
const STONE: RGB = [128, 128, 132];
const STONE_DARK: RGB = [104, 104, 108];
const STONE_LIGHT: RGB = [150, 150, 154];
const LEAVES: RGB = [58, 112, 46];
const LEAVES_DARK: RGB = [42, 88, 34];
const LEAVES_LIGHT: RGB = [78, 138, 62];
const GRASS_TOP: RGB = [86, 156, 62];
const GRASS_TOP_DARK: RGB = [68, 132, 48];
const GRASS_TOP_LIGHT: RGB = [104, 176, 78];
const BARK: RGB = [90, 62, 38];
const BARK_DARK: RGB = [70, 46, 26];
const BARK_LIGHT: RGB = [108, 78, 50];
const WOOD_RING: RGB = [176, 138, 92];
const WOOD_RING_DARK: RGB = [150, 112, 70];

function paintDirt(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number): void {
  paintSpeckled(ctx, x0, y0, size, DIRT, [DIRT_DARK, DIRT_LIGHT]);
}

function paintStone(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number): void {
  paintSpeckled(ctx, x0, y0, size, STONE, [STONE_DARK, STONE_LIGHT]);
}

function paintLeaves(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number): void {
  paintSpeckled(ctx, x0, y0, size, LEAVES, [LEAVES_DARK, LEAVES_LIGHT]);
}

function paintGrassTop(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number): void {
  paintSpeckled(ctx, x0, y0, size, GRASS_TOP, [GRASS_TOP_DARK, GRASS_TOP_LIGHT]);
}

function paintGrassBottom(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number): void {
  paintDirt(ctx, x0, y0, size);
}

/** Dirt body with a green "fringe" along the top rows (grass poking over the edge). */
function paintGrassSide(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number): void {
  paintDirt(ctx, x0, y0, size);
  const fringeRows = Math.max(2, Math.round(size * 0.22));
  for (let y = 0; y < fringeRows; y++) {
    for (let x = 0; x < size; x++) {
      // Ragged bottom edge on the fringe itself, so it doesn't read as a hard band.
      const raggedness = hash2(x0 + x, y0 + y + 500) * fringeRows * 0.6;
      if (y > fringeRows - 1 - raggedness) continue;
      const h = hash2(x0 + x, y0 + y);
      const color =
        h < 0.6 ? GRASS_TOP : h < 0.85 ? GRASS_TOP_DARK : GRASS_TOP_LIGHT;
      ctx.fillStyle = toCss(color);
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
}

/** Concentric growth rings, viewed end-on (the top/bottom face of a log). */
function paintWoodTop(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number): void {
  const center = (size - 1) / 2;
  const maxDist = Math.SQRT2 * (size / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - center, y - center);
      const ring = Math.floor((dist / maxDist) * 5) % 2;
      const jitter = (hash2(x0 + x, y0 + y) - 0.5) * 0.15;
      const base = ring === 0 ? WOOD_RING : WOOD_RING_DARK;
      const color = lerpColor(base, BARK_DARK, Math.max(0, Math.min(1, dist / maxDist - 0.75 + jitter)));
      ctx.fillStyle = toCss(color);
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
}

/** Vertical bark streaks (the log's side/bark face). */
function paintWoodSide(ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number): void {
  for (let x = 0; x < size; x++) {
    const streak = hash2(x0 + x, 0);
    const base = streak < 0.5 ? BARK : streak < 0.8 ? BARK_DARK : BARK_LIGHT;
    for (let y = 0; y < size; y++) {
      const h = hash2(x0 + x, y0 + y);
      const color = h < 0.8 ? base : BARK_DARK;
      ctx.fillStyle = toCss(color);
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
}

const TILE_PAINTERS: Record<
  TileName,
  (ctx: CanvasRenderingContext2D, x0: number, y0: number, size: number) => void
> = {
  dirt: paintDirt,
  stone: paintStone,
  leaves: paintLeaves,
  grass_top: paintGrassTop,
  grass_side: paintGrassSide,
  grass_bottom: paintGrassBottom,
  wood_top: paintWoodTop,
  wood_side: paintWoodSide,
};

/** Build the runtime atlas texture. Must only be called client-side. */
export function createBlockAtlas(): BlockAtlas {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLS * ATLAS_TILE_PX;
  canvas.height = ATLAS_ROWS * ATLAS_TILE_PX;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable while building the block atlas");
  }
  ctx.imageSmoothingEnabled = false;

  for (const [name, { col, row }] of Object.entries(TILE_LAYOUT) as [
    TileName,
    { col: number; row: number },
  ][]) {
    const painter = TILE_PAINTERS[name];
    painter(ctx, col * ATLAS_TILE_PX, row * ATLAS_TILE_PX, ATLAS_TILE_PX);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return { texture };
}
