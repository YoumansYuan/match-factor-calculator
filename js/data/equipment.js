// Equipment library — all values SI (kg, m, m3, kW, km/h, tonnes-force for curves).
// Every value carries its source. "estimate" flags mean the value is NOT published by the OEM
// and was derived (method stated in `note`). Edit freely; the calculator reads this file at load.

export const SOURCES = {
  CAT47: 'Caterpillar Performance Handbook, Edition 47 (2017)',
  CAT745WEB: 'cat.com — 745 Articulated Truck specifications (current model, Tier 4 Final / Stage V)',
  JD460: 'John Deere 460 P-Tier ADT spec sheet MT460PAU (deere.com)',
  VOLVOA60H: 'Volvo A60H articulated hauler product guide, ref. 20062762_A (volvoce.com)',
  VOLVOA40: 'Volvo A40 articulated hauler product guide, ref. 20064352_D (volvoce.com)',
  JD870: 'John Deere 870 P-Tier excavator spec sheet ME870PAJ (deere.com, 22-08)',
  CAT385C: 'Cat 385C L Hydraulic Excavator specalog',
  KOM32: 'Komatsu Specifications & Application Handbook, Edition 32 (2019) — excavator conversion factor p.15A-10, backhoe vs same-floor loading p.3A-131',
  MIME333: 'McGill MIME 333 Materials Handling — Ch.3 Loading & Haulage Equipment (Mitri & Sasmito)',
  TANNANT: 'Tannant & Regensburg (2001) Guidelines for Mine Haul Road Design',
  BURT: 'Burt & Caccetta (2007) Match factor for heterogeneous truck and loader fleets, IJMRE 21(4); Corrigendum IJMRE 22(1) 2008',
  CATBENCH: 'Caterpillar (2021) Tips for truck loading from a bench, cat.com; Bennink (2006) Optimize earthmover operations, ForConstructionPros',
  TEREX: 'Tegtmeier, Terex O&K — Reaching maximum potential (bench height, slew angle, spotting), Agg-Net',
  LITVIN: 'Litvin & Litvin (2020) Evaluation of effect of the excavator cycle duration on its productivity, E3S Web Conf. 174, 01010',
  MOLAEI: 'Molaei, Geimer & Kolu (2023) Evaluation of deterministic models for the excavator\'s theoretical productivity estimation, EC3 2023 (reproduces the Komatsu conversion-factor table)',
};

