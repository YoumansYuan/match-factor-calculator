// Visual (friendly) mode: a static mine scene you can click to change equipment,
// plus plain-language results. Uses the same state and engine as the detailed calculator.
import { TRUCKS, LOADERS, MATERIALS, ROADS, SURFACES, SKY, GRADING, SETUPS, LOADING_SIDES, CONDITIONS, JOB_CONDITIONS } from './data/equipment.js?v=202611271959';
import { hToClock } from './conditions.js?v=202611271959';
import { byId } from './engine.js?v=202611271959';
import { unit, fmt, fmtU, toDisp, toSI } from './units.js?v=202611271959';

let api = null;           // hooks into app.js
let R = null;             // latest engine result
let popCtx = null;        // what the dialog is editing

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isADT = m => /articulated/i.test(m.type);

// ------------------------------------------------------------------ public
export function initVisual(hooks) {
  api = hooks;
  wire();
  let rw = 0;
  // only redraw while the Visual tab is showing (a hidden tab measures 0 px wide); redraw when it is shown again
  window.addEventListener('resize', () => { if (!sceneVisible()) return; const w = sceneWidth(); if (w !== rw) { rw = w; if (R) buildScene(); } });
  document.addEventListener('click', e => { if (e.target.closest('.tab[data-tab="visual"]')) requestAnimationFrame(() => { if (R && sceneVisible()) { rw = sceneWidth(); buildScene(); } }); });
}

export function updateVisual(result) {
  R = result;
  renderFleetBar();
  renderSummary();
  buildScene();
  refreshPopLive();
}

// ------------------------------------------------------------------ mapping state <-> result
const activeTrucks = () => api.state().trucks.map((t, i) => (+t.count > 0 ? i : -1)).filter(i => i >= 0);
const activeLoaders = () => api.state().loaders.map((l, i) => (+l.count > 0 ? i : -1)).filter(i => i >= 0);

// ------------------------------------------------------------------ SVG drawings (original, generic shapes)
// ------------------------------------------------------------------ brand colours & machine drawings (original, generic side views)
const brandOf = m => (/^CAT\b/i.test(m.name) ? 'cat' : /deere/i.test(m.name) ? 'jd' : /komatsu/i.test(m.name) ? 'kom' : /volvo/i.test(m.name) ? 'volvo' : 'other');
const brandFill = m => `var(--b-${brandOf(m)})`;
const truckColor = i => { const t = api && api.state().trucks[i]; const m = t && byId(TRUCKS, t.modelId); return m ? brandFill(m) : 'var(--accent)'; };
const tyre = (x, y, r) => `<g class="tyre"><circle cx="${x}" cy="${y}" r="${r}" class="tw"/><circle cx="${x}" cy="${y}" r="${r - 1.2}" class="tread"/><circle cx="${x}" cy="${y}" r="${r * 0.5}" class="rim"/><circle cx="${x}" cy="${y}" r="${r * 0.18}" class="hub"/></g>`;

function truckSVG(model) {
  const b = brandOf(model), c = brandFill(model);
  if (isADT(model)) {
    return `<g class="brand-${b}">
      <path d="M-30,-15 L8,-15 L14,-19 L22,-19 L22,-14 L-30,-12 Z" class="md"/>
      <circle cx="10" cy="-17" r="2.6" class="md2"/>
      <path d="M14,-31 L33,-31 L35,-26 L35,-16 L14,-16 Z" fill="${c}" class="pnl"/>
      <path d="M33,-28 L35,-28 M33,-25 L35,-25 M33,-22 L35,-22" class="grille"/>
      <path d="M14,-47 L26,-47 L28,-31 L13,-31 Z" fill="${c}" class="pnl"/>
      <path d="M16,-45 L25,-45 L26.5,-33 L15,-33 Z" class="gl"/>
      <path d="M15,-48 L27,-48" class="md-line"/>
      <rect x="29" y="-36" width="1.6" height="5" class="md"/>
      <g class="tb" data-pivot="-38,-15">
        <path class="tb-load" d="M-40,-36 Q-16,-50 9,-36 Z"/>
        <path d="M-41,-38 L9,-38 L11,-35 L8,-17 L-34,-15 L-38,-22 Z" fill="${c}" class="pnl"/>
        <path d="M-41,-38 L9,-38" class="edge"/>
        <path d="M-28,-37 L-27,-16 M-15,-37 L-14,-16 M-2,-37 L-1.5,-17" class="rib"/>
        <path d="M-38,-22 L-42,-35" class="edge"/>
      </g>
      ${tyre(-27, -8, 8)}${tyre(-9, -8, 8)}${tyre(25, -8, 8)}
      <path d="M-35,-17 Q-27,-27 -19,-17 M-17,-17 Q-9,-27 -1,-17 M17,-17 Q25,-27 33,-17" class="fender"/>
    </g>`;
  }
  // rigid-frame hauler
  return `<g class="brand-${b}">
    <rect x="-36" y="-23" width="68" height="6" rx="1.5" class="md"/>
    <path d="M18,-34 L35,-34 L36,-20 L18,-20 Z" class="md2"/>
    <path d="M30,-33 L30,-22 M32.5,-33 L32.5,-22" class="grille"/>
    <rect x="15" y="-36" width="22" height="2.2" class="md"/>
    <path d="M17,-36 L17,-42 M37,-36 L37,-42 M17,-42 L37,-42" class="rail"/>
    <path d="M17,-49 L27,-49 L28,-36 L16,-36 Z" fill="${c}" class="pnl"/>
    <path d="M18.5,-47.5 L26,-47.5 L26.5,-39 L18,-39 Z" class="gl"/>
    <path d="M33,-20 L37,-12 M34,-17 L37.5,-17 M35.2,-14.5 L37.8,-14.5" class="rail"/>
    <rect x="29" y="-41" width="1.8" height="5" class="md"/>
    <g class="tb" data-pivot="-38,-21">
      <path class="tb-load" d="M-39,-41 Q-12,-57 14,-41 Z"/>
      <path d="M-41,-41 L14,-41 L16,-44 L38,-52 L39,-49 L16,-38 L13,-22 L-36,-21 L-41,-30 Z" fill="${c}" class="pnl"/>
      <path d="M-41,-41 L14,-41 L16,-44 L38,-52" class="edge"/>
      <path d="M-26,-40 L-25,-22 M-11,-40 L-10.5,-22 M3,-40 L3,-22" class="rib"/>
      <path d="M-41,-30 L-36,-21" class="edge"/>
    </g>
    ${tyre(-22, -10, 10)}${tyre(22, -10, 10)}
    <path d="M-33,-21 Q-22,-34 -11,-21" class="fender"/>
  </g>`;
}

