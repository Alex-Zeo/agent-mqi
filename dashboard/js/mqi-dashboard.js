/**
 * MQI Dashboard - Standalone Model Quality Index visualization
 *
 * This dashboard consumes JSON output from the agent-mqi Rust library
 * and renders the 24-metric composite score with interactive visualizations.
 */

const METRIC_NAMES = [
  'read_edit_ratio', 'research_mutation_ratio', 'thinking_depth',
  'edits_without_read', 'write_edit_ratio', 'reasoning_loops',
  'simplest_fix', 'premature_stopping', 'user_interrupts',
  'repeated_edits', 'self_admitted_failures', 'keyword_sentiment',
  'stop_hook_violations', 'zero_reasoning_turn_rate', 'reversion_rate',
  'post_compaction_drift', 'human_time_estimation', 're_instruction_rate',
  'incident_exposure', 'issue_velocity', 'redaction_rate',
  'implicit_constraint_violator', 'trial_and_error_debugging',
  'token_rate_per_minute'
];

const METRIC_LABELS = [
  'Read:Edit Ratio', 'Research:Mutation', 'Thinking Depth',
  'Edits w/o Read', 'Write:Edit Ratio', 'Reasoning Loops',
  'Simplest Fix', 'Premature Stopping', 'User Interrupts',
  'Repeated Edits', 'Self-Admitted Failures', 'Keyword Sentiment',
  'Stop Hook Violations', 'Zero-Reasoning Turns', 'Reversion Rate',
  'Post-Compaction Drift', 'Human Time Estimation', 'Re-Instruction Rate',
  'Incident Exposure', 'Issue Velocity', 'Redaction Rate',
  'Implicit Constraint Violator', 'Trial-and-Error Debugging',
  'Token Rate (tok/min)'
];

const METRIC_GROUPS = [
  { name: 'Thinking', weight: 0.19, metrics: ['thinking_depth', 'reasoning_loops', 'zero_reasoning_turn_rate', 'redaction_rate'] },
  { name: 'Research', weight: 0.16, metrics: ['read_edit_ratio', 'research_mutation_ratio', 'simplest_fix'] },
  { name: 'Execution', weight: 0.23, metrics: ['edits_without_read', 'write_edit_ratio', 'repeated_edits', 'reversion_rate', 'post_compaction_drift', 'stop_hook_violations', 'premature_stopping', 'human_time_estimation', 'trial_and_error_debugging'] },
  { name: 'Trust', weight: 0.18, metrics: ['user_interrupts', 'keyword_sentiment', 're_instruction_rate', 'implicit_constraint_violator', 'self_admitted_failures'] },
  { name: 'Throughput', weight: 0.05, metrics: ['token_rate_per_minute'] },
  { name: 'Environment', weight: 0.19, metrics: ['incident_exposure', 'issue_velocity'] }
];

let state = { data: null, dateRange: { from: null, to: null } };

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function statusClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'green' || s === 'ok') return 'status-green';
  if (s === 'yellow' || s === 'warning' || s === 'watch') return 'status-yellow';
  if (s === 'red' || s === 'error') return 'status-red';
  return '';
}

