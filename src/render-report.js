// render-report.js — the shared, pure HTML renderer.
//
// This module is used by BOTH the Node CLI (bin/cli.js) and the browser demo
// (src/site.ts, via Vite) so the exact same report comes out of a CI run and the
// hosted live demo. It is plain ESM JavaScript with ZERO dependencies and no
// Node/browser-only globals, so it runs unchanged in either environment.
//
// renderReport(results, options) -> a complete, self-contained HTML string
// (inline CSS + JS, no external/CDN requests — the same discipline as
// newman-reporter-htmlextra). The output file renders offline and is safe to
// attach as a CI artifact.

const SEVERITIES = [
  { i: 0, key: 'error', label: 'Errors', one: 'Error', color: '#f14c4c', on: '#5a1a1a' },
  { i: 1, key: 'warn', label: 'Warnings', one: 'Warning', color: '#e3b341', on: '#4a3a10' },
  { i: 2, key: 'info', label: 'Info', one: 'Info', color: '#3794ff', on: '#12335a' },
  { i: 3, key: 'hint', label: 'Hints', one: 'Hint', color: '#9aa0a6', on: '#2b2e31' },
];

const SEV_BY_I = new Map(SEVERITIES.map((s) => [s.i, s]));

function sevMeta(i) {
  return SEV_BY_I.get(i) || SEVERITIES[3];
}

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function basename(p) {
  if (!p) return '';
  const s = String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = s.split('/');
  return parts[parts.length - 1] || s;
}

// Defensively coerce whatever came out of `spectral lint -f json` into a clean,
// predictable shape. Tolerates missing source/range, string severities, and junk.
function normalize(results) {
  const arr = Array.isArray(results) ? results : (results && Array.isArray(results.results) ? results.results : []);
  return arr
    .filter((r) => r && typeof r === 'object')
    .map((r) => {
      let sev = r.severity;
      if (typeof sev === 'string') {
        const map = { error: 0, warn: 1, warning: 1, info: 2, hint: 3 };
        sev = map[sev.toLowerCase()];
      }
      if (typeof sev !== 'number' || !SEV_BY_I.has(sev)) sev = 0; // default unknown → error, fail-safe
      const start = r.range && r.range.start ? r.range.start : {};
      const line = Number.isFinite(start.line) ? start.line : null;
      const character = Number.isFinite(start.character) ? start.character : null;
      const path = Array.isArray(r.path) ? r.path : [];
      return {
        code: r.code != null ? String(r.code) : '(anonymous rule)',
        message: r.message != null ? String(r.message) : '',
        severity: sev,
        source: r.source ? String(r.source) : '',
        file: r.source ? basename(r.source) : '(no source)',
        line,
        character,
        path,
        pathStr: path.length ? path.join(' › ') : '(root)',
      };
    });
}

function tally(issues) {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const it of issues) counts[it.severity]++;
  return counts;
}

// Positive-rule framing. Raw Spectral JSON only lists VIOLATIONS, so to report
// progress ("82% of operations carry a unique id") the caller can supply an
// optional sidecar of per-rule totals. We accept three shapes and degrade
// gracefully (returns [] → no compliance section) when nothing usable is given:
//   • an array:  [{ code|rule, checked, passed, failed }, …]
//   • { rules: { "rule-code": { checked, passed, failed }, … } }
//   • a plain object keyed by rule:  { "rule-code": { checked, passed, failed } }
// `passed` defaults to checked − failed when omitted; `failed` to checked − passed.
function normalizeTotals(totals) {
  if (!totals) return [];
  let entries = [];
  if (Array.isArray(totals)) {
    entries = totals.map((t) => [t && (t.code != null ? t.code : t.rule), t]);
  } else if (typeof totals === 'object') {
    const src = totals.rules && typeof totals.rules === 'object' ? totals.rules : totals;
    entries = Object.entries(src);
  }
  const out = [];
  for (const [code, t] of entries) {
    if (code == null || !t || typeof t !== 'object') continue;
    const checked = Number.isFinite(t.checked) ? t.checked : null;
    let passed = Number.isFinite(t.passed) ? t.passed : null;
    let failed = Number.isFinite(t.failed) ? t.failed : null;
    if (checked == null && passed == null && failed == null) continue;
    if (passed == null && checked != null && failed != null) passed = checked - failed;
    if (failed == null && checked != null && passed != null) failed = checked - passed;
    const total = checked != null ? checked : (passed || 0) + (failed || 0);
    if (!(total > 0)) continue;
    const pass = passed != null ? passed : total - (failed || 0);
    out.push({
      code: String(code),
      checked: total,
      passed: Math.max(0, pass),
      failed: failed != null ? Math.max(0, failed) : Math.max(0, total - pass),
      pct: Math.round((Math.max(0, pass) / total) * 100),
    });
  }
  // Worst compliance first — that's where the work is.
  return out.sort((a, b) => a.pct - b.pct || b.checked - a.checked);
}

