import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderReport } from '../src/render-report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, '..', 'fixtures');
const findings = JSON.parse(await readFile(join(fixtures, 'spectral-results.json'), 'utf8'));
const totals = JSON.parse(await readFile(join(fixtures, 'totals.json'), 'utf8'));

test('degrades gracefully (no compliance section) when no totals given', () => {
  const html = renderReport(findings, { generatedAt: '2026-07-03T12:00:00Z' });
  assert.doesNotMatch(html, /class="compliance"/);
  assert.doesNotMatch(html, />Compliance</);
});

test('renders a compliance scoreboard when a totals sidecar is supplied', () => {
  const html = renderReport(findings, { generatedAt: '2026-07-03T12:00:00Z', totals });
  assert.match(html, /class="compliance"/);
  // operation-operationId: 34/42 passed = 81%.
  assert.match(html, /operation-operationId[\s\S]*?81%/);
  assert.match(html, /34\/42/);
});

test('computes per-rule compliance math from partial fields', () => {
  // passed defaults to checked - failed; failed defaults to checked - passed.
  const html = renderReport([], {
    generatedAt: '2026-07-03T12:00:00Z',
    totals: {
      rules: {
        'only-failed': { checked: 10, failed: 3 },   // → 70%
        'only-passed': { checked: 8, passed: 6 },     // → 75%
        'perfect': { checked: 5, passed: 5, failed: 0 }, // → 100%
      },
    },
  });
  assert.match(html, /only-failed[\s\S]*?70%/);
  assert.match(html, /only-passed[\s\S]*?75%/);
  assert.match(html, /perfect[\s\S]*?100%/);
});

test('computes the overall compliance percentage across rules', () => {
  const html = renderReport([], {
    generatedAt: '2026-07-03T12:00:00Z',
    totals: { rules: { a: { checked: 10, passed: 8 }, b: { checked: 10, passed: 2 } } },
  });
  // (8 + 2) / (10 + 10) = 50%.
  assert.match(html, /comp-overall-num">50%/);
  assert.match(html, /10 of 20 checks passing/);
});

test('accepts an array sidecar shape too', () => {
  const html = renderReport([], {
    generatedAt: '2026-07-03T12:00:00Z',
    totals: [{ rule: 'x', checked: 4, passed: 3 }],
  });
  assert.match(html, /class="compliance"/);
  assert.match(html, /x[\s\S]*?75%/);
});

test('ignores empty / malformed sidecar entries without throwing', () => {
  assert.doesNotThrow(() => renderReport([], { totals: { rules: { a: {}, b: null } } }));
  const html = renderReport([], { generatedAt: '2026-07-03T12:00:00Z', totals: { rules: { a: {}, b: null } } });
  assert.doesNotMatch(html, /class="compliance"/); // nothing usable → section omitted
});
