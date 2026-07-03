// The reporter.apicommons.org landing + live demo controller.
// It imports the SAME shared renderer the CLI uses, so the preview and the
// downloaded file are identical to what runs in CI.
import { renderReport } from './render-report.js';
import fixture from '../fixtures/spectral-results.json';
import { initEngage } from './engage';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const titleEl = $<HTMLInputElement>('report-title');
const darkEl = $<HTMLInputElement>('dark-check');
const status = $<HTMLElement>('demo-status');
const preview = $<HTMLIFrameElement>('preview');
const downloadBtn = $<HTMLButtonElement>('download');

let lastHtml = '';
let lastCount = 0;

function setStatus(msg: string, kind: 'ok' | 'err' | '' = '') {
  status.textContent = msg;
  status.className = 'demo-status ' + (kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : 'muted');
}

function generate() {
  const raw = input.value.trim();
  if (!raw) {
    setStatus('Paste Spectral JSON or click “Load sample” first.', 'err');
    return;
  }
  let results: unknown;
  try {
    results = JSON.parse(raw);
  } catch (e) {
    setStatus(`Invalid JSON: ${(e as Error).message}. Did you run Spectral with -f json?`, 'err');
    return;
  }
  lastHtml = renderReport(results, {
    title: titleEl.value || 'API Governance Report',
    dark: darkEl.checked,
    generatedAt: new Date().toISOString(),
  });
  lastCount = Array.isArray(results) ? results.length : 0;
  preview.srcdoc = lastHtml;
  downloadBtn.disabled = false;
  setStatus(`Rendered a report for ${lastCount} finding${lastCount === 1 ? '' : 's'}. Download it, or attach the same output in CI.`, 'ok');
}

function download() {
  if (!lastHtml) return;
  const blob = new Blob([lastHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'governance-report.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

$<HTMLButtonElement>('generate').addEventListener('click', generate);
$<HTMLButtonElement>('load-sample').addEventListener('click', () => {
  input.value = JSON.stringify(fixture, null, 2);
  setStatus('Loaded the bundled sample (17 findings across 3 source files). Click “Generate report”.', 'ok');
  generate();
});
downloadBtn.addEventListener('click', download);
darkEl.addEventListener('change', () => { if (lastHtml) generate(); });

// Engagement front door — context reflects the current demo state.
initEngage(() => {
  const n = lastCount || 'some';
  return `Context: I generated a Spectral Reporter governance report with ${n} findings on reporter.apicommons.org.`;
});
$<HTMLButtonElement>('engage-inline')?.addEventListener('click', () => $<HTMLButtonElement>('engage-ae').click());

// Render an empty-state preview on load so the panel isn't blank.
preview.srcdoc = renderReport([], { title: 'API Governance Report', generatedAt: new Date().toISOString() });