// Curves: rimpull = array of [speed km/h, rimpull tonnes-force (x1000 kgf)] — upper envelope of all gears, sea level.
// retarder = array of [max speed km/h in that gear, continuous retarding force tonnes-force] (step curve).
export const TRUCKS = [
  {
    id: 'cat777e',
    name: 'CAT 777E',
    type: 'Rigid off-highway truck',
    emptyKg: 70753, // chassis 49 088 + body 16 070 + std liner 5 595 (Handbook key "E")
    ratedPayloadKg: 92607, // Target payload with standard liner; payload without liner = 98 202 kg
    payloadNoLinerKg: 98202,
    gmwKg: 163360,
    heapedM3: 60.2, // SAE 2:1
    struckM3: 42.0,
    netPowerKw: 708,
    grossPowerKw: 758,
    topSpeedKmh: 65.0,
    gears: 7,
    driveAxle: 'rear',
    driverWeightFracEmpty: 0.541, // rear axle share, empty
    driverWeightFracLoaded: 0.696, // rear axle share, loaded
    loadingHeightM: 4.39,
    tires: '27.00R49 (E4)',
    fuelTankL: 1137,
    rimpull: [[0, 58], [3, 47], [5, 37], [6.6, 28], [8.5, 23], [9.5, 21], [11.5, 16.5], [13, 14.5], [15.6, 12], [18, 10.5], [21, 9.0], [25, 7.6], [28, 6.8], [32, 6.0], [36, 5.4], [40, 4.9], [46, 4.3], [52, 3.9], [58, 3.4], [62, 2.8], [65, 1.4]],
    retarder: [[10.8, 34.7], [14.5, 23.5], [19.8, 17.8], [26.3, 13.0], [36.0, 9.6], [48.7, 7.1], [65.0, 5.3]],
    altitude: [[0, 1], [3000, 1], [3800, 0.9975], [4600, 0.95]], // fraction of flywheel power (777E3 row)
    defaults: { spotMin: 0.7, dumpMin: 1.1 }, // CAT typical fixed times: exchange 0.6–0.8, maneuver+dump 1.0–1.2 min
    src: {
      specs: 'CAT47 p.10-12 (777E Medium Impact Steel body)',
      rimpull: 'CAT47 p.10-49 Rimpull-Speed-Gradeability (digitised envelope of gears 1A–7; check: 708 kW × 0.85 / v agrees within ~10 %)',
      retarder: 'CAT47 p.10-50 Brake Performance, continuous grade retarding (digitised; ≈ 940 kW continuous)',
      altitude: 'CAT47 p.30-12 Altitude Deration table',
      fixed: 'CAT47 p.10-20 Typical Fixed Times for Hauling Units',
    },
    estimate: {},
  },
  {
    id: 'cat745',
    name: 'CAT 745',
    type: 'Articulated truck (6×6)',
    emptyKg: 33110,
    ratedPayloadKg: 41000,
    gmwKg: 74110,
    heapedM3: 26.0, // SAE 2:1 (tailgate heaped 27.3)
    struckM3: 19.9,
    tailgateHeapedM3: 27.3,
    netPowerKw: 370,
    grossPowerKw: 381,
    topSpeedKmh: 54.8,
    gears: 9,
    gearSpeedsKmh: [6.1, 8.1, 11.2, 14.1, 18.7, 22.9, 31.5, 37.9, 54.8],
    driveAxle: 'all (6×6)',
    driverWeightFracEmpty: 1.0,
    driverWeightFracLoaded: 1.0,
    loadingHeightM: 3.10, // 745C value; current-model loading height not published on cat.com
    bodyRaiseS: 12,
    bodyLowerS: 10,
    tires: '29.5R25 radial (×6)',
    fuelTankL: 550,
    rimpull: [[0, 44], [1, 40], [2.5, 32], [3.6, 27.5], [5, 20], [7.3, 15], [10, 10.5], [13, 8.5], [16, 7.0], [20, 6.0], [23, 5.0], [28, 4.3], [35, 3.3], [40, 2.7], [50, 2.0], [54.8, 1.3]],
    retarder: [[6.4, 30.0], [8.5, 22.3], [11.9, 16.8], [15.1, 12.7], [19.8, 9.3], [24.0, 8.0], [33.1, 5.9], [39.9, 4.8], [54.8, 3.6]],
    altitude: [[0, 1], [3050, 1], [4600, 0.85]], // no derate below 3050 m (cat.com); above 3050 m is an estimate
    defaults: { spotMin: 0.6, dumpMin: 1.0 },
    matching: 'cat.com lists optimal pass match: 390 excavator = 4 passes, 374 = 5 passes',
    src: {
      specs: 'CAT745WEB (weights, capacities, power, gear speeds, hoist times)',
      rimpull: 'CAT47 p.1-29 745C Rimpull-Speed-Gradeability, Tier 4 Final (same C18 engine, 41 t payload) — digitised',
      retarder: 'CAT47 p.1-30 745C Brake/Retarder Performance — digitised (≈ 550 kW continuous)',
      altitude: 'CAT745WEB: "No engine de-rating required below 3050 m"',
    },
    estimate: { curves: 'Curves taken from the 745C (previous generation, same engine & payload class).', altitudeAbove3050: true },
  },
  {
    id: 'jd460p',
    name: 'John Deere 460 P-Tier',
    type: 'Articulated dump truck (6×6)',
    emptyKg: 31700,
    ratedPayloadKg: 41820,
    gmwKg: 73520,
    heapedM3: 25.2, // ISO 6483 2:1 (27.0 with optional tailgate)
    struckM3: 19.5,
    tailgateHeapedM3: 27.0,
    netPowerKw: 359,
    grossPowerKw: null,
    topSpeedKmh: 55,
    gears: 8,
    gearSpeedsKmh: [6, 8, 11, 16, 23, 32, 45, 55],
    driveAxle: 'all (6×6)',
    driverWeightFracEmpty: 1.0,
    driverWeightFracLoaded: 1.0,
    loadingHeightM: 3.34, // dump body side-rail height
    bodyRaiseS: 12,
    bodyLowerS: 7,
    tires: '29.5R25 radial (×6)',
    fuelTankL: 609,
    // Not published by Deere — generated: F = 0.83 × 359 kW / v, capped at 0.59 × GMW (stall), top speed 55 km/h.
    // 0.83 drivetrain factor and 0.59 stall ratio were fitted to the digitised CAT 745C curve (same class).
    rimpull: null, // generated at load time, see buildGeneratedCurves()
    retarder: null, // generated: ≈ 550 kW continuous at JD gear speeds (CAT 745C class), capped at 30 t
    altitude: [[0, 1], [3000, 1], [4600, 0.85]],
    defaults: { spotMin: 0.6, dumpMin: 1.0 },
    src: {
      specs: 'JD460 (payload, capacities, weights, net power 359 kW @1700 rpm, gear speeds, hoist times)',
      rimpull: 'Generated from published power (Deere does not publish a rimpull chart)',
      retarder: 'Generated (assumed same continuous retarding class as CAT 745C)',
      altitude: 'Not published — assumed no derate below 3000 m',
    },
    estimate: { rimpull: true, retarder: true, altitude: true },
  },
  {
    id: 'volvoa40',
    name: 'Volvo A40',
    type: 'Articulated dump truck (6×6)',
    emptyKg: 31400,
    ratedPayloadKg: 39000,
    gmwKg: 70310,
    heapedM3: 24.0, // 2:1 heaped, standard body
    struckM3: 18.7,
    tailgateHeapedM3: 25.1,
    netPowerKw: 347,
    grossPowerKw: 350,
    topSpeedKmh: 57,
    gears: 9,
    gearSpeedsKmh: [5.8, 8.5, 10.4, 15.0, 21.6, 27.3, 36.1, 47.8, 57.0],
    driveAxle: 'all (6×6, automatic 6×4/6×6)',
    driverWeightFracEmpty: 1.0,
    driverWeightFracLoaded: 1.0,
    loadingHeightM: 3.25,
    bodyRaiseS: 12,
    bodyLowerS: 10,
    tires: '29.5R25',
    rimpull: null, // generated from net power (Volvo publishes no rimpull chart), see buildGeneratedCurves()
    retarder: null,
    retarderKw: 540,
    altitude: [[0, 1], [3000, 1], [4600, 0.85]],
    defaults: { spotMin: 0.6, dumpMin: 1.0 },
    src: { specs: 'VOLVOA40 product guide 20064352_D (current A40): D13J 350 kW gross @1800 rpm, payload 39 000 kg, empty 31 400 kg, loaded 70 310 kg, body 18.7 / 24.0 m³ (25.1 with tailgate), 9 gears 5.8–57 km/h, tipping 12 s / lowering 10 s', rimpull: 'Generated from net power (not published by Volvo)', retarder: 'Generated: ≈ 540 kW continuous (CAT 745C class) — Volvo gives no figure', altitude: 'Not published — assumed no derate below 3000 m' },
    estimate: { rimpull: true, retarder: true, altitude: true, netPower: 'Net power not published — 347 kW assumed (gross 350 kW × 0.99, same ratio as the A60H).', loadingHeight: 'Loading height not in the Volvo product guide — ≈ 3.25 m estimated (A40 class); check against the dealer drawing.' },
  },
  {
    id: 'volvoa60h',
    name: 'Volvo A60H',
    type: 'Articulated dump truck (6×6)',
    emptyKg: 43750,
    ratedPayloadKg: 55000,
    gmwKg: 98750,
    heapedM3: 33.6, // 2:1 heaped, standard body
    struckM3: 25.8,
    tailgateHeapedM3: 35.1,
    netPowerKw: 467,
    grossPowerKw: 470,
    topSpeedKmh: 55,
    gears: 6,
    gearSpeedsKmh: [7, 10, 13, 19, 26, 55],
    driveAxle: 'all (6×6, automatic 6×4/6×6)',
    driverWeightFracEmpty: 1.0,
    driverWeightFracLoaded: 1.0,
    loadingHeightM: 3.65,
    bodyRaiseS: 13,
    bodyLowerS: 10,
    tires: '33.25R29',
    rimpull: null, // generated from net power (Volvo publishes no rimpull chart), see buildGeneratedCurves()
    retarder: null,
    retarderKw: 715,
    altitude: [[0, 1], [3000, 1], [4600, 0.85]],
    defaults: { spotMin: 0.6, dumpMin: 1.0 },
    src: { specs: 'VOLVOA60H product guide 20062762_A: D16J 467 kW net @1800 rpm, payload 55 000 kg, empty 43 750 kg, loaded 98 750 kg, body 25.8 / 33.6 m³ (35.1 with tailgate), gears 7–55 km/h, tipping 13 s / lowering 10 s', rimpull: 'Generated from published net power (not published by Volvo)', retarder: 'Generated: ≈ 715 kW continuous (CAT 745C class 550 kW scaled by engine power) — Volvo gives no figure for its engine brake', altitude: 'Not published — assumed no derate below 3000 m' },
    estimate: { rimpull: true, retarder: true, altitude: true, loadingHeight: 'Loading height not in the Volvo product guide — ≈ 3.65 m estimated from body size; check against the dealer drawing.' },
  },
];

