// Match Factor Calculator — calculation engine (pure functions, SI units internally).
// Methods follow MIME 333 Ch.3 (Mitri & Sasmito), the Caterpillar Performance Handbook Ed.47,
// the Komatsu Specifications & Application Handbook Ed.32 and Burt & Caccetta (2007, corrigendum 2008).

import { TRUCKS, LOADERS, ROADS, SURFACES, GRADING, CONDITIONS, SETUPS, KOM_CYCLE_FACTOR } from './data/equipment.js?v=202611272100';

export const G = 9.81;
const BETA = 0.268;  // kg fuel / kW·h (MIME 333 formula sheet)
const GAMMA = 0.85;  // kg / L diesel
const CO2_KG_PER_L = 733 * 0.99 * 44 / 12 / 1000; // Cc·OF·44/12 → 2.661 kg CO2 / L

export const byId = (list, id) => list.find(x => x.id === id);

export function interp(table, x) {
  if (!table || !table.length) return 0;
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

// ---------------------------------------------------------------- road & site
// Base road (CAT RR table) → surface condition (wet, mud, snow, ice, thaw) → grader maintenance removes part of the penalty.
export function resolveRoad(site) {
  const road = byId(ROADS, site.roadId) || ROADS[1];
  const w = byId(SURFACES, site.surfaceId ?? site.weatherId) || SURFACES[0];
  const g = byId(GRADING, site.gradingId) || { id: 'n/a', name: 'not set', keep: 1, rrExtra: 0 };
  const rrSet = site.rrOverride != null && site.rrOverride !== '', muSet = site.tractionOverride != null && site.tractionOverride !== '';
  let rr = rrSet ? +site.rrOverride : road.rr;
  let mu = muSet ? +site.tractionOverride : road.traction;
  const rrPenalty = Math.max(road.rr + w.rrAdd, w.rrMin) - road.rr;
  const muSurface = Math.min(road.traction * w.tractionMult, w.tractionMax);
  if (!rrSet) rr = road.rr + rrPenalty * g.keep + g.rrExtra;
  if (!muSet) mu = road.traction - (road.traction - muSurface) * g.keep;
  return { rr, mu, road, weather: w, surface: w, grading: g, rrPenalty, muSurface };
}

// ---------------------------------------------------------------- haul profile
// points: [[distance_m, elevation_m], ...] (already converted from x,y,z if needed)
export function buildSegments(points, { segmentM = 100, reverse = false, loadAreaM = 0, dumpAreaM = 0 } = {}) {
  let pts = points.map(p => [+p[0], +p[1]]).filter(p => isFinite(p[0]) && isFinite(p[1])).sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) throw new Error('Profile needs at least two points.');
  const d0 = pts[0][0];
  pts = pts.map(p => [p[0] - d0, p[1]]);
  const L = pts[pts.length - 1][0];
  if (reverse) pts = pts.map(p => [L - p[0], p[1]]).reverse();
  const n = Math.max(1, Math.round(L / Math.max(5, segmentM)));
  const step = L / n;
  const segs = [];
  let x = 0;
  if (loadAreaM > 0) { segs.push({ x0: -loadAreaM, len: loadAreaM, grade: 0, z0: pts[0][1], zone: 'load area' }); }
  for (let i = 0; i < n; i++) {
    const a = i * step, b = (i + 1) * step;
    const za = interp(pts, a), zb = interp(pts, b);
    segs.push({ x0: a, len: step, grade: (zb - za) / step * 100, z0: za, z1: zb, zone: 'haul road' });
    x = b;
  }
  if (dumpAreaM > 0) { const z = pts[pts.length - 1][1]; segs.push({ x0: L, len: dumpAreaM, grade: 0, z0: z, z1: z, zone: 'dump area' }); }
  segs.forEach(s => { if (s.z1 == null) s.z1 = s.z0; });
  return segs;
}

export function profileFromXYZ(rows) {
  let d = 0; const out = [];
  rows.forEach((r, i) => {
    if (i > 0) d += Math.hypot(r[0] - rows[i - 1][0], r[1] - rows[i - 1][1]);
    out.push([d, r[2]]);
  });
  return out;
}

