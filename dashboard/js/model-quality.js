// =============================================================================
// BloomNet Model Quality — MQI composite dashboard
// Panels: score card, behavioral catalog, keywords, trend, version comparison,
//         hourly thinking depth, stop hook violations
// =============================================================================

import { formatPercent, toISODate, BIO_COLORS, CYBER_COLORS, TOKEN_COLORS } from './utils.js?v=20260416';

// -- Custom tooltip manager --
// One floating div reused across all tooltip triggers.
let _tooltipEl = null;
function _ensureTooltip() {
  if (_tooltipEl) return _tooltipEl;
  _tooltipEl = document.createElement('div');
  _tooltipEl.style.cssText = [
    'position:fixed',
    'z-index:10000',
    'max-width:320px',
    'padding:8px 10px',
    'background:rgba(20,24,32,0.97)',
    'border:1px solid #30363d',
    'border-radius:6px',
    'color:#c8c8c0',
    'font-family:var(--font-mono)',
    'font-size:12px',
    'line-height:1.4',
    'box-shadow:0 4px 12px rgba(0,0,0,0.4)',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 120ms ease',
    'white-space:normal',
  ].join(';');
  document.body.appendChild(_tooltipEl);
  return _tooltipEl;
}
function attachTooltip(el, text) {
  if (!text) return;
  el.setAttribute('data-tooltip', text);
  el.style.cursor = 'help';
  el.addEventListener('mouseenter', (ev) => {
    const t = _ensureTooltip();
    t.textContent = text;
    const rect = ev.currentTarget.getBoundingClientRect();
    const top = rect.top - 8;
    const left = Math.min(rect.left, window.innerWidth - 340);
    t.style.top = `${Math.max(8, top)}px`;
    t.style.left = `${Math.max(8, left)}px`;
    t.style.transform = 'translateY(-100%)';
    t.style.opacity = '1';
  });
  el.addEventListener('mouseleave', () => {
    if (_tooltipEl) _tooltipEl.style.opacity = '0';
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METRIC_LABELS = [
  'Read:Edit Ratio','Research:Mutation','Thinking Depth','Edits w/o Read',
  'Write:Edit Ratio','Reasoning Loops','Simplest Fix','Premature Stopping',
  'User Interrupts','Repeated Edits','Self-Admitted Failures','Keyword Sentiment',
  'Stop Hook Violations','Zero-Reasoning Turns','Reversion Rate','Post-Compaction Drift',
  'Human Time Estimation','Re-Instruction Rate',
  'Incident Exposure','Issue Velocity','Redaction Rate',
  'Implicit Constraint Violator','Trial-and-Error Debugging',
  'Token Rate (tok/min)',  // [23]
];
const HIGHER_IS_BETTER = [
  true,true,true,false,false,false,false,false,false,false,false,true,
  false,false,false,false,false,false,
  false,false,false,false,false,
  true,  // [23] token_rate higher = better
];
const COMP_KEYS = [
  'read_edit_ratio','research_mutation_ratio','thinking_depth',
  'edits_without_read','write_edit_ratio','reasoning_loops',
  'simplest_fix','premature_stopping','user_interrupts',
  'repeated_edits','self_admitted_failures','keyword_sentiment',
  'stop_hook_violations','zero_reasoning_turn_rate','reversion_rate',
  'post_compaction_drift','human_time_estimation','re_instruction_rate',
  'incident_exposure','issue_velocity','redaction_rate',
  'implicit_constraint_violator','trial_and_error_debugging',
  'token_rate_per_minute',  // [23]
];

// ---------------------------------------------------------------------------
// Radar: group definitions and metric descriptions
// ---------------------------------------------------------------------------

const METRIC_GROUPS = [
  {
    name: 'Thinking',
    weight: 0.19,
    metrics: ['thinking_depth', 'reasoning_loops', 'zero_reasoning_turn_rate', 'redaction_rate'],
  },
  {
    name: 'Research',
    weight: 0.16,
    metrics: ['read_edit_ratio', 'research_mutation_ratio', 'simplest_fix'],
  },
  {
    name: 'Execution',
    weight: 0.23,
    metrics: [
      'edits_without_read', 'write_edit_ratio', 'repeated_edits', 'reversion_rate',
      'post_compaction_drift', 'stop_hook_violations',
      'premature_stopping', 'human_time_estimation', 'trial_and_error_debugging',
    ],
  },
  {
    name: 'Trust',
    weight: 0.18,
    metrics: [
      'user_interrupts', 'keyword_sentiment', 're_instruction_rate',
      'implicit_constraint_violator', 'self_admitted_failures',
    ],
  },
  {
    name: 'Throughput',
    weight: 0.05,
    metrics: ['token_rate_per_minute'],
  },
  {
    name: 'Environment',
    weight: 0.19,
    metrics: ['incident_exposure', 'issue_velocity'],
  },
];

const METRIC_DESCRIPTIONS = {
  thinking_depth: "Mean character length of assistant thinking + response blocks. Direct proxy for cognitive depth per turn. Higher = more thinking.",
  reasoning_loops: "Count per 1k tool calls of phrases like 'oh wait', 'actually', 'let me reconsider'. Signals confused backtracking. Lower = better.",
  zero_reasoning_turn_rate: "Fraction of assistant turns with no thinking block at all. Higher = model skipping reasoning. Lower = better.",
  redaction_rate: "Fraction of thinking blocks with a signature but < 50 chars of content (Anthropic's redacted-thinking pattern, #42796). Lower = better.",
  read_edit_ratio: "File reads per file edit. Investigation density before mutation. Higher = better.",
  research_mutation_ratio: "(reads + searches + greps) per edit. Broader research-before-action signal. Higher = better.",
  simplest_fix: "Count per 1k tool calls of phrases 'simplest fix', 'easy fix', 'quick fix'. Signals low-effort solution choice. Lower = better.",
  edits_without_read: "Count per 1k of edits to files not read in the last 10 events. Risky mutation. Lower = better.",
  write_edit_ratio: "Write operations per edit. Surgical edits > wholesale rewrites. Lower = better.",
  repeated_edits: "Same-file 3+ consecutive edits without a read in between, per 1k tool calls. Lower = better.",
  reversion_rate: "Count per 1k of git revert/reset/restore/stash-drop commands. Undoing own work. Lower = better.",
  post_compaction_drift: "Post-compaction mean response length / pre-compaction. Values < 1.0 = coherence drop after compact. Higher = better.",
  stop_hook_violations: "Count per 1k of phrases blocked by bloomnet-stop-guard.sh (ownership dodging, premature stop, etc). Lower = better.",
  premature_stopping: "Count per 1k of phrases 'good stopping point', 'natural checkpoint', 'pause here'. Stopping before work is done. Lower = better.",
  human_time_estimation: "Count per 1k of phrases 'this will take weeks', 'too complex to', 'beyond the scope'. Deflection by time. Lower = better.",
  trial_and_error_debugging: "Count per 1k of repeated Bash-error pairs with same command stem within 6-event window. Spinning without diagnosing. Lower = better.",
  user_interrupts: "Count per 1k of user ESC interrupts (Request interrupted by user). Direct friction signal. Lower = better.",
  keyword_sentiment: "User's positive-word to negative-word ratio (capped at 10). Higher = happier user.",
  re_instruction_rate: "Count per 1k of phrases 'I already said', 'I told you', 'like I said'. User repeating themselves. Lower = better.",
  implicit_constraint_violator: "Count per 1k of phrases 'I said not to', 'stop doing that', 'don't do that'. User correcting broken constraints. Lower = better.",
  self_admitted_failures: "Count per 1k of model phrases 'lazy', 'sloppy', 'my bad', 'rushed'. Self-acknowledged quality issues. Lower = better.",
  incident_exposure: "Fraction of this session's duration overlapping active status.claude.com incidents affecting your model. Lower = better.",
  issue_velocity: "Current 7-day count of [MODEL]-labeled GitHub issues on anthropics/claude-code divided by baseline 7-day mean. 1.0 = Jan-era normal. Lower = better.",
  token_rate_per_minute: "Non-cache tokens (input + output) per minute of active session time. Excludes cache_read and cache_creation. Higher = model producing faster / more responsive.",
};

// Hour labels 12a, 1a, ... 11a, 12p, 1p, ... 11p
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
});

// ---------------------------------------------------------------------------
// Dark chart defaults
// ---------------------------------------------------------------------------

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: {
      grid: { color: '#333' },
      ticks: { color: '#888', font: { size: 10 } },
    },
    y: {
      grid: { color: '#333' },
      ticks: { color: '#888', font: { size: 10 } },
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mqiColor(mqi) {
  const score = mqi * 100;
  if (score >= 80) return 'var(--bio-growth, #1D9E75)';
  if (score >= 60) return 'var(--cyber-warning, #d29922)';
  return 'var(--bio-bug, #ef4444)';
}

function statusColor(status) {
  switch (status) {
    case 'error':   return 'var(--bio-bug, #ef4444)';
    case 'warning': return '#d29922';
    case 'watch':   return '#d4a24c';
    case 'green':   return 'var(--bio-growth, #1D9E75)';
    default:        return 'var(--cyber-text-dim, #666)';
  }
}

function makeEl(tag, styleText, textContent) {
  const el = document.createElement(tag);
  if (styleText) el.style.cssText = styleText;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

function computeSigmaBands(dailyValues) {
  if (dailyValues.length < 2) return null;
  const n = dailyValues.length;
  const mean = dailyValues.reduce((a, b) => a + b, 0) / n;
  const variance = dailyValues.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
  const stdev = Math.sqrt(variance);
  return {
    mean,
    stdev,
    sigma1Low: mean - stdev,
    sigma1High: mean + stdev,
    sigma2Low: mean - 2 * stdev,  // warning threshold
    sigma2High: mean + 2 * stdev,
    sigma3Low: mean - 3 * stdev,  // error threshold
    sigma3High: mean + 3 * stdev,
  };
}

function destroyChart(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

function makeCanvas(id, height, ariaLabel) {
  const canvas = document.createElement('canvas');
  canvas.id = id;
  canvas.style.height = `${height || 220}px`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', ariaLabel || id.replace(/[-_]/g, ' '));
  return canvas;
}

function sectionHeader(text) {
  const h = document.createElement('h3');
  h.textContent = text;
  h.style.cssText = [
    'font-family: var(--font-mono)',
    'font-size: var(--font-size-sm, 13px)',
    'font-weight: 700',
    'color: var(--cyber-text-bright, #c8c8c0)',
    'margin: 0 0 12px 0',
    'letter-spacing: 0.05em',
    'text-transform: uppercase',
  ].join(';');
  return h;
}

function panelDiv(extraStyle) {
  const div = document.createElement('div');
  const base = [
    'background: var(--cyber-surface-1, #161b22)',
    'border: 1px solid var(--cyber-border, #21262d)',
    'border-radius: 8px',
    'padding: var(--space-md, 16px)',
  ];
  if (extraStyle) base.push(extraStyle);
  div.style.cssText = base.join(';');
  return div;
}

function emptyState(msg) {
  const p = document.createElement('p');
  p.textContent = msg;
  p.style.cssText = [
    'color: var(--cyber-text-dim, #666)',
    'font-size: var(--font-size-sm, 13px)',
    'text-align: center',
    'padding: 32px 0',
    'margin: 0',
  ].join(';');
  return p;
}

function clearNode(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

// ---------------------------------------------------------------------------
// Radar helper functions
// ---------------------------------------------------------------------------

// Given a metrics array (from a SessionSnapshot), compute a group's z-score
// as the weight-normalized mean of member metrics' z-scores.
function groupZ(metricsArr, group) {
  const members = metricsArr.filter(m => group.metrics.includes(m.name));
  const totalW = members.reduce((s, m) => s + (m.weight || 0), 0);
  if (totalW <= 0 || members.length === 0) return 0;
  return members.reduce((s, m) => s + (m.z || 0) * (m.weight || 0), 0) / totalW;
}

// For each group, find [min, max] of groupZ across all daily entries PLUS the
// current and baseline values themselves. Including current+baseline guarantees
// both polygons stay on-chart even when a session is more extreme than any
// historical daily aggregate (degraded or improved beyond observed range).
function computeGroupRanges(daily, groups, currentGroupZ, baselineGroupZ) {
  const ranges = groups.map(() => ({ min: Infinity, max: -Infinity }));
  for (const d of daily || []) {
    if (!d.metrics || !d.metrics.length) continue;
    for (let g = 0; g < groups.length; g++) {
      const z = groupZ(d.metrics, groups[g]);
      if (z < ranges[g].min) ranges[g].min = z;
      if (z > ranges[g].max) ranges[g].max = z;
    }
  }
  // Ensure current and baseline values are always inside the range.
  for (let g = 0; g < groups.length; g++) {
    const cv = currentGroupZ ? currentGroupZ[g] : null;
    const bv = baselineGroupZ ? baselineGroupZ[g] : null;
    if (typeof cv === 'number' && isFinite(cv)) {
      if (cv < ranges[g].min) ranges[g].min = cv;
      if (cv > ranges[g].max) ranges[g].max = cv;
    }
    if (typeof bv === 'number' && isFinite(bv)) {
      if (bv < ranges[g].min) ranges[g].min = bv;
      if (bv > ranges[g].max) ranges[g].max = bv;
    }
  }
  // Handle the degenerate case: if min >= max, expand to +-1 to avoid div-by-zero.
  return ranges.map(r => {
    if (!isFinite(r.min) || !isFinite(r.max) || r.max - r.min < 1e-9) {
      return { min: -1, max: 1 };
    }
    return r;
  });
}

// Normalize a group-z value to [0.15, 1] where 0.15 = worst observed, 1 = best observed.
// The floor at 0.15 (not 0) prevents the "current" polygon from collapsing to the origin
// when its value equals the observed min — worst-case polygons should still have visible
// area so users can read the shape.
function normalizeGroupZ(z, range) {
  if (range.max - range.min < 1e-9) return 0.575;  // midpoint of [0.15, 1.0]
  const raw = (z - range.min) / (range.max - range.min);
  return 0.15 + 0.85 * Math.max(0, Math.min(1, raw));
}

// ---------------------------------------------------------------------------
// Panel 1: MQI Score Card
// ---------------------------------------------------------------------------

function renderScoreCard(container, mq) {
  const panel = panelDiv('display:flex;gap:32px;align-items:center;flex-wrap:wrap;');
  container.appendChild(panel);
  const cur = mq.currentMqi;
  const score = (cur.mqiX ?? 50).toFixed(1);
  const z = (cur.compositeZ ?? 0).toFixed(2);
  const status = cur.status || 'green';

  const scoreBlock = makeEl('div', 'display:flex;flex-direction:column;gap:4px;min-width:140px;');
  scoreBlock.appendChild(makeEl('div',
    'font-family:var(--font-mono);font-size:11px;color:var(--cyber-text-dim,#666);text-transform:uppercase;letter-spacing:0.1em;',
    'MQI-X'));
  scoreBlock.appendChild(makeEl('div',
    `font-family:var(--font-mono);font-size:56px;font-weight:900;line-height:1;color:${statusColor(status)};`,
    score));
  scoreBlock.appendChild(makeEl('div',
    'font-family:var(--font-mono);font-size:13px;color:var(--cyber-text-dim,#666);',
    `/ 100 (z=${z})`));
  if (status === 'warning' || status === 'error') {
    scoreBlock.appendChild(makeEl('div',
      `display:inline-block;margin-top:4px;background:${statusColor(status)};color:#fff;font-family:var(--font-mono);font-size:10px;font-weight:bold;letter-spacing:0.1em;padding:2px 8px;border-radius:4px;`,
      status === 'error' ? 'MODEL DEGRADED (ERROR)' : 'DEGRADATION DETECTED'));
  }
  panel.appendChild(scoreBlock);

  const stats = makeEl('div', 'display:flex;flex-direction:column;gap:10px;');
  const mk = (lbl, val, color) => {
    const row = makeEl('div', 'display:flex;flex-direction:column;gap:2px;');
    row.appendChild(makeEl('div',
      'font-family:var(--font-mono);font-size:10px;color:var(--cyber-text-dim,#666);text-transform:uppercase;letter-spacing:0.08em;',
      lbl));
    row.appendChild(makeEl('div',
      `font-family:var(--font-mono);font-size:13px;font-weight:700;color:${color || 'var(--cyber-text-bright,#c8c8c0)'};`,
      String(val)));
    return row;
  };
  const baselineStart = (mq.baseline && mq.baseline.windowStart) || '---';
  const baselineEnd = (mq.baseline && mq.baseline.windowEnd) || '---';
  const baselineSessions = (mq.baseline && mq.baseline.sessionCount) || '---';
  stats.appendChild(mk('Composite Z', z, statusColor(status)));
  stats.appendChild(mk('Baseline', `${baselineStart} -> ${baselineEnd}`));
  stats.appendChild(mk('Baseline Sessions', baselineSessions));
  panel.appendChild(stats);
}

// ---------------------------------------------------------------------------
// Panel 2: Behavioral Catalog (table)
// ---------------------------------------------------------------------------

function renderBehavioralCatalog(container, mq) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('Behavioral Catalog (24 metrics)'));

  const metrics = (mq.currentMqi && mq.currentMqi.metrics) ? mq.currentMqi.metrics : [];
  const compMap = {};
  for (const m of metrics) compMap[m.name] = m;

  const table = makeEl('table', 'width:100%;border-collapse:collapse;font-family:var(--font-mono);font-size:12px;');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  const headers = ['Metric', 'Raw', 'Z', 'Status', 'Weight', 'Source'];
  for (const h of headers) {
    const th = makeEl('th',
      'padding:6px;border-bottom:1px solid #333;text-align:left;',
      h);
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let i = 0; i < METRIC_LABELS.length; i++) {
    const key = COMP_KEYS[i];
    const c = compMap[key];
    const status = c ? c.status : 'no_baseline';
    const color = statusColor(status);
    const tr = document.createElement('tr');
    tr.appendChild(makeEl('td', 'padding:6px;border-bottom:1px solid #222;', METRIC_LABELS[i]));
    tr.appendChild(makeEl('td', 'padding:6px;border-bottom:1px solid #222;text-align:right;',
      c ? c.raw.toFixed(3) : '---'));
    tr.appendChild(makeEl('td',
      `padding:6px;border-bottom:1px solid #222;text-align:right;color:${color};`,
      c ? c.z.toFixed(2) : '---'));
    tr.appendChild(makeEl('td',
      `padding:6px;border-bottom:1px solid #222;text-align:center;color:${color};font-weight:700;`,
      String(status).toUpperCase()));
    tr.appendChild(makeEl('td',
      'padding:6px;border-bottom:1px solid #222;text-align:right;',
      c ? `${(c.weight * 100).toFixed(0)}%` : '---'));
    tr.appendChild(makeEl('td',
      'padding:6px;border-bottom:1px solid #222;color:var(--cyber-text-dim,#666);',
      c ? c.source : '---'));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  panel.appendChild(table);
}

// ---------------------------------------------------------------------------
// Panel 2b: Group Radar Chart + Session Picker
// ---------------------------------------------------------------------------

// Compact model name: "claude-opus-4-7" -> "opus-4-7", "claude-sonnet-4-6" -> "son-4-6"
function compactModel(model) {
  if (!model) return '---';
  const m = model.toLowerCase().replace(/^claude-/, '');
  return m
    .replace(/^sonnet/, 'son')
    .replace(/^haiku/, 'hku');
}

// Plan F: session count for a model in the current dataset. Used to label
// which top-K cohort a session was scored against. Returns 0 for unknown.
function cohortSizeForModel(mq, model) {
  if (!mq || !mq.byModel || !model) return 0;
  const entry = mq.byModel.find(function(m) { return m.model === model; });
  return entry ? (entry.sessionCount || 0) : 0;
}

// Format HH:MM from an ISO string in PST (UTC-8, no DST adjustment for display simplicity)
function isoToHHMM(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  const pstHour = ((d.getUTCHours() - 8) + 24) % 24;
  const min = d.getUTCMinutes();
  return `${String(pstHour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// Truncate project name to N chars
function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1) + '\u2026' : str;
}

// Convert an ISO timestamp to the user's local YYYY-MM-DD date. endIso is UTC
// so raw `.slice(0, 10)` misclassifies PST afternoon as "next day UTC". Using
// the browser's local date keeps the TODAY/YESTERDAY labels in sync with
// Alex's wall-clock perception.
function toLocalDateStr(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD
}

// Day-label formatting: TODAY / YESTERDAY / YYYY-MM-DD
function formatDayLabel(dayStr, today) {
  if (dayStr === today) return 'TODAY';
  // Parse as local date to avoid timezone-induced off-by-one day.
  const d = new Date(dayStr + 'T00:00:00');
  const t = new Date(today + 'T00:00:00');
  const diff = Math.round((t - d) / 86400000);
  if (diff === 1) return 'YESTERDAY';
  return dayStr;
}

// Flatten sessions into paged items: session items only count toward page limit;
// day-group headers are inserted around them.
function buildPageItems(visibleSessions, today, pageIdx, pageSize) {
  // Sort descending by endIso
  const sorted = visibleSessions.slice().sort((a, b) => b.endIso.localeCompare(a.endIso));
  const totalSessions = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalSessions / pageSize));
  const clampedPage = Math.max(0, Math.min(pageIdx, totalPages - 1));
  const sliced = sorted.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);

  // Insert day headers: track day transitions within this page's slice.
  // Uses local-time day boundaries so PST afternoon doesn't get bucketed into
  // the next UTC day.
  const items = [];
  let lastDay = null;
  for (const s of sliced) {
    const day = toLocalDateStr(s.endIso);
    if (day !== lastDay) {
      items.push({ type: 'header', day });
      lastDay = day;
    }
    items.push({ type: 'session', entry: s });
  }
  return { items, totalPages, clampedPage, totalSessions };
}

// Render the 4-cell drill-down strip (horizontal, full-width) below the radar.
// Returns an object with update(newCurrentGroupZ) for live updates.
function renderGroupDrillDownStrip(container, currentGroupZ, baselineGroupZ) {
  const strip = makeEl('div',
    'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;');
  container.appendChild(strip);

  // Store refs to the dynamic text nodes for each cell
  const cellRefs = [];

  for (let i = 0; i < METRIC_GROUPS.length; i++) {
    const g = METRIC_GROUPS[i];
    const cz = currentGroupZ[i];
    const bz = baselineGroupZ[i];
    const delta = cz - bz;

    const cell = makeEl('div',
      'flex:1;min-width:140px;padding:8px 10px;border:1px solid #21262d;border-radius:6px;background:var(--cyber-surface-2,#0d1117);font-family:var(--font-mono);font-size:12px;');

    const header = makeEl('div', 'display:flex;justify-content:space-between;gap:8px;align-items:center;');
    header.appendChild(makeEl('span', 'color:var(--cyber-text-bright,#c8c8c0);font-weight:700;', g.name));
    header.appendChild(makeEl('span', 'color:var(--cyber-text-dim,#666);font-size:10px;', `${(g.weight * 100).toFixed(0)}%`));
    cell.appendChild(header);

    const stats = makeEl('div', 'display:flex;gap:8px;margin-top:4px;font-size:11px;flex-wrap:wrap;');
    const czSpan = makeEl('span', 'color:var(--cyber-text-dim,#888);', `z ${cz.toFixed(2)}`);
    stats.appendChild(czSpan);

    const bSpan = makeEl('span', 'color:var(--cyber-text-dim,#666);', `base ${bz.toFixed(2)}`);
    stats.appendChild(bSpan);

    const deltaColor = delta < -1 ? '#ef4444' : delta < 0 ? '#d4a24c' : '#1D9E75';
    const dSpan = makeEl('span',
      `color:${deltaColor};font-weight:700;`,
      `\u0394 ${delta > 0 ? '+' : ''}${delta.toFixed(2)}`);
    stats.appendChild(dSpan);
    cell.appendChild(stats);

    strip.appendChild(cell);
    cellRefs.push({ czSpan, dSpan, bz, g });
  }

  function update(newCurrentGroupZ) {
    for (let i = 0; i < METRIC_GROUPS.length; i++) {
      const { czSpan, dSpan, bz } = cellRefs[i];
      const cz = newCurrentGroupZ[i];
      const delta = cz - bz;
      czSpan.textContent = `z ${cz.toFixed(2)}`;
      const deltaColor = delta < -1 ? '#ef4444' : delta < 0 ? '#d4a24c' : '#1D9E75';
      dSpan.style.color = deltaColor;
      dSpan.textContent = `\u0394 ${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;
    }
  }

  return { strip, update };
}

// ---------------------------------------------------------------------------
// Panel: 7-day divergence + per-metric attribution + empirical sigma
// Renders three data-science grade signals in a single row:
//   * 7-day rolling mean composite_z vs 30-day (Phase 0.2). Surfaces regime
//     shifts that the 30-day mean smooths over.
//   * compositeStdEmpirical from mqi_session_scores (Phase 1.4 partial) — a
//     calibration check. If sigma != 1.0, the sigmoid mapping is miscalibrated.
//   * Top contributors to the current drift from baseline (Phase 0.3).
// ---------------------------------------------------------------------------
function renderDivergenceAndAttribution(container, mq) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('WHY MQI MOVED — 7d divergence, sigma calibration, drift attribution'));

  const row = makeEl('div', 'display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;');
  panel.appendChild(row);

  // Left column: 7d vs 30d z plus sigma_empirical note.
  const left = makeEl('div', 'display:flex;flex-direction:column;gap:10px;');
  row.appendChild(left);

  const z30 = (mq.currentMqi && mq.currentMqi.compositeZ) ?? 0;
  const z7  = (mq.currentMqi7d && mq.currentMqi7d.compositeZ) ?? z30;
  const n7  = (mq.currentMqi7d && mq.currentMqi7d.sessionCount) ?? 0;
  const dZ  = z7 - z30;
  const dzColor = dZ <= -0.3 ? '#ef4444' : dZ >= 0.3 ? '#1D9E75' : '#d29922';
  const dzLabel = dZ <= -0.3 ? 'DIVERGING (recent worse)'
              : dZ >= 0.3 ? 'RECOVERING'
              : 'STABLE';

  const divCard = makeEl('div', 'border:1px solid #21262d;border-radius:6px;padding:12px;background:var(--cyber-surface-2,#0d1117);');
  left.appendChild(divCard);
  divCard.appendChild(makeEl('div', 'font-family:var(--font-mono);font-size:11px;color:var(--cyber-text-dim,#888);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;', '7-day vs 30-day composite z'));

  const grid = makeEl('div', 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;');
  divCard.appendChild(grid);
  const mkStat = (label, val, sub, color) => {
    const cell = makeEl('div', 'text-align:center;');
    cell.appendChild(makeEl('div', 'font-family:var(--font-mono);font-size:9px;color:var(--cyber-text-dim,#888);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:2px;', label));
    cell.appendChild(makeEl('div', `font-family:var(--font-mono);font-size:20px;font-weight:700;color:${color};`, val));
    if (sub) cell.appendChild(makeEl('div', 'font-family:var(--font-mono);font-size:10px;color:var(--cyber-text-dim,#888);margin-top:2px;', sub));
    return cell;
  };
  grid.appendChild(mkStat('30d z', z30.toFixed(2), `${(mq.sessions || []).filter(s => !s.isAutomated).length} sessions`, '#c8c8c0'));
  grid.appendChild(mkStat('7d z',  z7.toFixed(2),  `${n7} sessions`, dzColor));
  grid.appendChild(mkStat('delta', `${dZ >= 0 ? '+' : ''}${dZ.toFixed(2)}`, dzLabel, dzColor));

  const sigma = mq.compositeStdEmpirical ?? 1.0;
  const sigmaHealthy = Math.abs(sigma - 1.0) < 0.25;
  const sigmaNote = makeEl('div',
    'border:1px dashed #21262d;border-radius:6px;padding:10px;background:var(--cyber-surface-2,#0d1117);font-family:var(--font-mono);font-size:11px;line-height:1.5;color:var(--cyber-text-dim,#888);');
  sigmaNote.appendChild(makeEl('div', `color:${sigmaHealthy ? 'var(--cyber-text-bright,#c8c8c0)' : '#d29922'};margin-bottom:3px;`,
    `sigma_empirical = ${sigma.toFixed(2)}  (recent window)`));
  sigmaNote.appendChild(makeEl('div', 'font-size:10px;color:var(--cyber-text-dim,#666);',
    sigma < 0.75
      ? 'Composite-z distribution is compressed — thresholds may over-flag deviations. Phase 1.4 rescales by this factor.'
      : sigma > 1.25
        ? 'Composite-z distribution is wider than the unit scale — thresholds under-flag deviations.'
        : 'Composite-z distribution is roughly calibrated (|sigma - 1| < 0.25).'));
  left.appendChild(sigmaNote);

  // Right column: attribution bar list.
  const right = makeEl('div', 'border:1px solid #21262d;border-radius:6px;padding:12px;background:var(--cyber-surface-2,#0d1117);');
  row.appendChild(right);
  right.appendChild(makeEl('div', 'font-family:var(--font-mono);font-size:11px;color:var(--cyber-text-dim,#888);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;', 'Top contributors to current drift vs baseline'));

  const attr = (mq.compositeAttribution || []).slice(0, 8);
  if (!attr.length) {
    right.appendChild(emptyState('No attribution available (need baselineMqi + currentMqi).'));
    return;
  }
  const maxAbs = Math.max(...attr.map(a => Math.abs(a.contribution || 0)), 0.001);

  for (const a of attr) {
    const c = a.contribution || 0;
    const pctWidth = Math.min(100, Math.abs(c) / maxAbs * 100);
    const isNeg = c < 0;
    const rowEl = makeEl('div', 'display:grid;grid-template-columns:180px 1fr 70px;gap:6px;align-items:center;font-family:var(--font-mono);font-size:11px;margin-bottom:4px;');
    rowEl.appendChild(makeEl('div', 'color:var(--cyber-text-bright,#c8c8c0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
      a.name));
    // Bar: two half-bars flanking a midline so positive and negative are visually distinct.
    const barWrap = makeEl('div', 'position:relative;height:10px;background:#161b22;border-radius:3px;overflow:hidden;');
    barWrap.appendChild(makeEl('div', 'position:absolute;left:50%;top:0;bottom:0;width:1px;background:#333;'));
    const bar = makeEl('div',
      `position:absolute;top:0;bottom:0;height:100%;background:${isNeg ? '#ef4444aa' : '#1D9E75aa'};` +
      (isNeg
        ? `right:50%;width:${pctWidth / 2}%;`
        : `left:50%;width:${pctWidth / 2}%;`));
    barWrap.appendChild(bar);
    rowEl.appendChild(barWrap);
    rowEl.appendChild(makeEl('div',
      `color:${isNeg ? '#ef4444' : '#1D9E75'};text-align:right;font-weight:700;`,
      `${c >= 0 ? '+' : ''}${c.toFixed(3)}`));
    right.appendChild(rowEl);
  }

  const sumContrib = (mq.compositeAttribution || []).reduce((s, a) => s + (a.contribution || 0), 0);
  right.appendChild(makeEl('div',
    'font-family:var(--font-mono);font-size:10px;color:var(--cyber-text-dim,#666);margin-top:8px;padding-top:6px;border-top:1px solid #21262d;',
    `sum of contributions = ${sumContrib >= 0 ? '+' : ''}${sumContrib.toFixed(3)} (equals current z - baseline z; invariant check)`));
}

function renderGroupRadar(container, mq) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('MQI BY GROUP (RADAR)'));

  // Source data — prefer single-session snapshot when available
  const current = mq.latestSessionMqi || mq.currentMqi;
  const baseline = mq.baselineMqi;
  if (!current || !current.metrics || !baseline || !baseline.metrics) {
    panel.appendChild(emptyState('Insufficient data for radar. Need both current and baseline snapshots.'));
    return;
  }

  // Compute per-group z-scores for the "All" default selection
  const defaultCurrentGroupZ = METRIC_GROUPS.map(g => groupZ(current.metrics, g));
  const baselineGroupZ       = METRIC_GROUPS.map(g => groupZ(baseline.metrics, g));

  // Sigma-band radar mapping: ring index = clamp(z + 3, 0, 5.5).
  //   ring 0  = -3σ (error, model degraded)
  //   ring 1  = -2σ (warning)
  //   ring 2  = -1σ (watch / not great)
  //   ring 3  =  0  (baseline μ)
  //   ring 4  = +1σ (above baseline)
  //   ring 5  = +2σ
  // The ring 3 circle is emphasized and drawn by the sigmaBands plugin so we
  // don't need a redundant "baseline" polygon dataset.
  const RING_LABELS = { 0: '−3σ', 1: '−2σ', 2: '−1σ', 3: 'μ', 4: '+1σ', 5: '+2σ' };
  const zToRing = z => Math.max(0, Math.min(5.5, z + 3));
  const currentRing = defaultCurrentGroupZ.map(zToRing);

  // Per-axis pin color: green by default, yellow when z enters warning (-2σ),
  // red when z enters error (-3σ). Matches status_from_z thresholds in the
  // scoring engine (see mqi_v3_scoring.rs: WATCH_THRESHOLD / WARNING_THRESHOLD
  // / ERROR_THRESHOLD). Watch zone (-1σ) intentionally stays green: the user
  // framed it as "not great but not terrible" — not pin-worthy.
  const ERROR_PIN  = '#ef4444';
  const WARN_PIN   = '#d29922';
  const GREEN_PIN  = '#1D9E75';
  const pinColorForZ = z =>
    z < -3 ? ERROR_PIN :
    z < -2 ? WARN_PIN  :
             GREEN_PIN;
  const currentPinColors = defaultCurrentGroupZ.map(pinColorForZ);

  // Labels (include weight)
  const labels = METRIC_GROUPS.map(g => `${g.name} (${(g.weight * 100).toFixed(0)}%)`);

  const currentColor = statusColor(current.status || 'green');
  const currentColorResolved = currentColor.startsWith('var(') ? '#1D9E75' : currentColor;

  // ── Top-level two-column wrapper: [canvas ~60%] [picker ~40%] ──────────
  const topRow = makeEl('div', 'display:flex;gap:16px;align-items:flex-start;');
  panel.appendChild(topRow);

  // Left column: canvas + provenance caption
  const canvasWrap = makeEl('div', 'flex:3;min-width:320px;display:flex;flex-direction:column;');
  topRow.appendChild(canvasWrap);

  const canvasBox = makeEl('div', 'position:relative;height:400px;width:100%;');
  canvasWrap.appendChild(canvasBox);

  const canvas = makeCanvas('mqi-group-radar', 400, 'MQI group quality radar: current baseline across dimensions');
  canvas.style.width = '100%';
  canvasBox.appendChild(canvas);

  // Provenance caption — stored as a DOM ref for later textContent updates
  const baseStart = (mq.baseline && mq.baseline.windowStart) || '---';
  const baseEnd   = (mq.baseline && mq.baseline.windowEnd)   || '---';
  const sessionCount = (mq.sessions || []).filter(s => !s.isAutomated).length;
  const provenanceEl = makeEl('div',
    'font-family:var(--font-mono);font-size:10px;color:var(--cyber-text-dim,#666);text-align:center;margin-top:6px;',
    `Current: 30-day mean across ${sessionCount} sessions. Ring 3 (dashed green) = baseline μ (${baseStart} → ${baseEnd}). Inside ring 2 = watch, ring 1 = warning, ring 0 = error.`);
  canvasWrap.appendChild(provenanceEl);

  destroyChart(canvas);

  // Sigma-band plugin: fills sigma bands (error/warning/watch/normal) as
  // concentric annuli so the degradation zones are readable at a glance, and
  // highlights ring 3 with a thicker dashed green circle to anchor "baseline".
  const sigmaBandsPlugin = {
    id: 'sigmaBands',
    beforeDatasetsDraw(chart) {
      const scale = chart.scales.r;
      if (!scale) return;
      const ctx = chart.ctx;
      const cx = scale.xCenter;
      const cy = scale.yCenter;
      const bands = [
        { from: 0, to: 1, color: 'rgba(239, 68, 68, 0.12)' },    // error zone
        { from: 1, to: 2, color: 'rgba(210, 153, 34, 0.10)' },   // warning zone
        { from: 2, to: 3, color: 'rgba(212, 162, 76, 0.06)' },   // watch zone
        { from: 3, to: 5.5, color: 'rgba(29, 158, 117, 0.06)' }, // above-baseline zone
      ];
      for (const b of bands) {
        const rFrom = scale.getDistanceFromCenterForValue(b.from);
        const rTo   = scale.getDistanceFromCenterForValue(b.to);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, rTo, 0, 2 * Math.PI);
        ctx.arc(cx, cy, rFrom, 2 * Math.PI, 0, true);
        ctx.closePath();
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.restore();
      }
      // Emphasized baseline ring (ring 3).
      const rBase = scale.getDistanceFromCenterForValue(3);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, rBase, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(29, 158, 117, 0.95)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.restore();
    },
  };

  const radarChart = new Chart(canvas, {
    type: 'radar',
    data: {
      labels,
      datasets: [
        {
          label: 'Current',
          data: currentRing.slice(),
          borderColor: currentColorResolved,
          backgroundColor: currentColorResolved + '30',
          // Per-axis pin colors: change from green to yellow/red as that axis
          // drops into warning/error. Gives an at-a-glance read on which
          // dimensions are degraded without hovering.
          pointBackgroundColor: currentPinColors.slice(),
          pointBorderColor: currentPinColors.slice(),
          pointBorderWidth: 1,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 5.5,
          beginAtZero: true,
          grid: {
            color(ctx) {
              // Hide the default ring at value=3 because sigmaBandsPlugin
              // draws an emphasized version of it.
              return ctx.tick && ctx.tick.value === 3 ? 'transparent' : '#2a2a2a';
            },
            lineWidth: 1,
          },
          angleLines:  { color: '#333' },
          pointLabels: { color: '#aaa', font: { size: 11 } },
          ticks: {
            stepSize: 1,
            color: '#888',
            font: { size: 9 },
            backdropColor: 'rgba(0,0,0,0.6)',
            showLabelBackdrop: true,
            callback(value) { return RING_LABELS[value] ?? ''; },
          },
        },
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: '#888', font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label(ctx) {
              const i = ctx.dataIndex;
              const g = METRIC_GROUPS[i];
              const z = radarChart._groupZ ? radarChart._groupZ[i] : defaultCurrentGroupZ[i];
              const sign = z >= 0 ? '+' : '';
              return `${g.name}: ${sign}${z.toFixed(2)}σ from baseline`;
            },
          },
        },
      },
    },
    plugins: [sigmaBandsPlugin],
  });
  radarChart._groupZ = defaultCurrentGroupZ.slice();

  // ── Right column: session picker ────────────────────────────────────────
  const pickerCol = makeEl('div', 'flex:2;min-width:240px;max-width:380px;display:flex;flex-direction:column;');
  topRow.appendChild(pickerCol);

  // Picker state (closure variables)
  let selectedSessionId = null;   // null = "All"
  let showShort = false;          // false = hide sessions with <5 tool calls
  let showAutomated = false;      // false = hide automated sessions
  let currentPage = 0;
  const PAGE_SIZE = 10;

  // Local date (en-CA → YYYY-MM-DD) so TODAY/YESTERDAY match the user's
  // wall-clock, not UTC. Matters for PST users whose afternoon sessions have
  // UTC timestamps that roll into the next day.
  const today = new Date().toLocaleDateString('en-CA');
  const ACCENT = '#1D9E75';
  const SELECTED_BG = 'rgba(29,158,117,0.08)';
  const HOVER_BG = 'rgba(255,255,255,0.04)';

  // The picker scroll container
  const pickerBox = makeEl('div',
    `display:flex;flex-direction:column;max-height:500px;overflow-y:auto;border:1px solid #21262d;border-radius:6px;background:var(--cyber-surface-2,#0d1117);font-family:var(--font-mono);font-size:12px;`);
  pickerCol.appendChild(pickerBox);

  // ── Below radar: drill-down strip ──────────────────────────────────────
  // Created AFTER chart but appended to panel (not topRow) so it sits full-width below
  const drillContainer = makeEl('div', '');
  panel.appendChild(drillContainer);
  const drillDown = renderGroupDrillDownStrip(drillContainer, defaultCurrentGroupZ, baselineGroupZ);

  // ── onSelect handler ───────────────────────────────────────────────────
  function onSelect(sessionId) {
    selectedSessionId = sessionId;

    let newGroupZ;
    if (sessionId === null) {
      // "All" — restore default
      newGroupZ = defaultCurrentGroupZ;
      const sc = (mq.sessions || []).filter(s => !s.isAutomated).length;
      provenanceEl.textContent = `Current: 30-day mean across ${sc} sessions. Ring 3 (dashed green) = baseline μ (${baseStart} → ${baseEnd}).`;
    } else {
      // Find the session
      const sess = (mq.sessions || []).find(s => s.sessionId === sessionId);
      if (!sess || !sess.mqi || !sess.mqi.metrics) {
        newGroupZ = defaultCurrentGroupZ;
      } else {
        newGroupZ = METRIC_GROUPS.map(g => groupZ(sess.mqi.metrics, g));
        const start = isoToHHMM(sess.startIso);
        const end = isoToHHMM(sess.endIso);
        const shortId = sess.sessionId.slice(0, 8) + '\u2026' + sess.sessionId.slice(-4);
        const dayStr = toLocalDateStr(sess.endIso);
        const dur = Math.round(sess.durationMinutes);
        const mdl = compactModel(sess.model);
        const tc = sess.toolCallCount;
        const tokRateMet = sess.mqi.metrics.find(m => m.name === 'token_rate_per_minute');
        const tokRate = tokRateMet ? tokRateMet.raw : 0;
        provenanceEl.textContent = `Current: session ${shortId} (${dayStr} ${start}-${end}, ${dur} min, ${mdl}, ${tc} tool calls, ${tokRate.toFixed(0)} tok/min). Ring 3 = baseline μ (${baseStart} → ${baseEnd}).`;
      }
    }

    // Update radar Current dataset (now index 0) against the fixed sigma-band
    // axis. Store groupZ on the chart so the tooltip callback can render the
    // raw σ value. Recolor the per-axis pins so warning/error axes show
    // yellow/red immediately on session switch.
    const newRing = newGroupZ.map(zToRing);
    const newPins = newGroupZ.map(pinColorForZ);
    radarChart.data.datasets[0].data = newRing;
    radarChart.data.datasets[0].pointBackgroundColor = newPins;
    radarChart.data.datasets[0].pointBorderColor = newPins;
    radarChart._groupZ = newGroupZ.slice();
    radarChart.update('active');

    // Update drill-down strip
    drillDown.update(newGroupZ);

    // Re-render picker to update selection highlighting
    renderPickerContents();
  }

  // ── Picker render function (called on state changes) ───────────────────
  function renderPickerContents() {
    clearNode(pickerBox);

    // ── Filter toggles ──────────────────────────────────────────────────
    const filterBar = makeEl('div',
      'display:flex;gap:12px;padding:8px 10px;border-bottom:1px solid #21262d;flex-shrink:0;');

    function makeCheckbox(label, checked, onChange) {
      const wrap = makeEl('label',
        'display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--cyber-text-dim,#888);font-size:11px;');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked;
      cb.style.cssText = 'cursor:pointer;margin:0;';
      cb.addEventListener('change', () => onChange(cb.checked));
      wrap.appendChild(cb);
      wrap.appendChild(document.createTextNode(label));
      return wrap;
    }

    filterBar.appendChild(makeCheckbox('Hide short (<5)', !showShort, (checked) => {
      showShort = !checked;
      currentPage = 0;
      renderPickerContents();
    }));
    filterBar.appendChild(makeCheckbox('Hide automated', !showAutomated, (checked) => {
      showAutomated = !checked;
      currentPage = 0;
      renderPickerContents();
    }));
    pickerBox.appendChild(filterBar);

    // ── "All" row ───────────────────────────────────────────────────────
    const isAllSelected = selectedSessionId === null;
    const allRow = makeEl('div',
      `display:flex;flex-direction:column;gap:2px;padding:8px 10px;cursor:pointer;border-bottom:1px solid #21262d;${
        isAllSelected
          ? `border-left:3px solid ${ACCENT};background:${SELECTED_BG};padding-left:7px;`
          : 'border-left:3px solid transparent;'
      }`);

    const allTop = makeEl('div', 'display:flex;align-items:center;gap:6px;');
    allTop.appendChild(makeEl('span', `color:${ACCENT};font-size:14px;`, '\u25C9'));
    allTop.appendChild(makeEl('span', 'color:var(--cyber-text-bright,#c8c8c0);font-weight:700;', 'All (30-day mean)'));
    allRow.appendChild(allTop);

    const allMqiX = (mq.currentMqi.mqiX ?? 0).toFixed(1);
    const allZ = (mq.currentMqi.compositeZ ?? 0).toFixed(2);
    const allStatus = mq.currentMqi.status || 'green';
    const allSub = makeEl('div', 'display:flex;align-items:center;gap:6px;color:var(--cyber-text-dim,#888);font-size:11px;padding-left:20px;');
    allSub.appendChild(makeEl('span', '', `MQI-X ${allMqiX}`));
    allSub.appendChild(makeEl('span', '', `\u00B7 z=${allZ}`));
    const allDot = makeEl('span', `color:${statusColor(allStatus)};`, '\u25CF');
    allSub.appendChild(allDot);
    allRow.appendChild(allSub);

    allRow.addEventListener('mouseenter', () => {
      if (selectedSessionId !== null) allRow.style.background = HOVER_BG;
    });
    allRow.addEventListener('mouseleave', () => {
      if (selectedSessionId !== null) allRow.style.background = '';
    });
    allRow.addEventListener('click', () => onSelect(null));
    pickerBox.appendChild(allRow);

    // ── Filtered sessions ───────────────────────────────────────────────
    const visibleSessions = (mq.sessions || []).filter(s =>
      (showShort || s.toolCallCount >= 5) &&
      (showAutomated || !s.isAutomated)
    );

    const { items, totalPages, clampedPage, totalSessions } = buildPageItems(
      visibleSessions, today, currentPage, PAGE_SIZE
    );
    // Keep currentPage in sync with clamped value
    currentPage = clampedPage;

    if (totalSessions === 0) {
      pickerBox.appendChild(makeEl('div',
        'padding:16px 10px;color:var(--cyber-text-dim,#666);font-size:11px;text-align:center;',
        'No sessions match filters.'));
    } else {
      for (const item of items) {
        if (item.type === 'header') {
          const label = formatDayLabel(item.day, today);
          const hdr = makeEl('div',
            'padding:4px 10px 3px 10px;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--cyber-text-dim,#666);border-bottom:1px solid #21262d;background:var(--cyber-surface-1,#161b22);flex-shrink:0;');
          hdr.appendChild(document.createTextNode(label));
          // Count sessions on that day within visible
          const dayCount = visibleSessions.filter(s => toLocalDateStr(s.endIso) === item.day).length;
          hdr.appendChild(makeEl('span', 'color:#444;margin-left:6px;',
            `\u00B7 ${dayCount} session${dayCount !== 1 ? 's' : ''}`));
          pickerBox.appendChild(hdr);
        } else {
          const s = item.entry;
          const isSelected = s.sessionId === selectedSessionId;
          const mqiData = s.mqi || {};
          const mqiX = (mqiData.mqiX ?? 0).toFixed(0);
          const z = (mqiData.compositeZ ?? 0).toFixed(2);
          const status = mqiData.status || 'green';
          const sc = statusColor(status);

          const row = makeEl('div',
            `padding:6px 10px;cursor:pointer;border-bottom:1px solid #1a1f27;${
              isSelected
                ? `border-left:3px solid ${ACCENT};background:${SELECTED_BG};padding-left:7px;`
                : 'border-left:3px solid transparent;'
            }`);

          // Line 1: circle indicator + time range + model + status dot
          const line1 = makeEl('div', 'display:flex;align-items:center;gap:5px;');
          const circleChar = s.isActive ? '\u29BF' : '\u25CB';
          line1.appendChild(makeEl('span',
            `color:${s.isActive ? ACCENT : '#555'};font-size:12px;`,
            circleChar));
          const timeStr = `${isoToHHMM(s.startIso)}-${isoToHHMM(s.endIso)}`;
          line1.appendChild(makeEl('span', 'color:var(--cyber-text-bright,#c8c8c0);', timeStr));
          line1.appendChild(makeEl('span', 'color:var(--cyber-text-dim,#888);', compactModel(s.model)));
          line1.appendChild(makeEl('span', `color:${sc};font-size:10px;`, '\u25CF'));
          row.appendChild(line1);

          // Line 2: duration + tool calls + project name
          const dur = Math.round(s.durationMinutes || 0);
          const proj = truncate(s.projectName || '', 20);
          const line2 = makeEl('div',
            'color:var(--cyber-text-dim,#888);font-size:11px;padding-left:17px;');
          line2.appendChild(document.createTextNode(`${dur} min \u00B7 ${s.toolCallCount} tools`));
          if (proj) {
            line2.appendChild(makeEl('span', 'color:#555;', ` \u00B7 ${proj}`));
          }
          row.appendChild(line2);

          // Line 3: MQI-X + z + status label
          const line3 = makeEl('div',
            `display:flex;gap:5px;align-items:center;font-size:11px;padding-left:17px;color:${sc};`);
          line3.appendChild(makeEl('span', '', `MQI-X ${mqiX}`));
          line3.appendChild(makeEl('span', 'color:var(--cyber-text-dim,#666);', `\u00B7 z=${z} \u00B7 ${status.toUpperCase()}`));
          row.appendChild(line3);

          // Line 4: "compared against" cohort — Plan F 2026-04-24.
          // Per-session z is against this model's OWN top-K cohort when the
          // model has >=50 sessions; else falls back to pooled. Client-side
          // inference via mq.byModel.sessionCount (no extra API call).
          const cohortN = cohortSizeForModel(mq, s.model);
          const cohortLabel = cohortN >= 50
            ? `vs ${compactModel(s.model)} cohort \u00B7 n=${cohortN} \u00B7 top-K`
            : `vs pooled cohort \u00B7 cold-start (own n=${cohortN})`;
          const line4 = makeEl('div',
            'color:var(--cyber-text-dim,#666);font-size:10px;padding-left:17px;font-style:italic;',
            cohortLabel);
          row.appendChild(line4);

          row.addEventListener('mouseenter', () => {
            if (!isSelected) row.style.background = HOVER_BG;
          });
          row.addEventListener('mouseleave', () => {
            if (!isSelected) row.style.background = '';
          });
          row.addEventListener('click', () => onSelect(s.sessionId));
          pickerBox.appendChild(row);
        }
      }
    }

    // ── Pagination ──────────────────────────────────────────────────────
    if (totalPages > 1) {
      const pagBar = makeEl('div',
        'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-top:1px solid #21262d;flex-shrink:0;');

      const prevBtn = makeEl('button',
        `background:none;border:1px solid #333;border-radius:4px;color:${currentPage === 0 ? '#444' : '#888'};font-family:var(--font-mono);font-size:11px;padding:2px 8px;cursor:${currentPage === 0 ? 'default' : 'pointer'};`,
        '< Prev');
      prevBtn.disabled = currentPage === 0;
      prevBtn.addEventListener('click', () => {
        if (currentPage > 0) { currentPage--; renderPickerContents(); }
      });

      const pageLabel = makeEl('span',
        'color:var(--cyber-text-dim,#666);font-size:11px;',
        `Page ${currentPage + 1} / ${totalPages}`);

      const nextBtn = makeEl('button',
        `background:none;border:1px solid #333;border-radius:4px;color:${currentPage >= totalPages - 1 ? '#444' : '#888'};font-family:var(--font-mono);font-size:11px;padding:2px 8px;cursor:${currentPage >= totalPages - 1 ? 'default' : 'pointer'};`,
        'Next >');
      nextBtn.disabled = currentPage >= totalPages - 1;
      nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages - 1) { currentPage++; renderPickerContents(); }
      });

      pagBar.appendChild(prevBtn);
      pagBar.appendChild(pageLabel);
      pagBar.appendChild(nextBtn);
      pickerBox.appendChild(pagBar);
    }

    // Coverage footer: make it obvious that the picker spans more days than
    // the first page shows, and that the pipeline caps at 200 user + 50
    // automated (newest first). Prevents the "where are today/other days"
    // perception when only yesterday fits on page 1.
    const allSessions = mq.sessions || [];
    if (allSessions.length > 0) {
      const days = allSessions
        .map(s => toLocalDateStr(s.endIso))
        .filter(Boolean)
        .sort();
      if (days.length) {
        const first = days[0];
        const last  = days[days.length - 1];
        const uniqueDays = new Set(days).size;
        const hiddenToday = allSessions.some(s =>
          toLocalDateStr(s.endIso) === today &&
          ((!showShort && s.toolCallCount < 5) || (!showAutomated && s.isAutomated))
        );
        const footer = makeEl('div',
          'padding:6px 10px;border-top:1px solid #21262d;color:var(--cyber-text-dim,#666);font-family:var(--font-mono);font-size:10px;line-height:1.4;',
          `List spans ${first} → ${last} (${uniqueDays} days, ${allSessions.length} sessions; pipeline caps at 200 user + 50 automated newest-first).`);
        pickerBox.appendChild(footer);
        if (hiddenToday) {
          pickerBox.appendChild(makeEl('div',
            'padding:2px 10px 6px 10px;color:#d29922;font-family:var(--font-mono);font-size:10px;',
            `Today has activity but it's filtered out (short or automated). Uncheck the filters above to see it.`));
        }
      }
    }
  }

  // Initial render
  renderPickerContents();
}

