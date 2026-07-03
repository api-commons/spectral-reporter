// to-sarif.js — the shared, pure Spectral-JSON → SARIF 2.1.0 converter.
//
// Like src/render-report.js, this is plain ESM JavaScript with ZERO
// dependencies and no Node/browser-only globals, so the exact same conversion
// runs in the CLI and in the hosted browser demo. It returns a plain JS object
// (the SARIF log); callers JSON.stringify it however they like.
//
// SARIF 2.1.0 is the format GitHub code scanning ingests, so this lets teams
// upload governance findings to the Security tab and see them inline on PRs —
// something the research found only 3.4% of API teams do today.
//
// Mapping:
//   rules    -> runs[0].tool.driver.rules   (one per distinct Spectral rule code)
//   findings -> runs[0].results             (ruleId + ruleIndex, level, locations)
//   severity -> level:  0 error -> "error", 1 warn -> "warning",
//                       2 info  -> "note",  3 hint -> "note"
//   range    -> physicalLocation.region     (Spectral is 0-based; SARIF is 1-based)
//   source   -> physicalLocation.artifactLocation.uri

// Spectral severity integer -> SARIF result level.
const LEVEL_BY_SEVERITY = { 0: 'error', 1: 'warning', 2: 'note', 3: 'note' };

// Tolerant coercion of a raw Spectral finding's severity to 0..3 (matches the
// renderer: unknown severities fail safe to error).
function coerceSeverity(sev) {
  if (typeof sev === 'string') {
    const map = { error: 0, warn: 1, warning: 1, info: 2, hint: 3 };
    sev = map[sev.toLowerCase()];
  }
  if (typeof sev !== 'number' || !(sev in LEVEL_BY_SEVERITY)) return 0;
  return sev;
}

// Turn a Spectral `source` (often an absolute path or a file:// URL) into a
// SARIF artifactLocation URI. GitHub prefers repo-relative paths, so we strip a
// leading file:// scheme and a leading slash; callers wanting a different base
// can post-process. Returns null when there is no usable source.
function toUri(source) {
  if (!source) return null;
  let s = String(source).replace(/\\/g, '/');
  s = s.replace(/^file:\/\//i, '');
  return s;
}

// Spectral ranges are 0-based (line/character); SARIF regions are 1-based
// (startLine/startColumn). Only emit fields we actually have.
function toRegion(range) {
  if (!range || typeof range !== 'object') return null;
  const region = {};
  const start = range.start || {};
  const end = range.end || {};
  if (Number.isFinite(start.line)) region.startLine = start.line + 1;
  if (Number.isFinite(start.character)) region.startColumn = start.character + 1;
  if (Number.isFinite(end.line)) region.endLine = end.line + 1;
  if (Number.isFinite(end.character)) region.endColumn = end.character + 1;
  return Object.keys(region).length ? region : null;
}

/**
 * Convert Spectral `--format json` output into a SARIF 2.1.0 log object.
 *
 * @param {Array|Object} results  Spectral findings (array, or `{results:[...]}`).
 * @param {Object} [options]
 * @param {string} [options.toolName]        driver.name (default "Spectral").
 * @param {string} [options.toolVersion]     driver.version (Spectral's version).
 * @param {string} [options.informationUri]  driver.informationUri.
 * @returns {Object} a SARIF 2.1.0 log (plain object, ready to JSON.stringify).
 */
export function toSarif(results, options = {}) {
  const opts = {
    toolName: 'Spectral',
    toolVersion: undefined,
    informationUri: 'https://github.com/stoplightio/spectral',
    ...options,
  };

  const arr = Array.isArray(results)
    ? results
    : results && Array.isArray(results.results) ? results.results : [];

  // First pass: collect distinct rules in first-seen order, remembering the
  // first severity observed per rule as its defaultConfiguration.level.
  const ruleIndex = new Map(); // code -> index
  const rules = [];
  const sarifResults = [];

  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const code = r.code != null ? String(r.code) : '(anonymous rule)';
    const severity = coerceSeverity(r.severity);
    const level = LEVEL_BY_SEVERITY[severity];

    if (!ruleIndex.has(code)) {
      ruleIndex.set(code, rules.length);
      rules.push({
        id: code,
        name: code,
        shortDescription: { text: r.message != null ? String(r.message) : code },
        defaultConfiguration: { level },
        helpUri: 'https://docs.stoplight.io/docs/spectral/',
      });
    }

    const result = {
      ruleId: code,
      ruleIndex: ruleIndex.get(code),
      level,
      message: { text: r.message != null ? String(r.message) : '' },
    };

    const uri = toUri(r.source);
    if (uri) {
      const physicalLocation = { artifactLocation: { uri } };
      const region = toRegion(r.range);
      if (region) physicalLocation.region = region;
      result.locations = [{ physicalLocation }];
    }

    // Preserve Spectral's JSON path for traceability.
    if (Array.isArray(r.path) && r.path.length) {
      result.properties = { path: r.path.map(String) };
    }

    sarifResults.push(result);
  }

  const driver = {
    name: opts.toolName,
    informationUri: opts.informationUri,
    rules,
  };
  if (opts.toolVersion) driver.version = String(opts.toolVersion);

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver },
        results: sarifResults,
      },
    ],
  };
}

export default toSarif;
