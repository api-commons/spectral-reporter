import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderTrends } from '../src/render-trends.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const histDir = join(__dirname, '..', 'fixtures', 'history');

async function loadRuns() {
  const names = ['2026-Q1.json', '2026-Q2.json', '2026-Q3.json'];
  const runs = [];
  for (const n of names) {
    runs.push({ label: n.replace('.json', ''), results: JSON.parse(await readFile(join(histDir, n), 'utf8')) });
  }
  return runs;
}

test('renders a self-contained trend HTML document', async () => {
  const html = renderTrends(await loadRuns(), { generatedAt: '2026-07-03T12:00:00Z' });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<\/html>\s*$/i);
  assert.doesNotMatch(html, /https?:\/\/[^"']*\.(css|js)(["'?])/i, 'no external stylesheet/script');
  assert.doesNotMatch(html, /src=["']https?:/i, 'no remote <script src>');
  assert.match(html, /3 runs/);
});

test('reports the overall improvement from first to last run', async () => {
  // Q1 = 10 findings, Q3 = 3 findings → improving, down 7 (70% fewer).
  const html = renderTrends(await loadRuns(), { generatedAt: '2026-07-03T12:00:00Z' });
  assert.match(html, /IMPROVING/);
  assert.match(html, /from <b>10<\/b>/);
  assert.match(html, /to <b>3<\/b>/);
  assert.match(html, /down 7 \(70% fewer\)/);
});

test('surfaces per-rule improvement and regression', async () => {
  const html = renderTrends(await loadRuns(), { generatedAt: '2026-07-03T12:00:00Z' });
  // operation-operationId went 4 -> 1 (improved by 3).
  assert.match(html, /Rules improving/);
  assert.match(html, /operation-operationId/);
  // owasp rule appeared in Q3 (0 -> 1) → a regression.
  assert.match(html, /Rules regressing/);
  assert.match(html, /owasp:api2:2023-no-api-keys-in-url/);
});

test('accepts bare findings arrays and degrades to a single run', () => {
  const html = renderTrends([[{ code: 'x', message: 'm', severity: 0 }]], { generatedAt: '2026-07-03T12:00:00Z' });
  assert.match(html, /ONE RUN/);
  assert.match(html, /1 run\b/);
});

test('does not throw on empty or junk input', () => {
  assert.doesNotThrow(() => renderTrends([], {}));
  assert.doesNotThrow(() => renderTrends(null, {}));
  assert.match(renderTrends([], { generatedAt: '2026-07-03T12:00:00Z' }), /NO RUNS/);
});

test('timestamp is taken from the passed option, not module load', async () => {
  const runs = await loadRuns();
  const a = renderTrends(runs, { generatedAt: '2020-06-15T12:00:00Z' });
  const b = renderTrends(runs, { generatedAt: '2024-06-15T12:00:00Z' });
  assert.match(a, /Generated Jun 1[45], 2020/); // day may shift by TZ, year is stable
  assert.match(b, /Generated Jun 1[45], 2024/);
  assert.notEqual(a, b);
});
