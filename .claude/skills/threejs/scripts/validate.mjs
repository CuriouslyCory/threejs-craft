#!/usr/bin/env node
// validate.mjs — Static footgun linter for three.js / R3F source files.
//
// Usage:
//   node validate.mjs <file-or-dir> [<file-or-dir> ...] [--quiet] [--help]
//
// Accepts one or more file paths and/or directories. Directories are
// recursively scanned for .js/.ts/.jsx/.tsx files, skipping node_modules,
// dist, .next, and build. Each file is run through a set of conservative
// regex/line checks mapped to the 7 invariants in SKILL.md, and findings are
// printed as:
//
//   SEVERITY file:line — message (fix hint)
//
// Severities: ERROR (invariant violation, breaks or mis-renders the scene),
// WARN (likely bug, worth a look), INFO (heuristic, may be a false positive
// or handled elsewhere).
//
// Exit codes:
//   0 — no ERROR findings (WARN/INFO may still be present)
//   1 — at least one ERROR finding
//   2 — usage error (bad args, no files found)
//
// Zero external dependencies. Pure Node ESM, Node 18+.

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HELP = `validate.mjs — static footgun linter for three.js / R3F code

Usage:
  node validate.mjs <file-or-dir> [<file-or-dir> ...] [--quiet]

Options:
  --quiet        Only print ERROR findings (suppress WARN/INFO).
  --help, -h     Show this help and exit.

Recursively lints .js/.ts/.jsx/.tsx files (directories skip node_modules,
dist, .next, build). Exits nonzero if any ERROR finding is present.
`;

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "build", ".git"]);
const LINT_EXTENSIONS = new Set([".js", ".ts", ".jsx", ".tsx"]);

function parseArgs(argv) {
  const args = { paths: [], quiet: false, help: false };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      args.help = true;
    } else if (raw === "--quiet") {
      args.quiet = true;
    } else if (raw.startsWith("--")) {
      // Unknown flag — ignore quietly rather than hard-failing, but note it.
      console.error(`Warning: unrecognized flag ${raw}`);
    } else {
      args.paths.push(raw);
    }
  }
  return args;
}

/** Recursively collect lintable files starting at `entry` (file or dir). */
function collectFiles(entry) {
  const results = [];
  let stat;
  try {
    stat = fs.statSync(entry);
  } catch (err) {
    console.error(`Warning: cannot access ${entry} (${err.code ?? err.message}), skipping.`);
    return results;
  }

  if (stat.isFile()) {
    if (LINT_EXTENSIONS.has(path.extname(entry))) results.push(path.resolve(entry));
    return results;
  }

  if (stat.isDirectory()) {
    const base = path.basename(entry);
    if (SKIP_DIRS.has(base)) return results;
    let children;
    try {
      children = fs.readdirSync(entry, { withFileTypes: true });
    } catch (err) {
      console.error(`Warning: cannot read directory ${entry} (${err.code ?? err.message}), skipping.`);
      return results;
    }
    for (const child of children) {
      if (SKIP_DIRS.has(child.name)) continue;
      const full = path.join(entry, child.name);
      if (child.isDirectory()) {
        results.push(...collectFiles(full));
      } else if (child.isFile() && LINT_EXTENSIONS.has(path.extname(child.name))) {
        results.push(path.resolve(full));
      }
    }
  }

  return results;
}

/**
 * Each check receives the full file text, its per-line array, and the
 * filename, and returns an array of { severity, line, message } findings.
 * Checks are intentionally conservative (favor false negatives over false
 * positives) per the task brief.
 */
