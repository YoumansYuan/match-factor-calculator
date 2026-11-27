// Haul-profile editor: draw the elevation profile by hand (or trace it over a screenshot).
// Left end = loading point, right end = dump. Points are stored in metres (SI) in state.profile.points.
import { unit, toDisp, toSI, fmt } from './units.js?v=202611271930';

let api = null, pts = [], sel = -1, drag = -1, bg = null, bgOpacity = 0.45;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const W = 820, H = 420, PL = 64, PR = 18, PT = 18, PB = 40;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function initProfileEditor(hooks) {
  api = hooks;
  try { bg = localStorage.getItem('mfc-ped-bg'); } catch (e) { bg = null; }
  wire();
}
export function openProfileEditor() {
  const p = api.state().profile.points;
  pts = p && p.length >= 2 ? p.map(q => [+q[0], +q[1]]) : [[0, 1700], [1000, 1700]];
  const d0 = pts[0][0]; pts = pts.map(q => [q[0] - d0, q[1]]);
  sel = -1;
  render();
  const dlg = $('#ped'); if (!dlg.open) dlg.showModal();
}

// ------------------------------------------------------------------ view / scales
function view() {
  const v = api.state().profile.view || {};
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  let xMax = v.xMax !== '' && v.xMax != null ? +v.xMax : niceCeil(Math.max(...xs) * 1.08);
  let yMin = v.yMin !== '' && v.yMin != null ? +v.yMin : Math.min(...zs), yMax = v.yMax !== '' && v.yMax != null ? +v.yMax : Math.max(...zs);
  if (v.yMin === '' || v.yMin == null || v.yMax === '' || v.yMax == null) {
    const pad = Math.max(10, (yMax - yMin) * 0.15);
    if (v.yMin === '' || v.yMin == null) yMin = Math.floor((yMin - pad) / 10) * 10;
    if (v.yMax === '' || v.yMax == null) yMax = Math.ceil((yMax + pad) / 10) * 10;
  }
  if (yMax - yMin < 1) yMax = yMin + 1;
  if (xMax <= 0) xMax = 100;
  return { xMax, yMin, yMax };
}
function niceCeil(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= x) return m * p; return 10 * p; }
function niceStep(range, n) { const raw = range / n, p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; }
const sx = (x, v) => PL + x / v.xMax * (W - PL - PR);
const sy = (z, v) => H - PB - (z - v.yMin) / (v.yMax - v.yMin) * (H - PT - PB);
const ix = (px, v) => (px - PL) / (W - PL - PR) * v.xMax;
const iy = (py, v) => v.yMin + (H - PB - py) / (H - PT - PB) * (v.yMax - v.yMin);
const maxGrade = () => +(api.state().profile.maxGradePct ?? 10) || 10;

