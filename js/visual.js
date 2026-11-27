// Visual (friendly) mode: an animated mine scene you can click to change equipment,
// plus plain-language results. Uses the same state and engine as the detailed calculator.
import { TRUCKS, LOADERS, MATERIALS, ROADS, WEATHER, CONDITIONS, JOB_CONDITIONS } from './data/equipment.js';
import { byId } from './engine.js';
import { unit, fmt, fmtU, toDisp, toSI } from './units.js';

let api = null;           // hooks into app.js
let R = null;             // latest engine result
let geo = null;           // scene geometry for the current result
let sim = null;           // discrete-event animation state
let playing = true;
let speed = 60;           // simulated seconds per real second
let lastTs = 0;
let popCtx = null;        // what the dialog is editing

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TRUCK_COLORS = ['--t1', '--t2', '--t3', '--t4', '--t5'];
const truckColor = i => `var(${TRUCK_COLORS[i % TRUCK_COLORS.length]})`;
const isADT = m => /articulated/i.test(m.type);
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ public
export function initVisual(hooks) {
  api = hooks;
  if (reduced()) playing = false;
  wire();
  requestAnimationFrame(frame);
  let rw = 0;
  window.addEventListener('resize', () => { const w = sceneWidth(); if (w !== rw) { rw = w; if (R) buildScene(); } });
}

export function updateVisual(result) {
  R = result;
  renderFleetBar();
  renderSummary();
  buildScene();
}

// ------------------------------------------------------------------ mapping state <-> result
const activeTrucks = () => api.state().trucks.map((t, i) => (+t.count > 0 ? i : -1)).filter(i => i >= 0);
const activeLoaders = () => api.state().loaders.map((l, i) => (+l.count > 0 ? i : -1)).filter(i => i >= 0);

// ------------------------------------------------------------------ SVG drawings (original, generic shapes)
function truckSVG(model, color, opts = {}) {
  const adt = isADT(model);
  const body = adt
    ? `<path d="M-34,-12 L8,-12 L12,-30 L-36,-31 Z" class="tb-body" fill="${color}"/>`
    : `<path d="M-33,-13 L16,-13 L20,-31 L28,-33 L28,-30 L-35,-31 Z" class="tb-body" fill="${color}"/>`;
  const heap = adt ? `<path class="tb-load" d="M-33,-30 Q-12,-45 10,-30 Z"/>` : `<path class="tb-load" d="M-33,-30 Q-8,-46 18,-30 Z"/>`;
  const wheels = adt
    ? [-24, -9, 22].map(x => `<circle cx="${x}" cy="-6.5" r="6.5" class="tw"/><circle cx="${x}" cy="-6.5" r="2.4" class="th"/>`).join('')
    : [-20, 18].map(x => `<circle cx="${x}" cy="-7.5" r="7.5" class="tw"/><circle cx="${x}" cy="-7.5" r="2.8" class="th"/>`).join('');
  const chassis = adt
    ? `<rect x="-32" y="-15" width="44" height="5" rx="1.5" class="tc"/><rect x="12" y="-17" width="20" height="7" rx="2" class="tc"/><rect x="15" y="-33" width="14" height="17" rx="2" fill="${color}"/><rect x="20" y="-31" width="7" height="7" rx="1" class="tg"/>`
    : `<rect x="-30" y="-17" width="58" height="6" rx="1.5" class="tc"/><rect x="18" y="-28" width="10" height="11" rx="1.5" fill="${color}"/><rect x="21" y="-26.5" width="5.5" height="5.5" rx="1" class="tg"/>`;
  const pivot = adt ? '-34,-12' : '-33,-13';
  return `${chassis}<g class="tb" data-pivot="${pivot}">${heap}${body}</g>${wheels}${opts.label ? '' : ''}`;
}

function excavatorSVG(color) {
  return `<rect x="-36" y="-13" width="72" height="13" rx="6.5" class="ex-track"/>
    ${[-26, -13, 0, 13, 26].map(x => `<circle cx="${x}" cy="-6.5" r="3" class="th"/>`).join('')}
    <rect x="-6" y="-19" width="12" height="7" class="tc"/>
    <g class="ex-up">
      <rect x="-36" y="-36" width="13" height="16" rx="3" class="tc"/>
      <rect x="-26" y="-38" width="44" height="20" rx="3" fill="${color}"/>
      <rect x="6" y="-52" width="14" height="15" rx="2" fill="${color}"/><rect x="10" y="-49" width="8" height="8" rx="1" class="tg"/>
      <g class="ex-arm">
        <path d="M14,-32 L42,-70" class="ex-boom" stroke="${color}"/>
        <path d="M42,-70 L66,-40" class="ex-stick" stroke="${color}"/>
        <path d="M60,-44 L74,-38 L72,-24 L58,-28 Z" class="ex-bucket"/>
        <path class="ex-bload" d="M59,-41 Q66,-50 73,-38 Z"/>
      </g>
    </g>`;
}

// ------------------------------------------------------------------ scene geometry
function sceneWidth() { const el = $('#scene-wrap'); const w = el ? el.clientWidth : 1000; return clamp(Math.round(w), 620, 1000); }

