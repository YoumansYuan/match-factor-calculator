// Unit system. State is always SI; these convert for display/input.
export const Q = {
  len:      { si: 'm',    imp: 'ft',     f: 3.28084 },
  dist:     { si: 'km',   imp: 'mi',     f: 0.621371 },
  speed:    { si: 'km/h', imp: 'mph',    f: 0.621371 },
  mass:     { si: 't',    imp: 'US ton', f: 1.10231 },
  kg:       { si: 'kg',   imp: 'lb',     f: 2.20462 },
  vol:      { si: 'm³',   imp: 'yd³',    f: 1.30795 },
  dens:     { si: 't/m³', imp: 'lb/yd³', f: 1685.55 },
  power:    { si: 'kW',   imp: 'hp',     f: 1.34102 },
  fuel:     { si: 'L',    imp: 'US gal', f: 0.264172 },
  fuelpm:   { si: 'L/t',  imp: 'gal/ton', f: 0.264172 / 1.10231 },
  rate:     { si: 't/h',  imp: 'ton/h',  f: 1.10231 },
  decel:    { si: 'm/s²', imp: 'ft/s²',  f: 3.28084 },
  co2pm:    { si: 'kg/t', imp: 'lb/ton', f: 2.20462 / 1.10231 },
  temp:     { si: '°C',   imp: '°F',     toImp: c => c * 9 / 5 + 32, toSI: f => (f - 32) * 5 / 9 },
};

let system = 'si';
export const getSystem = () => system;
export const setSystem = s => { system = s; };
export const unit = q => (Q[q] ? Q[q][system] : '');
export function toDisp(q, v) {
  if (v == null || v === '' || !Q[q] || system === 'si') return v;
  return Q[q].toImp ? Q[q].toImp(+v) : +v * Q[q].f;
}
export function toSI(q, v) {
  if (v == null || v === '' || !Q[q] || system === 'si') return v === '' ? '' : +v;
  return Q[q].toSI ? Q[q].toSI(+v) : +v / Q[q].f;
}
export function fmt(q, v, d = 1) {
  if (v == null || !isFinite(v)) return '—';
  const x = toDisp(q, v);
  return Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export const fmtU = (q, v, d = 1) => `${fmt(q, v, d)} ${unit(q)}`;
