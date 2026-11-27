// Seasonal schedule (pure functions, testable in Node).
// Turns the monthly climate of the site into a mix of "day types" (heavy snowfall, light snowfall, rain,
// dry with a snow-packed road, dry) for each calendar month, so the production of every day type can be
// computed with the normal engine and then weighted by how many days of that type the month has.
//
// The cautious ↔ optimistic slider moves every monthly value from its median (P50) towards the value of a
// 1-in-10 bad year (P90 of snow/rain days, P10 of temperature) or a 1-in-10 good year (the opposite).
// Values never go outside the range seen in the station's own records.
import { CLIMATE } from './data/equipment.js?v=202611272213';

export const LAPSE_C_PER_M = 0.006; // standard environmental lapse rate, °C per m of elevation
export const CLIMATE_KEYS = ['tmean', 'pr02', 'sn02', 'sn5', 'sog1', 'fog'];
export const CLIMATE_LABELS = {
  tmean: 'Mean temperature (°C)', pr02: 'Days with rain or snow (≥ 0.2 mm)', sn02: 'Days with snowfall (≥ 0.2 cm)',
  sn5: 'Heavy-snow days (in a storm of ≥ 5 cm total)', sog1: 'Days with snow on the ground', fog: 'Dense-fog days (work stops part of the day)',
};
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // m = 0..11

// Climate of month m (0..11) at slider level (−1 optimistic … 0 typical … +1 cautious).
// overrides[m+1][key] replaces the typical (P50) value; the P10–P90 spread moves with it.
export function climateMonth(m, level = 0, overrides = {}, climate = CLIMATE) {
  const row = climate.months[m], ov = overrides[m + 1] || overrides[String(m + 1)] || {};
  const L = Math.max(-1, Math.min(1, +level || 0));
  const out = {};
  Object.keys(row).forEach(k => {
    const [p10, p50, p90] = row[k];
    const mid = ov[k] !== '' && ov[k] != null && isFinite(+ov[k]) ? +ov[k] : p50;
    const shift = mid - p50;
    // cautious = colder and more snow/rain days; optimistic = the opposite
    const bad = (k === 'tmean' ? p10 : p90) + shift, good = (k === 'tmean' ? p90 : p10) + shift;
    out[k] = L >= 0 ? mid + (bad - mid) * L : mid + (good - mid) * -L;
  });
  return out;
}

// How rare is the chosen slider level? Plain-language label.
export function levelLabel(level) {
  const L = +level || 0, a = Math.abs(L);
  if (a < 0.05) return 'Typical year (median of the station record)';
  // P50 → P90 linearly: the chance of a worse (or better) year falls from 50 % to 10 %
  const pct = Math.round(50 - 40 * a);
  return L > 0 ? `Cautious: only about ${pct} % of years had worse weather` : `Optimistic: only about ${pct} % of years had better weather`;
}

// Split the days of a month into day types. Each type sets the sky (visibility) and the road surface.
export function dayMix(c, days) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const snow = clamp(c.sn02, 0, days);
  const heavy = clamp(c.sn5, 0, snow), light = snow - heavy;
  const rain = clamp(c.pr02 - snow, 0, days - snow); // precipitation days that were not snow
  const dryAll = Math.max(0, days - snow - rain);
  // snow stays on the ground between snowfalls: those dry days still have a packed-snow road
  const packedAll = clamp(c.sog1 - snow, 0, dryAll);
  // dense fog comes on days without precipitation; its road is packed snow when most dry days are
  const fog = clamp(c.fog || 0, 0, dryAll);
  const packedShare = dryAll > 0 ? packedAll / dryAll : 0;
  const packed = packedAll * (1 - (dryAll > 0 ? fog / dryAll : 0));
  const T = [
    { key: 'fog', label: 'Dense fog', skyId: 'fog', surfaceId: packedShare > 0.5 ? 'packedsnow' : 'dry', days: fog },
    { key: 'heavy', label: 'Heavy snow (storm ≥ 5 cm)', skyId: 'snowing', surfaceId: 'loosesnow', days: heavy },
    { key: 'light', label: 'Light snowfall', skyId: 'overcast', surfaceId: 'packedsnow', days: light },
    { key: 'rain', label: 'Rain', skyId: 'rain', surfaceId: 'wet', days: rain },
    { key: 'packed', label: 'Dry, snow-packed road', skyId: 'clear', surfaceId: 'packedsnow', days: packed },
    { key: 'dry', label: 'Dry', skyId: 'clear', surfaceId: 'dry', days: dryAll - fog - packed },
  ];
  return T.filter(t => t.days > 1e-6).map(t => ({ ...t, share: t.days / days }));
}