// ---------------------------------------------------------------- truck performance
function truckForces(truck, gmwKg, ctx) {
  const payloadRatio = Math.max(0, Math.min(1, (gmwKg - truck.emptyKg) / (truck.gmwKg - truck.emptyKg)));
  const drvFrac = truck.driverWeightFracEmpty + (truck.driverWeightFracLoaded - truck.driverWeightFracEmpty) * payloadRatio;
  const tractionN = ctx.mu * gmwKg * G * drvFrac;
  const powerFrac = interp(truck.altitude, ctx.altitudeM) * ctx.powerFactor;
  const rimpullN = v => (v > truck.topSpeedKmh ? 0 : interp(truck.rimpull, v) * 1000 * G * powerFrac);
  const driveN = v => Math.min(rimpullN(v), tractionN);
  // Retarder: CAT curves are rated at 32 °C; above that, assume capacity falls (estimate, editable).
  const heat = 1 - Math.max(0, ctx.tempC - 32) * ctx.hotRetarderDeratePerC;
  const retard = truck.retarder.map(([v, f]) => [v, f * 1000 * G * Math.max(0.3, heat)]);
  return { tractionN, rimpullN, driveN, retard, drvFrac };
}

// Max steady speed (km/h) on a grade, plus the reason that limits it.
export function steadySpeed(truck, gmwKg, gradePct, ctx) {
  const f = truckForces(truck, gmwKg, ctx);
  const tr = ctx.rr + gradePct;
  const R = gmwKg * G * tr / 100;
  let v, reason, flag = null;
  if (tr > 0) {
    if (R > f.tractionN) { flag = 'wheel slip — required rimpull exceeds usable traction'; }
    v = 0;
    for (let s = truck.topSpeedKmh; s >= 0; s -= 0.1) { if (f.driveN(s) >= R) { v = s; break; } }
    reason = 'rimpull';
    if (v <= 0) { v = 1; flag = flag || 'cannot climb — insufficient rimpull'; }
  } else {
    const need = -R;
    let best = 0;
    for (const [vg, fg] of f.retard) if (fg >= need) best = Math.max(best, vg);
    if (best === 0) { const [v1, f1] = f.retard[0]; best = v1 * f1 / need; flag = 'grade beyond retarder chart — service brakes / lower speed required'; }
    v = best; reason = 'retarder';
  }
  if (v >= truck.topSpeedKmh) { v = truck.topSpeedKmh; reason = 'top speed'; }
  if (ctx.speedLimitKmh && v > ctx.speedLimitKmh) { v = ctx.speedLimitKmh; reason = 'speed limit'; }
  if (gradePct < ctx.downhillGradePct && ctx.downhillLimitKmh && v > ctx.downhillLimitKmh) { v = ctx.downhillLimitKmh; reason = 'downhill limit'; }
  return { v, reason, flag, R, tractionN: f.tractionN, rimpullN: f.rimpullN(v) };
}