// ---------------------------------------------------------------------------
// Panel 2c: Group Legend Table (with tooltip per metric + toggle to full catalog)
// ---------------------------------------------------------------------------

function renderGroupLegend(container, mq) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('GROUP LEGEND (6 GROUPS)'));

  const table = makeEl('table', 'width:100%;border-collapse:collapse;font-family:var(--font-mono);font-size:12px;');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const h of ['#', 'Group', 'Metrics', 'Weight']) {
    trh.appendChild(makeEl('th',
      'padding:6px 8px;text-align:left;color:var(--cyber-text-dim,#888);border-bottom:1px solid #333;font-weight:700;',
      h));
  }
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let i = 0; i < METRIC_GROUPS.length; i++) {
    const g = METRIC_GROUPS[i];
    const tr = document.createElement('tr');

    tr.appendChild(makeEl('td',
      'padding:8px;border-bottom:1px solid #222;color:var(--cyber-text-dim,#888);vertical-align:top;',
      String(i + 1)));
    tr.appendChild(makeEl('td',
      'padding:8px;border-bottom:1px solid #222;color:var(--cyber-text-bright,#c8c8c0);font-weight:700;vertical-align:top;',
      g.name));

    // Metrics cell with per-metric hover tooltips
    const metricsTd = makeEl('td',
      'padding:8px;border-bottom:1px solid #222;color:var(--cyber-text-dim,#888);vertical-align:top;line-height:1.7;');
    for (let mi = 0; mi < g.metrics.length; mi++) {
      if (mi > 0) metricsTd.appendChild(document.createTextNode(', '));
      const metricName = g.metrics[mi];
      const desc = METRIC_DESCRIPTIONS[metricName] || '';
      const span = document.createElement('span');
      span.textContent = metricName;
      span.style.cssText = 'color:var(--cyber-text-bright,#c8c8c0);text-decoration:underline dotted;text-underline-offset:2px;';
      attachTooltip(span, desc);
      metricsTd.appendChild(span);
    }
    tr.appendChild(metricsTd);

    tr.appendChild(makeEl('td',
      'padding:8px;border-bottom:1px solid #222;color:var(--cyber-text-bright,#c8c8c0);vertical-align:top;text-align:right;',
      g.weight.toFixed(2)));

    tbody.appendChild(tr);
  }

  // Sum row
  const trSum = document.createElement('tr');
  trSum.appendChild(makeEl('td', 'padding:8px;border-top:2px solid #333;', ''));
  trSum.appendChild(makeEl('td', 'padding:8px;border-top:2px solid #333;color:var(--cyber-text-dim,#888);font-style:italic;', 'Total'));
  trSum.appendChild(makeEl('td', 'padding:8px;border-top:2px solid #333;', ''));
  trSum.appendChild(makeEl('td',
    'padding:8px;border-top:2px solid #333;color:#1D9E75;font-weight:700;text-align:right;',
    'S 1.00'));
  tbody.appendChild(trSum);

  table.appendChild(tbody);
  panel.appendChild(table);

  // "Show all 24 metrics" toggle
  const toggleWrap = makeEl('div', 'margin-top:12px;text-align:right;');
  const toggleLink = document.createElement('a');
  toggleLink.href = '#';
  toggleLink.textContent = 'Show all 24 metrics (full catalog)';
  toggleLink.style.cssText = 'color:var(--cyber-text-dim,#888);text-decoration:underline;font-family:var(--font-mono);font-size:11px;cursor:pointer;';
  toggleWrap.appendChild(toggleLink);
  panel.appendChild(toggleWrap);

  const catalogHolder = makeEl('div', 'margin-top:12px;display:none;');
  panel.appendChild(catalogHolder);

  let expanded = false;
  toggleLink.addEventListener('click', (ev) => {
    ev.preventDefault();
    expanded = !expanded;
    if (expanded) {
      catalogHolder.style.display = 'block';
      clearNode(catalogHolder);
      renderBehavioralCatalog(catalogHolder, mq);
      toggleLink.textContent = 'Hide all 24 metrics (full catalog)';
    } else {
      catalogHolder.style.display = 'none';
      clearNode(catalogHolder);
      toggleLink.textContent = 'Show all 24 metrics (full catalog)';
    }
  });
}

