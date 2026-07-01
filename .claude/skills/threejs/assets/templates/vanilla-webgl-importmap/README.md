# vanilla-webgl-importmap

**What this demonstrates:** the minimal correct three.js WebGL setup with zero build step — a
lit, rotating `MeshStandardMaterial` cube with `OrbitControls`, driven entirely by an ESM
`<script type="importmap">` pinned to three **0.185.1** on jsDelivr.

## Run it

No install step — there is no `package.json` and nothing to `npm install`. But **ES modules
require http(s), not `file://`**, so you must serve this folder rather than double-clicking
`index.html`. Pick one:

```bash
npx serve .
# or
python3 -m http.server 8080
# or use the VS Code "Live Server" extension
```

Then open the printed local URL in your browser.

## Files

- `index.html` — the import map (pins `three` and `three/addons/` to exact CDN URLs) + canvas.
- `main.js` — the scene: renderer, camera, lights, cube, `OrbitControls`, resize, render loop,
  and a `dispose()` teardown hook.

## Notes

- The import map pins an **exact** three.js version (0.185.1) rather than `latest` — reproducible
  by design. Bump both the `three` and `three/addons/` entries together if you upgrade.
- `three/addons/` uses a **trailing-slash prefix mapping** — that's what lets
  `import { OrbitControls } from 'three/addons/controls/OrbitControls.js'` resolve against the
  CDN's `examples/jsm/` folder.
- No bundler means no dead-code elimination or TypeScript — reach for the `vanilla-webgl-vite`
  template instead once this needs to grow past a demo.
