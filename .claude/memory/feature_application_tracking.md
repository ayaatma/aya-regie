---
name: feature-application-tracking
description: 2026-09-15, le suivi des candidatures (roadmap items 1 and 10-11): Volunteer.status / statusSteps / regieNote / registeredAt, the Réserve renamed Liste d'attente with a new Réserve (Volunteer.backup), the energy profile. PLAN_FORMAT 16, migration 24.
metadata:
  type: project
---

# Suivi des candidatures (2026-09-15)

**State: BUILT, green (334 engine, 418 app tests, both typechecks, build, sql-check 909,
schema-check 243), shots 96-98 read in both schemes. PLAN_FORMAT 16. MIGRATION 24
(`2026-09-15_application_tracking.sql`) WRITTEN AND NOT APPLIED, min_plan_format 16: it ships with
its deploy.** Part of [[project-field-test-roadmap]]. The automatic sheet sync and the
confirmation form are NOT built (roadmap item 12).

## Decisions

1. **Status is `'candidature' | 'valide' | 'annule'`, and the waiting list is NOT a status.** It
   stays `Plan.reserve` (the solver fills and empties it itself; a second source of truth would
   disagree on the first re-solve). Absent = candidature. Candidature and validée are both
   placeable: the tool behaved that way before and a « plan only the validated » switch was not
   asked for (open question if a festival workflow wants it).
2. **Annulée never removes anything by itself.** `violationsFor` blocks with tier 1
   `candidature-annulee` (not a Réglages criterion, always blocking), validate raises one issue per
   person still holding places and skips every other per-person check, the solver prices them 0
   and never puts them on the waiting list, so a re-solve proposes the removals. The fiche offers
   « Libérer ses places » (`releasePlaces`: exploit incl. locked, both phases, waiting list) as one
   explicit edit. Excluded from: pool « Disponibles », summary counts (`volunteersCancelled`
   apart), gap diagnosis, door CSV (whatever the reserve setting), Brevo file (`cancelled` list).
   Phase catering of a cancelled person with phase boxes still counts until freed (not handled).
3. **Réserve renamed « Liste d'attente » on every screen**, identifiers unchanged (`reserve`,
   `on_reserve`, proposal kinds). **New Réserve = `Volunteer.backup`**: validated people ready to
   reinforce beyond their volume. `GapDiagnosis.enRenfort` counts backup people blocked by
   `volume-depasse` alone; the gap sentence names them after anybody who could simply take it.
4. **Steps are per event** (`Plan.applicationSteps`, `{key,label}`, three defaults), ticks are keys
   on the person; renaming keeps ticks, removing a step hides its ticks without erasing them.
5. **Energy** (`fonce | regulier | fatigable | premiere`) and **backup** are ANSWERS: bound by the
   importer (`backup` /renfort|manque des benevoles/, `energy` /energie|comment te considere/),
   in `EDITABLE_FIELDS`, compared on re-import. Several ticked stamina boxes keep the most
   cautious. Energy informs only (a line on the fiche when « fatigue vite » has hours), no score.
6. **Status, steps and note are the régisseur's**, carried whole by `mergeWithManual`, never
   compared. `registeredAt` is the earliest form timestamp of the person's rows (import) and the
   earliest of before/after (re-import).

## Where

- Engine: `model.ts` (types, labels, `statusOf`), `plan.ts`, `validate.ts`, `solver.ts`,
  `import.ts` (`parseBackup`, `parseEnergy`), `reconcile.ts`, `ticketing.ts`
  (`TicketingRow.applicationStatus`), `csv.ts`, `convert.ts` (an orga turned bénévole is `valide`).
- App: `components/ApplicationSection.tsx` (top of `VolunteerFiche`), `store/applicationEdits.ts`,
  `screens/ApplicationStepsCard.tsx` (Réglages, after Orgas), Personnes: « Colonnes: Candidature »
  and a « Suivi » filter (status or Réserve). `npm run shots candidature` captures 96 to 98.
- SQL: `event.application_steps` jsonb; volunteer `status`, `status_steps`, `regie_note`,
  `registered_at`, `backup`, `energy`. The migration was generated from `db/schema.sql` by a
  scratch script that copies `load_plan` and `write_plan_body` whole (verified identical against
  migration 23 first); rewrite it the same way for the next migration.
