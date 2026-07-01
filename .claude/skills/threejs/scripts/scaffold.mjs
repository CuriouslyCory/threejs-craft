#!/usr/bin/env node
// scaffold.mjs — Copy a known-good three.js starter template into a new dir.
//
// Usage:
//   node scaffold.mjs [--renderer=webgl|webgpu] [--authoring=vanilla|r3f]
//                      [--delivery=vite|importmap] [--out=<dir>] [--force] [--help]
//
// Defaults: --renderer=webgl --authoring=vanilla --delivery=vite --out=./threejs-app
//
// Maps the (renderer, authoring, delivery) combo to a template directory
// under ../assets/templates/, recursively copies it to --out, and prints
// next steps. Refuses to overwrite a non-empty --out unless --force is
// passed. Unsupported combos (e.g. r3f+importmap, webgpu+importmap) print
// the list of valid combos and exit nonzero.
//
// Zero external dependencies. Pure Node ESM, Node 18+.

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_ROOT = path.join(__dirname, "..", "assets", "templates");

const HELP = `scaffold.mjs — copy a known-good three.js starter template

Usage:
  node scaffold.mjs [--renderer=webgl|webgpu] [--authoring=vanilla|r3f]
                     [--delivery=vite|importmap] [--out=<dir>] [--force]

Options:
  --renderer=webgl|webgpu       Renderer path (default: webgl)
  --authoring=vanilla|r3f       Authoring style (default: vanilla)
  --delivery=vite|importmap     Delivery mechanism (default: vite)
  --out=<dir>                   Output directory (default: ./threejs-app)
  --force                       Overwrite --out even if it exists and is non-empty
  --help, -h                    Show this help and exit

Valid combos (renderer+authoring+delivery -> template):
  webgl  + vanilla + importmap  -> vanilla-webgl-importmap
  webgl  + vanilla + vite       -> vanilla-webgl-vite
  webgpu + vanilla + vite       -> vanilla-webgpu-vite
  webgl  + r3f     + vite       -> r3f-webgl-vite
  webgpu + r3f     + vite       -> r3f-webgpu-vite

Unsupported combos (e.g. r3f+importmap, webgpu+importmap) are rejected.
`;

// combo key: `${renderer}+${authoring}+${delivery}` -> template dir name
const COMBO_MAP = {
  "webgl+vanilla+importmap": "vanilla-webgl-importmap",
  "webgl+vanilla+vite": "vanilla-webgl-vite",
  "webgpu+vanilla+vite": "vanilla-webgpu-vite",
  "webgl+r3f+vite": "r3f-webgl-vite",
  "webgpu+r3f+vite": "r3f-webgpu-vite",
};

const VALID = {
  renderer: new Set(["webgl", "webgpu"]),
  authoring: new Set(["vanilla", "r3f"]),
  delivery: new Set(["vite", "importmap"]),
};

function parseArgs(argv) {
  const args = {
    renderer: "webgl",
    authoring: "vanilla",
    delivery: "vite",
    out: "./threejs-app",
    force: false,
    help: false,
  };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      args.help = true;
    } else if (raw === "--force") {
      args.force = true;
    } else if (raw.startsWith("--renderer=")) {
      args.renderer = raw.slice("--renderer=".length);
    } else if (raw.startsWith("--authoring=")) {
      args.authoring = raw.slice("--authoring=".length);
    } else if (raw.startsWith("--delivery=")) {
      args.delivery = raw.slice("--delivery=".length);
    } else if (raw.startsWith("--out=")) {
      args.out = raw.slice("--out=".length);
    } else {
      console.error(`Warning: unrecognized argument '${raw}' (ignored)`);
    }
  }
  return args;
}

function printValidCombos() {
  console.error("Valid --renderer/--authoring/--delivery combos:");
  for (const [combo, template] of Object.entries(COMBO_MAP)) {
    const [renderer, authoring, delivery] = combo.split("+");
    console.error(
      `  --renderer=${renderer} --authoring=${authoring} --delivery=${delivery}  ->  ${template}`
    );
  }
}

function isDirEmpty(dir) {
  try {
    const entries = fs.readdirSync(dir);
    return entries.length === 0;
  } catch {
    return true; // doesn't exist yet, treat as "empty"
  }
}

/** Recursively copy `src` dir to `dest` dir, creating dest as needed. */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(srcPath);
      fs.symlinkSync(target, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function countFiles(dir) {
  let count = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
    else count += 1;
  }
  return count;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  // Validate individual fields first so the error message is specific.
  const badField = ["renderer", "authoring", "delivery"].find(
    (field) => !VALID[field].has(args[field])
  );
  if (badField) {
    console.error(
      `Error: invalid --${badField}='${args[badField]}' ` +
        `(expected one of: ${[...VALID[badField]].join(", ")})`
    );
    printValidCombos();
    process.exit(1);
  }

  console.log(
    `Resolved choices: renderer=${args.renderer} authoring=${args.authoring} delivery=${args.delivery} out=${args.out}`
  );

  const comboKey = `${args.renderer}+${args.authoring}+${args.delivery}`;
  const templateName = COMBO_MAP[comboKey];

  if (!templateName) {
    console.error(`\nError: unsupported combo '${comboKey}'.\n`);
    printValidCombos();
    process.exit(1);
  }

  const templateDir = path.join(TEMPLATES_ROOT, templateName);
  if (!fs.existsSync(templateDir) || !fs.statSync(templateDir).isDirectory()) {
    console.error(
      `Error: template directory not found at ${templateDir}. ` +
        `The skill's template assets may be incomplete.`
    );
    process.exit(1);
  }
  if (countFiles(templateDir) === 0) {
    console.error(
      `Error: template directory at ${templateDir} exists but contains no files. ` +
        `The skill's template assets may be incomplete.`
    );
    process.exit(1);
  }

  const outDir = path.resolve(args.out);
  const outExists = fs.existsSync(outDir);
  if (outExists && !isDirEmpty(outDir) && !args.force) {
    console.error(
      `Error: --out '${args.out}' already exists and is not empty. ` +
        `Pass --force to overwrite/merge into it.`
    );
    process.exit(1);
  }

  try {
    copyDir(templateDir, outDir);
  } catch (err) {
    console.error(`Error: failed to copy template to ${outDir}: ${err.message}`);
    process.exit(1);
  }

  const fileCount = countFiles(outDir);
  console.log(`\nScaffolded '${templateName}' -> ${outDir} (${fileCount} file(s)).`);

  console.log("\nNext steps:");
  console.log(`  cd ${args.out}`);
  if (args.delivery === "importmap") {
    console.log("  # no build step — serve statically, e.g.:");
    console.log("  npx serve .        # or: python3 -m http.server");
    console.log("  # then open the printed URL (index.html uses an ESM import map)");
  } else {
    console.log("  npm install");
    console.log("  npm run dev");
  }
  console.log(
    "\nAfter wiring up your scene, run scripts/validate.mjs against your source files."
  );
}

main();