function excavatorSVG(model, pose = 'dump') {
  const b = brandOf(model), c = brandFill(model);
  const rollers = [-22, -12, -2, 8, 18].map(x => `<circle cx="${x}" cy="-4" r="2.6" class="roller"/>`).join('');
  // arm angle: 'dump' = raised over a truck beside it, 'low' = reaching down from a bench
  const armRot = pose === 'low' ? 34 : 0;
  return `<g class="brand-${b}">
    <path d="M-36,-1 Q-43,-1 -43,-8 Q-43,-15 -36,-15 L36,-15 Q43,-15 43,-8 Q43,-1 36,-1 Z" class="track"/>
    <path d="M-36,-1 Q-43,-1 -43,-8 Q-43,-15 -36,-15 L36,-15 Q43,-15 43,-8 Q43,-1 36,-1 Z" class="shoes"/>
    <circle cx="-35" cy="-8" r="5.5" class="sprocket"/><circle cx="35" cy="-8" r="5.5" class="idler"/>${rollers}
    <rect x="-12" y="-20" width="24" height="5" class="md"/>
    <g class="ex-up">
      <path d="M-44,-38 Q-46,-38 -46,-34 L-46,-24 Q-46,-20 -42,-20 L-30,-20 L-30,-38 Z" fill="${c}" class="pnl"/>
      <path d="M-46,-29 L-30,-29" class="md-line"/>
      <path d="M-31,-40 L6,-40 L8,-20 L-31,-20 Z" fill="${c}" class="pnl"/>
      <path d="M-26,-36 L-26,-26 M-22,-36 L-22,-26 M-18,-36 L-18,-26 M-14,-36 L-14,-26" class="vent"/>
      <rect x="-8" y="-45" width="2" height="5" class="md"/>
      <path d="M-30,-44 L-30,-40 M-12,-44 L-12,-40 M-30,-44 L-12,-44" class="rail"/>
      <path d="M7,-56 L22,-56 Q24,-56 24,-53 L24,-20 L7,-20 Z" fill="${c}" class="pnl"/>
      <path d="M9,-54 L21,-54 L22,-34 L9,-34 Z" class="gl"/>
      <path d="M15.5,-54 L15.5,-34" class="md-line"/>
      <g class="ex-arm" transform="rotate(${armRot} 18 -30)">
        <path d="M14,-34 Q22,-70 44,-80 L50,-74 Q30,-64 24,-28 Z" fill="${c}" class="pnl"/>
        <path d="M12,-24 L30,-58" class="cyl"/><path d="M22,-42 L30,-58" class="rod"/>
        <path d="M44,-80 L52,-76 L72,-44 L66,-41 Z" fill="${c}" class="pnl"/>
        <path d="M44,-84 L60,-66" class="cyl"/><path d="M54,-73 L60,-66" class="rod"/>
        <path d="M64,-48 Q80,-46 82,-32 L76,-24 L62,-30 Q60,-40 64,-48 Z" class="bucket"/>
        <path d="M76,-24 L79,-20 L78,-25 M70,-26 L72,-22 L72,-27" class="teeth"/>
        <path class="ex-bload" d="M63,-44 Q72,-56 81,-36 Z"/>
      </g>
    </g>
  </g>`;
}

// ------------------------------------------------------------------ static scene: excavator + a line of trucks
function sceneVisible() { const el = $('#scene-wrap'); return !!(el && el.clientWidth > 0); }
function sceneWidth() { const el = $('#scene-wrap'); const w = el ? el.clientWidth : 1000; return clamp(Math.round(w), 640, 1100); }
const shortName = m => m.name.replace(/^(CAT|John Deere)\s+/i, '');
const truckScale = m => clamp(Math.sqrt(m.ratedPayloadKg / 90000), 0.74, 1.05);

