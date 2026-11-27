import { TRUCKS, LOADERS, MATERIALS, ROADS, SURFACES, GRADING, SKY, VIS_SRC, MONTHLY_TEMP_C, SETUPS, KOM_CYCLE_FACTOR, CONDITIONS, ROAD_SRC, SOURCES, looseOf } from './data/equipment.js?v=202611272128';
import { unit, fmt, fmtU, toDisp } from './units.js?v=202611272128';

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
  const dd = unit('dens') === 't/m³' ? 2 : 0;
  h += `<h3>Materials</h3><div class="equip-card"><table class="tbl"><thead><tr><th>Material</th><th>Density at dig face (${unit('dens')})</th><th>Swell dig face → truck</th><th>Loose density in truck (${unit('dens')})</th><th>Bank density for BCM (${unit('dens')})</th><th>Fill factor</th><th style="text-align:left">Source</th></tr></thead><tbody>${MATERIALS.map(m => `<tr><td>${esc(m.name)}</td><td>${fmt('dens', m.digTm3, dd)}</td><td>${m.swellPct} %</td><td>${fmt('dens', looseOf(m), dd)}</td><td>${fmt('dens', m.blasted ? m.bankTm3 : m.digTm3, dd)}${m.blasted ? ' <small>(solid, pre-blast)</small>' : ''}</td><td>${m.fill}</td><td style="text-align:left;white-space:normal">${esc(m.src)}</td></tr>`).join('')}</tbody></table><p class="note">${est} Typical values — replace with your own in-situ density and swell tests.</p></div>`;
  h += `<h3>Road types</h3><div class="equip-card"><table class="tbl"><thead><tr><th>Road type</th><th>Rolling resistance</th><th>Traction (rubber tyres)</th></tr></thead><tbody>${ROADS.map(r => `<tr><td>${esc(r.name)}</td><td>${r.rr} %</td><td>${r.traction}</td></tr>`).join('')}</tbody></table><p class="note">${esc(ROAD_SRC)}</p></div>`;
  h += `<h3>Road surface condition</h3><div class="equip-card"><table class="tbl"><thead><tr><th>Surface</th><th>RR added</th><th>RR minimum</th><th>Traction ×</th><th>Traction cap</th><th style="text-align:left">Basis</th></tr></thead><tbody>${SURFACES.map(w => `<tr><td>${esc(w.name)}</td><td>${w.rrAdd} %</td><td>${w.rrMin} %</td><td>${w.tractionMult}</td><td>${w.tractionMax}</td><td style="text-align:left;white-space:normal">${esc(w.note)}</td></tr>`).join('')}</tbody></table></div>`;
  h += `<h3>Grader maintenance</h3><div class="equip-card"><table class="tbl"><thead><tr><th>Grading</th><th>Share of surface penalty left</th><th>Extra RR</th><th style="text-align:left">Basis</th></tr></thead><tbody>${GRADING.map(g => `<tr><td>${esc(g.name)}</td><td>${(g.keep * 100).toFixed(0)} %</td><td>+${g.rrExtra} %</td><td style="text-align:left;white-space:normal">${esc(g.note)}</td></tr>`).join('')}</tbody></table><p class="note">${est} Planning estimates.</p></div>`;
  h += `<h3>Weather (visibility)</h3><div class="equip-card"><table class="tbl"><thead><tr><th>Weather</th><th>Speed cap</th><th>Efficiency factor</th><th>Suggested road surface</th><th style="text-align:left">Note</th></tr></thead><tbody>${SKY.map(w => `<tr><td>${esc(w.name)}</td><td>${w.capKmh ? fmtU('speed', w.capKmh, 0) : '—'}</td><td>${w.eff}</td><td>${esc(SURFACES.find(x => x.id === w.surface)?.name || 'unchanged')}</td><td style="text-align:left;white-space:normal">${esc(w.note)}</td></tr>`).join('')}</tbody></table><p class="note">${est} ${esc(VIS_SRC)}</p></div>`;
  h += `<h3>Monthly mean air temperature (default)</h3><div class="equip-card"><table class="tbl"><thead><tr>${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(m => `<th>${m}</th>`).join('')}</tr></thead><tbody><tr>${MONTHLY_TEMP_C.map(t => `<td>${fmt('temp', t, 0)}</td>`).join('')}</tr></tbody></table><p class="note">${est} Approximate Elk Valley (Sparwood, BC) climate normals in ${unit('temp')}; used only when no temperature is typed.</p></div>`;
  h += `<h3>Digging face setup (excavator cycle-time factor)</h3><div class="equip-card"><table class="tbl"><thead><tr><th>Digging depth / max digging depth</th>${KOM_CYCLE_FACTOR.cols.map(c => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${KOM_CYCLE_FACTOR.rows.map(r => `<tr><td>${esc(r.name)}</td>${KOM_CYCLE_FACTOR.f[r.id].map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="note">${esc(KOM_CYCLE_FACTOR.src)} Base cycle times (CAT job condition C) correspond to the 1.0 cell.</p>
    <table class="tbl"><thead><tr><th>Setup</th><th>Digging depth used</th><th>Dumping condition</th><th>Typical swing</th><th style="text-align:left">Basis</th></tr></thead><tbody>${SETUPS.map(x => `<tr><td>${esc(x.name)}</td><td>${x.id === 'bench' ? 'bench height ÷ max digging depth' : 'above the tracks → below 40 %'}</td><td>${esc(KOM_CYCLE_FACTOR.cols.find(c => c.id === x.dumpCol).name)}</td><td>${x.swingDeg}°</td><td style="text-align:left;white-space:normal">${esc(x.note)}</td></tr>`).join('')}</tbody></table>
    <p class="note">${est} The choice of table cell for each setup and the typical swing angles are engineering judgement based on the cited sources; no source gives a single measured bench-vs-floor percentage. Example (390F L, GP 3.4 m stick, max dig depth 8.68 m, CAT condition C 32 s): bench = stick 3.4 m → 39 % → factor 0.9, swing 60° → 28.8 s; floor → factor 1.1, swing 110° (+2 s) → 37.4 s (≈ 30 % slower).</p></div>`;
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
<div class="eq">loose density in the truck = density at the dig face / (1 + swell dig face → truck)
   soil, till, overburden, coal: dig-face density = in-situ (bank) density, swell e.g. 20–35 %
   blasted rock: dig-face density = muck-pile density (already swelled by the blast), swell ≈ 0 %
bank volume (BCM) = tonnes / bank density     bank density = in-situ density, or solid rock density before blast
loose volume at dump (LCM) = tonnes / loose density
bucket payload (t) = heaped bucket (m³) × fill factor × loose density (t/m³)
passes by weight  nW = rated truck payload / bucket payload
usable body (m³) = heaped body SAE 2:1 (m³) × body fill factor   (default 100 %)
passes by volume  nV = usable body (m³) / (heaped bucket × fill factor)
raw passes = min(nW, nV)       — the governing limit is shown in the results</div>
<p>Rounding options: Burt &amp; Caccetta rule of thumb (add the last pass only if the remainder ≥ ⅓ bucket), always round up, round down, or fractional. The carried load is capped at the usable body volume (excess spills). The <b>bucket fill factor</b> (per material, overridable per loading unit) is how full the bucket is compared with its SAE heaped rating; the <b>body fill factor</b> (per truck type) is how much of the truck's SAE 2:1 heaped volume can really be used — lower it for sticky or blocky material, carry-back, or when loads are kept off the tailgate and sideboards to avoid spillage. Pairs outside 3–6 passes, loads over +10 % of rated (CAT 10/10/20 payload policy) and buckets that cannot clear the truck loading height + 0.5 m are flagged. Frozen/cemented material reduces fill factor and slows digging (MIME 333 Ch.2: freezing impairs loading).</p>

<h3>2. Loader cycle and truck loading time</h3>
<div class="eq">loader cycle tc = [handbook cycle for job condition A–E + swing adjustment] × setup factor × machine-condition multiplier
swing adjustment = +1 s per 10° above 90° (Komatsu), −1 s per 10° below 60°;  blank swing = typical for the setup (bench 60°, floor 110°)
setup factor (Komatsu 15A-10 conversion factor, relative to the 1.0 cell that matches CAT condition C):
   on a bench above the truck: row = bench height ÷ max digging depth, column "Normal (large dump target)"
   on the floor, same level as the truck: row "below 40 %" (digging above the tracks), column "Rather difficult (small dump target)"</div>
<p>Bench loading is the method recommended by CAT, Terex O&amp;K and Komatsu: the bucket is lifted less, the operator sees into the body and the swing is short. Komatsu (3A-131) notes that working on the same floor as the truck "requires a larger swing angle, cycle time is longer" and uses more fuel because of the higher lift; Litvin &amp; Litvin (2020) found the highest productivity with the truck below the excavator. Bench height should be about the truck rail height and not more than the stick length (CAT; Terex O&amp;K) — the default bench height is the stick length of the selected bucket/stick (CAT47 p.7-116) and the tool warns when a typed bench is higher. On a bench the loading-height check adds the bench height to the bucket's maximum loading height.</p>
<div class="eq">truck loading time = passes × tc                        (MIME 333, Burt &amp; Caccetta)
                or (passes − 1) × tc + first-pass time   (Komatsu Handbook 15A-14)</div>

<h3>3. Haul and return travel</h3>
<div class="eq">rolling resistance RR (%) = road type RR + surface penalty × share left after grading + grading extra RR
   (snow/ice set a minimum RR instead of an addition)
traction μ = road type μ − (road type μ − surface μ) × share left after grading
grade resistance GR (%) = grade, + uphill / − downhill in the direction of travel
total resistance TR = RR + GR        required rimpull = GMW × g × TR
usable rimpull = traction coefficient × weight on driving wheels   (wheel slip if required &gt; usable)
available rimpull(v) = OEM rimpull envelope(v) × altitude power fraction(segment elevation) × machine power factor
speed caps: speed limits, downhill limit, visibility cap (fog / snow / rain, heavy dust)
downhill (TR &lt; 0): maximum speed from the continuous-retarding curve for effective grade GR − RR</div>
<p><b>Rimpull simulation</b> (default): the road is cut into ≤ 5 m steps; the truck starts from rest at the loader, accelerates with a = (rimpull − resistance) / (GMW × rotating-mass factor), is capped by top speed, speed limits and retarder speed, and brakes (constant deceleration) to stop at the dump. This is the integrated form of the formula-sheet expression t = d/v + v/2a₁ + v/2a₂ and it naturally applies the Komatsu "speed factors" for short sections. <b>Steady speed</b> reproduces the textbook chart-reading method (time = distance / speed, no acceleration) for checking against assignments.</p>
<p>Altitude derating follows MIME 333 §3.7.6: rimpull is multiplied by the fraction of flywheel power available at altitude (CAT altitude deration table). There is no fixed altitude input: each road segment uses its own elevation from the haul profile, and the excavator uses the elevation of the loading point. CAT retarder curves are rated at sea level and 32 °C; above 32 °C the retarding capacity is reduced by the "retarder derate per °C" assumption (heat rejection falls with ambient temperature — Tannant &amp; Regensburg 2001).</p>

<h3>4. Cycle time</h3>
<div class="eq">truck cycle = spot/exchange + loading + haul (loaded) + maneuver &amp; dump + return (empty)
defaults: CAT typical fixed times — exchange 0.6–0.8 min, maneuver + dump 1.0–1.2 min
Komatsu: dump 0.5–0.7 (favourable) / 1.0–1.3 (average) / 1.5–2.0 min (unfavourable); spot 0.1–0.5 min</div>
<p>Queue and wait time are not included, consistent with the match factor definition (Morgan &amp; Peterson 1968).</p>

<h3>5. Match factor</h3>
<p>Truck loading time here is the time the excavator is busy with one truck. It depends on how trucks are loaded (set per excavator):</p>
<div class="eq">single-side loading:  loading time = spot + passes × bucket cycle   (excavator waits while the truck backs in; MIME 333 "shovel loading time")
double-side loading:  loading time = passes × bucket cycle          (next truck spots on the other side meanwhile; Burt &amp; Caccetta)
The truck cycle time always includes spot. The same loading time sets the excavator capacity.</div>
<div class="eq">homogeneous:  MF = (number of trucks × truck loading time) / (number of loaders × truck cycle time)
heterogeneous (Burt &amp; Caccetta 2008 corrigendum, eq. 16):
   lt_j = Σ_i trucks_i × loading time_i,j          (time for loader type j to serve the whole truck fleet)
   MF   = number of trucks / [ Σ_j (loaders_j / lt_j) × Σ_i (trucks_i × truck cycle time_i) ]</div>
<p>MF &lt; 1: under-trucked, loaders wait (loader efficiency ≈ MF). MF &gt; 1: over-trucked, trucks queue (truck efficiency ≈ 1/MF). Mining fleets are often run slightly under 1 for minimum cost; construction aims at 1. The calculated MF is optimistic because it ignores truck bunching — use the bunching factor to discount truck output. Note: the original 2007 paper's §4 formula was corrected by the authors in 2008; this tool uses the corrected form.</p>

<h3>6. Time model, production and fleet size</h3>
<p>Every loss is applied exactly once, in this order (shown as the "Where the shift time goes" chart):</p>
<div class="eq">scheduled shift  = shift end − shift start                      (e.g. 07:00–19:00 = 12 h)
operating time   = scheduled − meetings / planning / shift change  (e.g. 12 h − 60 min = 11 h)
× availability   = from machine condition (worse condition → more breakdowns), or typed per machine
× utilization    = 1 − (face clean-up + blast clearance + excavator relocation) / operating time   (stops the excavator)
× truck util.    = 1 − truck fuelling / operating time                                           (stops that truck only)
× job efficiency = productive min per hour / 60   (small operational delays only; 55 min/h typical)
× condition      = weather visibility factor × (1 − dust loss × dust level) × (1 − darkness loss × dark fraction)

truck capacity  = Σ trucks_i × availability_i × load_i / cycle_i × bunching × truck util.
loader capacity = Σ_j (loaders_j × availability_j / lt_j) × Σ_i trucks_i × availability_i × load_i
production (t/operating h) = min(truck capacity, loader capacity) × job efficiency × utilization × condition
per shift = production × operating time;  per year = × shifts per day × days per year
target: tonnes = target volume × (bank density if BCM, loose density if LCM);  working days = tonnes / (production per day)
   blasted rock and rehandle default to LCM (muck pile / stockpile volume at 2.3 t/m³), other materials to BCM;
   calendar days = working days × 365 / working days per year, counted from the work date
   truck loads = tonnes split between truck types by their hourly haulage (n × availability × load / cycle) ÷ load per truck, rounded up
trucks for MF = 1 ≈ trucks / MF;   trucks to deploy = that / mean availability   (MIME 333: required fleet = theoretical / availability)</div>
<p><b>Date and location.</b> The work date sets a default air temperature (approximate monthly mean, editable) and the sunrise/sunset times at the site latitude/longitude (NOAA approximation, Mountain Time with daylight saving). The dark fraction is the share of all shift hours outside daylight. <b>Water truck rule:</b> mean temperature &gt; 3 °C — available; 0–3 °C — daytime only (half effect, night frost risk); ≤ 0 °C — not available (water freezes on the road). A dry road with no effective water truck raises dust: heavy dust reduces efficiency and caps haul speed; frozen ground raises about half as much dust. Rain or snow removes dust.</p>
<h3>6b. Seasonal schedule (month-by-month weather)</h3>
<p>Climate: Environment Canada station <b>Fording River Cominco</b> (climate ID 1152899, 1,585 m), at the Fording River operation. For every month the daily records 1970–2007 give the 10th, 50th and 90th percentile of: mean temperature, days with precipitation ≥ 0.2 mm, days with snowfall ≥ 0.2 cm and ≥ 5 cm, and days with snow on the ground. A <b>heavy-snow day</b> is a snow day that belongs to a storm of ≥ 5 cm in total (consecutive snow days added up), so multi-day storms count fully. <b>Dense-fog days</b> come from Cranbrook airport (940 m), the nearest station that records visibility (days with ≥ 3 h below 1 km, hourly data 1985–2012); it likely under-states mountain fog, so enter site values. The default monthly temperature of the work date is the 1981–2010 normal of the same station.</p>
<div class="eq">temperature at the road = station value − 0.006 °C/m × (mean haul-road elevation − 1,585 m)
slider level L (−1 … +1):  value = median + (P90 − median) × L   (L ≥ 0, cautious: more snow/rain days, P10 temperature)
                           value = median + (median − P10) × L   (L &lt; 0, optimistic)
day types per month:  dense fog (from dry days)  → sky Fog, part of the day lost (hours lost per fog day, default 6 h)
                      heavy snow (storm ≥ 5 cm)  → sky Snowing, road Loose snow
                      light snowfall            → sky Overcast, road Packed snow
                      rain = precipitation days − snowfall days → sky Rain, road Wet
                      dry with snow on the ground → sky Clear, road Packed snow
                      dry                        → sky Clear, road Dry (dust / water-truck rule by temperature)
tonnes per working day (month) = Σ day-type share × production of that day type (same fleet, road, shift and darkness for mid-month)
working days = calendar days × working days per year ÷ 365;  finish = day the cumulative tonnes reach the target</div>
<p>Snow and ice roads also cap the speed (packed snow 40, loose snow 30, ice 25 km/h — planning estimates). The grader / snow-clearing program removes part of the snow penalty: snowClear = 0 (no grader), 0.3 (once per shift), 0.45 (twice per shift), 0.6 (dedicated grader), 0.85 (grader + plow &amp; sander through snowfall), 0.95 (full winter program). On snow roads RR and traction penalties are × (1 − snowClear) and the snow speed cap × (1 + 0.6 snowClear); on ice half of that (sanding). Months are independent: the cautious end assumes every month is a 1-in-10 bad month, which together is rarer than 1 in 10.</p>

<h3>7. Fuel and CO₂</h3>
<div class="eq">fuel (L/h) = P × β × ρ / γ      β = 0.268 kg/kW·h, γ = 0.85 kg/L      (MIME 333 formula sheet)
ρ (load factor) while hauling = wheel power / (drivetrain efficiency × available net power), from the simulation
ρ while idling / spotting / dumping / retarding = idle load factor;   excavators: ρ from the equipment table
CO₂ = fuel × Cc × OF × 44/12 = fuel × 733 g/L × 0.99 × 44/12 = 2.66 kg / L</div>

<h3>8. Weather, road surface and machine condition</h3>
<ul>
<li><b>Weather</b> (clear, overcast, rain, snowing, fog) only affects visibility: a speed cap on the haul and an efficiency factor. Choosing a weather suggests a road surface (rain → wet, snowing → loose snow) which you can change.</li>
<li><b>Road surface condition</b> (dry, wet, muddy, packed snow, loose snow, ice, spring thaw) changes rolling resistance and traction. Snow and ice values: CAT traction table; Tannant &amp; Regensburg (2001) — packed snow 0.20–0.55, loose snow 0.10–0.25, smooth ice 0.10–0.25, wet ice 0.05–0.10; loose snow RR 4.5 %, packed snow 2.5 %.</li>
<li><b>Grader maintenance</b> removes part of the snow/mud penalty; with no grader, ruts and spillage add RR.</li>
<li><b>Temperature</b> affects retarder capacity above 32 °C and the water-truck rule. Below 0 °C consider ticking "frozen material".</li>
<li><b>Machine condition</b> (New / Good / Average / Worn) sets mechanical availability, an engine power factor and a loader cycle multiplier. These are planning estimates; override availability with site data.</li>
</ul>

<h3>9. Haul profile input</h3>
<p>Draw the profile in the built-in editor (drag points, click the line to add a point, type exact values in the table, optionally trace over a screenshot of your elevation chart), or upload a CSV of <code>distance, elevation</code> or a Minesite/Vulcan/Deswik polyline as <code>x, y, z</code> (along-road distance is computed from the x-y path). Points are resampled into equal segments of the chosen length (default 100 m) to remove digitising noise before grades are calculated. The bundled sample is the "EVR ElevBasemap ELK" line digitised from a supplied elevation-profile image (4.5 km, 1 662–1 767 m; accuracy ≈ ±2 m elevation, ±20 m distance).</p>

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