export const LOADERS = [
  {
    id: 'cat390fl',
    name: 'CAT 390F L',
    type: 'Hydraulic excavator (backhoe)',
    netPowerKw: 391,
    operatingWeightKg: [86033, 92022],
    engine: 'Cat C18 ACERT',
    swingRpm: null,
    buckets: [ // heaped SAE capacity, max loading height with teeth (range dimension "A")
      { id: 'gd39', label: 'GD 3.9 m³ (Reach boom, R4.4 stick)', m3: 3.9, loadHeightM: 10.53, digDepthM: 10.70, stickM: 4.4 },
      { id: 'sd46', label: 'SD 4.6 m³ (GP boom, 3.4 m stick)', m3: 4.6, loadHeightM: 9.10, digDepthM: 8.68, stickM: 3.4 },
      { id: 'gd46', label: 'GD 4.6 m³ (GP boom, 4.4 m stick)', m3: 4.6, loadHeightM: 9.28, digDepthM: 9.65, stickM: 4.4 },
      { id: 'hc53', label: 'HC 5.3 m³ (High capacity)', m3: 5.3, loadHeightM: 9.10, digDepthM: 8.68, stickM: 3.4 },
      { id: 'sdv60', label: 'SDV 6.0 m³ (Mass boom, 2.92 m stick)', m3: 6.0, loadHeightM: 7.99, digDepthM: 7.16, stickM: 2.92 },
      { id: 'hc65', label: 'HC 6.5 m³ (High capacity, light material)', m3: 6.5, loadHeightM: 7.99, digDepthM: 7.16, stickM: 2.92 },
    ],
    defaultBucket: 'sd46',
    // Total cycle time (s) by CAT job condition A (excellent) … E (severe), 60–90° swing, average operator.
    cycleS: { A: 24, B: 28, C: 32, D: 38, E: 45 },
    altitude: [[0, 1], [3800, 1], [4600, 0.97]],
    fuelLoadFactor: 0.55,
    src: {
      specs: 'CAT47 p.7-40 (engine power, operating weight); p.7-116 range dimensions (A loading height, C max digging depth, stick length); p.7-178 bucket list',
      cycle: 'CAT47 p.7-246/7-248 Cycle Time Estimating Chart (385C class: fastest ≈ 0.42 min, typical 0.58–0.75 min); cross-checked with Komatsu PC800–PC1250 standard cycles (KOM32 p.15A-10)',
      altitude: 'CAT47 p.30-10 Altitude Deration (390F L1/L2/L3 rows)',
    },
    estimate: { cycle: 'Per-condition cycle times interpolated from the handbook chart bands.', digDepth: 'HC 5.3 / HC 6.5 digging depth taken from the GP 3.4 m / Mass 2.92 m stick rows.' },
  },
  {
    id: 'cat385cl',
    name: 'CAT 385C L',
    type: 'Hydraulic excavator (backhoe)',
    netPowerKw: 382,
    operatingWeightKg: [84980, 84980],
    engine: 'Cat C18 ACERT',
    swingRpm: 6.5,
    buckets: [
      { id: 'hb46', label: 'GP 4.6 m³ (HB family)', m3: 4.6, loadHeightM: 9.1, digDepthM: 8.7, stickM: 3.4 },
      { id: 'jb45', label: 'HD Rock 4.5 m³ (JB family)', m3: 4.5, loadHeightM: 9.1, digDepthM: 8.7, stickM: 3.4 },
      { id: 'jb58', label: 'GP 5.8 m³ (JB family)', m3: 5.8, loadHeightM: 8.0, digDepthM: 7.2, stickM: 2.92 },
      { id: 'hb38', label: '3.8 m³ (HB family)', m3: 3.8, loadHeightM: 10.5, digDepthM: 10.7, stickM: 4.4 },
    ],
    defaultBucket: 'hb46',
    cycleS: { A: 24, B: 28, C: 32, D: 38, E: 45 },
    altitude: [[0, 1], [3000, 1], [4600, 0.9]],
    fuelLoadFactor: 0.55,
    src: {
      specs: 'CAT385C specalog (382 kW, 84 980 kg, buckets 2.0–5.8 m³, swing 6.5 rpm); CAT47 p.7-196 digging forces',
      cycle: 'CAT47 p.7-248 Cycle Time Estimating Chart, 385C column',
      altitude: 'Not in CAT47 deration table — assumed same C18 behaviour (no derate below 3000 m)',
    },
    estimate: { loadHeight: 'Loading heights, digging depths and stick lengths assumed equal to the 390F L equivalent boom/stick (same front-linkage family).', altitude: true, cycle: true },
  },
  {
    id: 'jd870p',
    name: 'John Deere 870 P-Tier',
    type: 'Hydraulic excavator (backhoe)',
    netPowerKw: 382,
    operatingWeightKg: [85600, 85600],
    engine: 'Isuzu 6WG1 (15.7 L), FT4',
    swingRpm: 7.8,
    buckets: [ // max dumping height = loading height; digging depth and arm length per boom/arm from the Deere spec sheet
      { id: 'b44', label: '3.49 m³ (8.4 m boom, 4.4 m arm) — Deere standard', m3: 3.49, loadHeightM: 9.74, digDepthM: 9.57, stickM: 4.4 },
      { id: 'b37', label: '4.0 m³ (8.4 m boom, 3.7 m arm)', m3: 4.0, loadHeightM: 9.08, digDepthM: 8.87, stickM: 3.7 },
      { id: 'me295', label: '4.6 m³ (7.1 m ME boom, 2.95 m ME arm)', m3: 4.6, loadHeightM: 8.13, digDepthM: 7.14, stickM: 2.95 },
      { id: 'r44', label: '2.7 m³ (10.0 m reach boom, 4.4 m arm)', m3: 2.7, loadHeightM: 10.81, digDepthM: 11.16, stickM: 4.4 },
    ],
    defaultBucket: 'b37',
    cycleS: { A: 24, B: 28, C: 32, D: 38, E: 45 },
    altitude: [[0, 1], [3000, 1], [4600, 0.9]],
    fuelLoadFactor: 0.55,
    src: {
      specs: 'JD870 spec sheet ME870PAJ (22-08): 382 kW net @1800 rpm, 85 600 kg, swing 7.8 rpm; max digging depth / max dumping height for 8.4/3.7, 8.4/4.4, 7.1 ME/2.95 ME and 10.0/4.4 boom/arm',
      cycle: 'Same class as CAT 390F L (382 vs 391 kW, 85.6 vs 86 t) — CAT47 p.7-246/7-248 cycle bands used',
      altitude: 'Not published — assumed no derate below 3000 m',
    },
    estimate: { buckets: 'Deere lists only the 3.49 m³ bucket (4.4 m arm); the 4.0, 4.6 (ME) and 2.7 m³ (reach) sizes are typical for this class — check with the dealer.', cycle: true, altitude: true },
  },
];

