/* One date format on every screen: «يوم/شهر/سنة» (01/01/2026), Latin digits. */
(function () {
  function pad(n) {
    return String(n).padStart(2, '0');
  }
  function toDate(value) {
    if (value instanceof Date) return value;
    const text = String(value).trim();
    // A plain calendar date is a day, not a moment: never shift it by the time zone.
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return new Date(text);
  }
  function formatDateDMY(value) {
    if (value === undefined || value === null || value === '') return '';
    const text = String(value).trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T00:00:00(?:\.000)?Z?$)/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const dmy = text.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (dmy) return `${dmy[1]}/${dmy[2]}/${dmy[3]}`;
    const d = toDate(value);
    if (Number.isNaN(d.getTime())) return text;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  function formatDateTimeDMY(value) {
    if (value === undefined || value === null || value === '') return '';
    const d = toDate(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const h = d.getHours();
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h >= 12 ? 'م' : 'ص'}`;
  }
  window.formatDateDMY = formatDateDMY;
  window.formatDateTimeDMY = formatDateTimeDMY;

  // The server's clock, read from every API answer (X-Server-Time). «Today» on every PC is
  // the server's day in Cairo time, whatever the PC's own date, time or time zone.
  let serverOffsetMs = 0;
  function noteServerTime(epochMs) {
    const t = Number(epochMs);
    if (Number.isFinite(t) && t > 0) serverOffsetMs = t - Date.now();
  }
  function cairoParts(ms) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms));
    const get = (type) => Number((parts.find((p) => p.type === type) || {}).value || 0);
    return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
  }
  /** A Date whose local fields are the server's Cairo wall-clock time. */
  function eafServerNow() {
    const c = cairoParts(Date.now() + serverOffsetMs);
    return new Date(c.y, c.m - 1, c.d, c.h, c.mi, c.s);
  }
  /** yyyy-mm-dd of the server's today (Cairo). */
  function eafToday(offsetDays = 0) {
    const d = eafServerNow();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  window.eafNoteServerTime = noteServerTime;
  window.eafServerNow = eafServerNow;
  window.eafToday = eafToday;
})();