// ------------------------------------------------------------------ render
function render() { renderSvg(); renderTable(); renderSide(); }
function renderSvg() {
  const v = view(), svg = $('#ped-svg');
  // axes in display units, positions in SI
  const dxMax = toDisp('len', v.xMax), dyMin = toDisp('len', v.yMin), dyMax = toDisp('len', v.yMax);
  const xs = niceStep(dxMax, 8), ys = niceStep(dyMax - dyMin, 6);
  let grid = '';
  for (let x = 0; x <= dxMax + 1e-9; x += xs) { const X = sx(toSI('len', x), v); grid += `<line x1="${X}" y1="${PT}" x2="${X}" y2="${H - PB}" class="pg"/><text x="${X}" y="${H - PB + 16}" text-anchor="middle" class="pt">${fmtNum(x)}</text>`; }
  for (let y = Math.ceil(dyMin / ys) * ys; y <= dyMax + 1e-9; y += ys) { const Y = sy(toSI('len', y), v); grid += `<line x1="${PL}" y1="${Y}" x2="${W - PR}" y2="${Y}" class="pg"/><text x="${PL - 8}" y="${Y + 4}" text-anchor="end" class="pt">${fmtNum(y)}</text>`; }
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0], v).toFixed(1)},${sy(p[1], v).toFixed(1)}`).join('');
  const mg = maxGrade();
  let grades = '';
  const showLbl = pts.length <= 40;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], g = (b[1] - a[1]) / Math.max(0.01, b[0] - a[0]) * 100;
    const bad = Math.abs(g) > mg;
    if (bad) grades += `<line x1="${sx(a[0], v)}" y1="${sy(a[1], v)}" x2="${sx(b[0], v)}" y2="${sy(b[1], v)}" class="pbad"/>`;
    if (showLbl && (sx(b[0], v) - sx(a[0], v) > 34 || bad)) grades += `<text x="${(sx(a[0], v) + sx(b[0], v)) / 2}" y="${Math.min(sy(a[1], v), sy(b[1], v)) - 8}" text-anchor="middle" class="pgr ${bad ? 'bad' : ''}">${g >= 0 ? '+' : ''}${g.toFixed(1)}%</text>`;
  }
  const dots = pts.map((p, i) => `<circle cx="${sx(p[0], v)}" cy="${sy(p[1], v)}" r="${i === sel ? 7 : 5.5}" class="pdot ${i === sel ? 'sel' : ''} ${i === 0 ? 'first' : i === pts.length - 1 ? 'last' : ''}" data-i="${i}"/>`).join('');
  const img = bg ? `<image href="${bg}" x="${PL}" y="${PT}" width="${W - PL - PR}" height="${H - PT - PB}" preserveAspectRatio="none" opacity="${bgOpacity}"/>` : '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `<rect x="${PL}" y="${PT}" width="${W - PL - PR}" height="${H - PT - PB}" class="pbg"/>${img}${grid}
    <text x="${(PL + W - PR) / 2}" y="${H - 6}" text-anchor="middle" class="pax">Distance from loading point (${unit('len')})</text>
    <text x="14" y="${(PT + H - PB) / 2}" text-anchor="middle" class="pax" transform="rotate(-90 14 ${(PT + H - PB) / 2})">Elevation (${unit('len')})</text>
    <path d="${path}" class="pline"/>${grades}<path d="${path}" class="phit"/>${dots}
    <text x="${sx(pts[0][0], v) + 8}" y="${sy(pts[0][1], v) + 20}" class="ptag">Load</text>
    <text x="${sx(pts.at(-1)[0], v) - 8}" y="${sy(pts.at(-1)[1], v) + 20}" text-anchor="end" class="ptag">Dump</text>`;
}
const fmtNum = x => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-US') : (+x.toFixed(1)).toString());

function renderTable() {
  const mg = maxGrade();
  $('#ped-rows').innerHTML = pts.map((p, i) => {
    const g = i < pts.length - 1 ? (pts[i + 1][1] - p[1]) / Math.max(0.01, pts[i + 1][0] - p[0]) * 100 : null;
    return `<tr class="${i === sel ? 'sel' : ''}" data-row="${i}"><td>${i === 0 ? 'Load' : i === pts.length - 1 ? 'Dump' : i}</td>
      <td><input type="number" step="10" data-pt="${i}" data-k="0" value="${+toDisp('len', p[0]).toFixed(1)}" ${i === 0 ? 'disabled' : ''}></td>
      <td><input type="number" step="1" data-pt="${i}" data-k="1" value="${+toDisp('len', p[1]).toFixed(1)}"></td>
      <td class="${g != null && Math.abs(g) > mg ? 'bad' : ''}">${g == null ? '' : `${g >= 0 ? '+' : ''}${g.toFixed(1)} %`}</td>
      <td>${pts.length > 2 ? `<button class="x-sm" data-del="${i}" aria-label="Delete point">×</button>` : ''}</td></tr>`;
  }).join('');
  $('#ped-unit-d').textContent = unit('len'); $('#ped-unit-z').textContent = unit('len');
}
function renderSide() {
  const L = pts.at(-1)[0];
  let up = 0, dn = 0; for (let i = 1; i < pts.length; i++) { const d = pts[i][1] - pts[i - 1][1]; if (d > 0) up += d; else dn -= d; }
  $('#ped-stats').innerHTML = `${pts.length} points · ${fmt('len', L, 0)} ${unit('len')} long · climbs ${fmt('len', up, 0)} ${unit('len')}, descends ${fmt('len', dn, 0)} ${unit('len')} (loaded direction)`;
  $('#ped-simplify').hidden = pts.length <= 40;
  const v = api.state().profile.view || {};
  ['xMax', 'yMin', 'yMax'].forEach(k => { const el = $(`#ped-${k}`); if (document.activeElement !== el) el.value = v[k] === '' || v[k] == null ? '' : +toDisp('len', +v[k]).toFixed(1); });
  const vv = view();
  $('#ped-xMax').placeholder = `auto ${fmtNum(toDisp('len', vv.xMax))}`; $('#ped-yMin').placeholder = `auto ${fmtNum(toDisp('len', vv.yMin))}`; $('#ped-yMax').placeholder = `auto ${fmtNum(toDisp('len', vv.yMax))}`;
  $('#ped-maxg').value = maxGrade();
  $('#ped-bg-ctl').hidden = !bg;
}

