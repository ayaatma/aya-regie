---
name: feature-any-pole-and-ranges
description: 2026-10-22, « Tous les pôles acceptés » as a pole choice (PoleChoice.anyPole) and « ne peut pas travailler » in plages libres (Plan.availabilityMode), PLAN_FORMAT 28, migration 37.
metadata:
  type: project
---

# Tous les pôles acceptés, et les plages libres (2026-10-22)

**State: BUILT, green (409 engine, 451 app tests, sql-check, schema-check), app builds. PLAN_FORMAT 28.
MIGRATION 37 (`2026-10-22_any_pole_and_availability_ranges.sql`) WRITTEN AND NOT APPLIED, after 36;
it ships with its front deploy (min_plan_format 28). Not visually checked: the shot fixtures are in
tranches mode.** Asked by the régisseur during the first real import of the October form.

## Decisions

1. **`PoleChoice.anyPole`**, `poleKey` then ''. `PlanIndex.choiceIndexOf` takes it as matching
   every pole, so Bar first and « tous acceptés » second is the Bar wanted, then any pole at the
   price of a second choice, never `outsideChoices`. Label `ANY_POLE_LABEL` via `choicePoleLabel`
   (model.ts), used by the fiche, the pool tooltip, convert and reconcile. The pool's « Pôle
   demandé » filter matches it for every pole. DB: `volunteer_choice.any_pole`.
2. **The import reads a choice naming no pole on purpose** (`parsePoleAnswer` confident '':
   « peu importe », « tout me va ») as `anyPole`, with no `pole-inconnu`. In a refusal the same
   reading is « no refusal ».
3. **`Plan.availabilityMode`: 'tranches' (default) | 'plages'**, Réglages > événement, beside
   « Choix de pôles ». DB `event.availability_mode`. In plages, `parseAvailabilityWindows` keeps
   the note's hours as `Volunteer.unavailable` (merged with arrival / departure) and refuses no
   tranche from it; the closed tranche question still adds `refusedSlotIds` (the régisseur's 4b).
   Nothing already imported is rewritten by switching: the next import reads it again.
4. **Bare ranges are read now, in both modes**: « 11h-14h », the form's own example, read as
   nothing before. A bare range is a refusal unless the sentence says « dispo / libre ». One edge
   outside the event is clamped to the event's edge (11h on an event opening at 12h).
5. **Editors**: `UnavailableRanges.tsx` (day, from, to, any number of rows, unmerged while
   edited) replaces « Disponibilités par jour » on the fiche in plages, and heads « Corriger la
   lecture » with the tranches retitled « Tranches refusées » under it. `PhaseDaysEdit.tsx` is
   shared by the fiche and « Corriger la lecture » (the montage / démontage days).

Related: [[feature-availability-by-day]], [[feature-generic-event]], [[feature-montage-demontage]].
