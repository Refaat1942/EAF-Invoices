/**
 * One date format everywhere the user reads a date: «يوم/شهر/سنة» — 01/01/2026 — with
 * Latin digits. Timestamps are shown in Cairo time.
 */
const TZ = 'Africa/Cairo';

function cairoParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), min: get('minute') };
}

/** 2026-01-01 / Date / timestamp → «01/01/2026» ('' when empty or unreadable). */
function formatDateDMY(value) {
  if (value === undefined || value === null || value === '') return '';
  if (!(value instanceof Date)) {
    const text = String(value).trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00:00(?:\.000)?Z?$)/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const dmy = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (dmy) return `${dmy[1]}/${dmy[2]}/${dmy[3]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const { y, m, d } = cairoParts(date);
  return `${d}/${m}/${y}`;
}

/** Timestamp → «01/01/2026 03:45 م». */
function formatDateTimeDMY(value) {
  if (value === undefined || value === null || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const { y, m, d, h, min } = cairoParts(date);
  let hour = Number(h) % 24;
  const suffix = hour >= 12 ? 'م' : 'ص';
  hour = hour % 12 || 12;
  return `${d}/${m}/${y} ${String(hour).padStart(2, '0')}:${min} ${suffix}`;
}

module.exports = { formatDateDMY, formatDateTimeDMY };
