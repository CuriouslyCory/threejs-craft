#!/usr/bin/env node
// docs_lookup.mjs — Look up a three.js class/API against the LIVE official docs.
//
// three.js has hundreds of classes and ships breaking changes almost monthly,
// so any signature you're unsure about should be confirmed here rather than
// guessed. As of r185 the docs are LLM-first: every class has a clean markdown
// page at https://threejs.org/docs/pages/<Class>.html.md, there's a machine
// index at docs/search.json, a dedicated TSL reference (docs/TSL.md), and a
// curated llms.txt / llms-full.txt. This tool uses those directly.
//
// Usage:
//   node docs_lookup.mjs <ClassName>        # e.g. GLTFLoader, MeshStandardMaterial
//   node docs_lookup.mjs <query>            # partial/misspelled → suggests matches
//   node docs_lookup.mjs --tsl [topic]      # print the TSL reference (optionally grep a topic)
//   node docs_lookup.mjs --list <query>     # just list matching class names, don't fetch a page
//   node docs_lookup.mjs --help
//
// It's a best-effort HELPER, not a gate (that's validate.mjs). On any network
// failure it prints the canonical URLs to open by hand and exits 0.
//
// Zero external dependencies. Pure Node ESM, Node 18+ (global fetch).

const RAW = "https://raw.githubusercontent.com/mrdoob/three.js/master/docs";
const DOCS_SITE = "https://threejs.org/docs";
const pageUrl = (name) => `${DOCS_SITE}/pages/${name}.html.md`;
const SEARCH_JSON = `${RAW}/search.json`;
const TSL_MD = `${RAW}/TSL.md`;
const LLMS_TXT = `${RAW}/llms.txt`;
const LLMS_FULL = `${RAW}/llms-full.txt`;
const TIMEOUT_MS = 12000;

const HELP = `docs_lookup.mjs — look up a three.js class/API against the live official docs

Usage:
  node docs_lookup.mjs <ClassName>       Fetch the markdown docs page (constructor/methods/props)
  node docs_lookup.mjs <query>           Partial/misspelled name → suggest close class matches
  node docs_lookup.mjs --tsl [topic]     Print the TSL (WebGPU shading) reference; optional topic filter
  node docs_lookup.mjs --list <query>    List matching class names only (don't fetch a page)
  node docs_lookup.mjs --help, -h

Sources (official, current): ${DOCS_SITE}/pages/<Class>.html.md, ${SEARCH_JSON},
${TSL_MD}, ${LLMS_TXT}. Best-effort helper — on network failure it prints URLs and exits 0.`;

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, text: await res.text() };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the unique class-kind titles out of docs/search.json. */
function classTitles(searchJson) {
  const names = new Set();
  for (const bucket of Object.values(searchJson)) {
    if (!Array.isArray(bucket)) continue;
    for (const entry of bucket) {
      if (entry && typeof entry.title === "string" && entry.kind === "class") {
        names.add(entry.title.split("#")[0]);
      }
    }
  }
  return [...names];
}

function printFallback(query) {
  console.log(`\nCould not reach the live docs. Open by hand:`);
  if (query) console.log(`  ${pageUrl(query)}`);
  console.log(`  ${DOCS_SITE}/                 (searchable API reference)`);
  console.log(`  ${LLMS_TXT}   (LLM-oriented index + best practices)`);
  console.log(`  ${LLMS_FULL}  (full LLM docs incl. TSL reference)`);
}

async function runTsl(topic) {
  const res = await fetchText(TSL_MD);
  if (!res.ok) {
    console.error(`Could not fetch TSL.md (${res.status ?? res.error}).`);
    console.log(`Open: ${TSL_MD}\n   or: ${DOCS_SITE}/  (search "TSL")`);
    return 0;
  }
  if (!topic) {
    console.log(res.text);
    return 0;
  }
  // Print each markdown section whose heading or body mentions the topic.
  const lines = res.text.split("\n");
  const rx = new RegExp(topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (current) sections.push(current);
      current = { body: [line] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  const hits = sections.filter((s) => rx.test(s.body.join("\n")));
  if (hits.length === 0) {
    console.log(`No TSL section mentions "${topic}". Print the whole reference with: node docs_lookup.mjs --tsl`);
    return 0;
  }
  for (const h of hits) console.log(h.body.join("\n") + "\n");
  return 0;
}

async function resolveAndPrint(query, listOnly) {
  // 1) Try the page directly with the given casing (three classes are PascalCase).
  if (!listOnly) {
    const direct = await fetchText(pageUrl(query));
    if (direct.ok) {
      console.log(direct.text);
      return 0;
    }
    if (direct.error) {
      // Network problem, not a 404 — fall back to URLs.
      printFallback(query);
      return 0;
    }
  }

  // 2) Use search.json to resolve casing / suggest close matches.
  const idx = await fetchText(SEARCH_JSON);
  if (!idx.ok) {
    printFallback(query);
    return 0;
  }
  let names;
  try {
    names = classTitles(JSON.parse(idx.text));
  } catch {
    printFallback(query);
    return 0;
  }

  const q = query.toLowerCase();
  const exact = names.find((n) => n.toLowerCase() === q);
  if (exact && !listOnly) {
    const page = await fetchText(pageUrl(exact));
    if (page.ok) {
      console.log(page.text);
      return 0;
    }
  }

  const partial = names
    .filter((n) => n.toLowerCase().includes(q))
    .sort((a, b) => a.length - b.length)
    .slice(0, 20);

  if (partial.length === 0) {
    console.log(`No three.js class matches "${query}".`);
    console.log(`Browse the full index at ${DOCS_SITE}/ or ${LLMS_TXT}`);
    return 0;
  }
  console.log(`Matches for "${query}":`);
  for (const n of partial) console.log(`  ${n}  ->  ${pageUrl(n)}`);
  if (!listOnly) console.log(`\nFetch one with: node docs_lookup.mjs ${partial[0]}`);
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }

  if (argv[0] === "--tsl") {
    process.exit(await runTsl(argv[1]));
  }

  let listOnly = false;
  const rest = [];
  for (const a of argv) {
    if (a === "--list") listOnly = true;
    else rest.push(a);
  }
  const query = rest.join(" ").trim();
  if (!query) {
    console.log(HELP);
    process.exit(0);
  }

  process.exit(await resolveAndPrint(query, listOnly));
}

main().catch((err) => {
  console.error(`docs_lookup: unexpected error (${err.message}).`);
  printFallback();
  process.exit(0);
});
