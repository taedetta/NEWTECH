'use strict';

/** Central Time (America/Chicago) formatting — use for emails, PDFs, and UI copy. */

const CT_TZ = 'America/Chicago';

function toDate(input) {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatTimeCT(input) {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleTimeString('en-US', {
    timeZone: CT_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateCT(input) {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', {
    timeZone: CT_TZ,
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

function formatDateLongCT(input = new Date()) {
  const d = toDate(input);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', {
    timeZone: CT_TZ,
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
    timeZone: CT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** e.g. "Sat, Jun 7 · 2:00 PM – 3:30 PM CT" */
function formatBookingTimeRangeCT(start, end) {
  const s = toDate(start);
  const e = toDate(end);
  if (!s) return '—';
  const datePart = s.toLocaleDateString('en-US', {
    timeZone: CT_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const endPart = e ? formatTimeCT(e) : '—';
  return `${datePart} · ${formatTimeCT(s)} – ${endPart} CT`;
}

module.exports = {
  CT_TZ,
  formatTimeCT,
  formatDateCT,
  formatDateLongCT,
  formatDateTimeCT,
  formatBookingTimeRangeCT,
};