function buildScene() {
  const svg = $('#scene'); if (!svg || !sceneVisible()) return;
  const st = api.state();
  const W = sceneWidth(), H = 270, y0 = 212;
  const yB = y0 - 58, crest = 160, toe = 168;            // bench top for an excavator standing on the dig face
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const mat = byId(MATERIALS, st.materialId);
  const units = [];
  st.loaders.forEach((l, i) => { for (let u = 0; u < (+l.count || 0); u++) units.push(i); });
  // up to two excavators are drawn; bench units first (the first one stands on the dig-face bench)
  const setupOf = i => st.loaders[i].setup || 'bench';
  const drawn = units.slice(0, 2).sort((a, b) => (setupOf(a) === 'bench' ? 0 : 1) - (setupOf(b) === 'bench' ? 0 : 1));
  // dig face: a bench top dropping to the pit floor
  const face = `M0,${yB - 62} L20,${yB - 60} L34,${yB - 40} L30,${yB - 22} L44,${yB} L${crest},${yB} L${toe - 3},${yB + 30} L${toe},${y0} L0,${y0} Z`;
  const line = [];
  st.trucks.forEach((t, i) => { for (let k = 0; k < (+t.count || 0); k++) line.push(i); });
  const tm = k => byId(TRUCKS, st.trucks[line[k]].modelId);
  const exG = (i, x, y, pose, lblY) => {
    const m = byId(LOADERS, st.loaders[i].modelId);
    return `<g class="hot ex" data-pop="loader:${i}" tabindex="0" role="button" aria-label="Change excavator: ${esc(m.name)} (${setupOf(i) === 'bench' ? 'on a bench' : 'on the floor'})" transform="translate(${x},${y})">
      ${excavatorSVG(m, pose)}<text class="lbl-sm" x="0" y="${lblY}" text-anchor="middle">${esc(m.name)}</text></g>`;
  };
  // loading stations, left to right; each takes the next truck in the line
  let ex = '', pads = '', cursor = toe;
  const spots = [];
  drawn.forEach((u, k) => {
    const bench = setupOf(u) === 'bench', sc = spots.length < line.length ? truckScale(tm(spots.length)) : 1;
    let x;
    if (bench) {
      if (k === 0) x = 112;                                   // on the dig-face bench
      else { x = cursor + 60; pads += `<path d="M${x - 52},${y0} L${x - 48},${yB} L${x + 44},${yB} L${x + 50},${y0} Z" class="face pad"/>`; }
      ex += exG(u, x, yB, 'low', -66);
      if (spots.length < line.length) { const tx = x + 66 + 14 * sc; spots.push(tx); cursor = tx + 39 * sc; } else cursor = x + 50;
    } else {
      x = Math.max(toe + 52, cursor + 50);
      ex += exG(u, x, y0, 'dump', 17);
      if (spots.length < line.length) { const tx = x + 72 + 14 * sc; spots.push(tx); cursor = tx + 39 * sc; } else cursor = x + 50;
    }
  });
  if (!units.length) { const xA = toe + 52; ex = `<g class="hot slot" data-pop="add-loader" tabindex="0" role="button" aria-label="Add an excavator" transform="translate(${xA},${y0})"><rect x="-42" y="-70" width="84" height="70" rx="10"/><text x="0" y="-30" text-anchor="middle">+ Excavator</text></g>`; cursor = xA + 50; }
  if (units.length > 2) ex += `<text class="lbl-sm" x="${toe + 52}" y="${y0 + 32}" text-anchor="middle">+ ${units.length - 2} more excavator${units.length > 3 ? 's' : ''} (not drawn)</text>`;
  const truckAx = spots.length ? spots.at(-1) : cursor;
  // truck positions: loading spots first, then the queue
  const qStart = truckAx + 92, slotW = 70;
  const room = W - 24 - slotW - qStart;
  const nQ = Math.max(0, line.length - spots.length);
  const sp = nQ > 1 ? Math.min(86, room / (nQ - 1 + 0.8)) : 86;
  const showLbl = sp >= 48;
  let trucks = '', lastX = truckAx;
  line.forEach((i, k) => {
    const m = byId(TRUCKS, st.trucks[i].modelId), sc = truckScale(m);
    const loading = k < spots.length;
    const x = loading ? spots[k] : qStart + (k - spots.length) * sp;
    if (!loading) lastX = x;
    const dir = loading ? 1 : -1;
    trucks += `<g class="hot truck ${loading ? 'loading' : ''}" data-pop="one:${i}" tabindex="0" role="button" aria-label="Truck ${k + 1}: ${esc(m.name)}${loading ? ' (being loaded)' : ''}" transform="translate(${x.toFixed(1)},${y0})">
      <g transform="scale(${dir * sc},${sc})">${truckSVG(m)}</g>
      ${showLbl || loading ? `<text class="lbl-xs" x="0" y="15" text-anchor="middle">${esc(shortName(m))}</text>` : ''}
      <g class="rm-one" data-dec="${i}" role="button" tabindex="0" aria-label="Remove this ${esc(m.name)}" transform="translate(${(dir * -6 * sc).toFixed(1)},${(-60 * sc).toFixed(1)})"><circle r="8.5"/><path d="M-3,-3 L3,3 M3,-3 L-3,3"/></g>
    </g>`;
  });
  const slotX = nQ === 0 ? qStart : lastX + Math.max(64, sp);
  const slot = `<g class="hot slot" data-pop="add-truck" tabindex="0" role="button" aria-label="Add a truck to the line" transform="translate(${Math.min(slotX, W - slotW / 2 - 10).toFixed(1)},${y0})"><rect x="-32" y="-46" width="64" height="46" rx="8"/><text x="0" y="-19" text-anchor="middle">+ Truck</text></g>`;
  const N = line.length;
  // draw the bench excavator's truck after the face so it sits in front of the toe
  svg.innerHTML = `
    <defs><linearGradient id="sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--sky-1)"/><stop offset="1" stop-color="var(--sky-2)"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    <rect x="0" y="${y0}" width="${W}" height="${H - y0}" class="ground"/>
    <path d="${face}" class="hot face" data-pop="material" tabindex="0" role="button" aria-label="Change material"/>
    <text class="lbl-face" x="12" y="${y0 - 12}">${esc(mat ? mat.name : 'Material')}</text>
    <text class="lbl" x="${qStart - 30}" y="30">Truck line · ${N} truck${N === 1 ? '' : 's'}</text>
    <text class="lbl-sm" x="${qStart - 30}" y="48">${esc(lineSummary(st))}</text>
    <text class="lbl-sm" x="${qStart - 30}" y="66">Tap a truck to change it, × to take it out, + to add one.</text>
    ${pads}${ex}${trucks}${slot}`;
  buildRoadStrip();
}
function lineSummary(st) {
  const parts = st.trucks.filter(t => +t.count > 0).map(t => `${+t.count} × ${byId(TRUCKS, t.modelId).name}`);
  return parts.length ? parts.join(' + ') : 'No trucks yet';
}

