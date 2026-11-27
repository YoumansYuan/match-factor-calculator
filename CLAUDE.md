# CLAUDE.md — Match Factor Calculator (handoff notes)

Owner: Youmans Yuan (GitHub `YoumansYuan`). Mining engineer (McGill MIME grad), works on surface-mine projects in Alberta/BC
(e.g. "Turnbull" project — till hauling). Talks to Claude in **Chinese**; the website itself must stay **English only**.

Live site: https://youmansyuan.github.io/match-factor-calculator/ — GitHub Pages, branch `main`, folder `/`.
Every push to `main` redeploys automatically (≈1–2 min). Public repo; no private data in it.

## What it is
Static, dependency-free web app (vanilla ES modules + Chart.js 4.4.1 from cdnjs). No build step.
Truck–loader match factor, haul cycle, fleet production, fuel/CO₂, with OEM rimpull/retarder curves,
mixed fleets and haul-profile CSV upload. Metric/Imperial toggle (state always SI internally).

## Files
- `index.html` — shell, 4 tabs (Visual [default] / Detailed / Equipment Data / Method & Sources) + `<dialog id="pop">` used by Visual mode
- `css/styles.css` — light + dark (prefers-color-scheme), mobile-safe (no horizontal scroll at 390 px)
- `js/engine.js` — pure calculation engine (testable in Node). Key functions: `computeScenario`, `travel`, `steadySpeed`, `matchPair`, `matchFactor`, `production`, `sweepTrucks`, `buildSegments`
- `js/app.js` — UI binding (`data-bind` paths into `state`, `data-q` = unit quantity), rows, charts, CSV/JSON import-export, localStorage key `mfc-state-v1`
- `js/visual.js` — friendly Visual mode for non-engineers: **static** SVG scene (user found animation distracting — keep it still): excavator + a line of trucks queued at it in `state.trucks` order (each type's count consecutively). Tap a truck → change that one truck's model (`moveOne`) or settings for its type; × takes one out (`decTruck`); + slot adds one. Road profile strip below (tap → road dialog). Fleet chips, plain-language verdict + "Add/Remove N trucks" button. Uses the same `state`/`data-bind` binding as the Detailed tab (hooks passed from app.js via `initVisual`). Machines are original detailed side-view SVGs (`truckSVG` rigid/ADT, `excavatorSVG` with 'dump'/'low' pose) coloured by brand: CAT yellow, John Deere green, Komatsu white (`brandOf`, CSS `--b-cat/--b-jd/--b-kom`). With 2+ excavators: one on the bench above the dig face loading down, one on the pit floor (staggered, no overlap); line[0] goes under the bench unit.
- `js/conditions.js` — pure site/time model: date → month temp (`MONTHLY_TEMP_C`), sunrise/sunset (NOAA approx, MST/MDT), dark fraction of shift hours, water-truck rule (>3 °C yes, 0–3 °C daytime only = 0.5, ≤0 °C no), dust, `siteConditions(site, ops)` → operatingH, utilization, truckUtil, jobEff, condFactor, capKmh.
- `js/profile-editor.js` — in-browser haul-profile editor (`#ped` dialog): drag points, click line to insert, Delete key, coordinate table, grade labels + max-grade warning, trace-over-image background (localStorage `mfc-ped-bg`), simplify (Douglas–Peucker 1 m), flip, CSV download. Opened from Detailed "Draw / edit profile" and the Visual road dialog (`api.editProfile`).
- `js/units.js` — unit conversions; `js/docs.js` — Equipment Data + Method tabs (method text must match engine)
- `js/data/equipment.js` — TRUCKS, LOADERS, MATERIALS (`digTm3`, `swellPct`, `bankTm3` for blasted; `looseOf()`), ROADS (road type), SURFACES (road surface condition), GRADING, SKY (weather = visibility), MONTHLY_TEMP_C, CONDITIONS, JOB_CONDITIONS, SOURCES
- `data/sample-profile-evr.csv` — sample haul profile (see below)
- `tools/bump-version.py` — stamps `?v=<timestamp>` on all CSS/JS references (index.html + every ES import). **Run before every push**, otherwise browsers keep old JS for up to 10 min (Pages cache) and the user sees no change.
- `tests/engine.test.mjs` — validation; **run `node tests/engine.test.mjs` before every push (must print ALL PASSED)**

## Decisions already made (do not re-litigate without asking)
- v1 equipment = **CAT 390F L, CAT 385C L** (excavators), **CAT 777E, CAT 745 (current model), John Deere 460 P-Tier** (trucks).
- Added 2026-11-27: **John Deere 870 P-Tier** excavator (spec sheet ME870PAJ; only the 3.49 m³ bucket is published — other bucket sizes flagged estimate; dig depth / dump height per boom-arm from Deere), **Volvo A60H** and **Volvo A40** (current, product guides 20062762_A / 20064352_D; rimpull & retarder generated from power, loading height estimated, A40 net power = gross × 0.99). Volvo brand colour = blue (`--b-volvo`).
  - User first asked for "latest CAT 390 and 380": CAT has no current 390/380 (390F was replaced by 395 in 2020; CAT never made a 380 — that is a JD model). User chose 390F L + 385C L.
- Every number carries a source; values not published by the OEM are flagged `estimate` in data and shown with a badge.
  - JD 460 P-Tier rimpull & retarder curves are **generated** (η = 0.83 × 359 kW / v, stall cap 0.59 × GMW; retarder ≈ 550 kW at JD gear speeds) — method fitted on the digitised CAT 745C curve.
  - CAT 745 curves come from the **745C** charts (CAT Handbook Ed.47 p.1-29/1-30); specs from cat.com current 745.
  - 777E rimpull/retarder digitised from Handbook Ed.47 p.10-49/10-50 (embedded raster images, read by eye, power-checked).
  - Till density (loose 1.8 t/m³, swell 22 %) is a typical value — user should replace with site data. Blasted rock 2.3 and coal 1.3 t/m³ loose were given by the user.
  - Machine-condition presets (availability / power factor / cycle multiplier) and weather RR/traction modifiers are planning estimates.
- Match factor uses **Burt & Caccetta 2008 corrigendum eq.16** (the 2007 paper's §4 formula is wrong; corrected example = 0.928).
- Fill factors: **bucket fill factor** per material (overridable per loader); **truck body fill factor** per truck type (`trucks[i].bodyFillPct`, default 100 % of SAE 2:1 heaped) — usable body volume = heaped × body fill, used for passes-by-volume and the volume cap on carried load (added 2026-11-27).
- **Desktop only for now** (user 2026-11-27): don't spend effort on mobile layout for upcoming versions.
- UI is aimed at non-engineers who know their inputs (user request 2026-11-27): Visual tab is the default; Detailed tab keeps every input.
- Pass rule default = Burt & Caccetta "add last pass if remainder ≥ ⅓ bucket"; carried load capped by heaped volume.
- Default travel model = rimpull simulation with acceleration/braking (≤5 m steps); "steady" mode = textbook d/v for checking hand calcs.
- Haul profile: first point = loading point, last = dump; loaded haul goes first→last, empty returns. Profile resampled to `segmentM` (default 100 m) to remove digitising noise.
- Profile input for now: user sends Claude an image of an elevation-vs-distance chart → Claude digitises it to CSV (`distance_m,elevation_m`) → user uploads. Also accepts Minesite `x,y,z` polylines. Since 2026-11-27 the user can also draw/trace it in the built-in profile editor.
- The sample profile = orange "EVR ElevBasemap ELK" line from the user's chart (Turnbull area), digitised by colour mask + gridline calibration (y = 5285.857 − 2.9179·elev px; 84 px/km; gaps where hidden behind the teal line filled from the teal line). 0–4500 m, 1662–1767 m, accuracy ≈ ±2 m / ±20 m.

## Model decisions made 2026-11-27 (user's 11 feedback items)
- **Material**: input = density at the dig face (in-situ) + swell dig face → truck; loose = dig/(1+swell); load stops at payload or usable body volume. Blasted rock: dig-face (muck pile) 2.3, swell 0, plus "solid rock density before blast" used ONLY for BCM. Results show BCM/h dug and LCM/h at dump.
- **Weather split**: SKY (clear/overcast/rain/snowing/fog → speed cap + efficiency) vs road SURFACES (dry/wet/muddy/snow/ice/thaw → RR & traction) vs GRADING (none/once per shift/dedicated) + water truck. Dry road without effective water truck → dust (eff loss + 40 km/h cap when heavy). Sky choice suggests a surface.
- **Time chain, each loss once**: shift clock times − meetings (nonProdMin) = operating → × availability (from machine condition, overridable) → × utilization (face clean-up + blast clearance [all materials] + loader relocation) and × truckUtil (fuelling) → × job efficiency (55 min/h, small delays only) → × condFactor (sky × dust × darkness). Shown as waterfall ("Where the shift time goes").
- **No altitude input**: each segment uses its profile elevation; loader uses loading-point elevation.
- **Digging face setup** (per loader, user 2026-11-27): `setup` 'bench' (default; `benchHeightM` blank = stick length of the selected bucket/stick — user agreed 2026-11-27 with CAT: bench ≈ stick, never higher; warning if typed higher. **When adding a new excavator model, give every bucket row `stickM` and `digDepthM` from the OEM range table** so the bench default works) or 'floor'. Cycle × Komatsu 15A-10 conversion factor (`KOM_CYCLE_FACTOR`, relative to the 1.0 cell = CAT condition C): bench → row from benchHeight/digDepth, column Normal; floor → row <40 %, column Rather difficult (1.1). Blank swing = setup default (bench 60°, floor 110°). No source gives a measured bench-vs-floor %; cells chosen by judgement (flagged estimate). Bucket rows carry `digDepthM`/`stickM` from CAT47 p.7-116.
- **Target volume** (`state.target {volume, basis}`): basis auto = LCM for blasted/rehandle, BCM otherwise; or LCM at dump. Working days = tonnes / production per day; finish date from work date × 365/daysPerYear. New material **Rehandle** (2.3, swell 0).
- Old saved states are converted by `migrate()` in app.js (looseTm3→digTm3, weatherId→surfaceId, drop altitudeM/shiftH/utilizationPct, jobEff 50→55).

## Course material (on the user's external drive)
User's computer must be linked to the session and the folder granted (`E:\school`). Root:
`E:\school\mcgill\McGill slide deck\` (index: `00 课件总索引 Index.html` / `.csv`). Most useful:
`10 MIME 采矿专业 Mining Engineering\06 选矿与物料搬运 Mineral Processing & Materials Handling\MIME-333 Materials Handling (Winter 2025)\`
- `Course Notes\MIME333_Chapter 3-Loading and Haulage Equipment.pdf` (RR table 3.4, traction 3.5, altitude §3.7.6, retarder §3.7.9, MF example 1.125)
- `Course Notes\MIME333_Chapter 2-Earthmoving Fundamentals.pdf` (swell, bank/loose, weather effects)
- `Formula Sheet\MIME333_MIME333 - Formula-sheet - Final 2025.pdf` (travel time with accel, MF, fuel CF = Pβρ/γ, CO₂)
- `Supplementary\MIME333_CAT Handbook.pdf` (Ed.47, 2441 pp; 777E p.10-12/10-49/10-50; 745C p.1-4/1-29/1-30; 390F p.7-40/7-116/7-178; excavator cycle charts p.7-246…7-248; tables p.30-1…30-12: fill factors, RR, traction, material weights, altitude deration; fixed times p.10-20)
- `Supplementary\MIME333_Komatsu-Performance-Handbook.pdf` (Ed.32; excavator & truck productivity p.15A-10…15A-18: speed factors, dump/spot times, job efficiency)
- `Supplementary\MIME333_Match factor for heterogeneous truck and loader fleets - Part 1.pdf` / `Part 2.pdf` (Burt & Caccetta + corrigendum)
- `Supplementary\MIME333_Haul_Road_Design_Guidelines.pdf` (Tannant & Regensburg 2001 — snow/ice traction, spring thaw, retarder vs temperature)
- `Assignment and Design\MIME333_Assignment 1-Winter 2025.pdf` + `Solution of Quizzes and Assignments\MIME333_Assignment 1-Solution-Winter 2025.xlsx` (worked haul/MF/fuel method)
- Also: `03 采矿方法…\MIME-419 Surface Mining…\10. Road design\`, `04 岩石力学…\MIME-330…\Lectures\MIME330_006-mine haul roads-2024.pdf`
Tip: stage PDFs into the container and use `pdftotext -layout`; chart pages are raster images — render with `pdftoppm` and read visually.

## Environment gotchas seen
- Cloud container could not reach cdnjs/npm/pypi (proxy 403/DNS). For UI tests use Playwright with a routed **stub** for Chart.js; verify the real charts on the live site in the user's built-in browser pane.
- The session could push code but could NOT create repos, enable Pages or edit repo settings via the GitHub API — ask the user to do those in the GitHub UI.
- Commit trailer used: `Co-Authored-By: Claude …` per session attribution instructions.

## Backlog / ideas the user mentioned or agreed to
1. Compare results against the user's own Turnbull till-hauling Excel (not yet received) and align inputs/outputs.
2. Add Komatsu trucks/excavators (Komatsu handbook is on the drive).
3. ~~In-browser profile drawing~~ done (editor with trace-over-image). Still possible: automatic colour-mask digitising of a chart image.
4. Cost per tonne (MCS cost data from MIME 426 capstone is on the drive: `00 Capstone MIME-426…\01 MCS 成本资料…`).
5. Optional: more ADTs (CAT 740 GC / 745 variants, Volvo, Bell), wheel loaders (CAT 992/994).
