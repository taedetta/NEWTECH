'use strict';

/** METAR stations that have no TAF — use nearest issuing station for flight-window forecast. */
const TAF_FALLBACK_BY_STATION = {
  KPSK: 'KBCB', // Virginia Tech Montgomery Executive (~13 NM E)
  PSK: 'KBCB',
};

function getTafFallbackStation(station) {
  const s = String(station || '').trim().toUpperCase();
  return TAF_FALLBACK_BY_STATION[s] || null;
}

/** Parse visibility string from METAR/TAF (e.g. "6+", "10", "1/2") to statute miles. */
function parseVisibMiles(visib) {
  if (visib == null || visib === '') return 99;
  const raw = String(visib).trim().toUpperCase().replace('+', '');
  if (raw.startsWith('P')) return parseVisibMiles(raw.slice(1));
  if (raw.includes('/')) {
    const [num, den] = raw.split('/').map(Number);
    if (den) return num / den;
  }
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 99;
}

/** Lowest BKN/OVC ceiling in feet AGL, or 99999 if clear. */
function ceilingFt(clouds) {
  let ceil = 99999;
  for (const c of clouds || []) {
    if ((c.cover === 'BKN' || c.cover === 'OVC') && c.base != null) {
      ceil = Math.min(ceil, c.base);
    }
  }
  return ceil;
}

/** Standard flight category from visibility + ceiling. */
function categoryFromConditions(visib, clouds) {
  const vis = parseVisibMiles(visib);
  const ceil = ceilingFt(clouds);
  if (vis < 1 || ceil < 500) return 'LIFR';
  if (vis < 3 || ceil < 1000) return 'IFR';
  if (vis <= 5 || ceil <= 3000) return 'MVFR';
  return 'VFR';
}

function categoryRank(cat) {
  return { VFR: 1, MVFR: 2, IFR: 3, LIFR: 4 }[cat] || 0;
}

/** TAF forecast periods overlapping [flightStart, flightEnd] (ISO strings or Date). */
function tafPeriodsForWindow(taf, flightStart, flightEnd) {
  if (!taf?.fcsts?.length) return [];
  const startTs = new Date(flightStart).getTime() / 1000;
  const endTs = new Date(flightEnd).getTime() / 1000;
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return [];
  return taf.fcsts.filter((f) => {
    const from = f.timeFrom || 0;
    const to = f.timeTo || 0;
    return to > startTs && from < endTs;
  });
}

/**
 * Summarize forecast for a scheduled flight window.
 * Returns null if no matching TAF periods.
 */
function summarizeFlightForecast(taf, flightStart, flightEnd) {
  const periods = tafPeriodsForWindow(taf, flightStart, flightEnd);
  if (!periods.length) return null;

  const startTs = new Date(flightStart).getTime() / 1000;
  const endTs = new Date(flightEnd).getTime() / 1000;
  const midTs = (startTs + endTs) / 2;

  const enriched = periods.map((p) => ({
    ...p,
    flightCategory: categoryFromConditions(p.visib, p.clouds),
  }));

  const primary =
    enriched.find((p) => midTs >= p.timeFrom && midTs <= p.timeTo) ||
    enriched.find((p) => startTs >= p.timeFrom && startTs <= p.timeTo) ||
    enriched[0];

  const worst = enriched.reduce(
    (acc, p) => (categoryRank(p.flightCategory) > categoryRank(acc) ? p.flightCategory : acc),
    'VFR'
  );

  return {
    periods: enriched,
    primary,
    category: worst,
    flightCategory: worst,
  };
}

function formatPeriodWind(p) {
  const wdir = p.wdir === 'VRB' ? 'VRB' : p.wdir != null ? `${String(p.wdir).padStart(3, '0')}°` : '—';
  const wspd = p.wspd != null ? `${p.wspd}kt` : '—';
  const wgst = p.wgst ? ` G${p.wgst}kt` : '';
  return `${wdir} ${wspd}${wgst}`;
}

function formatPeriodCeiling(clouds) {
  const layer = (clouds || []).find((c) => c.cover === 'BKN' || c.cover === 'OVC');
  if (layer) return `${layer.cover} ${layer.base}ft`;
  const sky = (clouds || []).map((c) => `${c.cover}${c.base || ''}`).join(' ');
  return sky || 'CLR';
}

function formatPeriodVis(visib) {
  if (visib == null) return '—';
  const v = parseVisibMiles(visib);
  return v >= 6 ? `${String(visib).replace('+', '')}+ SM` : `${v} SM`;
}

module.exports = {
  TAF_FALLBACK_BY_STATION,
  getTafFallbackStation,
  parseVisibMiles,
  ceilingFt,
  categoryFromConditions,
  tafPeriodsForWindow,
  summarizeFlightForecast,
  formatPeriodWind,
  formatPeriodCeiling,
  formatPeriodVis,
};
