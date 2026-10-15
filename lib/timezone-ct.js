'use strict';

/**
 * School wall-clock timezone — New Tech Aviation (Dublin, VA) uses US Eastern.
 * Export names retain "CT" suffix for backward compatibility with existing imports.
 */

const SCHOOL_TZ = 'America/New_York';
const CT_TZ = SCHOOL_TZ;

function parseDateOnly(input) {
  if (typeof input !== 'string') return undefined;
  const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day, utcDate };
}

function toDate(input) {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatTimeCT(input) {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleTimeString('en-US', {
    timeZone: SCHOOL_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateCT(input) {
  const dateOnly = parseDateOnly(input);
  if (dateOnly === null) return '—';
  if (dateOnly) {
    return [
      String(dateOnly.month).padStart(2, '0'),
      String(dateOnly.day).padStart(2, '0'),
      String(dateOnly.year),
    ].join('/');
  }

  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', {
    timeZone: SCHOOL_TZ,
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

function formatDateLongCT(input = new Date()) {
  const dateOnly = parseDateOnly(input);
  if (dateOnly === null) return '—';
  if (dateOnly) {
    return dateOnly.utcDate.toLocaleDateString('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', {
    timeZone: SCHOOL_TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTimeCT(input) {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleString('en-US', {
    timeZone: SCHOOL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** e.g. "Sat, Jun 7 · 2:00 PM – 3:30 PM ET" */
function formatBookingTimeRangeCT(start, end) {
  const s = toDate(start);
  const e = toDate(end);
  if (!s) return '—';
  const datePart = s.toLocaleDateString('en-US', {
    timeZone: SCHOOL_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const endPart = e ? formatTimeCT(e) : '—';
  return `${datePart} · ${formatTimeCT(s)} – ${endPart} ET`;
}

module.exports = {
  SCHOOL_TZ,
  CT_TZ,
  formatTimeCT,
  formatDateCT,
  formatDateLongCT,
  formatDateTimeCT,
  formatBookingTimeRangeCT,
};
