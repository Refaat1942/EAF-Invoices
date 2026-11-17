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
})();
