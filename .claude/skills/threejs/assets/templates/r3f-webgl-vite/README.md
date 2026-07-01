# r3f-webgl-vite

**What this demonstrates:** the minimal correct React Three Fiber (WebGL) scene —
a `<Canvas>` with a lit, rotating mesh, drei `<Environment>` for image-based
lighting, and drei `<OrbitControls>`. Copy this folder as the starting point
for any new r3f + WebGL scene.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (default `http://localhost:5173`).

```bash
npm run build     # production build to dist/
npm run preview   # preview the production build locally
```

## Stack

- react `19.2.x`, react-dom `19.2.x`
- three `0.185.1`
- @react-three/fiber `9.6.1`
- @react-three/drei `10.7.7`
- vite `^7`, @vitejs/plugin-react

r3f 9 requires `react` / `react-dom` **>=19 <19.3** as peer deps — don't bump
React past that range without checking `@react-three/fiber`'s peer
requirements first.

## Notes on r3f invariants

- **Render loop**: uses `useFrame` (see `src/App.jsx`), never a manual
  `requestAnimationFrame`/`setAnimationLoop` call — r3f owns one shared loop
  internally and calls every mounted `useFrame` callback each tick.
- **Disposal**: automatic. r3f disposes JSX-created geometries, materials,
  and textures on unmount, and tears down the renderer when `<Canvas>`
  unmounts. Manual `.dispose()` is only needed for objects you construct
  imperatively outside of JSX's managed lifecycle.
- **Color management**: r3f's `<Canvas>` defaults already set
  `outputColorSpace = SRGBColorSpace` and `ACESFilmicToneMapping` — no manual
  renderer setup required.

## Using this inside the Next.js 16 host app

This is a standalone Vite template, not a Next.js app. To drop the `<Canvas>`
scene into a Next.js (App Router) page:

1. Copy `src/App.jsx` (or its contents) into a component file marked as a
   Client Component:

   ```tsx
   // app/scene/three-scene.tsx
   "use client";

   import { Canvas, useFrame } from "@react-three/fiber";
   import { Environment, OrbitControls } from "@react-three/drei";
   // ...same component code as src/App.jsx
   ```

2. Import it with `next/dynamic` and `ssr: false` from the Server Component
   page that renders it — `@react-three/fiber` touches `window`/WebGL APIs
   that don't exist during server rendering:

   ```tsx
   // app/scene/page.tsx
   import dynamic from "next/dynamic";

   const ThreeScene = dynamic(() => import("./three-scene"), { ssr: false });

   export default function Page() {
     return <ThreeScene />;
   }
   ```

3. Install the same pinned dependencies (`three@0.185.1`,
   `@react-three/fiber@9.6.1`, `@react-three/drei@10.7.7`) in the host repo,
   respecting the React `>=19 <19.3` peer constraint above.