function buildRoadStrip() {
  const svg = $('#road-strip'); if (!svg || !R || !R.segs || !R.segs.length) return;
  const W = sceneWidth(), H = 92, X0 = 70, X1 = W - 70, yT = 30, yB = 74;
  const segs = R.segs; const cum = [0]; segs.forEach(s => cum.push(cum.at(-1) + s.len));
  const zs = [segs[0].z0, ...segs.map(s => s.z1)]; const L = cum.at(-1);
  let zmin = Math.min(...zs), zmax = Math.max(...zs); if (zmax - zmin < 30) { const m = (zmax + zmin) / 2; zmin = m - 15; zmax = m + 15; }
  const P = cum.map((d, k) => [X0 + d / L * (X1 - X0), yB - (zs[k] - zmin) / (zmax - zmin) * (yB - yT)]);
  const path = P.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const rise = segs.reduce((s, x) => s + Math.max(0, x.z1 - x.z0), 0), fall = segs.reduce((s, x) => s + Math.max(0, x.z0 - x.z1), 0);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `<g class="hot" data-pop="road" tabindex="0" role="button" aria-label="Change haul road">
    <rect width="${W}" height="${H}" class="strip-bg"/>
    <path d="${path} L${X1},${H} L${X0},${H} Z" class="ground"/>
    <path d="${path}" class="road thin"/>
    <circle cx="${P[0][0]}" cy="${P[0][1]}" r="4" class="dot"/><circle cx="${P.at(-1)[0]}" cy="${P.at(-1)[1]}" r="4" class="dot"/>
    <text class="lbl-xs" x="${X0 - 8}" y="${P[0][1] + 4}" text-anchor="end">Load</text>
    <text class="lbl-xs" x="${X1 + 8}" y="${P.at(-1)[1] + 4}">Dump</text>
    <text class="lbl-sm" x="12" y="18">Haul road · ${fmtU('len', L, 0)} one way · ${fmt('len', rise, 0)} ${unit('len')} up, ${fmt('len', fall, 0)} ${unit('len')} down when loaded · ${esc(skyName())}, ${esc(surfName())} road · tap to change</text>
  </g>`;
}

const skyName = () => byId(SKY, api.state().site.skyId)?.name || '';
const surfName = () => byId(SURFACES, api.state().site.surfaceId)?.name || '';
const hm = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };

// ------------------------------------------------------------------ fleet bar
function renderFleetBar() {
  const st = api.state();
  const lo = st.loaders.map((l, i) => {
    const m = byId(LOADERS, l.modelId); const b = m.buckets.find(x => x.id === l.bucketId) || m.buckets[0];
    return `<button class="chip" data-pop="loader:${i}"><span class="sw" style="background:${brandFill(m)}"></span><b>${esc(m.name)}</b> × ${+l.count || 0}<small>${fmt('vol', b.m3, 1)} ${unit('vol')} bucket</small></button>`;
  }).join('');
  const tr = st.trucks.map((t, i) => {
    const m = byId(TRUCKS, t.modelId);
    return `<span class="chip-wrap"><button class="chip" data-pop="truck:${i}"><span class="sw" style="background:${truckColor(i)}"></span><b>${esc(m.name)}</b> × ${+t.count || 0}<small>${fmtU('kg', m.ratedPayloadKg, 0)} each</small></button><span class="mini-step"><button data-step="trucks.${i}.count" data-d="-1" aria-label="One fewer ${esc(m.name)}">−</button><button data-step="trucks.${i}.count" data-d="1" aria-label="One more ${esc(m.name)}">+</button></span></span>`;
  }).join('');
  $('#fleet-bar').innerHTML = `
    <div class="fb-group"><span class="fb-lbl">Excavators</span>${lo}<button class="chip add" data-pop="add-loader">+ Add excavator</button></div>
    <div class="fb-group"><span class="fb-lbl">Trucks</span>${tr}<button class="chip add" data-pop="add-truck">+ Add trucks</button></div>
    <div class="fb-group"><span class="fb-lbl">Site</span><button class="chip" data-pop="material"><b>${esc(byId(MATERIALS, st.materialId)?.name || 'Material')}</b><small>${fmt('dens', api.matDerived().loose, 2)} ${unit('dens')} in the truck</small></button><button class="chip" data-pop="road"><b>Weather &amp; road</b><small>${esc(skyName())} · ${esc(surfName())}</small></button><button class="chip" data-pop="shift"><b>Work hours</b><small>${esc(st.ops.shiftStart)}–${esc(st.ops.shiftEnd)} × ${st.ops.shiftsPerDay}/day</small></button></div>`;
}

// ------------------------------------------------------------------ plain-language results
function verdict(mf, prod, nL = 1) {
  const ex = nL > 1 ? 'excavators stand' : 'excavator stands', exW = nL > 1 ? 'excavators wait' : 'excavator waits', exN = nL > 1 ? 'excavators never stop' : 'excavator never stops', exF = nL > 1 ? 'the excavators can' : 'the excavator can';
  const lIdle = Math.round((1 - prod.loaderEff) * 100), tWait = Math.round((1 - prod.truckEff) * 100);
  if (mf < 0.85) return { cls: 'u', title: 'Not enough trucks', text: `The ${ex} idle about ${lIdle} % of the time waiting for the next truck. Adding trucks will raise production.` };
  if (mf < 0.98) return { cls: 'ok', title: 'Good match (slightly short of trucks)', text: `The ${exW} a little (≈ ${lIdle} % of the time). This is usually the cheapest way to run a fleet.` };
  if (mf <= 1.05) return { cls: 'ok', title: 'Well balanced', text: `Trucks arrive about as fast as ${exF} fill them. In real life a little waiting happens on both sides.` };
  if (mf <= 1.2) return { cls: 'o', title: 'Slightly too many trucks', text: `The ${exN}, but trucks wait in line about ${tWait} % of the time.` };
  return { cls: 'o', title: 'Too many trucks', text: `Trucks spend about ${tWait} % of their time queuing. Removing trucks would save cost with little loss of production.` };
}

