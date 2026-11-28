import { TRUCKS, LOADERS, MATERIALS, ROADS, SURFACES, SKY, GRADING, SETUPS, setupsFor, TRUCK_CLASSES, LOADER_CLASSES, LOADING_SIDES, CONDITIONS, JOB_CONDITIONS, ROAD_SRC, SOURCES, looseOf } from './data/equipment.js?v=202611280619';
import { siteConditions, hToClock, clockToH } from './conditions.js?v=202611280619';
import { computeScenario, sweepTrucks, resolveRoad, profileFromXYZ, byId, interp, setupFactor, swingOf } from './engine.js?v=202611280619';
import { setSystem, getSystem, unit, toDisp, toSI, fmt, fmtU } from './units.js?v=202611280619';
import { renderEquipment, renderMethod } from './docs.js?v=202611280619';
import { initVisual, updateVisual } from './visual.js?v=202611280619';
import { initProfileEditor, openProfileEditor } from './profile-editor.js?v=202611280619';
import { runSchedule, levelLabel, CLIMATE_KEYS, CLIMATE_LABELS, climateMonth } from './season.js?v=202611280619';
import { CLIMATE } from './data/equipment.js?v=202611280619';

// ------------------------------------------------------------------ state
const DEFAULTS = {
  site: { date: '', latitude: 49.7, longitude: -114.9, utcOffsetStd: -7, dst: true, tempC: '', skyId: 'clear', roadId: 'firm', surfaceId: 'dry', gradingId: 'shift', waterTruck: true,
    rrOverride: '', tractionOverride: '', speedLimitKmh: 70, downhillLimitKmh: 35, downhillGradePct: -3 },
  materialId: 'till',
  material: { ...pickMat('till'), frozen: false },
  loaders: [{ modelId: 'cat390fl', bucketId: 'sd46', count: 1, jobCond: 'C', setup: 'bench', loadingSide: 'single', benchHeightM: '', swingDeg: '', conditionId: 'good', availabilityPct: '', cycleOverrideS: '', fillOverride: '' }],
  trucks: [{ modelId: 'cat745', count: 6, conditionId: 'good', availabilityPct: '', payloadKg: '', bodyFillPct: '', spotMin: '', dumpMin: '' }],
  target: { volume: '', basis: 'auto' },
  // seasonal schedule: month-by-month weather from the site climate, from the work date (start) to the end date or the target
  season: { on: true, end: '', level: 0, climate: {}, fogStopH: 6, checkDay: false, checkDate: '' },
  profile: { segmentM: 100, loadAreaM: 50, dumpAreaM: 50, reverse: false, points: null, name: '' },
  ops: { shiftPattern: 'daynight', shiftStart: '07:00', shiftEnd: '19:00', nightStart: '19:00', nightEnd: '07:00', shiftsPerDay: 2, daysPerYear: 300, nonProdMin: 60, jobEffMin: 55,
    standby: { faceMin: 20, blastMin: 15, relocMin: 10, fuelMin: 15 }, assumptions: { dustEffLoss: 0.08, dustCapKmh: 40, darkEffLoss: 0.05 }, bunching: 1, passRule: 'third', loadTimeMethod: 'n', travelModel: 'sim', mfUseAvailability: false,
    brakingDecel: 0.6, massFactor: 1.05, idleLF: 0.15, hotRetarderDeratePerC: 0.01, firstPassFrac: 0.2, frozenFillMult: 0.9, frozenCycleMult: 1.1 },
  units: 'si',
};
function pickMat(id) { const m = byId(MATERIALS, id); return { digTm3: m.digTm3, swellPct: m.swellPct, bankTm3: m.bankTm3 ?? '', fill: m.fill }; }
const clone = o => JSON.parse(JSON.stringify(o));
let state = load() || clone(DEFAULTS);
let result = null;
const charts = {};

