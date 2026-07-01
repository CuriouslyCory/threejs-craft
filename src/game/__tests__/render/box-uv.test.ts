import { describe, expect, it } from "vitest";

import type { AtlasRect } from "~/game/render/atlas-layout";
import { remapBoxUV, type BoxFaceRects } from "~/game/render/box-uv";

/**
 * The exact default UV array `THREE.BoxGeometry(1,1,1)` produces — verified
 * against the installed three@0.185.1 (see `box-uv.ts`'s header comment for
 * how). Each of the 6 faces contributes 4 vertices with UVs
 * `(0,1),(1,1),(0,0),(1,0)`, in face order px, nx, top, bottom, pz, nz.
 */
function defaultBoxUV(): number[] {
  const perFace = [0, 1, 1, 1, 0, 0, 1, 0];
  return Array.from({ length: 6 }, () => perFace).flat();
}

function rect(seed: number): AtlasRect {
  // Distinct, easy-to-check-by-eye rect per face so cross-face bleed would show up.
  return { u0: seed, v0: seed + 0.1, u1: seed + 0.05, v1: seed + 0.15 };
}

const faces: BoxFaceRects = {
  px: rect(0.0),
  nx: rect(0.1),
  top: rect(0.2),
  bottom: rect(0.3),
  pz: rect(0.4),
  nz: rect(0.5),
};

describe("remapBoxUV", () => {
  it("returns an array the same length as the input", () => {
    const result = remapBoxUV(defaultBoxUV(), faces);
    expect(result).toHaveLength(48);
  });

  it("does not mutate the input array", () => {
    const input = defaultBoxUV();
    const copy = [...input];
    remapBoxUV(input, faces);
    expect(input).toEqual(copy);
  });

  it("maps each face's 4 vertices into that face's own atlas rect", () => {
    const result = remapBoxUV(defaultBoxUV(), faces);
    const faceOrder: (keyof BoxFaceRects)[] = [
      "px",
      "nx",
      "top",
      "bottom",
      "pz",
      "nz",
    ];

    faceOrder.forEach((faceKey, faceIndex) => {
      const r = faces[faceKey];
      for (let vertex = 0; vertex < 4; vertex++) {
        const i = (faceIndex * 4 + vertex) * 2;
        const u = result[i];
        const v = result[i + 1];
        expect(u).toBeGreaterThanOrEqual(r.u0);
        expect(u).toBeLessThanOrEqual(r.u1);
        expect(v).toBeGreaterThanOrEqual(r.v0);
        expect(v).toBeLessThanOrEqual(r.v1);
      }
    });
  });

  it("preserves the corner correspondence — v=1 (box +Y-ward) stays the upper v bound", () => {
    const result = remapBoxUV(defaultBoxUV(), faces);
    // px face: vertex 0 has base uv (0,1) -> should land at (rect.u0, rect.v1).
    const pxRect = faces.px;
    expect(result[0]).toBeCloseTo(pxRect.u0);
    expect(result[1]).toBeCloseTo(pxRect.v1);
    // px face: vertex 2 has base uv (0,0) -> should land at (rect.u0, rect.v0).
    expect(result[4]).toBeCloseTo(pxRect.u0);
    expect(result[5]).toBeCloseTo(pxRect.v0);
  });

  it("gives every face a disjoint UV range when the atlas rects are disjoint", () => {
    const result = remapBoxUV(defaultBoxUV(), faces);
    // Spot check: the "top" face's UVs should never fall inside the "px" face's rect.
    const topFaceStart = 2 * 4 * 2; // faceIndex 2 ("top"), 4 vertices, 2 comps
    const topU = result[topFaceStart];
    const topV = result[topFaceStart + 1];
    expect(
      topU !== undefined &&
        topU >= faces.px.u0 &&
        topU <= faces.px.u1 &&
        topV !== undefined &&
        topV >= faces.px.v0 &&
        topV <= faces.px.v1,
    ).toBe(false);
  });
});