function renderSummary() {
  const box = $('#v-summary');
  if (!R || !R.trucks.length || !R.loaders.length) { box.innerHTML = `<div class="v-card"><b>Add at least one excavator and one truck to see results.</b></div>`; return; }
  const st = api.state();
  const v = verdict(R.mf, R.prod, R.loaders.reduce((a, l) => a + l.count, 0));
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
    const parts = [['Waiting & positioning', t.spotS, 'var(--muted)'], ['Being loaded', t.loadTimeS, 'var(--t5)'], ['Driving loaded', t.haul.t, 'var(--t4)'], ['Dumping', t.dumpS, 'var(--ink-2)'], ['Driving back empty', t.ret.t, 'var(--blue)']];
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
      <div class="v-stat"><span class="lbl">Moved per hour</span><b>${fmtU('rate', R.prod.tph, 0)}</b><small>${fmtU('mass', R.prod.shiftT, 0)} per shift (${hm(api.cond().operatingH)} operating)</small></div>
      <div class="v-stat"><span class="lbl">Volume per hour</span><b>${fmt('vol', R.prod.tph / api.matDerived().bank, 0)} ${api.bcU()}</b><small>dug · ${fmt('vol', R.prod.tph / api.matDerived().loose, 0)} ${api.lcU()} at the dump</small></div>
      ${targetCard()}
      <div class="v-stat"><span class="lbl">Per year</span><b>${fmt('mass', R.prod.yearT / 1e6, 2)} M ${unit('mass')}</b><small>${st.ops.daysPerYear} days, ${st.ops.shiftsPerDay} shifts/day</small></div>
      <div class="v-stat"><span class="lbl">Slowest link</span><b>${/^loaders/.test(R.prod.bottleneck) ? 'Excavator' : 'Trucks'}</b><small>${/^loaders/.test(R.prod.bottleneck) ? 'trucks queue at the excavator' : 'the excavator waits for trucks'}</small></div>
      <div class="v-stat"><span class="lbl">Fuel</span><b>${fmt('fuelpm', R.fuel.lPerT, 2)} ${unit('fuelpm')}</b><small>${fmt('co2pm', R.fuel.co2KgPerT, 2)} ${unit('co2pm')} CO₂</small></div>
    </div>
    <div class="v-card"><h3>Where each truck's time goes</h3>${types}</div>
    <div class="v-card"><h3>Where the shift time goes</h3>${api.waterfallHTML(api.waterfall())}</div>
    ${w.length ? `<div class="warn-box"><b>Worth checking</b><ul>${w.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`;
}

// ------------------------------------------------------------------ dialog ("popover")
const pct = v => Math.round(v * 100);
function modelCard(m, selected, kind, color) {
  const isT = /truck/.test(kind);
  const icon = isT
    ? `<svg viewBox="-46 -56 88 60" class="mc-ico"><g>${truckSVG(m)}</g></svg>`
    : `<svg viewBox="-50 -88 136 92" class="mc-ico"><g>${excavatorSVG(m)}</g></svg>`;
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
      <h4>Where it stands</h4><div class="seg">${SETUPS.map(x => `<button class="${x.id === (l.setup || 'bench') ? 'sel' : ''}" data-setup="${i}:${x.id}">${esc(x.name)}</button>`).join('')}</div>
      ${(l.setup || 'bench') === 'bench' ? `<label>Bench height <span class="u">(${unit('len')}, blank = stick length, CAT recommendation)</span><input type="number" step="0.5" min="0" data-bind="loaders.${i}.benchHeightM" data-q="len" placeholder="${(() => { const m = byId(LOADERS, l.modelId), b = m.buckets.find(x => x.id === l.bucketId) || m.buckets[0]; return b.stickM ? `${fmt('len', b.stickM, 2)} (stick)` : ''; })()}"></label>` : ''}
      <p class="note" id="pop-live">${setupNote(i)}</p>
      <h4>How trucks are loaded</h4><div class="seg">${LOADING_SIDES.map(x => `<button class="${x.id === (l.loadingSide || 'single') ? 'sel' : ''}" data-side="${i}:${x.id}">${esc(x.name)}</button>`).join('')}</div>
      <p class="note">${esc((LOADING_SIDES.find(x => x.id === (l.loadingSide || 'single')) || LOADING_SIDES[0]).note)}</p>
      <div class="grid g2">
        <label>Bucket<select data-bind="loaders.${i}.bucketId">${m.buckets.map(b => `<option value="${b.id}" ${b.id === l.bucketId ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select></label>
        <label>Digging conditions<select data-bind="loaders.${i}.jobCond">${JOB_CONDITIONS.map(x => `<option value="${x.id}" ${x.id === l.jobCond ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Machine condition<select data-bind="loaders.${i}.conditionId">${CONDITIONS.map(x => `<option value="${x.id}" ${x.id === l.conditionId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Availability <span class="u">% (blank = from condition)</span><input type="number" step="1" min="0" max="100" data-bind="loaders.${i}.availabilityPct" placeholder="${pct(byId(CONDITIONS, l.conditionId).availability)}"></label>
        <label>Swing angle to truck <span class="u">° (blank = typical for the setup)</span><input type="number" step="5" data-bind="loaders.${i}.swingDeg" placeholder="${(SETUPS.find(x => x.id === (l.setup || 'bench')) || { swingDeg: 90 }).swingDeg}"></label>
      </div>
      <p class="note">Machine condition sets the availability (worse condition → more breakdowns and repair time), plus a power factor and a slower cycle. Type an availability to override it.</p>
      ${slider(`loaders.${i}.fillOverride`, l.fillOverride === '' ? '' : +l.fillOverride, st.material.fill, 50, 120, 'Bucket fill factor', `How full each bucket really is compared with its rated (heaped) size. Typical for ${esc(byId(MATERIALS, st.materialId)?.name || 'this material')}: ${pct(st.material.fill)} %. Sticky or blocky material fills less; loose, moist soil can fill over 100 %.`)}
      <label>Cycle time override <span class="u">s per bucket</span><input type="number" step="0.5" data-bind="loaders.${i}.cycleOverrideS" placeholder="auto"></label>
      <div class="pop-actions"><button class="btn ghost danger" data-remove="loaders.${i}">Remove this excavator</button></div>`;
  } else if (kind === 'truck' || kind === 'one') {
    const t = st.trucks[i]; if (!t) return closePop();
    const m = byId(TRUCKS, t.modelId);
    const one = kind === 'one';
    title.textContent = one ? `Truck: ${m.name}` : `Trucks: ${m.name}`;
    body.innerHTML = `
      <h4>${one ? 'Change this truck to' : 'Model for all of these trucks'}</h4><div class="mcards">${TRUCKS.map(x => modelCard(x, x.id === t.modelId, one ? 'one-truck' : 'truck', truckColor(i))).join('')}</div>
      ${one ? `<h4>Settings for every ${esc(m.name)} in the line</h4>` : ''}
      ${stepper(`trucks.${i}.count`, +t.count || 0, `Number of ${esc(m.name)} in the line`)}
      ${slider(`trucks.${i}.bodyFillPct`, t.bodyFillPct === '' || t.bodyFillPct == null ? '' : +t.bodyFillPct / 100, 1, 50, 110, 'Body fill factor', `How much of the truck body's rated heaped volume (${fmtU('vol', m.heapedM3, 1)}, SAE 2:1) you actually use. 100 % = fully heaped. Lower it for sticky or blocky material, carry-back, or if operators keep loads low to avoid spillage.`, true)}
      <div class="grid g2">
        <label>Rated payload <span class="u">(${unit('kg')})</span><input type="number" step="100" data-bind="trucks.${i}.payloadKg" data-q="kg" placeholder="${fmt('kg', m.ratedPayloadKg, 0).replace(/,/g, '')}"></label>
        <label>Machine condition<select data-bind="trucks.${i}.conditionId">${CONDITIONS.map(x => `<option value="${x.id}" ${x.id === t.conditionId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Availability <span class="u">% (blank = from condition)</span><input type="number" step="1" min="0" max="100" data-bind="trucks.${i}.availabilityPct" placeholder="${pct(byId(CONDITIONS, t.conditionId).availability)}"></label>
        <label>Time to position at the excavator <span class="u">min</span><input type="number" step="0.05" data-bind="trucks.${i}.spotMin" placeholder="${m.defaults.spotMin}"></label>
        <label>Time to turn and dump <span class="u">min</span><input type="number" step="0.05" data-bind="trucks.${i}.dumpMin" placeholder="${m.defaults.dumpMin}"></label>
      </div>
      <div class="pop-actions">${one ? `<button class="btn ghost danger" data-dec="${i}">Take this truck out of the line</button>` : `<button class="btn ghost danger" data-remove="trucks.${i}">Remove all ${esc(m.name)}</button>`}</div>`;
  } else if (kind === 'add-truck' || kind === 'add-loader') {
    const isT = kind === 'add-truck';
    title.textContent = isT ? 'Add trucks' : 'Add an excavator';
    body.innerHTML = `<p class="note">Pick a model. You can change the number and details next.</p><div class="mcards">${(isT ? TRUCKS : LOADERS).map((x, k) => modelCard(x, false, isT ? 'new-truck' : 'new-loader', truckColor(st.trucks.length))).join('')}</div>`;
  } else if (kind === 'material') {
    title.textContent = 'Material being moved';
    const mat = byId(MATERIALS, st.materialId), md = api.matDerived();
    body.innerHTML = `
      <div class="seg">${MATERIALS.map(x => `<button class="${x.id === st.materialId ? 'sel' : ''}" data-mat="${x.id}">${esc(x.name)}</button>`).join('')}</div>
      <div class="grid g2">
        <label>${md.isBlast ? (byId(MATERIALS, st.materialId)?.rehandle ? 'Density of the stockpile (already blasted and dumped once)' : 'Density of the blasted muck pile') : 'In-situ density at the dig face'} <span class="u">(${unit('dens')})</span><input type="number" step="0.01" data-bind="material.digTm3" data-q="dens"></label>
        <label>Swell from dig face to truck <span class="u">%</span><input type="number" step="1" data-bind="material.swellPct"></label>
        ${md.isBlast ? `<label>Solid rock density before blast <span class="u">(${unit('dens')}, for BCM only)</span><input type="number" step="0.01" data-bind="material.bankTm3" data-q="dens"></label>` : ''}
      </div>
      <h4>How much to move</h4>
      <div class="grid g2">
        <label>Target volume <span class="u">(${unit('vol')})</span><input type="number" step="1000" min="0" data-bind="target.volume" data-q="vol" placeholder="e.g. 500000"></label>
        <label>Measured as<select data-bind="target.basis">${[['auto', `Auto (${md.isBlast ? 'LCM for this material' : 'BCM for this material'})`], ['bcm', 'Bank volume dug (BCM)'], ['lcm', 'Loose volume, as at the dump (LCM)']].map(([v, t]) => `<option value="${v}" ${v === ((st.target || {}).basis || 'auto') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      <p class="note" id="pop-live">${matNote()}<br>${api.targetText()}</p>
      ${slider('material.fill', st.material.fill, mat ? mat.fill : 0.9, 50, 120, 'Bucket fill factor (all excavators)', 'How full a bucket gets in this material. An excavator can override this in its own settings.')}
      <label class="check"><input type="checkbox" data-bind="material.frozen"> Frozen or cemented (buckets fill less, digging is slower)</label>
      <p class="note">${mat ? esc(mat.src) : ''}</p>`;
  } else if (kind === 'road') {
    title.textContent = 'Weather, site & haul road';
    const c = api.cond();
    body.innerHTML = `
      <h4>Weather (visibility)</h4><div class="seg">${SKY.map(x => `<button class="${x.id === st.site.skyId ? 'sel' : ''}" data-sky="${x.id}">${esc(x.name)}</button>`).join('')}</div>
      <div class="grid g2">
        <label>Work date<input type="date" data-bind="site.date"></label>
        <label>Air temperature <span class="u">(${unit('temp')}, blank = month average)</span><input type="number" step="1" data-bind="site.tempC" data-q="temp" placeholder="${c ? fmt('temp', c.tempAuto, 0) : ''}"></label>
        <label>Site latitude <span class="u">°N</span><input type="number" step="0.1" data-bind="site.latitude"></label>
        <label>Site longitude <span class="u">°E</span><input type="number" step="0.1" data-bind="site.longitude"></label>
      </div>
      <h4>Road</h4>
      <div class="grid g2">
        <label>Surface condition today<select data-bind="site.surfaceId">${SURFACES.map(x => `<option value="${x.id}" ${x.id === st.site.surfaceId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Road type<select data-bind="site.roadId">${ROADS.map(x => `<option value="${x.id}" ${x.id === st.site.roadId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Grader maintenance<select data-bind="site.gradingId">${GRADING.map(x => `<option value="${x.id}" ${x.id === st.site.gradingId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" data-bind="site.waterTruck" ${c && c.water.status === 'no' ? 'disabled' : ''}> Water truck for dust control${c && c.water.status === 'no' ? ' <small>(too cold, water freezes)</small>' : c && c.water.status === 'day' ? ' <small>(daytime only)</small>' : ''}</label>
        <label>Speed limit <span class="u">(${unit('speed')})</span><input type="number" step="1" data-bind="site.speedLimitKmh" data-q="speed"></label>
        <label>Downhill speed limit <span class="u">(${unit('speed')})</span><input type="number" step="1" data-bind="site.downhillLimitKmh" data-q="speed"></label>
        <label>Apply it on descents steeper than <span class="u">% (e.g. −9)</span><input type="number" step="0.5" data-bind="site.downhillGradePct"></label>
      </div>
      <p class="note" id="pop-live">${roadNote()}</p>
      <h4>Road shape (distance and elevation)</h4>
      <p class="note">Now using: ${esc(st.profile.name || 'no profile')}. Engine altitude deration uses the elevation along this profile, so there is no separate altitude input.</p>
      <div class="profile-src"><button class="btn" data-ped="1">Draw / edit profile</button><label class="btn ghost file">Upload CSV<input type="file" id="v-profile-file" accept=".csv,.txt"></label><button class="btn ghost" data-sample="1">Use sample road</button></div>`;
  } else if (kind === 'shift') {
    title.textContent = 'Work hours';
    const c = api.cond();
    body.innerHTML = `<div class="grid g2">
      <label>Shift starts<input type="time" data-bind="ops.shiftStart"></label>
      <label>Shift ends<input type="time" data-bind="ops.shiftEnd"></label>
      <label>Shifts per day<input type="number" step="1" min="1" max="3" data-bind="ops.shiftsPerDay"></label>
      <label>Working days per year<input type="number" step="1" data-bind="ops.daysPerYear"></label>
      <label>Meetings, planning, shift change <span class="u">min/shift</span><input type="number" step="5" data-bind="ops.nonProdMin"></label>
      <label>Job efficiency <span class="u">productive min per hour</span><input type="number" step="1" max="60" data-bind="ops.jobEffMin"></label>
    </div>
    <h4>Standby (min per shift)</h4>
    <div class="grid g2">
      <label>Face clean-up / dozer support<input type="number" step="5" data-bind="ops.standby.faceMin"></label>
      <label>Blast clearance (any material)<input type="number" step="5" data-bind="ops.standby.blastMin"></label>
      <label>Excavator relocation<input type="number" step="5" data-bind="ops.standby.relocMin"></label>
      <label>Truck fuelling / service <span class="u">each truck</span><input type="number" step="5" data-bind="ops.standby.fuelMin"></label>
    </div>
    <p class="note">Each loss is counted once: meetings come off the clock, breakdowns come from machine condition (availability), standby stops the excavator (fuelling stops only that truck), and job efficiency covers only small delays (55 min/h typical). Weather, dust and darkness are applied last.</p>
    <div id="pop-live">${R && c ? api.waterfallHTML(api.waterfall()) : ''}</div>`;
  }
  api.renderBound();
  if (!d.open) { d.showModal(); }
}
function setupNote(i) {
  const st = api.state(), l = st.loaders[i]; if (!l) return '';
  const m = byId(LOADERS, l.modelId), b = m.buckets.find(x => x.id === l.bucketId) || m.buckets[0];
  const L = { ...l, digDepthM: b.digDepthM, setup: l.setup || 'bench', benchHeightM: l.benchHeightM === '' || l.benchHeightM == null ? b.stickM : +l.benchHeightM };
  const f = api.setupFactor(L); if (!f.setup) return '';
  const cyc = R && R.trucks[0] ? R.trucks[0].pairs[R.loaders.findIndex(x => x.modelId === l.modelId)] : null;
  return `${esc(f.setup.note)} Cycle-time factor <b>×${f.factor.toFixed(2)}</b> (Komatsu: ${f.setup.id === 'bench' ? `digging depth ${(f.ratio * 100).toFixed(0)} % of the ${fmtU('len', b.digDepthM, 2)} maximum → ${esc(f.row.name)}` : 'digging above the tracks → below 40 %'}, ${esc(f.col.name)}), typical swing ${f.setup.swingDeg}°.${f.setup.id === 'bench' && b.stickM && +L.benchHeightM > b.stickM + 0.05 ? ` <b>This bench is higher than the ${b.stickM} m stick</b> — CAT recommends no higher than the stick length.` : ''}${cyc ? ` Bucket cycle now <b>${cyc.tc.toFixed(1)} s</b>.` : ''}`;
}
function targetCard() {
  const tc = api.targetCalc(); if (!tc.ok) return '';
  return `<div class="v-stat"><span class="lbl">Target ${fmt('vol', tc.V, 0)} ${api.volU(tc.basis)}</span><b>${tc.workDays.toFixed(1)} days</b><small>working days · ${tc.totalLoads.toLocaleString('en-US')} truck loads · finishes ≈ ${tc.finish}</small></div>`;
}
function matNote() {
  const st = api.state(), md = api.matDerived(), dd = unit('dens') === 't/m³' ? 2 : 0;
  return `Density in the truck = ${fmt('dens', st.material.digTm3, dd)} ÷ (1 + ${+st.material.swellPct || 0} %) = <b>${fmt('dens', md.loose, dd)} ${unit('dens')}</b>. Each load stops at whichever comes first: the rated payload (weight) or the usable body volume.${md.isBlast ? ' Blasted rock has already swelled in the blast, so swell into the truck is normally 0 %; the solid density is only used to report BCM.' : ''}`;
}
function roadNote() {
  const c = api.cond(); if (!c) return '';
  return `${esc(c.water.label)} for the water truck at ${fmt('temp', c.tempC, 0)} ${unit('temp')}. Daylight ${hToClock(c.sun.sunrise)}–${hToClock(c.sun.sunset)}, so ${(c.darkFrac * 100).toFixed(0)} % of shift time is in the dark.${c.dust > 0 ? ` Dry road without water: ${c.dust >= 0.5 ? 'heavy' : 'light'} dust.` : ''}${c.capKmh ? ` Visibility speed cap ${fmtU('speed', c.capKmh, 0)}.` : ''} Rolling resistance ${R ? R.road.rr.toFixed(1) : '–'} %, traction ${R ? R.road.mu.toFixed(2) : '–'}.`;
}
// keep the live line in an open dialog current without re-rendering (which would steal input focus)
function refreshPopLive() {
  const el = document.getElementById('pop-live'); if (!el || !popCtx) return;
  const k = popCtx.split(':')[0];
  el.innerHTML = k === 'loader' ? setupNote(+popCtx.split(':')[1]) : k === 'material' ? matNote() + `<br>${api.targetText()}` : k === 'road' ? roadNote() : k === 'shift' ? api.waterfallHTML(api.waterfall()) : el.innerHTML;
}
function openPop(ctx) { popCtx = ctx; renderPop(); }
function closePop() { popCtx = null; const d = $('#pop'); if (d.open) d.close(); }

// ------------------------------------------------------------------ events
function setPathNum(path, v) { api.setPath(path, v); }
function wire() {
  document.addEventListener('click', e => {
    const inVisual = e.target.closest('#tab-visual, #pop');
    if (!inVisual) return;
    const dec = e.target.closest('[data-dec]');
    if (dec) { decTruck(+dec.dataset.dec); return; }
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
      else if (kind === 'one-truck') { const j = moveOne(+i, id); popCtx = j >= 0 ? `one:${j}` : null; }
      else if (kind === 'loader') { st.loaders[+i].modelId = id; api.normaliseRows(); }
      else if (kind === 'new-truck') {
        const ex = st.trucks.findIndex(t => t.modelId === id);
        if (ex >= 0) st.trucks[ex].count = (+st.trucks[ex].count || 0) + 1;
        else st.trucks.push({ ...api.newTruck(), modelId: id, count: 1 });
        closePop(); afterChange(); return;
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
    const su = e.target.closest('[data-setup]');
    if (su) { const [i, id] = su.dataset.setup.split(':'); const l = api.state().loaders[+i]; l.setup = id; afterChange(true); return; }
    const sd = e.target.closest('[data-side]');
    if (sd) { const [i, id] = sd.dataset.side.split(':'); api.state().loaders[+i].loadingSide = id; afterChange(true); return; }
    const wx = e.target.closest('[data-sky]');
    if (wx) { const st = api.state(), sk = byId(SKY, wx.dataset.sky); st.site.skyId = sk.id; if (sk.surface) st.site.surfaceId = sk.surface; afterChange(true); return; }
    if (e.target.closest('[data-ped]')) { closePop(); api.editProfile(); return; }
    if (e.target.closest('[data-sample]')) { api.loadSample().then(() => afterChange(true)); return; }
    const ap = e.target.closest('[data-apply]');
    if (ap) {
      const st = api.state(); const diff = +ap.dataset.apply;
      const idx = activeTrucks(); const k = diff > 0 ? idx[0] : idx.reduce((a, b) => ((+st.trucks[b].count) > (+st.trucks[a].count) ? b : a), idx[0]);
      st.trucks[k].count = Math.max(1, (+st.trucks[k].count || 0) + diff); afterChange(); return;
    }
    if (e.target.closest('#v-detail')) { document.querySelector('.tab[data-tab="calc"]').click(); return; }
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('#scene [data-pop], #road-strip [data-pop]')) { e.preventDefault(); openPop(e.target.dataset.pop); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('#scene [data-dec]')) { e.preventDefault(); decTruck(+e.target.dataset.dec); }
  });
  document.addEventListener('input', e => {
    const s = e.target.dataset && e.target.dataset.slide; if (!s) return;
    const v = +e.target.value;
    api.setPath(s, s.endsWith('bodyFillPct') ? v : v / 100);
    const lab = e.target.closest('.slide').querySelector('.sv b'); if (lab) lab.textContent = `${v} %`;
    api.schedule();
  });
  document.addEventListener('change', e => {
    const b = e.target.dataset && e.target.dataset.bind;
    if (b && popCtx && e.target.closest('#pop') && (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.type === 'date')) { setTimeout(() => { if (popCtx) renderPop(); }, 160); }
    if (e.target.id === 'v-profile-file') {
      const f = e.target.files[0]; if (!f) return;
      api.loadProfileFile(f).then(() => afterChange(true)).catch(err => { const n = $('#pop-body .note'); if (n) n.textContent = `⚠ ${err.message}`; });
    }
  });
  $('#pop-close').onclick = closePop;
  $('#pop').addEventListener('click', e => { if (e.target.id === 'pop') closePop(); });
  $('#pop').addEventListener('close', () => { popCtx = null; });
}
function decTruck(i) {
  const st = api.state(); const t = st.trucks[i]; if (!t) return;
  t.count = Math.max(0, (+t.count || 0) - 1);
  if (t.count === 0) st.trucks.splice(i, 1);
  closePop(); afterChange();
}
// move one truck of type i to model id; returns the index of the type it ended up in
function moveOne(i, id) {
  const st = api.state(); const t = st.trucks[i]; if (!t || t.modelId === id) return i;
  t.count = Math.max(0, (+t.count || 0) - 1);
  let j = st.trucks.findIndex((x, k) => k !== i && x.modelId === id);
  if (j >= 0) st.trucks[j].count = (+st.trucks[j].count || 0) + 1;
  else { st.trucks.splice(i, 0, { ...api.newTruck(), modelId: id, count: 1 }); j = i; }
  const ti = st.trucks.indexOf(t);
  if (t.count === 0) { st.trucks.splice(ti, 1); if (j > ti) j--; }
  return j;
}
function afterChange(rerenderPop) {
  api.renderRows();
  if (rerenderPop && popCtx) renderPop();
  api.schedule();
}
