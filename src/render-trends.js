// render-trends.js — the shared, pure trend/history renderer.
//
// Companion to src/render-report.js. Where that renders ONE Spectral run, this
// renders a SEQUENCE of dated runs into a single self-contained HTML trend
// report — the "82% comply, up from 71% last quarter" scoreboard: total
// findings over time, a per-severity trend, and which rules got better or worse.
//
// Plain ESM JavaScript, ZERO dependencies, no Node/browser-only globals, so the
// exact same output comes out of the CLI and the hosted browser demo. Inline
// CSS + JS, no external/CDN requests — same discipline as render-report.js.
// The generatedAt timestamp is stamped by the CALLER at render time, never read
// at module load.

const SEVERITIES = [
  { i: 0, key: 'error', label: 'Errors', one: 'Error', color: '#f14c4c' },
  { i: 1, key: 'warn', label: 'Warnings', one: 'Warning', color: '#e3b341' },
  { i: 2, key: 'info', label: 'Info', one: 'Info', color: '#3794ff' },
  { i: 3, key: 'hint', label: 'Hints', one: 'Hint', color: '#9aa0a6' },
];
const SEV_KEYS = new Set([0, 1, 2, 3]);

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function coerceSeverity(sev) {
  if (typeof sev === 'string') {
    const map = { error: 0, warn: 1, warning: 1, info: 2, hint: 3 };
    sev = map[sev.toLowerCase()];
  }
  if (typeof sev !== 'number' || !SEV_KEYS.has(sev)) return 0;
  return sev;
}

// Coerce one run's raw Spectral results into per-severity counts + per-rule counts.
function summarizeRun(results) {
  const arr = Array.isArray(results)
    ? results
    : results && Array.isArray(results.results) ? results.results : [];
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const byRule = new Map();
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    const sev = coerceSeverity(r.severity);
    counts[sev]++;
    const code = r.code != null ? String(r.code) : '(anonymous rule)';
    byRule.set(code, (byRule.get(code) || 0) + 1);
  }
  const total = counts[0] + counts[1] + counts[2] + counts[3];
  return { counts, byRule, total };
}

// Accept a run as either a bare findings array or `{ label, generatedAt, results }`.
function normalizeRuns(runs) {
  const list = Array.isArray(runs) ? runs : [];
  return list.map((run, idx) => {
    let label, generatedAt, results;
    if (Array.isArray(run)) {
      results = run;
    } else if (run && typeof run === 'object' && !('code' in run)) {
      label = run.label;
      generatedAt = run.generatedAt || run.date;
      results = run.results != null ? run.results : run;
    } else {
      results = run;
    }
    const s = summarizeRun(results);
    return {
      label: label != null ? String(label) : `Run ${idx + 1}`,
      generatedAt: generatedAt || null,
      ...s,
    };
  });
}

/**
 * Render a trend report across multiple Spectral runs.
 *
 * @param {Array} runs  Ordered oldest→newest. Each item is either a bare
 *                      Spectral findings array, or `{ label, generatedAt, results }`.
 * @param {Object} [options]
 * @param {string} [options.title]        Report title.
 * @param {boolean} [options.dark]        Force dark theme.
 * @param {string} [options.generatedAt]  ISO timestamp; stamped by the caller.
 * @returns {string} a complete standalone HTML document.
 */
