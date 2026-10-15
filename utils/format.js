/**
 * utils/format.js
 * -----------------------------------------------------------------------
 * Small formatting helpers: Discord timestamps, durations, truncation,
 * time periods, URL validation, and splitting long lists into pages.
 * -----------------------------------------------------------------------
 */

/** Discord timestamp tag - renders in every viewer's own timezone. */
function ts(date, style = 'f') {
  const d = date instanceof Date ? date : new Date(date);
  return `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;
}

/** 3725 -> "1h 02m", 59 -> "<1m", 90000 -> "1d 1h" */
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

const toHours = (seconds) => Math.round(((seconds || 0) / 3600) * 10) / 10;

function truncate(text, max = 1024) {
  if (text === null || text === undefined) return text;
  const str = String(text);
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

const PERIODS = {
  '7d': { label: 'Last 7 days', days: 7 },
  '14d': { label: 'Last 14 days', days: 14 },
  '30d': { label: 'Last 30 days', days: 30 },
  '90d': { label: 'Last 90 days', days: 90 },
  all: { label: 'All time', days: null },
};

const PERIOD_CHOICES = Object.entries(PERIODS).map(([value, p]) => ({ name: p.label, value }));

/** ISO timestamp for the start of a period, or null for all time. */
function periodStart(periodKey) {
  const period = PERIODS[periodKey] || PERIODS['7d'];
  return period.days ? new Date(Date.now() - period.days * 86400000).toISOString() : null;
}

const periodLabel = (periodKey) => (PERIODS[periodKey] || PERIODS['7d']).label;

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** ▰▰▰▱▱ style bar for quota/progress displays. */
function progressBar(value, max, size = 10) {
  const ratio = max > 0 ? Math.min(1, value / max) : 1;
  const filled = Math.round(ratio * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

/** Splits lines into chunks that fit an embed description. */
function chunkLines(lines, maxChars = 3800, maxLines = 20) {
  const pages = [];
  let current = [];
  let length = 0;
  for (const line of lines) {
    if (current.length && (length + line.length + 1 > maxChars || current.length >= maxLines)) {
      pages.push(current);
      current = [];
      length = 0;
    }
    current.push(line);
    length += line.length + 1;
  }
  if (current.length) pages.push(current);
  return pages;
}

const pad = (n, width = 4) => String(n).padStart(width, '0');

module.exports = {
  ts,
  formatDuration,
  toHours,
  truncate,
  PERIODS,
  PERIOD_CHOICES,
  periodStart,
  periodLabel,
  addDays,
  isValidUrl,
  progressBar,
  chunkLines,
  pad,
};