function load() {
  try { const s = localStorage.getItem('mfc-state-v1'); if (s) return migrate(JSON.parse(s)); } catch (e) { /* storage unavailable */ }
  return null;
}
// Bring a saved scenario from an older version up to the current inputs (deep-merges defaults).
function migrate(saved) {
  const d = clone(DEFAULTS);
  const st = Object.assign(d, saved, {
    site: { ...d.site, ...(saved.site || {}) }, material: { ...d.material, ...(saved.material || {}) },
    ops: { ...d.ops, ...(saved.ops || {}), standby: { ...d.ops.standby, ...((saved.ops || {}).standby || {}) }, assumptions: { ...d.ops.assumptions, ...((saved.ops || {}).assumptions || {}) } },
    profile: { ...d.profile, ...(saved.profile || {}) }, target: { ...d.target, ...(saved.target || {}) }, season: { ...d.season, ...(saved.season || {}) },
  });
  (st.loaders || []).forEach(l => { if (!l.loadingSide) l.loadingSide = 'single'; if (!l.setup) { l.setup = 'bench'; if (+l.swingDeg === 90) l.swingDeg = ''; } if (+l.benchHeightM === 4.5 && !l.benchSet) l.benchHeightM = ''; });
  if (st.material.digTm3 == null && st.material.looseTm3 != null) { // v1: loose density + swell
    const m = byId(MATERIALS, st.materialId);
    if (m && m.blasted) Object.assign(st.material, { digTm3: +st.material.looseTm3, swellPct: 0, bankTm3: m.bankTm3 });
    else st.material.digTm3 = +(st.material.looseTm3 * (1 + (+st.material.swellPct || 0) / 100)).toFixed(3);
  }
  delete st.material.looseTm3;
  // 2026-11-27 new defaults: till 2.1 t/m³ in-situ, swell 30 %; site speed limit 70 km/h (old untouched defaults only)
  if (st.materialId === 'till' && +st.material.digTm3 === 2.2 && +st.material.swellPct === 22) Object.assign(st.material, { digTm3: 2.1, swellPct: 30 });
  if (+st.site.speedLimitKmh === 50) st.site.speedLimitKmh = 70;
  if (st.site.weatherId && !(saved.site || {}).surfaceId) st.site.surfaceId = st.site.weatherId;
  delete st.site.weatherId; delete st.site.altitudeM;
  if (saved.ops && saved.ops.shiftH != null && !saved.ops.shiftStart) { st.ops.shiftEnd = hToClock(7 + +saved.ops.shiftH + st.ops.nonProdMin / 60); if (+saved.ops.jobEffMin === 50) st.ops.jobEffMin = 55; }
  delete st.ops.shiftH; delete st.ops.utilizationPct;
  if (!(saved.ops || {}).shiftPattern) { // 2026-11-27: day / night shifts with their own clock times
    const n = Math.round(+st.ops.shiftsPerDay || 1);
    st.ops.shiftPattern = n >= 2 ? 'daynight' : 'day'; st.ops.nightStart = st.ops.shiftEnd;
    const len = ((clockToH(st.ops.shiftEnd) - clockToH(st.ops.shiftStart)) % 24 + 24) % 24 || 24;
    st.ops.nightEnd = hToClock(clockToH(st.ops.shiftEnd) + len);
  }
  st.season.on = true; // 2026-11-27: weather always comes from the season (one-day check is a separate switch)
  return st;
}
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
let lastCond = null, lastOps = null;
function matDerived(m = state.material) {
  const def = byId(MATERIALS, state.materialId) || {};
  const loose = looseOf(m), isBlast = !!def.blasted;
  const bank = isBlast && +m.bankTm3 > 0 ? +m.bankTm3 : +m.digTm3;
  return { loose, bank, isBlast, loadFactor: 1 / (1 + (+m.swellPct || 0) / 100) };
}
function setupTag(l) {
  const f = setupFactor(l); if (!f.setup) return '';
  const side = byId(LOADING_SIDES, l.loadingSide || 'single');
  return `${side ? `${esc(side.short)} loading · ` : ''}${esc(f.setup.short)}${f.setup.id === 'bench' ? ` ${fmtU('len', +l.benchHeightM || 0, 1)} (dig depth ${(f.ratio * 100).toFixed(0)} % of ${fmtU('len', l.digDepthM, 2)} max)` : ''} · swing ${swingOf(l)}° · setup factor <b>×${f.factor.toFixed(2)}</b> <small>(Komatsu ${esc(f.row.name)} / ${esc(f.col.name.split(' (')[0])})</small>`;
}
// Target volume → tonnes → working days (at the production rate of the current inputs)
const BASES = [{ id: 'auto', name: 'Auto (LCM for blasted rock / rehandle, BCM otherwise)' }, { id: 'bcm', name: 'Bank volume dug (BCM)' }, { id: 'lcm', name: 'Loose volume (LCM, as in the truck / at the dump)' }];
function targetCalc(r = result, useSeason = true) {
  const t = state.target || {}, md = matDerived(), def = byId(MATERIALS, state.materialId) || {};
  const basis = t.basis === 'bcm' || t.basis === 'lcm' ? t.basis : (def.blasted ? 'lcm' : 'bcm');
  const V = +t.volume || 0;
  if (!V || !r || !r.prod || !(r.prod.dayT > 0)) return { basis, V, ok: false };
  const dens = basis === 'bcm' ? md.bank : md.loose;
  const tonnes = V * dens, workDays = tonnes / r.prod.dayT;
  const calDays = workDays * 365 / (+state.ops.daysPerYear || 365);
  let finish = '';
  const d0 = state.site.date || todayISO();
  const d = new Date(`${d0}T12:00:00Z`); if (!isNaN(d)) { d.setUTCDate(d.getUTCDate() + Math.ceil(calDays)); finish = d.toISOString().slice(0, 10); }
  // truck loads: split the tonnes between truck types in proportion to what each type hauls per hour
  const rates = r.trucks.map(t => t.n * t.A * t.loadT / t.ct), rsum = rates.reduce((a, b) => a + b, 0) || 1;
  const loads = r.trucks.map((t, i) => ({ name: t.truck.name, loadT: t.loadT, n: Math.ceil(tonnes * rates[i] / rsum / t.loadT) }));
  const totalLoads = loads.reduce((a, x) => a + x.n, 0);
  const out = { basis, V, ok: true, dens, tonnes, workDays, calDays, finish, start: d0, bcm: tonnes / md.bank, lcm: tonnes / md.loose, loads, totalLoads, seasonal: false };
  // with the seasonal schedule on, days and finish date come from the month-by-month weather (follows the slider)
  const sr = useSeason && state.season && state.season.on ? seasonResult : null;
  if (sr && sr.rows.length) {
    out.seasonal = true;
    if (sr.finish) { out.workDays = sr.finish.workDays; out.finish = sr.finish.date; out.calDays = (Date.parse(sr.finish.date) - Date.parse(d0)) / 864e5 + 1; }
    else { out.notReached = true; out.finish = 'not reached in the window'; }
  }
  return out;
}
const volU = b => (getSystem() === 'si' ? (b === 'bcm' ? 'BCM' : 'LCM') : (b === 'bcm' ? 'BCY' : 'LCY'));
function targetText(tc = targetCalc()) {
  if (!tc.ok) return tc.V ? '' : 'Enter a target volume to see how many days the fleet needs.';
  return `${fmt('vol', tc.V, 0)} ${volU(tc.basis)} × ${fmt('dens', tc.dens, 2)} ${unit('dens')} = <b>${fmtU('mass', tc.tonnes, 0)}</b> (${fmt('vol', tc.bcm, 0)} ${volU('bcm')} · ${fmt('vol', tc.lcm, 0)} ${volU('lcm')}) → <b>${tc.workDays.toFixed(1)} working days</b> ${tc.seasonal ? '(month-by-month site weather, see the seasonal schedule)' : `at ${fmtU('mass', result.prod.dayT, 0)}/day`} · about ${Math.ceil(tc.calDays)} calendar days at ${state.ops.daysPerYear} working days/year, finishing around <b>${tc.finish}</b> if started ${tc.start}. Truck loads needed: <b>${tc.totalLoads.toLocaleString('en-US')}</b>${tc.loads.length > 1 ? ` (${tc.loads.map(x => `${x.n.toLocaleString('en-US')} × ${esc(x.name)} at ${fmt('mass', x.loadT, 1)} ${unit('mass')}`).join(' + ')})` : ` at ${fmt('mass', tc.loads[0].loadT, 1)} ${unit('mass')} per load`}.`;
}
// Hours per shift for an average truck: where the scheduled time goes (each loss applied once), for every shift of the day.
function waterfall(r = result, c = lastCond) {
  if (!r || !c) return { shifts: [], dayEff: 0 };
  const A = r.avgA || 1;
  const shifts = c.shifts.map(x => {
    const op = x.operatingH, avail = op * A;
    const afterStandby = avail * x.utilization * x.truckUtil;
    const afterDelays = afterStandby * c.jobEff;
    const cond = c.skyF * c.dustF * (1 - c.assumptions.darkEffLoss * x.darkFrac);
    const eff = afterDelays * cond;
    return { name: x.name, clock: `${hToClock(x.start)}–${hToClock(x.end)}`, dark: x.darkFrac, eff, rows: [
      { key: 'Scheduled shift', h: x.lenH, total: true },
      { key: 'Meetings, planning, shift change', h: -x.nonProdH },
      { key: 'Mechanical downtime (availability)', h: -(op - avail) },
      { key: 'Standby (face clean-up, blasting, relocation, fuelling)', h: -(avail - afterStandby) },
      { key: 'Small operational delays (job efficiency)', h: -(afterStandby - afterDelays) },
      { key: `Weather, dust & darkness (${(x.darkFrac * 100).toFixed(0)} % in the dark)`, h: -(afterDelays - eff) },
      { key: 'Effective production time', h: eff, total: true },
    ] };
  });
  return { shifts, dayEff: shifts.reduce((a, x) => a + x.eff, 0), schedH: c.schedH };
}
const bcU = () => (getSystem() === 'si' ? 'BCM' : 'BCY'), lcU = () => (getSystem() === 'si' ? 'LCM' : 'LCY');
// Horizontal waterfall: each loss is a red bar hanging from the running total, totals are solid. One block per shift.
const fmtH = h => { const m = Math.round(Math.abs(h) * 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
function waterfallHTML(wf) {
  if (!wf || !wf.shifts || !wf.shifts.length) return '';
  const top = Math.max(...wf.shifts.map(x => x.rows[0].h)) || 1;
  const block = sh => {
    let run = sh.rows[0].h;
    return sh.rows.map((r, i) => {
      let left, w, cls;
      if (r.total) { left = 0; w = r.h / top * 100; cls = i ? 'wf-end' : 'wf-tot'; run = r.h; }
      else { w = -r.h / top * 100; run += r.h; left = run / top * 100; cls = 'wf-loss'; }
      return `<div class="wf-row"><span class="wf-k">${esc(r.key)}</span><span class="wf-track"><i class="${cls}" style="left:${left.toFixed(2)}%;width:${Math.max(0.3, w).toFixed(2)}%"></i></span><b class="wf-v">${r.total ? '' : '−'}${fmtH(r.h)}</b></div>`;
    }).join('');
  };
  const many = wf.shifts.length > 1;
  return `<div class="wf">${wf.shifts.map(sh => `${many ? `<h5 class="wf-h">${esc(sh.name)} <small>${sh.clock}</small></h5>` : ''}${block(sh)}`).join('')}
    ${many ? `<div class="wf-row wf-day"><span class="wf-k"><b>Effective production time per day</b></span><span class="wf-track"></span><b class="wf-v">${fmtH(wf.dayEff)} of ${fmtH(wf.schedH)}</b></div>` : ''}
    <p class="note">Per shift, averaged over the truck fleet. Each loss is applied once, in this order, in every shift. Darkness is counted from each shift's own clock times.</p></div>`;
}
function save() { try { localStorage.setItem('mfc-state-v1', JSON.stringify(state)); } catch (e) { /* ignore */ } }

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach(k => { if (a[k] == null) a[k] = {}; a = a[k]; }); a[ks.at(-1)] = v; }
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const round = (v, d = 3) => (v === '' || v == null || !isFinite(v) ? '' : +(+v).toFixed(d));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ------------------------------------------------------------------ static selects
function fillSelect(el, list, val, label = x => x.name) { el.innerHTML = list.map(x => `<option value="${x.id}">${esc(label(x))}</option>`).join(''); if (val != null) el.value = val; }
function initSelects() {
  fillSelect($('#sel-road'), ROADS, state.site.roadId, r => `${r.name} (RR ${r.rr} %, μ ${r.traction})`);
  $$('.sel-surface').forEach(el => fillSelect(el, SURFACES, state.site.surfaceId));
  $$('.sel-sky').forEach(el => fillSelect(el, SKY, state.site.skyId));
  fillSelect($('#sel-grading'), GRADING, state.site.gradingId);
  $$('.sel-target-basis').forEach(el => fillSelect(el, BASES, (state.target || {}).basis || 'auto'));
  $$('.sel-material').forEach(el => fillSelect(el, MATERIALS, state.materialId));
}

// ------------------------------------------------------------------ binding
function decimalsFor(q) { return { len: 1, temp: 1, speed: 1, dens: getSystem() === 'si' ? 3 : 0, decel: 2, mass: 2 }[q] ?? 3; }
function renderBound() {
  $$('[data-bind]').forEach(el => {
    const p = el.dataset.bind, v = getPath(state, p), q = el.dataset.q;
    if (el.type === 'checkbox') el.checked = !!v;
    else if (document.activeElement !== el) el.value = q ? round(toDisp(q, v), decimalsFor(q)) : (v ?? '');
  });
  $$('[data-u]').forEach(el => { el.textContent = `(${unit(el.dataset.u)})`; });
  $$('[data-show]').forEach(el => { el.textContent = getPath(state, el.dataset.show); });
}
function onBoundInput(e) {
  const el = e.target; const p = el.dataset.bind; if (!p) return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.tagName === 'SELECT') v = el.value;
  else if (['date', 'time', 'text'].includes(el.type)) v = el.value;
  else v = el.value === '' ? '' : (el.dataset.q ? toSI(el.dataset.q, el.value) : +el.value);
  setPath(state, p, v);
  if (p.startsWith('loaders.') || p.startsWith('trucks.')) { if (/(modelId|conditionId|setup)$/.test(p)) { normaliseRows(); renderRows(); } }
  if (p === 'site.skyId') { const sky = byId(SKY, v); if (sky && sky.surface) state.site.surfaceId = sky.surface; }
  schedule();
}