// Materials — entered as density at the dig face + swell from dig face to truck.
// loose (in-truck) density = dig-face density / (1 + swell). For blasted rock the muck pile has already swollen,
// so dig-face density = loose density and swell = 0; bank (pre-blast) density is entered separately for BCM.
export const MATERIALS = [
  { id: 'blasted', name: 'Blasted Rock', digTm3: 2.30, swellPct: 0, bankTm3: 2.99, fill: 0.85, blasted: true, src: 'Muck-pile density 2.3 t/m³ per user (already swollen by blasting, so no further swell into the truck). Solid rock before blast 2.99 t/m³ = 2.3 × 1.30 (30 % blast swell) — replace with site value. Fill factor: average blasted rock 75–90 % (CAT47 p.30-2 / MIME 333 Table 3.3).' },
  { id: 'overburden', name: 'Overburden', digTm3: 2.28, swellPct: 33, fill: 0.90, src: 'CAT47 p.30-6 "Decomposed rock 50 % rock / 50 % earth": bank 2 280, loose 1 720 kg/m³ (swell 33 %).' },
  { id: 'soil', name: 'Soil', digTm3: 2.02, swellPct: 26, fill: 1.00, src: 'CAT47 p.30-6 "Earth — wet excavated": bank 2 020, loose 1 600 kg/m³ (swell 26 %). Fill: moist loam 100–110 %.' },
  { id: 'till', name: 'Till (glacial)', digTm3: 2.10, swellPct: 30, fill: 0.90, src: 'Glacial till in-situ 2.1 t/m³, swell 30 % (site planning value set by the user 2026-11-27 — estimate — not in CAT table; nearest "Clay & gravel"). Fill: "Soil, boulders, roots" 80–100 %. Verify with site tests.' },
  { id: 'rehandle', name: 'Rehandle (blasted rock)', digTm3: 2.30, swellPct: 0, bankTm3: 2.99, fill: 0.90, blasted: true, rehandle: true, src: 'Blasted rock that has already been dumped once (stockpile / temporary dump) and is moved again: loose density 2.3 t/m³ per user, no further swell. Fill factor 0.9 (loosened, no digging out of the muck pile; Komatsu 15A-9 "well blasted rock" 0.90–0.95 for shovels) — estimate.' },
  { id: 'coal', name: 'Coal', digTm3: 1.75, swellPct: 35, fill: 0.95, src: 'Loose density 1.3 t/m³ per user; swell 35 % from CAT47 bituminous load factor 0.74 → in-situ ≈ 1.75 t/m³.' },
];
export const looseOf = m => (+m.digTm3) / (1 + (+m.swellPct || 0) / 100);