// Travel over segments. mode 'sim' integrates acceleration/braking; 'steady' = textbook d/v.
// ctx.segAltitude = true → each segment uses its own mean elevation for engine altitude deration.
const segCtx = (ctx, s) => (ctx.segAltitude && s.z0 != null ? { ...ctx, altitudeM: (s.z0 + (s.z1 ?? s.z0)) / 2 } : ctx);
export function travel(truck, gmwKg, segs, ctx) {
  const m = gmwKg * ctx.massFactor;
  const fs = segs.map(s => truckForces(truck, gmwKg, segCtx(ctx, s)));
  const dtEff = truck.driveAxle === 'rear' ? 0.85 : 0.83;
  const out = []; const flags = new Set();
  let totalT = 0, energyKJ = 0, poweredT = 0;
  if (ctx.travelModel === 'steady') {
    for (const s of segs) {
      const ss = steadySpeed(truck, gmwKg, s.grade, segCtx(ctx, s));
      if (ss.flag) flags.add(ss.flag);
      const t = s.len / (ss.v / 3.6);
      const pW = Math.max(0, ss.R) * ss.v / 3.6;
      energyKJ += pW * t / 1000; if (pW > 0) poweredT += t;
      totalT += t;
      out.push({ ...s, vIn: ss.v, vOut: ss.v, vAvg: ss.v, vCap: ss.v, reason: ss.reason, t });
    }
  } else {
    // discretise
    const nodes = []; // {x, segIndex}
    const caps = [];
    segs.forEach((s, i) => {
      const ss = steadySpeed(truck, gmwKg, s.grade, segCtx(ctx, s));
      if (ss.flag) flags.add(ss.flag);
      // uphill: speed emerges from force balance (cap only by top speed / limits); downhill: retarder caps
      let cap = s.grade + ctx.rr > 0 ? Math.min(truck.topSpeedKmh, ctx.speedLimitKmh || 1e9) : ss.v;
      if (s.grade < ctx.downhillGradePct && ctx.downhillLimitKmh) cap = Math.min(cap, ctx.downhillLimitKmh);
      if (s.grade + ctx.rr > 0 && ss.v <= 1) cap = 1;
      s._cap = cap; s._reason = ss.reason;
      const k = Math.max(1, Math.ceil(s.len / 5));
      for (let j = 0; j < k; j++) { nodes.push({ seg: i, dx: s.len / k }); }
    });
    const n = nodes.length;
    const v = new Float64Array(n + 1); // m/s at node boundaries
    v[0] = 0;
    for (let i = 0; i < n; i++) {
      const s = segs[nodes[i].seg], dx = nodes[i].dx;
      const R = gmwKg * G * (ctx.rr + s.grade) / 100;
      const vk = v[i] * 3.6;
      const F = fs[nodes[i].seg].driveN(vk);
      const a = (F - R) / m;
      let vn = Math.sqrt(Math.max(0, v[i] * v[i] + 2 * a * dx));
      const cap = s._cap / 3.6;
      if (vn > cap) vn = cap;
      if (vn < 0.28 && F < R) vn = 0.28; // crawl (≈1 km/h) – flagged above
      v[i + 1] = vn;
    }
    // must stop at end (dump point / loader)
    v[n] = 0;
    for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * ctx.brakingDecel * nodes[i].dx));
    // integrate per segment
    let idx = 0;
    segs.forEach((s, si) => {
      let t = 0; const vIn = v[idx];
      while (idx < n && nodes[idx].seg === si) {
        const dx = nodes[idx].dx, va = Math.max(0.28, (v[idx] + v[idx + 1]) / 2);
        const dt = dx / va; t += dt;
        const R = gmwKg * G * (ctx.rr + s.grade) / 100;
        const acc = (v[idx + 1] * v[idx + 1] - v[idx] * v[idx]) / (2 * dx);
        const Fused = Math.max(0, Math.min(fs[si].driveN(va * 3.6), R + m * acc));
        if (Fused > 0) { energyKJ += Fused * va * dt / 1000; poweredT += dt; }
        idx++;
      }
      totalT += t;
      out.push({ ...s, vIn: vIn * 3.6, vOut: v[idx] * 3.6, vAvg: s.len / t * 3.6, vCap: s._cap, reason: s._reason, t });
    });
  }
  // engine load factor while powered (wheel power / (drivetrain eff × available net power))
  const pAvail = truck.netPowerKw * interp(truck.altitude, ctx.altitudeM) * ctx.powerFactor;
  const poweredLF = poweredT > 0 ? Math.min(1, (energyKJ / poweredT) / (dtEff * pAvail)) : 0;
  const lfTravel = totalT > 0 ? (poweredLF * poweredT + ctx.idleLF * (totalT - poweredT)) / totalT : ctx.idleLF;
  return { t: totalT, segs: out, flags: [...flags], energyKJ, poweredT, loadFactor: lfTravel };
}

