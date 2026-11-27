// Run: node tests/engine.test.mjs
import { readFileSync } from 'node:fs';
import { matchFactor, passCount, steadySpeed, computeScenario, buildSegments, interp } from '../js/engine.js';
import { TRUCKS } from '../js/data/equipment.js';

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

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