// ------------------------------------------------------------------ edits
function commit() { api.setProfile(pts.map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]), `Drawn in editor (${pts.length} points, ${fmt('len', pts.at(-1)[0], 0)} ${unit('len')})`); }
function svgPoint(e) {
  const svg = $('#ped-svg'), r = svg.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H];
}
const snapX = x => Math.round(toDisp('len', x)) / (toDisp('len', 1) || 1);
const snapZ = z => Math.round(toDisp('len', z) * 10) / 10 / (toDisp('len', 1) || 1);
function moveTo(i, px, py) {
  const v = view();
  let x = snapX(ix(px, v)), z = snapZ(iy(py, v));
  if (i === 0) x = 0;
  else {
    const lo = pts[i - 1][0] + 1, hi = i < pts.length - 1 ? pts[i + 1][0] - 1 : Infinity;
    x = clamp(x, lo, hi);
  }
  pts[i] = [x, z];
}
function insertAt(px, py) {
  const v = view();
  const x = snapX(ix(px, v)), z = snapZ(iy(py, v));
  if (x <= 0) return;
  let k = pts.findIndex(p => p[0] > x);
  if (k === -1) { pts.push([x, z]); sel = pts.length - 1; } else { if (pts[k - 1] && Math.abs(pts[k - 1][0] - x) < 1) return; pts.splice(k, 0, [x, z]); sel = k; }
}
function del(i) { if (pts.length <= 2) return; pts.splice(i, 1); if (i === 0) { const d0 = pts[0][0]; pts = pts.map(p => [p[0] - d0, p[1]]); } sel = -1; }
// Douglas–Peucker simplification (keeps the shape within a vertical tolerance)
function simplify(points, tol) {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points.at(-1)];
  let idx = -1, dmax = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const z = a[1] + (b[1] - a[1]) * (points[i][0] - a[0]) / ((b[0] - a[0]) || 1);
    const d = Math.abs(points[i][1] - z); if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= tol) return [a, b];
  return [...simplify(points.slice(0, idx + 1), tol).slice(0, -1), ...simplify(points.slice(idx), tol)];
}

function wire() {
  const svg = $('#ped-svg');
  svg.addEventListener('pointerdown', e => {
    const dot = e.target.closest('.pdot');
    if (dot) { drag = sel = +dot.dataset.i; svg.setPointerCapture(e.pointerId); render(); e.preventDefault(); return; }
    if (e.target.closest('.phit')) { const [px, py] = svgPoint(e); insertAt(px, py); drag = sel; if (drag >= 0) svg.setPointerCapture(e.pointerId); render(); e.preventDefault(); return; }
    sel = -1; render();
  });
  svg.addEventListener('pointermove', e => { if (drag < 0) return; const [px, py] = svgPoint(e); moveTo(drag, px, py); renderSvg(); renderSide(); });
  const end = () => { if (drag < 0) return; drag = -1; renderTable(); commit(); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  document.addEventListener('keydown', e => {
    if (!$('#ped').open) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0 && !(e.target.matches && e.target.matches('input'))) { e.preventDefault(); del(sel); render(); commit(); }
  });
  $('#ped-rows').addEventListener('change', e => {
    const el = e.target; if (!el.dataset.pt) return;
    const i = +el.dataset.pt, k = +el.dataset.k, val = toSI('len', +el.value);
    if (!isFinite(val)) return;
    if (k === 0) { const lo = pts[i - 1] ? pts[i - 1][0] + 1 : 0, hi = pts[i + 1] ? pts[i + 1][0] - 1 : Infinity; pts[i][0] = clamp(val, lo, hi); } else pts[i][1] = val;
    sel = i; render(); commit();
  });
  $('#ped-rows').addEventListener('click', e => {
    const d = e.target.closest('[data-del]'); if (d) { del(+d.dataset.del); render(); commit(); return; }
    const r = e.target.closest('[data-row]'); if (r && !e.target.matches('input')) { sel = +r.dataset.row; render(); }
  });
  $('#ped-add').onclick = () => { const l = pts.at(-1); pts.push([l[0] + 200, l[1]]); sel = pts.length - 1; render(); commit(); };
  $('#ped-new').onclick = () => { const z = pts[0][1]; pts = [[0, z], [1000, z]]; sel = -1; api.state().profile.view = {}; render(); commit(); };
  $('#ped-simplify').onclick = () => { pts = simplify(pts, 1.0); sel = -1; render(); commit(); };
  $('#ped-flip').onclick = () => { const L = pts.at(-1)[0]; pts = pts.map(p => [L - p[0], p[1]]).reverse(); sel = -1; render(); commit(); };
  ['xMax', 'yMin', 'yMax'].forEach(k => { $(`#ped-${k}`).addEventListener('change', e => { const st = api.state(); st.profile.view = st.profile.view || {}; st.profile.view[k] = e.target.value === '' ? '' : toSI('len', +e.target.value); render(); api.schedule(); }); });
  $('#ped-maxg').addEventListener('change', e => { api.state().profile.maxGradePct = +e.target.value || 10; render(); api.schedule(); });
  $('#ped-bg').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { bg = rd.result; try { localStorage.setItem('mfc-ped-bg', bg); } catch (err) { /* too big to keep — fine for this session */ } render(); };
    rd.readAsDataURL(f); e.target.value = '';
  });
  $('#ped-bg-op').addEventListener('input', e => { bgOpacity = +e.target.value / 100; renderSvg(); });
  $('#ped-bg-rm').onclick = () => { bg = null; try { localStorage.removeItem('mfc-ped-bg'); } catch (e) { /* ignore */ } render(); };
  $('#ped-csv').onclick = () => {
    const txt = `distance_${unit('len')},elevation_${unit('len')}\n` + pts.map(p => `${+toDisp('len', p[0]).toFixed(2)},${+toDisp('len', p[1]).toFixed(2)}`).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = 'haul-profile.csv'; document.body.appendChild(a); a.click(); a.remove();
  };
  $('#ped-close').onclick = () => $('#ped').close();
  $('#ped-done').onclick = () => $('#ped').close();
}