function buildGeometry() {
  const W = sceneWidth(), H = 330;
  const segs = R.segs;
  const cum = [0]; segs.forEach(s => cum.push(cum.at(-1) + s.len));
  const zs = [segs[0].z0, ...segs.map(s => s.z1)];
  const L = cum.at(-1);
  let zmin = Math.min(...zs), zmax = Math.max(...zs);
  if (zmax - zmin < 60) { const m = (zmax + zmin) / 2; zmin = m - 30; zmax = m + 30; }
  const X0 = 250, X1 = W - 120, yTop = 185, yBot = 275;
  const xOf = d => X0 + (d / L) * (X1 - X0);
  const yOfZ = z => yBot - ((z - zmin) / (zmax - zmin)) * (yBot - yTop);
  const zAt = d => { d = clamp(d, 0, L); let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return zs[i - 1] + f * (zs[i] - zs[i - 1]); };
  const pt = d => ({ x: xOf(d), y: yOfZ(zAt(d)) });
  const angAt = d => { const a = pt(d - L / 200), b = pt(d + L / 200); return clamp(Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI * 0.6, -14, 14); };
  const y0 = yOfZ(zs[0]), yEnd = yOfZ(zs.at(-1));
  // time → distance maps per truck type
  const maps = R.trucks.map(t => {
    const mk = list => { const T = [0], D = [0]; list.forEach(s => { T.push(T.at(-1) + s.t); D.push(D.at(-1) + s.len); }); return { T, D }; };
    return { haul: mk(t.haul.segs), ret: mk(t.ret.segs) };
  });
  return { W, H, L, X0, X1, y0, yEnd, xOf, yOfZ, zAt, pt, angAt, maps, zmin, zmax, cum, zs };
}
function dAtTime(map, t) {
  const { T, D } = map; if (t <= 0) return 0; if (t >= T.at(-1)) return D.at(-1);
  let i = 1; while (T[i] < t) i++;
  return D[i - 1] + (t - T[i - 1]) / ((T[i] - T[i - 1]) || 1) * (D[i] - D[i - 1]);
}

// loading positions: up to 3 depth rows
const ROW = [{ dy: 0, s: 1 }, { dy: -34, s: 0.84 }, { dy: -62, s: 0.7 }];
const EX_X = 95, SPOT_X = 178;

function buildScene() {
  const svg = $('#scene');
  if (!svg || !R || !R.trucks.length) { if (svg) svg.innerHTML = ''; sim = null; return; }
  geo = buildGeometry();
  const g = geo, st = api.state();
  svg.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
  // ground polygon following the road profile
  let road = '';
  const N = 120;
  for (let k = 0; k <= N; k++) { const p = g.pt(g.L * k / N); road += `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`; }
  const ground = `M0,${g.y0} L${g.X0},${g.y0} ${road.replace(/^M/, 'L')} L${g.W},${g.yEnd} L${g.W},${g.H} L0,${g.H} Z`;
  // material face (bench) behind the excavators
  const face = `M0,${g.y0 - 120} L18,${g.y0 - 118} L30,${g.y0 - 96} L26,${g.y0 - 80} L44,${g.y0 - 58} L40,${g.y0 - 40} L58,${g.y0 - 18} L64,${g.y0} L0,${g.y0} Z`;
  // dump pile at the end
  const dx = g.W - 70;
  const pile = `M${dx - 50},${g.yEnd} Q${dx},${g.yEnd - 70} ${g.W},${g.yEnd - 40} L${g.W},${g.yEnd} Z`;
  const rise = R.segs.reduce((s, x) => s + Math.max(0, x.z1 - x.z0), 0);
  const fall = R.segs.reduce((s, x) => s + Math.max(0, x.z0 - x.z1), 0);
  const mid = g.pt(g.L * 0.5);
  const mat = byId(MATERIALS, st.materialId);
  // excavators (one icon per unit, max 3 rows)
  const units = [];
  R.loaders.forEach((l, j) => { for (let u = 0; u < l.count; u++) units.push({ j, stateIdx: activeLoaders()[j] }); });
  const shown = units.slice(0, 3);
  let ex = '';
  shown.map((u, k) => ({ u, k })).reverse().forEach(({ u, k }) => {
    const r = ROW[k];
    ex += `<g class="hot ex" data-pop="loader:${u.stateIdx}" tabindex="0" role="button" aria-label="Change excavator: ${esc(R.loaders[u.j].model.name)}" transform="translate(${EX_X + k * 6},${g.y0 + r.dy}) scale(${r.s})">
      <g class="ex-root" id="ex-${k}">${excavatorSVG('var(--exc)')}</g>
      ${k === 0 ? `<text class="lbl-sm" x="0" y="16" text-anchor="middle">${esc(R.loaders[u.j].model.name)}${units.length > 1 ? ` · ${units.length} units` : ''}</text>` : ''}
    </g>`;
  });
  const hint = (() => { try { if (localStorage.getItem('mfc-hinted')) return ''; } catch (e) { /* ignore */ } return null; })() ?? `<g class="hint" transform="translate(${EX_X + 60},${g.y0 - 100})"><rect x="-86" y="-16" width="172" height="24" rx="12"/><text x="0" y="0" text-anchor="middle">Tap a machine to change it</text></g>`;
  const labels = `
    <text class="lbl" x="${mid.x}" y="${Math.max(70, Math.min(mid.y, g.y0, g.yEnd) - 62)}" text-anchor="middle">Haul road · ${fmtU('len', g.L, 0)} one way</text>
    <text class="lbl-sm" x="${mid.x}" y="${Math.max(86, Math.min(mid.y, g.y0, g.yEnd) - 46)}" text-anchor="middle">${fmt('len', rise, 0)} ${unit('len')} up, ${fmt('len', fall, 0)} ${unit('len')} down when loaded (height exaggerated)</text>
    <text class="lbl" x="${dx - 10}" y="${g.yEnd - 62}" text-anchor="middle">Dump</text>
    <text class="lbl-sm" x="34" y="${g.y0 - 128}" text-anchor="start">${esc(mat ? mat.name : 'Material')}</text>`;
  svg.innerHTML = `
    <defs><linearGradient id="sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--sky-1)"/><stop offset="1" stop-color="var(--sky-2)"/></linearGradient></defs>
    <rect width="${g.W}" height="${g.H}" fill="url(#sky)"/>
    <path d="${ground}" class="ground"/>
    <path d="${face}" class="hot face" data-pop="material" tabindex="0" role="button" aria-label="Change material"/>
    <path d="${pile}" class="hot pile" data-pop="road" tabindex="-1"/>
    <path d="${road}" class="road"/>
    <path d="${road}" class="road-dash"/>
    <path d="${road}" class="hot road-hit" data-pop="road" tabindex="0" role="button" aria-label="Change haul road"/>
    ${labels}
    ${ex}
    <g id="truck-layer"></g>
    <g id="status-layer"></g>
    ${hint}`;
  startSim(shown.length, units);
}

