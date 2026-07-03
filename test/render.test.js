import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderReport } from '../src/render-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  await readFile(join(__dirname, '..', 'fixtures', 'spectral-results.json'), 'utf8')
);

test('renders a complete self-contained HTML document', () => {
  const html = renderReport(fixture, { generatedAt: '2026-07-03T12:00:00Z' });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<\/html>\s*$/i);
  // Self-contained: no external/CDN resources.
  assert.doesNotMatch(html, /https?:\/\/[^"']*\.(css|js)(["'?])/i, 'no external stylesheet/script');
  assert.doesNotMatch(html, /<link[^>]+rel=["']stylesheet/i, 'no <link rel=stylesheet>');
  assert.doesNotMatch(html, /src=["']https?:/i, 'no remote <script src>');
});

test('counts findings by severity correctly', () => {
  const html = renderReport(fixture, { generatedAt: '2026-07-03T12:00:00Z' });
  // Fixture: 6 errors, 7 warnings, 2 info, 2 hints = 17 total.
  assert.match(html, /17 issues across 3 sources/);
  // Stat tiles carry the per-severity numbers.
  assert.match(html, /tile-error[\s\S]*?tile-num">6</);
  assert.match(html, /tile-warn[\s\S]*?tile-num">7</);
  assert.match(html, /tile-info[\s\S]*?tile-num">2</);
  assert.match(html, /tile-hint[\s\S]*?tile-num">2</);
});

test('fails governance when there are errors', () => {
  const html = renderReport(fixture, { generatedAt: '2026-07-03T12:00:00Z' });
  assert.match(html, /banner fail/);
  assert.match(html, /6 errors must be resolved/);
});

test('celebrates a clean run (empty array)', () => {
  const html = renderReport([], { generatedAt: '2026-07-03T12:00:00Z' });
  assert.match(html, /banner pass/);
  assert.match(html, /No issues found/);
  assert.match(html, /0 issues across 0 sources/);
  // No rankings section on a clean run.
  assert.doesNotMatch(html, /Top offending rules/);
});

test('embeds the finding data so the page can filter offline', () => {
  const html = renderReport(fixture, { generatedAt: '2026-07-03T12:00:00Z' });
  assert.match(html, /id="data" type="application\/json"/);
  assert.match(html, /operation-operationId/);
});

test('is defensive about missing source and range', () => {
  const html = renderReport(
    [{ code: 'x', message: 'no source or range', severity: 1 }],
    { generatedAt: '2026-07-03T12:00:00Z' }
  );
  assert.match(html, /1 issue across 1 source/);
  assert.doesNotThrow(() => renderReport([{}], {}));
  assert.doesNotThrow(() => renderReport(null, {}));
  assert.doesNotThrow(() => renderReport({ results: fixture }, {})); // {results:[...]} shape
});

test('escapes HTML in messages (no injection)', () => {
  const html = renderReport(
    [{ code: 'x', message: '<img src=x onerror=alert(1)>', severity: 2, path: [] }],
    { generatedAt: '2026-07-03T12:00:00Z' }
  );
  // The message lives only inside the embedded JSON payload, where `<` and `>`
  // are unicode-escaped so they can never open a real tag / close the script.
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /\\u003cimg src=x/);
});