// ---------------------------------------------------------------------------
// Panel 3: Keywords
// ---------------------------------------------------------------------------

// Compact combined Score + Keyword Sentiment card. Replaces the wider
// side-by-side topRow layout so this pair can slot into the same row as
// charts like "MQI by Model" / "MQI Trend" at equal column width.
function renderScoreKeywordCombined(container, mq) {
  const panel = panelDiv('display:flex;flex-direction:column;gap:14px;');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('MQI SCORE & KEYWORD SENTIMENT'));

  // ───── Score block ─────────────────────────────────────────────────────
  const cur = mq.currentMqi || {};
  const score = (cur.mqiX ?? 50).toFixed(1);
  const zNum = cur.compositeZ ?? 0;
  const z = zNum.toFixed(2);
  // Phase 3.2 — tightened error threshold. Require upper-2σ confidence bound
  // on composite_z (z + 2·SE) to be below -3 before we paint error red. If
  // the day-clustered SE is wide, a single noisy bad day can't trigger error.
  const seForStatus = Number(cur.compositeZClusterSe) || 0;
  let status = cur.status || 'green';
  if (status === 'error' && seForStatus > 0 && (zNum + 2 * seForStatus) >= -3) {
    status = 'warning';
  }
  const scoreStatusColor = statusColor(status);

  const scoreRow = makeEl('div', 'display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap;');
  panel.appendChild(scoreRow);

  const scoreBlock = makeEl('div', 'display:flex;flex-direction:column;gap:2px;min-width:90px;');
  scoreBlock.appendChild(makeEl('div',
    'font-family:var(--font-mono);font-size:10px;color:var(--cyber-text-dim,#666);text-transform:uppercase;letter-spacing:0.08em;',
    'MQI-X'));
  scoreBlock.appendChild(makeEl('div',
    `font-family:var(--font-mono);font-size:40px;font-weight:900;line-height:1;color:${scoreStatusColor};`,
    score));
  // Phase 3.2 — day-clustered standard error on composite_z. SE near zero
  // means every session is its own day; a large SE means recent MQI is
  // driven by a few days whose context is shared. Status tightens to
  // error only when z < -3 AND z - 2·SE < -3 (two-sigma confident of regime).
  const clusterSe = Number(cur.compositeZClusterSe) || 0;
  const zSuffix = clusterSe > 0 ? ` ±${clusterSe.toFixed(2)}` : '';
  scoreBlock.appendChild(makeEl('div',
    'font-family:var(--font-mono);font-size:10px;color:var(--cyber-text-dim,#666);margin-top:2px;',
    `/ 100 (z=${z}${zSuffix})`));
  if (clusterSe > 0) {
    const se = makeEl('div',
      'font-family:var(--font-mono);font-size:9px;color:var(--cyber-text-dim,#888);margin-top:1px;',
      `cluster-SE on days`);
    se.setAttribute('title',
      `Day-clustered SE on composite_z: ${clusterSe.toFixed(3)}. ` +
      `Status tightens to 'error' only when z - 2·SE < -3 (regime confident).`);
    scoreBlock.appendChild(se);
  }
  scoreRow.appendChild(scoreBlock);

  const baselineStart = (mq.baseline && mq.baseline.windowStart) || '---';
  const baselineEnd = (mq.baseline && mq.baseline.windowEnd) || '---';
  const baselineSessions = (mq.baseline && mq.baseline.sessionCount) || '---';

  const mkStat = (lbl, val, color) => {
    const row = makeEl('div', 'display:flex;flex-direction:column;gap:2px;');
    row.appendChild(makeEl('div',
      'font-family:var(--font-mono);font-size:9px;color:var(--cyber-text-dim,#666);text-transform:uppercase;letter-spacing:0.08em;',
      lbl));
    row.appendChild(makeEl('div',
      `font-family:var(--font-mono);font-size:12px;font-weight:700;color:${color || 'var(--cyber-text-bright,#c8c8c0)'};`,
      String(val)));
    return row;
  };

  const statsCol = makeEl('div', 'display:flex;flex-direction:column;gap:6px;flex:1;min-width:0;');
  statsCol.appendChild(mkStat('Composite Z', z, scoreStatusColor));
  statsCol.appendChild(mkStat('Baseline', `${baselineStart} → ${baselineEnd}`));
  statsCol.appendChild(mkStat('Baseline Sessions', baselineSessions));
  scoreRow.appendChild(statsCol);

  // Phase 2.1 + 2.3 — MQI-Model / MQI-Env / MQI-Uncoached splits. These
  // live side-by-side with the pooled MQI-X so a reader can see which part
  // of the number is "model" vs "Anthropic uptime" vs "my coaching."
  const splits = [
    { lbl: 'Model',     val: cur.mqiXModel,     z: cur.compositeZModel,
      tip: 'Pooled MQI excluding incident_exposure + issue_velocity.' },
    { lbl: 'Env',       val: cur.mqiXEnv,       z: cur.compositeZEnv,
      tip: 'Only incident_exposure + issue_velocity — availability, not capability.' },
    { lbl: 'Uncoached', val: cur.mqiXUncoached, z: cur.compositeZUncoached,
      tip: 'Strips hook-coached metrics (premature_stopping, stop_hook_violations, redaction_rate, human_time_estimation, implicit_constraint_violator). Use for version-over-version comparisons.' },
  ];
  if (splits.some(s => typeof s.val === 'number')) {
    const splitRow = makeEl('div', 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:4px;');
    for (const s of splits) {
      if (typeof s.val !== 'number') continue;
      const cell = makeEl('div', 'display:flex;flex-direction:column;gap:1px;padding:6px 8px;border:1px solid var(--surface-4, #1a1a18);border-radius:4px;');
      cell.setAttribute('title', s.tip);
      cell.appendChild(makeEl('div',
        'font-family:var(--font-mono);font-size:8px;color:var(--cyber-text-dim,#888);text-transform:uppercase;letter-spacing:0.1em;',
        s.lbl));
      cell.appendChild(makeEl('div',
        `font-family:var(--font-mono);font-size:14px;font-weight:700;color:${statusColor(s.z < -3 ? 'error' : s.z < -2 ? 'warning' : s.z < -1 ? 'watch' : 'green')};`,
        s.val.toFixed(1)));
      cell.appendChild(makeEl('div',
        'font-family:var(--font-mono);font-size:8px;color:var(--cyber-text-dim,#666);',
        `z=${(s.z ?? 0).toFixed(2)}`));
      splitRow.appendChild(cell);
    }
    panel.appendChild(splitRow);
  }

  // Optional degradation banner
  if (status === 'warning' || status === 'error') {
    panel.appendChild(makeEl('div',
      `display:inline-block;align-self:flex-start;background:${scoreStatusColor};color:#fff;font-family:var(--font-mono);font-size:9px;font-weight:bold;letter-spacing:0.1em;padding:2px 8px;border-radius:4px;`,
      status === 'error' ? 'MODEL DEGRADED (ERROR)' : 'DEGRADATION DETECTED'));
  }

  // Divider
  panel.appendChild(makeEl('div', 'height:1px;background:var(--surface-4, #1a1a18);margin:2px 0;'));

  // ───── Keyword block ───────────────────────────────────────────────────
  panel.appendChild(makeEl('div',
    'font-family:var(--font-mono);font-size:10px;color:var(--cyber-text-dim,#888);text-transform:uppercase;letter-spacing:0.1em;',
    'Keyword Sentiment'));

  const kt = mq.keywordTracker;
  if (!kt) {
    panel.appendChild(emptyState('No keyword data available.'));
    return;
  }
  const ratio = kt.ratio != null ? kt.ratio : 0;
  const baseRatio = kt.baselineRatio != null ? kt.baselineRatio : 0;
  const delta = baseRatio > 0 ? ((ratio - baseRatio) / baseRatio) * 100 : 0;
  const deltaSign = delta >= 0 ? '+' : '';

  const kwItems = [
    {
      lbl: 'Pos:Neg',
      val: ratio.toFixed(2),
      color: ratio >= 2 ? 'var(--accent-green, #1D9E75)' : ratio >= 1 ? 'var(--accent-yellow, #d29922)' : '#ef4444',
    },
    { lbl: 'Baseline', val: baseRatio.toFixed(2), color: 'var(--text-dim, #888)' },
    { lbl: 'Δ', val: deltaSign + delta.toFixed(1) + '%', color: delta >= 0 ? 'var(--accent-green, #1D9E75)' : '#ef4444' },
    { lbl: 'Positives', val: (kt.positiveTotal != null ? kt.positiveTotal : 0).toLocaleString(), color: 'var(--accent-green, #1D9E75)' },
    { lbl: 'Negatives', val: (kt.negativeTotal != null ? kt.negativeTotal : 0).toLocaleString(), color: '#ef4444' },
  ];

  const kwRow = makeEl('div', 'display:grid;grid-template-columns:repeat(5, 1fr);gap:8px;');
  panel.appendChild(kwRow);
  for (const it of kwItems) {
    const cell = makeEl('div', 'display:flex;flex-direction:column;gap:2px;min-width:0;');
    cell.appendChild(makeEl('div',
      'font-family:var(--font-mono);font-size:9px;color:var(--cyber-text-dim,#666);text-transform:uppercase;letter-spacing:0.08em;',
      it.lbl));
    cell.appendChild(makeEl('div',
      `font-family:var(--font-mono);font-size:15px;font-weight:800;color:${it.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`,
      it.val));
    kwRow.appendChild(cell);
  }
}

