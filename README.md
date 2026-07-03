# Spectral Reporter

**Turn [Stoplight Spectral](https://github.com/stoplightio/spectral) lint output into a rich, standalone HTML API governance report.**

`@api-common/spectral-reporter` is a post-processor: you feed it Spectral's JSON
output and it emits one self-contained HTML file — inline CSS and JS, no external
or CDN requests — that you can open offline or attach to a CI run. It is directly
inspired by Danny Dainton's
[**newman-reporter-htmlextra**](https://github.com/DannyDainton/newman-reporter-htmlextra),
which does the same thing for Postman/Newman runs.

Live demo and landing page: **[reporter.apicommons.org](https://reporter.apicommons.org)**

One of the [API Commons tools](https://apicommons.org/tools/), alongside
[API Validator](https://validator.apicommons.org),
[API Discovery](https://discover.apicommons.org),
[API Documentation](https://documentation.apicommons.org),
[API Reusability](https://reusability.apicommons.org), and
[MCP Install](https://install.apicommons.org).

## What's in the report

- **Pass/fail governance banner** — fails if there are any errors.
- **Severity stat tiles** — Errors / Warnings / Info / Hints, with reserved,
  always-labelled status colors (never color alone).
- **Group-by toggle** — regroup findings by rule, file, or severity.
- **Search + severity filter chips** — filter the whole report client-side.
- **Per-issue rows** — severity chip, rule code, message, file basename,
  `line:character`; expand a row to see the JSON `path` and source.
- **Top-offending rules & files** — mini bar-rankings so you know where to start.
- Responsive, respects `prefers-reduced-motion`, visible focus states, light/dark.

## Install & usage

Run it with no install:

```bash
# From a Spectral JSON results file
npx @api-common/spectral-reporter spectral-results.json -o governance-report.html

# Or pipe straight from Spectral
spectral lint -f json openapi.yaml | npx @api-common/spectral-reporter -o report.html
```

Or add it to a project:

```bash
npm install --save-dev @api-common/spectral-reporter
```

### Input

Spectral's `--format json` / `-f json` output — a JSON array of findings:

```json
[
  { "code": "operation-operationId",
    "path": ["paths", "/pets", "get", "operationId"],
    "message": "Operation must have \"operationId\".",
    "severity": 1,
    "range": { "start": { "line": 10, "character": 6 }, "end": { "line": 12, "character": 20 } },
    "source": "/abs/path/openapi.yaml" }
]
```

Severity integers: **0 = error, 1 = warn, 2 = info, 3 = hint**. Missing
`source`/`range`, empty arrays (a clean run renders a celebratory "0 issues"
report), and multiple source files are all handled.

### Flags

| Flag | Description |
| --- | --- |
| `-o, --output <file>` | Output path — HTML report, trend report, or SARIF (default `spectral-report.html`) |
| `--sarif <file>` | Also write **SARIF 2.1.0** (for GitHub code scanning) |
| `--format <html\|sarif>` | `sarif` writes SARIF to `-o` / default instead of HTML |
| `--history <dir>` | Render a **trend report** across dated JSON runs in `<dir>` |
| `--trends` | Force trend mode (auto-detected when multiple inputs are given) |
| `--totals <file>` | Positive-rule sidecar → adds a **compliance scoreboard** |
| `--title <text>` | Report title (default `API Governance Report`) |
| `--dark` | Force the dark theme |
| `--open` | Best-effort open the report in your browser |
| `-h, --help` | Show help |
| `--version` | Print version |

## SARIF output — upload findings to GitHub code scanning

The research found only **3.4%** of API teams surface governance findings in
GitHub code scanning. `--sarif` closes that gap: it converts Spectral's JSON to
[**SARIF 2.1.0**](https://sarifweb.azurewebsites.net/) — distinct rules become
`tool.driver.rules`, each finding becomes a `result` (with `ruleId`, a `level`
mapped from severity, and `locations` from `source` + `range`). Severity maps as
**error → error, warn → warning, info/hint → note**; Spectral's 0-based
line/character ranges are converted to SARIF's 1-based regions.

```bash
# Write SARIF only (nothing else) — ideal in a pipe
spectral lint -f json openapi.yaml | npx @api-common/spectral-reporter --sarif results.sarif

# Or write BOTH the HTML report and SARIF by also giving -o
npx @api-common/spectral-reporter spectral.json --sarif results.sarif -o report.html
```

In GitHub Actions, hand the file to `github/codeql-action/upload-sarif` so
findings show up on the Security tab and inline on pull requests:

```yaml
- name: Spectral → SARIF
  run: |
    npx @stoplight/spectral-cli lint -f json openapi.yaml > spectral.json || true
    npx @api-common/spectral-reporter spectral.json --sarif results.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

## Trend / history reports

Feed the reporter **multiple runs** and it renders a trend scoreboard — total
findings over time, a per-severity trend, and which rules **improved** or
**regressed** — the "82% comply, up from 71% last quarter" view.

```bash
# A directory of dated JSON runs (e.g. 2026-Q1.json, 2026-Q2.json …), sorted by name
npx @api-common/spectral-reporter --history runs/ -o trend-report.html

# …or pass the run files positionally, oldest → newest (trend mode auto-detects)
npx @api-common/spectral-reporter q1.json q2.json q3.json -o trend-report.html
```

Each run file is ordinary Spectral `-f json` output; the filename (minus
extension) becomes the run's label on the chart.

## Positive-rule framing — report progress, not just deficits

Raw Spectral JSON only lists **violations**, so it can never say "82% of
operations carry a unique id." Supply an optional **totals sidecar** with
`--totals` and the report adds a compliance scoreboard beside the violation
list. It degrades gracefully — omit the sidecar and you get the deficit-only
report exactly as before.

The sidecar is per-rule `{ checked, passed, failed }`. `passed` defaults to
`checked − failed` and `failed` to `checked − passed`, so you only need two of
the three:

```json
{
  "rules": {
    "operation-operationId":        { "checked": 42, "passed": 34, "failed": 8 },
    "operation-operationId-unique":  { "checked": 42, "passed": 41 },
    "info-license":                  { "checked": 6,  "failed": 5 }
  }
}
```

An array form (`[{ "rule": "…", "checked": …, "passed": … }, …]`) is accepted too.

```bash
npx @api-common/spectral-reporter results.json --totals totals.json -o report.html
```

### In GitHub Actions

```yaml
- name: Lint & report
  run: |
    npx @stoplight/spectral-cli lint -f json openapi.yaml > spectral.json || true
    npx @api-common/spectral-reporter spectral.json -o governance-report.html
- uses: actions/upload-artifact@v4
  with:
    name: api-governance-report
    path: governance-report.html
```

(The `|| true` keeps the step from failing before the report is generated; gate
the build on the report's contents or Spectral's own exit code as you prefer.)

## Use the renderer directly

The HTML rendering is a pure, dependency-free function shared verbatim by the
CLI and the web demo:

```js
import { renderReport } from '@api-common/spectral-reporter';

const html = renderReport(spectralResults, {
  title: 'My API Governance Report',
  dark: false,
  generatedAt: new Date().toISOString(),
  totals: { rules: { 'operation-operationId': { checked: 42, passed: 34 } } }, // optional
});
```

The trend renderer and the SARIF converter are the same pure, dependency-free
modules the CLI and the demo use, exported as subpaths:

```js
import { renderTrends } from '@api-common/spectral-reporter/trends';
import { toSarif }      from '@api-common/spectral-reporter/sarif';

const trendHtml = renderTrends([
  { label: '2026-Q1', results: q1 },
  { label: '2026-Q2', results: q2 },
], { generatedAt: new Date().toISOString() });

const sarifLog = toSarif(spectralResults); // a SARIF 2.1.0 log object
```

## Develop / run locally

```bash
npm install
npm test            # node:test unit tests for the renderer
npm run cli fixtures/spectral-results.json -o /tmp/report.html   # try the CLI
npm run dev         # the landing + live demo site (Vite) at localhost:5173
npm run build       # build the static site into dist/ (what Pages deploys)
```

The demo and the CLI import the same `src/render-report.js`, so what you preview
and download on the site is byte-for-byte what CI produces.

## TODOs (for the human picking this up)

- [ ] **Review + `npm publish` v0.2.0.** The repo is public and `0.1.0` is on
      npm; the SARIF / trends / positive-rule work is committed locally on
      `main` and left for a human to review, bump, and publish. (scope
      `@api-common` is singular — `@api-commons` was taken.)
- [ ] **DNS**: confirm `reporter.apicommons.org` points at GitHub Pages.
- [ ] Add screenshots / social card to this README and the landing page.

## License

[Apache-2.0](./LICENSE) — free and open. A project of
[API Evangelist](https://apievangelist.com), maintained under
[API Commons](https://apicommons.org). API Evangelist offers expert
[governance services](https://apievangelist.com/services/) when you want help.