const CHECKS = [
  // --- Invariant 1: ESM only. No global THREE via <script>, window.THREE, or
  // a raw https:// build URL import. --------------------------------------
  {
    name: "global-three-script-tag",
    invariant: 1,
    run(text, lines) {
      const findings = [];
      const scriptTagRe = /<script\b[^>]*>/gi;
      let m;
      while ((m = scriptTagRe.exec(text))) {
        const tag = m[0];
        if (/three/i.test(tag) && !/type\s*=\s*["']importmap["']/i.test(tag)) {
          findings.push({
            severity: "ERROR",
            line: lineOf(text, m.index),
            message:
              "global THREE via a <script> tag referencing three (violates ESM-only invariant) " +
              "(fix: use ESM `import` from 'three' / 'three/addons' instead of a classic script tag)",
          });
        }
      }
      return findings;
    },
  },
  {
    name: "window-three-global",
    invariant: 1,
    run(text, lines) {
      const findings = [];
      lines.forEach((line, i) => {
        if (/\bwindow\.THREE\b/.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "window.THREE usage (relies on a global THREE, violates ESM-only invariant) " +
              "(fix: `import * as THREE from 'three'` instead of reading a global)",
          });
        }
      });
      return findings;
    },
  },
  {
    name: "cdn-build-url-import",
    invariant: 1,
    run(text, lines) {
      const findings = [];
      lines.forEach((line, i) => {
        // import ... from 'https://.../three....js'  (skip legitimate bare specifiers)
        if (/import\s+[^'"]*from\s*['"]https?:\/\/[^'"]*three[^'"]*['"]/.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "import from a raw https:// three build URL (violates ESM-only invariant 1) " +
              "(fix: use a bare specifier 'three' / 'three/addons/*' resolved via bundler or an import map)",
          });
        }
      });
      return findings;
    },
  },

  // --- Invariant 2: BufferGeometry only. Geometry/Face3/JSONLoader removed. -
  {
    name: "removed-geometry-apis",
    invariant: 2,
    run(text, lines) {
      const findings = [];
      lines.forEach((line, i) => {
        if (/\bnew\s+THREE\.Geometry\s*\(/.test(line) || /\bTHREE\.Geometry\b(?!.*BufferGeometry)/.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "THREE.Geometry was removed years ago (invariant 2) " +
              "(fix: port to BufferGeometry / BufferAttribute)",
          });
        }
        if (/\bTHREE\.Face3\b/.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "THREE.Face3 was removed years ago (invariant 2) " +
              "(fix: use indexed BufferGeometry attributes instead of Face3 lists)",
          });
        }
        if (/\bTHREE\.JSONLoader\b/.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "THREE.JSONLoader was removed years ago (invariant 2) " +
              "(fix: use GLTFLoader/ObjectLoader; re-export legacy JSON assets to glTF)",
          });
        }
      });
      return findings;
    },
  },

  // --- Invariant 3 (removed API angle): legacy color encoding enums/props. -
  {
    name: "legacy-color-encoding",
    invariant: 3,
    run(text, lines) {
      const findings = [];
      lines.forEach((line, i) => {
        if (/\bsRGBEncoding\b/.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "sRGBEncoding was removed (invariant 3) " +
              "(fix: use `texture.colorSpace = THREE.SRGBColorSpace` / `renderer.outputColorSpace`)",
          });
        }
        if (/\bLinearEncoding\b/.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "LinearEncoding was removed (invariant 3) " +
              "(fix: use `THREE.NoColorSpace` / `THREE.LinearSRGBColorSpace` on data textures)",
          });
        }
        if (/\.outputEncoding\b/.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "renderer.outputEncoding was removed (invariant 3) " +
              "(fix: use `renderer.outputColorSpace = THREE.SRGBColorSpace`)",
          });
        }
        // `.encoding =` assignment on a texture (avoid matching unrelated
        // `.encoding` reads/other objects by requiring an assignment form).
        if (/\.encoding\s*=(?!=)/.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "texture.encoding is removed (invariant 3) " +
              "(fix: use `texture.colorSpace = THREE.SRGBColorSpace` for color textures, leave data textures linear)",
          });
        }
      });
      return findings;
    },
  },

  // --- Invariant 7: WebGPU + ShaderMaterial/onBeforeCompile fork violation. -
  {
    name: "webgpu-shadermaterial-fork",
    invariant: 7,
    run(text, lines) {
      const findings = [];
      const importsWebGPU = /from\s*['"]three\/webgpu['"]/.test(text);
      if (!importsWebGPU) return findings;
      lines.forEach((line, i) => {
        if (/\bShaderMaterial\b/.test(line) || /\bRawShaderMaterial\b/.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "ShaderMaterial/RawShaderMaterial used alongside 'three/webgpu' import (invariant 7 — " +
              "not supported on WebGPURenderer) (fix: use node materials + TSL instead)",
          });
        }
        if (/\bonBeforeCompile\b/.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "onBeforeCompile used alongside 'three/webgpu' import (invariant 7 — GLSL injection " +
              "hooks do not work on WebGPURenderer) (fix: use node materials + TSL instead)",
          });
        }
      });
      return findings;
    },
  },

  // --- Wrong import path: legacy non-module examples. ----------------------
  {
    name: "legacy-examples-js-import",
    invariant: 1,
    run(text, lines) {
      const findings = [];
      lines.forEach((line, i) => {
        if (/from\s*['"]three\/examples\/js\//.test(line) || /require\(\s*['"]three\/examples\/js\//.test(line)) {
          findings.push({
            severity: "ERROR",
            line: i + 1,
            message:
              "import from 'three/examples/js/' (old non-module examples) " +
              "(fix: use 'three/addons/*' — the ESM examples/jsm path)",
          });
        }
      });
      return findings;
    },
  },

  // --- WARN: WebGPURenderer + EffectComposer (old postprocessing stack). ---
  {
    name: "webgpu-effectcomposer-mix",
    invariant: 7,
    run(text, lines) {
      const findings = [];
      const usesWebGPURenderer = /\bWebGPURenderer\b/.test(text);
      const importsEffectComposer = /from\s*['"]three\/addons\/postprocessing\/EffectComposer(?:\.js)?['"]/.test(text);
      if (usesWebGPURenderer && importsEffectComposer) {
        const idx = text.search(/from\s*['"]three\/addons\/postprocessing\/EffectComposer(?:\.js)?['"]/);
        findings.push({
          severity: "WARN",
          line: lineOf(text, idx),
          message:
            "WebGPURenderer used alongside EffectComposer from addons/postprocessing (invariant 7) " +
            "(fix: use the node post-processing stack — PostProcessing + pass nodes — instead)",
        });
      }
      return findings;
    },
  },

  // --- WARN: hand-rolled requestAnimationFrame render loop. ---------------
  {
    name: "raw-raf-render-loop",
    invariant: 4,
    run(text, lines) {
      const findings = [];
      const hasRendererRender = /\brenderer\.render\s*\(/.test(text);
      const hasRAF = /\brequestAnimationFrame\s*\(/.test(text);
      const hasSetAnimationLoop = /\.setAnimationLoop\s*\(/.test(text);
      if (hasRendererRender && hasRAF && !hasSetAnimationLoop) {
        const idx = text.search(/\brequestAnimationFrame\s*\(/);
        findings.push({
          severity: "WARN",
          line: lineOf(text, idx),
          message:
            "hand-rolled requestAnimationFrame render loop calling renderer.render() without " +
            "setAnimationLoop (invariant 4 — setAnimationLoop is REQUIRED for WebGPU/XR) " +
            "(fix: `renderer.setAnimationLoop(animate)` instead of a raw rAF loop)",
        });
      }
      return findings;
    },
  },

  // --- WARN: renderer/texture created but colorSpace never set anywhere. ---
  {
    name: "missing-colorspace-heuristic",
    invariant: 3,
    run(text, lines) {
      const findings = [];
      const createsRenderer = /\bnew\s+THREE\.(WebGLRenderer|WebGPURenderer)\s*\(/.test(text);
      const loadsTexture =
        /\bnew\s+THREE\.TextureLoader\s*\(/.test(text) ||
        /\bnew\s+THREE\.Texture\s*\(/.test(text) ||
        /\.load\s*\(\s*['"][^'"]+\.(png|jpe?g|webp|ktx2|basis|hdr|exr)['"]/i.test(text);
      const setsColorSpace = /\.(colorSpace|outputColorSpace)\s*=/.test(text);
      if ((createsRenderer || loadsTexture) && !setsColorSpace) {
        const idx = createsRenderer
          ? text.search(/\bnew\s+THREE\.(WebGLRenderer|WebGPURenderer)\s*\(/)
          : text.search(/\.load\s*\(|\bnew\s+THREE\.(TextureLoader|Texture)\s*\(/);
        findings.push({
          severity: "WARN",
          line: lineOf(text, idx),
          message:
            "creates a renderer or loads a texture but never sets .colorSpace/.outputColorSpace " +
            "anywhere in this file (invariant 3 heuristic) " +
            "(fix: set `renderer.outputColorSpace = THREE.SRGBColorSpace` and " +
            "`texture.colorSpace = THREE.SRGBColorSpace` on color textures; may be set in another file)",
        });
      }
      return findings;
    },
  },

  // --- INFO: renderer created but no .dispose( call anywhere. -------------
  {
    name: "missing-dispose-heuristic",
    invariant: 6,
    run(text, lines) {
      const findings = [];
      const createsRenderer = /\bnew\s+THREE\.(WebGLRenderer|WebGPURenderer)\s*\(/.test(text);
      const hasDispose = /\.dispose\s*\(/.test(text);
      if (createsRenderer && !hasDispose) {
        const idx = text.search(/\bnew\s+THREE\.(WebGLRenderer|WebGPURenderer)\s*\(/);
        findings.push({
          severity: "INFO",
          line: lineOf(text, idx),
          message:
            "creates a renderer but no .dispose() call found in this file (invariant 6 heuristic) " +
            "(fix: dispose geometries/materials/textures/renderer on teardown — may be handled " +
            "elsewhere, e.g. r3f's automatic cleanup)",
        });
      }
      return findings;
    },
  },

  // --- INFO: PCFSoftShadowMap present — flag for a look, not deprecated. ---
  {
    name: "pcf-soft-shadow-map-note",
    invariant: 5,
    run(text, lines) {
      const findings = [];
      lines.forEach((line, i) => {
        if (/\bPCFSoftShadowMap\b/.test(line)) {
          findings.push({
            severity: "INFO",
            line: i + 1,
            message:
              "PCFSoftShadowMap in use — not deprecated, just flagging for a look " +
              "(confirm this is the intended shadow.type for your renderer path)",
          });
        }
      });
      return findings;
    },
  },
];

function lineOf(text, index) {
  if (index < 0) return 1;
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/**
 * Blank out `//` and block comments so the identifier checks don't fire on
 * documentation. A footgun linter that flags a *comment* explaining "don't use
 * ShaderMaterial on WebGPU" is a false positive that erodes trust in the tool,
 * so every check runs against this code-only view instead of the raw text.
 *
 * The scanner is string-aware: it preserves single-, double-, and template-
 * literal contents verbatim (crucial so `'https://…'` URLs survive for the CDN
 * import check), and it replaces comment characters with spaces while keeping
 * newlines, so byte offsets and line numbers still line up with the original.
 * It does not attempt to parse regex literals (rare in scene code); a `/*`
 * inside a regex is an accepted, low-risk blind spot for a heuristic linter.
 */
function stripComments(text) {
  const out = new Array(text.length);
  let state = "code"; // code | line | block | squote | dquote | template
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    const keep = () => (out[i] = ch);
    const blank = () => (out[i] = ch === "\n" ? "\n" : " ");

    switch (state) {
      case "code":
        if (ch === "/" && next === "/") { state = "line"; blank(); }
        else if (ch === "/" && next === "*") { state = "block"; blank(); }
        else if (ch === "'") { state = "squote"; keep(); }
        else if (ch === '"') { state = "dquote"; keep(); }
        else if (ch === "`") { state = "template"; keep(); }
        else keep();
        break;
      case "line":
        if (ch === "\n") { state = "code"; keep(); }
        else blank();
        break;
      case "block":
        blank();
        if (ch === "*" && next === "/") { out[i + 1] = " "; i++; state = "code"; }
        break;
      case "squote":
        keep();
        if (ch === "\\") { out[i + 1] = text[i + 1]; i++; }
        else if (ch === "'") state = "code";
        break;
      case "dquote":
        keep();
        if (ch === "\\") { out[i + 1] = text[i + 1]; i++; }
        else if (ch === '"') state = "code";
        break;
      case "template":
        keep();
        if (ch === "\\") { out[i + 1] = text[i + 1]; i++; }
        else if (ch === "`") state = "code";
        break;
    }
  }
  return out.join("");
}

function lintFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return {
      findings: [
        {
          severity: "WARN",
          line: 0,
          message: `could not read file (${err.code ?? err.message})`,
        },
      ],
    };
  }
  // Run every check against a comment-stripped view so documentation that
  // names a footgun (to explain why to avoid it) isn't mistaken for usage.
  const code = stripComments(text);
  const lines = code.split("\n");
  const findings = [];
  for (const check of CHECKS) {
    try {
      findings.push(...check.run(code, lines));
    } catch (err) {
      // A single misbehaving check should not crash the whole run.
      findings.push({
        severity: "WARN",
        line: 0,
        message: `internal check '${check.name}' threw (${err.message}); skipped`,
      });
    }
  }
  // Sort by line number for readable output.
  findings.sort((a, b) => a.line - b.line);
  return { findings };
}

const SEVERITY_RANK = { ERROR: 0, WARN: 1, INFO: 2 };

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.paths.length === 0) {
    console.log(HELP);
    process.exit(args.help ? 0 : 2);
  }

  const seen = new Set();
  const files = [];
  for (const p of args.paths) {
    for (const f of collectFiles(p)) {
      if (!seen.has(f)) {
        seen.add(f);
        files.push(f);
      }
    }
  }

  if (files.length === 0) {
    console.error("No lintable files found (looked for .js/.ts/.jsx/.tsx).");
    process.exit(2);
  }

  let errorCount = 0;
  let warnCount = 0;
  let infoCount = 0;
  const cwd = process.cwd();

  for (const file of files.sort()) {
    const { findings } = lintFile(file);
    const displayPath = path.relative(cwd, file) || file;
    for (const f of findings) {
      // Always tally every finding so the summary is accurate, but only
      // print WARN/INFO lines when not in --quiet mode.
      if (f.severity === "ERROR") errorCount++;
      else if (f.severity === "WARN") warnCount++;
      else infoCount++;

      if (f.severity === "ERROR" || !args.quiet) {
        console.log(`${f.severity} ${displayPath}:${f.line} — ${f.message}`);
      }
    }
  }

  console.log("");
  console.log(
    `Summary: ${files.length} file(s) scanned — ${errorCount} error(s), ${warnCount} warning(s), ${infoCount} info.`
  );

  process.exit(errorCount > 0 ? 1 : 0);
}

main();