// Road surfaces — rolling resistance (% of GMW, radial tyres) and rubber-tyre traction coefficient.
export const ROADS = [
  { id: 'hard', name: 'Very hard, smooth — stabilised, watered, maintained', rr: 1.7, traction: 0.65 },
  { id: 'firm', name: 'Firm, smooth dirt road, flexes slightly, regularly maintained', rr: 2.5, traction: 0.55 },
  { id: 'rut25', name: 'Dirt road, rutted, little maintenance, 25 mm tyre penetration', rr: 4.0, traction: 0.50 },
  { id: 'rut50', name: 'Dirt road, rutted, 50 mm tyre penetration', rr: 5.0, traction: 0.45 },
  { id: 'soft100', name: 'Rutted, soft, no maintenance, 100 mm penetration', rr: 8.0, traction: 0.40 },
  { id: 'loose', name: 'Loose sand or gravel', rr: 10.0, traction: 0.36 },
  { id: 'soft200', name: 'Rutted, soft, 200 mm penetration', rr: 14.0, traction: 0.40 },
  { id: 'mud', name: 'Very soft, muddy, rutted, 300 mm penetration', rr: 20.0, traction: 0.30 },
];
export const ROAD_SRC = 'Rolling resistance: CAT47 p.30-2 Typical Rolling Resistance Factors (radial tyres). Traction: CAT47 p.30-3 / MIME 333 Table 3.5.';