function renderKeywords(container, mq) {
  const panel = panelDiv('display:flex;flex-direction:column;gap:16px;');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('Keyword Sentiment'));

  const kt = mq.keywordTracker;
  if (!kt) {
    panel.appendChild(emptyState('No keyword data available.'));
    return;
  }

  const ratio = kt.ratio != null ? kt.ratio : 0;
  const baseRatio = kt.baselineRatio != null ? kt.baselineRatio : 0;
  const delta = baseRatio > 0 ? ((ratio - baseRatio) / baseRatio) * 100 : 0;
  const deltaSign = delta >= 0 ? '+' : '';

  const statsRow = document.createElement('div');
  statsRow.style.cssText = 'display:flex;gap:24px;align-items:center;flex-wrap:wrap;';

  const items = [
    {
      label: 'Pos:Neg Ratio',
      value: ratio.toFixed(2),
      color: ratio >= 2 ? 'var(--bio-growth,#1D9E75)' : ratio >= 1 ? 'var(--cyber-warning,#d29922)' : 'var(--bio-bug,#ef4444)',
    },
    { label: 'Baseline', value: baseRatio.toFixed(2), color: 'var(--cyber-text-dim,#888)' },
    {
      label: 'Delta',
      value: deltaSign + delta.toFixed(1) + '%',
      color: delta >= 0 ? 'var(--bio-growth,#1D9E75)' : 'var(--bio-bug,#ef4444)',
    },
    { label: 'Positives', value: (kt.positiveTotal != null ? kt.positiveTotal : 0).toLocaleString(), color: 'var(--bio-growth,#1D9E75)' },
    { label: 'Negatives', value: (kt.negativeTotal != null ? kt.negativeTotal : 0).toLocaleString(), color: 'var(--bio-bug,#ef4444)' },
  ];

  for (const item of items) {
    const block = document.createElement('div');
    block.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

    const lbl = document.createElement('div');
    lbl.textContent = item.label;
    lbl.style.cssText = [
      'font-family:var(--font-mono)',
      'font-size:10px',
      'color:var(--cyber-text-dim,#666)',
      'text-transform:uppercase',
      'letter-spacing:0.08em',
    ].join(';');

    const val = document.createElement('div');
    val.textContent = item.value;
    val.style.cssText = [
      'font-family:var(--font-mono)',
      'font-size:22px',
      'font-weight:800',
      'color:' + item.color,
    ].join(';');

    block.appendChild(lbl);
    block.appendChild(val);
    statsRow.appendChild(block);
  }

  panel.appendChild(statsRow);
}

