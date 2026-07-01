#!/usr/bin/env node
// doctor.mjs — Detect installed three.js / R3F / drei versions and report drift.
//
// Usage:
//   node doctor.mjs [--dir=<start-dir>] [--help]
//
// What it does:
//   Walks up from the current working directory (or --dir) looking for each
//   package's package.json under the nearest node_modules, the way Node's own
//   module resolution would. Prints a table comparing installed versions
//   against the "latestKnown" versions pinned in
//   assets/reference-data/version-map.json, flags status (ok/behind/ahead/
//   missing), detects whether the WebGPU build (three/build/three.webgpu.js)
//   is present, and — if the installed `three` differs from latestKnown —
//   prints the high-signal breaking-change notes as a heads-up.
//
// This script has ZERO external dependencies, is pure Node ESM, and never
// throws for the "nothing installed" case; it degrades to a friendly report
// suggesting scaffold.mjs instead.
//
// Exit codes:
//   0 — always, unless --help is requested improperly. This is a diagnostic
//       tool, not a gate; scripts/validate.mjs is the gate.

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HELP = `doctor.mjs — detect installed three.js / R3F / drei versions

Usage:
  node doctor.mjs [--dir=<start-dir>]

Options:
  --dir=<path>   Directory to start searching for node_modules from
                 (defaults to the current working directory).
  --help, -h     Show this help and exit.

Prints a table of package | installed | latestKnown | status, notes whether
the WebGPU build (three/build/three.webgpu.js) is present, and — if the
installed three differs from the version this skill was authored against —
prints the high-signal breaking-change notes from version-map.json.
`;

function parseArgs(argv) {
  const args = { dir: process.cwd(), help: false };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      args.help = true;
    } else if (raw.startsWith("--dir=")) {
      args.dir = path.resolve(raw.slice("--dir=".length));
    }
  }
  return args;
}

/** Load version-map.json relative to this script's own location. */
function loadVersionMap() {
  const p = path.join(__dirname, "..", "assets", "reference-data", "version-map.json");
  try {
    const raw = fs.readFileSync(p, "utf8");
    return { data: JSON.parse(raw), path: p, error: null };
  } catch (err) {
    return { data: null, path: p, error: err };
  }
}

/**
 * Walk up from `startDir` collecting every `node_modules` directory seen,
 * the same way Node module resolution does. Returns an array of
 * node_modules paths, nearest first.
 */
function findNodeModulesDirs(startDir) {
  const found = [];
  let dir = path.resolve(startDir);
  // Cap iterations defensively in case of a pathological filesystem loop.
  for (let i = 0; i < 256; i++) {
    const candidate = path.join(dir, "node_modules");
    if (isDirectory(candidate)) found.push(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return found;
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a (possibly scoped) package's directory by walking the
 * node_modules chain from startDir upward. Returns { dir, pkgJsonPath,
 * version } or null if not found anywhere in the chain.
 */
function resolvePackage(pkgName, startDir) {
  for (const nmDir of findNodeModulesDirs(startDir)) {
    const pkgDir = path.join(nmDir, ...pkgName.split("/"));
    const pkgJsonPath = path.join(pkgDir, "package.json");
    if (isFile(pkgJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        return { dir: pkgDir, pkgJsonPath, version: parsed.version ?? "unknown" };
      } catch {
        // Corrupt package.json — treat as not resolvable, keep searching.
        continue;
      }
    }
  }
  return null;
}

/** Compare two semver-ish "x.y.z" strings. Returns -1, 0, or 1. Best-effort. */
function compareVersions(a, b) {
  const pa = String(a).split(/[.\-+]/).map((n) => parseInt(n, 10));
  const pb = String(b).split(/[.\-+]/).map((n) => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.isNaN(pa[i]) ? 0 : pa[i] ?? 0;
    const nb = Number.isNaN(pb[i]) ? 0 : pb[i] ?? 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

function statusFor(installed, latestKnown) {
  if (!installed) return "missing";
  if (!latestKnown || latestKnown === "unknown") return "unknown";
  const cmp = compareVersions(installed, latestKnown);
  if (cmp === 0) return "ok";
  return cmp < 0 ? "behind" : "ahead";
}

function padCell(text, width) {
  const s = String(text);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function printTable(rows) {
  const headers = ["package", "installed", "latestKnown", "status"];
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length))
  );
  const line = (cells) => cells.map((c, i) => padCell(c, widths[i])).join("  ");
  console.log(line(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}

function detectWebGPU(threePkg) {
  if (!threePkg) return { present: false, checkedPath: null };
  const candidate = path.join(threePkg.dir, "build", "three.webgpu.js");
  return { present: isFile(candidate), checkedPath: candidate };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  console.log(`three.js doctor — scanning from ${args.dir}\n`);

  const { data: versionMap, path: versionMapPath, error: vmError } = loadVersionMap();
  if (vmError) {
    console.log(
      `WARN: could not read reference data at ${versionMapPath} (${vmError.code ?? vmError.message}).`
    );
    console.log("Continuing with version detection only; no drift comparison available.\n");
  }
  const latestKnown = versionMap?.latestKnown ?? {};

  const packages = ["three", "@react-three/fiber", "@react-three/drei"];
  const resolved = {};
  const rows = [];

  for (const pkg of packages) {
    const info = resolvePackage(pkg, args.dir);
    resolved[pkg] = info;
    const installed = info?.version ?? null;
    const known = latestKnown[pkg] ?? "unknown";
    rows.push([pkg, installed ?? "(not installed)", known, statusFor(installed, known)]);
  }

  printTable(rows);

  const threeInfo = resolved["three"];

  if (!threeInfo) {
    console.log(
      "\nthree is not installed in any node_modules found while walking up from " +
        `${args.dir}.`
    );
    console.log(
      "Run scripts/scaffold.mjs to generate a known-good starter project, then npm install."
    );
    // Nothing more to report if three itself is missing.
    console.log("");
    return;
  }

  // WebGPU build detection.
  const webgpu = detectWebGPU(threeInfo);
  console.log(
    `\nWebGPU build (three/build/three.webgpu.js): ${webgpu.present ? "present" : "not found"}`
  );
  if (!webgpu.present) {
    console.log(
      `  (checked ${webgpu.checkedPath}; older three versions or trimmed installs may lack it)`
    );
  }

  // Breaking-change heads-up if installed three differs from latestKnown.
  const latestThree = latestKnown.three;
  if (latestThree && threeInfo.version !== "unknown" && threeInfo.version !== latestThree) {
    const cmp = compareVersions(threeInfo.version, latestThree);
    const direction = cmp < 0 ? "behind" : "ahead of";
    console.log(
      `\nInstalled three (${threeInfo.version}) is ${direction} the version this skill was ` +
        `authored against (${latestThree}, ${latestKnown.threeRelease ?? ""}).`
    );
    const notes = versionMap?.breakingChangesHighSignal;
    if (notes) {
      console.log("High-signal facts to double-check against the installed version:");
      for (const [key, value] of Object.entries(notes)) {
        if (key === "$comment") continue;
        if (Array.isArray(value)) {
          console.log(`  - ${key}: ${value.join("; ")}`);
        } else {
          console.log(`  - ${key}: ${value}`);
        }
      }
      console.log(
        "For anything not covered here, run scripts/docs_lookup.mjs <ClassName> rather than guessing."
      );
    }
  } else if (latestThree && threeInfo.version === latestThree) {
    console.log(`\nInstalled three (${threeInfo.version}) matches the pinned latestKnown.`);
  }

  console.log("");
}

main();