// Road surface condition modifies the base road: penalty = max(rr + rrAdd, rrMin) − rr; traction = min(μ × tractionMult, tractionMax).
// Grading then removes part of that penalty (see GRADING).
export const SURFACES = [
  { id: 'dry', name: 'Dry', rrAdd: 0, rrMin: 0, tractionMult: 1, tractionMax: 1, note: '' },
  { id: 'wet', name: 'Wet', rrAdd: 1.5, rrMin: 0, tractionMult: 0.82, tractionMax: 1, note: 'Clay loam dry 0.55 → wet 0.45 (CAT47); wet muddy surface on firm base ≈ 4 % RR (Tannant 2001). +1.5 % RR is an estimate.' },
  { id: 'muddy', name: 'Muddy', rrAdd: 4.0, rrMin: 0, tractionMult: 0.7, tractionMax: 0.4, note: 'Mud on the running surface: RR +4 %, traction ≈ 0.35–0.45 (estimate from CAT47 rutted/soft rows and Tannant 2001).' },
  { id: 'packedsnow', name: 'Packed snow', rrAdd: 0, rrMin: 2.5, tractionMult: 1, tractionMax: 0.25, note: 'Packed snow RR 2.5 %; traction 0.20 (CAT) – 0.55 (Tannant).' },
  { id: 'loosesnow', name: 'Loose snow', rrAdd: 0, rrMin: 4.5, tractionMult: 1, tractionMax: 0.18, note: 'Loose snow RR 4.5 % (Caterpillar 1988, in Tannant 2001); traction 0.10–0.25.' },
  { id: 'ice', name: 'Ice', rrAdd: 0, rrMin: 0, tractionMult: 1, tractionMax: 0.12, note: 'Ice traction 0.12 (CAT47); wet ice 0.05–0.10 (Tannant).' },
  { id: 'thaw', name: 'Spring thaw / break-up', rrAdd: 3.0, rrMin: 0, tractionMult: 0.85, tractionMax: 0.45, note: 'Spring break-up is a leading cause of road failure in Canadian mines (Tannant 2001). +3 % RR is an estimate.' },
];