// Month list from a start date: [{y, m, from, to, days}] (from/to = day of month, inclusive).
export function monthsFrom(startISO, endISO, maxMonths = 36) {
  const s = new Date(`${startISO}T12:00:00Z`); if (isNaN(s)) return [];
  const e = endISO ? new Date(`${endISO}T12:00:00Z`) : null;
  const out = [];
  let y = s.getUTCFullYear(), m = s.getUTCMonth(), from = s.getUTCDate();
  for (let k = 0; k < maxMonths; k++) {
    const dim = daysInMonth(y, m);
    let to = dim;
    if (e && !isNaN(e)) {
      if (Date.UTC(y, m, from) > e.getTime()) break;
      if (e.getUTCFullYear() === y && e.getUTCMonth() === m) to = e.getUTCDate();
    }
    out.push({ y, m, from, to, days: to - from + 1, dim });
    if (e && !isNaN(e) && e.getUTCFullYear() === y && e.getUTCMonth() === m) break;
    m++; if (m > 11) { m = 0; y++; } from = 1;
  }
  return out;
}

// Run the schedule. dayTonnes(type, month) must return tonnes per working day for that day type.
// Returns month rows with tonnes, cumulative tonnes and (if a target is given) the finish date.
export function runSchedule({ start, end, level = 0, overrides = {}, targetT = 0, workFrac = 1, elevM, dayTonnes, climate = CLIMATE }) {
  const months = monthsFrom(start, end, end ? 60 : 36);
  const tAdj = elevM != null && isFinite(elevM) ? -LAPSE_C_PER_M * (elevM - climate.elevM) : 0;
  const rows = []; let cum = 0, finish = null;
  for (const mo of months) {
    const c = climateMonth(mo.m, level, overrides, climate);
    const tempC = c.tmean + tAdj;
    const mix = dayMix(c, mo.dim);
    const types = mix.map(t => ({ ...t, dayT: dayTonnes(t, { ...mo, tempC }) }));
    const perDay = types.reduce((s, t) => s + t.share * t.dayT, 0);
    const workDays = mo.days * workFrac;
    const monthT = perDay * workDays;
    const row = { ...mo, c, tempC, types, perDay, workDays, monthT, cumStart: cum };
    if (!finish && targetT > 0 && cum + monthT >= targetT && perDay > 0) {
      const needDays = (targetT - cum) / (perDay * workFrac); // calendar days into this month
      const d = new Date(Date.UTC(mo.y, mo.m, mo.from)); d.setUTCDate(d.getUTCDate() + Math.max(0, Math.ceil(needDays - 1e-6) - 1));
      finish = { date: d.toISOString().slice(0, 10), workDays: rows.reduce((s, r) => s + r.workDays, 0) + needDays * workFrac };
      row.monthT = targetT - cum; row.partial = true; row.days = Math.ceil(needDays - 1e-6); row.workDays = needDays * workFrac;
    }
    cum += row.monthT; row.cum = cum;
    rows.push(row);
    if (finish) break;
  }
  return { rows, total: cum, finish, tAdj, reached: !!finish };
}