// ------------------------------------------------------------------ fleet rows
function normaliseRows() {
  state.loaders.forEach(l => {
    const m = byId(LOADERS, l.modelId); if (!m.buckets.some(b => b.id === l.bucketId)) l.bucketId = m.defaultBucket;
    const ok = setupsFor(m); if (!ok.some(x => x.id === (l.setup || 'bench'))) { l.setup = ok[0].id; l.swingDeg = ''; }
  });
}
// long model lists: grouped by class, then brand
const optGrouped = (list, classes, v, lab = x => x.name) => classes.map(c => {
  const items = list.filter(x => x.cls === c.id); if (!items.length) return '';
  return `<optgroup label="${esc(c.name)}">${items.slice().sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name, 'en', { numeric: true })).map(x => `<option value="${x.id}" ${x.id === v ? 'selected' : ''}>${esc(lab(x))}</option>`).join('')}</optgroup>`;
}).join('');
const opt = (list, v, lab = x => x.name) => list.map(x => `<option value="${x.id}" ${x.id === v ? 'selected' : ''}>${esc(lab(x))}</option>`).join('');
function renderRows() {
  $('#loader-rows').innerHTML = state.loaders.map((l, i) => {
    const m = byId(LOADERS, l.modelId);
    const cond = byId(CONDITIONS, l.conditionId);
    return `<div class="row"><button class="rm" data-rm="loaders.${i}" title="Remove">×</button><div class="grid">
      <label>Model<select data-bind="loaders.${i}.modelId">${optGrouped(LOADERS, LOADER_CLASSES, l.modelId)}</select></label>
      <label class="span2">Bucket<select data-bind="loaders.${i}.bucketId">${m.buckets.map(b => `<option value="${b.id}" ${b.id === l.bucketId ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select></label>
      <label>Number of units<input type="number" min="0" step="1" data-bind="loaders.${i}.count"></label>
      <label class="span2">Job condition<select data-bind="loaders.${i}.jobCond">${opt(JOB_CONDITIONS, l.jobCond)}</select></label>
      <label class="span2">Truck loading<select data-bind="loaders.${i}.loadingSide">${opt(LOADING_SIDES, l.loadingSide || 'single')}</select></label>
      <label class="span2">Digging face setup<select data-bind="loaders.${i}.setup">${opt(setupsFor(m), l.setup || 'bench')}</select></label>
      ${(l.setup || 'bench') === 'bench' ? `<label>Bench height <span class="u" data-u="len">${unit('len')}</span><input type="number" step="0.5" min="0" data-bind="loaders.${i}.benchHeightM" data-q="len" placeholder="${(() => { const b = m.buckets.find(x => x.id === l.bucketId) || m.buckets[0]; return b.stickM ? `= stick ${round(toDisp('len', b.stickM), 2)}` : ''; })()}"></label>` : ''}
      <label>Swing angle <span class="u">°</span><input type="number" step="5" data-bind="loaders.${i}.swingDeg" placeholder="${(byId(SETUPS, l.setup || 'bench') || { swingDeg: 90 }).swingDeg}"></label>
      <label>Machine condition<select data-bind="loaders.${i}.conditionId">${opt(CONDITIONS, l.conditionId)}</select></label>
      <label>Availability <span class="u">%</span><input type="number" step="1" data-bind="loaders.${i}.availabilityPct" placeholder="${Math.round(cond.availability * 100)}"></label>
      <label>Cycle time override <span class="u">s</span><input type="number" step="0.5" data-bind="loaders.${i}.cycleOverrideS" placeholder="auto"></label>
      <label>Fill factor override<input type="number" step="0.01" data-bind="loaders.${i}.fillOverride" placeholder="${state.material.fill}"></label>
    </div><div class="tag" id="ltag-${i}"></div></div>`;
  }).join('');
  $('#truck-rows').innerHTML = state.trucks.map((t, i) => {
    const m = byId(TRUCKS, t.modelId), cond = byId(CONDITIONS, t.conditionId);
    return `<div class="row"><button class="rm" data-rm="trucks.${i}" title="Remove">×</button><div class="grid">
      <label class="span2">Model<select data-bind="trucks.${i}.modelId">${optGrouped(TRUCKS, TRUCK_CLASSES, t.modelId, x => `${x.name} — ${fmtU('kg', x.ratedPayloadKg, 0)}`)}</select></label>
      <label>Number of trucks<input type="number" min="0" step="1" data-bind="trucks.${i}.count"></label>
      <label>Machine condition<select data-bind="trucks.${i}.conditionId">${opt(CONDITIONS, t.conditionId)}</select></label>
      <label>Availability <span class="u">%</span><input type="number" step="1" data-bind="trucks.${i}.availabilityPct" placeholder="${Math.round(cond.availability * 100)}"></label>
      <label>Rated payload <span class="u">(${unit('kg')})</span><input type="number" step="100" data-bind="trucks.${i}.payloadKg" data-q="kg" placeholder="${round(toDisp('kg', m.ratedPayloadKg), 0)}"></label>
      <label>Body fill factor <span class="u">%</span><input type="number" step="1" min="40" max="110" data-bind="trucks.${i}.bodyFillPct" placeholder="100"></label>
      <label>Spot / exchange <span class="u">min</span><input type="number" step="0.05" data-bind="trucks.${i}.spotMin" placeholder="${m.defaults.spotMin}"></label>
      <label>Maneuver + dump <span class="u">min</span><input type="number" step="0.05" data-bind="trucks.${i}.dumpMin" placeholder="${m.defaults.dumpMin}"></label>
    </div><div class="tag">${esc(m.type)} · rated ${fmtU('kg', m.ratedPayloadKg, 0)} · heaped ${fmtU('vol', m.heapedM3, 1)} · empty ${fmtU('kg', m.emptyKg, 0)} · net ${fmtU('power', m.netPowerKw, 0)} · top ${fmtU('speed', m.topSpeedKmh, 0)}${Object.keys(m.estimate).length ? ' · <span class="badge est">some curves estimated</span>' : ''}</div></div>`;
  }).join('');
  renderBound();
}

// ------------------------------------------------------------------ engine input
function toEngineInput(siteIn = null, main = !siteIn) {
  const s = state;
  if (!s.site.date) s.site.date = todayISO();
  const c = siteConditions(siteIn || s.site, s.ops);
  const cap = c.capKmh || Infinity;
  const site = { ...(siteIn || s.site), tempC: c.tempC, speedLimitKmh: Math.min(+s.site.speedLimitKmh || Infinity, cap), downhillLimitKmh: Math.min(+s.site.downhillLimitKmh || Infinity, cap) };
  delete site.altitudeM;
  const ops = { ...s.ops, jobEff: c.jobEff, utilization: c.utilization, truckUtil: c.truckUtil, condFactor: main ? c.condFactor : 1, shiftH: c.operatingH, shiftsPerDay: c.nShifts };
  if (main) { lastCond = c; lastOps = ops; }
  return {
    site,
    material: { looseTm3: looseOf(s.material), fill: s.material.fill, frozen: s.material.frozen },
    loaders: s.loaders.map(l => {
      const m = byId(LOADERS, l.modelId), b = m.buckets.find(x => x.id === l.bucketId) || m.buckets[0];
      return { modelId: l.modelId, count: +l.count || 0, bucketM3: b.m3, maxPassT: b.maxT || 0, loadHeightM: b.loadHeightM, digDepthM: b.digDepthM, stickM: b.stickM, setup: l.setup || 'bench', loadingSide: l.loadingSide || 'single', benchHeightM: l.benchHeightM === '' || l.benchHeightM == null ? (b.stickM || 0) : +l.benchHeightM, jobCond: l.jobCond, swingDeg: l.swingDeg === '' || l.swingDeg == null ? null : +l.swingDeg,
        conditionId: l.conditionId, availability: l.availabilityPct === '' ? '' : +l.availabilityPct / 100, cycleOverrideS: l.cycleOverrideS || '', fillOverride: l.fillOverride || '' };
    }),
    trucks: s.trucks.map(t => ({ modelId: t.modelId, count: +t.count || 0, conditionId: t.conditionId, availability: t.availabilityPct === '' ? '' : +t.availabilityPct / 100,
      payloadKg: t.payloadKg === '' || t.payloadKg == null ? null : +t.payloadKg, bodyFill: t.bodyFillPct === '' || t.bodyFillPct == null ? '' : +t.bodyFillPct / 100, spotMin: t.spotMin === '' ? undefined : +t.spotMin, dumpMin: t.dumpMin === '' ? undefined : +t.dumpMin })),
    profile: { ...s.profile, points: s.profile.points },
    ops,
    cond: c,
  };
}

// ------------------------------------------------------------------ compute & render
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(run, 120); }
function run() {
  save();
  renderBound();
  const mat = byId(MATERIALS, state.materialId);
  $('#material-note').textContent = mat ? `Source: ${mat.src}` : '';
  if (!state.profile.points) return;
  let input;
  try {
    const se = state.season;
    if (!state.site.date) state.site.date = todayISO();
    // one weather day (check mode) or, normally, a dry clear day first; the schedule then picks the reference day
    input = toEngineInput(se.checkDay ? { ...state.site, date: se.checkDate || state.site.date } : { ...state.site, skyId: 'clear', surfaceId: 'dry', tempC: '' }, true);
    result = computeScenario(input);
    seasonResult = seasonCalc(); seasonRangeRes = [-1, 1].map(L => seasonCalc(L));
    if (!se.checkDay && seasonResult && seasonResult.rows.length) {
      const ref = dominantDay(seasonResult);
      result = computeScenario(toEngineInput(ref.site, true));
      applySeasonAverage(result, seasonResult, ref);
    }
  } catch (e) { $('#warnings').innerHTML = `<b>Error:</b> ${esc(e.message)}`; console.error(e); return; }
  { const road = result.road;
    $('#road-resolved').innerHTML = `Used${result.season ? ` on the most common day (${esc(byId(SURFACES, result.season.ref.site.surfaceId)?.name.toLowerCase() || '')})` : ''}: RR <b>${road.rr.toFixed(1)} %</b> · traction <b>${road.mu.toFixed(2)}</b>${road.surface && road.surface.note ? `<br><small>${esc(road.surface.note)}</small>` : ''}`; }
  renderProjBar(); renderInfos(); setHdrH(); document.body.classList.toggle('day-only', state.ops.shiftPattern !== 'daynight');
  renderSiteDerived();
  renderTags(); renderKPIs(); renderTables(); renderCharts(); renderProfileSummary();
  renderSeason();
  updateVisual(result);
}

// ------------------------------------------------------------------ seasonal schedule
// For every month from the work date: split the days into weather day types (from the site climate), compute the
// production of each day type with the normal engine (same fleet, road and shift), weight by days, and add up.
let seasonResult = null;
function seasonCalc(level = state.season.level) {
  const se = state.season || {};
  if (!se.on || !result) return null;
  const cache = new Map(), tc = targetCalc(result, false);
  const dayTonnes = (t, mo) => {
    const site = { ...state.site, date: `${mo.y}-${String(mo.m + 1).padStart(2, '0')}-15`, tempC: +mo.tempC.toFixed(1), skyId: t.skyId, surfaceId: t.surfaceId };
    const inp = toEngineInput(site), c = inp.cond;
    // the engine result only depends on sky/surface (speed caps, RR, traction); darkness, dust and visibility go in condFactor
    const key = `${t.skyId}|${t.surfaceId}|${c.capKmh}|${mo.tempC > 30 ? Math.round(mo.tempC) : 0}`;
    if (!cache.has(key)) cache.set(key, computeScenario(inp).prod.dayT);
    // dense fog: work stops for part of the day (hours lost of the scheduled hours per day)
    const stop = t.key === 'fog' ? Math.min(1, (+se.fogStopH || 0) / c.schedH) : 0;
    return cache.get(key) * c.condFactor * (1 - stop);
  };
  const out = runSchedule({ start: state.site.date || todayISO(), end: se.end || '', level, overrides: se.climate || {}, targetT: tc.ok ? tc.tonnes : 0,
    workFrac: (+state.ops.daysPerYear || 365) / 365, elevM: result.siteAlt, dayTonnes });
  out.level = level; out.tc = tc;
  return out;
}
// The most common weather day over the schedule (by working days): cycle times, speeds and match factor are shown for it.
function dominantDay(sr) {
  const acc = {}; let total = 0;
  sr.rows.forEach(r => r.types.forEach(t => {
    const k = `${t.skyId}|${t.surfaceId}`, w = t.share * r.workDays; total += w;
    const a = acc[k] || (acc[k] = { w: 0, best: -1, t, row: r });
    a.w += w; if (w > a.best) { a.best = w; a.t = t; a.row = r; }
  }));
  const top = Object.values(acc).sort((a, b) => b.w - a.w)[0], r = top.row;
  return { site: { ...state.site, skyId: top.t.skyId, surfaceId: top.t.surfaceId, tempC: +r.tempC.toFixed(1), date: `${r.y}-${String(r.m + 1).padStart(2, '0')}-15` },
    label: top.t.label, month: `${MON[r.m]} ${r.y}`, tempC: r.tempC, share: total > 0 ? top.w / total : 1 };
}
// Production figures become the average per working day over the schedule (all day types, all months).
function applySeasonAverage(r, sr, ref) {
  const wd = sr.rows.reduce((s, x) => s + x.workDays, 0);
  if (!(wd > 0) || !(r.prod.dayT > 0)) return;
  const avg = sr.total / wd, f = avg / r.prod.dayT, last = sr.rows.at(-1);
  r.prodRef = r.prod;
  r.prod = { ...r.prod, tph: r.prod.tph * f, shiftT: r.prod.shiftT * f, dayT: avg, yearT: r.prod.yearT * f };
  const iso = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  r.season = { f, ref, wd, from: iso(sr.rows[0].y, sr.rows[0].m, sr.rows[0].from), to: sr.finish ? sr.finish.date : iso(last.y, last.m, last.from + last.days - 1) };
}
// Text for the weather used: season (with the reference day) or the one checked day
function weatherLabel(r = result) {
  if (r && r.season) return `season weather · cycle shown for the most common day: ${r.season.ref.label.toLowerCase()}`;
  return `one day: ${byId(SKY, state.site.skyId)?.name || ''}, ${(byId(SURFACES, state.site.surfaceId)?.name || '').toLowerCase()} road`;
}
// Hover ⓘ tables: what each grader / road type / water-truck option does in the model
function infoHTML(kind) {
  let body = '';
  if (kind === 'grading') {
    body = `<b>Grader maintenance in the model</b><table><tr><th>Option</th><th>Snow penalty removed</th><th>Snow speed cap</th><th>Mud / wet penalty kept</th><th>Extra RR</th></tr>${GRADING.map(g => `<tr${g.id === state.site.gradingId ? ' class="sel"' : ''}><td>${esc(g.name)}</td><td>${Math.round(g.snowClear * 100)} % <small>(ice ${Math.round(g.snowClear * 50)} %)</small></td><td>× ${(1 + 0.6 * g.snowClear).toFixed(2)}</td><td>${Math.round(g.keep * 100)} %</td><td>+${g.rrExtra} %</td></tr>`).join('')}</table>
      <small>Snow penalty = extra rolling resistance and lost traction on packed / loose snow. Snow speed caps (packed 40, loose 30, ice 25 km/h) are raised by the factor shown. Planning estimates.</small>`;
  } else if (kind === 'road') {
    body = `<b>Road type (dry, base values)</b><table><tr><th>Road</th><th>RR</th><th>Traction μ</th></tr>${ROADS.map(r => `<tr${r.id === state.site.roadId ? ' class="sel"' : ''}><td>${esc(r.name)}</td><td>${r.rr} %</td><td>${r.traction}</td></tr>`).join('')}</table><small>${esc(ROAD_SRC)} Weather and snow add to these month by month.</small>`;
  } else if (kind === 'water') {
    body = `<b>Water truck (dust control)</b><table><tr><th>Day's mean temperature</th><th>Water truck</th></tr><tr><td>above 3 °C</td><td>works all shift → no dust</td></tr><tr><td>0 to 3 °C</td><td>daytime only (night frost) → half the dust</td></tr><tr><td>0 °C or colder</td><td>not used (water would freeze); frozen road → light dust only</td></tr></table>
      <small>Without water on a dry road: dust costs ${Math.round((state.ops.assumptions.dustEffLoss || 0) * 100)} % efficiency and, when heavy, a ${state.ops.assumptions.dustCapKmh} km/h speed cap.</small>`;
  }
  return `<span class="info" tabindex="0" aria-label="What the options mean">ⓘ<span class="info-tip">${body}</span></span>`;
}
function renderInfos() { $$('[data-info]').forEach(el => { el.innerHTML = infoHTML(el.dataset.info); }); }
function shiftSummary() {
  const o = state.ops;
  return o.shiftPattern === 'daynight' ? `day ${esc(o.shiftStart)}–${esc(o.shiftEnd)}, night ${esc(o.nightStart)}–${esc(o.nightEnd)}` : `day ${esc(o.shiftStart)}–${esc(o.shiftEnd)}`;
}
function renderProjBar() {
  const md = matDerived(), st = state, r = result;
  const m = $('#pb-material'); if (m) m.innerHTML = `<b>${esc(byId(MATERIALS, st.materialId)?.name || 'Material')}</b><small>${fmt('dens', md.loose, 2)} ${unit('dens')} in the truck</small>`;
  const sh = $('#pb-shift'); if (sh) sh.innerHTML = `<b>Work hours</b><small>${shiftSummary()} · ${st.ops.daysPerYear} d/yr</small>`;
  const day = $('#pb-day'); if (day) day.hidden = !st.season.checkDay;
  const s = $('#pb-status'); if (!s || !r) return;
  const lvl = esc(levelLabel(st.season.level));
  if (r.season) {
    const x = r.season;
    s.innerHTML = `<b>${lvl}.</b> Production figures = average per working day from ${x.from} to ${x.to} with the month-by-month weather. Cycle times, speeds and match factor are shown for the most common day: <b>${esc(x.ref.label)}</b> (${x.ref.month}, ${fmt('temp', x.ref.tempC, 0)} ${unit('temp')}, ${(x.ref.share * 100).toFixed(0)} % of working days).`;
  } else if (st.season.checkDay) {
    const c = lastCond;
    s.innerHTML = `<b>Checking one weather day</b> (${esc(st.season.checkDate || st.site.date)}${c ? `, ${fmt('temp', c.tempC, 0)} ${unit('temp')}` : ''}): all results except the target finish date use this day. The target finish date still uses the month-by-month weather (${lvl.toLowerCase()}).`;
  } else s.innerHTML = lvl;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// optimistic and cautious ends of the slider (computed once per run)
let seasonRangeRes = null;
const seasonRange = () => seasonRangeRes;
function seasonHTML(sr = seasonResult) {
  const se = state.season || {};
  if (!se.on) return '<p class="muted">Seasonal schedule is off. Turn it on to see production month by month with the site weather.</p>';
  if (!sr || !sr.rows.length) return '<p class="muted">Set a work (start) date to see the month-by-month schedule.</p>';
  const md = matDerived(), tc = sr.tc, basis = tc.basis || 'bcm', dens = basis === 'bcm' ? md.bank : md.loose;
  const vol = t => fmt('vol', t / dens, 0);
  const rng = seasonRange();
  const maxT = Math.max(...sr.rows.map(r => r.perDay), 1);
  const typeCol = { fog: '#7d6aa8', heavy: 'var(--blue)', light: '#8fb3d9', rain: '#5aa0a0', packed: '#b9c4cf', dry: 'var(--accent)' };
  const rows = sr.rows.map(r => {
    const mix = r.types.map(t => `<span style="flex:${t.share};background:${typeCol[t.key]}" title="${esc(t.label)}: ${t.days.toFixed(1)} days, ${fmtU('mass', t.dayT, 0)}/day"></span>`).join('');
    return `<tr><td>${MON[r.m]} ${r.y}${r.from > 1 || r.partial || r.to < r.dim ? ` <small class="muted">(${r.partial ? `to day ${r.from + r.days - 1}` : `${r.from}–${r.to}`})</small>` : ''}</td>
      <td>${fmt('temp', r.tempC, 0)}</td><td>${r.c.sn02.toFixed(0)}</td><td>${r.c.sn5.toFixed(0)}</td><td>${(r.c.pr02 - Math.min(r.c.pr02, r.c.sn02)).toFixed(0)}</td><td>${(r.c.fog || 0).toFixed(1)}</td>
      <td><div class="stack mini">${mix}</div></td>
      <td><span class="sbar"><i style="width:${(r.perDay / maxT * 100).toFixed(1)}%"></i></span> ${fmt('mass', r.perDay, 0)}</td>
      <td>${r.workDays.toFixed(1)}</td><td>${vol(r.monthT)}</td><td><b>${vol(r.cum)}</b></td></tr>`;
  }).join('');
  const legend = Object.entries({ fog: 'Dense fog', heavy: 'Heavy snow (storm ≥ 5 cm)', light: 'Light snowfall', rain: 'Rain', packed: 'Dry, snow-packed road', dry: 'Dry' }).map(([k, v]) => `<span><i style="background:${typeCol[k]}"></i>${v}</span>`).join('');
  const fin = sr.finish ? `Finishes around <b>${sr.finish.date}</b> (${sr.finish.workDays.toFixed(0)} working days)` : tc.ok ? `<b>Target not reached</b> by ${se.end || 'the end of the 3-year window'} — ${vol(sr.total)} of ${fmt('vol', tc.V, 0)} ${volU(basis)} done` : `${vol(sr.total)} ${volU(basis)} by ${se.end || 'the end of the window'} (enter a target volume to get a finish date)`;
  const span = rng && rng.every(x => x && x.finish) ? ` · range ${rng[0].finish.date} (optimistic) to ${rng[1].finish.date} (cautious)` : '';
  return `<p class="season-head">${fin}${span}<br><small class="muted">${esc(levelLabel(se.level))} · temperatures corrected from the station (${CLIMATE.elevM} m) to the haul road (${fmt('len', result.siteAlt, 0)} ${unit('len')}): ${sr.tAdj >= 0 ? '+' : ''}${sr.tAdj.toFixed(1)} °C</small></p>
    <div class="tblwrap"><table class="tbl season-tbl"><thead><tr><th>Month</th><th>Temp ${unit('temp')}</th><th>Snow days</th><th>Heavy-snow days</th><th>Rain days</th><th>Fog days</th><th>Weather mix</th><th>${unit('mass')} per working day</th><th>Working days</th><th>${volU(basis)} this month</th><th>Cumulative</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${seasonChart(sr, dens, basis)}
    <div class="stack-legend">${legend}</div>`;
}
// Cumulative volume vs date (inline SVG): the chosen level, plus the optimistic/cautious ends as a band
function seasonChart(sr, dens, basis) {
  const rng = seasonRange() || [], all = [sr, ...rng].filter(Boolean);
  const W = 760, H = 220, PL = 64, PR = 16, PT = 14, PB = 30;
  const pts = x => { const p = [[x.rows[0] ? Date.UTC(x.rows[0].y, x.rows[0].m, x.rows[0].from) : 0, 0]]; x.rows.forEach(r => p.push([Date.UTC(r.y, r.m, r.from + r.days), r.cum])); return p; };
  const series = all.map(pts), t0 = series[0][0][0], t1 = Math.max(...series.map(s => s.at(-1)[0])), yMax = Math.max(sr.tc.ok ? sr.tc.tonnes : 0, ...series.map(s => s.at(-1)[1])) * 1.05 || 1;
  const X = t => PL + (t - t0) / Math.max(1, t1 - t0) * (W - PL - PR), Y = v => H - PB - v / yMax * (H - PT - PB);
  const path = s => s.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  let grid = '';
  for (let k = 0; k <= 4; k++) { const v = yMax / 1.05 * k / 4; grid += `<line x1="${PL}" x2="${W - PR}" y1="${Y(v)}" y2="${Y(v)}" class="pg"/><text x="${PL - 6}" y="${Y(v) + 4}" text-anchor="end" class="pt">${fmt('vol', v / dens / 1000, 0)}k</text>`; }
  // x-axis: start date on the left, finish (or end) date of the chosen level on the right, a few months in between
  const iso = t => new Date(t).toISOString().slice(0, 10), tEnd = series[0].at(-1)[0], xEnd = X(tEnd);
  const months = sr.rows.map(r => Date.UTC(r.y, r.m, 1)).filter(t => X(t) > PL + 70 && X(t) < xEnd - 70);
  const step = Math.max(1, Math.ceil(months.length / 4));
  months.forEach((t, k) => { const x = X(t); grid += `<line x1="${x}" x2="${x}" y1="${PT}" y2="${H - PB}" class="pg"/>${k % step === 0 ? `<text x="${x}" y="${H - PB + 16}" class="pt" text-anchor="middle">${MON[new Date(t).getUTCMonth()]}</text>` : ''}`; });
  grid += `<text x="${PL}" y="${H - PB + 16}" class="pt pdate">${iso(t0)}</text><line x1="${xEnd}" x2="${xEnd}" y1="${PT}" y2="${H - PB}" class="pfinish"/><text x="${xEnd}" y="${H - PB + 16}" class="pt pdate" text-anchor="${xEnd > W - PR - 40 ? 'end' : 'middle'}">${sr.finish ? 'finish ' : ''}${iso(tEnd - 864e5)}</text>`;
  const tgt = sr.tc.ok ? `<line x1="${PL}" x2="${W - PR}" y1="${Y(sr.tc.tonnes)}" y2="${Y(sr.tc.tonnes)}" class="ptarget"/><text x="${W - PR - 4}" y="${Y(sr.tc.tonnes) - 5}" text-anchor="end" class="pt">target</text>` : '';
  return `<svg class="season-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative volume by date">${grid}${tgt}
    ${rng.filter(Boolean).map(x => `<path d="${path(pts(x))}" class="pband"/>`).join('')}<path d="${path(series[0])}" class="pmain"/>
    <text x="14" y="${(PT + H - PB) / 2}" class="pt" transform="rotate(-90 14 ${(PT + H - PB) / 2})" text-anchor="middle">cumulative k ${volU(basis)}</text></svg>
    <p class="note">Solid line: the chosen weather level. Dashed lines: optimistic and cautious ends of the slider.</p>`;
}
function renderSeason() {
  const html = seasonHTML();
  ['#season-out', '#v-season-out'].forEach(id => { const el = $(id); if (el) el.innerHTML = html; });
  const lab = levelLabel(state.season.level);
  $$('.season-level-lbl').forEach(x => { x.textContent = lab; });
}
// Editable monthly climate table (blank = station median); the P10–P90 spread moves with an edited value
function renderClimateTable() {
  const el = $('#climate-rows'); if (!el) return;
  el.innerHTML = CLIMATE.months.map((row, m) => `<tr><td>${MON[m]}</td>${CLIMATE_KEYS.map(k => `<td><input type="number" step="${k === 'tmean' ? 0.5 : 1}" data-bind="season.climate.${m + 1}.${k}" placeholder="${row[k][1]}" title="Station record: P10 ${row[k][0]}, median ${row[k][1]}, P90 ${row[k][2]}"></td>`).join('')}</tr>`).join('');
  $('#climate-head').innerHTML = `<th>Month</th>${CLIMATE_KEYS.map(k => `<th>${esc(CLIMATE_LABELS[k])}</th>`).join('')}`;
}

function renderTags() {
  const active = state.loaders.map((x, i) => (+x.count > 0 ? i : -1)).filter(i => i >= 0);
  state.loaders.forEach((x, i) => { const el = $(`#ltag-${i}`); if (el && !(+x.count > 0)) el.textContent = 'Not in use (0 units).'; });
  result.loaders.forEach((l, j) => {
    const tc = result.trucks[0]?.pairs[j]?.tc;
    const el = $(`#ltag-${active[j]}`);
    if (el) el.innerHTML = `${l.model.electric ? 'Electric drive (no diesel)' : `Net ${fmtU('power', l.model.netPowerKw, 0)}`} · ${l.model.cls === 'shovel' ? 'dipper' : 'bucket'} ${fmtU('vol', l.bucketM3, 1)} · max loading height ${fmtU('len', l.loadHeightM, 1)} · ${setupTag(l)} · cycle used <b>${tc ? tc.toFixed(1) : '—'} s</b> · availability ${(l.A * 100).toFixed(0)} %${Object.keys(l.model.estimate).length ? ' · <span class="badge est">cycle times are handbook estimates</span>' : ''}`;
  });
}

function mfMessage(mf) {
  if (!mf) return ['—', ''];
  if (mf < 0.85) return ['Under-trucked', 'Loaders wait for trucks. Loader efficiency ≈ MF; trucks work at 100 %.'];
  if (mf < 0.98) return ['Slightly under-trucked', 'Usually the lowest-cost zone for mining fleets (Burt & Caccetta).'];
  if (mf <= 1.05) return ['Balanced', 'Truck arrival rate ≈ loader service rate. Real fleets lose a little to bunching.'];
  if (mf <= 1.2) return ['Slightly over-trucked', 'Loaders at 100 %; trucks queue at the loader.'];
  return ['Over-trucked', 'Trucks queue. Truck efficiency ≈ 1 / MF.'];
}
function renderKPIs() {
  const r = result, mf = r.mf;
  const [t, m] = mfMessage(mf);
  $('#mf-val').textContent = mf ? mf.toFixed(2) : '—';
  $('#mf-msg').innerHTML = `<b>${t}</b> — ${m}<br><small>Nominal ${r.mfNominal.toFixed(2)} · on available units ${r.mfAvail.toFixed(2)}</small>`;
  $('#mf-pin').style.left = `${Math.max(0, Math.min(100, (mf - 0.5) * 100))}%`;
  $('#k-tph').textContent = fmtU('rate', r.prod.tph, 0);
  $('#k-tph-sub').innerHTML = `${r.season ? 'season average · ' : ''}${fmtU('mass', r.prod.dayT, 0)} / day · bottleneck: ${r.prod.bottleneck}`;
  $('#k-need').textContent = r.trucksForMF1 ? r.trucksForMF1.toFixed(1) : '—';
  const N = r.trucks.reduce((s, t) => s + t.n, 0);
  $('#k-need-sub').innerHTML = `now ${N} · incl. availability: <b>${Math.ceil(r.trucksForMF1WithAvail || 0)}</b> to deploy`;
  $('#k-fuel').textContent = `${fmt('fuelpm', r.fuel.lPerT, 3)} ${unit('fuelpm')}`;
  $('#k-fuel-sub').textContent = `${fmt('co2pm', r.fuel.co2KgPerT, 2)} ${unit('co2pm')} CO₂ · fleet ${fmt('fuel', r.fuel.truckLph + r.fuel.loaderLph, 0)} ${unit('fuel')}/h`;
  const w = r.warnings;
  $('#warnings').innerHTML = w.length ? `<b>Check ${w.length} item${w.length > 1 ? 's' : ''}</b><ul>${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
}

const min = s => (s / 60).toFixed(2);
function renderTables() {
  const r = result;
  let rows = r.trucks.map(t => {
    const tph = t.loadT / t.ct * 3600 * lastOps.jobEff * lastOps.utilization * lastOps.truckUtil * lastOps.condFactor * t.A;
    return `<tr><td>${esc(t.truck.name)}</td><td>${t.n}</td><td>${(t.A * 100).toFixed(0)} %</td><td>${fmt('mass', t.loadT, 1)}</td><td>${min(t.spotS)}</td><td>${min(t.loadTimeS)}</td><td>${min(t.haul.t)}</td><td>${min(t.dumpS)}</td><td>${min(t.ret.t)}</td><td><b>${min(t.ct)}</b></td><td>${fmt('rate', tph, 0)}</td><td>${fmt('fuel', t.fuelL / t.ct * 3600, 0)}</td></tr>`;
  }).join('');
  $('#tbl-trucks').innerHTML = `<thead><tr><th>Truck</th><th>No.</th><th>Avail.</th><th>Load (${unit('mass')})</th><th>Spot</th><th>Load</th><th>Haul</th><th>Dump</th><th>Return</th><th>Cycle (min)</th><th>${unit('rate')} / truck</th><th>Fuel ${unit('fuel')}/h</th></tr></thead><tbody>${rows}</tbody>`;
  rows = '';
  r.trucks.forEach(t => t.pairs.forEach((p, j) => {
    const L = r.loaders[j];
    rows += `<tr><td>${esc(t.truck.name)} × ${esc(L.model.name)}</td><td>${fmt('mass', p.bucketT, 2)}</td><td>${p.raw.toFixed(2)} <small>(${p.governs})</small></td><td><b>${(+p.n).toFixed(state.ops.passRule === 'exact' ? 2 : 0)}</b></td><td>${fmt('mass', p.loadT, 1)}</td>
      <td><span class="pill ${p.overloadPct > 10 ? 'bad' : ''}">${(100 + p.overloadPct).toFixed(0)} %</span></td><td>${p.volFillPct.toFixed(0)} %</td><td>${p.tc.toFixed(1)}</td><td>${p.loadTimeS.toFixed(0)}</td><td><span class="pill ${p.heightOk ? 'ok' : 'bad'}">${p.heightOk ? 'OK' : 'low'}</span></td></tr>`;
  }));
  $('#tbl-pairs').innerHTML = `<thead><tr><th>Pair</th><th>Bucket (${unit('mass')})</th><th>Raw passes</th><th>Passes</th><th>Load (${unit('mass')})</th><th>% rated</th><th>Heaped body used</th><th>Cycle (s)</th><th>Load time (s)</th><th>Height</th></tr></thead><tbody>${rows}</tbody>`;

  const p = r.prod, md = matDerived(), tgt = targetCalc(r);
  const rise = r.segs.reduce((s, x) => s + Math.max(0, x.z1 - x.z0), 0), fall = r.segs.reduce((s, x) => s + Math.max(0, x.z0 - x.z1), 0);
  const kv = [
    [r.season ? 'Production (season average)' : 'Production (operating)', fmtU('rate', p.tph, 0)], ['Per shift', fmtU('mass', p.shiftT, 0)], ['Per day', fmtU('mass', p.dayT, 0)], ['Per year', fmtU('mass', p.yearT / 1e6, 2).replace(unit('mass'), `M ${unit('mass')}`)],
    ['Bank volume dug', `${fmt('vol', p.tph / md.bank, 0)} ${bcU()}/h`], ['Loose volume at dump', `${fmt('vol', p.tph / md.loose, 0)} ${lcU()}/h`], ['Truck capacity (theoretical)', fmtU('rate', p.truckCapTph, 0)], ['Loader capacity (theoretical)', fmtU('rate', p.loaderCapTph, 0)],
    ['Loader efficiency', `${(p.loaderEff * 100).toFixed(0)} %`], ['Truck efficiency', `${(p.truckEff * 100).toFixed(0)} %`], ['One-way haul', fmtU('len', r.totalHaulM, 0)],
    ['Climb / descent (loaded)', `${fmt('len', rise, 0)} / ${fmt('len', fall, 0)} ${unit('len')}`], ['Rolling resistance · traction', `${r.road.rr.toFixed(1)} % · ${r.road.mu.toFixed(2)}`],
    ...(tgt.ok ? [['Target', `${fmt('vol', tgt.V, 0)} ${volU(tgt.basis)}`], ['Working days to finish', `${tgt.workDays.toFixed(1)} d (≈ ${tgt.finish})`], ['Truck loads needed', tgt.totalLoads.toLocaleString('en-US')]] : []),
  ];
  $('#prod-kv').innerHTML = kv.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
  const wf = $('#time-wf'); if (wf) wf.innerHTML = waterfallHTML(waterfall());
}

function chartColors() { return { ink: css('--ink'), muted: css('--muted'), line: css('--line'), accent: css('--accent'), blue: css('--blue'), good: css('--good'), warn: css('--warn'), bad: css('--bad') }; }
function mkChart(id, cfg) {
  if (!window.Chart) return;
  if (charts[id]) { charts[id].destroy(); }
  const c = chartColors();
  Chart.defaults.color = c.muted; Chart.defaults.borderColor = c.line; Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
  charts[id] = new Chart(document.getElementById(id), cfg);
}
function renderCharts() {
  const r = result, c = chartColors();
  // cycle breakdown
  const parts = [['Spot', 'spotS', c.muted], ['Load', 'loadTimeS', c.accent], ['Haul (loaded)', h => h.haul.t, c.bad], ['Dump', 'dumpS', c.ink], ['Return (empty)', h => h.ret.t, c.blue]];
  mkChart('chart-cycle', { type: 'bar', data: { labels: r.trucks.map(t => `${t.truck.name} ×${t.n}`), datasets: parts.map(([lab, k, col]) => ({ label: lab, data: r.trucks.map(t => (typeof k === 'function' ? k(t) : t[k]) / 60), backgroundColor: col, borderRadius: 3 })) },
    options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.raw.toFixed(2)} min` } } }, scales: { x: { stacked: true, title: { display: true, text: 'minutes' } }, y: { stacked: true } } } });
  // speed along road
  const sel = $('#sel-speed-truck');
  const prev = sel.value; sel.innerHTML = r.trucks.map((t, i) => `<option value="${i}">${esc(t.truck.name)}</option>`).join(''); if (prev && +prev < r.trucks.length) sel.value = prev;
  const T = r.trucks[+sel.value || 0];
  if (T) {
    const off = Math.min(...r.segs.map(s => s.x0));
    const X = s => toDisp('len', s.x0 + s.len / 2 - off);
    mkChart('chart-speed', { data: { datasets: [
      { type: 'line', label: `Elevation (${unit('len')})`, data: r.segs.map(s => ({ x: X(s), y: toDisp('len', (s.z0 + s.z1) / 2) })), yAxisID: 'z', borderColor: c.muted, backgroundColor: c.line, fill: 'start', pointRadius: 0, borderWidth: 1.5, order: 3 },
      { type: 'line', label: `Loaded speed (${unit('speed')})`, data: T.haul.segs.map(s => ({ x: X(s), y: toDisp('speed', s.vAvg) })), yAxisID: 'v', borderColor: c.bad, pointRadius: 0, borderWidth: 2, stepped: 'middle', order: 1 },
      { type: 'line', label: `Empty speed (${unit('speed')})`, data: T.ret.segs.map(s => ({ x: X(s), y: toDisp('speed', s.vAvg) })).sort((a, b) => a.x - b.x), yAxisID: 'v', borderColor: c.blue, pointRadius: 0, borderWidth: 2, stepped: 'middle', order: 2 },
    ] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
      scales: { x: { type: 'linear', title: { display: true, text: `distance from loading point (${unit('len')})` } }, v: { position: 'left', beginAtZero: true, title: { display: true, text: unit('speed') } }, z: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: `elevation (${unit('len')})` } } } } });
    const segRows = T.haul.segs.map((s, i) => {
      const e = T.ret.segs[T.ret.segs.length - 1 - i];
      return `<tr><td>${i + 1} <small>${s.zone === 'haul road' ? '' : s.zone}</small></td><td>${fmt('len', s.x0 - off, 0)}–${fmt('len', s.x0 - off + s.len, 0)}</td><td>${s.grade.toFixed(1)} %</td><td>${fmt('speed', s.vAvg, 1)}</td><td><small>${s.reason}</small></td><td>${s.t.toFixed(0)}</td><td>${e ? fmt('speed', e.vAvg, 1) : ''}</td><td><small>${e ? e.reason : ''}</small></td><td>${e ? e.t.toFixed(0) : ''}</td></tr>`;
    }).join('');
    $('#tbl-segs').innerHTML = `<thead><tr><th>#</th><th>From–to (${unit('len')})</th><th>Grade (loaded dir.)</th><th>Loaded ${unit('speed')}</th><th>Limit</th><th>Time s</th><th>Empty ${unit('speed')}</th><th>Limit</th><th>Time s</th></tr></thead><tbody>${segRows}</tbody>`;
  }
  // sweep
  const sw = $('#sel-sweep'); const pv = sw.value;
  sw.innerHTML = r.trucks.map((t, i) => `<option value="${i}">number of ${esc(t.truck.name)}</option>`).join(''); if (pv && +pv < r.trucks.length) sw.value = pv;
  const k = +sw.value || 0;
  if (r.trucks[k]) {
    const maxN = Math.max(10, Math.ceil(r.trucks[k].n * 2.2), Math.ceil(r.trucksForMF1 * 1.6));
    const data = sweepTrucks(r, lastOps, k, maxN);
    mkChart('chart-sweep', { data: { labels: data.map(d => d.k), datasets: [
      { type: 'bar', label: `Production (${unit('rate')})`, data: data.map(d => toDisp('rate', d.tph)), yAxisID: 'p', backgroundColor: data.map(d => (d.k === r.trucks[k].n ? c.accent : c.line)), borderRadius: 3, order: 2 },
      { type: 'line', label: 'Match factor', data: data.map(d => d.mf), yAxisID: 'm', borderColor: c.ink, pointRadius: 2, borderWidth: 2, order: 1 },
      { type: 'line', label: 'MF = 1', data: data.map(() => 1), yAxisID: 'm', borderColor: c.good, borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5, order: 0 },
    ] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } },
      scales: { x: { title: { display: true, text: `number of ${r.trucks[k].truck.name}` } }, p: { position: 'left', beginAtZero: true, title: { display: true, text: unit('rate') } }, m: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'MF' } } } } });
  }
}