// ---------------------------------------------------------------- loading
// Digging-face setup factor (Komatsu 15A-10 conversion factor, relative to the CAT job-condition base = Komatsu 1.0 cell).
// bench: digging depth ≈ bench height below the tracks, truck below → "Normal (large dump target)".
// floor: digging above the tracks (depth row "below 40 %"), lifting over the side of a truck at the same level → "Rather difficult".
export function setupFactor(loader) {
  const st = byId(SETUPS, loader.setup);
  if (!st) return { factor: 1, setup: null };
  const depth = st.id === 'bench' ? Math.max(0, +loader.benchHeightM || 0) : 0;
  const ratio = loader.digDepthM ? depth / loader.digDepthM : 0;
  const row = KOM_CYCLE_FACTOR.rows.find(r => ratio < r.max) || KOM_CYCLE_FACTOR.rows.at(-1);
  const col = KOM_CYCLE_FACTOR.cols.findIndex(c => c.id === st.dumpCol);
  return { factor: KOM_CYCLE_FACTOR.f[row.id][col], setup: st, ratio, row, col: KOM_CYCLE_FACTOR.cols[col] };
}
export const swingOf = loader => {
  if (loader.swingDeg != null && loader.swingDeg !== '') return +loader.swingDeg;
  const st = byId(SETUPS, loader.setup); return st ? st.swingDeg : 90;
};
export function loaderCycleS(loader, model, ops, frozen) {
  if (loader.cycleOverrideS) return +loader.cycleOverrideS;
  const cond = byId(CONDITIONS, loader.conditionId) || CONDITIONS[1];
  const base = model.cycleS[loader.jobCond || 'C'];
  const sw = swingOf(loader);
  const swingAdj = Math.max(0, sw - 90) / 10 - Math.max(0, 60 - sw) / 10; // Komatsu: +1 s per 10° extra swing
  return Math.max(8, (base + swingAdj) * setupFactor(loader).factor * cond.cycleMult * (frozen ? ops.frozenCycleMult : 1));
}

export function passCount(raw, rule) {
  if (rule === 'exact') return raw;
  if (rule === 'up') return Math.max(1, Math.ceil(raw - 1e-9));
  if (rule === 'down') return Math.max(1, Math.floor(raw + 1e-9));
  // Burt & Caccetta rule of thumb: add the last pass only if the remainder ≥ 1/3 bucket
  const fl = Math.floor(raw + 1e-9), rem = raw - fl;
  return Math.max(1, rem >= 1 / 3 ? fl + 1 : fl);
}

export function matchPair(truck, truckIn, loader, model, material, ops) {
  const ff = (loader.fillOverride ? +loader.fillOverride : material.fill) * (material.frozen ? ops.frozenFillMult : 1);
  const bucketM3 = loader.bucketM3 * ff;
  const bucketT = bucketM3 * material.looseTm3;
  const ratedT = (truckIn.payloadKg || truck.ratedPayloadKg) / 1000;
  // body fill factor: share of the SAE 2:1 heaped body volume actually usable (sticky / blocky material, carry-back, spillage)
  const bf = truckIn.bodyFill != null && truckIn.bodyFill !== '' && +truckIn.bodyFill > 0 ? +truckIn.bodyFill : 1;
  const capM3 = truck.heapedM3 * bf;
  const nW = ratedT / bucketT, nV = capM3 / bucketM3;
  const raw = Math.min(nW, nV);
  const governs = nW <= nV ? 'weight' : 'volume';
  const n = passCount(raw, ops.passRule);
  // material beyond the heaped body volume spills, so the carried load is capped by volume
  const actualT = Math.min(n * bucketT, capM3 * material.looseTm3);
  const tc = loaderCycleS(loader, model, ops, material.frozen);
  const loadTimeS = ops.loadTimeMethod === 'komatsu' ? (Math.max(0, n - 1) + ops.firstPassFrac) * tc : n * tc;
  const overloadPct = (actualT / ratedT - 1) * 100;
  // on a bench the truck stands lower by the bench height
  const benchUp = loader.setup === 'bench' ? Math.max(0, +loader.benchHeightM || 0) : 0;
  const heightOk = (loader.loadHeightM || 99) + benchUp >= truck.loadingHeightM + 0.5;
  return { ff, bf, capM3, bucketM3, bucketT, nW, nV, raw, n, governs, loadT: actualT, ratedT, overloadPct, tc, loadTimeS, heightOk, volFillPct: n * bucketM3 / truck.heapedM3 * 100 };
}