// ------------------------------------------------------------------ discrete-event animation
function startSim(rowsShown, units) {
  const trucks = [];
  const order = [];
  R.trucks.forEach((t, i) => { for (let k = 0; k < t.n; k++) order.push(i); });
  // interleave types so mixed fleets spread out
  order.sort((a, b) => a - b);
  const N = order.length;
  const ctAvg = N ? R.trucks.reduce((s, t) => s + t.n * t.ct, 0) / N : 600;
  order.forEach((type, k) => trucks.push({ type, state: 'park', left: k * ctAvg / Math.max(1, N), unit: -1, d: 0, load: 0, from: null }));
  sim = { t: 0, trucks, units: units.map(u => ({ j: u.j, busy: -1, idle: 0 })), queue: [], rowsShown };
  // warm up so the picture starts in a steady state
  const warm = Math.max(...R.trucks.map(t => t.ct)) * 2.5;
  for (let s = 0; s < warm; s += 2) step(2);
  sim.t = 0; sim.units.forEach(u => { u.idle = 0; });
  const layer = $('#truck-layer');
  layer.innerHTML = trucks.map((tr, k) => {
    const T = R.trucks[tr.type], sc = clamp(Math.sqrt(T.truck.ratedPayloadKg / 90000), 0.72, 1.1);
    const stateIdx = activeTrucks()[tr.type];
    return `<g class="hot truck" data-pop="truck:${stateIdx}" id="tr-${k}" tabindex="-1" aria-label="${esc(T.truck.name)}"><g class="tr-inner" data-sc="${sc}">${truckSVG(T.truck, truckColor(stateIdx))}</g></g>`;
  }).join('');
  sim.els = trucks.map((tr, k) => {
    const el = document.getElementById(`tr-${k}`);
    return { el, inner: el.firstElementChild, body: el.querySelector('.tb'), load: el.querySelector('.tb-load') };
  });
  sim.exEls = [0, 1, 2].map(k => document.getElementById(`ex-${k}`)).map(e => e && ({ up: e.querySelector('.ex-up'), arm: e.querySelector('.ex-arm'), bl: e.querySelector('.ex-bload') }));
  draw();
}

function freeUnitFor(type) {
  let best = -1, bt = Infinity;
  sim.units.forEach((u, k) => { if (u.busy < 0) { const lt = R.trucks[type].pairs[u.j].loadTimeS; if (lt < bt) { bt = lt; best = k; } } });
  return best;
}
function assign(ti, k) {
  const tr = sim.trucks[ti]; tr.unit = k; sim.units[k].busy = ti; tr.state = 'spot'; tr.left = R.trucks[tr.type].spotS; tr.dur = tr.left;
}
function step(dt) {
  sim.t += dt;
  sim.units.forEach(u => { if (u.busy < 0) u.idle += dt; });
  sim.trucks.forEach((tr, ti) => {
    if (tr.state === 'queue') return;
    tr.left -= dt;
    let guard = 0;
    while (tr.left <= 0 && guard++ < 6) {
      const T = R.trucks[tr.type];
      const over = -tr.left;
      if (tr.state === 'park' || tr.state === 'return') {
        const k = freeUnitFor(tr.type);
        if (k >= 0) { assign(ti, k); tr.left -= over; } else { tr.state = 'queue'; sim.queue.push(ti); tr.left = 0; break; }
      } else if (tr.state === 'spot') {
        tr.state = 'loading'; tr.dur = T.pairs[sim.units[tr.unit].j].loadTimeS; tr.left = tr.dur - over;
      } else if (tr.state === 'loading') {
        const k = tr.unit; sim.units[k].busy = -1; tr.unit = -1;
        tr.state = 'haul'; tr.dur = T.haul.t; tr.left = tr.dur - over;
        if (sim.queue.length) assign(sim.queue.shift(), k);
      } else if (tr.state === 'haul') {
        tr.state = 'dump'; tr.dur = T.dumpS; tr.left = tr.dur - over;
      } else if (tr.state === 'dump') {
        tr.state = 'return'; tr.dur = T.ret.t; tr.left = tr.dur - over;
      }
    }
  });
}