export function renderTrends(runs, options = {}) {
  const opts = {
    title: 'API Governance Trend Report',
    dark: false,
    generatedAt: new Date().toISOString(),
    ...options,
  };

  const series = normalizeRuns(runs);
  const generated = (() => {
    try {
      return new Date(opts.generatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    } catch { return String(opts.generatedAt); }
  })();

  // Degrade gracefully: fewer than two runs still renders, just without deltas.
  const first = series[0];
  const last = series[series.length - 1];
  const totalDelta = first && last ? last.total - first.total : 0;
  const improving = totalDelta < 0;
  const pctChange = first && first.total > 0
    ? Math.round((Math.abs(totalDelta) / first.total) * 100)
    : 0;

  // Per-rule first→last comparison (improvement = fewer findings).
  const allRules = new Set();
  series.forEach((r) => r.byRule.forEach((_, code) => allRules.add(code)));
  const ruleDeltas = [...allRules].map((code) => {
    const start = first ? (first.byRule.get(code) || 0) : 0;
    const end = last ? (last.byRule.get(code) || 0) : 0;
    return { code, start, end, delta: end - start };
  });
  const improved = ruleDeltas.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta);
  const regressed = ruleDeltas.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta);

  const maxTotal = Math.max(1, ...series.map((r) => r.total));

  // --- summary banner -------------------------------------------------------
  const banner = series.length < 2
    ? `<div class="banner flat" role="status">
         <span class="banner-badge">${series.length === 1 ? 'ONE RUN' : 'NO RUNS'}</span>
         <span class="banner-text">${series.length === 1
           ? `${last.total} finding${last.total === 1 ? '' : 's'} in this run. Provide multiple dated runs to see the trend.`
           : 'No runs supplied.'}</span>
       </div>`
    : `<div class="banner ${improving ? 'good' : totalDelta === 0 ? 'flat' : 'bad'}" role="status">
         <span class="banner-badge">${improving ? 'IMPROVING' : totalDelta === 0 ? 'FLAT' : 'REGRESSING'}</span>
         <span class="banner-text">Total findings went from <b>${first.total}</b> (${escapeHtml(first.label)}) to <b>${last.total}</b> (${escapeHtml(last.label)}) — ${
           totalDelta === 0 ? 'no net change' : `${improving ? 'down' : 'up'} ${Math.abs(totalDelta)} (${pctChange}% ${improving ? 'fewer' : 'more'})`
         }.</span>
       </div>`;

  // --- totals-over-time stacked bars ---------------------------------------
  const bars = series.map((r) => {
    const segs = SEVERITIES.map((s) => {
      const n = r.counts[s.i];
      if (!n) return '';
      const h = Math.round((n / maxTotal) * 100);
      return `<span class="seg" style="height:${h}%;background:${s.color}" title="${escapeHtml(r.label)}: ${n} ${s.label.toLowerCase()}"></span>`;
    }).join('');
    return `
      <div class="bar-col">
        <div class="bar-stack">${segs || '<span class="seg seg-zero" title="0 findings"></span>'}</div>
        <div class="bar-total">${r.total}</div>
        <div class="bar-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</div>
      </div>`;
  }).join('');

  // --- per-severity trend rows ---------------------------------------------
  const sevRows = SEVERITIES.map((s) => {
    const cells = series.map((r) => `<span class="spark-cell" title="${escapeHtml(r.label)}: ${r.counts[s.i]}">${r.counts[s.i]}</span>`).join('');
    const startN = first ? first.counts[s.i] : 0;
    const endN = last ? last.counts[s.i] : 0;
    const d = endN - startN;
    const dLabel = series.length < 2 ? '' : d === 0 ? '±0' : (d < 0 ? `▼ ${Math.abs(d)}` : `▲ ${d}`);
    const dClass = d < 0 ? 'good' : d > 0 ? 'bad' : 'flat';
    return `
      <div class="sev-row">
        <span class="sev-name"><span class="sev-dot" style="background:${s.color}"></span>${s.label}</span>
        <span class="spark">${cells}</span>
        <span class="sev-delta ${dClass}">${dLabel}</span>
      </div>`;
  }).join('');

  // --- rule change tables ---------------------------------------------------
  function ruleTable(rows, kind) {
    if (!rows.length) {
      return `<p class="empty">${kind === 'improved' ? 'No rules improved yet.' : 'No rules regressed — nice.'}</p>`;
    }
    return rows.slice(0, 12).map((r) => `
      <div class="rule-row">
        <code class="rule-key" title="${escapeHtml(r.code)}">${escapeHtml(r.code)}</code>
        <span class="rule-change">${r.start} → ${r.end}</span>
        <span class="rule-delta ${kind === 'improved' ? 'good' : 'bad'}">${kind === 'improved' ? '▼' : '▲'} ${Math.abs(r.delta)}</span>
      </div>`).join('');
  }

  const payload = JSON.stringify({
    series: series.map((r) => ({ label: r.label, generatedAt: r.generatedAt, total: r.total, counts: r.counts })),
  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

  return `<!doctype html>
<html lang="en" class="${opts.dark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="@api-common/spectral-reporter (trends)">
<title>${escapeHtml(opts.title)}</title>
<style>${trendsCss()}</style>
</head>
<body>
<div class="wrap">
  <header class="report-head">
    <div class="head-top">
      <div class="head-title">
        <h1>${escapeHtml(opts.title)}</h1>
        <p class="head-meta">Generated ${escapeHtml(generated)} · ${series.length} run${series.length === 1 ? '' : 's'}</p>
      </div>
      <button type="button" id="theme-toggle" class="theme-toggle" title="Toggle light / dark">◐ Theme</button>
    </div>
    ${banner}
  </header>

  <section class="panel">
    <h2>Total findings over time</h2>
    <div class="bars" role="img" aria-label="Total findings per run, stacked by severity">${bars || '<p class="empty">No runs to chart.</p>'}</div>
    <div class="legend">${SEVERITIES.map((s) => `<span class="leg"><span class="leg-dot" style="background:${s.color}"></span>${s.label}</span>`).join('')}</div>
  </section>

  <section class="panel">
    <h2>Per-severity trend</h2>
    <div class="sev-head"><span class="sev-name">Severity</span><span class="spark">${series.map((r) => `<span class="spark-cell head" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span>`).join('')}</span><span class="sev-delta">Δ</span></div>
    ${sevRows}
  </section>

  <section class="rule-tables">
    <div class="panel">
      <h2>Rules improving</h2>
      ${ruleTable(improved, 'improved')}
    </div>
    <div class="panel">
      <h2>Rules regressing</h2>
      ${ruleTable(regressed, 'regressed')}
    </div>
  </section>

  <footer class="report-foot">
    <span>Trend report by <a href="https://reporter.apicommons.org" target="_blank" rel="noopener">@api-common/spectral-reporter</a>, an <a href="https://apicommons.org/tools/" target="_blank" rel="noopener">API Commons</a> tool.</span>
    <span>Powered by <a href="https://github.com/stoplightio/spectral" target="_blank" rel="noopener">Spectral</a>. Governance help from <a href="https://apievangelist.com/services/" target="_blank" rel="noopener">API Evangelist</a>.</span>
  </footer>
</div>
<script id="trend-data" type="application/json">${payload}</script>
<script>${trendsScript()}</script>
</body>
</html>`;
}

function trendsCss() {
  return `
:root{
  --bg:#f6f7f9;--panel:#fff;--line:#e2e5ea;--fg:#1c2128;--muted:#616a75;
  --accent:#ffc107;--code:#f0f2f5;--shadow:0 1px 3px rgba(0,0,0,.08);
  --good:#2da44e;--bad:#d1242f;--info:#0969da;
}
html.dark{
  --bg:#1e1e1e;--panel:#252526;--line:#3a3a3a;--fg:#e6e6e6;--muted:#9aa0a6;
  --code:#2b2b2b;--shadow:0 1px 3px rgba(0,0,0,.5);
  --good:#3fb950;--bad:#f14c4c;--info:#3794ff;
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

.banner{display:flex;align-items:center;gap:.75rem;border-radius:9px;padding:.7rem .9rem;margin:1rem 0 0;border:1px solid transparent}
.banner-badge{font-weight:800;letter-spacing:.06em;font-size:.78rem;padding:3px 9px;border-radius:5px;color:#fff}
.banner-text{font-size:.95rem}
.banner-text b{font-variant-numeric:tabular-nums}
.banner.good{background:rgba(45,164,78,.1);border-color:rgba(45,164,78,.4)} .banner.good .banner-badge{background:var(--good)}
.banner.bad{background:rgba(209,36,47,.1);border-color:rgba(209,36,47,.4)} .banner.bad .banner-badge{background:var(--bad)}
.banner.flat{background:var(--code);border-color:var(--line)} .banner.flat .banner-badge{background:var(--muted)}

.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1.1rem 1.25rem;box-shadow:var(--shadow);margin-bottom:1.25rem;min-width:0}
.panel h2{margin:0 0 .9rem;font-size:.82rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.empty{color:var(--muted);font-size:.88rem;margin:.2rem 0}

.bars{display:flex;align-items:flex-end;gap:1rem;height:200px;padding:.5rem 0}
.bar-col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;height:100%}
.bar-stack{flex:1;width:70%;max-width:64px;display:flex;flex-direction:column-reverse;justify-content:flex-start;border-radius:5px 5px 0 0;overflow:hidden}
.seg{display:block;width:100%}
.seg-zero{height:3px;background:var(--line)!important;margin-top:auto}
.bar-total{font-weight:700;font-variant-numeric:tabular-nums;margin-top:.35rem;font-size:.95rem}
.bar-label{font-size:.76rem;color:var(--muted);margin-top:.15rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
.legend{display:flex;flex-wrap:wrap;gap:.9rem;margin-top:.6rem;padding-top:.7rem;border-top:1px solid var(--line)}
.leg{display:inline-flex;align-items:center;gap:.35rem;font-size:.78rem;color:var(--muted)}
.leg-dot{width:10px;height:10px;border-radius:2px}

.sev-head,.sev-row{display:grid;grid-template-columns:150px minmax(0,1fr) 60px;gap:.6rem;align-items:center;padding:.35rem 0}
.sev-row{border-top:1px solid var(--line)}
.sev-head{color:var(--muted);font-size:.74rem;text-transform:uppercase;letter-spacing:.05em}
.sev-name{display:inline-flex;align-items:center;gap:.4rem;font-size:.9rem}
.sev-dot{width:10px;height:10px;border-radius:50%;flex:0 0 auto}
.spark{display:flex;gap:.4rem;min-width:0;overflow-x:auto}
.spark-cell{flex:1 1 0;min-width:34px;text-align:center;font-variant-numeric:tabular-nums;background:var(--code);border-radius:5px;padding:.25rem .3rem;font-size:.88rem}
.spark-cell.head{background:transparent;color:var(--muted);font-size:.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sev-delta{text-align:right;font-variant-numeric:tabular-nums;font-size:.85rem;font-weight:600}
.sev-delta.good,.rule-delta.good{color:var(--good)}
.sev-delta.bad,.rule-delta.bad{color:var(--bad)}
.sev-delta.flat{color:var(--muted)}

.rule-tables{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem}
.rule-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:.7rem;align-items:center;margin:.3rem 0;padding:.15rem 0}
.rule-key{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)}
.rule-change{color:var(--muted);font-size:.82rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.rule-delta{font-weight:700;font-size:.85rem;white-space:nowrap}

.report-foot{margin-top:1rem;padding-top:1rem;border-top:1px solid var(--line);color:var(--muted);font-size:.82rem;display:flex;flex-direction:column;gap:.25rem}

@media(max-width:720px){
  .rule-tables{grid-template-columns:1fr}
  .sev-head,.sev-row{grid-template-columns:110px minmax(0,1fr) 48px}
}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;
}

function trendsScript() {
  return `(function(){
  var tt=document.getElementById('theme-toggle');
  if(tt)tt.addEventListener('click',function(){document.documentElement.classList.toggle('dark');});
})();`;
}

export default renderTrends;