// Grader maintenance: share of the surface penalty that remains, and extra RR from ruts/spillage building up. Planning estimates.
export const GRADING = [
  { id: 'none', name: 'No grader', keep: 1.0, rrExtra: 1.0, note: 'Ruts, spillage and windrows build up through the shift (+1 % RR).' },
  { id: 'shift', name: 'Graded once per shift', keep: 0.7, rrExtra: 0.3, note: 'Removes about 30 % of the snow/mud penalty on average over the shift.' },
  { id: 'dedicated', name: 'Dedicated grader on the haul road', keep: 0.4, rrExtra: 0, note: 'Continuous clean-up of snow, mud and spillage (Tannant 2001 stresses routine grading).' },
];

// Weather = sky & visibility. Speed cap applies to the whole haul; efficiency multiplies production once.
export const SKY = [
  { id: 'clear', name: 'Clear', capKmh: 0, eff: 1.0, surface: 'dry', note: '' },
  { id: 'overcast', name: 'Overcast', capKmh: 0, eff: 1.0, surface: null, note: '' },
  { id: 'rain', name: 'Rain', capKmh: 45, eff: 0.97, surface: 'wet', note: 'Reduced visibility and wiper use; usually wets the road.' },
  { id: 'snowing', name: 'Snowing', capKmh: 35, eff: 0.92, surface: 'loosesnow', note: 'Falling snow cuts visibility; usually loose snow on the road.' },
  { id: 'fog', name: 'Fog', capKmh: 25, eff: 0.85, surface: null, note: 'Visibility below ~100 m: trucks slow right down and spacing increases.' },
];
export const VIS_SRC = 'Weather, dust and darkness factors are planning estimates (no OEM data). Edit them under Detailed → Operations → Advanced assumptions if your site has time-study data.';

// Approximate monthly mean air temperature (°C), Elk Valley BC (Sparwood area). Used only as a default.
export const MONTHLY_TEMP_C = [-8, -5, 0, 5, 10, 14, 17, 16, 11, 5, -2, -7];

// Digging face setup (where the excavator stands relative to the truck).
// Cycle-time factor from the Komatsu Performance Handbook "Conversion factor for excavator" (KOM p.15A-10):
// rows = digging depth / specified max digging depth, columns = dumping condition.
// The CAT job-condition cycle times used as the base correspond to the Komatsu 1.0 cell (CAT C: depth to 50 %, swing to 60°,
// large dump target), so the Komatsu factor is applied as a ratio to that cell.
export const KOM_CYCLE_FACTOR = {
  rows: [{ id: 'lt40', name: 'Below 40 %', max: 0.40 }, { id: '40to75', name: '40–75 %', max: 0.75 }, { id: 'gt75', name: 'Over 75 %', max: Infinity }],
  cols: [{ id: 'easy', name: 'Easy (dump onto spoil pile)' }, { id: 'normal', name: 'Normal (large dump target)' }, { id: 'rather', name: 'Rather difficult (small dump target)' }, { id: 'difficult', name: 'Difficult (small target, maximum dumping reach)' }],
  f: { lt40: [0.7, 0.9, 1.1, 1.4], '40to75': [0.8, 1.0, 1.3, 1.6], gt75: [0.9, 1.1, 1.5, 1.8] },
  src: 'Komatsu Performance Handbook (MIME 333 copy) p.15A-10 "Conversion factor for excavator"; also reproduced in Molaei, Geimer & Kolu (2023), EC3 Heraklion, Table 4.',
};
// How trucks are positioned at the excavator. Single side: the excavator waits while each truck backs in (spot),
// so spot is loader busy time (MIME 333 Ch.3 "shovel loading time" = spot + load). Double side: the next truck spots on
// the other side while the current one is loaded, so the loader is busy only for the load (Burt & Caccetta 2007/2008).
export const LOADING_SIDES = [
  { id: 'single', name: 'Single side (excavator waits while each truck spots)', short: 'single-side', note: 'Trucks are loaded on one side only: the excavator waits while each truck turns and backs in, so the spot time counts as excavator time in the match factor and excavator capacity (MIME 333 "shovel loading time" = spot + load).' },
  { id: 'double', name: 'Double side (next truck spots while one is loaded)', short: 'double-side', note: 'Trucks are loaded on both sides: the next truck spots while the current one is loaded, so the excavator is busy only for the loading passes (Burt & Caccetta). Needs room at the face for two trucks.' },
];