function setTruck(e, x, y, ang, dir, sc, tilt, loadFrac) {
  e.el.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${ang.toFixed(1)})`);
  e.inner.setAttribute('transform', `scale(${(dir * sc).toFixed(3)},${sc.toFixed(3)})`);
  const [px, py] = e.body.dataset.pivot.split(',').map(Number);
  e.body.setAttribute('transform', tilt ? `rotate(${-tilt} ${px} ${py})` : '');
  e.load.setAttribute('transform', `translate(0,-30) scale(1,${clamp(loadFrac, 0, 1).toFixed(3)}) translate(0,30)`);
  e.load.style.opacity = loadFrac > 0.02 ? 1 : 0;
}

function draw() {
  if (!sim || !geo) return;
  const g = geo;
  const exState = [null, null, null];
  const qPos = new Map(sim.queue.map((ti, k) => [ti, k]));
  sim.trucks.forEach((tr, k) => {
    const e = sim.els[k]; if (!e) return;
    const T = R.trucks[tr.type];
    const sc = +e.inner.dataset.sc;
    const row = tr.unit >= 0 ? ROW[Math.min(tr.unit, 2)] : ROW[0];
    const spot = { x: SPOT_X + Math.min(tr.unit, 2) * 6, y: g.y0 + row.dy };
    const prog = tr.dur ? clamp(1 - tr.left / tr.dur, 0, 1) : 1;
    e.el.style.display = '';
    if (tr.state === 'park') { e.el.style.display = 'none'; return; }
    if (tr.state === 'queue') {
      const q = qPos.get(k) ?? 0;
      const qd = clamp((12 + q * 54 * sc) / (g.X1 - g.X0) * g.L, 0, g.L * 0.6); const p = g.pt(qd); setTruck(e, p.x + 20, p.y - 7, g.angAt(qd), -1, sc, 0, 0);
      e.el.classList.add('waiting'); return;
    }
    e.el.classList.remove('waiting');
    if (tr.state === 'spot') {
      const p = g.pt(10);
      const x = p.x + (spot.x - p.x) * prog, y = p.y + (spot.y - p.y) * prog;
      setTruck(e, x, y, 0, prog < 0.6 ? -1 : 1, sc * (1 - (1 - row.s) * prog), 0, 0); return;
    }
    if (tr.state === 'loading') {
      const pair = T.pairs[sim.units[tr.unit].j];
      const passes = Math.max(1, Math.round(pair.n));
      const passT = tr.dur / passes;
      const done = Math.floor((tr.dur - tr.left) / passT);
      const inPass = ((tr.dur - tr.left) % passT) / passT;
      const frac = (done + (inPass > 0.75 ? 1 : 0)) / passes;
      setTruck(e, spot.x, spot.y, 0, 1, sc * row.s, 0, frac);
      if (tr.unit < 3) exState[tr.unit] = { inPass };
      return;
    }
    if (tr.state === 'haul') {
      const d = dAtTime(g.maps[tr.type].haul, tr.dur - tr.left);
      const p = g.pt(d); setTruck(e, p.x, p.y, g.angAt(d), 1, sc, 0, 1); return;
    }
    if (tr.state === 'dump') {
      const x = g.X1 + 22, tilt = Math.sin(Math.PI * prog) * 48;
      setTruck(e, x, g.yEnd, 0, 1, sc, tilt, prog < 0.55 ? 1 : 0); return;
    }
    if (tr.state === 'return') {
      const d = g.L - dAtTime(g.maps[tr.type].ret, tr.dur - tr.left);
      const p = g.pt(d); setTruck(e, p.x, p.y - 7, g.angAt(d), -1, sc * 0.96, 0, 0);
    }
  });
  // excavator swing: dig facing the face (left), swing round and dump over the truck (right)
  sim.exEls.forEach((x, k) => {
    if (!x) return;
    const s = exState[k];
    let face = -1, arm = 0, bl = 0;
    if (s) {
      const p = s.inPass;
      if (p < 0.35) { face = -1; arm = Math.sin(p / 0.35 * Math.PI) * 10; bl = p > 0.2 ? 1 : 0; }
      else if (p < 0.55) { face = -1 + 2 * (p - 0.35) / 0.2; bl = 1; }
      else if (p < 0.75) { face = 1; arm = -8; bl = p < 0.7 ? 1 : 0; }
      else { face = 1 - 2 * (p - 0.75) / 0.25; }
    }
    x.up.setAttribute('transform', `scale(${face.toFixed(3)},1)`);
    x.arm.setAttribute('transform', `rotate(${arm.toFixed(1)} 14 -32)`);
    x.bl.style.opacity = bl;
  });
  // status text
  const busy = sim.units.filter(u => u.busy >= 0 && sim.trucks[u.busy].state === 'loading').length;
  const q = sim.queue.length;
  const clock = new Date(sim.t * 1000).toISOString().substring(11, 19);
  const sl = $('#status-layer');
  if (sl) sl.innerHTML = `<text class="lbl-sm" x="12" y="22">Mine clock ${clock} · ${speed === 60 ? '1 s = 1 min' : speed === 30 ? '1 s = 30 s' : '1 s = 2 min'}</text>
    <text class="lbl-sm ${q ? 'warn' : ''}" x="12" y="40">${q ? `${q} truck${q > 1 ? 's' : ''} waiting at the excavator` : busy ? 'Excavator loading' : 'Excavator waiting for a truck'}</text>`;
}

function frame(ts) {
  const dtReal = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0; lastTs = ts;
  const panel = $('#tab-visual');
  if (sim && playing && panel && panel.classList.contains('active') && !document.hidden) {
    let dt = dtReal * speed;
    while (dt > 0) { const s = Math.min(dt, 1); step(s); dt -= s; }
    draw();
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ fleet bar
function renderFleetBar() {
  const st = api.state();
  const lo = st.loaders.map((l, i) => {
    const m = byId(LOADERS, l.modelId); const b = m.buckets.find(x => x.id === l.bucketId) || m.buckets[0];
    return `<button class="chip" data-pop="loader:${i}"><span class="sw" style="background:var(--exc)"></span><b>${esc(m.name)}</b> × ${+l.count || 0}<small>${fmt('vol', b.m3, 1)} ${unit('vol')} bucket</small></button>`;
  }).join('');
  const tr = st.trucks.map((t, i) => {
    const m = byId(TRUCKS, t.modelId);
    return `<span class="chip-wrap"><button class="chip" data-pop="truck:${i}"><span class="sw" style="background:${truckColor(i)}"></span><b>${esc(m.name)}</b> × ${+t.count || 0}<small>${fmtU('kg', m.ratedPayloadKg, 0)} each</small></button><span class="mini-step"><button data-step="trucks.${i}.count" data-d="-1" aria-label="One fewer ${esc(m.name)}">−</button><button data-step="trucks.${i}.count" data-d="1" aria-label="One more ${esc(m.name)}">+</button></span></span>`;
  }).join('');
  $('#fleet-bar').innerHTML = `
    <div class="fb-group"><span class="fb-lbl">Excavators</span>${lo}<button class="chip add" data-pop="add-loader">+ Add excavator</button></div>
    <div class="fb-group"><span class="fb-lbl">Trucks</span>${tr}<button class="chip add" data-pop="add-truck">+ Add trucks</button></div>
    <div class="fb-group"><span class="fb-lbl">Site</span><button class="chip" data-pop="material"><b>${esc(byId(MATERIALS, st.materialId)?.name || 'Material')}</b><small>${fmt('dens', st.material.looseTm3, 2)} ${unit('dens')}</small></button><button class="chip" data-pop="road"><b>Haul road</b><small>${esc(byId(WEATHER, st.site.weatherId)?.name || '')}</small></button><button class="chip" data-pop="shift"><b>Work hours</b><small>${st.ops.shiftH} h × ${st.ops.shiftsPerDay}/day</small></button></div>`;
}

// ------------------------------------------------------------------ plain-language results
function verdict(mf, prod) {
  const lIdle = Math.round((1 - prod.loaderEff) * 100), tWait = Math.round((1 - prod.truckEff) * 100);
  if (mf < 0.85) return { cls: 'u', title: 'Not enough trucks', text: `The excavator stands idle about ${lIdle} % of the time waiting for the next truck. Adding trucks will raise production.` };
  if (mf < 0.98) return { cls: 'ok', title: 'Good match (slightly short of trucks)', text: `The excavator waits a little (≈ ${lIdle} % of the time). This is usually the cheapest way to run a fleet.` };
  if (mf <= 1.05) return { cls: 'ok', title: 'Well balanced', text: 'Trucks arrive about as fast as the excavator can fill them. In real life a little waiting happens on both sides.' };
  if (mf <= 1.2) return { cls: 'o', title: 'Slightly too many trucks', text: `The excavator never stops, but trucks wait in line about ${tWait} % of the time.` };
  return { cls: 'o', title: 'Too many trucks', text: `Trucks spend about ${tWait} % of their time queuing at the excavator. Removing trucks would save cost with little loss of production.` };
}

function renderSummary() {
  const box = $('#v-summary');
  if (!R || !R.trucks.length || !R.loaders.length) { box.innerHTML = `<div class="v-card"><b>Add at least one excavator and one truck to see results.</b></div>`; return; }
  const st = api.state();
  const v = verdict(R.mf, R.prod);
  const N = R.trucks.reduce((s, t) => s + t.n, 0);
  const need = Math.max(1, Math.round(R.trucksForMF1));
  const needA = Math.ceil(R.trucksForMF1WithAvail || 0);
  const diff = need - N;
  const sug = diff === 0 ? `<p>Your ${N} trucks are the right number for this excavator setup.</p>`
    : `<p>About <b>${need}</b> trucks keep the excavator${R.loaders.reduce((s, l) => s + l.count, 0) > 1 ? 's' : ''} busy without long queues${needA > need ? ` (plan for <b>${needA}</b> to cover breakdowns)` : ''}. You have ${N}.</p>
       <button class="btn" data-apply="${diff}">${diff > 0 ? `Add ${diff} truck${diff > 1 ? 's' : ''}` : `Remove ${-diff} truck${diff < -1 ? 's' : ''}`}</button>`;
  const pin = clamp((R.mf - 0.5) * 100, 0, 100);
  const types = R.trucks.map((t, i) => {
    const p = t.pairs[0];
    const idx = activeTrucks()[i];
    const parts = [['Waiting & positioning', t.spotS, 'var(--muted)'], ['Being loaded', t.loadTimeS, 'var(--good)'], ['Driving loaded', t.haul.t, truckColor(idx)], ['Dumping', t.dumpS, 'var(--ink-2)'], ['Driving back empty', t.ret.t, 'var(--blue)']];
    const tot = parts.reduce((s, x) => s + x[1], 0);
    return `<div class="v-trip">
      <div class="v-trip-h"><span class="sw" style="background:${truckColor(idx)}"></span><b>${esc(t.truck.name)}</b> × ${t.n}<span class="muted"> — one round trip takes <b>${(t.ct / 60).toFixed(1)} min</b></span></div>
      <div class="stack">${parts.map(([lab, s, c]) => `<span style="flex:${s / tot};background:${c}" title="${lab}: ${(s / 60).toFixed(1)} min"></span>`).join('')}</div>
      <div class="stack-legend">${parts.map(([lab, s, c]) => `<span><i style="background:${c}"></i>${lab} ${(s / 60).toFixed(1)} min</span>`).join('')}</div>
      <p class="v-fill">${R.loaders.map((l, j) => { const q = t.pairs[j]; return `Filled with <b>${(+q.n).toFixed(st.ops.passRule === 'exact' ? 1 : 0)} buckets</b> from the ${esc(l.model.name)} → carries <b>${fmtU('mass', q.loadT, 1)}</b> (${Math.round(100 + q.overloadPct)} % of rated load, ${Math.round(q.volFillPct)} % of body volume).`; }).join('<br>')}</p>
    </div>`;
  }).join('');
  const w = R.warnings;
  box.innerHTML = `
    <div class="v-card verdict ${v.cls}">
      <div class="v-mf"><span class="lbl">Match factor</span><span class="val">${R.mf.toFixed(2)}</span></div>
      <div class="v-text"><h3>${v.title}</h3><p>${v.text}</p>
        <div class="mfbar"><div class="zone u"></div><div class="zone ok"></div><div class="zone o"></div><span class="pin" style="left:${pin}%"></span></div>
        <div class="mfscale"><span>too few trucks</span><span>balanced</span><span>too many</span></div>
      </div>
      <div class="v-sug">${sug}</div>
    </div>
    <div class="v-stats">
      <div class="v-stat"><span class="lbl">Moved per hour</span><b>${fmtU('rate', R.prod.tph, 0)}</b><small>${fmtU('mass', R.prod.shiftT, 0)} per ${st.ops.shiftH} h shift</small></div>
      <div class="v-stat"><span class="lbl">Per year</span><b>${fmt('mass', R.prod.yearT / 1e6, 2)} M ${unit('mass')}</b><small>${st.ops.daysPerYear} days, ${st.ops.shiftsPerDay} shifts/day</small></div>
      <div class="v-stat"><span class="lbl">Slowest link</span><b>${/^loaders/.test(R.prod.bottleneck) ? 'Excavator' : 'Trucks'}</b><small>${/^loaders/.test(R.prod.bottleneck) ? 'trucks queue at the excavator' : 'the excavator waits for trucks'}</small></div>
      <div class="v-stat"><span class="lbl">Fuel</span><b>${fmt('fuelpm', R.fuel.lPerT, 2)} ${unit('fuelpm')}</b><small>${fmt('co2pm', R.fuel.co2KgPerT, 2)} ${unit('co2pm')} CO₂</small></div>
    </div>
    <div class="v-card"><h3>Where each truck's time goes</h3>${types}</div>
    ${w.length ? `<div class="warn-box"><b>Worth checking</b><ul>${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`;
}

