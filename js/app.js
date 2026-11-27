import { TRUCKS, LOADERS, MATERIALS, ROADS, WEATHER, CONDITIONS, JOB_CONDITIONS, ROAD_SRC, SOURCES } from './data/equipment.js?v=202611270515';
import { computeScenario, sweepTrucks, resolveRoad, profileFromXYZ, byId, interp } from './engine.js?v=202611270515';
import { setSystem, getSystem, unit, toDisp, toSI, fmt, fmtU } from './units.js?v=202611270515';
import { renderEquipment, renderMethod } from './docs.js?v=202611270515';
import { initVisual, updateVisual } from './visual.js?v=202611270515';

// ------------------------------------------------------------------ state
const DEFAULTS = {
  site: { altitudeM: 1700, tempC: 10, roadId: 'firm', weatherId: 'dry', rrOverride: '', tractionOverride: '', speedLimitKmh: 50, downhillLimitKmh: 35, downhillGradePct: -3 },
  materialId: 'till',
  material: { ...pickMat('till'), frozen: false },
  loaders: [{ modelId: 'cat390fl', bucketId: 'sd46', count: 1, jobCond: 'C', swingDeg: 90, conditionId: 'good', availabilityPct: '', cycleOverrideS: '', fillOverride: '' }],
  trucks: [{ modelId: 'cat745', count: 6, conditionId: 'good', availabilityPct: '', payloadKg: '', bodyFillPct: '', spotMin: '', dumpMin: '' }],
  profile: { segmentM: 100, loadAreaM: 50, dumpAreaM: 50, reverse: false, points: null, name: '' },
  ops: { shiftH: 10, shiftsPerDay: 2, daysPerYear: 300, jobEffMin: 50, utilizationPct: 85, bunching: 1, passRule: 'third', loadTimeMethod: 'n', travelModel: 'sim', mfUseAvailability: false,
    brakingDecel: 0.6, massFactor: 1.05, idleLF: 0.15, hotRetarderDeratePerC: 0.01, firstPassFrac: 0.2, frozenFillMult: 0.9, frozenCycleMult: 1.1 },
  units: 'si',
};
function pickMat(id) { const m = byId(MATERIALS, id); return { looseTm3: m.looseTm3, fill: m.fill, swellPct: m.swellPct }; }
const clone = o => JSON.parse(JSON.stringify(o));
let state = load() || clone(DEFAULTS);
let result = null;
const charts = {};

function load() {
  try { const s = localStorage.getItem('mfc-state-v1'); if (s) return Object.assign(clone(DEFAULTS), JSON.parse(s)); } catch (e) { /* storage unavailable */ }
  return null;
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
  fillSelect($('#sel-weather'), WEATHER, state.site.weatherId);
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
  else v = el.value === '' ? '' : (el.dataset.q ? toSI(el.dataset.q, el.value) : +el.value);
  setPath(state, p, v);
  if (p.startsWith('loaders.') || p.startsWith('trucks.')) { if (/modelId$/.test(p)) { normaliseRows(); renderRows(); } }
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
      <label>Swing angle <span class="u">°</span><input type="number" step="5" data-bind="loaders.${i}.swingDeg"></label>
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
  return {
    site: { ...s.site },
    material: { ...s.material },
    loaders: s.loaders.map(l => {
      const m = byId(LOADERS, l.modelId), b = m.buckets.find(x => x.id === l.bucketId) || m.buckets[0];
      return { modelId: l.modelId, count: +l.count || 0, bucketM3: b.m3, loadHeightM: b.loadHeightM, jobCond: l.jobCond, swingDeg: l.swingDeg === '' ? 90 : +l.swingDeg,
        conditionId: l.conditionId, availability: l.availabilityPct === '' ? '' : +l.availabilityPct / 100, cycleOverrideS: l.cycleOverrideS || '', fillOverride: l.fillOverride || '' };
    }),
    trucks: s.trucks.map(t => ({ modelId: t.modelId, count: +t.count || 0, conditionId: t.conditionId, availability: t.availabilityPct === '' ? '' : +t.availabilityPct / 100,
      payloadKg: t.payloadKg === '' || t.payloadKg == null ? null : +t.payloadKg, bodyFill: t.bodyFillPct === '' || t.bodyFillPct == null ? '' : +t.bodyFillPct / 100, spotMin: t.spotMin === '' ? undefined : +t.spotMin, dumpMin: t.dumpMin === '' ? undefined : +t.dumpMin })),
    profile: { ...s.profile, points: s.profile.points },
    ops: { ...s.ops, jobEff: s.ops.jobEffMin / 60, utilization: s.ops.utilizationPct / 100 },
  };
}