// Rank a keyed dimension (rule code / file) by issue volume, worst-severity first.
function ranking(issues, keyFn) {
  const map = new Map();
  for (const it of issues) {
    const k = keyFn(it);
    if (!map.has(k)) map.set(k, { key: k, total: 0, worst: 3 });
    const e = map.get(k);
    e.total++;
    if (it.severity < e.worst) e.worst = it.severity;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.worst - b.worst);
}

/**
 * @param {Array} results  Spectral `--format json` output (array of findings).
 * @param {Object} [options]
 * @param {string} [options.title]        Report title.
 * @param {boolean} [options.dark]        Force dark theme (default: auto/light).
 * @param {string} [options.generatedAt]  ISO timestamp; stamped by the caller at
 *                                         render time — NOT read at module load.
 * @param {Array|Object} [options.totals] Optional positive-rule sidecar of
 *                                         per-rule {checked, passed, failed}
 *                                         totals; adds a compliance scoreboard.
 *                                         Absent → deficit-only (unchanged).
 * @returns {string} a complete standalone HTML document.
 */
export function renderReport(results, options = {}) {
  const opts = {
    title: 'API Governance Report',
    dark: false,
    // new Date() is evaluated only when renderReport is CALLED, never at import.
    generatedAt: new Date().toISOString(),
    totals: null,
    ...options,
  };

  const issues = normalize(results);
  const compliance = normalizeTotals(opts.totals);
  const counts = tally(issues);
  const total = issues.length;
  const errors = counts[0];
  const passed = errors === 0;

  const generated = (() => {
    try {
      return new Date(opts.generatedAt).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return String(opts.generatedAt);
    }
  })();

  const sourceCount = new Set(issues.map((i) => i.source || i.file)).size;

  const topRules = ranking(issues, (i) => i.code).slice(0, 8);
  const topFiles = ranking(issues, (i) => i.file).slice(0, 8);
  const rankMax = Math.max(1, ...topRules.map((r) => r.total), ...topFiles.map((r) => r.total));

  // Stat tiles (severity summary).
  const tiles = SEVERITIES.map((s) => `
      <div class="tile tile-${s.key}" role="listitem">
        <span class="tile-dot" aria-hidden="true"></span>
        <span class="tile-num">${counts[s.i]}</span>
        <span class="tile-label">${s.label}</span>
      </div>`).join('');

  function rankRows(rows) {
    if (!rows.length) return '<p class="empty">Nothing to rank — a clean run.</p>';
    return rows.map((r) => {
      const m = sevMeta(r.worst);
      const pct = Math.round((r.total / rankMax) * 100);
      return `
        <div class="rank-row">
          <code class="rank-key" title="${escapeHtml(r.key)}">${escapeHtml(r.key)}</code>
          <div class="rank-bar"><span style="width:${pct}%;background:${m.color}"></span></div>
          <span class="rank-total">${r.total}</span>
        </div>`;
    }).join('');
  }

  const banner = passed
    ? `<div class="banner pass" role="status">
         <span class="banner-badge">PASS</span>
         <span class="banner-text">${total === 0
           ? 'No issues found — this artifact passes every rule in the ruleset. 🎉'
           : `No errors. ${total} non-blocking finding${total === 1 ? '' : 's'} to review.`}</span>
       </div>`
    : `<div class="banner fail" role="status">
         <span class="banner-badge">FAIL</span>
         <span class="banner-text">${errors} error${errors === 1 ? '' : 's'} must be resolved before this artifact passes governance.</span>
       </div>`;

  // When a run is completely clean, a filter UI over an empty list reads as
  // "broken". Show an unmistakable success state instead.
  const successHero = `
  <section class="success-hero" role="status" aria-label="All checks passed">
    <div class="success-ring" aria-hidden="true">
      <svg viewBox="0 0 52 52" width="78" height="78" role="img">
        <circle class="sh-circle" cx="26" cy="26" r="24"/>
        <path class="sh-check" fill="none" d="M15 27l7 7 15-16"/>
      </svg>
    </div>
    <h2>All clear — passes every check</h2>
    <p>No issues found. This artifact passed <strong>every rule in the ruleset</strong> — nothing to remediate at any severity.</p>
    <div class="sh-scoreline">
      <span class="sh-pill">0 Errors</span><span class="sh-pill">0 Warnings</span><span class="sh-pill">0 Info</span><span class="sh-pill">0 Hints</span>
    </div>
  </section>`;

  // Everything the embedded page-script needs. JSON is safe inside a <script>
  // tag once we neutralize the </script> and HTML-comment sequences.
  const payload = JSON.stringify({ issues, severities: SEVERITIES })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  // Positive-rule framing: an optional compliance scoreboard alongside the
  // deficit list. Renders only when a totals sidecar was supplied.
  const complianceSection = (() => {
    if (!compliance.length) return '';
    const sumChecked = compliance.reduce((a, c) => a + c.checked, 0);
    const sumPassed = compliance.reduce((a, c) => a + c.passed, 0);
    const overall = sumChecked ? Math.round((sumPassed / sumChecked) * 100) : 0;
    const rows = compliance.map((c) => {
      const cls = c.pct >= 90 ? 'good' : c.pct >= 70 ? 'ok' : 'low';
      return `
        <div class="comp-row">
          <code class="comp-key" title="${escapeHtml(c.code)}">${escapeHtml(c.code)}</code>
          <div class="comp-bar comp-${cls}"><span style="width:${c.pct}%"></span></div>
          <span class="comp-pct">${c.pct}%</span>
          <span class="comp-frac">${c.passed}/${c.checked}</span>
        </div>`;
    }).join('');
    return `
  <section class="compliance">
    <div class="comp-head">
      <h2>Compliance</h2>
      <div class="comp-overall"><span class="comp-overall-num">${overall}%</span><span class="comp-overall-label">${sumPassed} of ${sumChecked} checks passing</span></div>
    </div>
    <div class="comp-rows">${rows}</div>
  </section>`;
  })();

  const css = reportCss();
  const script = reportScript();

  return `<!doctype html>
<html lang="en" class="${opts.dark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="@api-common/spectral-reporter">
<title>${escapeHtml(opts.title)}</title>
<style>${css}</style>
</head>
<body>
<div class="wrap">
  <header class="report-head">
    <div class="head-top">
      <div class="head-title">
        <h1>${escapeHtml(opts.title)}</h1>
        <p class="head-meta">Generated ${escapeHtml(generated)} · ${total} issue${total === 1 ? '' : 's'} across ${sourceCount} source${sourceCount === 1 ? '' : 's'}</p>
      </div>
      <button type="button" id="theme-toggle" class="theme-toggle" title="Toggle light / dark">◐ Theme</button>
    </div>
    ${banner}
    <div class="tiles" role="list" aria-label="Findings by severity">${tiles}</div>
  </header>
${complianceSection}
  ${total ? `
  <section class="rankings">
    <div class="rank-card">
      <h2>Top offending rules</h2>
      ${rankRows(topRules)}
    </div>
    <div class="rank-card">
      <h2>Top offending files</h2>
      ${rankRows(topFiles)}
    </div>
  </section>

  <section class="controls" aria-label="Filter findings">
    <input type="search" id="q" placeholder="Search findings — rule, message, file, path…" aria-label="Search findings">
    <div class="group-toggle" role="group" aria-label="Group findings by">
      <span class="ctl-label">Group by</span>
      <button type="button" class="grp active" data-group="code">Rule</button>
      <button type="button" class="grp" data-group="file">File</button>
      <button type="button" class="grp" data-group="severity">Severity</button>
    </div>
    <div class="sev-chips" role="group" aria-label="Filter by severity">
      ${SEVERITIES.map((s) => `<button type="button" class="chip chip-${s.key} on" data-sev="${s.i}" aria-pressed="true"><span class="chip-dot" aria-hidden="true"></span>${s.one}<span class="chip-n" data-chip-n="${s.i}">${counts[s.i]}</span></button>`).join('')}
    </div>
  </section>

  <main id="findings" class="findings" aria-live="polite"></main>` : successHero}

  <footer class="report-foot">
    <span>Report by <a href="https://reporter.apicommons.org" target="_blank" rel="noopener">@api-common/spectral-reporter</a>, an <a href="https://apicommons.org/tools/" target="_blank" rel="noopener">API Commons</a> tool.</span>
    <span>Powered by <a href="https://github.com/stoplightio/spectral" target="_blank" rel="noopener">Spectral</a>. Governance help from <a href="https://apievangelist.com/services/" target="_blank" rel="noopener">API Evangelist</a>.</span>
  </footer>
</div>
<noscript><p style="padding:1rem;color:#f14c4c">This interactive report needs JavaScript to filter and group findings. The full data is embedded below regardless.</p></noscript>
<script id="data" type="application/json">${payload}</script>
<script>${script}</script>
</body>
</html>`;
}

