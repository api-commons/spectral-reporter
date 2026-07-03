#!/usr/bin/env node
// @api-common/spectral-reporter — turn Spectral lint output into a rich,
// standalone HTML API governance report. Inspired by newman-reporter-htmlextra.
//
// Usage:
//   spectral-reporter <spectral-results.json> -o governance-report.html
//   spectral lint -f json openapi.yaml | spectral-reporter -o report.html
//   spectral lint -f json openapi.yaml | spectral-reporter --sarif results.sarif
//   spectral-reporter --history runs/ -o trend-report.html
//   spectral-reporter run1.json run2.json run3.json -o trend-report.html
//   spectral-reporter results.json --totals totals.json -o report.html
//
// Flags:
//   -o, --output <file>   output path (HTML report, trend report, or SARIF)
//       --sarif <file>    also write SARIF 2.1.0 (for GitHub code scanning)
//       --format <fmt>    html | sarif  (sarif → write SARIF to -o/default)
//       --history <dir>   render a TREND report across dated JSON runs in <dir>
//       --trends          force trend mode (auto when multiple inputs given)
//       --totals <file>   positive-rule sidecar → compliance scoreboard
//       --title <text>    report title
//       --dark            force the dark theme
//       --open            best-effort open the report in the browser
//   -h, --help            show help
//       --version         print version

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, basename, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { renderReport } from '../src/render-report.js';
import { renderTrends } from '../src/render-trends.js';
import { toSarif } from '../src/to-sarif.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = {
    inputs: [], output: null, sarif: null, format: null, history: null,
    trends: false, totals: null, title: 'API Governance Report',
    dark: false, open: false, help: false, version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-o': case '--output': opts.output = argv[++i]; break;
      case '--sarif': opts.sarif = argv[++i]; break;
      case '--format': opts.format = (argv[++i] || '').toLowerCase(); break;
      case '--history': opts.history = argv[++i]; break;
      case '--trends': opts.trends = true; break;
      case '--totals': opts.totals = argv[++i]; break;
      case '--title': opts.title = argv[++i]; break;
      case '--dark': opts.dark = true; break;
      case '--open': opts.open = true; break;
      case '-h': case '--help': opts.help = true; break;
      case '--version': opts.version = true; break;
      default:
        if (a && a.startsWith('-')) { console.error(`Unknown flag: ${a}`); process.exit(2); }
        else opts.inputs.push(a);
    }
  }
  return opts;
}

function help() {
  console.log(`spectral-reporter — Spectral JSON → standalone HTML governance report, SARIF, or trend report

Usage:
  spectral-reporter <spectral-results.json> [-o report.html]
  spectral lint -f json openapi.yaml | spectral-reporter -o report.html
  spectral lint -f json openapi.yaml | spectral-reporter --sarif results.sarif
  spectral-reporter --history runs/ -o trend-report.html
  spectral-reporter run1.json run2.json run3.json -o trend-report.html

Flags:
  -o, --output <file>   output path (HTML report, trend report, or SARIF)
      --sarif <file>    also write SARIF 2.1.0 for GitHub code scanning
      --format <fmt>    html | sarif  (sarif → write SARIF to -o / default)
      --history <dir>   render a TREND report across dated JSON runs in <dir>
      --trends          force trend mode (auto when multiple inputs given)
      --totals <file>   positive-rule sidecar → adds a compliance scoreboard
      --title <text>    report title (default: "API Governance Report")
      --dark            force the dark theme
      --open            best-effort open the report in your browser
  -h, --help            show this help
      --version         print version`);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function pkgVersion() {
  try {
    const raw = await readFile(join(__dirname, '..', 'package.json'), 'utf8');
    return JSON.parse(raw).version || '0.0.0';
  } catch { return '0.0.0'; }
}

function openInBrowser(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [file], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
  } catch { /* best-effort only */ }
}