export const SETUPS = [
  { id: 'bench', name: 'On a bench above the truck (top loading)', short: 'On bench', swingDeg: 60, dumpCol: 'normal',
    note: 'Excavator digs the face below its tracks (digging depth ≈ bench height) and dumps down into a truck on the lower level: low lift, good view of the body, short swing. Bench ≈ truck rail height and not higher than the stick length (CAT; Terex O&K). Komatsu 3A-131: for backhoes the bench should not exceed the dump-body height for efficient loading.' },
  { id: 'floor', name: 'On the floor, same level as the truck', short: 'On floor', swingDeg: 110, dumpCol: 'rather',
    note: 'Excavator digs material above its tracks and must lift every bucket over the side of a truck standing at the same level. Komatsu 3A-131: "requires a larger swing angle, cycle time is longer. Also, fuel consumption increases due to higher lift." Litvin & Litvin (2020): same-level loading is less productive than loading a truck below the excavator.' },
];

// Machine condition presets (age / reliability). All values are planning estimates — edit per site data.
export const CONDITIONS = [
  { id: 'new', name: 'New', availability: 0.92, powerFactor: 1.00, cycleMult: 1.00 },
  { id: 'good', name: 'Good', availability: 0.88, powerFactor: 0.97, cycleMult: 1.03 },
  { id: 'average', name: 'Average', availability: 0.83, powerFactor: 0.94, cycleMult: 1.07 },
  { id: 'worn', name: 'Worn', availability: 0.75, powerFactor: 0.90, cycleMult: 1.12 },
];

export const JOB_CONDITIONS = [
  { id: 'A', name: 'A — Excellent: easy digging, swing < 30°, no obstructions' },
  { id: 'B', name: 'B — Above average: packed earth / dry clay, swing to 60°' },
  { id: 'C', name: 'C — Average: hard packed soil, ≤ 50 % rock, swing to 90°' },
  { id: 'D', name: 'D — Below average: shot rock / tough soil ≤ 75 % rock, swing to 120°' },
  { id: 'E', name: 'E — Severe: sandstone, caliche, hard frost, swing > 120°' },
];

// Generate curves that OEMs do not publish (JD 460 P-Tier), using the method fitted on CAT 745C.
export function buildGeneratedCurves() {
  for (const t of TRUCKS) {
    if (!t.rimpull) {
      const eta = 0.83;
      const fmax = 0.59 * t.gmwKg / 1000; // tonnes-force at stall
      const speeds = [0, 2, 4, 6, 8, 11, 16, 23, 32, 45, t.topSpeedKmh];
      t.rimpull = speeds.map(v => {
        if (v === 0) return [0, +fmax.toFixed(1)];
        const fkN = eta * t.netPowerKw / (v / 3.6);
        return [v, +Math.min(fmax, fkN / 9.81).toFixed(2)];
      });
    }
    if (!t.retarder) {
      const pret = t.retarderKw || 550; // kW continuous
      t.retarder = t.gearSpeedsKmh.map(v => [v, +Math.min(30, pret / (v / 3.6) / 9.81).toFixed(2)]);
    }
  }
}
buildGeneratedCurves();
