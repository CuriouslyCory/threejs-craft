# vanilla-webgl-vite

**What this demonstrates:** the minimal correct three.js WebGL setup with a real bundler — a
lit, rotating `MeshStandardMaterial` cube with `OrbitControls`, pinned to three **0.185.1** and
built with Vite **7**.

## Run it

```bash
npm install
npm run dev
```

Then open the printed local URL (typically http://localhost:5173).

Other scripts:

```bash
npm run build     # production build to dist/
npm run preview   # serve the production build locally
```

## Files

- `package.json` — pins `three@0.185.1` and `vite@^7`; `"type": "module"`.
- `index.html` — Vite entry point, loads `/src/main.js` as a module.
- `src/main.js` — the scene: renderer, camera, lights, cube, `OrbitControls`, resize, render
  loop, and a `dispose()` teardown hook (also wired into Vite's HMR dispose so hot reloads don't
  leak GPU resources).
- `.gitignore` — excludes `node_modules` and `dist`.

## Notes

- Imports use the bare specifiers `three` and `three/addons/*` — Vite resolves them through
  `node_modules` via three's package `exports` map, no bundler config needed.
- This is the default delivery path for any real project (per the skill's decision gate 3);
  reach for `vanilla-webgl-importmap` only for a deliberately build-less demo.
