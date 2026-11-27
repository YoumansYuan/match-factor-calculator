// Run: node tests/engine.test.mjs
import { readFileSync } from 'node:fs';
import { matchFactor, passCount, steadySpeed, computeScenario, buildSegments, interp, matchPair } from '../js/engine.js';
import { TRUCKS, LOADERS, MATERIALS, looseOf } from '../js/data/equipment.js';
import { solar, darkHours, waterTruckStatus, siteConditions, clockToH } from '../js/conditions.js';
import { resolveRoad, setupFactor, loaderCycleS } from '../js/engine.js';

let fails = 0;
const near = (name, got, exp, tol) => {
  const ok = Math.abs(got - exp) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${(+got).toFixed(4)}, expected ${exp} ± ${tol}`);
};

// 1. MIME 333 Ch.3 Example 1 — 4 × CAT 994H, 10 × 789C (6 passes × 25 s), 30 × 793F (7 × 25 s), CT 1500 s → MF 1.125
near('MIME333 Ch.3 heterogeneous trucks', matchFactor([{ n: 10, ct: 1500 }, { n: 30, ct: 1500 }], [{ n: 4 }], [[150], [175]]), 1.125, 0.0005);

// 2. Burt & Caccetta 2007 §3.1 — 22 trucks (CT 1500), loader B 105 s, loader C 140 s → MF 0.88
near('Burt & Caccetta §3.1 heterogeneous loaders', matchFactor([{ n: 22, ct: 1500 }], [{ n: 1 }, { n: 1 }], [[105, 140]]), 0.88, 0.005);

// 3. Burt & Caccetta corrigendum 2008 §4.1 — 15 A + 7 B trucks, loaders C & D → MF 0.928
near('Burt & Caccetta corrigendum §4.1 fully heterogeneous', matchFactor([{ n: 15, ct: 1500 }, { n: 7, ct: 1500 }], [{ n: 1 }, { n: 1 }], [[105, 120], [140, 180]]), 0.928, 0.001);

// 4. Homogeneous reduces to Morgan & Peterson: MF = N·lt / (L·CT). Tutorial 1: 3 passes × 25 s, travel 4 min → trucks for MF=1
// CT = 75 + 240 = 315 s; MF(N) = N·75/315 → N = 4.2 trucks for MF = 1
near('Tutorial 1 homogeneous (N=4.2 → MF 1)', matchFactor([{ n: 4.2, ct: 315 }], [{ n: 1 }], [[75]]), 1.0, 0.001);

// 5. Pass rule of thumb (Burt & Caccetta): 150/60 → 3, 150/42 → 4, 230/38 → 6, 230/60 → 4
near('passes 150/60', passCount(150 / 60, 'third'), 3, 0);
near('passes 150/42', passCount(150 / 42, 'third'), 4, 0);
near('passes 230/38', passCount(230 / 38, 'third'), 6, 0);
near('passes 230/60', passCount(230 / 60, 'third'), 4, 0);

// 6. Rimpull-speed-gradeability: 777E at max GMW on 10 % total resistance → ≈ 11–13 km/h (chart: 3rd gear)
const t777 = TRUCKS.find(t => t.id === 'cat777e');
const ctx = { rr: 2, mu: 0.6, altitudeM: 0, tempC: 20, powerFactor: 1, speedLimitKmh: 100, downhillLimitKmh: 0, downhillGradePct: -3, hotRetarderDeratePerC: 0.01 };
near('777E loaded, TR 10 % (rimpull)', steadySpeed(t777, 163360, 8, ctx).v, 12, 1.5);
// 7. Retarder: 777E loaded, grade −12 % with RR 2 % → effective −10 % → 16.3 t → 3rd gear ≈ 19.8 km/h
near('777E loaded, eff. grade −10 % (retarder)', steadySpeed(t777, 163360, -12, ctx).v, 19.8, 0.1);
// 8. 777E empty on level, RR 2 % → top speed
near('777E empty, level (≈ top speed)', steadySpeed(t777, 70753, 0, ctx).v, 65, 0.5);

// 9. Rimpull envelope vs power check (777E: 708 kW × 0.85 / v at 40 km/h ≈ 5.5 t)
near('777E rimpull @40 km/h (t)', interp(t777.rimpull, 40), 5.5, 0.7);

// 10. Full scenario on the digitised EVR profile
const csv = readFileSync(new URL('../data/sample-profile-evr.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map(l => l.split(',').map(Number));
const segs = buildSegments(csv, { segmentM: 100 });
near('profile length (m)', segs.reduce((s, x) => s + x.len, 0), 4500, 1);
const res = computeScenario({
  site: { altitudeM: 1700, tempC: 10, roadId: 'firm', weatherId: 'dry', speedLimitKmh: 50, downhillLimitKmh: 35, downhillGradePct: -3 },
  material: { looseTm3: 2.3, fill: 0.85, frozen: false },
  loaders: [{ modelId: 'cat390fl', count: 1, bucketM3: 4.6, loadHeightM: 9.1, jobCond: 'C', swingDeg: 90, conditionId: 'good' }],
  trucks: [{ modelId: 'cat745', count: 6, conditionId: 'good' }],
  profile: { points: csv, segmentM: 100, reverse: false, loadAreaM: 50, dumpAreaM: 50 },
  ops: { shiftH: 10, shiftsPerDay: 2, daysPerYear: 300, jobEff: 50 / 60, utilization: 0.85, passRule: 'third', loadTimeMethod: 'n', firstPassFrac: 0.2, travelModel: 'sim', mfUseAvailability: false, bunching: 1, brakingDecel: 0.6, massFactor: 1.05, hotRetarderDeratePerC: 0.01, idleLF: 0.15, frozenFillMult: 0.9, frozenCycleMult: 1.1 },
});
const t = res.trucks[0];
console.log(`\nScenario: 745 × 6 with 390F (4.6 m³, blasted rock 2.3 t/m³)`);
console.log(`  passes ${t.pairs[0].n} (raw ${t.pairs[0].raw.toFixed(2)}, ${t.pairs[0].governs}), load ${t.loadT.toFixed(1)} t, loader cycle ${t.pairs[0].tc.toFixed(1)} s, load time ${t.loadTimeS.toFixed(0)} s`);
console.log(`  haul ${(t.haul.t / 60).toFixed(2)} min, return ${(t.ret.t / 60).toFixed(2)} min, cycle ${(t.ct / 60).toFixed(2)} min`);
console.log(`  MF ${res.mf.toFixed(3)}, production ${res.prod.tph.toFixed(0)} t/h, trucks for MF=1: ${res.trucksForMF1.toFixed(1)}`);
console.log(`  fuel ${res.fuel.lPerT.toFixed(3)} L/t, CO2 ${res.fuel.co2KgPerT.toFixed(2)} kg/t`);
console.log('  warnings:', res.warnings);
near('5 passes for 745 + 390F 4.6 m³ in blasted rock', t.pairs[0].n, 5, 0);
const steady = computeScenario({ site: { altitudeM: 1700, tempC: 10, roadId: 'firm', weatherId: 'dry', speedLimitKmh: 50, downhillLimitKmh: 35, downhillGradePct: -3 },
  material: { looseTm3: 2.3, fill: 0.85 }, loaders: [{ modelId: 'cat390fl', count: 1, bucketM3: 4.6, loadHeightM: 9.1, jobCond: 'C', swingDeg: 90, conditionId: 'good' }],
  trucks: [{ modelId: 'cat745', count: 6, conditionId: 'good' }], profile: { points: csv, segmentM: 100, loadAreaM: 50, dumpAreaM: 50 },
  ops: { shiftH: 10, shiftsPerDay: 2, daysPerYear: 300, jobEff: 50 / 60, utilization: 0.85, passRule: 'third', loadTimeMethod: 'n', travelModel: 'steady', bunching: 1, brakingDecel: 0.6, massFactor: 1.05, hotRetarderDeratePerC: 0.01, idleLF: 0.15 } });
const st = steady.trucks[0];
console.log(`  steady-state (textbook) haul ${(st.haul.t / 60).toFixed(2)} min, return ${(st.ret.t / 60).toFixed(2)} min`);
if (!(t.haul.t > st.haul.t)) { fails++; console.log('FAIL  simulation should be slower than steady-state (acceleration)'); } else console.log('PASS  simulation slower than steady-state (accounts for acceleration/braking)');

// 11. Truck body fill factor: 745 (26 m³ heaped) with till 1.8 t/m³, 4.6 m³ bucket × 0.9 → volume governs;
//     body fill 0.85 shrinks usable volume to 22.1 m³ → nV = 22.1 / 4.14 = 5.34 and load capped at 22.1 × 1.8 = 39.8 t
{
  const base = { truckIn: { modelId: 'cat745' }, loader: { bucketM3: 4.6, jobCond: 'C', swingDeg: 90, conditionId: 'good' } };
  const mat = { looseTm3: 1.8, fill: 0.9 };
  const ops = { passRule: 'third', loadTimeMethod: 'n', frozenFillMult: 0.9, frozenCycleMult: 1.1 };
  const t745 = TRUCKS.find(x => x.id === 'cat745'), m390 = LOADERS.find(x => x.id === 'cat390fl');
  const full = matchPair(t745, { ...base.truckIn }, { ...base.loader, conditionId: 'good' }, m390, mat, ops);
  const cut = matchPair(t745, { ...base.truckIn, bodyFill: 0.85 }, { ...base.loader }, m390, mat, ops);
  near('body fill 1.0 → passes by volume nV', full.nV, 26.0 / (4.6 * 0.9), 0.01);
  near('body fill 0.85 → passes by volume nV', cut.nV, 26.0 * 0.85 / (4.6 * 0.9), 0.01);
  if (!(cut.loadT <= 26.0 * 0.85 * 1.8 + 1e-9)) { fails++; console.log('FAIL  body fill should cap carried load'); } else console.log('PASS  body fill 0.85 caps carried load at usable volume');
}

// Site conditions & time model
{
  // Sparwood-area latitude: summer solstice ≈ 16.1 h of daylight, winter solstice ≈ 8.2 h
  near('daylight 21 Jun @ 49.7°N', solar('2026-06-21', 49.7, -114.9).dayLenH, 16.1, 0.25);
  near('daylight 21 Dec @ 49.7°N', solar('2026-12-21', 49.7, -114.9).dayLenH, 8.2, 0.25);
  const s = solar('2026-06-21', 49.7, -114.9); // MDT: sunrise ≈ 05:30, sunset ≈ 21:40
  near('sunrise 21 Jun (MDT clock h)', s.sunrise, 5.5, 0.25);
  near('dark hours in 19:00–07:00 night shift, 21 Jun', darkHours(19, 12, s.sunrise, s.sunset), 24 - s.dayLenH, 0.05);
  near('water truck 10 °C', waterTruckStatus(10).eff, 1, 0); near('water truck 2 °C', waterTruckStatus(2).eff, 0.5, 0); near('water truck -1 °C', waterTruckStatus(-1).eff, 0, 0);
  near('clock 19:30', clockToH('19:30'), 19.5, 0);
  const c = siteConditions({ date: '2026-07-15', skyId: 'clear', surfaceId: 'dry', waterTruck: true },
    { shiftStart: '07:00', shiftEnd: '19:00', shiftsPerDay: 2, nonProdMin: 60, jobEffMin: 55, standby: { faceMin: 20, blastMin: 15, relocMin: 10, fuelMin: 15 } });
  near('shift 07–19 length', c.shiftLenH, 12, 0); near('operating time 12 h − 60 min', c.operatingH, 11, 1e-9);
  near('utilization = 1 − 45 min / 660 min', c.utilization, 1 - 45 / 660, 1e-9);
  near('truck util = 1 − 15 / 660', c.truckUtil, 1 - 15 / 660, 1e-9);
  near('July with water truck: no dust', c.dust, 0, 0);
  const w = siteConditions({ date: '2026-01-15', skyId: 'clear', surfaceId: 'dry', waterTruck: true }, { shiftStart: '07:00', shiftEnd: '19:00' });
  near('January: water truck unavailable → frozen-ground dust 0.4', w.dust, 0.4, 0);
  const f = siteConditions({ date: '2026-07-15', skyId: 'fog', surfaceId: 'wet' }, { shiftStart: '07:00', shiftEnd: '19:00' });
  near('fog visibility cap km/h', f.capKmh, 25, 0);
  const dn = siteConditions({ date: '2026-12-15', skyId: 'clear', surfaceId: 'dry' }, { shiftPattern: 'daynight', shiftStart: '07:00', shiftEnd: '19:00', nightStart: '19:00', nightEnd: '05:00', nonProdMin: 60, jobEffMin: 55, standby: { faceMin: 30 } });
  near('day + night 12 h + 10 h scheduled', dn.schedH, 22, 1e-9); near('night shift operating 10 h − 1 h', dn.shifts[1].operatingH, 9, 1e-9);
  near('average operating hours per shift', dn.operatingH, 10, 1e-9); near('utilization weighted: 1 − 2×30 min / 1200 min', dn.utilization, 1 - 60 / 1200, 1e-9);
  near('night shift in December is all dark', dn.shifts[1].darkFrac, 1, 1e-6);
}
// Materials: loose = dig-face / (1 + swell); blasted rock keeps 2.30 into the truck
{
  near('till loose density 2.10/1.30', looseOf(MATERIALS.find(m => m.id === 'till')), 2.1 / 1.3, 1e-9);
  near('blasted rock loose density', looseOf(MATERIALS.find(m => m.id === 'blasted')), 2.3, 1e-9);
}
// Grader maintenance on loose snow (firm road RR 2 → min 4.5 %): dedicated grader keeps 40 % of the penalty
{
  const none = resolveRoad({ roadId: 'firm', surfaceId: 'loosesnow', gradingId: 'none' });
  const ded = resolveRoad({ roadId: 'firm', surfaceId: 'loosesnow', gradingId: 'dedicated' });
  if (!(ded.rr < none.rr && ded.mu > none.mu)) { fails++; console.log(`FAIL  grader should lower RR and raise traction (none ${none.rr}/${none.mu}, dedicated ${ded.rr}/${ded.mu})`); }
  else console.log(`PASS  grader: no grader RR ${none.rr.toFixed(2)} % μ ${none.mu.toFixed(2)} → dedicated RR ${ded.rr.toFixed(2)} % μ ${ded.mu.toFixed(2)}`);
}

// Digging face setup (Komatsu 15A-10 conversion factor) — 390F L GP 3.4 m stick, max dig depth 8.68 m, condition C 32 s
{
  const m390 = LOADERS.find(x => x.id === 'cat390fl');
  const base = { jobCond: 'C', conditionId: 'new', digDepthM: 8.68, stickM: 3.4 };
  near('bench 4.5 m → 52 % → factor 1.0', setupFactor({ ...base, setup: 'bench', benchHeightM: 4.5 }).factor, 1.0, 0);
  near('bench 3.0 m → 35 % → factor 0.9', setupFactor({ ...base, setup: 'bench', benchHeightM: 3.0 }).factor, 0.9, 0);
  near('floor → factor 1.1', setupFactor({ ...base, setup: 'floor' }).factor, 1.1, 0);
  near('no setup → factor 1 (old inputs unchanged)', setupFactor(base).factor, 1, 0);
  const ops = { frozenCycleMult: 1.1 };
  near('bench cycle (swing 60°) = 32 s', loaderCycleS({ ...base, setup: 'bench', benchHeightM: 4.5 }, m390, ops, false), 32, 1e-9);
  near('floor cycle (swing 110°) = (32 + 2) × 1.1', loaderCycleS({ ...base, setup: 'floor' }, m390, ops, false), 37.4, 1e-9);
}

// Loading side: single-side counts spot as loader busy time (Excel / MIME 333), double-side does not (Burt & Caccetta)
{
  const mk = side => computeScenario({
    site: { tempC: 10, roadId: 'firm', surfaceId: 'dry', rrOverride: 3, tractionOverride: 0.36, speedLimitKmh: 40, downhillLimitKmh: 30, downhillGradePct: -2 },
    material: { looseTm3: 1.575, fill: 0.95 },
    loaders: [{ modelId: 'cat390fl', count: 1, bucketM3: 5, loadHeightM: 9.1, jobCond: 'C', conditionId: 'good', availability: 1, cycleOverrideS: 30, loadingSide: side }],
    trucks: [{ modelId: 'jd460p', count: 8, conditionId: 'good', availability: 1, bodyFill: 0.9, spotMin: 1.0, dumpMin: 1.067 }],
    profile: { points: csv, segmentM: 250 },
    ops: { shiftH: 11, shiftsPerDay: 1, daysPerYear: 365, jobEff: 1, utilization: 1, passRule: 'third', loadTimeMethod: 'n', travelModel: 'sim', bunching: 1, brakingDecel: 0.6, massFactor: 1.05, hotRetarderDeratePerC: 0.01, idleLF: 0.15 } });
  const s1 = mk('single'), s2 = mk('double');
  near('Excel scenario 1 cycle 23.83 min (same inputs)', s1.trucks[0].ct / 60, 23.83, 0.3);
  near('single-side MF ≈ Excel 1.175', s1.mf, 1.175, 0.02);
  near('double-side MF = 8 × 2.5 / cycle', s2.mf, 8 * 150 / s2.trucks[0].ct, 1e-9);
  near('single-side loader capacity = load × 60 / 3.5 min', s1.prod.loaderCapTph, s1.trucks[0].loadT * 60 / 3.5, 0.5);
}

// Seasonal schedule (Fording River climate)
{
  const { climateMonth, dayMix, monthsFrom, runSchedule } = await import('../js/season.js');
  const nov = m => climateMonth(10, m);
  near('Nov typical snow days = station median 10', nov(0).sn02, 10, 1e-9);
  near('Nov cautious snow days = P90 16', nov(1).sn02, 16, 1e-9);
  near('Nov optimistic temperature = P90 −3.0 °C', nov(-1).tmean, -3.0, 1e-9);
  near('edited median moves the range: Nov snow 20 → cautious 26', climateMonth(10, 1, { 11: { sn02: 20 } }).sn02, 26, 1e-9);
  const mix = dayMix(nov(0), 30);
  near('day types add up to the month', mix.reduce((a, t) => a + t.days, 0), 30, 1e-9);
  near('months Sep 10 → Jan 21: 5 months', monthsFrom('2026-09-10', '2027-01-21').length, 5, 0);
  near('first month starts on the 10th (21 days)', monthsFrom('2026-09-10', '2027-01-21')[0].days, 21, 0);
  const sch = runSchedule({ start: '2026-09-01', targetT: 45000, workFrac: 1, dayTonnes: () => 1000 });
  near('1000 t/day, 45 000 t from Sep 1 → finishes Oct 15', +sch.finish.date.slice(5).replace('-', ''), 1015, 0);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