function renderProfileSummary() {
  const pts = state.profile.points; if (!pts || !window.Chart) return;
  const c = chartColors();
  mkChart('chart-profile-mini', { type: 'line', data: { datasets: [{ data: pts.map(p => ({ x: toDisp('len', p[0]), y: toDisp('len', p[1]) })), borderColor: c.accent, backgroundColor: c.accent + '22', fill: 'start', pointRadius: 0, borderWidth: 2 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { type: 'linear', title: { display: true, text: unit('len') } }, y: { title: { display: false } } } } });
  const segs = result ? result.segs.filter(s => s.zone === 'haul road') : [];
  const L = pts.at(-1)[0] - pts[0][0];
  const zs = pts.map(p => p[1]);
  const maxUp = Math.max(...segs.map(s => s.grade)), maxDn = Math.min(...segs.map(s => s.grade));
  $('#profile-summary').innerHTML = [
    ['Points', pts.length], ['Length', fmtU('len', L, 0)], ['Elevation range', `${fmt('len', Math.min(...zs), 0)}–${fmt('len', Math.max(...zs), 0)} ${unit('len')}`],
    ['Steepest loaded up / down', `${maxUp.toFixed(1)} % / ${maxDn.toFixed(1)} %`],
  ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
}

// ------------------------------------------------------------------ profile import
function parseProfile(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.trim().split(/[,;\t ]+/).filter(Boolean);
    const nums = cells.map(Number);
    if (nums.length >= 2 && nums.every(n => isFinite(n))) rows.push(nums);
  }
  if (rows.length < 2) throw new Error('Could not find at least two numeric rows in the file.');
  const cols = Math.min(...rows.map(r => r.length));
  const conv = v => toSI('len', v);
  if (cols >= 3) return { points: profileFromXYZ(rows.map(r => [conv(r[0]), conv(r[1]), conv(r[2])])), kind: 'x, y, z polyline' };
  return { points: rows.map(r => [conv(r[0]), conv(r[1])]), kind: 'distance, elevation' };
}
async function loadSample() {
  try {
    const txt = await (await fetch('data/sample-profile-evr.csv')).text();
    const prevSys = getSystem(); setSystem('si');
    const p = parseProfile(txt); setSystem(prevSys);
    state.profile.points = p.points; state.profile.name = 'Sample: EVR ElevBasemap profile (digitised, 4.5 km)';
    $('#profile-name').textContent = state.profile.name; run();
  } catch (e) { $('#profile-name').textContent = 'Could not load sample profile.'; }
}

// ------------------------------------------------------------------ export / io
function exportCSV() {
  const r = result; if (!r) return;
  const L = [];
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  L.push(['Match Factor Calculator export', new Date().toISOString()].map(q).join(','));
  L.push(['Units', getSystem() === 'si' ? 'Metric' : 'Imperial'].map(q).join(','));
  L.push(['Match factor', r.mf.toFixed(3), 'nominal', r.mfNominal.toFixed(3), 'available units', r.mfAvail.toFixed(3)].map(q).join(','));
  L.push(['Production', fmt('rate', r.prod.tph, 1), unit('rate'), 'bottleneck', r.prod.bottleneck].map(q).join(','));
  L.push(['Trucks for MF=1', r.trucksForMF1.toFixed(2), 'with availability', r.trucksForMF1WithAvail.toFixed(2)].map(q).join(','));
  L.push('');
  L.push(['Truck', 'No.', 'Availability', `Load (${unit('mass')})`, 'Spot min', 'Load min', 'Haul min', 'Dump min', 'Return min', 'Cycle min', `Fuel ${unit('fuel')}/cycle`].map(q).join(','));
  r.trucks.forEach(t => L.push([t.truck.name, t.n, t.A, fmt('mass', t.loadT, 2), min(t.spotS), min(t.loadTimeS), min(t.haul.t), min(t.dumpS), min(t.ret.t), min(t.ct), fmt('fuel', t.fuelL, 2)].map(q).join(',')));
  L.push('');
  L.push(['Pair', `Bucket ${unit('mass')}`, 'Raw passes', 'Passes', `Load ${unit('mass')}`, 'Loader cycle s', 'Load time s'].map(q).join(','));
  r.trucks.forEach(t => t.pairs.forEach((p, j) => L.push([`${t.truck.name} x ${r.loaders[j].model.name}`, fmt('mass', p.bucketT, 2), p.raw.toFixed(2), p.n, fmt('mass', p.loadT, 2), p.tc.toFixed(1), p.loadTimeS.toFixed(1)].map(q).join(','))));
  r.trucks.forEach(t => {
    L.push(''); L.push([`Segments — ${t.truck.name}`].map(q).join(','));
    L.push(['From', 'Length', 'Grade %', `Loaded avg ${unit('speed')}`, 'Loaded limit', 'Loaded s', `Empty avg ${unit('speed')}`, 'Empty limit', 'Empty s'].map(q).join(','));
    t.haul.segs.forEach((s, i) => { const e = t.ret.segs[t.ret.segs.length - 1 - i]; L.push([fmt('len', s.x0, 0), fmt('len', s.len, 0), s.grade.toFixed(2), fmt('speed', s.vAvg, 2), s.reason, s.t.toFixed(1), fmt('speed', e.vAvg, 2), e.reason, e.t.toFixed(1)].map(q).join(',')); });
  });
  download('match-factor-results.csv', L.join('\n'), 'text/csv');
}
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

// ------------------------------------------------------------------ events
function wire() {
  document.addEventListener('input', e => { if (e.target.dataset.bind) onBoundInput(e); });
  document.addEventListener('change', e => { if (e.target.dataset.bind && (e.target.tagName === 'SELECT' || e.target.type === 'checkbox')) onBoundInput(e); });
  document.addEventListener('click', e => { if (e.target.closest('.info')) e.preventDefault(); }, true);
  document.addEventListener('mouseover', e => { const i = e.target.closest && e.target.closest('.info'); if (i) i.classList.toggle('flip', i.getBoundingClientRect().left > innerWidth / 2); });
  document.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { const [k, i] = rm.dataset.rm.split('.'); state[k].splice(+i, 1); renderRows(); schedule(); }
  });
  document.addEventListener('change', e => { if (e.target.classList && e.target.classList.contains('sel-material')) { setMaterial(e.target.value); renderRows(); renderMaterialFields(); schedule(); } });
  const cd = $('#climate-dlg');
  document.addEventListener('click', e => { if (e.target.closest('#climate-open, [data-climate-open]')) { renderBound(); cd.showModal(); } });
  $('#climate-close').onclick = () => cd.close();
  cd.addEventListener('click', e => { if (e.target === cd) cd.close(); });
  $('#climate-reset').onclick = () => { state.season.climate = {}; renderBound(); schedule(); };
  $('#add-loader').onclick = () => { state.loaders.push({ ...clone(DEFAULTS.loaders[0]), modelId: 'cat385cl', bucketId: 'hb46' }); renderRows(); schedule(); };
  $('#add-truck').onclick = () => { state.trucks.push({ ...clone(DEFAULTS.trucks[0]), modelId: 'jd460p', count: 2 }); renderRows(); schedule(); };
  $('#profile-sample').onclick = loadSample;
  $('#profile-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const p = parseProfile(await f.text()); state.profile.points = p.points; state.profile.name = `${f.name} (${p.kind}, ${p.points.length} points)`; $('#profile-name').textContent = state.profile.name; run(); }
    catch (err) { $('#profile-name').textContent = `⚠ ${err.message}`; }
    e.target.value = '';
  };
  $('#sel-speed-truck').onchange = () => renderCharts();
  $('#sel-sweep').onchange = () => renderCharts();
  $$('.unit-toggle button').forEach(b => b.onclick = () => { state.units = b.dataset.units; setSystem(b.dataset.units); $$('.unit-toggle button').forEach(x => x.classList.toggle('active', x === b)); renderRows(); renderDocs(); run(); });
  $$('.tab').forEach(b => b.onclick = () => switchView(() => {
    $$('.tab').forEach(x => x.classList.toggle('active', x === b)); $$('.tabpanel').forEach(p => p.classList.toggle('active', p.id === `tab-${b.dataset.tab}`));
    $('#projbar').hidden = !['visual', 'calc'].includes(b.dataset.tab); setHdrH();
    if (b.dataset.tab === 'equip') renderDocs(); try { localStorage.setItem('mfc-tab', b.dataset.tab); } catch (e) { /* ignore */ }
  }));
  $$('#calc-sub button').forEach(b => b.onclick = () => switchView(() => setSub(b.dataset.sub)));
  window.addEventListener('resize', setHdrH);
  $('#btn-export').onclick = exportCSV;
  $('#btn-print').onclick = () => window.print();
  $('#btn-save').onclick = () => download('match-factor-scenario.json', JSON.stringify(state, null, 1), 'application/json');
  $('#scenario-file').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { state = migrate(JSON.parse(await f.text())); boot(); } catch (err) { alertBox(`Could not open scenario: ${err.message}`); } e.target.value = ''; };
  $('#btn-reset').onclick = () => { const pts = state.profile.points, nm = state.profile.name; state = clone(DEFAULTS); state.profile.points = pts; state.profile.name = nm; boot(); };
}
// Each tab (and each Detailed section) keeps its own scroll position
let curSub = (() => { try { return localStorage.getItem('mfc-sub') || 'equip'; } catch (e) { return 'equip'; } })();
const scrollMem = {};
const viewKey = () => { const t = document.querySelector('.tab.active')?.dataset.tab || 'visual'; return t === 'calc' ? `calc:${curSub}` : t; };
function switchView(fn) { scrollMem[viewKey()] = window.scrollY; fn(); const y = scrollMem[viewKey()] || 0; requestAnimationFrame(() => window.scrollTo(0, y)); }
function setSub(id) {
  curSub = id;
  $$('#calc-sub button').forEach(b => b.classList.toggle('active', b.dataset.sub === id));
  $$('[data-sec]').forEach(el => { el.hidden = id !== 'all' && el.dataset.sec !== id; });
  try { localStorage.setItem('mfc-sub', id); } catch (e) { /* ignore */ }
}
function setHdrH() { const h = document.querySelector('.topbar'); if (h) document.documentElement.style.setProperty('--hdr-h', `${h.offsetHeight}px`); }
function setMaterial(id) { state.materialId = id; state.material = { ...pickMat(id), frozen: state.material.frozen }; $$('.sel-material').forEach(s => { s.value = id; }); renderMaterialFields(); }
function renderMaterialFields() { const b = $('#bank-field'); if (b) b.hidden = !matDerived().isBlast; }
function renderSiteDerived() {
  const c = lastCond, md = matDerived(); if (!c) return;
  const el = $('#site-derived');
  if (el) el.innerHTML = `${result && result.season ? `Most common day (${esc(result.season.ref.label)}, ${result.season.ref.month}): ` : 'Checked day: '}${result && result.season ? `Air <b>${fmt("temp", c.tempC, 0)} ${unit("temp")}</b> (month average at the haul road)` : `Month average <b>${fmt("temp", c.tempAuto, 0)} ${unit("temp")}</b>${state.site.tempC === "" ? " (used)" : ""}`} · daylight ${hToClock(c.sun.sunrise)}–${hToClock(c.sun.sunset)} (${c.sun.dayLenH.toFixed(1)} h) · dark ${(c.darkFrac * 100).toFixed(0)} % of shift time<br>Water truck: <b>${esc(c.water.label)}</b>${c.dust > 0 ? ` · dust ${c.dust >= 0.5 ? 'heavy' : 'light'} (speed cap ${c.capKmh ? fmtU('speed', c.capKmh, 0) : 'none'})` : ''}${c.sky.capKmh ? ` · visibility cap ${fmtU('speed', c.sky.capKmh, 0)}` : ''}`;
  const mEl = $('#material-derived');
  if (mEl) mEl.innerHTML = `Loose density in the truck <b>${fmt('dens', md.loose, getSystem() === 'si' ? 3 : 0)} ${unit('dens')}</b> (load factor ${md.loadFactor.toFixed(3)})${md.isBlast ? ` · BCM uses solid rock ${fmt('dens', md.bank, getSystem() === 'si' ? 2 : 0)} ${unit('dens')}` : ''}`;
  const tEl = $('#time-derived');
  if (tEl) tEl.innerHTML = `${c.shifts.map(x => `${esc(x.name)} ${hToClock(x.start)}–${hToClock(x.end)} = <b>${x.lenH.toFixed(1)} h</b>, operating ${x.operatingH.toFixed(2)} h, ${(x.darkFrac * 100).toFixed(0)} % dark`).join('<br>')}<br>Utilization <b>${(c.utilization * 100).toFixed(1)} %</b> (trucks ${(c.utilization * c.truckUtil * 100).toFixed(1)} %) · condition factor <b>${c.condFactor.toFixed(3)}</b>`;
  const tg = $('#target-derived'); if (tg) tg.innerHTML = targetText();
  renderMaterialFields();
}
async function loadProfileFile(f) {
  const p = parseProfile(await f.text()); state.profile.points = p.points; state.profile.name = `${f.name} (${p.kind}, ${p.points.length} points)`; $('#profile-name').textContent = state.profile.name;
}
function alertBox(msg) { $('#warnings').innerHTML = `<b>${esc(msg)}</b>`; }
function renderDocs() { renderEquipment($('#equip-content')); renderMethod($('#method-content')); }