// ---------------------------------------------------------------------------
// Panel 4: MQI Trend (line chart)
// ---------------------------------------------------------------------------

function renderMqiTrend(container, mq) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('MQI Trend (Composite Z)'));

  const daily = mq.daily || [];
  if (!daily.length) {
    panel.appendChild(emptyState('No daily trend data available.'));
    return;
  }

  // Build a dense daily series with nulls on missing days. Without this, the
  // line chart connects sparse daily rows across multi-day gaps, creating the
  // illusion of flat z-scores across weeks (Jan gap 01-14 → 01-21 drawn as one
  // segment). With nulls inserted at missing dates, Chart.js breaks the line.
  const denseDaily = (() => {
    if (!daily.length) return [];
    const byDate = new Map(daily.map(r => [r.date, r]));
    const first = new Date(daily[0].date + 'T00:00:00Z');
    const last  = new Date(daily[daily.length - 1].date + 'T00:00:00Z');
    const out = [];
    for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      out.push(byDate.get(iso) || { date: iso, compositeZ: null, _missing: true });
    }
    return out;
  })();

  // Fix 3: use full YYYY-MM-DD as the internal category label so multi-year
  // data never produces duplicate "MM-DD" ticks that misplace points. The
  // ticks.callback below strips to "MM-DD" for display only.
  const labels = denseDaily.map(d => d.date); // YYYY-MM-DD
  const values = denseDaily.map(d =>
    d.compositeZ === null || d.compositeZ === undefined
      ? null
      : d.compositeZ);

  // CRITICAL: Chart.js mis-renders scatter datasets with numeric x on a
  // `type:'category'` scale (they land in the wrong horizontal position).
  // Using the LABEL STRING as x forces Chart.js to anchor the point to the
  // matching category tick. Session x must use the same YYYY-MM-DD format
  // as the labels array.
  const denseLabels = labels;
  const sessionScatter = (mq.sessions || [])
    .filter(s => !s.isAutomated)
    .map(s => {
      const day = toLocalDateStr(s.endIso); // returns YYYY-MM-DD
      if (!day || !denseLabels.includes(day)) return null;
      const z = s.mqi && typeof s.mqi.compositeZ === 'number' ? s.mqi.compositeZ : null;
      if (z === null) return null;
      return { x: day, y: z, raw: z };
    })
    .filter(p => p !== null);
  const scatterColors = sessionScatter.map(p =>
    p.raw < -3 ? '#ef4444' :
    p.raw < -2 ? '#d29922' :
    p.raw < -1 ? '#d4a24c' : '#1D9E7577');

  const incidents = mq.incidentsRecent || [];
  // Fix 6: Collect incident dates for vertical annotation lines (replaces the
  // scatter dataset). Incidents are deduplicated by date; annotation lines span
  // the full chart height so y-axis range doesn't matter.
  const incidentAnnotations = (() => {
    const seen = new Set();
    const out = {};
    incidents.forEach((inc, i) => {
      const day = inc.publishedAt ? inc.publishedAt.slice(0, 10) : null;
      if (!day || !denseLabels.includes(day)) return;
      const key = `incident_${i}`;
      out[key] = {
        type: 'line',
        xMin: day,
        xMax: day,
        borderColor: 'rgba(239,68,68,0.55)',
        borderWidth: 1.5,
        borderDash: [4, 3],
        label: seen.has(day) ? { display: false } : {
          display: true,
          content: '⚠',
          position: 'start',
          backgroundColor: 'transparent',
          color: 'rgba(239,68,68,0.9)',
          font: { size: 9 },
          padding: 1,
          yAdjust: -4,
        },
      };
      seen.add(day);
    });
    return out;
  })();

  // Phase 4.1 — change-point markers. Surface the output of PELT detection
  // as vertical dashed red lines on the trend chart so regime breaks like
  // W11's thinking_depth collapse are visible without staring at the series.
  // Fix 3: changePoint x must match the YYYY-MM-DD label format
  const changePoints = (mq.changePoints || []).map(cp => {
    const day = cp.date || null; // already YYYY-MM-DD from API
    if (!day || !denseLabels.includes(day)) return null;
    return { x: day, shift: cp.shift, prev: cp.prevMean, next: cp.newMean };
  }).filter(Boolean);

  const bioColor = BIO_COLORS.chlorophyll || '#1D9E75';

  const canvasWrapper = document.createElement('div');
  canvasWrapper.style.cssText = 'position:relative;height:260px;';
  const canvas = makeCanvas('mq-trend-chart', 260, 'MQI trend over time: per-session composite z-score with daily mean');
  canvasWrapper.appendChild(canvas);
  panel.appendChild(canvasWrapper);

  // mq-3: subtitle explaining the 2000-session API cap on scatter vs full daily history
  const trendSubtitle = document.createElement('p');
  trendSubtitle.style.cssText = 'font-size:10px;color:var(--cyber-text-dim,#666);font-family:var(--font-mono);margin:2px 0 0;text-align:center;';
  trendSubtitle.textContent = 'Scatter: last 2,000 user sessions (recent window only). Line: full daily history.';
  panel.appendChild(trendSubtitle);

  destroyChart(canvas);

  // Fix 1: data-driven y-axis — tight to actual data ± 0.2 buffer.
  // Must be computed before the chart config so it can also clamp annotation
  // bands to the visible range (Fix 6 removes incident scatter to avoid overflow).
  const _allZ = [
    ...sessionScatter.map(p => p.y),
    ...values.filter(v => typeof v === 'number'),
  ].filter(Number.isFinite);
  const _yMin = _allZ.length ? Math.floor((Math.min(..._allZ) - 0.2) * 4) / 4 : -3;
  const _yMax = _allZ.length ? Math.ceil((Math.max(..._allZ) + 0.2) * 4) / 4 : 1;

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          // Fix 2: order:0 = drawn last = visually on top of line
          label: 'Per-session (user only)',
          type: 'scatter',
          data: sessionScatter,
          borderColor: scatterColors,
          backgroundColor: scatterColors,
          pointRadius: 2,
          pointHoverRadius: 4,
          showLine: false,
          order: 0,
        },
        {
          // Fix 2: order:2 = drawn first = behind scatter dots
          label: 'Daily mean',
          data: values,
          borderColor: bioColor,
          backgroundColor: bioColor + '18',
          borderWidth: 2,
          fill: false,
          tension: 0.25,
          pointRadius: 3,
          pointBackgroundColor: bioColor,
          pointBorderColor: '#fff',
          pointBorderWidth: 1,
          order: 2,
        },
        // Fix 6: incidents removed from datasets; they're now annotation lines
        // (incidentAnnotations object) so y-axis range doesn't affect placement.
      ],
    },
    options: Object.assign({}, CHART_DEFAULTS, {
      scales: {
        x: {
          type: 'category',
          grid: { color: '#333' },
          ticks: {
            color: '#888',
            font: { size: 10 },
            maxTicksLimit: 10,
            // Fix 3: labels are YYYY-MM-DD internally; display as MM-DD only
            callback(val, idx) {
              const lbl = this.getLabelForValue(val);
              return lbl ? lbl.slice(5) : '';
            },
          },
          title: { display: true, text: 'Date (MM-DD)', color: '#666', font: { size: 10 } },
        },
        y: {
          // Fix 1: data-driven bounds replace hardcoded [-3, 1]
          min: _yMin,
          max: _yMax,
          grid: { color: '#333' },
          ticks: {
            color: '#888',
            font: { size: 10 },
            callback(v) { return v === 0 ? 'μ' : (v > 0 ? '+' : '') + v.toFixed(1) + 'σ'; },
          },
          title: { display: true, text: 'Composite Z (session + daily mean)', color: '#666', font: { size: 10 } },
        },
      },
      plugins: {
        annotation: {
          annotations: {
            // Fix 1: band yMin/yMax clamped to visible axis range
            errBand:   { type: 'box', yMin: Math.max(_yMin, -3), yMax: Math.min(_yMax, -2), backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 0 },
            warnBand:  { type: 'box', yMin: Math.max(_yMin, -2), yMax: Math.min(_yMax, -1), backgroundColor: 'rgba(210,153,34,0.08)', borderWidth: 0 },
            watchBand: { type: 'box', yMin: Math.max(_yMin, -1), yMax: Math.min(_yMax, 0),  backgroundColor: 'rgba(212,162,76,0.04)', borderWidth: 0 },
            normBand:  { type: 'box', yMin: Math.max(_yMin, 0),  yMax: Math.min(_yMax, 1),  backgroundColor: 'rgba(29,158,117,0.05)', borderWidth: 0 },
            // Reference lines only drawn if within axis range
            ...(_yMax >= 0 && _yMin <= 0 ? { zero: { type: 'line', yMin: 0, yMax: 0, borderColor: 'rgba(29,158,117,0.8)', borderDash: [6,4], borderWidth: 1.5 } } : {}),
            ...(_yMax >= -1 && _yMin <= -1 ? { zMinusOne: { type: 'line', yMin: -1, yMax: -1, borderColor: '#d4a24c', borderDash: [4, 4], borderWidth: 1 } } : {}),
            ...(_yMax >= -2 && _yMin <= -2 ? { zMinusTwo: { type: 'line', yMin: -2, yMax: -2, borderColor: '#d29922', borderDash: [4, 4], borderWidth: 1 } } : {}),
            ...(_yMax >= -3 && _yMin <= -3 ? { zMinusThree: { type: 'line', yMin: -3, yMax: -3, borderColor: '#ef4444', borderDash: [4, 4], borderWidth: 1 } } : {}),
            // Fix 6: incident vertical lines (x-anchored, no y-overflow risk)
            ...incidentAnnotations,
            // Change-point markers from PELT detection
            ...Object.fromEntries(changePoints.map((cp, i) => [
              `changePoint_${i}`,
              {
                type: 'line',
                xMin: cp.x,
                xMax: cp.x,
                borderColor: 'rgba(220, 80, 60, 0.9)',
                borderWidth: 1.5,
                borderDash: [6, 4],
                label: {
                  display: true,
                  content: `\u0394${cp.shift.toFixed(2)}\u03c3`,
                  position: 'start',
                  backgroundColor: 'rgba(220, 80, 60, 0.85)',
                  color: '#fff',
                  font: { size: 10 },
                  padding: 2,
                },
              },
            ])),
          },
        },
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { color: '#888', font: { size: 10 }, boxWidth: 10, padding: 8 },
        },
        tooltip: {
          callbacks: {
            title(items) {
              const i = items[0];
              // Fix 3: label is YYYY-MM-DD, show as-is in tooltip (full date is useful)
              return typeof i.label === 'string' ? i.label : labels[i.dataIndex] || '';
            },
            label(item) {
              if (item.dataset.label === 'Per-session (user only)') {
                const raw = item.raw && typeof item.raw.raw === 'number' ? item.raw.raw : item.parsed.y;
                return `session z = ${raw.toFixed(2)}\u03c3`;
              }
              const v = item.parsed.y;
              if (v === null || v === undefined) return 'no data this day';
              const suffix = v < -3 ? ' [ERROR]' : v < -2 ? ' [WARNING]' : v < -1 ? ' [WATCH]' : '';
              return `daily mean z = ${v.toFixed(2)}\u03c3${suffix}`;
            },
          },
        },
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Panel 4b: MQI by Model (horizontal bar chart)
// ---------------------------------------------------------------------------

function renderMqiByModel(container, mq) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('MQI BY MODEL'));

  const namedModels = (mq.byModel || []).filter(m => m.model && m.model !== '');
  // mq-6: include empty-string model bucket as "(unknown model)" rather than silently dropping 4,496 sessions
  const unknownBucket = (mq.byModel || []).find(m => !m.model || m.model === '');
  const models = unknownBucket
    ? [...namedModels, { ...unknownBucket, model: '(unknown model)', status: unknownBucket.status || 'unknown' }]
    : namedModels;
  if (!models.length) {
    panel.appendChild(emptyState('No per-model data.'));
    return;
  }

  const canvasWrapper = document.createElement('div');
  canvasWrapper.style.cssText = 'position:relative;height:300px;';
  const canvas = makeCanvas('mqi-by-model', 300, 'MQI by model: composite quality score per model family');
  canvasWrapper.appendChild(canvas);
  panel.appendChild(canvasWrapper);

  // mq-6: add footnote about unknown model sessions
  if (unknownBucket) {
    const unknownNote = document.createElement('p');
    unknownNote.style.cssText = 'font-size:10px;color:var(--cyber-text-dim,#666);font-family:var(--font-mono);margin:2px 0 0;';
    unknownNote.textContent = `(unknown model): ${unknownBucket.sessionCount} sessions where model field is empty in session log.`;
    panel.appendChild(unknownNote);
  }

  destroyChart(canvas);

  // Sort by session count desc so busiest model is on top
  const sorted = [...models].sort((a, b) => b.sessionCount - a.sessionCount);

  function resolveStatusColor(status) {
    switch (status) {
      case 'error':   return { bg: 'rgba(239,68,68,0.6)',   border: '#ef4444' };
      case 'warning': return { bg: 'rgba(210,153,34,0.6)',  border: '#d29922' };
      case 'watch':   return { bg: 'rgba(212,162,76,0.6)',  border: '#d4a24c' };
      case 'green':   return { bg: 'rgba(29,158,117,0.6)',  border: '#1D9E75' };
      default:        return { bg: 'rgba(136,136,136,0.4)', border: '#888' };
    }
  }

  const bgColors     = sorted.map(m => resolveStatusColor(m.status).bg);
  const borderColors = sorted.map(m => resolveStatusColor(m.status).border);

  // Per-session scatter overlay: for each model, plot each session's
  // compositeZ as a dot on the corresponding model's row. This shows the
  // spread around the bar (mean) so outlier sessions are visible.
  const modelLabels = sorted.map(m => `${m.model} (${m.sessionCount})`);
  const modelToLabel = new Map(sorted.map(m => [m.model, `${m.model} (${m.sessionCount})`]));
  const sessionDots = (mq.sessions || [])
    .filter(s => !s.isAutomated && s.model && s.mqi && typeof s.mqi.compositeZ === 'number' && modelToLabel.has(s.model))
    .map(s => ({
      x: Math.max(-3.5, Math.min(1, s.mqi.compositeZ)),
      y: modelToLabel.get(s.model),
      raw: s.mqi.compositeZ,
      status: s.mqi.status || 'green',
    }));
  const dotColors = sessionDots.map(d =>
    d.raw < -3 ? '#ef4444' :
    d.raw < -2 ? '#d29922' :
    d.raw < -1 ? '#d4a24c' : '#1D9E75aa');

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: modelLabels,
      datasets: [
        {
          label: 'Mean Composite Z',
          data: sorted.map(m => m.compositeZ),
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 1.5,
        },
        {
          type: 'scatter',
          label: 'Per-session',
          data: sessionDots,
          backgroundColor: dotColors,
          borderColor: dotColors,
          pointRadius: 2.5,
          pointHoverRadius: 5,
          order: 0, // draw on top of bars
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: 'Composite Z (σ from baseline)', color: '#888' },
          grid: { color: '#333' },
          ticks: { color: '#888' },
        },
        y: {
          title: { display: true, text: 'Model', color: '#888' },
          grid: { color: '#333' },
          ticks: { color: '#888', font: { size: 11 } },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: { color: '#888', font: { size: 10 }, boxWidth: 10, padding: 8 },
        },
        annotation: {
          annotations: {
            baseline: { type: 'line', xMin: 0, xMax: 0, borderColor: 'rgba(29,158,117,0.7)', borderDash: [6, 4], borderWidth: 1.5 },
            watch: { type: 'line', xMin: -1, xMax: -1, borderColor: '#d4a24c', borderDash: [4, 4], borderWidth: 1 },
            warn:  { type: 'line', xMin: -2, xMax: -2, borderColor: '#d29922', borderDash: [4, 4], borderWidth: 1 },
            err:   { type: 'line', xMin: -3, xMax: -3, borderColor: '#ef4444', borderDash: [4, 4], borderWidth: 1 },
          },
        },
        tooltip: {
          callbacks: {
            label(item) {
              if (item.dataset.label === 'Per-session') {
                const p = item.raw;
                const raw = p && typeof p.raw === 'number' ? p.raw : item.parsed.x;
                // mq-7: use bracket convention to avoid "· error" looking like a JS error
                const st = p ? p.status : 'green';
                const stLabel = st === 'error' ? ' [ERROR]' : st === 'warning' ? ' [WARNING]' : st === 'watch' ? ' [WATCH]' : '';
                return `session z = ${raw.toFixed(2)}σ${stLabel}`;
              }
              const m = sorted[item.dataIndex];
              return [
                'Mean Z: ' + (m.compositeZ || 0).toFixed(3),
                'Status: ' + (m.status || 'green'),
                'Sessions: ' + m.sessionCount,
              ];
            },
          },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Panel 5: Version Comparison (bar chart)
// ---------------------------------------------------------------------------

function renderVersionComparison(container, mq) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('MQI by CC Version'));

  const byVersion = (mq.byVersion || []).filter(function(v) { return v.ccVersion && v.ccVersion !== ''; });
  if (!byVersion.length) {
    panel.appendChild(emptyState('No version data available.'));
    return;
  }

  const sorted = byVersion.slice().sort(function(a, b) {
    return (a.firstDate || '').localeCompare(b.firstDate || '');
  });
  const labels = sorted.map(function(v) { return v.ccVersion || 'unknown'; });
  // v3: use compositeZ directly; fall back to mqi*100 for legacy data
  const values = sorted.map(function(v) {
    return v.compositeZ !== undefined ? parseFloat(v.compositeZ.toFixed(3)) : parseFloat((v.mqi * 100).toFixed(2));
  });

  const colors = sorted.map(function(v) { return statusColor(v.status || 'green'); });

  const canvasWrapper = document.createElement('div');
  canvasWrapper.style.cssText = 'position:relative;height:220px;';
  const canvas = makeCanvas('mq-version-chart', 220, 'MQI by Claude Code version: mean composite score per version');
  canvasWrapper.appendChild(canvas);
  panel.appendChild(canvasWrapper);

  destroyChart(canvas);

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map(function(c) { return c.replace('var(--bio-growth, #1D9E75)', 'rgba(29,158,117,0.6)').replace('var(--bio-bug, #ef4444)', 'rgba(239,68,68,0.6)').replace('#d29922', 'rgba(210,153,34,0.6)').replace('#d4a24c', 'rgba(212,162,76,0.6)').replace('var(--cyber-text-dim, #666)', 'rgba(136,136,136,0.4)'); }),
        borderColor: colors,
        borderWidth: 1.5,
        borderRadius: 4,
      }],
    },
    options: Object.assign({}, CHART_DEFAULTS, {
      scales: {
        x: {
          grid: { color: '#333' },
          ticks: { color: '#888', font: { size: 10 } },
          title: { display: true, text: 'Claude Code version', color: '#666', font: { size: 10 } },
        },
        y: {
          // mq-5: clamp axis to data range + padding so variation is visible;
          // only extend to annotation thresholds when data actually reaches them.
          min: Math.min(...values) - 0.3,
          max: Math.max(...values, 0) + 0.15,
          grid: { color: '#333' },
          ticks: { color: '#888', font: { size: 10 } },
          title: { display: true, text: 'Composite Z (σ from baseline)', color: '#666', font: { size: 10 } },
        },
      },
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: Object.assign(
            {},
            // Only include warn/err lines when data reaches those thresholds;
            // omitting prevents Chart.js from forcibly expanding the axis.
            Math.min(...values) < -1.5 ? { warnLine: { type: 'line', yMin: -2, yMax: -2, borderColor: '#d29922', borderDash: [4, 4], borderWidth: 1 } } : {},
            Math.min(...values) < -2.5 ? { errLine:  { type: 'line', yMin: -3, yMax: -3, borderColor: '#ef4444', borderDash: [4, 4], borderWidth: 1 } } : {},
            // Always show a baseline reference at 0
            { baseline: { type: 'line', yMin: 0, yMax: 0, borderColor: 'rgba(29,158,117,0.7)', borderDash: [6, 4], borderWidth: 1.5 } }
          ),
        },
        tooltip: {
          callbacks: {
            label: function(item) {
              const v = sorted[item.dataIndex];
              return ['Composite Z: ' + item.parsed.y.toFixed(3), 'Status: ' + (v.status || 'green'), 'Sessions: ' + v.sessionCount];
            },
          },
        },
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Panel 6: Hourly Thinking Depth (bar chart)
// ---------------------------------------------------------------------------

// Weekday thinking depth: aggregates each session's raw thinking_depth metric
// by the local weekday of session end. Gives a weekly-rhythm view that
// complements the hourly panel. Bars colored by deviation from baseline μ.
function renderWeekdayThinking(container, mq) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('Thinking Depth by Day of Week'));

  const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const buckets = [0,1,2,3,4,5,6].map(() => ({ sum: 0, n: 0 }));

  for (const s of (mq.sessions || [])) {
    if (s.isAutomated) continue;
    if (!s.endIso || !s.mqi || !Array.isArray(s.mqi.metrics)) continue;
    const td = s.mqi.metrics.find(m => m.name === 'thinking_depth');
    if (!td || typeof td.raw !== 'number') continue;
    const d = new Date(s.endIso);
    if (isNaN(d.getTime())) continue;
    const dow = d.getDay(); // 0=Sun..6=Sat, local time
    buckets[dow].sum += td.raw;
    buckets[dow].n += 1;
  }

  const means = buckets.map(b => b.n > 0 ? b.sum / b.n : 0);
  const counts = buckets.map(b => b.n);
  const hasData = counts.some(n => n > 0);
  if (!hasData) {
    panel.appendChild(emptyState('No per-session thinking-depth data available.'));
    return;
  }

  // Pull baseline thinking_depth μ to color-code deviation.
  const baseTd = (mq.baseline && Array.isArray(mq.baseline.perMetric))
    ? mq.baseline.perMetric[2]   // thinking_depth is index 2
    : null;
  const baseMu    = baseTd ? baseTd.mu    : null;
  const baseSigma = baseTd ? baseTd.sigma : null;
  const colorFor = v => {
    if (!baseMu || !baseSigma || baseSigma <= 0) return '#1D9E75';
    const z = (v - baseMu) / baseSigma;
    if (z < -3) return '#ef4444';
    if (z < -2) return '#d29922';
    if (z < -1) return '#d4a24c';
    return '#1D9E75';
  };
  const barColors = means.map(colorFor);

  const canvasWrapper = document.createElement('div');
  canvasWrapper.style.cssText = 'position:relative;height:220px;';
  const canvas = makeCanvas('mq-weekday-thinking', 220, 'Mean thinking depth by weekday');
  canvasWrapper.appendChild(canvas);
  panel.appendChild(canvasWrapper);

  destroyChart(canvas);

  const annotations = {};
  if (baseMu !== null) {
    annotations.baselineLine = {
      type: 'line', yMin: baseMu, yMax: baseMu,
      borderColor: 'rgba(29,158,117,0.7)', borderDash: [6, 4], borderWidth: 1.5,
      label: {
        display: true,
        content: `baseline μ = ${Math.round(baseMu)}`,
        position: 'end',
        color: '#1D9E75',
        backgroundColor: 'rgba(0,0,0,0.6)',
        font: { size: 9 },
        padding: { top: 2, bottom: 2, left: 4, right: 4 },
      },
    };
  }

  // Pin y-axis to the baseline μ (our "max" reference value). Bars below
  // show how far below baseline we are; if we ever exceed μ on a day, the
  // bar extends past the reference line and the ceiling auto-expands to
  // accommodate it.
  const barMax = Math.max(...means);
  const yMax = baseMu ? Math.max(baseMu * 1.02, barMax * 1.1) : (barMax * 1.1 || 1);

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: DOW_LABELS,
      datasets: [{
        data: means.map(m => Math.round(m)),
        backgroundColor: barColors,
        borderColor: barColors.map(c => c + 'cc'),
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    options: Object.assign({}, CHART_DEFAULTS, {
      scales: {
        x: {
          grid: { color: '#333' },
          ticks: { color: '#888', font: { size: 10 } },
          title: { display: true, text: 'Day of week', color: '#666', font: { size: 10 } },
        },
        y: {
          min: 0,
          max: yMax,
          grid: { color: '#333' },
          ticks: { color: '#888', font: { size: 10 } },
          title: { display: true, text: 'Mean thinking_depth (chars) · top = baseline μ', color: '#666', font: { size: 10 } },
        },
      },
      plugins: {
        legend: { display: false },
        annotation: { annotations },
        tooltip: {
          callbacks: {
            title: items => `${DOW_LABELS[items[0].dataIndex]} (n=${counts[items[0].dataIndex]})`,
            label(item) {
              const v = item.parsed.y;
              const z = (baseMu && baseSigma && baseSigma > 0) ? (v - baseMu) / baseSigma : null;
              const zStr = z !== null ? ` · z=${z.toFixed(2)}σ` : '';
              return `mean = ${Math.round(v).toLocaleString()} chars${zStr}`;
            },
          },
        },
      },
    }),
  });
}

