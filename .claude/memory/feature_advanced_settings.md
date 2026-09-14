---
name: feature-advanced-settings
description: "2026-09-13, Réglages avancés: per event, each planning criterion is Bloquant / Poids / Ignoré with its weight; the four scheduling thresholds moved onto their rows; long-day marks configurable. Built, green, MIGRATION 20 WRITTEN AND NOT APPLIED, PLAN_FORMAT 12."
metadata:
  type: project
---

**State 2026-09-13: BUILT and green.** 305 engine tests (11 new in `constraints.test.ts`), 406 app
tests (7 new in `store/constraintEdits.test.ts`), both typechecks, `npm run build`, `sql-check`
(new migration parsed), `schema-check` (228 fields round trip). Checked in headless Chrome with
`npm run shots -- avances` (new step), both schemes.

**MIGRATION 20 (`db/migrations/2026-09-13_advanced_settings.sql`) IS WRITTEN, the dry run lists it
« à appliquer », NOT APPLIED.** The dry run's shape check reports `event.constraint_settings`
missing until it runs, which is expected. It ships WITH its deploy: PLAN_FORMAT 12 and
min_plan_format 12. The developer runs `npm run migrate -- --apply` and `npm run deploy`.
`db/schema.sql`'s seed of min_plan_format was stale at 8 and is 12 now. The two functions in the
migration were copied from schema.sql after checking schema.sql matched migration 19 exactly.

## The model

- `tools/src/constraints.ts`: `CRITERIA` (22 definitions: id, group, French label/hint/unit,
  allowed modes, default mode and weight, optional `parameter` naming a `SchedulingRules` field),
  `resolveConstraints` (defaults + valid overrides; a mode the criterion refuses falls back),
  `priceOf`, `tierOf`, `ALWAYS_BLOCKING` (overlap, over-staffing: not criteria).
- `Plan.constraints: ConstraintSettings = { criteria: sparse overrides, longDayHours, veryLongDayHours }`.
  ONLY DISAGREEMENTS ARE STORED (catering doctrine): `setCriterion` drops a field equal to its default.
- DB: ONE jsonb column `event.constraint_settings` (object check). Chosen over columns because it
  is sparse by design and no SQL ever reads inside it.
- `PlanIndex.constraints` / `SolverState.constraints` = resolved table. `LegalityContext` gained
  `constraints`, `preferenceSlots`, `choiceOf`, `artistsClashing`.

## Rules of behaviour

- block: `isLegal` refuses (grid greys, solver never proposes), a hand-placed box is tier 1.
- weight: legal, priced by the solver; a rule that used to be tier 1 is still REPORTED at tier 2.
- off: no cost, no signalement.
- ISSUE CODES NEVER CHANGE WITH THE MODE, only the tier. New tier 1 codes `pas-choix-1` and
  `hors-choix` exist only while those criteria block. `creneau-trop-long` only while the cap blocks.
- `notChoice1` + `outsideChoices` are CUMULATIVE (the régisseur's wording): solver `choice2` =
  notChoice1, `outsideChoice` = notChoice1 + outsideChoices (100 + 700 = the measured 800).
- `floor`, `volumeUnder`, `buddy`, the shift-composition ones, stability: weight/off only (a block
  there would make an empty plan illegal). `reserve` and `staffing`: weight only.
- `DEFAULT_WEIGHTS` is DERIVED (`weightsFor(resolveConstraints(DEFAULT_CONSTRAINTS))`); a test pins
  it to the old literal values plus six zeros, so an untouched event solves exactly as before.
  `solve` merges `weightsFor(plan)` under `options.weights`, so the measurement CLIs still override.
- Six new solver terms, zero unless weighted: refusedPole / availability (per hour, precomputed on
  the Placement), volumeOver (per hour over), maxConsecutive / maxBlocks / minBreak (from
  `buildBlocks`, only when one is priced). Defaults when switched to weight: 6000/h for a refused
  pole or hour (2x staffing), 3000 for volume and rhythm. None of these were measured on a scenario.
- Long-day marks: `volumeBand` reads the plan's thresholds; chips read « Journée longue » /
  « Journée très longue » instead of « de 6 h / de 8 h ».

## UI

`app/src/screens/AdvancedSettingsCard.tsx`, last section of Réglages. The old « Règles de
planning » card (RulesCard) is GONE: its four thresholds sit on their criterion's row. Each hourly
weighted row says whether it is « plus / moins cher qu'une heure de place vide ». Changed values
are green (billetterie convention), a row has ↺, the card has a two-click « Tout rétablir par
défaut » (thresholds included). Edits in `store/constraintEdits.ts`. Found by the shots: two
`edit` calls dispatched in the same tick keep only the second (a real click never does that).

## Not done

- `blockersFor` says nothing about weighted rules, so a drop that will cost is not warned on hover.
- `allowedVolumes` / `maxAchievableHours` (import side) still read the thresholds as if blocking.
- The reply of 2026-09-13 lists the Loto-specific assumptions still in the code (form columns,
  volumes 4/6/8 as a type, two pole choices, one buddy, three moments, levels).
