---
name: project-engine-api
description: "The headless engine's public surface: types, functions, issue codes, invariants and timings. Read this instead of the source when building the UI against it."
metadata:
  type: reference
---

The engine in `tools/src/` is finished and verified. This file is what the UI codes against, so a
session building screens does not have to read `validate.ts` (940 lines) or `solver.ts` (1085).
Read the source only when this file is not enough, and update this file when the surface changes.

## File map

| File | What lives there |
|---|---|
| `model.ts` | Domain types and time helpers. `Pole` (with optional `colour`, `locked` and `defaultShiftHours`), `Shift`, `Volunteer`, `Artist`, `PoleLeader`, `SchedulingRules` (which now carries `eveningStartsAt`), `EventSlot` + `DEFAULT_SLOTS`, `toLabel`, `toClock`. `SlotId` is a plain string: the slots are the form's own questions and the régisseur edits them. |
| `availability.ts` | `usableWindows`, `refusedWindow`, `maxAchievableHours`, `allowedVolumes`, `fitsAvailability`. The afternoon/evening asymmetry lives here. Windows are derived from the clock (a span cut by the refused slot), not enumerated from a fixed list of slots. |
| `plan.ts` | `Plan`, `Assignment`, `BuddyPair`, `PlanIndex`, `buildBlocks`, `fmtHours`. |
| `validate.ts` | `validate`, `blockersFor`, `isLegal`, `LegalityContext`, `TIER1`, `TIER2`. |
| `solver.ts` | `solve`, `SolverWeights`, `DEFAULT_WEIGHTS`, `SolverState`. |
| `catering.ts` | Les repas et les tickets boisson, 2026-09-12. `mealServices` (a service is a REAL DATE, not an offset), `defaultMealChoices`, `cateringReport`, `setMealChoice`, `cateringCsv`, `mealsForHours`, `drinksForHours`, `isStandardDiet`. Reads the plan, decides nothing, refuses nothing: no rule and no solver ever consults it. See [[feature-catering]]. |
| `proposals.ts` | `buildProposals`, `groupProposals`, `summariseProposals`. |
| `import.ts` + `text.ts` | `importVolunteers`, `parseCsv`, `bindColumns`, buddy fuzzy matching. Isomorphic since 2026-09-07: the access code draw uses the Web Crypto API with rejection sampling, not `node:crypto`, so the module also runs in the browser. |
| `csv.ts` | **The single adjustment point for the real Google Form.** `FORM_COLUMNS` and the value labels. |
| `event-config.ts`, `scenarios.ts`, `generate.ts`, `rng.ts`, `names.ts` | Synthetic test data. Not production. |
| `plan-fixtures.ts` | `loadScenario`, `greedyFill` (baseline, **not** the solver), `injectViolations`. |
| `*-cli.ts` | Command-line harnesses. `npm run generate | import | validate | solve`, `npm test`, `npm run typecheck`. |

## The one object everything passes around

```ts
interface Plan {
  name: string; startISO: string; lengthHours: number; rules: SchedulingRules;
  slots: readonly EventSlot[];       // the form's own questions, editable in Réglages
  poles: readonly Pole[]; shifts: readonly Shift[]; artists: readonly Artist[];
  leaders: readonly PoleLeader[];
  volunteers: readonly Volunteer[];
  buddies: readonly BuddyPair[];      // resolved, one-way, pairwise
  assignments: readonly Assignment[]; // { volunteerKey, shiftKey, locked, source }
  reserve: readonly string[];         // volunteer keys, zero hours on purpose
}
```

`PlanIndex` wraps it for lookups: `shiftsOf`, `assigneesOf`, `assigneeCount`, `hoursOf`,
`blocksOf`, `levelIn`, `choiceOf`, `isUnder`, `isReserve`, `windowsOf`, `shiftLabel`,
`volunteerName`, `polePath`, `label`. Build it once per render, it is cheap.

## The three calls the UI needs

```ts
validate(plan): ValidationResult   // pure, never throws, never mutates
solve(plan, options): SolveResult
solveToConvergence(plan, options): ConvergeResult   // rounds until nothing more is proposed
buildProposals(before, after, dropped): Proposal[]
groupProposals(before, proposals): ProposalGroup[]
```

`groupProposals` cuts a batch into decisions instead of lines. A `ProposalGroup` is a set of
changes that need each other in a circle (two people trading shifts is the plain case), and
`requires` names the groups it needs taken first. **The dependency is directed**: if A takes the
place B gives up, A needs B and B does not need A. Treating it as symmetric merges a whole batch
into one lump. See [[feature-admin-ui]] for the measurements.

`ValidationResult` carries `issues`, `volunteers`, `shifts`, `artists`, `summary`:

- `VolunteerReport`: `colour` (`'rouge' | 'orange-fonce' | 'orange-clair' | 'aucune'`), `reserve`,
  `assignedHours`, `requestedHours`, `blocks`, `hoursByChoice`, `horsChoixPoles`,
  `toleratedOverflowHours`, `againstPreferenceHours` (the two halves of the loto / soirée
  preference cost, see [[feature-preference-refactor]]; one `overflowHours` until 2026-09-08),
  `buddies` (each with `honoured`), `issues`, and `volumeBand` (the 6h/8h band on its own, since
  `colour` lets red hide it). **The colour codes from the brief are computed here, do not
  recompute them in the UI.**
- `ShiftReport`: `assigned`, `missing`, `stars` (one per assignee with their `level`, which drives
  the stars on the grid, and `issues`, the ones naming this volunteer AND this shift, which is
  what makes a red box one box rather than one person), `gap` (a `GapDiagnosis` with `raison`,
  one ready-made French sentence), `issues`.