// ---- inline stylesheet (kept as a function so nothing runs at import) --------
function reportCss() {
  return `
:root{
  --bg:#f6f7f9;--panel:#fff;--line:#e2e5ea;--fg:#1c2128;--muted:#616a75;
  --accent:#ffc107;--head:#101418;--code:#f0f2f5;--shadow:0 1px 3px rgba(0,0,0,.08);
  --error:#d1242f;--warn:#9a6700;--info:#0969da;--hint:#616a75;
}
html.dark{
  --bg:#1e1e1e;--panel:#252526;--line:#3a3a3a;--fg:#e6e6e6;--muted:#9aa0a6;
  --head:#181a1c;--code:#2b2b2b;--shadow:0 1px 3px rgba(0,0,0,.5);
  --error:#f14c4c;--warn:#e3b341;--info:#3794ff;--hint:#9aa0a6;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5}
a{color:var(--info);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:"SF Mono",Menlo,Consolas,monospace;font-size:.85em}
.wrap{max-width:1040px;margin:0 auto;padding:1.5rem 1.25rem 3rem}
:focus-visible{outline:2px solid var(--info);outline-offset:2px}

.report-head{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1.25rem 1.35rem;box-shadow:var(--shadow);margin-bottom:1.25rem}
.head-top{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap}
.head-title h1{margin:0;font-size:1.5rem;letter-spacing:-.01em}
.head-meta{margin:.35rem 0 0;color:var(--muted);font-size:.9rem}
.theme-toggle{background:transparent;border:1px solid var(--line);color:var(--muted);border-radius:6px;padding:5px 11px;font-size:.82rem;cursor:pointer}
.theme-toggle:hover{border-color:var(--info);color:var(--fg)}

.banner{display:flex;align-items:center;gap:.75rem;border-radius:9px;padding:.7rem .9rem;margin:1rem 0 1.1rem;border:1px solid transparent}
.banner-badge{font-weight:800;letter-spacing:.06em;font-size:.78rem;padding:3px 9px;border-radius:5px;color:#fff}
.banner.pass{background:rgba(45,164,78,.1);border-color:rgba(45,164,78,.4)}
.banner.pass .banner-badge{background:#2da44e}
.banner.fail{background:rgba(209,36,47,.1);border-color:rgba(209,36,47,.4)}
.banner.fail .banner-badge{background:var(--error)}

.success-hero{background:var(--panel);border:1px solid rgba(45,164,78,.45);border-radius:12px;box-shadow:var(--shadow);padding:2.75rem 1.5rem 2.5rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:.35rem}
.success-ring{width:78px;height:78px;margin-bottom:.35rem}
.sh-circle{fill:rgba(45,164,78,.08);stroke:#2da44e;stroke-width:3;opacity:.55}
.sh-check{stroke:#2da44e;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:40;stroke-dashoffset:40;animation:sh-draw .55s .12s ease forwards}
@keyframes sh-draw{to{stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){.sh-check{animation:none;stroke-dashoffset:0}}
.success-hero h2{margin:.15rem 0 0;font-size:1.5rem;letter-spacing:-.01em;color:#2da44e}
html.dark .success-hero h2{color:#3fb950}
.success-hero p{margin:.1rem 0 .55rem;color:var(--muted);max-width:54ch}
.sh-scoreline{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center}
.sh-pill{font-size:.8rem;font-weight:600;color:#1a7f37;background:rgba(45,164,78,.12);border:1px solid rgba(45,164,78,.32);border-radius:20px;padding:3px 12px}
html.dark .sh-pill{color:#3fb950}
.banner-text{font-size:.95rem}

.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:.65rem}
.tile{display:flex;flex-direction:column;align-items:flex-start;gap:.1rem;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:.7rem .85rem;position:relative}
.tile-dot{width:10px;height:10px;border-radius:50%;position:absolute;top:.8rem;right:.8rem}
.tile-num{font-size:1.7rem;font-weight:700;line-height:1}
.tile-label{font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
.tile-error .tile-dot{background:var(--error)} .tile-error .tile-num{color:var(--error)}
.tile-warn .tile-dot{background:var(--warn)} .tile-warn .tile-num{color:var(--warn)}
.tile-info .tile-dot{background:var(--info)} .tile-info .tile-num{color:var(--info)}
.tile-hint .tile-dot{background:var(--hint)} .tile-hint .tile-num{color:var(--hint)}

.compliance{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1rem 1.25rem;box-shadow:var(--shadow);margin-bottom:1.25rem}
.comp-head{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap;margin-bottom:.7rem}
.comp-head h2{margin:0;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.comp-overall{display:flex;align-items:baseline;gap:.5rem}
.comp-overall-num{font-size:1.5rem;font-weight:800;color:#2da44e;font-variant-numeric:tabular-nums}
.comp-overall-label{color:var(--muted);font-size:.85rem}
.comp-rows{display:flex;flex-direction:column;gap:.4rem}
.comp-row{display:grid;grid-template-columns:minmax(0,1fr) 120px 44px 62px;gap:.6rem;align-items:center}
.comp-key{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)}
.comp-bar{background:var(--code);border-radius:4px;height:9px;overflow:hidden}
.comp-bar span{display:block;height:100%;border-radius:4px}
.comp-good span{background:#2da44e} .comp-ok span{background:var(--warn)} .comp-low span{background:var(--error)}
.comp-pct{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;font-size:.85rem}
.comp-frac{text-align:right;color:var(--muted);font-size:.78rem;font-variant-numeric:tabular-nums}
@media(max-width:560px){.comp-row{grid-template-columns:minmax(0,1fr) 44px}.comp-bar,.comp-frac{display:none}}
.rankings{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.25rem}
.rank-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem;box-shadow:var(--shadow);min-width:0}
.rank-card h2{margin:0 0 .7rem;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.rank-row{display:grid;grid-template-columns:minmax(0,1fr) 90px 28px;gap:.6rem;align-items:center;margin:.35rem 0}
.rank-key{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)}
.rank-bar{background:var(--code);border-radius:4px;height:9px;overflow:hidden}
.rank-bar span{display:block;height:100%;border-radius:4px}
.rank-total{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted);font-size:.85rem}
.empty{color:var(--muted);font-size:.88rem;margin:.2rem 0}

.controls{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center;margin-bottom:1rem}
#q{flex:1 1 240px;min-width:0;background:var(--panel);border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:.55rem .8rem;font-size:.92rem}
#q:focus{outline:none;border-color:var(--info)}
.ctl-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-right:.15rem}
.group-toggle{display:inline-flex;align-items:center;gap:.4rem;border:1px solid var(--line);border-radius:8px;padding:.2rem .35rem;background:var(--panel)}
.grp{background:transparent;border:none;color:var(--muted);border-radius:5px;padding:4px 10px;font-size:.85rem;cursor:pointer;font-weight:600}
.grp.active{background:var(--accent);color:#1e1e1e}
.sev-chips{display:inline-flex;flex-wrap:wrap;gap:.4rem}
.chip{display:inline-flex;align-items:center;gap:.35rem;border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:999px;padding:3px 10px;font-size:.82rem;cursor:pointer;font-weight:600}
.chip-dot{width:9px;height:9px;border-radius:50%;background:currentColor;opacity:.55}
.chip-error{--c:var(--error)} .chip-warn{--c:var(--warn)} .chip-info{--c:var(--info)} .chip-hint{--c:var(--hint)}
.chip.on{color:var(--fg);border-color:var(--c);box-shadow:inset 0 0 0 1px var(--c)}
.chip.on .chip-dot{background:var(--c);opacity:1}
.chip-n{background:var(--code);border-radius:999px;padding:0 6px;font-size:.72rem}

.findings{display:flex;flex-direction:column;gap:.9rem}
.group{background:var(--panel);border:1px solid var(--line);border-radius:11px;box-shadow:var(--shadow);overflow:hidden}
.group>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:.6rem;padding:.7rem .95rem;user-select:none;font-weight:600}
.group>summary::-webkit-details-marker{display:none}
.group>summary::before{content:'▸';color:var(--muted);font-size:.8rem;transition:transform .12s ease}
.group[open]>summary::before{transform:rotate(90deg)}
.group>summary:hover{background:var(--bg)}
.group-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.group-count{color:var(--muted);font-size:.8rem;font-weight:600}
.g-sev{width:10px;height:10px;border-radius:50%;flex:0 0 auto}

.issue{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.6rem;align-items:baseline;padding:.55rem .95rem;border-top:1px solid var(--line);cursor:pointer}
.issue:hover{background:var(--bg)}
.sev-chip{font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border-radius:4px;color:#fff;white-space:nowrap}
.sev-0{background:var(--error)} .sev-1{background:var(--warn);color:#111} .sev-2{background:var(--info)} .sev-3{background:var(--hint)}
.issue-main{min-width:0}
.issue-msg{color:var(--fg)}
.issue-rule{font-size:.78rem;color:var(--muted)}
.issue-rule code{color:var(--info)}
.issue-loc{text-align:right;color:var(--muted);font-size:.78rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.issue-path{grid-column:1 / -1;margin:.35rem 0 .1rem;padding:.5rem .7rem;background:var(--code);border-radius:6px;font-size:.8rem;color:var(--muted);word-break:break-word;display:none}
.issue.open .issue-path{display:block}
.issue-path b{color:var(--fg)}
.no-match{color:var(--muted);text-align:center;padding:2rem;background:var(--panel);border:1px dashed var(--line);border-radius:11px}

.report-foot{margin-top:2rem;padding-top:1rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem;display:flex;flex-direction:column;gap:.25rem}

@media(max-width:720px){
  .tiles{grid-template-columns:repeat(2,1fr)}
  .rankings{grid-template-columns:1fr}
}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;
}

// ---- inline page script (interactivity) --------------------------------------
// Rendered as a string; runs in the report page itself (no build step).
function reportScript() {
  return `(function(){
  var data=JSON.parse(document.getElementById('data').textContent);
  var issues=data.issues, SEV=data.severities;
  var sevKey={},sevOne={};SEV.forEach(function(s){sevKey[s.i]=s.key;sevOne[s.i]=s.one;});
  var state={group:'code',q:'',sev:{0:true,1:true,2:true,3:true}};
  var esc=function(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};

  function match(it){
    if(!state.sev[it.severity])return false;
    if(state.q){
      var q=state.q.toLowerCase();
      var hay=(it.code+' '+it.message+' '+it.file+' '+it.pathStr).toLowerCase();
      if(hay.indexOf(q)<0)return false;
    }
    return true;
  }
  function keyOf(it){
    if(state.group==='file')return it.file;
    if(state.group==='severity')return sevOne[it.severity]+'s';
    return it.code;
  }
  function issueRow(it){
    var loc=(it.line!=null?('Ln '+(it.line+1)+(it.character!=null?':'+(it.character+1):'')):'');
    return '<div class="issue" tabindex="0"><span class="sev-chip sev-'+it.severity+'">'+esc(sevKey[it.severity])+'</span>'
      +'<div class="issue-main"><div class="issue-msg">'+esc(it.message)+'</div>'
      +'<div class="issue-rule"><code>'+esc(it.code)+'</code> · '+esc(it.file)+'</div></div>'
      +'<span class="issue-loc">'+esc(loc)+'</span>'
      +'<div class="issue-path"><b>path</b> · '+esc(it.pathStr)+(it.source?'  —  <b>source</b> '+esc(it.source):'')+'</div></div>';
  }
  function render(){
    var host=document.getElementById('findings');
    var shown=issues.filter(match);
    if(!shown.length){host.innerHTML='<div class="no-match">No findings match the current search and filters.</div>';return;}
    var groups={},order=[];
    shown.forEach(function(it){var k=keyOf(it);if(!groups[k]){groups[k]=[];order.push(k);}groups[k].push(it);});
    // worst severity first, then largest group
    order.sort(function(a,b){
      var wa=Math.min.apply(null,groups[a].map(function(x){return x.severity;}));
      var wb=Math.min.apply(null,groups[b].map(function(x){return x.severity;}));
      return wa-wb || groups[b].length-groups[a].length;
    });
    host.innerHTML=order.map(function(k){
      var g=groups[k];
      var worst=Math.min.apply(null,g.map(function(x){return x.severity;}));
      var color=SEV.filter(function(s){return s.i===worst;})[0].color;
      return '<details class="group" open><summary><span class="g-sev" style="background:'+color+'"></span>'
        +'<span class="group-title">'+esc(k)+'</span><span class="group-count">'+g.length+'</span></summary>'
        +g.map(issueRow).join('')+'</details>';
    }).join('');
  }

  var qEl=document.getElementById('q'),findingsEl=document.getElementById('findings');
  if(qEl&&findingsEl){
    qEl.addEventListener('input',function(e){state.q=e.target.value;render();});
    Array.prototype.forEach.call(document.querySelectorAll('.grp'),function(b){
      b.addEventListener('click',function(){
        document.querySelectorAll('.grp').forEach(function(x){x.classList.remove('active');});
        b.classList.add('active');state.group=b.getAttribute('data-group');render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(b){
      b.addEventListener('click',function(){
        var i=+b.getAttribute('data-sev');state.sev[i]=!state.sev[i];
        b.classList.toggle('on',state.sev[i]);b.setAttribute('aria-pressed',String(state.sev[i]));render();
      });
    });
    findingsEl.addEventListener('click',function(e){
      var row=e.target.closest('.issue');if(row)row.classList.toggle('open');
    });
    findingsEl.addEventListener('keydown',function(e){
      if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('issue')){e.preventDefault();e.target.classList.toggle('open');}
    });
    render();
  }
  var tt=document.getElementById('theme-toggle');
  if(tt)tt.addEventListener('click',function(){document.documentElement.classList.toggle('dark');});
})();`;
}

export default renderReport;
