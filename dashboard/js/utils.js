// =============================================================================
// BloomNet Utils — Shared formatting, color, and date utilities
// =============================================================================

/**
 * Format a token count into a human-readable string.
 * @param {number} n - Token count
 * @returns {string} Formatted string (e.g., "1.2M", "342K", "1,200")
 */
export function formatTokens(n) {
  if (n == null || isNaN(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

/**
 * Format a cost value as a dollar string.
 * @param {number} n - Cost in USD
 * @returns {string} Formatted string (e.g., "$1.50", "$1,234.56")
 */
export function formatCost(n) {
  if (n == null || isNaN(n)) return '$0.00';
  if (Math.abs(n) >= 1000) {
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return '$' + n.toFixed(2);
}

/**
 * Format a number as a percentage string.
 * @param {number} n - Value between 0 and 1 (or 0 and 100 if already a percent)
 * @param {number} [decimals=1] - Number of decimal places
 * @returns {string} Formatted string (e.g., "45.2%")
 */
export function formatPercent(n, decimals = 1) {
  if (n == null || isNaN(n)) return '0.0%';
  // If value is between 0 and 1, treat as a fraction
  const pct = n <= 1 && n >= 0 ? n * 100 : n;
  return pct.toFixed(decimals) + '%';
}

/**
 * Format a duration in seconds to a human-readable string.
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted string (e.g., "2h 14m", "3m 12s", "45s")
 */
export function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds) || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted string
 */
export function formatDurationMs(ms) {
  return formatDuration(ms / 1000);
}

/**
 * Format a date for display.
 * @param {Date|string} date - Date object or ISO string
 * @param {string} [format='short'] - 'short', 'long', 'iso', 'time'
 * @returns {string} Formatted date string
 */
export function formatDate(date, format = 'short') {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  switch (format) {
    case 'iso':
      return d.toISOString().split('T')[0];
    case 'time':
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    case 'long':
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    case 'short':
    default:
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Format a date as relative time.
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Relative time string (e.g., "just now", "5 min ago", "Mar 14")
 */
export function formatRelativeTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(d, 'short');
}

/**
 * Convert hex color to RGB object.
 * @param {string} hex - Hex color string (e.g., "#ff0000")
 * @returns {{ r: number, g: number, b: number }}
 */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

/**
 * Convert RGB to hex color.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string} Hex color string
 */
export function rgbToHex(r, g, b) {
  const toHex = (c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/**
 * Interpolate between two hex colors.
 * @param {string} color1 - Start hex color
 * @param {string} color2 - End hex color
 * @param {number} t - Interpolation factor (0-1)
 * @returns {string} Interpolated hex color
 */
export function interpolateColor(color1, color2, t) {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  return rgbToHex(
    c1.r + (c2.r - c1.r) * t,
    c1.g + (c2.g - c1.g) * t,
    c1.b + (c2.b - c1.b) * t
  );
}

/**
 * Get a heatmap color using log-scale when range > 10x.
 * @param {number} value - Data value
 * @param {number} min - Minimum value in range
 * @param {number} max - Maximum value in range
 * @param {string[]} scale - Array of hex colors (7 levels)
 * @returns {string} Hex color from the scale
 */
export function getHeatmapColor(value, min, max, scale) {
  if (value <= 0 || max <= 0) return scale[0];
  const range = max - min;
  if (range <= 0) return scale[0];

  let normalized;
  // Use log scale when range > 10x
  if (max / Math.max(min, 1) > 10) {
    normalized = Math.log1p(value - min) / Math.log1p(range);
  } else {
    normalized = (value - min) / range;
  }

  const idx = Math.min(Math.floor(normalized * (scale.length - 1)), scale.length - 1);
  return scale[Math.max(0, idx)];
}

/**
 * Add alpha channel to hex color.
 * @param {string} hex - Hex color
 * @param {number} alpha - Alpha value 0-1
 * @returns {string} rgba() color string
 */
export function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Truncate a string to a max length with ellipsis.
 * @param {string} str - String to truncate
 * @param {number} max - Maximum length
 * @returns {string} Truncated string
 */
export function truncate(str, max = 30) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

/**
 * Get a Date object for N days ago.
 * @param {number} n - Number of days ago
 * @returns {Date}
 */
export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Generate an array of Date objects between from and to (inclusive).
 * @param {Date|string} from - Start date
 * @param {Date|string} to - End date
 * @returns {Date[]}
 */
export function getDateRange(from, to) {
  const start = from instanceof Date ? new Date(from) : new Date(from);
  const end = to instanceof Date ? new Date(to) : new Date(to);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  const dates = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/**
 * Get ISO date string (YYYY-MM-DD) from a Date.
 * @param {Date} d
 * @returns {string}
 */
export function toISODate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Hash a string to a number (for deterministic color generation).
 * @param {string} str
 * @returns {number}
 */
export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Generate a deterministic HSL color from a string.
 * @param {string} str
 * @param {number} [s=70] - Saturation percentage
 * @param {number} [l=55] - Lightness percentage
 * @returns {string} HSL color string
 */
export function stringToColor(str, s = 70, l = 55) {
  const h = hashString(str) % 360;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/**
 * Seeded pseudo-random number generator (mulberry32).
 * @param {number} seed
 * @returns {function(): number} Function that returns 0-1
 */
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// Heatmap color scales (7 levels each, from cold to hot)
// =============================================================================

export const HEATMAP_SCALES = {
  activity: ['#0d1117', '#0e2a1f', '#114d2e', '#15803d', '#22c55e', '#4ade80', '#86efac'],
  tokens:   ['#0d1117', '#1a1a3e', '#2d1b69', '#6d28d9', '#8b5cf6', '#a78bfa', '#c4b5fd'],
  github:   ['#0d1117', '#0e4429', '#006d32', '#26a641', '#39d353', '#6ee77a', '#a6f4a0'],
  streak:   ['#0d1117', '#3d1e00', '#6b3a00', '#b45309', '#d97706', '#f59e0b', '#fbbf24'],
  cost:     ['#0d1117', '#3b1018', '#6b1a25', '#991b1b', '#dc2626', '#ef4444', '#f87171'],
  sessions: ['#0d1117', '#0c2d48', '#0e4d72', '#0369a1', '#0284c7', '#0ea5e9', '#38bdf8'],
};

// Token type color palette
export const TOKEN_COLORS = {
  input:       '#4fc3f7',
  output:      '#66bb6a',
  cacheRead:   '#ab47bc',
  cacheWrite:  '#ffa726',
  cost:        '#ef5350',
};

// Bio palette colors
export const BIO_COLORS = {
  chlorophyll: '#1D9E75',
  biolumBlue:  '#00b4d8',
  biolumPurple:'#9b5de5',
  pollen:      '#f9c74f',
  bloomPink:   '#ff6b9d',
  root:        '#8b6914',
  moss:        '#4a7c59',
  wilt:        '#6b4e3d',
};

// Cyber palette colors
export const CYBER_COLORS = {
  void:     '#0a0e1a',
  surface:  '#0d1117',
  border:   '#21262d',
  text:     '#c8c8c0',
  accent:   '#1D9E75',
  grid:     '#161b22',
  warning:  '#d29922',
  success:  '#3fb950',
};

// =============================================================================
// DOM Helpers -- shared by voice.js, social.js
// =============================================================================

export function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

export function textEl(tag, text) {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

export function textTd(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

export function metricCard(label, value, unit) {
  const card = el('div', 'social-metric');
  card.appendChild(textEl('div', label));
  const valEl = textEl('div', value);
  valEl.className = 'social-metric__value';
  card.appendChild(valEl);
  if (unit) card.appendChild(textEl('div', unit));
  return card;
}

export function tableRow(cells, isHeader) {
  const tr = document.createElement('tr');
  for (const cell of cells) {
    const td = document.createElement(isHeader ? 'th' : 'td');
    td.textContent = cell;
    tr.appendChild(td);
  }
  return tr;
}

// Abramowitz & Stegun erf approximation → standard normal CDF.
export function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}
function erf(x) {
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
