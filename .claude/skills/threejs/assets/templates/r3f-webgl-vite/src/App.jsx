import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";

/**
 * A single lit, rotating mesh. This is the whole scene on purpose — the
 * point of this template is a known-good starting point, not a demo of
 * everything the ecosystem can do.
 */
function RotatingBox() {
  const meshRef = useRef(null);

  // r3f invariant: use useFrame for the render loop, never a manual
  // requestAnimationFrame/setAnimationLoop call. r3f already drives one
  // shared setAnimationLoop internally (satisfying invariant 4) and calls
  // every mounted useFrame callback each tick with (state, delta).
  useFrame((_state, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.x += delta * 0.4;
    meshRef.current.rotation.y += delta * 0.6;
  });

  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      <boxGeometry args={[1.5, 1.5, 1.5]} />
      {/* MeshStandardMaterial is PBR and responds correctly to the
          Environment lighting below and to renderer color management —
          see the colorSpace note in main render setup. */}
      <meshStandardMaterial color="#5b8def" roughness={0.35} metalness={0.1} />
    </mesh>
  );
}

export default function App() {
  return (
    <Canvas
      camera={{ position: [3, 2, 4], fov: 50 }}
      // r3f defaults are already correct three.js color management:
      // outputColorSpace = SRGBColorSpace and ACESFilmicToneMapping are
      // applied out of the box (invariant 3), so no manual renderer setup
      // is needed here. Override via <Canvas gl={{ toneMapping: ... }}>
      // if a scene needs different tone mapping.
    >
      {/* Environment provides image-based lighting (IBL) so the standard
          material has something physically plausible to reflect — this
          alone is often enough lighting for a product-shot style render.
          A drei preset downloads a small HDRI at runtime. */}
      <Environment preset="city" />

      {/* A little direct light on top of the IBL to give the rotation a
          visible highlight/shadow as it turns. */}
      <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
      <ambientLight intensity={0.2} />

      <RotatingBox />

      {/* drei's OrbitControls wraps three/addons OrbitControls and hooks
          into r3f's render loop automatically. */}
      <OrbitControls enableDamping />
    </Canvas>
  );
}

// Disposal note (invariant 6): r3f automatically disposes geometries,
// materials, and textures created by JSX elements (<boxGeometry>,
// <meshStandardMaterial>, etc.) when the owning component unmounts, and
// disposes the WebGLRenderer/context when <Canvas> unmounts. You only need
// to call .dispose() yourself for objects you construct imperatively
// outside of JSX (e.g. inside a ref callback or a manually-created
// THREE.Texture) and attach without r3f managing their lifecycle.
