#!/usr/bin/env node
// @api-common/spectral-reporter — turn Spectral lint output into a rich,
// standalone HTML API governance report. Inspired by newman-reporter-htmlextra.
//
// Usage:
//   spectral-reporter <spectral-results.json> -o governance-report.html
//   spectral lint -f json openapi.yaml | spectral-reporter -o report.html
//
// Flags:
//   -o, --output <file>   output HTML path (default: spectral-report.html)
//       --title <text>    report title
//       --dark            force the dark theme
//       --open            best-effort open the report in the browser
//   -h, --help            show help
//       --version         print version

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { renderReport } from '../src/render-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { input: null, output: 'spectral-report.html', title: 'API Governance Report', dark: false, open: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-o': case '--output': opts.output = argv[++i]; break;
      case '--title': opts.title = argv[++i]; break;
      case '--dark': opts.dark = true; break;
      case '--open': opts.open = true; break;
      case '-h': case '--help': opts.help = true; break;
      case '--version': opts.version = true; break;
      default:
        if (a && a.startsWith('-')) { console.error(`Unknown flag: ${a}`); process.exit(2); }
        else if (!opts.input) opts.input = a;
        else { console.error(`Unexpected argument: ${a}`); process.exit(2); }
    }
  }
  return opts;
}

function help() {
  console.log(`spectral-reporter — Spectral JSON → standalone HTML governance report

Usage:
  spectral-reporter <spectral-results.json> [-o report.html]
  spectral lint -f json openapi.yaml | spectral-reporter -o report.html

Flags:
  -o, --output <file>   output HTML path (default: spectral-report.html)
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { help(); return; }
  if (opts.version) { console.log(await pkgVersion()); return; }

  let raw;
  if (opts.input) {
    raw = await readFile(resolve(opts.input), 'utf8');
  } else if (!process.stdin.isTTY) {
    raw = await readStdin();
  } else {
    console.error('No input. Pass a Spectral JSON file or pipe `spectral lint -f json …`.\n');
    help();
    process.exit(2);
  }

  let results;
  try {
    results = raw.trim() ? JSON.parse(raw) : [];
  } catch (e) {
    console.error(`Could not parse input as JSON: ${e.message}`);
    console.error('Make sure you ran Spectral with `-f json` / `--format json`.');
    process.exit(1);
  }

  const html = renderReport(results, {
    title: opts.title,
    dark: opts.dark,
    generatedAt: new Date().toISOString(),
  });

  const outPath = resolve(opts.output);
  await writeFile(outPath, html, 'utf8');

  const count = Array.isArray(results) ? results.length : (results.results || []).length;
  console.error(`✓ Wrote ${outPath} (${count} finding${count === 1 ? '' : 's'})`);

  if (opts.open) openInBrowser(outPath);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
