// color-management.js
//
// Correct color setup for three.js r185. This is invariant 3 from SKILL.md, and washed-out or
// too-dark scenes are, by a wide margin, the #1 reported "it looks wrong" bug — almost always
// traced back to one of the three settings below being missing or backwards.
//
// THREE.ColorManagement has been enabled by default since r152: three.js now does real color
// space conversion internally instead of treating every number as raw sRGB. That means you must
// be explicit about which color space each texture and the final output are in, or the pipeline
// makes a wrong (but silent) assumption.

import * as THREE from 'three';

// --- 1. Renderer output color space ---
//
// SRGBColorSpace is the default since r152 (matches what monitors expect), but set it explicitly
// anyway — relying on an unstated default is exactly the kind of thing that breaks silently on a
// future three.js upgrade or when someone copy-pastes an older renderer setup.
renderer.outputColorSpace = THREE.SRGBColorSpace;

// --- 2. Tone mapping ---
//
// Tone mapping compresses HDR-range lighting (multiple lights, bright environment maps) into the
// displayable 0-1 range. Without it, bright areas just clip harshly instead of rolling off, which
// reads as "blown out." A flat-lit scene with NoToneMapping can look fine, but leaving tone
// mapping off *by accident* when you do have bright lights/HDRI environments is a common cause of
// blown-out highlights.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Alternative: THREE.AgXToneMapping — newer, better highlight desaturation; increasingly
// preferred over ACES for scenes with bright/saturated lights. Try it if ACES looks washed out
// or oversaturated in the highlights.
// renderer.toneMapping = THREE.AgXToneMapping;

renderer.toneMappingExposure = 1.0; // the brightness dial once tone mapping is on — adjust to taste,
// not by changing light intensities, once you have a tone mapping curve applied.

// --- 3. Per-texture colorSpace: the rule that catches almost everyone ---
//
// Not every texture represents visible color. A texture's colorSpace tells three.js whether to
// treat its stored values as color (needs sRGB decode before lighting math) or raw numeric data
// (must NOT be decoded, or the math is wrong).
//
//   Color / perceptual data  -> THREE.SRGBColorSpace   (map/albedo, emissiveMap, env/background)
//   Numeric / non-color data -> THREE.NoColorSpace      (normalMap, roughnessMap, metalnessMap,
//                                                          aoMap, displacement/height maps — this
//                                                          is already the default, so usually you
//                                                          just leave it untouched)
//
// Getting this backwards is the #1 washed-out/too-dark bug:
//   - Forgetting SRGBColorSpace on an albedo map -> colors look dark/muddy (never sRGB-decoded).
//   - Setting SRGBColorSpace on a normal/roughness/AO map -> lighting math runs on decoded values
//     it never should have touched -> surfaces look washed out, normals look subtly wrong.

/**
 * Apply the correct colorSpace to a texture based on its role.
 * @param {THREE.Texture} texture
 * @param {'color' | 'data'} role - 'color' for albedo/emissive/env textures (visible color),
 *   'data' for normal/roughness/metalness/AO/height textures (numeric, not color).
 */
function setTextureColorSpace(texture, role) {
  if (role === 'color') {
    texture.colorSpace = THREE.SRGBColorSpace; // explicit — don't rely on defaults for color maps
  } else {
    texture.colorSpace = THREE.NoColorSpace; // explicit no-op for data maps, but stated for clarity
  }
  return texture;
}

// Example usage with a standard PBR material:
//
// const textureLoader = new THREE.TextureLoader();
// const material = new THREE.MeshStandardMaterial({
//   map: setTextureColorSpace(textureLoader.load('/textures/albedo.jpg'), 'color'),
//   normalMap: setTextureColorSpace(textureLoader.load('/textures/normal.jpg'), 'data'),
//   roughnessMap: setTextureColorSpace(textureLoader.load('/textures/roughness.jpg'), 'data'),
//   metalnessMap: setTextureColorSpace(textureLoader.load('/textures/metalness.jpg'), 'data'),
//   aoMap: setTextureColorSpace(textureLoader.load('/textures/ao.jpg'), 'data'),
// });

export { setTextureColorSpace };