- `PlanSummary`: everything the dashboard shows. `shiftsFilled/Partial/Empty`, `gapHours`,
  `volunteersUnassigned` (zero hours **and not** on reserve), `volunteersOnReserve`,
  `volunteersBelowFloor`, `hoursChoix1/2/HorsChoix`, `horsChoix` (the named list the brief asks
  for), `buddyRequests/buddyHonoured`, `gapsBySlot`, `gapsByPole`, `byCode`, `volunteerCeiling`
  and `overRecruited` (the over-recruitment stop signal).

`SolveResult`: `plan` (new assignments **and** new reserve), `score`, `initialScore`,
`iterations`, `improvements`, `elapsedMs`, `timedOut`, `dropped`.
`SolveOptions`: `seed`, `weights`, `iterations` (default 3000), `timeBudgetMs`, `anchor`.

## For drag and drop

```ts
isLegal(index, volunteer, shift): boolean        // fast, no strings built
blockersFor(index, volunteer, shift): Blocker[]  // each { code, message } in French
```

`PlanIndex` satisfies the `LegalityContext` these take. Use `isLegal` to grey out illegal drop
targets and `blockersFor` to say why on hover. **These are the same rules the solver obeys**, so
the UI can never disagree with it.

## Réglages avancés (2026-09-13)

Which tier 1 rules block, and every solver weight, are per event now: `constraints.ts`,
`Plan.constraints`, `PlanIndex.constraints`, `weightsFor`. A code keeps its name whatever the
mode; its tier follows the mode. New codes `pas-choix-1`, `hors-choix`. See
[[feature-advanced-settings]].

## Generic event (2026-09-14)

`Volunteer.choices` replaces choice1*/choice2*; use `PlanIndex.rankOf` / `choiceIndexOf`, never `choiceOf` (gone). Reports carry `hoursByRank`, `hoursOutside`, `requestedTotalHours`, `hoursByDay`. `costsFor` lists what an allowed placement costs. Import: `bindForm`, `surveyForm`, `ImportOptions.mapping/volume/constraints`. See [[feature-generic-event]].

## Issue codes

Tier 1, illegal, always red: `chevauchement`, `pole-refuse`, `tranche-refusee`,
`hors-disponibilite`, `duree-consecutive`, `trop-de-blocs`,
`pause-insuffisante`, `volume-depasse`, `sureffectif`, `reference-inconnue`, `doublon`,
`deja-affecte` (this last one only ever comes back from `blockersFor`, never from `validate`),
`candidature-annulee` (2026-09-15, always blocking, see [[feature-application-tracking]]).

Tier 2, a real problem, reported not blocked: `sans-affectation`, `plancher-non-atteint`,
`creneau-vide`, `creneau-incomplet`, `que-des-debutants`, `experience-insuffisante`,
`artiste-manque`, `creneau-trop-long`, `reserve-injustifiee`, `reserve-affectee`, `tranche-evitee` (2026-09-15, see [[feature-avoided-slots]]).

Import codes: `reponse-en-double` (2026-09-15), `colonne-manquante`, `identite-incomplete`, `reponse-illisible`,
`volume-impossible`, `choix-contradictoire`, `pole-inconnu`, `artiste-inconnu`, `choix-identique`,
`homonyme`, `binome-soi-meme`, `binome-ambigu`, `binome-non-resolu`.

Proposal kinds: `reserve`, `move`, `remove`, `unreserve`, `add`, sorted in that order because
reserve decisions are the only ones that mean telling somebody they are not needed.

## Timings, measured on `balanced` (120 volunteers, 91 shifts, 247 assignments)

| Call | Cost |
|---|---|
| `validate(plan)` | **4 ms** |
| `solve(plan, { iterations: 300 })` | 217 ms |
| `solve(plan, { iterations: 1000 })` | 721 ms |
| `solve(plan, { iterations: 3000 })` | 2.4 s |

4 ms means the UI can revalidate on every single edit, which is what the brief asks for
("colour codes recomputed after every single change"). No debouncing needed, no worker needed.
Adding the anti-fragmentation terms in round 2 cost about 6% of that. A full solve does want a spinner, and should probably run in a Web Worker so the grid stays live.

## Invariants that must not be broken

- **Time is decimal hours from the event start.** 0 is 12:00, 18 is 06:00 the next morning. Real
  timestamps appear only at export, via `toIso` / `toLabel`. Keep it that way.
- **`validate()` and `solve()` never mutate the plan.** They return a new one.
- **The solver owns no copy of the scheduling rules.** It reaches them through `LegalityContext`.
  Never reimplement a rule in the UI either: ask `isLegal`.
- **Nothing is ever silently dropped or moved.** A re-solve returns a plan; the difference goes
  through `buildProposals` and the régisseur accepts or rejects each line.
- **A locked assignment is one box, one person**, and is carried into the plan whatever it costs.
- **`Pole.locked` is a different lock**: the solver leaves that pole and its subtree alone, and it
  never writes anything into the boxes. Unlocking gives the pole back exactly as it was.
- **French for anything a user reads, English for code.** Any message naming a person must avoid
  gendered pronouns and participle agreement: half the volunteers are women. See
  [[project-brief]] round 11.

The UI reaches all of this through one barrel, `app/src/engine.ts`. No screen imports `@engine/*`
directly, so the surface the UI depends on is one file long and this document describes it.

Related: [[project-brief]], [[feature-admin-ui]].
