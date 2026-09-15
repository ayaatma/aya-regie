---
name: feature-availability-by-day
description: 2026-09-15, availability day by day (roadmap item 7): Volunteer.unavailable windows on the exploit edited per day on the fiche, arrival and departure questions read from a form, montage and démontage days ticked. PLAN_FORMAT 18, migration 26.
metadata:
  type: project
---

# Disponibilités jour par jour (2026-09-15)

**State: BUILT, green (344 engine, 420 app tests, sql-check 1027, schema-check 245), shot 99 read.
PLAN_FORMAT 18. MIGRATION 26 (`2026-09-15_availability_by_day.sql`) WRITTEN AND NOT APPLIED, after
25, ships with its deploy.** Part of [[project-field-test-roadmap]]. Code: `tools/src/presence-days.ts`.

## Decisions

1. **Exploit: `Volunteer.unavailable?: Window[]`** (event hours), ON TOP of the refused tranches,
   never replacing them. `PlanIndex.windowsOf` subtracts both, so every rule, the solver and the
   import's volume ceiling read it through `hors-disponibilite` with nothing new. In
   `EDITABLE_FIELDS`, backed by `availabilityNote` in `reconcile.ts`.
2. **Fiche « Disponibilités par jour »** (`AvailabilityDays.tsx`): one row per `index.days`
   (the event days of `days.ts`), present or not, from / to typed on that day's clock
   (`PlainClockField`, converted inside the day, 24h/00h as the day's end). Only the outer edges
   are editable; a hole in a day belongs to the refused tranches.
3. **Import fields `arrival` / `departure`**: the DATE comes from words (« vendredi 18
   septembre », « 18/09 ») in the answer or the question, never from a weekday alone; no date
   means the event's first day (arrival) or last day (departure). Brackets are read at their FAR
   edge: « entre 14h et 16h » is 16h arriving, 14h leaving. Prose saying montage / déjà là / pas
   d'impératif is no constraint; other prose is flagged. The answers are appended to
   `availabilityNote` as « Arrivée: ... » / « Départ: ... ».
4. **Phases: the days ticked** become `PhasePresence.windows` (union of those phase days'
   segments), via `ImportOptions.phases` (the app passes both phases). The fiche replaced the
   « à partir de » select with a checkbox per phase day inside the bénévole opening; all ticked
   is stored as `[]` (the whole opening), none ticked is not present.
5. Bug caught by the test and fixed: a phase starting at noon has day 0's midnight before its
   start; the calendar date of a phase day is taken at `midnight + 12`, never clamped to 0.