function boot() {
  setSystem(state.units || 'si');
  $$('.unit-toggle button').forEach(x => x.classList.toggle('active', x.dataset.units === getSystem()));
  setSub(curSub);   initSelects(); renderClimateTable(); normaliseRows(); renderRows(); renderDocs();
  $('#profile-name').textContent = state.profile.name || '';
  if (!state.profile.points) loadSample(); else run();
}
function setProfile(pts, name) { state.profile.points = pts; if (name) state.profile.name = name; $('#profile-name').textContent = state.profile.name; schedule(); }
// The editor always shows loading point on the left: if "Reverse direction" was ticked, flip the stored points once.
function editProfile() {
  const pr = state.profile;
  if (pr.reverse && pr.points && pr.points.length > 1) { const L = pr.points.at(-1)[0]; pr.points = pr.points.map(p => [L - p[0], p[1]]).reverse(); pr.reverse = false; renderBound(); }
  openProfileEditor();
}
wire();
initProfileEditor({ state: () => state, setProfile, schedule });
$('#profile-edit').onclick = editProfile;
initVisual({
  state: () => state, getPath: p => getPath(state, p), setPath: (p, v) => setPath(state, p, v), schedule, renderRows, renderBound, normaliseRows, setMaterial,
  newTruck: () => clone(DEFAULTS.trucks[0]), newLoader: () => clone(DEFAULTS.loaders[0]), loadSample, loadProfileFile,
  cond: () => lastCond, matDerived, weatherLabel, shiftSummary, infoHTML, waterfall, targetCalc, targetText, volU, setupFactor, swingOf, waterfallHTML, bcU, lcU, setProfile, editProfile,
});
boot();
try { const t = localStorage.getItem('mfc-tab'); if (t) document.querySelector(`.tab[data-tab="${t}"]`)?.click(); } catch (e) { /* ignore */ }
