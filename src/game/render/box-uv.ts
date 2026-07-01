/**
 * Pure per-face UV remapping for a `THREE.BoxGeometry`, so a single shared
 * box can sample 6 different rectangles of a texture atlas (one per face)
 * instead of the whole [0,1] texture on every face. No `three` import here
 * — it operates on the plain `number[]` a `BufferAttribute.array` already
 * is, so it's unit-testable without a renderer/DOM.
 *
 * Face-to-vertex-block order below is **verified empirically** against the
 * installed three@0.185.1 (not assumed from memory — the skill's #1 failure
 * mode is guessing a signature/layout that changed across versions):
 *
 * ```
 * node -e "
 *   const THREE = require('three');
 *   const g = new THREE.BoxGeometry(1,1,1);
 *   console.log(g.attributes.uv.array, g.attributes.normal.array);
 * "
 * ```
 *
 * confirms `BoxGeometry`'s default (untouched) construction always emits
 * exactly 4 vertices per face, in this fixed order: +X, -X, +Y (top), -Y
 * (bottom), +Z, -Z — and each face's 4 vertices carry default UVs of
 * `(0,1), (1,1), (0,0), (1,0)`, i.e. a plain per-face-local `[0,1]` square
 * (not a shared UV atlas layout already baked in). That means remapping to
 * an atlas rectangle is a pure per-face affine transform (offset + scale)
 * applied to those existing 0/1 values — no vertex reordering needed, and
 * no dependency on `geometry.groups` (those exist for material-array
 * assignment, not UV data).
 */

import type { AtlasRect } from "~/game/render/atlas-layout";

export interface BoxFaceRects {
  readonly top: AtlasRect;
  readonly bottom: AtlasRect;
  readonly px: AtlasRect;
  readonly nx: AtlasRect;
  readonly pz: AtlasRect;
  readonly nz: AtlasRect;
}

const FACE_ORDER: readonly (keyof BoxFaceRects)[] = [
  "px",
  "nx",
  "top",
  "bottom",
  "pz",
  "nz",
];

/**
 * Rewrite a BoxGeometry's default `uv` attribute array so each of the box's
 * 6 faces samples its own atlas rectangle. `baseUV` must be the untouched
 * default UV array from a freshly-constructed `BoxGeometry(1,1,1)` (24
 * vertices * 2 components = 48 numbers); returns a new array of the same
 * length.
 */
export function remapBoxUV(
  baseUV: readonly number[],
  faces: BoxFaceRects,
): number[] {
  const result = baseUV.slice();

  for (let faceIndex = 0; faceIndex < FACE_ORDER.length; faceIndex++) {
    const faceKey = FACE_ORDER[faceIndex];
    if (!faceKey) continue;
    const rect = faces[faceKey];

    for (let vertex = 0; vertex < 4; vertex++) {
      const i = (faceIndex * 4 + vertex) * 2;
      const u = baseUV[i] ?? 0;
      const v = baseUV[i + 1] ?? 0;
      result[i] = rect.u0 + u * (rect.u1 - rect.u0);
      result[i + 1] = rect.v0 + v * (rect.v1 - rect.v0);
    }
  }

  return result;
}
