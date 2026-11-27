import { TRUCKS, LOADERS, MATERIALS, ROADS, WEATHER, CONDITIONS, ROAD_SRC, SOURCES } from './data/equipment.js?v=202611270515';
import { unit, fmt, fmtU, toDisp } from './units.js?v=202611270515';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const est = '<span class="badge est">estimate</span>';
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const docCharts = {};

function srcList(src) { return Object.entries(src).map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join(''); }
function table(rows) { return `<table class="tbl"><tbody>${rows.map(([a, b, flag]) => `<tr><td>${a}</td><td>${b}${flag ? ' ' + est : ''}</td></tr>`).join('')}</tbody></table>`; }

export function renderEquipment(el) {
  if (!el) return;
  let h = '<h3>Haul trucks</h3>';
  TRUCKS.forEach(t => {
    const e = t.estimate || {};
    h += `<div class="equip-card"><h3>${esc(t.name)} <small>— ${esc(t.type)}</small></h3><div class="equip-grid"><div>${table([
      ['Rated (target) payload', fmtU('kg', t.ratedPayloadKg, 0) + (t.payloadNoLinerKg ? ` <small>(${fmt('kg', t.payloadNoLinerKg, 0)} without liner)</small>` : '')],
      ['Empty operating weight', fmtU('kg', t.emptyKg, 0)], ['Max gross machine weight', fmtU('kg', t.gmwKg, 0)],
      ['Body capacity heaped (2:1) / struck', `${fmt('vol', t.heapedM3, 1)} / ${fmt('vol', t.struckM3, 1)} ${unit('vol')}`],
      ['Net / gross power', `${fmt('power', t.netPowerKw, 0)}${t.grossPowerKw ? ' / ' + fmt('power', t.grossPowerKw, 0) : ''} ${unit('power')}`],
      ['Top speed (loaded)', fmtU('speed', t.topSpeedKmh, 1)], ['Gears', `${t.gears}${t.gearSpeedsKmh ? ` <small>(${t.gearSpeedsKmh.map(v => fmt('speed', v, 0)).join(' · ')} ${unit('speed')})</small>` : ''}`],
      ['Driven axles', `${esc(t.driveAxle)} — weight on drivers ${(t.driverWeightFracEmpty * 100).toFixed(0)} % empty / ${(t.driverWeightFracLoaded * 100).toFixed(0)} % loaded`],
      ['Loading height', fmtU('len', t.loadingHeightM, 2)], ['Tyres', esc(t.tires)],
      ['Default spot / dump time', `${t.defaults.spotMin} / ${t.defaults.dumpMin} min`],
      ['Altitude: power available', t.altitude.map(([a, f]) => `${fmt('len', a, 0)} ${unit('len')} → ${(f * 100).toFixed(1)} %`).join('; '), e.altitude || e.altitudeAbove3050],
      ['Rimpull curve', e.rimpull ? 'generated from published power' : 'digitised from OEM chart', e.rimpull],
      ['Retarder curve', e.retarder ? 'generated (class-equivalent)' : 'digitised from OEM chart', e.retarder],
    ])}<ul class="note">${srcList(t.src)}${e.curves ? `<li>${est} ${esc(e.curves)}</li>` : ''}${t.matching ? `<li>${esc(t.matching)}</li>` : ''}</ul></div>
    <div><div class="chart-box tall"><canvas id="eq-${t.id}"></canvas></div><p class="note">Upper envelope of rimpull (solid) and continuous retarding force (stepped) vs speed, sea level.</p></div></div></div>`;
  });
  h += '<h3>Loading units</h3>';
  LOADERS.forEach(l => {
    const e = l.estimate || {};
    h += `<div class="equip-card"><h3>${esc(l.name)} <small>— ${esc(l.type)}</small></h3><div class="equip-grid"><div>${table([
      ['Net power', fmtU('power', l.netPowerKw, 0)], ['Engine', esc(l.engine)],
      ['Operating weight', l.operatingWeightKg[0] === l.operatingWeightKg[1] ? fmtU('kg', l.operatingWeightKg[0], 0) : `${fmt('kg', l.operatingWeightKg[0], 0)}–${fmt('kg', l.operatingWeightKg[1], 0)} ${unit('kg')}`],
      ['Swing speed', l.swingRpm ? `${l.swingRpm} rpm` : '—'],
      ['Cycle time by job condition (s)', Object.entries(l.cycleS).map(([k, v]) => `${k}: ${v}`).join(' · '), !!e.cycle],
      ['Altitude: power available', l.altitude.map(([a, f]) => `${fmt('len', a, 0)} ${unit('len')} → ${(f * 100).toFixed(1)} %`).join('; '), !!e.altitude],
      ['Engine load factor (fuel)', l.fuelLoadFactor, true],
    ])}<ul class="note">${srcList(l.src)}${typeof e.loadHeight === 'string' ? `<li>${est} ${esc(e.loadHeight)}</li>` : ''}${typeof e.cycle === 'string' ? `<li>${est} ${esc(e.cycle)}</li>` : ''}</ul></div>
    <div><table class="tbl"><thead><tr><th>Bucket</th><th>Heaped (${unit('vol')})</th><th>Max loading height (${unit('len')})</th></tr></thead><tbody>${l.buckets.map(b => `<tr><td>${esc(b.label)}</td><td>${fmt('vol', b.m3, 1)}</td><td>${fmt('len', b.loadHeightM, 2)}${e.loadHeight ? ' ' + est : ''}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  });
  h += `<h3>Materials</h3><div class="equip-card"><table class="tbl"><thead><tr><th>Material</th><th>Loose density (${unit('dens')})</th><th>Swell</th><th>Bank density (${unit('dens')})</th><th>Fill factor</th><th style="text-align:left">Source</th></tr></thead><tbody>${MATERIALS.map(m => `<tr><td>${esc(m.name)}</td><td>${fmt('dens', m.looseTm3, unit('dens') === 't/m³' ? 2 : 0)}</td><td>${m.swellPct} %</td><td>${fmt('dens', m.looseTm3 * (1 + m.swellPct / 100), unit('dens') === 't/m³' ? 2 : 0)}</td><td>${m.fill}</td><td style="text-align:left;white-space:normal">${esc(m.src)}</td></tr>`).join('')}</tbody></table></div>`;
  h += `<h3>Road surfaces</h3><div class="equip-card"><table class="tbl"><thead><tr><th>Surface</th><th>Rolling resistance</th><th>Traction (rubber tyres)</th></tr></thead><tbody>${ROADS.map(r => `<tr><td>${esc(r.name)}</td><td>${r.rr} %</td><td>${r.traction}</td></tr>`).join('')}</tbody></table><p class="note">${esc(ROAD_SRC)}</p></div>`;
  h += `<h3>Weather &amp; surface state</h3><div class="equip-card"><table class="tbl"><thead><tr><th>State</th><th>RR added</th><th>RR minimum</th><th>Traction ×</th><th>Traction cap</th><th style="text-align:left">Basis</th></tr></thead><tbody>${WEATHER.map(w => `<tr><td>${esc(w.name)}</td><td>${w.rrAdd} %</td><td>${w.rrMin} %</td><td>${w.tractionMult}</td><td>${w.tractionMax}</td><td style="text-align:left;white-space:normal">${esc(w.note)}</td></tr>`).join('')}</tbody></table></div>`;
  h += `<h3>Machine condition (age &amp; reliability)</h3><div class="equip-card"><table class="tbl"><thead><tr><th>Condition</th><th>Mechanical availability</th><th>Engine power factor</th><th>Loader cycle multiplier</th></tr></thead><tbody>${CONDITIONS.map(c => `<tr><td>${c.name}</td><td>${(c.availability * 100).toFixed(0)} %</td><td>${c.powerFactor}</td><td>${c.cycleMult}</td></tr>`).join('')}</tbody></table><p class="note">${est} Planning presets — replace with your fleet's maintenance records (availability) where available. The power factor scales rimpull (slower climbing for worn engines/drivetrains).</p></div>`;
  h += `<h3>References</h3><ul>${Object.values(SOURCES).map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
  el.innerHTML = h;
  if (!window.Chart) return;
  TRUCKS.forEach(t => {
    const id = `eq-${t.id}`; if (docCharts[id]) docCharts[id].destroy();
    const ret = []; let v0 = 0; t.retarder.forEach(([v, f]) => { ret.push({ x: toDisp('speed', v0), y: f }, { x: toDisp('speed', v), y: f }); v0 = v; });
    docCharts[id] = new Chart(document.getElementById(id), { type: 'line', data: { datasets: [
      { label: 'Rimpull (t-force)', data: t.rimpull.map(([v, f]) => ({ x: toDisp('speed', v), y: f })), borderColor: css('--bad'), pointRadius: 2, borderWidth: 2 },
      { label: 'Retarding force (t-force)', data: ret, borderColor: css('--blue'), pointRadius: 0, borderWidth: 2 },
    ] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } }, scales: { x: { type: 'linear', title: { display: true, text: unit('speed') } }, y: { beginAtZero: true, title: { display: true, text: 'tonnes-force (×1000 kgf)' } } } } });
  });
}

export function renderMethod(el) {
  if (!el) return;
  el.innerHTML = `
<h2>Method &amp; sources</h2>
<p class="lead">The calculator follows the equipment-selection procedure taught in McGill MIME 333 (Materials Handling, Ch.3 Loading &amp; Haulage Equipment) and the estimating methods in the Caterpillar and Komatsu performance handbooks. Mixed fleets use the corrected heterogeneous match factor of Burt &amp; Caccetta.</p>

<h3>1. Material, bucket payload and passes</h3>
<div class="eq">bucket payload (t) = heaped bucket (m³) × fill factor × loose density (t/m³)
passes by weight  nW = rated truck payload / bucket payload
usable body (m³) = heaped body SAE 2:1 (m³) × body fill factor   (default 100 %)
passes by volume  nV = usable body (m³) / (heaped bucket × fill factor)
raw passes = min(nW, nV)       — the governing limit is shown in the results</div>
<p>Rounding options: Burt &amp; Caccetta rule of thumb (add the last pass only if the remainder ≥ ⅓ bucket), always round up, round down, or fractional. The carried load is capped at the usable body volume (excess spills). The <b>bucket fill factor</b> (per material, overridable per loading unit) is how full the bucket is compared with its SAE heaped rating; the <b>body fill factor</b> (per truck type) is how much of the truck's SAE 2:1 heaped volume can really be used — lower it for sticky or blocky material, carry-back, or when loads are kept off the tailgate and sideboards to avoid spillage. Pairs outside 3–6 passes, loads over +10 % of rated (CAT 10/10/20 payload policy) and buckets that cannot clear the truck loading height + 0.5 m are flagged. Frozen/cemented material reduces fill factor and slows digging (MIME 333 Ch.2: freezing impairs loading).</p>

<h3>2. Loader cycle and truck loading time</h3>
<div class="eq">loader cycle tc = [handbook cycle for job condition A–E + swing adjustment] × machine-condition multiplier
swing adjustment = +1 s per 10° above 90° (Komatsu), −1 s per 10° below 60°
truck loading time = passes × tc                        (MIME 333, Burt &amp; Caccetta)
                or (passes − 1) × tc + first-pass time   (Komatsu Handbook 15A-14)</div>

<h3>3. Haul and return travel</h3>
<div class="eq">rolling resistance RR (%) — road surface table, modified by weather
grade resistance GR (%) = grade, + uphill / − downhill in the direction of travel
total resistance TR = RR + GR        required rimpull = GMW × g × TR
usable rimpull = traction coefficient × weight on driving wheels   (wheel slip if required &gt; usable)
available rimpull(v) = OEM rimpull envelope(v) × altitude power fraction × machine power factor
downhill (TR &lt; 0): maximum speed from the continuous-retarding curve for effective grade GR − RR</div>
<p><b>Rimpull simulation</b> (default): the road is cut into ≤ 5 m steps; the truck starts from rest at the loader, accelerates with a = (rimpull − resistance) / (GMW × rotating-mass factor), is capped by top speed, speed limits and retarder speed, and brakes (constant deceleration) to stop at the dump. This is the integrated form of the formula-sheet expression t = d/v + v/2a₁ + v/2a₂ and it naturally applies the Komatsu "speed factors" for short sections. <b>Steady speed</b> reproduces the textbook chart-reading method (time = distance / speed, no acceleration) for checking against assignments.</p>
<p>Altitude derating follows MIME 333 §3.7.6: rimpull is divided by the fraction of flywheel power available at the site altitude (CAT altitude deration table). CAT retarder curves are rated at sea level and 32 °C; above 32 °C the retarding capacity is reduced by the "retarder derate per °C" assumption (heat rejection falls with ambient temperature — Tannant &amp; Regensburg 2001).</p>

<h3>4. Cycle time</h3>
<div class="eq">truck cycle = spot/exchange + loading + haul (loaded) + maneuver &amp; dump + return (empty)
defaults: CAT typical fixed times — exchange 0.6–0.8 min, maneuver + dump 1.0–1.2 min
Komatsu: dump 0.5–0.7 (favourable) / 1.0–1.3 (average) / 1.5–2.0 min (unfavourable); spot 0.1–0.5 min</div>
<p>Queue and wait time are not included, consistent with the match factor definition (Morgan &amp; Peterson 1968).</p>

<h3>5. Match factor</h3>
<div class="eq">homogeneous:  MF = (number of trucks × truck loading time) / (number of loaders × truck cycle time)
heterogeneous (Burt &amp; Caccetta 2008 corrigendum, eq. 16):
   lt_j = Σ_i trucks_i × loading time_i,j          (time for loader type j to serve the whole truck fleet)
   MF   = number of trucks / [ Σ_j (loaders_j / lt_j) × Σ_i (trucks_i × truck cycle time_i) ]</div>
<p>MF &lt; 1: under-trucked, loaders wait (loader efficiency ≈ MF). MF &gt; 1: over-trucked, trucks queue (truck efficiency ≈ 1/MF). Mining fleets are often run slightly under 1 for minimum cost; construction aims at 1. The calculated MF is optimistic because it ignores truck bunching — use the bunching factor to discount truck output. Note: the original 2007 paper's §4 formula was corrected by the authors in 2008; this tool uses the corrected form.</p>

<h3>6. Production, availability and fleet size</h3>
<div class="eq">truck capacity  = Σ trucks_i × availability_i × load_i / cycle_i × bunching
loader capacity = Σ_j (loaders_j × availability_j / lt_j) × Σ_i trucks_i × availability_i × load_i
production      = min(truck capacity, loader capacity) × job efficiency (min/h ÷ 60) × utilization
trucks for MF = 1 ≈ trucks / MF;   trucks to deploy = that / mean availability   (MIME 333: required fleet = theoretical / availability)</div>

<h3>7. Fuel and CO₂</h3>
<div class="eq">fuel (L/h) = P × β × ρ / γ      β = 0.268 kg/kW·h, γ = 0.85 kg/L      (MIME 333 formula sheet)
ρ (load factor) while hauling = wheel power / (drivetrain efficiency × available net power), from the simulation
ρ while idling / spotting / dumping / retarding = idle load factor;   excavators: ρ from the equipment table
CO₂ = fuel × Cc × OF × 44/12 = fuel × 733 g/L × 0.99 × 44/12 = 2.66 kg / L</div>

<h3>8. Weather, temperature and machine condition</h3>
<ul>
<li><b>Weather</b> adds rolling resistance and caps traction (snow, ice, spring thaw, wet). Snow and ice values: CAT traction table; Tannant &amp; Regensburg (2001) — packed snow 0.20–0.55, loose snow 0.10–0.25, smooth ice 0.10–0.25, wet ice 0.05–0.10; loose snow RR 4.5 %, packed snow 2.5 %.</li>
<li><b>Temperature</b> affects retarder capacity above 32 °C. Below 0 °C consider ticking "frozen material".</li>
<li><b>Machine condition</b> (New / Good / Average / Worn) sets mechanical availability, an engine power factor and a loader cycle multiplier. These are planning estimates; override availability with site data.</li>
</ul>

<h3>9. Haul profile input</h3>
<p>Upload a CSV of <code>distance, elevation</code> or a Minesite/Vulcan/Deswik polyline as <code>x, y, z</code> (along-road distance is computed from the x-y path). Points are resampled into equal segments of the chosen length (default 100 m) to remove digitising noise before grades are calculated. The bundled sample is the "EVR ElevBasemap ELK" line digitised from a supplied elevation-profile image (4.5 km, 1 662–1 767 m; accuracy ≈ ±2 m elevation, ±20 m distance).</p>

<h3>10. Validation</h3>
<ul>
<li>MIME 333 Ch.3 Example 1 (4 × 994H, 10 × 789C, 30 × 793F): MF = 1.125 ✔</li>
<li>Burt &amp; Caccetta §3.1 heterogeneous loaders: MF = 0.88 ✔; corrigendum §4.1 heterogeneous trucks and loaders: MF = 0.928 ✔</li>
<li>MIME 333 Tutorial 1 (3 passes × 25 s, 4 min travel): 4.2 trucks for MF = 1 ✔</li>
<li>Pass rule examples 150/60 → 3, 150/42 → 4, 230/38 → 6 ✔</li>
<li>777E at max GMW on 10 % total resistance ≈ 11.6 km/h (chart: 3rd gear); on −10 % effective grade = 19.8 km/h (chart: 3rd gear retarding) ✔</li>
<li>Rimpull envelopes cross-checked against power: F ≈ η × P / v within ~10 % between 10 and 40 km/h.</li>
</ul>
<p class="note">Run <code>node tests/engine.test.mjs</code> in the repository to repeat these checks.</p>

<h3>References</h3>
<ul>${Object.values(SOURCES).map(s => `<li>${esc(s)}</li>`).join('')}
<li>MIME 333 Formula sheet (final, 2025); Assignment 1 &amp; solution (Winter 2025); Tutorial 1; Ch.2 Earthmoving Fundamentals.</li>
<li>MIME 419 Surface Mining — Haul road design and maintenance (2025); MIME 330 Mining Geotechnics — Mine haul roads (2024).</li>
<li>Morgan, W. &amp; Peterson, L. (1968) Determining shovel-truck productivity, Mining Engineering.</li></ul>`;
}