// ------------------------------------------------------------------ compute & render
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(run, 120); }
function run() {
  save();
  renderBound();
  const road = resolveRoad(state.site);
  $('#road-resolved').innerHTML = `Used: RR <b>${road.rr.toFixed(1)} %</b> · traction <b>${road.mu.toFixed(2)}</b>${road.weather.note ? `<br><small>${esc(road.weather.note)}</small>` : ''}`;
  const mat = byId(MATERIALS, state.materialId);
  $('#material-note').textContent = mat ? `Source: ${mat.src}` : '';
  if (!state.profile.points) return;
  try { result = computeScenario(toEngineInput()); } catch (e) { $('#warnings').innerHTML = `<b>Error:</b> ${esc(e.message)}`; console.error(e); return; }
  renderTags(); renderKPIs(); renderTables(); renderCharts(); renderProfileSummary();
  updateVisual(result);
}

function renderTags() {
  const active = state.loaders.map((x, i) => (+x.count > 0 ? i : -1)).filter(i => i >= 0);
  state.loaders.forEach((x, i) => { const el = $(`#ltag-${i}`); if (el && !(+x.count > 0)) el.textContent = 'Not in use (0 units).'; });
  result.loaders.forEach((l, j) => {
    const tc = result.trucks[0]?.pairs[j]?.tc;
    const el = $(`#ltag-${active[j]}`);
    if (el) el.innerHTML = `Net ${fmtU('power', l.model.netPowerKw, 0)} · bucket ${fmtU('vol', l.bucketM3, 1)} · max loading height ${fmtU('len', l.loadHeightM, 1)} · cycle used <b>${tc ? tc.toFixed(1) : '—'} s</b> · availability ${(l.A * 100).toFixed(0)} %${Object.keys(l.model.estimate).length ? ' · <span class="badge est">cycle times are handbook estimates</span>' : ''}`;
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
    const tph = t.loadT / t.ct * 3600 * state.ops.jobEffMin / 60 * state.ops.utilizationPct / 100 * t.A;
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

  const p = r.prod, bank = state.material.looseTm3 * (1 + state.material.swellPct / 100);
  const rise = r.segs.reduce((s, x) => s + Math.max(0, x.z1 - x.z0), 0), fall = r.segs.reduce((s, x) => s + Math.max(0, x.z0 - x.z1), 0);
  const kv = [
    ['Production (operating)', fmtU('rate', p.tph, 0)], ['Per shift', fmtU('mass', p.shiftT, 0)], ['Per day', fmtU('mass', p.dayT, 0)], ['Per year', fmtU('mass', p.yearT / 1e6, 2).replace(unit('mass'), `M ${unit('mass')}`)],
    ['Bank volume', `${fmt('vol', p.tph / bank, 0)} B${unit('vol')}/h`], ['Truck capacity (theoretical)', fmtU('rate', p.truckCapTph, 0)], ['Loader capacity (theoretical)', fmtU('rate', p.loaderCapTph, 0)],
    ['Loader efficiency', `${(p.loaderEff * 100).toFixed(0)} %`], ['Truck efficiency', `${(p.truckEff * 100).toFixed(0)} %`], ['One-way haul', fmtU('len', r.totalHaulM, 0)],
    ['Climb / descent (loaded)', `${fmt('len', rise, 0)} / ${fmt('len', fall, 0)} ${unit('len')}`], ['Rolling resistance · traction', `${r.road.rr.toFixed(1)} % · ${r.road.mu.toFixed(2)}`],
  ];
  $('#prod-kv').innerHTML = kv.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
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
    const data = sweepTrucks(r, { ...state.ops, jobEff: state.ops.jobEffMin / 60, utilization: state.ops.utilizationPct / 100 }, k, maxN);
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
  $('#sel-material').addEventListener('change', e => { setMaterial(e.target.value); renderRows(); schedule(); });
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
  $('#scenario-file').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { state = Object.assign(clone(DEFAULTS), JSON.parse(await f.text())); boot(); } catch (err) { alertBox(`Could not open scenario: ${err.message}`); } e.target.value = ''; };
  $('#btn-reset').onclick = () => { const pts = state.profile.points, nm = state.profile.name; state = clone(DEFAULTS); state.profile.points = pts; state.profile.name = nm; boot(); };
}
function setMaterial(id) { state.materialId = id; state.material = { ...pickMat(id), frozen: state.material.frozen }; }
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
wire();
initVisual({
  state: () => state, getPath: p => getPath(state, p), setPath: (p, v) => setPath(state, p, v), schedule, renderRows, renderBound, normaliseRows, setMaterial,
  newTruck: () => clone(DEFAULTS.trucks[0]), newLoader: () => clone(DEFAULTS.loaders[0]), loadSample, loadProfileFile,
});
boot();
try { const t = localStorage.getItem('mfc-tab'); if (t) document.querySelector(`.tab[data-tab="${t}"]`)?.click(); } catch (e) { /* ignore */ }