function renderHourlyThinking(container, mq) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('Hourly Thinking Depth (PST)'));

  const byHour = mq.byHour || [];

  // 24-slot array filled with zeros
  const hourMap = [];
  for (let i = 0; i < 24; i++) {
    hourMap.push({ meanSignatureLength: 0, estimatedThinkingChars: 0, sampleCount: 0 });
  }
  for (const h of byHour) {
    const idx = h.hourPst;
    if (idx >= 0 && idx < 24) {
      hourMap[idx] = {
        meanSignatureLength: h.meanSignatureLength || 0,
        estimatedThinkingChars: h.estimatedThinkingChars || 0,
        sampleCount: h.sampleCount || 0,
      };
    }
  }

  const values = hourMap.map(function(h) { return Math.round(h.meanSignatureLength); });
  const maxVal = Math.max.apply(null, values.concat([1]));

  const barColors = values.map(function(v) {
    const t = v / maxVal;
    if (t >= 0.66) return '#1D9E75';
    if (t >= 0.33) return '#d29922';
    return '#ef4444';
  });

  const canvasWrapper = document.createElement('div');
  canvasWrapper.style.cssText = 'position:relative;height:220px;';
  const canvas = makeCanvas('mq-hourly-chart', 220, 'Mean signature length by hour of day');
  canvasWrapper.appendChild(canvas);
  panel.appendChild(canvasWrapper);

  destroyChart(canvas);

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: HOUR_LABELS,
      datasets: [{
        data: values,
        backgroundColor: barColors,
        borderColor: barColors.map(function(c) { return c + 'cc'; }),
        borderWidth: 1,
        borderRadius: 2,
      }],
    },
    options: Object.assign({}, CHART_DEFAULTS, {
      scales: {
        x: {
          grid: { color: '#333' },
          ticks: { color: '#888', font: { size: 9 } },
          title: { display: true, text: 'Hour of day (PST)', color: '#666', font: { size: 10 } },
        },
        y: {
          grid: { color: '#333' },
          ticks: { color: '#888', font: { size: 10 } },
          title: { display: true, text: 'Mean signature length (chars)', color: '#666', font: { size: 10 } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function(items) { return 'Hour: ' + HOUR_LABELS[items[0].dataIndex] + ' PST'; },
            label: function(item) {
              const h = hourMap[item.dataIndex];
              return [
                'Mean sig length: ' + item.parsed.y.toLocaleString() + ' chars',
                'Est. thinking: ' + Math.round(h.estimatedThinkingChars).toLocaleString() + ' chars',
                'Samples: ' + h.sampleCount,
              ];
            },
          },
        },
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Panel 7: Stop Hook Violations (bar chart or empty state)
// ---------------------------------------------------------------------------

function renderStopHookViolations(container, state) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('Stop Hook Violations by Date'));

  const hookEvents = (state.rawData && state.rawData.hookEvents) ? state.rawData.hookEvents : [];

  // Violations: Stop/SubagentStop events with non-200 status
  const violations = hookEvents.filter(function(e) {
    return (e.hook === 'Stop' || e.hook === 'SubagentStop') && e.status !== 200;
  });

  if (!violations.length) {
    panel.appendChild(emptyState('No stop hook violations recorded yet.'));
    return;
  }

  // Group by date
  const byDate = {};
  for (const v of violations) {
    const date = (v.timestamp || '').slice(0, 10);
    if (!date) continue;
    byDate[date] = (byDate[date] || 0) + 1;
  }

  const dates = Object.keys(byDate).sort();
  const counts = dates.map(function(d) { return byDate[d]; });
  const labels = dates.map(function(d) {
    const parts = d.split('-');
    return parts[1] + '-' + parts[2];
  });

  const canvasWrapper = document.createElement('div');
  canvasWrapper.style.cssText = 'position:relative;height:220px;';
  const canvas = makeCanvas('mq-violations-chart', 220, 'MQI rule violations count per day');
  canvasWrapper.appendChild(canvas);
  panel.appendChild(canvasWrapper);

  destroyChart(canvas);

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: '#ef4444aa',
        borderColor: '#ef4444',
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: Object.assign({}, CHART_DEFAULTS, {
      scales: {
        x: {
          grid: { color: '#333' },
          ticks: { color: '#888', font: { size: 10 } },
        },
        y: {
          grid: { color: '#333' },
          ticks: { color: '#888', font: { size: 10 }, stepSize: 1 },
          title: { display: true, text: 'Violation Count', color: '#666', font: { size: 10 } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(item) { return 'Violations: ' + item.parsed.y; },
          },
        },
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Panel 7: External Signals (incidents + issue velocity)
// ---------------------------------------------------------------------------

function renderExternalSignals(container, mq) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('External Signals'));

  const incidents = mq.incidentsRecent || [];
  panel.appendChild(makeEl('h4',
    'font-family:var(--font-mono);font-size:12px;color:var(--cyber-text-dim,#888);margin:0 0 8px 0;',
    `Status.claude.com incidents (${incidents.length}, last 30d)`));

  if (!incidents.length) {
    panel.appendChild(emptyState('No incidents in the last 30 days.'));
  } else {
    const incList = makeEl('div', 'display:flex;flex-direction:column;gap:4px;max-height:240px;overflow:auto;');
    incidents.slice(0, 20).forEach(inc => {
      const severity = inc.severity === 'resolved' ? 'green' : 'warning';
      const row = makeEl('div',
        `padding:6px 8px;border-left:2px solid ${statusColor(severity)};background:var(--cyber-surface-2,#0d1117);font-family:var(--font-mono);font-size:11px;`);
      row.appendChild(makeEl('div',
        'color:var(--cyber-text-bright,#c8c8c0);',
        inc.title));
      const meta = `${inc.publishedAt} - ${(inc.affectedModels || []).join(', ') || 'all models'} - ${inc.severity}`;
      row.appendChild(makeEl('div',
        'color:var(--cyber-text-dim,#888);font-size:10px;',
        meta));
      incList.appendChild(row);
    });
    panel.appendChild(incList);
  }

  panel.appendChild(makeEl('h4',
    'font-family:var(--font-mono);font-size:12px;color:var(--cyber-text-dim,#888);margin:16px 0 8px 0;',
    'Issue velocity (anthropics/claude-code, 7d rolling)'));

  const series = mq.issueVelocitySeries || [];
  if (!series.length) {
    panel.appendChild(emptyState('No issue velocity data.'));
  } else {
    const sparkCounts = series.map(p => p.count);
    const maxCount = Math.max(...sparkCounts, 0);
    // Use bar type for better visibility on sparse data; switch to line only when lots of nonzero points
    const nonzero = sparkCounts.filter(c => c > 0).length;
    const chartType = nonzero >= 5 ? 'line' : 'bar';

    const canvasWrapper2 = document.createElement('div');
    canvasWrapper2.style.cssText = 'position:relative;height:140px;';
    const canvas = makeCanvas('issue-velocity-spark', 140, 'Issue velocity sparkline: open issues by day');
    canvasWrapper2.appendChild(canvas);
    panel.appendChild(canvasWrapper2);

    destroyChart(canvas);
    new Chart(canvas, {
      type: chartType,
      data: {
        labels: series.map(p => p.date.slice(5)),
        datasets: [{
          data: sparkCounts,
          borderColor: '#d29922',
          backgroundColor: 'rgba(210,153,34,0.25)',
          fill: true,
          tension: 0.2,
          pointRadius: chartType === 'line' ? 2 : 0,
          borderRadius: chartType === 'bar' ? 2 : 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { color: '#333' },
            ticks: { color: '#888', font: { size: 9 }, maxTicksLimit: 10 },
            title: { display: true, text: 'Date (MM-DD)', color: '#666', font: { size: 10 } },
          },
          y: {
            grid: { color: '#333' },
            ticks: { color: '#888', font: { size: 10 }, stepSize: maxCount <= 5 ? 1 : undefined },
            min: 0,
            title: { display: true, text: 'Issue count', color: '#666', font: { size: 10 } },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function(items) { return series[items[0].dataIndex].date; },
              label: function(item) { return 'Issues: ' + item.parsed.y; },
            },
          },
        },
      },
    });
    if (maxCount === 0) {
      const note = makeEl('div',
        'font-family:var(--font-mono);font-size:10px;color:var(--cyber-text-dim,#666);margin-top:4px;text-align:center;',
        'All counts are zero (no MODEL-labeled issues in the last 30 days — healthy signal).');
      panel.appendChild(note);
    }
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function renderModelQualityView(state) {
  const container = document.getElementById('model-quality-view');
  if (!container) return;

  // Clear previous content safely
  clearNode(container);

  const rawMq = state.rawData && state.rawData.modelQuality;
  if (!rawMq || !rawMq.currentMqi) {
    container.appendChild(emptyState('No model quality data available. Run the ingest pipeline to generate data.'));
    return;
  }

  // ---------------------------------------------------------------------------
  // Date range filtering: convert Date objects to ISO strings for comparison
  // ---------------------------------------------------------------------------
  const { dateRange } = state;
  const fromStr = dateRange.from ? toISODate(dateRange.from) : null;
  const toStr = dateRange.to ? toISODate(dateRange.to) : null;

  const inRange = function(dateStr) {
    if (!dateStr) return false;
    if (fromStr && dateStr < fromStr) return false;
    if (toStr && dateStr > toStr) return false;
    return true;
  };

  // Filter daily entries by date range
  const filteredDaily = (rawMq.daily || []).filter(function(d) { return inRange(d.date); });

  // MQI v3: currentMqi is already the 30-day-mean SessionSnapshot from ingest
  // {compositeZ, mqiX, status, metrics:[{name, raw, z, status, weight, source}]}.
  // Date-range filtering on the score card is a v2 concept that doesn't translate —
  // the ingest-side computation is authoritative. Keep the filter on daily/version
  // breakdowns below, but surface currentMqi as-is.
  const filteredMqi = rawMq.currentMqi;

  // mq-4: use rawMq.byVersion directly (preserves all minority versions) filtered by date
  // overlap rather than re-aggregating from daily[].dominantVersion which collapses minority
  // versions into whichever version dominated each day, silently dropping versions.
  var filteredByVersion = [];
  if (fromStr || toStr) {
    // Keep a version if its usage window overlaps the selected date range
    filteredByVersion = (rawMq.byVersion || []).filter(function(v) {
      var vFirst = v.firstDate || '';
      var vLast  = v.lastDate  || '';
      if (toStr && vFirst > toStr) return false;
      if (fromStr && vLast < fromStr) return false;
      return true;
    });
  } else {
    filteredByVersion = rawMq.byVersion || [];
  }

  // Filter hook events by date range
  var filteredHookEvents = (state.rawData && state.rawData.hookEvents) || [];
  if (fromStr || toStr) {
    filteredHookEvents = filteredHookEvents.filter(function(e) {
      var ts = (e.timestamp || '').slice(0, 10);
      return inRange(ts);
    });
  }

  // Build filtered mq object
  const mq = {
    currentMqi: filteredMqi,
    currentMqi7d: rawMq.currentMqi7d || null,                    // Phase 0.2
    compositeStdEmpirical: rawMq.compositeStdEmpirical ?? 1.0,   // Phase 1.4
    compositeAttribution: rawMq.compositeAttribution || [],      // Phase 0.3
    latestSessionMqi: rawMq.latestSessionMqi || null,
    baselineMqi: rawMq.baselineMqi,
    baseline: rawMq.baseline,
    daily: filteredDaily,
    byVersion: filteredByVersion,
    byHour: rawMq.byHour,       // hourly is global (no per-day hourly data available)
    byModel: rawMq.byModel,
    keywordTracker: rawMq.keywordTracker, // global (no per-day keyword data available)
    incidentsRecent: rawMq.incidentsRecent || [],
    issueVelocitySeries: rawMq.issueVelocitySeries || [],
    pipelineLastRun: rawMq.pipelineLastRun || null,
    sessions: rawMq.sessions || [],   // 200 most-recent SessionListEntry for picker
  };

  // ---------------------------------------------------------------------------
  // Sigma bands + degradation from filtered daily data
  // ---------------------------------------------------------------------------
  const dailyMqiValues = (mq.daily || []).map(function(d) { return d.mqi * 100; });
  const bands = computeSigmaBands(dailyMqiValues);

  const latestDaily = (mq.daily || []).slice(-1)[0];
  const latestPct = latestDaily ? latestDaily.mqi * 100 : null;
  const degradeLevel = !bands || latestPct === null ? 'normal'
    : latestPct < bands.sigma3Low ? 'error'
    : latestPct < bands.sigma2Low ? 'warning'
    : 'normal';

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  const root = document.createElement('div');
  root.style.cssText = [
    'display: flex',
    'flex-direction: column',
    'gap: var(--space-md, 16px)',
    'max-width: 1100px',
    'margin: 0 auto',
    'width: 100%',
    'padding-bottom: 48px',
  ].join(';');
  container.appendChild(root);

  // Freshness ribbon (Task 24)
  const last = mq.pipelineLastRun ? new Date(mq.pipelineLastRun) : null;
  const minutesAgo = last ? Math.round((Date.now() - last.getTime()) / 60000) : '?';
  const incCount = (mq.incidentsRecent || []).length;
  const velLen = (mq.issueVelocitySeries || []).length;
  const freshness = makeEl('div',
    'font-family:var(--font-mono);font-size:11px;color:var(--cyber-text-dim,#666);margin:0 0 12px 0;',
    `Signals: pipeline T-${minutesAgo}m - recent incidents: ${incCount} - velocity series: ${velLen} days`);
  root.appendChild(freshness);

  // Page title
  const title = document.createElement('h1');
  title.textContent = 'Model Quality';
  title.style.cssText = [
    'font-family: var(--font-mono)',
    'font-size: 24px',
    'font-weight: 700',
    'color: var(--cyber-text-bright, #c8c8c0)',
    'margin: 0',
  ].join(';');
  root.appendChild(title);

  // New: 7d divergence + attribution + sigma calibration (Phases 0.2, 0.3, 1.4)
  renderDivergenceAndAttribution(root, mq);

  // Radar chart + legend (replaces Behavioral Catalog as default view)
  renderGroupRadar(root, mq);
  renderGroupLegend(root, mq);

  // External signals panel
  renderExternalSignals(root, mq);

  // Charts row 1: trend + version comparison
  const chartsRow = document.createElement('div');
  chartsRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md,16px);';
  root.appendChild(chartsRow);

  renderMqiTrend(chartsRow, mq);
  renderVersionComparison(chartsRow, mq);

  // Model + combined score/keyword card row (both equal-width cards).
  const modelsRow = document.createElement('div');
  modelsRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md,16px);';
  root.appendChild(modelsRow);

  renderMqiByModel(modelsRow, mq);
  renderScoreKeywordCombined(modelsRow, mq);

  // Plan F: per-model degradation table (top-K baseline aware).
  const degradationSection = document.createElement('div');
  root.appendChild(degradationSection);
  renderDegradationByModel(degradationSection, mq);

  const thinkingRow = document.createElement('div');
  thinkingRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md,12px);';
  root.appendChild(thinkingRow);
  renderHourlyThinking(thinkingRow, mq);
  renderWeekdayThinking(thinkingRow, mq);
}

// ---------------------------------------------------------------------------
// Plan F (2026-04-24): per-model degradation table, built via DOM API
// (no innerHTML). Each session's composite_z was computed against its OWN
// model's top-K baseline so cross-model aggregate comparison is fair.
// ---------------------------------------------------------------------------

function renderDegradationByModel(container, mq) {
  const panel = panelDiv('');
  container.appendChild(panel);
  panel.appendChild(sectionHeader('MODEL DEGRADATION (vs own top-K cohort)'));

  const note = makeEl('div',
    'font-family:var(--font-mono);font-size:10px;color:var(--cyber-text-dim,#666);margin:0 0 8px 0;',
    'Each row is scored against that model\u2019s own top-20% sessions per metric (Plan F). Average z sits negative by construction; watch rate (< -1\u03c3) and top contributor are the real signals.');
  panel.appendChild(note);

  const tableWrap = document.createElement('div');
  tableWrap.style.cssText = 'overflow-x:auto;';
  panel.appendChild(tableWrap);

  // Try API first, fall back to mq.byModel for standalone mode
  const fallbackRows = (mq && mq.byModel || []).map(function(m) {
    return {
      model: m.model,
      n: m.sessionCount,
      avgMqiX: m.avgMqiX,
      avgZ: m.avgZ,
      watchPct: 0,
      degradedPct: 0,
      topContributor: null,
      topContributorZ: null
    };
  });

  function renderDegradationTable(rows) {
    if (!rows.length) {
      tableWrap.appendChild(emptyState('No per-model data yet. Run the ingest pipeline.'));
      return;
    }
    var table = document.createElement('table');
    table.style.cssText = 'width:100%;font-family:var(--font-mono);font-size:11px;border-collapse:collapse;';
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    headRow.style.cssText = 'text-align:left;color:#888;border-bottom:1px solid #333;';
    var headers = [
      ['Model', 'left'],
      ['Sessions', 'right'],
      ['Avg MQI-X', 'right'],
      ['Avg z', 'right'],
      ['Watch % (z<-1)', 'right'],
      ['Degraded % (z<-2)', 'right'],
      ['Top Contributor', 'left'],
    ];
    for (var h = 0; h < headers.length; h++) {
      var th = document.createElement('th');
      th.textContent = headers[h][0];
      th.style.cssText = 'padding:6px 8px;text-align:' + headers[h][1] + ';';
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var wpct = Number(r.watchPct || 0);
      var wColor = wpct >= 30 ? '#ef4444' : wpct >= 10 ? '#d29922' : '#3fb950';
      var tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid #222;';

      var cellSpecs = [
        [String(r.model || ''), 'padding:6px 8px;color:#c8c8c0;'],
        [Number(r.n || 0).toLocaleString(), 'padding:6px 8px;text-align:right;'],
        [Number(r.avgMqiX || 0).toFixed(1), 'padding:6px 8px;text-align:right;'],
        [Number(r.avgZ || 0).toFixed(2), 'padding:6px 8px;text-align:right;'],
        [wpct.toFixed(1) + '%', 'padding:6px 8px;text-align:right;color:' + wColor + ';'],
        [Number(r.degradedPct || 0).toFixed(1) + '%', 'padding:6px 8px;text-align:right;'],
        [(r.topContributor || '\u2013') + ' (z=' + (r.topContributorZ || '\u2013') + ')', 'padding:6px 8px;color:#888;'],
      ];
      for (var c = 0; c < cellSpecs.length; c++) {
        var td = document.createElement('td');
        td.textContent = cellSpecs[c][0];
        td.style.cssText = cellSpecs[c][1];
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  fetch('/api/mqi/degradation-by-model')
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(body) {
      renderDegradationTable(body.byModel || fallbackRows);
    })
    .catch(function(e) {
      // Fallback to mq.byModel for standalone mode
      renderDegradationTable(fallbackRows);
    });
}
