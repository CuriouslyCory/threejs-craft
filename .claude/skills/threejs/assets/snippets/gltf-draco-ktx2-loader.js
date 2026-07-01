// gltf-draco-ktx2-loader.js
//
// Factory for a GLTFLoader fully wired for compressed glTF assets: Draco (geometry
// compression), KTX2/Basis Universal (compressed textures), and Meshopt (alternative geometry
// compression, common from gltfpack/glTF-Transform pipelines). Wire all three even if a given
// model only uses one — GLTFLoader no-ops the extensions a file doesn't reference.
//
// Renderer-agnostic: GLTFLoader, DRACOLoader, KTX2Loader, and MeshoptDecoder all work the same
// on WebGL and WebGPU. KTX2Loader.detectSupport(renderer) is the only call that needs a live
// renderer instance (it queries which compressed GPU texture formats the current backend
// supports), so this factory takes `renderer` as a parameter.
//
// Import paths match assets/reference-data/addons-importmap.json (`shared` section) for
// GLTFLoader/DRACOLoader/KTX2Loader. MeshoptDecoder's path (`three/addons/libs/
// meshopt_decoder.module.js`) isn't listed there but is the long-stable three.js addon path for
// it — verify with `node scripts/docs_lookup.mjs MeshoptDecoder` if it ever seems off.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Pinned decoder/transcoder hosting — see assets/reference-data/addons-importmap.json ->
// decoderHosting. These are external binaries (WASM/JS), not the model file itself; point them
// at a CDN build matching the installed three version, or self-host by copying
// node_modules/three/examples/jsm/libs/{draco,basis}/ into your public/ folder.
const DRACO_DECODER_PATH = 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/';
const KTX2_TRANSCODER_PATH = 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/';

/**
 * Build a GLTFLoader wired with Draco, KTX2, and Meshopt decoding.
 *
 * @param {THREE.WebGLRenderer | THREE.WebGPURenderer} renderer - required for
 *   KTX2Loader.detectSupport(renderer), which queries the renderer for which compressed GPU
 *   texture formats (BC7, ASTC, ETC2, ...) the current device/backend actually supports.
 * @returns {{ loader: GLTFLoader, dracoLoader: DRACOLoader, ktx2Loader: KTX2Loader }} the
 *   composed GLTFLoader plus the two sub-loader instances, so callers can dispose them.
 */
function createGLTFLoader(renderer) {
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  // Default decoder type is WASM; DRACOLoader auto-picks WASM vs JS based on browser support.

  const ktx2Loader = new KTX2Loader();
  ktx2Loader
    .setTranscoderPath(KTX2_TRANSCODER_PATH)
    .detectSupport(renderer); // MUST be called — not optional; see references/textures.md

  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  loader.setKTX2Loader(ktx2Loader);
  loader.setMeshoptDecoder(MeshoptDecoder); // MeshoptDecoder is a ready-to-use singleton, not a class to instantiate

  return { loader, dracoLoader, ktx2Loader };
}

// --- usage ---
//
// const { loader, dracoLoader, ktx2Loader } = createGLTFLoader(renderer);
//
// async function loadModel(url) {
//   const gltf = await loader.loadAsync(url); // { scene, scenes, cameras, animations, asset, ... }
//   scene.add(gltf.scene);
//   return gltf;
// }
//
// loadModel('/models/character.glb').catch((err) => {
//   console.error('Failed to load model:', err); // loadAsync rejects on network/parse errors — don't let it fail silently
// });

/**
 * Dispose note: DRACOLoader and KTX2Loader each spin up a pool of Web Workers (and, for KTX2,
 * WASM transcoder module state) to decode off the main thread. These are NOT tied to any single
 * loaded model's lifecycle — call dispose() once when the app/route that uses 3D content is
 * torn down, not after every individual loadAsync(). Calling it mid-session kills in-flight
 * decodes for any other model still loading.
 */
function disposeGLTFLoader({ dracoLoader, ktx2Loader }) {
  dracoLoader.dispose(); // terminates the Draco decoder worker pool
  ktx2Loader.dispose(); // terminates the KTX2/Basis transcoder worker pool
  // MeshoptDecoder has no per-instance dispose (it's a shared singleton module).
  // Also dispose the loaded scene's geometries/materials/textures separately — see invariant 6
  // and references/loaders-and-assets.md.
}

export { createGLTFLoader, disposeGLTFLoader };
