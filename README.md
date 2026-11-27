# Match Factor Calculator

A browser-based truck–loader **match factor**, haul-cycle and fleet-production calculator for surface mines.
Pick equipment from a menu, set site, road, weather and machine-condition inputs, upload a haul-road elevation profile, and the tool works out passes, loading time, segment-by-segment travel speeds from OEM rimpull/retarder curves, cycle time, match factor (including mixed fleets), production, required fleet size, fuel and CO₂.

**Live site:** https://youmansyuan.github.io/match-factor-calculator/

## Features

- **Equipment library** (v1): CAT 390F L and CAT 385C L excavators; CAT 777E, CAT 745 and John Deere 460 P-Tier trucks — every value carries its source; non-published values are flagged as estimates.
- **Mixed fleets** — any number of truck and loader types, using the corrected heterogeneous match factor of Burt & Caccetta (2007, corrigendum 2008).
- **Haul profile upload** — CSV of `distance, elevation` or `x, y, z` polyline (Minesite / Vulcan / Deswik export). Resampled to equal segments to remove digitising noise.
- **Travel model** — rimpull-limited acceleration, retarder-limited descent, traction (wheel-slip) check, speed limits, altitude derating, with a textbook "steady speed" mode for checking hand calculations.
- **Site conditions** — road surface (rolling resistance & traction), weather (wet, packed/loose snow, ice, spring thaw), temperature (retarder heat derate), frozen material.
- **Machine condition** — New / Good / Average / Worn presets for availability, engine power and loader cycle.
- **Outputs** — MF with interpretation, production per hour/shift/day/year, trucks needed for MF = 1, cycle breakdown, speed profile, fleet-size sensitivity chart, fuel (L/t) and CO₂ (kg/t), CSV export, scenario save/open, print.
- Metric / Imperial toggle.

## Method

See the **Method & Sources** tab in the app. Primary references: McGill MIME 333 Materials Handling (Ch.3 Loading & Haulage Equipment, formula sheet), Caterpillar Performance Handbook Ed.47, Komatsu Specifications & Application Handbook Ed.32, Tannant & Regensburg (2001) *Guidelines for Mine Haul Road Design*, Burt & Caccetta (2007/2008).

## Validation

```
node tests/engine.test.mjs
```

Reproduces: MIME 333 Ch.3 heterogeneous-truck example (MF 1.125), Burt & Caccetta heterogeneous-loader example (0.88) and corrected fully-heterogeneous example (0.928), MIME 333 Tutorial 1, the ⅓-bucket pass rule, and 777E chart readings for climbing and retarding.

## Project layout

```
index.html            app shell
css/styles.css        styles (light/dark)
js/app.js             UI, binding, charts, import/export
js/engine.js          calculation engine (pure functions, SI units)
js/units.js           metric / imperial conversion
js/docs.js            Equipment Data and Method tabs
js/data/equipment.js  equipment, materials, roads, weather, condition presets + sources
data/sample-profile-evr.csv   sample haul profile (digitised)
tests/engine.test.mjs validation tests (Node ≥ 18)
```

To add a machine, append an object to `TRUCKS` or `LOADERS` in `js/data/equipment.js` (curves as `[speed km/h, force tonnes-force]` pairs).

## Disclaimer

Planning-level estimates only. Calibrate cycle times, availability and road resistance against site time studies and dispatch data. Equipment names are trademarks of their respective owners; this project is independent and not affiliated with any manufacturer.

## License

MIT
