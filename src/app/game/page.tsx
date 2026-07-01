"use client";

import dynamic from "next/dynamic";

// The r3f <Canvas> touches window/WebGL and runs a render loop, so it must not
// server-render. Per the threejs skill's Next.js integration guidance
// (.claude/skills/threejs/references/react-three-fiber.md → "Next.js integration"),
// load the scene client-only with `ssr: false`.
const GameScene = dynamic(() => import("./game-scene"), { ssr: false });

export default function GamePage() {
  return (
    <main className="relative h-dvh w-full bg-[#15162c] text-white">
      <div className="pointer-events-none absolute left-0 top-0 z-10 p-6">
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-[hsl(280,100%,70%)]">/game</span> — three.js canvas
        </h1>
        <p className="text-sm text-white/70">Drag anywhere to rotate the cube.</p>
      </div>
      <GameScene />
    </main>
  );
}