function parseJson(raw, whatFor) {
  try {
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (e) {
    console.error(`Could not parse ${whatFor} as JSON: ${e.message}`);
    console.error('Make sure you ran Spectral with `-f json` / `--format json`.');
    process.exit(1);
  }
}

function countOf(results) {
  return Array.isArray(results) ? results.length : (results && results.results || []).length;
}

// Read one Spectral JSON file into a { label, results } run.
async function readRunFile(file) {
  const raw = await readFile(resolve(file), 'utf8');
  return { label: basename(file, extname(file)), results: parseJson(raw, file) };
}

async function runTrends(opts) {
  const runs = [];
  if (opts.history) {
    const dir = resolve(opts.history);
    const names = (await readdir(dir))
      .filter((n) => n.toLowerCase().endsWith('.json'))
      .sort(); // dated filenames (e.g. 2026-Q1.json) sort oldest→newest
    if (!names.length) {
      console.error(`No .json run files found in ${dir}.`);
      process.exit(1);
    }
    for (const n of names) runs.push(await readRunFile(join(dir, n)));
  }
  for (const f of opts.inputs) runs.push(await readRunFile(f));

  const html = renderTrends(runs, {
    title: opts.title === 'API Governance Report' ? 'API Governance Trend Report' : opts.title,
    dark: opts.dark,
    generatedAt: new Date().toISOString(),
  });
  const outPath = resolve(opts.output || 'spectral-trend-report.html');
  await writeFile(outPath, html, 'utf8');
  console.error(`✓ Wrote ${outPath} (trend across ${runs.length} run${runs.length === 1 ? '' : 's'})`);
  if (opts.open) openInBrowser(outPath);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { help(); return; }
  if (opts.version) { console.log(await pkgVersion()); return; }

  // Trend mode: an explicit --trends/--history, or more than one input file.
  if (opts.trends || opts.history || opts.inputs.length > 1) {
    await runTrends(opts);
    return;
  }

  // Single-run modes (HTML report and/or SARIF).
  let raw;
  if (opts.inputs.length === 1) {
    raw = await readFile(resolve(opts.inputs[0]), 'utf8');
  } else if (!process.stdin.isTTY) {
    raw = await readStdin();
  } else {
    console.error('No input. Pass a Spectral JSON file or pipe `spectral lint -f json …`.\n');
    help();
    process.exit(2);
  }
  const results = parseJson(raw, 'input');

  const formatSarif = opts.format === 'sarif';
  const wantSarif = opts.sarif != null || formatSarif;

  if (wantSarif) {
    const sarif = toSarif(results, {});
    // With --format sarif, -o names the SARIF file; with --sarif, it's explicit.
    const sarifPath = resolve(opts.sarif || opts.output || 'spectral.sarif');
    await writeFile(sarifPath, JSON.stringify(sarif, null, 2), 'utf8');
    const n = sarif.runs[0].results.length;
    console.error(`✓ Wrote ${sarifPath} (SARIF 2.1.0, ${n} result${n === 1 ? '' : 's'})`);
  }

  // Write the HTML report unless the user asked only for SARIF. `--sarif <file>`
  // alone (e.g. piped in CI) writes SARIF only; add `-o` to also emit HTML.
  const writeHtml = !formatSarif && !(opts.sarif != null && opts.output == null);
  if (writeHtml) {
    let totals = null;
    if (opts.totals) totals = parseJson(await readFile(resolve(opts.totals), 'utf8'), 'totals sidecar');

    const html = renderReport(results, {
      title: opts.title,
      dark: opts.dark,
      generatedAt: new Date().toISOString(),
      totals,
    });
    const outPath = resolve(opts.output || 'spectral-report.html');
    await writeFile(outPath, html, 'utf8');
    const count = countOf(results);
    console.error(`✓ Wrote ${outPath} (${count} finding${count === 1 ? '' : 's'})`);
    if (opts.open) openInBrowser(outPath);
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
