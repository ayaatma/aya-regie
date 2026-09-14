---
name: feature-event-abstraction
description: "2026-09-13: the tool stops being the Loto Tekno's. Seven remarks from the régisseur applied in one round: the event's address, a one-week cap, phases anchored on the event (montage ends where it starts, démontage starts where it ends, two days each by default), the loto / soirée rules replaced by preference tranches with their own overflow, a catering wording, and the day written on the exploit's axis. MIGRATION 16 WRITTEN AND NOT APPLIED, PLAN_FORMAT 8."
metadata:
  type: project
---

**State 2026-09-13: BUILT and green. 272 engine tests and 366 app tests pass**, both packages
typecheck, `npm --prefix app run build` succeeds, `npm run sql-check` (441 statements) and
`npm run schema-check` (155 fields, `PreferenceSlot` added to its list) are green. The ten
fixtures under `app/public/fixtures` were regenerated (`npm run fixture -- --all`); the solve is
identical (254/254 assignments in common on `balanced`), only the shape changed.

**MIGRATION 16 IS APPLIED since later on 2026-09-13 (the migrator lists it as « déjà appliquée »); the paragraph below predates that.** It was written as
`db/migrations/2026-09-13_event_address_and_preference_slots.sql`. `npm run migrate` (dry) lists
it as the one pending migration and reports the four objects it adds as missing until it runs.
**PLAN_FORMAT is 8.** It ships with its deploy or a régisseur's tab writes every volunteer back
with a `halfPreference` the base no longer has a column for. The developer runs
`npm run migrate -- --apply` and `npm run deploy` themselves. Migrations 14 AND 15 are applied,
whatever [[feature-catering]] said when it was written: the migrator lists both as
« déjà appliquée ».

## The seven remarks (ToDo.txt, lines 1 to 8), and what each became

1. **« Ajouter une adresse pour l'événement. »** `Plan.address`, free text, `event.address`,
   a field in the « L'événement » card under the name. `setEventAddress` keeps it as typed.
   Nothing reads it yet; the artists' trajets and the traiteur's sheet will.

2. **« Un événement ne peut faire que 48h maximum, pousser à 1 semaine. »** `MAX_EVENT_HOURS =
   168` in `setupEdits.ts`, clamped in `setEventLength` and on the field.

3. **« Montage par défaut 2 jours avant, démontage jusqu'à 2 jours après. »**
   `DEFAULT_PHASE_HOURS = 48`, `defaultPhaseStart(id, eventStartISO, eventLengthHours)`.
   `defaultPhase(id, startISO, lengthHours = 48)` keeps its signature for the tests that build a
   phase at a chosen origin.

4. **« Abstractiser la notion du Loto. »** The biggest one; see the next section.