// ------------------------------------------------------------------ dialog ("popover")
const pct = v => Math.round(v * 100);
function modelCard(m, selected, kind, color) {
  const isT = /truck/.test(kind);
  const icon = isT
    ? `<svg viewBox="-40 -40 80 44" class="mc-ico"><g>${truckSVG(m, color)}</g></svg>`
    : `<svg viewBox="-44 -76 124 80" class="mc-ico"><g>${excavatorSVG('var(--exc)')}</g></svg>`;
  const facts = isT
    ? `${fmtU('kg', m.ratedPayloadKg, 0)} payload · ${fmtU('vol', m.heapedM3, 1)} body`
    : `${fmtU('power', m.netPowerKw, 0)} · buckets ${fmt('vol', Math.min(...m.buckets.map(b => b.m3)), 1)}–${fmt('vol', Math.max(...m.buckets.map(b => b.m3)), 1)} ${unit('vol')}`;
  return `<button class="mcard ${selected ? 'sel' : ''}" data-pick="${kind}:${m.id}">${icon}<b>${esc(m.name)}</b><small>${esc(m.type)}</small><small>${facts}</small>${Object.keys(m.estimate || {}).length ? '<span class="badge est">some data estimated</span>' : ''}</button>`;
}
function stepper(path, val, lab) {
  return `<div class="stepper"><span>${lab}</span><button data-step="${path}" data-d="-1" aria-label="Fewer">−</button><output>${val}</output><button data-step="${path}" data-d="1" aria-label="More">+</button></div>`;
}
function slider(path, value, def, min, max, lab, help) {
  const v = value === '' || value == null ? def : value;
  return `<div class="slide"><label>${lab}<span class="sv"><b>${pct(v)} %</b>${value === '' || value == null ? ' <small>(typical)</small>' : ` <button class="link" data-reset="${path}">reset to typical ${pct(def)} %</button>`}</span>
    <input type="range" min="${min}" max="${max}" step="1" value="${pct(v)}" data-slide="${path}"></label><p class="note">${help}</p></div>`;
}

