/**
 * MQI Dashboard - Standalone app wrapper
 * Loads data and renders the Model Quality view
 */

import { renderModelQualityView } from './model-quality.js';
import { toISODate } from './utils.js';

// Application state
const state = {
  rawData: null,
  dateRange: { from: null, to: null },
  selectedPeriod: 'all'
};

// Date helpers
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

const PERIOD_DAYS = {
  today: 0,
  week: 7,
  month: 30,
  quarter: 90,
  all: 180
};

function setPeriod(period) {
  state.selectedPeriod = period;
  const to = new Date();
  to.setHours(23, 59, 59, 999);

  let from;
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

  updateDateInputs();
  render();
}

function updateDateInputs() {
  const fromInput = document.getElementById('date-from');
  const toInput = document.getElementById('date-to');
  if (!fromInput || !toInput) return;

  if (state.dateRange.from) {
    fromInput.value = toISODate(state.dateRange.from);
  }
  if (state.dateRange.to) {
    toInput.value = toISODate(state.dateRange.to);
  }
}

function onDateInputChange() {
  const fromInput = document.getElementById('date-from');
  const toInput = document.getElementById('date-to');
  if (!fromInput || !toInput) return;

  const fromVal = fromInput.value;
  const toVal = toInput.value;
  if (!fromVal || !toVal) return;

  state.dateRange = {
    from: new Date(fromVal + 'T00:00:00'),
    to: new Date(toVal + 'T23:59:59')
  };

  state.selectedPeriod = null;
  document.querySelectorAll('.period-pill').forEach(pill => {
    pill.classList.remove('period-pill--active');
  });

  render();
}

function render() {
  if (!state.rawData) return;
  renderModelQualityView(state);
}

async function loadData() {
  try {
    // Try loading from API first (if running with backend)
    let resp = await fetch('/api/mqi');
    if (resp.ok) {
      const data = await resp.json();
      state.rawData = { modelQuality: data };
      render();
      return;
    }
  } catch (e) {
    // API not available, try static JSON
  }

  // Try user's mqi.json first
  try {
    const resp = await fetch('data/mqi.json');
    if (resp.ok) {
      const data = await resp.json();
      state.rawData = { modelQuality: data };
      render();
      return;
    }
  } catch (e) {
    // mqi.json not found, try example
  }

  // Fall back to example data
  try {
    const resp = await fetch('data/mqi.example.json');
    if (resp.ok) {
      const data = await resp.json();
      state.rawData = { modelQuality: data };
      console.info('Loaded example data. Run "mqi -o dashboard/data/mqi.json" to use your own sessions.');
      render();
      return;
    }
  } catch (e) {
    console.error('Failed to load MQI data:', e);
  }

  // Show empty state
  const container = document.getElementById('model-quality-view');
  if (container) {
    container.textContent = 'No MQI data available. Run: mqi -o dashboard/data/mqi.json';
    container.style.cssText = 'padding: 40px; text-align: center; color: var(--text-muted); font-family: var(--font-mono);';
  }
}

function init() {
  // Period pills
  document.getElementById('period-pills').addEventListener('click', (e) => {
    const pill = e.target.closest('.period-pill');
    if (pill && pill.dataset.period) {
      setPeriod(pill.dataset.period);
    }
  });

  // Date inputs
  const dateFrom = document.getElementById('date-from');
  const dateTo = document.getElementById('date-to');
  if (dateFrom) dateFrom.addEventListener('change', onDateInputChange);
  if (dateTo) dateTo.addEventListener('change', onDateInputChange);

  // Set initial period
  setPeriod('all');

  // Load data
  loadData();
}

document.addEventListener('DOMContentLoaded', init);
