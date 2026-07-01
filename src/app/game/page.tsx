"use client";

import dynamic from "next/dynamic";

// The r3f <Canvas> touches window/WebGL and runs a render loop, so it must not
// server-render. Per the threejs skill's Next.js integration guidance
// (.claude/skills/threejs/references/react-three-fiber.md → "Next.js integration"),
// load the scene client-only with `ssr: false`.
//
// `loading` (#11) is a cheap, static paw touch shown only for the brief
// window while the `game-scene.tsx` chunk itself is being fetched/parsed —
// not a per-frame animation, so it doesn't touch any of the render-loop
// invariants above.
const GameScene = dynamic(() => import("./game-scene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center gap-2 text-white/70">
      <span aria-hidden="true" className="text-3xl">
        🐾
      </span>
      <span className="text-sm">Loading world…</span>
    </div>
  ),
});

export default function GamePage() {
  return (
    <main className="relative h-dvh w-full bg-[#15162c] text-white">
      <div className="pointer-events-none absolute left-0 top-0 z-10 p-6">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-[hsl(280,100%,70%)]">/game</span> — static world
        </h1>
        <p className="text-sm text-white/70">
          Click to look around — WASD to move, Shift to sprint, Space to jump
          (double-tap to fly), Esc to pause.
        </p>
      </div>
      <GameScene />
    </main>
  );
}