function mqiColorClass(score) {
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

function renderScoreCard(container, data) {
  const panel = el('div', 'panel');
  const header = el('div', 'panel-header', 'MQI Score & Status');
  panel.appendChild(header);

  const card = el('div', 'score-card');

  const scoreMain = el('div', 'score-main');
  scoreMain.appendChild(el('div', 'score-label', 'MQI-X'));
  const scoreVal = el('div', 'score-value ' + mqiColorClass(data.mqi_x), data.mqi_x.toFixed(1));
  scoreMain.appendChild(scoreVal);
  scoreMain.appendChild(el('div', 'score-meta', '/ 100 (z=' + data.composite_z.toFixed(2) + ')'));
  card.appendChild(scoreMain);

  const stats = el('div', 'stats-grid');

  const addStat = (label, value, cls) => {
    const item = el('div', 'stat-item');
    item.appendChild(el('div', 'stat-label', label));
    item.appendChild(el('div', 'stat-value ' + (cls || ''), value));
    stats.appendChild(item);
  };

  addStat('Status', (data.status || 'unknown').toUpperCase(), statusClass(data.status));
  addStat('Composite Z', data.composite_z.toFixed(2));
  addStat('Baseline', (data.baseline_sessions || '---') + ' sessions');
  addStat('Model', data.model || 'unknown');

  card.appendChild(stats);
  panel.appendChild(card);
  container.appendChild(panel);
}

function renderMetricsTable(container, metrics) {
  const panel = el('div', 'panel');
  panel.appendChild(el('div', 'panel-header', 'Behavioral Catalog (24 Metrics)'));

  const table = el('table', 'metrics-table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Metric', 'Raw', 'Z-Score', 'Status', 'Weight'].forEach(h => {
    headerRow.appendChild(el('th', '', h));
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let i = 0; i < METRIC_NAMES.length; i++) {
    const name = METRIC_NAMES[i];
    const label = METRIC_LABELS[i];
    const m = metrics.find(x => x.name === name) || {};

    const tr = document.createElement('tr');
    tr.appendChild(el('td', '', label));
    tr.appendChild(el('td', '', m.raw !== undefined ? m.raw.toFixed(3) : '---'));
    tr.appendChild(el('td', statusClass(m.status), m.z !== undefined ? m.z.toFixed(2) : '---'));
    tr.appendChild(el('td', statusClass(m.status), (m.status || '---').toUpperCase()));
    tr.appendChild(el('td', '', m.weight !== undefined ? (m.weight * 100).toFixed(0) + '%' : '---'));
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  panel.appendChild(table);
  container.appendChild(panel);
}

function renderGroupSummary(container, metrics) {
  const panel = el('div', 'panel');
  panel.appendChild(el('div', 'panel-header', 'MQI by Group'));

  const grid = el('div', 'stats-grid');

  for (const group of METRIC_GROUPS) {
    const groupMetrics = metrics.filter(m => group.metrics.includes(m.name));
    const avgZ = groupMetrics.length > 0
      ? groupMetrics.reduce((s, m) => s + (m.z || 0), 0) / groupMetrics.length
      : 0;

    const item = el('div', 'stat-item');
    item.appendChild(el('div', 'stat-label', group.name + ' (' + (group.weight * 100).toFixed(0) + '%)'));
    const cls = avgZ < -1 ? 'status-red' : avgZ < 0 ? 'status-yellow' : 'status-green';
    item.appendChild(el('div', 'stat-value ' + cls, 'z=' + avgZ.toFixed(2)));
    grid.appendChild(item);
  }

  panel.appendChild(grid);
  container.appendChild(panel);
}

function render(data) {
  const container = document.getElementById('mqi-dashboard');
  while (container.firstChild) container.removeChild(container.firstChild);

  if (!data) {
    const msg = el('div', 'panel');
    msg.appendChild(el('p', '', 'No data loaded. Use the agent-mqi library to generate session scores.'));
    container.appendChild(msg);
    return;
  }

  renderScoreCard(container, data);
  renderGroupSummary(container, data.metrics || []);
  renderMetricsTable(container, data.metrics || []);
}

function toISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function setPeriod(period) {
  const to = new Date();
  to.setHours(23, 59, 59, 999);

  let from;
  const PERIOD_DAYS = { today: 0, week: 7, month: 30, quarter: 90, all: 180 };

  if (period === 'today') {
    from = new Date();
    from.setHours(0, 0, 0, 0);
  } else {
    from = daysAgo(PERIOD_DAYS[period] || 180);
  }

  state.dateRange = { from, to };

  document.querySelectorAll('.period-pill').forEach(pill => {
    pill.classList.toggle('period-pill--active', pill.dataset.period === period);
  });

  document.getElementById('date-from').value = toISODate(from);
  document.getElementById('date-to').value = toISODate(to);
}

async function loadData() {
  try {
    const resp = await fetch('data/demo.json');
    if (resp.ok) {
      state.data = await resp.json();
      render(state.data);
    } else {
      render(null);
    }
  } catch (e) {
    console.log('No demo data, showing empty state');
    render(null);
  }
}

function init() {
  document.getElementById('period-pills').addEventListener('click', (e) => {
    const pill = e.target.closest('.period-pill');
    if (pill && pill.dataset.period) {
      setPeriod(pill.dataset.period);
    }
  });

  setPeriod('all');
  loadData();
}

document.addEventListener('DOMContentLoaded', init);
