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
- `index.html` — shell, 3 tabs (Calculator / Equipment Data / Method & Sources)
- `css/styles.css` — light + dark (prefers-color-scheme), mobile-safe (no horizontal scroll at 390 px)
- `js/engine.js` — pure calculation engine (testable in Node). Key functions: `computeScenario`, `travel`, `steadySpeed`, `matchPair`, `matchFactor`, `production`, `sweepTrucks`, `buildSegments`
- `js/app.js` — UI binding (`data-bind` paths into `state`, `data-q` = unit quantity), rows, charts, CSV/JSON import-export, localStorage key `mfc-state-v1`
- `js/units.js` — unit conversions; `js/docs.js` — Equipment Data + Method tabs (method text must match engine)
- `js/data/equipment.js` — TRUCKS, LOADERS, MATERIALS, ROADS, WEATHER, CONDITIONS, JOB_CONDITIONS, SOURCES
- `data/sample-profile-evr.csv` — sample haul profile (see below)
- `tests/engine.test.mjs` — validation; **run `node tests/engine.test.mjs` before every push (must print ALL PASSED)**

## Decisions already made (do not re-litigate without asking)
- v1 equipment = **CAT 390F L, CAT 385C L** (excavators), **CAT 777E, CAT 745 (current model), John Deere 460 P-Tier** (trucks).
  - User first asked for "latest CAT 390 and 380": CAT has no current 390/380 (390F was replaced by 395 in 2020; CAT never made a 380 — that is a JD model). User chose 390F L + 385C L.
- Every number carries a source; values not published by the OEM are flagged `estimate` in data and shown with a badge.
  - JD 460 P-Tier rimpull & retarder curves are **generated** (η = 0.83 × 359 kW / v, stall cap 0.59 × GMW; retarder ≈ 550 kW at JD gear speeds) — method fitted on the digitised CAT 745C curve.
  - CAT 745 curves come from the **745C** charts (CAT Handbook Ed.47 p.1-29/1-30); specs from cat.com current 745.
  - 777E rimpull/retarder digitised from Handbook Ed.47 p.10-49/10-50 (embedded raster images, read by eye, power-checked).
  - Till density (loose 1.8 t/m³, swell 22 %) is a typical value — user should replace with site data. Blasted rock 2.3 and coal 1.3 t/m³ loose were given by the user.
  - Machine-condition presets (availability / power factor / cycle multiplier) and weather RR/traction modifiers are planning estimates.
- Match factor uses **Burt & Caccetta 2008 corrigendum eq.16** (the 2007 paper's §4 formula is wrong; corrected example = 0.928).
- Pass rule default = Burt & Caccetta "add last pass if remainder ≥ ⅓ bucket"; carried load capped by heaped volume.
- Default travel model = rimpull simulation with acceleration/braking (≤5 m steps); "steady" mode = textbook d/v for checking hand calcs.
- Haul profile: first point = loading point, last = dump; loaded haul goes first→last, empty returns. Profile resampled to `segmentM` (default 100 m) to remove digitising noise.
- Profile input for now: user sends Claude an image of an elevation-vs-distance chart → Claude digitises it to CSV (`distance_m,elevation_m`) → user uploads. Also accepts Minesite `x,y,z` polylines. In-browser image digitising is a future feature.
- The sample profile = orange "EVR ElevBasemap ELK" line from the user's chart (Turnbull area), digitised by colour mask + gridline calibration (y = 5285.857 − 2.9179·elev px; 84 px/km; gaps where hidden behind the teal line filled from the teal line). 0–4500 m, 1662–1767 m, accuracy ≈ ±2 m / ±20 m.

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
3. In-browser image digitising of elevation profiles (calibrate axes, pick line colour).
4. Cost per tonne (MCS cost data from MIME 426 capstone is on the drive: `00 Capstone MIME-426…\01 MCS 成本资料…`).
5. Optional: more ADTs (CAT 740 GC / 745 variants, Volvo, Bell), wheel loaders (CAT 992/994).
