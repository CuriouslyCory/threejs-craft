import { useRef } from "react";
import { Canvas, useFrame, extend } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
// IMPORTANT: import the WebGPU build of three, not the default 'three'
// entry point. 'three/webgpu' exports WebGPURenderer plus the "Node"
// material family (MeshStandardNodeMaterial, MeshBasicNodeMaterial, ...)
// that WebGPURenderer's node-based pipeline requires. Per this skill's
// invariant 7, the classic GLSL-shader-based material APIs and their
// custom-injection hooks are WebGL-only — do not mix imports from 'three'
// and 'three/webgpu' in the same scene.
import * as THREE from "three/webgpu";

// r3f only ships JSX intrinsics (<mesh>, <boxGeometry>, ...) for the
// default 'three' catalog. Anything imported from 'three/webgpu' — the
// Node materials in particular — has to be registered with r3f's `extend`
// so JSX can reference it. Passing the whole namespace registers every
// export under its lowerCamelCase tag name, so THREE.MeshStandardNodeMaterial
// becomes the JSX tag <meshStandardNodeMaterial>. This is the pattern
// documented across current r3f WebGPU examples; if this ever fails to
// resolve, verify against the @react-three/fiber docs and
// references/react-three-fiber.md before guessing a different helper name.
extend(THREE);

/**
 * A single lit, rotating mesh, matching the WebGL template's scene but
 * built from WebGPU-compatible node materials.
 */
function RotatingBox() {
  const meshRef = useRef(null);

  // r3f invariant: useFrame is the render loop, never a manual
  // requestAnimationFrame/setAnimationLoop call. This holds identically
  // under the WebGPU renderer — r3f drives one shared internal loop
  // regardless of which renderer the `gl` factory below constructs.
  useFrame((_state, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.x += delta * 0.4;
    meshRef.current.rotation.y += delta * 0.6;
  });

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <boxGeometry args={[1.5, 1.5, 1.5]} />
      {/* meshStandardNodeMaterial, NOT meshStandardMaterial: the classic
          MeshStandardMaterial is a WebGL-only shader-based material and
          throws ("NodeMaterial: Material ... is not compatible") under
          WebGPURenderer's node pipeline. MeshStandardNodeMaterial is the
          TSL/node-graph equivalent and is what `extend(THREE)` registered
          above from 'three/webgpu'. */}
      <meshStandardNodeMaterial color="#5b8def" roughness={0.35} metalness={0.1} />
    </mesh>
  );
}

export default function App() {
  return (
    <Canvas
      camera={{ position: [3, 2, 4], fov: 50 }}
      // --- The WebGPU renderer wiring ---
      // r3f's `gl` prop normally takes renderer constructor options or a
      // sync factory; r3f v9 additionally accepts an ASYNC factory
      // function, which is required here because WebGPURenderer's device
      // handshake (navigator.gpu.requestAdapter()) is asynchronous —
      // unlike WebGLRenderer, whose context is ready the instant the
      // constructor returns.
      //
      // r3f awaits the promise this function returns before it starts
      // rendering, so we don't race the handshake (the failure mode if you
      // skip `await renderer.init()` is a silently black canvas with no
      // console error — see references/renderers-and-setup.md, "Why WebGPU
      // needs await renderer.init()").
      //
      // `props` here is the same options object r3f would otherwise pass to
      // `new WebGLRenderer(props)` — it already includes the canvas r3f
      // created, so spread it straight into WebGPURenderer's constructor.
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer(props);
        await renderer.init(); // mandatory async device init — see comment above
        // Explicit color management (invariant 3): r3f sets this
        // automatically for its default WebGLRenderer, but since we're
        // constructing the renderer ourselves here it's set explicitly so
        // colors are correct regardless of r3f's internal defaults.
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        return renderer;
      }}
    >
      {/* Plain lights instead of drei <Environment> for this template:
          Environment's default HDRI pipeline (PMREM prefiltering) targets
          the WebGL path; keeping this template to direct lights avoids
          coupling the WebGPU example to a feature that needs its own
          verification under the node-material pipeline. Swap in
          <Environment> once you've confirmed drei's version supports it
          against your installed @react-three/drei — see
          references/react-three-fiber.md. */}
      <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
      <ambientLight intensity={0.4} />

      <RotatingBox />

      {/* drei's OrbitControls wraps three/addons OrbitControls and hooks
          into r3f's render loop automatically — this works unchanged under
          WebGPURenderer. */}
      <OrbitControls enableDamping />
    </Canvas>
  );
}

// Disposal note (invariant 6): r3f automatically disposes geometries,
// materials, and textures created by JSX elements when the owning
// component unmounts, and disposes the renderer/context when <Canvas>
// unmounts — this is unaffected by supplying a custom `gl` factory. You
// only need to call .dispose() yourself for objects you construct
// imperatively outside of JSX and attach without r3f managing their
// lifecycle.
