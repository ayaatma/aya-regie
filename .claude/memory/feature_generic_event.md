---
name: feature-generic-event
description: "2026-09-14, the tool stops assuming the Loto Tekno's form: N pole choices ranked or not, volume per event or per day with a day boundary hour, a remembered import correspondence (columns and answers), neutral new events and no Loto branding, a cost warning on drag, binômes edited by hand. Built, green, MIGRATION 21 WRITTEN AND NOT APPLIED (needs 20), PLAN_FORMAT 13."
metadata:
  type: project
---

**State 2026-09-14: BUILT and green.** 317 engine tests, 408 app tests, both typechecks, build,
`sql-check` (732 statements), `schema-check` (234 fields, `PoleChoice` and `VolumeSettings`
added, `days.ts` added to its sources), `anon-check`. Fixtures regenerated: solver scores
identical to before (balanced 605072), so an untouched event plans exactly as it did.
Shots checked: `npm run shots -- evenement correspondance avances` (two new steps).

**MIGRATIONS 20 AND 21 ARE BOTH PENDING** (`2026-09-13_advanced_settings.sql`,
`2026-09-14_generic_event_form_choices_volume.sql`). 21 reads 20's column. 21 moves
choice1_*/choice2_* into `volunteer_choice` then DROPS the columns, maps manualFields
choice1PoleKey etc. to 'choices', makes requested_hours numeric, adds event.pole_choices_ranked,
volume_scope, day_start_hour, volume_options, form_mapping, buddy_pair.manual / dismissed,
min_plan_format 13. Ships with its deploy.

## The régisseur's decisions (AskUserQuestion, 2026-09-14)

- Volume: « Volume horaire: sur tout l'événement / par jour » and « Heure de basculement entre 2
  jours », default 12h. The régisseur's example: 2h-6h then 18h-22h is not the same day.
- Per day: floor (only on a day worked), volume (on each available day), block count. The
  consecutive cap and the minimum break stay continuous across days.
- Pole choices: setting « Classés / À égalité »; ranked = `notChoice1 × rank` per hour, outside =
  `notChoice1 × max(1, N−1) + outsideChoices` (N=2 gives the measured 100 / 800); unranked =
  every choice rank 0, `notChoice1` inert (the card says so).
- Import: columns AND answers, remembered per event.
- Refused: configurable levels (3 levels are fine), renaming artists, changing the three moments.

## Where the code lives

- `tools/src/days.ts`: `VolumeSettings`, `DEFAULT_VOLUME`, `firstBoundary`, `dayIndexAt`,
  `eventDays`, `dayLabel` (named by the calendar day it starts on). A shift counts whole on the
  day it starts. A day is "available" for a volunteer when their windows leave min(volume, floor).
- `PlanIndex`: `choiceIndexOf`, `rankOf`, `levelIn` (exact pole first), `dayMode`, `dayOf`,
  `hoursByDay`, `availableDaysOf`, `requestedTotalOf`. `LegalityContext` gained `rankOf`,
  `dayMode`, `dayOf`, `dayLabel`. `VolunteerReport`: `hoursByRank`, `hoursOutside`,
  `requestedTotalHours`, `hoursByDay`; `PlanSummary.hoursByRank` (hoursChoix1/2 gone).
- `Volunteer.choices: PoleChoice[]` ({poleKey, raw, level}); `EDITABLE_FIELDS` has 'choices'.
  `tools/src/test-volunteers.ts` `withChoices` keeps the old two-choice shorthand in test builders.
- `tools/src/form-mapping.ts`: `FormMapping {columns, choices?, answers}`, sparse; `import.ts`
  `bindForm` (mapping first, detection for the rest, a mapped column never re-bound),
  `surveyForm` (headers, samples, distinct closed answers with automatic reading). Only
  first/last name are required now; unbound key fields are `colonne-non-reliee` warnings; a
  remembered header gone is `colonne-memorisee-absente`. A checkbox choice column splits into
  several choices when every part resolves. `maxAchievableHours` is generic and only counts
  rhythm rules that BLOCK; per day it takes the best day.
- `validate.ts` `costsFor` (violationsFor at level 'weight'); the grid's DragReason shows
  « Placement possible, mais il coûte: ».
- `BuddyPair.manual`, `Plan.dismissedBuddies`; `reconcile.ts` keeps manual pairs and never
  re-adds a dismissed one; `edits.ts` `addBuddy` / `removeBuddy`; fiche `BuddiesSection`. The
  engine always allowed N binômes; the gap was hand editing.
- `plan.ts` `newEventPlan(name)`: tomorrow noon, 12 h, no tranche, no pole. `normalise.ts` keeps
  an EMPTY tranche list only on a plan carrying `formMapping` (format 13+); older plans still get
  the Loto defaults. Branding: « Planning bénévoles », file names from `fileSlug(plan.name)`.
- UI: `EventCard` (volume, boundary with créneaux-cut count, options, ranked toggle),
  `FormMappingCard` on the import screen (a change re-reads the file and drops fiche corrections),
  `VolunteerEdit` choice list editor.

## Not done

- Per-day volume columns in the form (one volume answer applies to each day).
- The orgas' import (`import-organisers.ts`) still binds by its own keywords, no correspondence.
- Catering meal tiers still read total hours, not per day.
- No browser check of the fiche's choice editor or the buddy editor (screens tests only).
