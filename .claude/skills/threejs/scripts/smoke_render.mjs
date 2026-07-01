#!/usr/bin/env node
// smoke_render.mjs — OPTIONAL headless render smoke test (NOT the required
// verify-loop floor — that's scripts/validate.mjs).
//
// Usage:
//   node smoke_render.mjs --url=http://localhost:5173 [--help]
//
// What it does:
//   Tries to `import('puppeteer')`. If puppeteer isn't installed, this
//   script explains what it *would* do and exits 0 — it never fails a
//   workflow just because an optional devDependency is missing.
//
//   If puppeteer IS available: launches headless Chromium, navigates to
//   --url (a running dev server you started yourself, e.g. `npm run dev`),
//   waits for a <canvas> element, screenshots it, and heuristically checks
//   whether the canvas is uniformly one color (a cheap blank/black-screen
//   detector — not a correctness check). Prints PASS/FAIL.
//
// To enable this check:
//   npm i -D puppeteer
//
// Zero required dependencies (puppeteer is optional and dynamically
// imported). Pure Node ESM, Node 18+. Never hard-crashes on a missing dep
// or missing --url.

const HELP = `smoke_render.mjs — OPTIONAL headless render smoke test

Usage:
  node smoke_render.mjs --url=<http url of a running dev server>

This is an OPTIONAL check, not the required verify-loop floor. The required
floor is scripts/validate.mjs (static, no runtime needed).

Requires the optional devDependency 'puppeteer' (npm i -D puppeteer). If it
is not installed, this script explains what it would do and exits 0 without
failing. If it IS installed, it launches headless Chromium, loads --url,
waits for a <canvas>, screenshots it, and heuristically flags a uniformly
one-color canvas (likely blank/black screen).
`;

function parseArgs(argv) {
  const args = { url: null, help: false };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      args.help = true;
    } else if (raw.startsWith("--url=")) {
      args.url = raw.slice("--url=".length);
    }
  }
  return args;
}

function explainOptionalCheck() {
  console.log(
    "smoke_render.mjs is an OPTIONAL check (the required verify-loop floor is validate.mjs)."
  );
  console.log("\nThe 'puppeteer' package is not installed, so this check is skipped.");
  console.log("\nWhat it would do if enabled (npm i -D puppeteer):");
  console.log("  1. Launch headless Chromium.");
  console.log("  2. Navigate to --url (a dev server you started, e.g. `npm run dev`).");
  console.log("  3. Wait for a <canvas> element to appear in the DOM.");
  console.log("  4. Screenshot the canvas region.");
  console.log(
    "  5. Heuristically check whether the screenshot is a single uniform color " +
      "(a cheap blank/black-screen detector) and print PASS/FAIL."
  );
  console.log("\nTo enable: npm i -D puppeteer, then re-run with --url=<dev-server-url>.");
}

/**
 * Decode a PNG screenshot buffer just enough to sample pixel bytes without
 * an external dependency, by asking puppeteer/Chromium to hand back raw
 * pixel data directly instead of a PNG file. We use page.screenshot with
 * encoding 'binary' plus a canvas.toDataURL evaluated in-page instead, so
 * we never need to parse PNG ourselves — see checkCanvasVariance below.
 */
async function checkCanvasVariance(page) {
  // Ask the browser itself to read back pixel data from the canvas via
  // getImageData — avoids needing a PNG decoder in this zero-dep script.
  const result = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { ok: false, reason: "no <canvas> element found" };

    let ctx = null;
    let imageData = null;
    try {
      // Prefer 2D context reading (works if the canvas exposes one);
      // otherwise fall back to drawing the canvas into a fresh 2D canvas,
      // which works for WebGL/WebGPU canvases too since drawImage can copy
      // from any CanvasImageSource.
      const probe = document.createElement("canvas");
      probe.width = Math.max(1, Math.min(canvas.width || canvas.clientWidth || 1, 512));
      probe.height = Math.max(1, Math.min(canvas.height || canvas.clientHeight || 1, 512));
      ctx = probe.getContext("2d");
      ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
      imageData = ctx.getImageData(0, 0, probe.width, probe.height);
    } catch (err) {
      return { ok: false, reason: `could not read canvas pixels: ${err.message}` };
    }

    const data = imageData.data;
    let first = null;
    let uniform = true;
    for (let i = 0; i < data.length; i += 4) {
      const px = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (first === null) {
        first = px;
      } else if (
        px[0] !== first[0] ||
        px[1] !== first[1] ||
        px[2] !== first[2] ||
        px[3] !== first[3]
      ) {
        uniform = false;
        break;
      }
    }

    return {
      ok: true,
      uniform,
      sampledColor: first,
      width: imageData.width,
      height: imageData.height,
    };
  });

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  let puppeteer;
  try {
    const mod = await import("puppeteer");
    puppeteer = mod.default ?? mod;
  } catch {
    explainOptionalCheck();
    process.exit(0);
    return;
  }

  if (!args.url) {
    console.log("puppeteer is installed, but no --url was provided.");
    console.log("Usage: node smoke_render.mjs --url=http://localhost:5173");
    process.exit(0);
    return;
  }

  console.log(`smoke_render.mjs: launching headless Chromium, navigating to ${args.url} ...`);

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
  } catch (err) {
    console.log(`FAIL: could not launch headless Chromium (${err.message})`);
    console.log(
      "This may need extra system deps for Chromium sandboxing; see puppeteer's troubleshooting docs."
    );
    process.exit(0);
    return;
  }

  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.log(`  [page error] ${err.message}`));

    let navError = null;
    try {
      await page.goto(args.url, { waitUntil: "networkidle2", timeout: 15000 });
    } catch (err) {
      navError = err;
    }

    if (navError) {
      console.log(`FAIL: could not load ${args.url} (${navError.message})`);
      console.log("Is the dev server running? (npm run dev)");
      process.exit(0);
      return;
    }

    try {
      await page.waitForSelector("canvas", { timeout: 10000 });
    } catch {
      console.log(`FAIL: no <canvas> element appeared within 10s at ${args.url}`);
      process.exit(0);
      return;
    }

    // Give a render frame or two a chance to land (setAnimationLoop, async
    // WebGPU init, etc.) before sampling pixels.
    await new Promise((resolve) => setTimeout(resolve, 500));

    let screenshotPath = null;
    try {
      const canvasHandle = await page.$("canvas");
      screenshotPath = `smoke_render_${Date.now()}.png`;
      await canvasHandle.screenshot({ path: screenshotPath });
    } catch (err) {
      console.log(`WARN: could not save canvas screenshot (${err.message}); continuing with pixel check.`);
    }

    const variance = await checkCanvasVariance(page);

    if (!variance.ok) {
      console.log(`FAIL: ${variance.reason}`);
      process.exit(0);
      return;
    }

    if (variance.uniform) {
      const [r, g, b, a] = variance.sampledColor ?? [0, 0, 0, 0];
      console.log(
        `FAIL: canvas appears uniformly one color (rgba(${r},${g},${b},${a})) — ` +
          "likely a blank or black screen."
      );
    } else {
      console.log(
        `PASS: canvas (${variance.width}x${variance.height} sampled) is not a single uniform color.`
      );
    }

    if (screenshotPath) console.log(`Screenshot saved to ${screenshotPath}`);
  } finally {
    await browser.close().catch(() => {});
  }

  process.exit(0);
}

main().catch((err) => {
  // This is an optional convenience check — never hard-crash the caller.
  console.log(`smoke_render.mjs encountered an unexpected error: ${err.message}`);
  process.exit(0);
});
