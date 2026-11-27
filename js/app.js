import { TRUCKS, LOADERS, MATERIALS, ROADS, SURFACES, SKY, GRADING, SETUPS, LOADING_SIDES, CONDITIONS, JOB_CONDITIONS, ROAD_SRC, SOURCES, looseOf } from './data/equipment.js?v=202611271959';
import { siteConditions, hToClock } from './conditions.js?v=202611271959';
import { computeScenario, sweepTrucks, resolveRoad, profileFromXYZ, byId, interp, setupFactor, swingOf } from './engine.js?v=202611271959';
import { setSystem, getSystem, unit, toDisp, toSI, fmt, fmtU } from './units.js?v=202611271959';
import { renderEquipment, renderMethod } from './docs.js?v=202611271959';
import { initVisual, updateVisual } from './visual.js?v=202611271959';
import { initProfileEditor, openProfileEditor } from './profile-editor.js?v=202611271959';

// ------------------------------------------------------------------ state
const DEFAULTS = {
  site: { date: '', latitude: 49.7, longitude: -114.9, utcOffsetStd: -7, dst: true, tempC: '', skyId: 'clear', roadId: 'firm', surfaceId: 'dry', gradingId: 'shift', waterTruck: true,
    rrOverride: '', tractionOverride: '', speedLimitKmh: 70, downhillLimitKmh: 35, downhillGradePct: -3 },
  materialId: 'till',
  material: { ...pickMat('till'), frozen: false },
  loaders: [{ modelId: 'cat390fl', bucketId: 'sd46', count: 1, jobCond: 'C', setup: 'bench', loadingSide: 'single', benchHeightM: '', swingDeg: '', conditionId: 'good', availabilityPct: '', cycleOverrideS: '', fillOverride: '' }],
  trucks: [{ modelId: 'cat745', count: 6, conditionId: 'good', availabilityPct: '', payloadKg: '', bodyFillPct: '', spotMin: '', dumpMin: '' }],
  target: { volume: '', basis: 'auto' },
  profile: { segmentM: 100, loadAreaM: 50, dumpAreaM: 50, reverse: false, points: null, name: '' },
  ops: { shiftStart: '07:00', shiftEnd: '19:00', shiftsPerDay: 2, daysPerYear: 300, nonProdMin: 60, jobEffMin: 55,
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
    profile: { ...d.profile, ...(saved.profile || {}) }, target: { ...d.target, ...(saved.target || {}) },
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
function targetCalc(r = result) {
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
  return { basis, V, ok: true, dens, tonnes, workDays, calDays, finish, start: d0, bcm: tonnes / md.bank, lcm: tonnes / md.loose, loads, totalLoads };
}
const volU = b => (getSystem() === 'si' ? (b === 'bcm' ? 'BCM' : 'LCM') : (b === 'bcm' ? 'BCY' : 'LCY'));
function targetText(tc = targetCalc()) {
  if (!tc.ok) return tc.V ? '' : 'Enter a target volume to see how many days the fleet needs.';
  return `${fmt('vol', tc.V, 0)} ${volU(tc.basis)} × ${fmt('dens', tc.dens, 2)} ${unit('dens')} = <b>${fmtU('mass', tc.tonnes, 0)}</b> (${fmt('vol', tc.bcm, 0)} ${volU('bcm')} · ${fmt('vol', tc.lcm, 0)} ${volU('lcm')}) → <b>${tc.workDays.toFixed(1)} working days</b> at ${fmtU('mass', result.prod.dayT, 0)}/day · about ${Math.ceil(tc.calDays)} calendar days at ${state.ops.daysPerYear} working days/year, finishing around <b>${tc.finish}</b> if started ${tc.start}. Truck loads needed: <b>${tc.totalLoads.toLocaleString('en-US')}</b>${tc.loads.length > 1 ? ` (${tc.loads.map(x => `${x.n.toLocaleString('en-US')} × ${esc(x.name)} at ${fmt('mass', x.loadT, 1)} ${unit('mass')}`).join(' + ')})` : ` at ${fmt('mass', tc.loads[0].loadT, 1)} ${unit('mass')} per load`}.`;
}
// Hours per shift for an average truck: where the scheduled time goes (each loss applied once).
function waterfall(r = result, c = lastCond) {
  if (!r || !c) return [];
  const A = r.avgA || 1;
  const op = c.operatingH, avail = op * A;
  const afterStandby = avail * c.utilization * c.truckUtil;
  const afterDelays = afterStandby * c.jobEff;
  const eff = afterDelays * c.condFactor;
  return [
    { key: 'Scheduled shift', h: c.shiftLenH, total: true },
    { key: 'Meetings, planning, shift change', h: -c.nonProdH },
    { key: 'Mechanical downtime (availability)', h: -(op - avail) },
    { key: 'Standby (face clean-up, blasting, relocation, fuelling)', h: -(avail - afterStandby) },
    { key: 'Small operational delays (job efficiency)', h: -(afterStandby - afterDelays) },
    { key: 'Weather, dust & darkness', h: -(afterDelays - eff) },
    { key: 'Effective production time', h: eff, total: true },
  ];
}
const bcU = () => (getSystem() === 'si' ? 'BCM' : 'BCY'), lcU = () => (getSystem() === 'si' ? 'LCM' : 'LCY');
// Horizontal waterfall: each loss is a red bar hanging from the running total, totals are solid.
function waterfallHTML(rows) {
  if (!rows.length) return '';
  const top = rows[0].h || 1; let run = top;
  const fmtH = h => { const m = Math.round(Math.abs(h) * 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
  return `<div class="wf">${rows.map((r, i) => {
    let left, w, cls;
    if (r.total) { left = 0; w = r.h / top * 100; cls = i ? 'wf-end' : 'wf-tot'; run = r.h; }
    else { w = -r.h / top * 100; run += r.h; left = run / top * 100; cls = 'wf-loss'; }
    return `<div class="wf-row"><span class="wf-k">${esc(r.key)}</span><span class="wf-track"><i class="${cls}" style="left:${left.toFixed(2)}%;width:${Math.max(0.3, w).toFixed(2)}%"></i></span><b class="wf-v">${r.total ? '' : '−'}${fmtH(r.h)}</b></div>`;
  }).join('')}<p class="note">Per shift, averaged over the truck fleet. Each loss is applied once, in this order.</p></div>`;
}
function save() { try { localStorage.setItem('mfc-state-v1', JSON.stringify(state)); } catch (e) { /* ignore */ } }

const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach(k => { a = a[k]; }); a[ks.at(-1)] = v; }
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const round = (v, d = 3) => (v === '' || v == null || !isFinite(v) ? '' : +(+v).toFixed(d));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ------------------------------------------------------------------ static selects
function fillSelect(el, list, val, label = x => x.name) { el.innerHTML = list.map(x => `<option value="${x.id}">${esc(label(x))}</option>`).join(''); if (val != null) el.value = val; }
function initSelects() {
  fillSelect($('#sel-road'), ROADS, state.site.roadId, r => `${r.name} (RR ${r.rr} %, μ ${r.traction})`);
  fillSelect($('#sel-surface'), SURFACES, state.site.surfaceId);
  fillSelect($('#sel-sky'), SKY, state.site.skyId);
  fillSelect($('#sel-grading'), GRADING, state.site.gradingId);
  fillSelect($('#sel-target-basis'), BASES, (state.target || {}).basis || 'auto');
  fillSelect($('#sel-material'), MATERIALS, state.materialId);
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
  state.loaders.forEach(l => { const m = byId(LOADERS, l.modelId); if (!m.buckets.some(b => b.id === l.bucketId)) l.bucketId = m.defaultBucket; });
}
const opt = (list, v, lab = x => x.name) => list.map(x => `<option value="${x.id}" ${x.id === v ? 'selected' : ''}>${esc(lab(x))}</option>`).join('');
function renderRows() {
  $('#loader-rows').innerHTML = state.loaders.map((l, i) => {
    const m = byId(LOADERS, l.modelId);
    const cond = byId(CONDITIONS, l.conditionId);
    return `<div class="row"><button class="rm" data-rm="loaders.${i}" title="Remove">×</button><div class="grid">
      <label>Model<select data-bind="loaders.${i}.modelId">${opt(LOADERS, l.modelId)}</select></label>
      <label class="span2">Bucket<select data-bind="loaders.${i}.bucketId">${m.buckets.map(b => `<option value="${b.id}" ${b.id === l.bucketId ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select></label>
      <label>Number of units<input type="number" min="0" step="1" data-bind="loaders.${i}.count"></label>
      <label class="span2">Job condition<select data-bind="loaders.${i}.jobCond">${opt(JOB_CONDITIONS, l.jobCond)}</select></label>
      <label class="span2">Truck loading<select data-bind="loaders.${i}.loadingSide">${opt(LOADING_SIDES, l.loadingSide || 'single')}</select></label>
      <label class="span2">Digging face setup<select data-bind="loaders.${i}.setup">${opt(SETUPS, l.setup || 'bench')}</select></label>
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
      <label class="span2">Model<select data-bind="trucks.${i}.modelId">${opt(TRUCKS, t.modelId, x => `${x.name} — ${x.type}`)}</select></label>
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
function toEngineInput() {
  const s = state;
  if (!s.site.date) s.site.date = todayISO();
  const c = lastCond = siteConditions(s.site, s.ops);
  const cap = c.capKmh || Infinity;
  const site = { ...s.site, tempC: c.tempC, speedLimitKmh: Math.min(+s.site.speedLimitKmh || Infinity, cap), downhillLimitKmh: Math.min(+s.site.downhillLimitKmh || Infinity, cap) };
  delete site.altitudeM;
  lastOps = { ...s.ops, jobEff: c.jobEff, utilization: c.utilization, truckUtil: c.truckUtil, condFactor: c.condFactor, shiftH: c.operatingH, shiftsPerDay: c.nShifts };
  return {
    site,
    material: { looseTm3: looseOf(s.material), fill: s.material.fill, frozen: s.material.frozen },
    loaders: s.loaders.map(l => {
      const m = byId(LOADERS, l.modelId), b = m.buckets.find(x => x.id === l.bucketId) || m.buckets[0];
      return { modelId: l.modelId, count: +l.count || 0, bucketM3: b.m3, loadHeightM: b.loadHeightM, digDepthM: b.digDepthM, stickM: b.stickM, setup: l.setup || 'bench', loadingSide: l.loadingSide || 'single', benchHeightM: l.benchHeightM === '' || l.benchHeightM == null ? (b.stickM || 0) : +l.benchHeightM, jobCond: l.jobCond, swingDeg: l.swingDeg === '' || l.swingDeg == null ? null : +l.swingDeg,
        conditionId: l.conditionId, availability: l.availabilityPct === '' ? '' : +l.availabilityPct / 100, cycleOverrideS: l.cycleOverrideS || '', fillOverride: l.fillOverride || '' };
    }),
    trucks: s.trucks.map(t => ({ modelId: t.modelId, count: +t.count || 0, conditionId: t.conditionId, availability: t.availabilityPct === '' ? '' : +t.availabilityPct / 100,
      payloadKg: t.payloadKg === '' || t.payloadKg == null ? null : +t.payloadKg, bodyFill: t.bodyFillPct === '' || t.bodyFillPct == null ? '' : +t.bodyFillPct / 100, spotMin: t.spotMin === '' ? undefined : +t.spotMin, dumpMin: t.dumpMin === '' ? undefined : +t.dumpMin })),
    profile: { ...s.profile, points: s.profile.points },
    ops: lastOps,
  };
}

// ------------------------------------------------------------------ compute & render
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(run, 120); }
function run() {
  save();
  renderBound();
  const road = resolveRoad(state.site);
  $('#road-resolved').innerHTML = `Used: RR <b>${road.rr.toFixed(1)} %</b> · traction <b>${road.mu.toFixed(2)}</b>${road.surface.note ? `<br><small>${esc(road.surface.note)}</small>` : ''}`;
  const mat = byId(MATERIALS, state.materialId);
  $('#material-note').textContent = mat ? `Source: ${mat.src}` : '';
  if (!state.profile.points) return;
  let input;
  try { input = toEngineInput(); result = computeScenario(input); } catch (e) { $('#warnings').innerHTML = `<b>Error:</b> ${esc(e.message)}`; console.error(e); return; }
  renderSiteDerived();
  renderTags(); renderKPIs(); renderTables(); renderCharts(); renderProfileSummary();
  updateVisual(result);
}

function renderTags() {
  const active = state.loaders.map((x, i) => (+x.count > 0 ? i : -1)).filter(i => i >= 0);
  state.loaders.forEach((x, i) => { const el = $(`#ltag-${i}`); if (el && !(+x.count > 0)) el.textContent = 'Not in use (0 units).'; });
  result.loaders.forEach((l, j) => {
    const tc = result.trucks[0]?.pairs[j]?.tc;
    const el = $(`#ltag-${active[j]}`);
    if (el) el.innerHTML = `Net ${fmtU('power', l.model.netPowerKw, 0)} · bucket ${fmtU('vol', l.bucketM3, 1)} · max loading height ${fmtU('len', l.loadHeightM, 1)} · ${setupTag(l)} · cycle used <b>${tc ? tc.toFixed(1) : '—'} s</b> · availability ${(l.A * 100).toFixed(0)} %${Object.keys(l.model.estimate).length ? ' · <span class="badge est">cycle times are handbook estimates</span>' : ''}`;
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
  $('#k-tph-sub').innerHTML = `${fmtU('mass', r.prod.shiftT, 0)} / shift · bottleneck: ${r.prod.bottleneck}`;
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
    ['Production (operating)', fmtU('rate', p.tph, 0)], ['Per shift', fmtU('mass', p.shiftT, 0)], ['Per day', fmtU('mass', p.dayT, 0)], ['Per year', fmtU('mass', p.yearT / 1e6, 2).replace(unit('mass'), `M ${unit('mass')}`)],
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
  document.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { const [k, i] = rm.dataset.rm.split('.'); state[k].splice(+i, 1); renderRows(); schedule(); }
  });
  $('#sel-material').addEventListener('change', e => { setMaterial(e.target.value); renderRows(); renderMaterialFields(); schedule(); });
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
  $$('.tab').forEach(b => b.onclick = () => { $$('.tab').forEach(x => x.classList.toggle('active', x === b)); $$('.tabpanel').forEach(p => p.classList.toggle('active', p.id === `tab-${b.dataset.tab}`)); if (b.dataset.tab === 'equip') renderDocs(); try { localStorage.setItem('mfc-tab', b.dataset.tab); } catch (e) { /* ignore */ } });
  $('#btn-export').onclick = exportCSV;
  $('#btn-print').onclick = () => window.print();
  $('#btn-save').onclick = () => download('match-factor-scenario.json', JSON.stringify(state, null, 1), 'application/json');
  $('#scenario-file').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { state = migrate(JSON.parse(await f.text())); boot(); } catch (err) { alertBox(`Could not open scenario: ${err.message}`); } e.target.value = ''; };
  $('#btn-reset').onclick = () => { const pts = state.profile.points, nm = state.profile.name; state = clone(DEFAULTS); state.profile.points = pts; state.profile.name = nm; boot(); };
}
function setMaterial(id) { state.materialId = id; state.material = { ...pickMat(id), frozen: state.material.frozen }; const s = $('#sel-material'); if (s) s.value = id; renderMaterialFields(); }
function renderMaterialFields() { const b = $('#bank-field'); if (b) b.hidden = !matDerived().isBlast; }
function renderSiteDerived() {
  const c = lastCond, md = matDerived(); if (!c) return;
  const el = $('#site-derived');
  if (el) el.innerHTML = `Month average <b>${fmt('temp', c.tempAuto, 0)} ${unit('temp')}</b>${state.site.tempC === '' ? ' (used)' : ''} · daylight ${hToClock(c.sun.sunrise)}–${hToClock(c.sun.sunset)} (${c.sun.dayLenH.toFixed(1)} h) · dark ${(c.darkFrac * 100).toFixed(0)} % of shift time<br>Water truck: <b>${esc(c.water.label)}</b>${c.dust > 0 ? ` · dust ${c.dust >= 0.5 ? 'heavy' : 'light'} (speed cap ${c.capKmh ? fmtU('speed', c.capKmh, 0) : 'none'})` : ''}${c.sky.capKmh ? ` · visibility cap ${fmtU('speed', c.sky.capKmh, 0)}` : ''}`;
  const wt = $('#water-cb'); if (wt) { wt.disabled = c.water.status === 'no'; }
  const mEl = $('#material-derived');
  if (mEl) mEl.innerHTML = `Loose density in the truck <b>${fmt('dens', md.loose, getSystem() === 'si' ? 3 : 0)} ${unit('dens')}</b> (load factor ${md.loadFactor.toFixed(3)})${md.isBlast ? ` · BCM uses solid rock ${fmt('dens', md.bank, getSystem() === 'si' ? 2 : 0)} ${unit('dens')}` : ''}`;
  const tEl = $('#time-derived');
  if (tEl) tEl.innerHTML = `Shift ${hToClock(c.shifts[0].start)}–${hToClock(c.shifts[0].end)} = <b>${c.shiftLenH.toFixed(1)} h</b>${c.nShifts > 1 ? ` × ${c.nShifts}` : ''} · operating <b>${c.operatingH.toFixed(2)} h</b> · utilization <b>${(c.utilization * 100).toFixed(1)} %</b> (trucks ${(c.utilization * c.truckUtil * 100).toFixed(1)} %) · condition factor <b>${c.condFactor.toFixed(3)}</b>`;
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
  initSelects(); normaliseRows(); renderRows(); renderDocs();
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
  cond: () => lastCond, matDerived, waterfall, targetCalc, targetText, volU, setupFactor, swingOf, waterfallHTML, bcU, lcU, setProfile, editProfile,
});
boot();
try { const t = localStorage.getItem('mfc-tab'); if (t) document.querySelector(`.tab[data-tab="${t}"]`)?.click(); } catch (e) { /* ignore */ }