// ---------------------------------------------------------------- match factor (Burt & Caccetta, corrected 2008)
// trucks: [{n, ct}], loaders: [{n}], lt[i][j] = loading time of truck type i by loader type j
export function matchFactor(trucks, loaders, lt) {
  const N = trucks.reduce((s, t) => s + t.n, 0);
  if (N <= 0 || loaders.reduce((s, l) => s + l.n, 0) <= 0) return 0;
  const sumCT = trucks.reduce((s, t) => s + t.n * t.ct, 0);
  let lsr = 0;
  loaders.forEach((l, j) => {
    const ltj = trucks.reduce((s, t, i) => s + t.n * lt[i][j], 0);
    if (ltj > 0) lsr += l.n / ltj;
  });
  return N / (lsr * sumCT); // eq. (16) of the corrigendum
}

// ---------------------------------------------------------------- full scenario
export function computeScenario(input) {
  const { site, material, ops } = input;
  const road = resolveRoad(site);
  const warnings = [];
  const segs = buildSegments(input.profile.points, input.profile);
  const haulSegs = segs;
  const returnSegs = [...segs].reverse().map(s => ({ ...s, grade: -s.grade, z0: s.z1, z1: s.z0 }));

  // altitude: from the haul profile unless a fixed site altitude is given
  const altFromProfile = site.altitudeM == null || site.altitudeM === '';
  const meanZ = segs.reduce((a, s) => a + (s.z0 + s.z1) / 2 * s.len, 0) / (segs.reduce((a, s) => a + s.len, 0) || 1);
  const siteAlt = altFromProfile ? meanZ : +site.altitudeM;
  const loadAlt = altFromProfile ? segs[0].z0 : +site.altitudeM;
  const loaders = input.loaders.filter(l => l.count > 0).map(l => {
    const model = byId(LOADERS, l.modelId);
    const cond = byId(CONDITIONS, l.conditionId) || CONDITIONS[1];
    const A = l.availability != null && l.availability !== '' ? +l.availability : cond.availability;
    return { ...l, model, cond, A, power: model.netPowerKw * interp(model.altitude, loadAlt) };
  });
  loaders.forEach(l => {
    if (l.setup === 'bench' && l.stickM && +l.benchHeightM > l.stickM + 0.05) warnings.push(`${l.model.name}: bench height ${(+l.benchHeightM).toFixed(1)} m is more than the stick length (${l.stickM} m). CAT recommends a loading bench about the stick length and never higher; leave the bench height blank to use the stick length.`);
  });
  const trucksIn = input.trucks.filter(t => t.count > 0);
  if (!loaders.length) warnings.push('No loading unit selected.');
  if (!trucksIn.length) warnings.push('No trucks selected.');

  const trucks = trucksIn.map(tIn => {
    const truck = byId(TRUCKS, tIn.modelId);
    const cond = byId(CONDITIONS, tIn.conditionId) || CONDITIONS[1];
    const A = tIn.availability != null && tIn.availability !== '' ? +tIn.availability : cond.availability;
    const ctx = {
      rr: road.rr, mu: road.mu, altitudeM: siteAlt, segAltitude: altFromProfile, tempC: site.tempC, powerFactor: cond.powerFactor,
      speedLimitKmh: site.speedLimitKmh, downhillLimitKmh: site.downhillLimitKmh, downhillGradePct: site.downhillGradePct ?? -3,
      hotRetarderDeratePerC: ops.hotRetarderDeratePerC, massFactor: ops.massFactor, brakingDecel: ops.brakingDecel,
      travelModel: ops.travelModel, idleLF: ops.idleLF,
    };
    const pairs = loaders.map(l => matchPair(truck, tIn, l, l.model, material, ops));
    // weight each loader by its service capacity
    const w = loaders.map((l, j) => l.count * l.A / pairs[j].tc);
    const wsum = w.reduce((a, b) => a + b, 0) || 1;
    const loadT = pairs.reduce((s, p, j) => s + p.loadT * w[j], 0) / wsum;
    const loadTimeS = pairs.reduce((s, p, j) => s + p.loadTimeS * w[j], 0) / wsum;
    pairs.forEach((p, j) => {
      if (p.n > 6 || p.n < 3) warnings.push(`${truck.name} × ${loaders[j].model.name}: ${(+p.n).toFixed(ops.passRule === 'exact' ? 1 : 0)} passes — outside the 3–6 pass range usually recommended.`);
      if (p.overloadPct > 10) warnings.push(`${truck.name} × ${loaders[j].model.name}: payload ${p.overloadPct.toFixed(0)} % over rated (CAT 10/10/20 policy: ≤ 10 % of loads may exceed +10 %).`);
      if (loaders[j].setup === 'bench' && +loaders[j].benchHeightM > 0 && +loaders[j].benchHeightM < truck.loadingHeightM - 1) warnings.push(`${loaders[j].model.name} bench (${(+loaders[j].benchHeightM).toFixed(1)} m) is well below the ${truck.name} rail height (${truck.loadingHeightM.toFixed(1)} m): the bucket still has to lift over the rail — bench ≈ rail height works best.`);
      if (!p.heightOk) warnings.push(`${loaders[j].model.name} bucket loading height may be too low for ${truck.name} (needs ≥ truck loading height + 0.5 m).`);
    });
    const gmwLoaded = truck.emptyKg + loadT * 1000;
    if (gmwLoaded > truck.gmwKg * 1.1) warnings.push(`${truck.name}: loaded weight ${(gmwLoaded / 1000).toFixed(0)} t exceeds max GMW ${(truck.gmwKg / 1000).toFixed(0)} t by more than 10 %.`);
    const haul = travel(truck, gmwLoaded, haulSegs.map(s => ({ ...s })), ctx);
    const ret = travel(truck, truck.emptyKg, returnSegs.map(s => ({ ...s })), ctx);
    haul.flags.forEach(fl => warnings.push(`${truck.name} loaded: ${fl}.`));
    ret.flags.forEach(fl => warnings.push(`${truck.name} empty: ${fl}.`));
    const spotS = (tIn.spotMin ?? truck.defaults.spotMin) * 60;
    const dumpS = (tIn.dumpMin ?? truck.defaults.dumpMin) * 60;
    const ct = spotS + loadTimeS + haul.t + dumpS + ret.t;
    // fuel per cycle
    const pAvail = truck.netPowerKw * interp(truck.altitude, siteAlt) * cond.powerFactor;
    const fuelL = pAvail * BETA / GAMMA * (haul.loadFactor * haul.t + ret.loadFactor * ret.t + ops.idleLF * (spotS + loadTimeS + dumpS)) / 3600;
    return { tIn, truck, cond, A, n: tIn.count, pairs, loadT, loadTimeS, haul, ret, spotS, dumpS, ct, fuelL, gmwLoaded, ctx };
  });

  // loader busy time per truck: single-side loading → the loader waits while the truck spots, so spot counts;
  // double-side loading → the next truck spots while the current one is loaded (Burt & Caccetta: load time only)
  const lt = trucks.map(t => t.pairs.map((p, j) => p.loadTimeS + (loaders[j].loadingSide === 'single' ? t.spotS : 0)));
  const mfNominal = matchFactor(trucks.map(t => ({ n: t.n, ct: t.ct })), loaders.map(l => ({ n: l.count })), lt);
  const mfAvail = matchFactor(trucks.map(t => ({ n: t.n * t.A, ct: t.ct })), loaders.map(l => ({ n: l.count * l.A })), lt);
  const mf = ops.mfUseAvailability ? mfAvail : mfNominal;

  const prod = production(trucks, loaders, lt, ops);
  const Ntot = trucks.reduce((s, t) => s + t.n, 0);
  const avgA = Ntot ? trucks.reduce((s, t) => s + t.n * t.A, 0) / Ntot : 1;
  const trucksForMF1 = mf > 0 ? Ntot / mf : 0;

  // fuel & CO2 (during productive operating time)
  const opFrac = ops.jobEff * ops.utilization * (ops.condFactor ?? 1);
  const truckFuelLph = trucks.reduce((s, t) => s + t.n * t.A * t.fuelL / t.ct * 3600, 0) * opFrac * (ops.truckUtil ?? 1);
  const loaderFuelLph = loaders.reduce((s, l) => s + l.count * l.A * l.power * BETA * l.model.fuelLoadFactor / GAMMA, 0) * opFrac;
  const fuel = {
    truckLph: truckFuelLph, loaderLph: loaderFuelLph,
    lPerT: prod.tph > 0 ? (truckFuelLph + loaderFuelLph) / prod.tph : 0,
    co2KgPerT: prod.tph > 0 ? (truckFuelLph + loaderFuelLph) * CO2_KG_PER_L / prod.tph : 0,
    co2Tph: (truckFuelLph + loaderFuelLph) * CO2_KG_PER_L / 1000,
  };

  return {
    road, segs, trucks, loaders, lt, mf, mfNominal, mfAvail, prod, trucksForMF1, avgA,
    trucksForMF1WithAvail: avgA > 0 ? trucksForMF1 / avgA : 0, fuel, warnings: [...new Set(warnings)],
    totalHaulM: segs.reduce((s, x) => s + x.len, 0), siteAlt, loadAlt, altFromProfile,
  };
}

