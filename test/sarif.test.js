import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toSarif } from '../src/to-sarif.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, '..', 'fixtures');
const fixture = JSON.parse(await readFile(join(fixtures, 'spectral-results.json'), 'utf8'));

test('produces a valid SARIF 2.1.0 log shape', () => {
  const sarif = toSarif(fixture);
  assert.equal(sarif.version, '2.1.0');
  assert.match(sarif.$schema, /sarif-2\.1\.0\.json$/);
  assert.equal(sarif.runs.length, 1);
  const run = sarif.runs[0];
  assert.ok(run.tool.driver, 'has tool.driver');
  assert.ok(Array.isArray(run.tool.driver.rules), 'driver.rules is an array');
  assert.ok(Array.isArray(run.results), 'results is an array');
  // One result per finding, one rule per DISTINCT code.
  assert.equal(run.results.length, fixture.length);
  const distinctCodes = new Set(fixture.map((f) => f.code)).size;
  assert.equal(run.tool.driver.rules.length, distinctCodes);
});

test('maps severity to SARIF level (error/warning/note)', () => {
  const sarif = toSarif([
    { code: 'e', message: 'err', severity: 0 },
    { code: 'w', message: 'warn', severity: 1 },
    { code: 'i', message: 'info', severity: 2 },
    { code: 'h', message: 'hint', severity: 3 },
    { code: 's', message: 'string-sev', severity: 'warning' },
    { code: 'u', message: 'unknown', severity: 99 },
  ]);
  const levels = sarif.runs[0].results.map((r) => r.level);
  assert.deepEqual(levels, ['error', 'warning', 'note', 'note', 'warning', 'error']);
  // Rule defaultConfiguration.level mirrors first-seen severity.
  const byId = Object.fromEntries(sarif.runs[0].tool.driver.rules.map((r) => [r.id, r.defaultConfiguration.level]));
  assert.equal(byId.e, 'error');
  assert.equal(byId.h, 'note');
});

test('links results to rules by index and id', () => {
  const sarif = toSarif(fixture);
  const rules = sarif.runs[0].tool.driver.rules;
  for (const res of sarif.runs[0].results) {
    assert.equal(rules[res.ruleIndex].id, res.ruleId, 'ruleIndex resolves to ruleId');
  }
});

test('converts 0-based Spectral range to 1-based SARIF region', () => {
  const sarif = toSarif([
    { code: 'x', message: 'm', severity: 0, source: '/abs/openapi.yaml', range: { start: { line: 22, character: 6 }, end: { line: 24, character: 20 } } },
  ]);
  const loc = sarif.runs[0].results[0].locations[0].physicalLocation;
  assert.equal(loc.artifactLocation.uri, '/abs/openapi.yaml');
  assert.deepEqual(loc.region, { startLine: 23, startColumn: 7, endLine: 25, endColumn: 21 });
});

test('omits locations when there is no source, strips file:// scheme', () => {
  const noSrc = toSarif([{ code: 'x', message: 'm', severity: 1 }]);
  assert.equal(noSrc.runs[0].results[0].locations, undefined);
  const fileUrl = toSarif([{ code: 'x', message: 'm', severity: 1, source: 'file:///work/api.yaml' }]);
  assert.equal(fileUrl.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, '/work/api.yaml');
});

test('tolerates junk input without throwing', () => {
  assert.doesNotThrow(() => toSarif(null));
  assert.doesNotThrow(() => toSarif({ results: fixture }));
  assert.equal(toSarif([]).runs[0].results.length, 0);
});

test('matches the committed SARIF golden fixture', async () => {
  const golden = JSON.parse(await readFile(join(fixtures, 'spectral.sarif'), 'utf8'));
  assert.deepEqual(toSarif(fixture), golden);
});
