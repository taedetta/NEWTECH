/**
 * Browser helpers — all display/booking wall times use US Eastern (Virginia).
 * Keep in sync with lib/school-timezone.js
 */
(function (global) {
  const SCHOOL_TZ = 'America/New_York';
  const SCHOOL_TZ_LABEL = 'ET';

  function getParts(date, timeZone) {
    timeZone = timeZone || SCHOOL_TZ;
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const map = {};
    fmt.formatToParts(d).forEach(function (p) {
      if (p.type !== 'literal') map[p.type] = p.value;
    });
    return {
      year: +map.year,
      month: +map.month,
      day: +map.day,
      hour: +map.hour === 24 ? 0 : +map.hour,
      minute: +map.minute,
      second: +map.second,
    };
  }

  function calendarDate(date) {
    const p = getParts(date || new Date());
    if (!p) return '';
    return String(p.year).padStart(4, '0') + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
  }

  function addCalendarDays(dateStr, days) {
    const parts = dateStr.slice(0, 10).split('-').map(Number);
    const tmp = new Date(parts[0], parts[1] - 1, parts[2] + days);
    return tmp.getFullYear() + '-' + String(tmp.getMonth() + 1).padStart(2, '0') + '-' + String(tmp.getDate()).padStart(2, '0');
  }

  function normalizeWallTime(timeStr) {
    if (!timeStr) return '00:00:00';
    if (timeStr === '24:00') return '00:00:00';
    return timeStr.length === 5 ? timeStr + ':00' : timeStr;
  }

  function wallClockToUtc(dateStr, timeStr) {
    var day = dateStr.slice(0, 10);
    var t = timeStr;
    if (t === '24:00' || t === '24:00:00') {
      t = '00:00';
      day = addCalendarDays(day, 1);
    }
    var normalized = normalizeWallTime(t);
    var dp = day.split('-').map(Number);
    var tp = normalized.split(':').map(Number);
    var y = dp[0], m = dp[1], d = dp[2];
    var hh = tp[0], mm = tp[1], ss = tp[2] || 0;
    var utcMs = Date.UTC(y, m - 1, d, hh, mm, ss);
    for (var i = 0; i < 5; i++) {
      var parts = getParts(new Date(utcMs));
      if (!parts) break;
      var dayDiffMin = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(parts.year, parts.month - 1, parts.day)) / 60000);
      var timeDiffMin = (hh - parts.hour) * 60 + (mm - parts.minute);
      var totalDiffMin = dayDiffMin + timeDiffMin;
      if (totalDiffMin === 0) break;
      utcMs += totalDiffMin * 60 * 1000;
    }
    return new Date(utcMs);
  }

  function wallClockToUtcIso(dateStr, timeStr) {
    return wallClockToUtc(dateStr, timeStr).toISOString();
  }

  function timeHmFromIso(iso) {
    var p = getParts(new Date(iso));
    if (!p) return '00:00';
    return String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0');
  }

  function formatTime(date) {
    var d = date instanceof Date ? date : new Date(date);
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: SCHOOL_TZ,
    });
  }

  function formatDate(date, opts) {
    var d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', Object.assign({ timeZone: SCHOOL_TZ }, opts || {}));
  }

  function easternDayBoundsUtc(year, monthIndex, day) {
    var dateStr = year + '-' + String(monthIndex + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    return {
      start: wallClockToUtc(dateStr, '00:00'),
      end: wallClockToUtc(addCalendarDays(dateStr, 1), '00:00'),
    };
  }

  function civilDateFromParts(year, monthIndex, day) {
    var tmp = new Date(year, monthIndex, day);
    return tmp.getFullYear() + '-' + String(tmp.getMonth() + 1).padStart(2, '0') + '-' + String(tmp.getDate()).padStart(2, '0');
  }

  global.SchoolTime = {
    SCHOOL_TZ: SCHOOL_TZ,
    SCHOOL_TZ_LABEL: SCHOOL_TZ_LABEL,
    calendarDate: calendarDate,
    addCalendarDays: addCalendarDays,
    wallClockToUtc: wallClockToUtc,
    wallClockToUtcIso: wallClockToUtcIso,
    timeHmFromIso: timeHmFromIso,
    formatTime: formatTime,
    formatDate: formatDate,
    easternDayBoundsUtc: easternDayBoundsUtc,
    civilDateFromParts: civilDateFromParts,
  };
})(typeof window !== 'undefined' ? window : global);
