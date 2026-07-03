// The reporter.apicommons.org landing + live demo controller.
// It imports the SAME shared modules the CLI uses (render-report, render-trends,
// to-sarif), so the preview and the downloaded files are identical to what runs
// in CI.
import { renderReport } from './render-report.js';
import { renderTrends } from './render-trends.js';
import { toSarif } from './to-sarif.js';
import fixture from '../fixtures/spectral-results.json';
import q1 from '../fixtures/history/2026-Q1.json';
import q2 from '../fixtures/history/2026-Q2.json';
import q3 from '../fixtures/history/2026-Q3.json';
import { initEngage } from './engage';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const titleEl = $<HTMLInputElement>('report-title');
const darkEl = $<HTMLInputElement>('dark-check');
const status = $<HTMLElement>('demo-status');
const preview = $<HTMLIFrameElement>('preview');
const downloadBtn = $<HTMLButtonElement>('download');
const sarifBtn = $<HTMLButtonElement>('download-sarif');
const modeReportBtn = $<HTMLButtonElement>('mode-report');
const modeTrendBtn = $<HTMLButtonElement>('mode-trend');

type Mode = 'report' | 'trend';
let mode: Mode = 'report';
let lastHtml = '';
let lastCount = 0;
let lastResults: unknown = null; // parsed single-run findings (for SARIF export)

function setStatus(msg: string, kind: 'ok' | 'err' | '' = '') {
  status.textContent = msg;
  status.className = 'demo-status ' + (kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : 'muted');
}

// In trend mode the input is an array whose elements are runs (each a bare
// findings array or { label, results }). A pasted flat findings array is
// treated as a single run so the preview still renders.
function toRuns(parsed: unknown): unknown[] {
  if (!Array.isArray(parsed)) return [parsed];
  const first = parsed[0] as Record<string, unknown> | undefined;
  if (first && typeof first === 'object' && !Array.isArray(first) && 'code' in first) {
    return [parsed]; // a flat findings array → one run
  }
  return parsed;
}

function generate() {
  const raw = input.value.trim();
  if (!raw) {
    setStatus('Paste Spectral JSON or click “Load sample” first.', 'err');
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    setStatus(`Invalid JSON: ${(e as Error).message}. Did you run Spectral with -f json?`, 'err');
    return;
  }

  if (mode === 'trend') {
    const runs = toRuns(parsed);
    lastResults = null;
    sarifBtn.disabled = true;
    lastHtml = renderTrends(runs, {
      title: titleEl.value && titleEl.value !== 'API Governance Report' ? titleEl.value : 'API Governance Trend Report',
      dark: darkEl.checked,
      generatedAt: new Date().toISOString(),
    });
    lastCount = runs.length;
    preview.srcdoc = lastHtml;
    downloadBtn.disabled = false;
    setStatus(`Rendered a trend report across ${lastCount} run${lastCount === 1 ? '' : 's'}. Download it, or produce the same with \`--history\` in CI.`, 'ok');
    return;
  }

  lastResults = parsed;
  lastHtml = renderReport(parsed, {
    title: titleEl.value || 'API Governance Report',
    dark: darkEl.checked,
    generatedAt: new Date().toISOString(),
  });
  lastCount = Array.isArray(parsed) ? parsed.length : 0;
  preview.srcdoc = lastHtml;
  downloadBtn.disabled = false;
  sarifBtn.disabled = false;
  setStatus(`Rendered a report for ${lastCount} finding${lastCount === 1 ? '' : 's'}. Download the HTML or SARIF, or attach the same output in CI.`, 'ok');
}

function downloadBlob(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function download() {
  if (!lastHtml) return;
  downloadBlob(lastHtml, 'text/html', mode === 'trend' ? 'governance-trend-report.html' : 'governance-report.html');
}

function downloadSarif() {
  if (lastResults == null) return;
  const sarif = toSarif(lastResults, {});
  downloadBlob(JSON.stringify(sarif, null, 2), 'application/json', 'results.sarif');
}

function setMode(next: Mode) {
  mode = next;
  modeReportBtn.classList.toggle('active', next === 'report');
  modeTrendBtn.classList.toggle('active', next === 'trend');
  modeReportBtn.setAttribute('aria-pressed', String(next === 'report'));
  modeTrendBtn.setAttribute('aria-pressed', String(next === 'trend'));
  sarifBtn.hidden = next !== 'report';
  downloadBtn.disabled = true;
  sarifBtn.disabled = true;
  lastHtml = '';
  input.value = '';
  if (next === 'trend') {
    preview.srcdoc = renderTrends([], { title: 'API Governance Trend Report', generatedAt: new Date().toISOString() });
    setStatus('Trend mode: paste an array of runs (each a findings array or {label, results}), or click “Load sample”.');
  } else {
    preview.srcdoc = renderReport([], { title: 'API Governance Report', generatedAt: new Date().toISOString() });
    setStatus('Paste Spectral -f json output, or click “Load sample”.');
  }
}

function loadSample() {
  if (mode === 'trend') {
    input.value = JSON.stringify([
      { label: '2026-Q1', results: q1 },
      { label: '2026-Q2', results: q2 },
      { label: '2026-Q3', results: q3 },
    ], null, 2);
    setStatus('Loaded 3 dated sample runs (10 → 6 → 3 findings). Click “Generate report”.', 'ok');
  } else {
    input.value = JSON.stringify(fixture, null, 2);
    setStatus('Loaded the bundled sample (17 findings across 3 source files). Click “Generate report”.', 'ok');
  }
  generate();
}

$<HTMLButtonElement>('generate').addEventListener('click', generate);
$<HTMLButtonElement>('load-sample').addEventListener('click', loadSample);
downloadBtn.addEventListener('click', download);
sarifBtn.addEventListener('click', downloadSarif);
modeReportBtn.addEventListener('click', () => setMode('report'));
modeTrendBtn.addEventListener('click', () => setMode('trend'));
darkEl.addEventListener('change', () => { if (lastHtml) generate(); });

// Engagement front door — context reflects the current demo state.
initEngage(() => {
  const n = lastCount || 'some';
  return mode === 'trend'
    ? `Context: I generated a Spectral Reporter TREND report across ${n} runs on reporter.apicommons.org.`
    : `Context: I generated a Spectral Reporter governance report with ${n} findings on reporter.apicommons.org.`;
});
$<HTMLButtonElement>('engage-inline')?.addEventListener('click', () => $<HTMLButtonElement>('engage-ae').click());

// Render an empty-state preview on load so the panel isn't blank.
preview.srcdoc = renderReport([], { title: 'API Governance Report', generatedAt: new Date().toISOString() });
