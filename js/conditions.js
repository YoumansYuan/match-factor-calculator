// Site conditions & time model (pure functions, testable in Node).
// Turns the friendly inputs (date, shift clock times, weather, road maintenance, standby minutes)
// into the few numbers the engine needs, so that every loss is applied exactly once:
//   scheduled shift − scheduled non-productive time = operating time
//   × availability (machine condition, per machine)           → applied in the engine
//   × utilization (standby that stops the loader / the trucks)
//   × job efficiency (small operational delays only)
//   × condition factor (weather visibility × dust × darkness)
// Speed caps from visibility are applied to the haul itself, not as an efficiency.
import { SKY, SURFACES, MONTHLY_TEMP_C } from './data/equipment.js?v=202611272100';

const rad = d => d * Math.PI / 180;
const byId = (list, id) => list.find(x => x.id === id);
export const clockToH = s => { const m = /^(\d{1,2}):?(\d{2})?$/.exec(String(s || '').trim()); if (!m) return 7; return (+m[1] % 24) + (+(m[2] || 0)) / 60; };
export const hToClock = h => { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${String(mm === 60 ? hh + 1 : hh).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`; };

function parseDate(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T12:00:00Z`) : new Date();
  return isNaN(d) ? new Date() : d;
}
export function dayOfYear(dateStr) {
  const d = parseDate(dateStr);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5);
}
export const monthTempC = dateStr => MONTHLY_TEMP_C[parseDate(dateStr).getUTCMonth()];

// North-American daylight saving: second Sunday of March to first Sunday of November.
export function isDST(dateStr) {
  const d = parseDate(dateStr), y = d.getUTCFullYear();
  const nthSunday = (m, n) => { const first = new Date(Date.UTC(y, m, 1)); const day = (7 - first.getUTCDay()) % 7; return Date.UTC(y, m, 1 + day + 7 * (n - 1)); };
  const t = Date.UTC(y, d.getUTCMonth(), d.getUTCDate());
  return t >= nthSunday(2, 2) && t < nthSunday(10, 1);
}

// Sunrise / sunset in local clock hours (NOAA-style approximation, ±5 min — plenty for a planning tool).
export function solar(dateStr, latDeg, lonDeg, utcOffsetStd = -7, useDST = true) {
  const N = dayOfYear(dateStr);
  const decl = rad(23.44) * Math.sin(2 * Math.PI * (284 + N) / 365);
  const B = 2 * Math.PI * (N - 81) / 364;
  const eotMin = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const tz = utcOffsetStd + (useDST && isDST(dateStr) ? 1 : 0);
  const noon = 12 - lonDeg / 15 - eotMin / 60 + tz;
  const phi = rad(latDeg);
  const cosW = (Math.sin(rad(-0.833)) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
  if (cosW <= -1) return { sunrise: 0, sunset: 24, dayLenH: 24, noon };
  if (cosW >= 1) return { sunrise: noon, sunset: noon, dayLenH: 0, noon };
  const halfH = Math.acos(cosW) * 180 / Math.PI / 15;
  return { sunrise: noon - halfH, sunset: noon + halfH, dayLenH: 2 * halfH, noon };
}

// Hours of darkness inside [start, start+len) (clock hours, may cross midnight; sun times assumed the same each day).
export function darkHours(startH, lenH, sunrise, sunset) {
  let dark = 0; const step = 1 / 60;
  for (let t = 0; t < lenH - 1e-9; t += step) {
    const h = (((startH + t) % 24) + 24) % 24;
    if (h < sunrise || h >= sunset) dark += step;
  }
  return dark;
}

// Water truck: freezes on the road below 0 °C. Simple rule on the daily mean temperature.
export function waterTruckStatus(tempC) {
  if (tempC > 3) return { status: 'yes', eff: 1, label: 'Available' };
  if (tempC > 0) return { status: 'day', eff: 0.5, label: 'Daytime only (night frost risk)' };
  return { status: 'no', eff: 0, label: 'Not available — water would freeze' };
}

export const DEFAULT_ASSUMPTIONS = { dustEffLoss: 0.08, dustCapKmh: 40, darkEffLoss: 0.05 };

export function siteConditions(site, ops) {
  const A = { ...DEFAULT_ASSUMPTIONS, ...(ops.assumptions || {}) };
  const tempAuto = monthTempC(site.date);
  const tempC = site.tempC === '' || site.tempC == null ? tempAuto : +site.tempC;
  const sky = byId(SKY, site.skyId) || SKY[0];
  const surface = byId(SURFACES, site.surfaceId) || SURFACES[0];
  const water = waterTruckStatus(tempC);
  const waterEff = site.waterTruck ? water.eff : 0;
  // dust only on a dry road; frozen ground raises less dust
  const dust = surface.id === 'dry' && !['rain', 'snowing'].includes(sky.id) ? (1 - waterEff) * (tempC <= 0 ? 0.5 : 1) : 0;
  // time model
  const startH = clockToH(ops.shiftStart), endH = clockToH(ops.shiftEnd);
  let shiftLenH = ((endH - startH) % 24 + 24) % 24; if (shiftLenH === 0) shiftLenH = 24;
  const nShifts = Math.max(1, Math.round(+ops.shiftsPerDay || 1));
  const nonProdH = Math.min(shiftLenH, (+ops.nonProdMin || 0) / 60);
  const operatingH = Math.max(0.01, shiftLenH - nonProdH);
  const sb = ops.standby || {};
  const loaderStopMin = (+sb.faceMin || 0) + (+sb.blastMin || 0) + (+sb.relocMin || 0);
  const truckOnlyMin = +sb.fuelMin || 0;
  const utilization = Math.max(0, 1 - loaderStopMin / (operatingH * 60));
  const truckUtil = Math.max(0, 1 - truckOnlyMin / (operatingH * 60));
  const sun = solar(site.date, +site.latitude || 49.7, +site.longitude || -114.9, +site.utcOffsetStd || -7, site.dst !== false);
  const shifts = [];
  for (let k = 0; k < nShifts; k++) {
    const s0 = startH + k * shiftLenH;
    shifts.push({ start: s0, end: s0 + shiftLenH, darkH: darkHours(s0, shiftLenH, sun.sunrise, sun.sunset) });
  }
  const darkFrac = shifts.reduce((a, s) => a + s.darkH, 0) / (nShifts * shiftLenH);
  const skyF = sky.eff, dustF = 1 - A.dustEffLoss * dust, darkF = 1 - A.darkEffLoss * darkFrac;
  const condFactor = skyF * dustF * darkF;
  let capKmh = sky.capKmh || 0;
  if (dust >= 0.5) capKmh = capKmh ? Math.min(capKmh, A.dustCapKmh) : A.dustCapKmh;
  const jobEff = Math.min(60, Math.max(0, +ops.jobEffMin || 0)) / 60;
  return {
    tempC, tempAuto, sky, surface, water, waterEff, dust, sun, shifts, darkFrac, capKmh,
    shiftLenH, nShifts, nonProdH, operatingH, loaderStopMin, truckOnlyMin, utilization, truckUtil, jobEff,
    skyF, dustF, darkF, condFactor, assumptions: A,
  };
}
