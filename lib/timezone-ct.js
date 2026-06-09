'use strict';

/**
 * School wall-clock timezone — New Tech Aviation (Dublin, VA) uses US Eastern.
 * Export names retain "CT" suffix for backward compatibility with existing imports.
 */

const SCHOOL_TZ = 'America/New_York';
const CT_TZ = SCHOOL_TZ;

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