export function production(trucks, loaders, lt, ops) {
  // truck-only standby (fuelling/service) reduces truck time; loader-stopping standby is in utilization
  const truckRate = trucks.reduce((s, t) => s + t.n * t.A * t.loadT / t.ct, 0) * (ops.bunching ?? 1) * (ops.truckUtil ?? 1); // t/s
  const fleetLoad = trucks.reduce((s, t) => s + t.n * t.A * t.loadT, 0);
  let loaderRate = 0;
  loaders.forEach((l, j) => {
    const ltj = trucks.reduce((s, t, i) => s + t.n * t.A * lt[i][j], 0);
    if (ltj > 0) loaderRate += l.count * l.A / ltj * fleetLoad;
  });
  const theo = Math.min(truckRate, loaderRate);
  const tph = theo * 3600 * ops.jobEff * ops.utilization * (ops.condFactor ?? 1);
  const shiftT = tph * ops.shiftH;
  return {
    truckCapTph: truckRate * 3600, loaderCapTph: loaderRate * 3600, theoTph: theo * 3600, tph,
    shiftT, dayT: shiftT * ops.shiftsPerDay, yearT: shiftT * ops.shiftsPerDay * ops.daysPerYear,
    loaderEff: loaderRate > 0 ? theo / loaderRate : 0, truckEff: truckRate > 0 ? theo / truckRate : 0,
    bottleneck: truckRate < loaderRate ? 'trucks (loaders wait)' : 'loaders (trucks queue)',
  };
}

// Vary the count of one truck type, keeping everything else fixed (cycle times do not change with fleet size).
export function sweepTrucks(result, ops, typeIndex, maxN) {
  const out = [];
  for (let k = 0; k <= maxN; k++) {
    const tr = result.trucks.map((t, i) => ({ ...t, n: i === typeIndex ? k : t.n }));
    if (tr.reduce((s, t) => s + t.n, 0) === 0) { out.push({ k, mf: 0, tph: 0 }); continue; }
    const mf = matchFactor(tr.map(t => ({ n: ops.mfUseAvailability ? t.n * t.A : t.n, ct: t.ct })), result.loaders.map(l => ({ n: ops.mfUseAvailability ? l.count * l.A : l.count })), result.lt);
    const p = production(tr, result.loaders, result.lt, ops);
    out.push({ k, mf, tph: p.tph });
  }
  return out;
}