5. **« Pas besoin d'heure de fin du montage / de début du démontage. »** `alignPhase(phase,
   eventStartISO, eventLengthHours)` in `phase.ts` and `alignPhases(plan)` in `plan.ts`: a
   montage keeps its start and takes its length from the event's start; a démontage keeps its
   length and takes its start from the event's end. Run by `setEventStart`, `setEventLength`,
   `setPhase` and `normalisePlan`, so every plan a screen sees is aligned. The bénévole window
   lost one edge on each phase: `volunteersUntil` is pinned to the end of a montage,
   `volunteersFrom` to 0 on a démontage, and the card asks only « À partir du » (montage) or
   « Jusqu'au » (démontage). Both fields are still stored, so NO SCHEMA CHANGE for this item.
   **The démontage's origin moving slides its boxes with it**, the way moving the event slides
   the exploit; a montage's start is never touched, except when it is not before the event at
   all, in which case it goes back to the two days before it. A montage start that cannot be
   parsed is left alone (`setPhase` promises that, and a test holds it to it).

6. **« aucune case cochée à la main · id midi, je ne comprends pas. »** It was the count of
   `MealChoice` rows the régisseur had ticked against the engine on that service, plus the
   service's key. Now reads « aucun repas décidé à la main sur ce service dans l'onglet
   Catering » / « N repas décidés à la main… », and the key is not shown.

7. **« Indiquer clairement le jour sur la timeline de l'exploit, et grossir la barre de 00h. »**
   `dayMarks(startISO, hours)` in `TimeRuler.tsx`: the day (« samedi 13/03 ») above the first
   hour and above every midnight on the head ruler, which grew from 46 to 62 px to hold the day
   row; the short day (« dim. 14/03 ») beside the 0h of every pole's `LaneRuler`; and
   `.is-midnight` on both, a `3px double` line in `--ink-soft` reaching through the day row.
   `screens.test.tsx` asserts the two day names and the doubled tick.

## Remark 4: the loto leaves the code

**What was there.** `Volunteer.halfPreference: 'afternoon' | 'evening' | 'any'` and two rules of
the event, `eveningStartsAt` (20h, where the loto hands over to the concerts) and
`afternoonOverflowUntil` (22h, how far a loto answer may run past it), with the words loto and
concerts in the importer, the labels, the validator's messages and the DB enum. See
[[feature-preference-refactor]] for how those two numbers were chosen; that file is now history.

**What replaces it.** `PreferenceSlot { id, label, start, end, overflowHours }` and
`Plan.preferenceSlots`, a list the régisseur edits in the « Tranches horaires du formulaire »
card, in a second section under the refusable tranches. `Volunteer.preferredSlotId: SlotId |
null` names one of them, null being « peu importe ». `DEFAULT_PREFERENCE_SLOTS` is Loto (0 to 8,
overflow 2) and Concerts (8 to 18, overflow 0): the exact rule of 2026-09-08 expressed as two
rows, the asymmetry included. `preferenceMisfit(preferred, window)` returns `tolerated`,
`against` and `toleratedDistance` (the integral of distance from the edge over the tolerated
part), so the solver's quadratic price reads one number rather than recomputing where the
boundary was. The validator names the tranche in its signalement: « a répondu préférer « Loto »
(13/03 12:00 -> 13/03 20:00) et travaille 2h en dehors, au-delà du débordement accepté de 2h ».

**TWO LISTS AND TWO TYPES, NOT ONE, and this was found by two failing tests rather than
decided up front.** The first cut put the preference tranches in `Plan.slots` beside the
refusable ones. `answers.ts` turns « pas avant 18h » into every tranche the sentence overlaps,
so Loto and Concerts came out REFUSED, a hard rule, for everybody with a free-text constraint;
and `gapsBySlot` splits missing hours across the tranche they fall in, so every gap was counted
twice. Both rely on the refusable tranches tiling the event. Preference tranches may overlap and
need not cover it. So `EventSlot` stayed exactly what it was, `PreferenceSlot` is a separate
interface, and nothing that tiles the event with tranches is allowed to see the second list.
In the database it is ONE table, `event_slot`, with `kind in ('refusal', 'preference')`,
`overflow_hours`, and `unique (event_id, kind, slot_key)`: same shape, same RLS, split by
`load_plan` into the two JSON lists.

**The import matches the label, as it does for a refusal.** « Travailler pendant le loto »
contains « loto », and that is the whole match (`matchSlot`, shared by both questions). An
answer naming no tranche is a `reponse-illisible` error and imports as null. The default labels
are « Loto » and « Concerts », not « Soirée » as the remark said, because the label is the form's
own wording and the real form's answer is « Travailler pendant les concerts »; renaming the row
is free for the plan (the id stays) but breaks the next import's matching, and the card says so.

**Older plans lose nothing.** `normalisePlan` reads `preferredSlotId`, then `halfPreference`,
then `half`, carrying 'afternoon' to 'loto' and 'evening' to 'concerts'; a plan carrying the two
old rules and no `preferenceSlots` gets the two tranches built from its own figures. Migration
16 does the same in SQL, per event, guarded by the old columns still existing so it runs once,
then drops `half_preference`, `evening_starts_at` and `afternoon_overflow_until` and the enum.
`rules` is rebuilt field by field in `normalisePlan` rather than spread, so a dropped rule does
not travel.

## Where the code lives

- `tools/src/model.ts`: `PreferenceSlot`, `DEFAULT_PREFERENCE_SLOTS`, `Volunteer.preferredSlotId`,
  `SchedulingRules` down to four fields.
- `tools/src/availability.ts`: `preferredSlot`, `preferenceMisfit`.
- `tools/src/phase.ts`: `DEFAULT_PHASE_HOURS`, `defaultPhaseStart`, `alignPhase`.
- `tools/src/plan.ts`: `Plan.address`, `Plan.preferenceSlots`, `alignPhases`, PLAN_FORMAT 8.
- `tools/src/import.ts`: `parsePreferredSlot`, `matchSlot`, `ImportOptions.preferenceSlots`.
- `app/src/store/setupEdits.ts`: `setEventAddress`, `MAX_EVENT_HOURS`, `setPreferenceSlot`,
  `addPreferenceSlot`, `deletePreferenceSlot`, `preferenceSlotCount`.
- `app/src/screens/SlotsCard.tsx` (two sections), `EventCard.tsx`, `PhaseCard.tsx`,
  `SetupScreen.tsx` (RulesCard down to four), `CateringCard.tsx`, `components/TimeRuler.tsx`,
  `components/labels.ts` (`preferenceLabel` replaces `halfLabel`).
- `db/schema.sql`, `db/migrations/2026-09-13_event_address_and_preference_slots.sql`.

## Not done, on purpose

- `ToDo.txt` was left as the régisseur wrote it; the lines below the first eight (artists,
  billetterie, bracelets) are the next brief and were not started.
- No visual check in a browser this round: the Chrome extension was not connected. The rendered
  HTML is asserted by `screens.test.tsx`; the 62 px ruler and the doubled midnight line are
  worth one look on the deployed tool.