function renderPop() {
  const st = api.state(), d = $('#pop'), body = $('#pop-body'), title = $('#pop-title');
  const [kind, idxS] = popCtx.split(':'); const i = +idxS;
  if (kind === 'loader') {
    const l = st.loaders[i]; if (!l) return closePop();
    const m = byId(LOADERS, l.modelId);
    title.textContent = 'Excavator';
    body.innerHTML = `
      <h4>Model</h4><div class="mcards">${LOADERS.map(x => modelCard(x, x.id === l.modelId, 'loader')).join('')}</div>
      ${stepper(`loaders.${i}.count`, +l.count || 0, 'How many of these excavators')}
      <div class="grid g2">
        <label>Bucket<select data-bind="loaders.${i}.bucketId">${m.buckets.map(b => `<option value="${b.id}" ${b.id === l.bucketId ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select></label>
        <label>Digging conditions<select data-bind="loaders.${i}.jobCond">${JOB_CONDITIONS.map(x => `<option value="${x.id}" ${x.id === l.jobCond ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Machine condition<select data-bind="loaders.${i}.conditionId">${CONDITIONS.map(x => `<option value="${x.id}" ${x.id === l.conditionId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Swing angle to truck <span class="u">°</span><input type="number" step="5" data-bind="loaders.${i}.swingDeg"></label>
      </div>
      ${slider(`loaders.${i}.fillOverride`, l.fillOverride === '' ? '' : +l.fillOverride, st.material.fill, 50, 120, 'Bucket fill factor', `How full each bucket really is compared with its rated (heaped) size. Typical for ${esc(byId(MATERIALS, st.materialId)?.name || 'this material')}: ${pct(st.material.fill)} %. Sticky or blocky material fills less; loose, moist soil can fill over 100 %.`)}
      <label>Cycle time override <span class="u">s per bucket</span><input type="number" step="0.5" data-bind="loaders.${i}.cycleOverrideS" placeholder="auto"></label>
      <div class="pop-actions"><button class="btn ghost danger" data-remove="loaders.${i}">Remove this excavator</button></div>`;
  } else if (kind === 'truck') {
    const t = st.trucks[i]; if (!t) return closePop();
    const m = byId(TRUCKS, t.modelId);
    title.textContent = 'Trucks';
    body.innerHTML = `
      <h4>Model</h4><div class="mcards">${TRUCKS.map(x => modelCard(x, x.id === t.modelId, 'truck', truckColor(i))).join('')}</div>
      ${stepper(`trucks.${i}.count`, +t.count || 0, `How many ${esc(m.name)}`)}
      ${slider(`trucks.${i}.bodyFillPct`, t.bodyFillPct === '' || t.bodyFillPct == null ? '' : +t.bodyFillPct / 100, 1, 50, 110, 'Body fill factor', `How much of the truck body's rated heaped volume (${fmtU('vol', m.heapedM3, 1)}, SAE 2:1) you actually use. 100 % = fully heaped. Lower it for sticky or blocky material, carry-back, or if operators keep loads low to avoid spillage.`, true)}
      <div class="grid g2">
        <label>Rated payload <span class="u">(${unit('kg')})</span><input type="number" step="100" data-bind="trucks.${i}.payloadKg" data-q="kg" placeholder="${fmt('kg', m.ratedPayloadKg, 0).replace(/,/g, '')}"></label>
        <label>Machine condition<select data-bind="trucks.${i}.conditionId">${CONDITIONS.map(x => `<option value="${x.id}" ${x.id === t.conditionId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Time to position at the excavator <span class="u">min</span><input type="number" step="0.05" data-bind="trucks.${i}.spotMin" placeholder="${m.defaults.spotMin}"></label>
        <label>Time to turn and dump <span class="u">min</span><input type="number" step="0.05" data-bind="trucks.${i}.dumpMin" placeholder="${m.defaults.dumpMin}"></label>
      </div>
      <div class="pop-actions"><button class="btn ghost danger" data-remove="trucks.${i}">Remove these trucks</button></div>`;
  } else if (kind === 'add-truck' || kind === 'add-loader') {
    const isT = kind === 'add-truck';
    title.textContent = isT ? 'Add trucks' : 'Add an excavator';
    body.innerHTML = `<p class="note">Pick a model. You can change the number and details next.</p><div class="mcards">${(isT ? TRUCKS : LOADERS).map((x, k) => modelCard(x, false, isT ? 'new-truck' : 'new-loader', truckColor(st.trucks.length))).join('')}</div>`;
  } else if (kind === 'material') {
    title.textContent = 'Material being moved';
    const mat = byId(MATERIALS, st.materialId);
    body.innerHTML = `
      <div class="seg">${MATERIALS.map(x => `<button class="${x.id === st.materialId ? 'sel' : ''}" data-mat="${x.id}">${esc(x.name)}</button>`).join('')}</div>
      <div class="grid g2">
        <label>Loose density <span class="u">(${unit('dens')})</span><input type="number" step="0.01" data-bind="material.looseTm3" data-q="dens"></label>
        <label>Swell <span class="u">%</span><input type="number" step="1" data-bind="material.swellPct"></label>
      </div>
      ${slider('material.fill', st.material.fill, mat ? mat.fill : 0.9, 50, 120, 'Bucket fill factor (all excavators)', 'How full a bucket gets in this material. An excavator can override this in its own settings.')}
      <label class="check"><input type="checkbox" data-bind="material.frozen"> Frozen or cemented (buckets fill less, digging is slower)</label>
      <p class="note">${mat ? esc(mat.src) : ''}</p>`;
  } else if (kind === 'road') {
    title.textContent = 'Haul road & site';
    body.innerHTML = `
      <h4>Weather today</h4><div class="seg">${WEATHER.map(x => `<button class="${x.id === st.site.weatherId ? 'sel' : ''}" data-weather="${x.id}">${esc(x.name)}</button>`).join('')}</div>
      <label>Road surface<select data-bind="site.roadId">${ROADS.map(x => `<option value="${x.id}" ${x.id === st.site.roadId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <div class="grid g2">
        <label>Speed limit <span class="u">(${unit('speed')})</span><input type="number" step="1" data-bind="site.speedLimitKmh" data-q="speed"></label>
        <label>Downhill speed limit <span class="u">(${unit('speed')})</span><input type="number" step="1" data-bind="site.downhillLimitKmh" data-q="speed"></label>
        <label>Altitude <span class="u">(${unit('len')})</span><input type="number" step="10" data-bind="site.altitudeM" data-q="len"></label>
        <label>Temperature <span class="u">(${unit('temp')})</span><input type="number" step="1" data-bind="site.tempC" data-q="temp"></label>
      </div>
      <h4>Road shape (distance and elevation)</h4>
      <p class="note">Now using: ${esc(st.profile.name || 'no profile')}. Upload a CSV with <code>distance, elevation</code> or <code>x, y, z</code> columns, loading point first.</p>
      <div class="profile-src"><label class="btn file">Upload CSV<input type="file" id="v-profile-file" accept=".csv,.txt"></label><button class="btn ghost" data-sample="1">Use sample road</button></div>`;
  } else if (kind === 'shift') {
    title.textContent = 'Work hours';
    body.innerHTML = `<div class="grid g2">
      <label>Shift length <span class="u">h</span><input type="number" step="0.5" data-bind="ops.shiftH"></label>
      <label>Shifts per day<input type="number" step="1" data-bind="ops.shiftsPerDay"></label>
      <label>Working days per year<input type="number" step="1" data-bind="ops.daysPerYear"></label>
      <label>Productive minutes per hour<input type="number" step="1" max="60" data-bind="ops.jobEffMin"></label>
      <label>Utilization <span class="u">%</span><input type="number" step="1" data-bind="ops.utilizationPct"></label>
    </div><p class="note">Productive minutes per hour covers breaks, shift change and small delays (50 min/h is typical).</p>`;
  }
  api.renderBound();
  if (!d.open) { d.showModal(); }
}
function openPop(ctx) { popCtx = ctx; renderPop(); const h = document.querySelector('.hint'); if (h) h.remove(); try { localStorage.setItem('mfc-hinted', '1'); } catch (e) { /* ignore */ } }
function closePop() { popCtx = null; const d = $('#pop'); if (d.open) d.close(); }

// ------------------------------------------------------------------ events
function setPathNum(path, v) { api.setPath(path, v); }
function wire() {
  document.addEventListener('click', e => {
    const inVisual = e.target.closest('#tab-visual, #pop');
    if (!inVisual) return;
    const pop = e.target.closest('[data-pop]');
    if (pop) { openPop(pop.dataset.pop); return; }
    const stp = e.target.closest('[data-step]');
    if (stp) {
      const p = stp.dataset.step; const v = Math.max(0, (+api.getPath(p) || 0) + +stp.dataset.d);
      setPathNum(p, v); afterChange(true); return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const [kind, id] = pick.dataset.pick.split(':'); const st = api.state();
      const [, i] = popCtx ? popCtx.split(':') : [];
      if (kind === 'truck') { st.trucks[+i].modelId = id; }
      else if (kind === 'loader') { st.loaders[+i].modelId = id; api.normaliseRows(); }
      else if (kind === 'new-truck') {
        const ex = st.trucks.findIndex(t => t.modelId === id);
        if (ex >= 0) { st.trucks[ex].count = (+st.trucks[ex].count || 0) + 1; popCtx = `truck:${ex}`; }
        else { st.trucks.push({ ...api.newTruck(), modelId: id, count: 2 }); popCtx = `truck:${st.trucks.length - 1}`; }
      } else if (kind === 'new-loader') {
        const m = byId(LOADERS, id);
        st.loaders.push({ ...api.newLoader(), modelId: id, bucketId: m.defaultBucket, count: 1 }); popCtx = `loader:${st.loaders.length - 1}`;
      }
      afterChange(true); return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) { const [k, i] = rm.dataset.remove.split('.'); api.state()[k].splice(+i, 1); closePop(); afterChange(); return; }
    const rs = e.target.closest('[data-reset]');
    if (rs) { api.setPath(rs.dataset.reset, ''); afterChange(true); return; }
    const mat = e.target.closest('[data-mat]');
    if (mat) { api.setMaterial(mat.dataset.mat); afterChange(true); return; }
    const wx = e.target.closest('[data-weather]');
    if (wx) { api.state().site.weatherId = wx.dataset.weather; afterChange(true); return; }
    if (e.target.closest('[data-sample]')) { api.loadSample().then(() => afterChange(true)); return; }
    const ap = e.target.closest('[data-apply]');
    if (ap) {
      const st = api.state(); const diff = +ap.dataset.apply;
      const idx = activeTrucks(); const k = diff > 0 ? idx[0] : idx.reduce((a, b) => ((+st.trucks[b].count) > (+st.trucks[a].count) ? b : a), idx[0]);
      st.trucks[k].count = Math.max(1, (+st.trucks[k].count || 0) + diff); afterChange(); return;
    }
    if (e.target.closest('#v-play')) { playing = !playing; $('#v-play').textContent = playing ? 'Pause' : 'Play'; return; }
    if (e.target.closest('#v-detail')) { document.querySelector('.tab[data-tab="calc"]').click(); return; }
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('#scene [data-pop]')) { e.preventDefault(); openPop(e.target.dataset.pop); }
  });
  document.addEventListener('input', e => {
    const s = e.target.dataset && e.target.dataset.slide; if (!s) return;
    const v = +e.target.value;
    api.setPath(s, s.endsWith('bodyFillPct') ? v : v / 100);
    const lab = e.target.closest('.slide').querySelector('.sv b'); if (lab) lab.textContent = `${v} %`;
    api.schedule();
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'v-profile-file') {
      const f = e.target.files[0]; if (!f) return;
      api.loadProfileFile(f).then(() => afterChange(true)).catch(err => { const n = $('#pop-body .note'); if (n) n.textContent = `⚠ ${err.message}`; });
    }
  });
  $('#pop-close').onclick = closePop;
  $('#pop').addEventListener('click', e => { if (e.target.id === 'pop') closePop(); });
  $('#pop').addEventListener('close', () => { popCtx = null; });
  $('#v-speed').onchange = e => { speed = +e.target.value; };
  $('#v-play').textContent = playing ? 'Pause' : 'Play';
}
function afterChange(rerenderPop) {
  api.renderRows();
  if (rerenderPop && popCtx) renderPop();
  api.schedule();
}
