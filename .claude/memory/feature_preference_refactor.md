---
name: feature-preference-refactor
description: "The 2026-09-08 refactor: the loto/soirée answer stopped being a hard rule and became a scored preference, and pole refusals became a list. What moved, what it cost, and the two numbers it was waiting on."
metadata:
  type: project
---

**SUPERSEDED IN PART ON 2026-09-13, see [[feature-event-abstraction]]:** `HalfPreference` and the two rules `eveningStartsAt` / `afternoonOverflowUntil` no longer exist. The answer is `Volunteer.preferredSlotId`, naming one of `Plan.preferenceSlots`, and the two numbers below live on as the Loto tranche (0 to 8, overflow 2) and the Concerts tranche (8 to 18, overflow 0). The weight measurements and the refusals-as-a-list part still stand.

**Done 2026-09-08, engine to database, and it changed the model's central doctrine.** Two things
the form asks were being read as something they are not. Both are fixed. 111 engine tests and
117 app tests pass, both projects typecheck, the app builds.

The decisions behind it are in [[feature-form-import]]; this file is what the code now does.

## 1. "Qu'est ce que tu préfères ?" is a preference, and nothing may treat it as a rule

`EventHalf` is now **`HalfPreference`**, and `Volunteer.half` is **`Volunteer.halfPreference`**.
The rename is the point: the old name invited every reader to keep treating it as availability,
which is what two tier 1 rules did.

**What was deleted.** `TIER1.moitieEvenement` no longer exists. `availability.ts`'s
`usableWindows` no longer takes the preference at all, and its only remaining input is the
refused slot. `validate.ts` carries a comment where the two rules were, saying that nothing here
may read the field. **The hard answer about time is `refusedSlot`, and it is the only one.**

**What replaced it.** A two-part cost in the solver, and a tier 2 signalement:

| Answer | Free | Tolerated, quadratic | Against, flat 1500/h |
|---|---|---|---|
| loto (`afternoon`) | before 20h | 20h to 22h | past 22h |
| soirée (`evening`) | from 20h | nothing | before 20h |
| peu importe | everywhere | | |

`preferenceMisfit()` in `availability.ts` returns `{ tolerated, against }` and is the single
source both the solver and the validator read. `TIER2.preferenceContrariee` fires once per
person on the `against` part only: **the tolerated overflow is the plan working as intended and
is never a signalement.** `VolunteerReport` publishes `toleratedOverflowHours` and
`againstPreferenceHours` where it used to publish one `overflowHours`.

## The two numbers, and they were not the ones first given

`eveningStartsAt: 8` (20h) and `afternoonOverflowUntil: 10` (22h), in hours from a midday start.
They were 6 (18h) and 12 (midnight). The régisseur corrected both: the boundary is 20h, not 18h,
and the accepted overflow ends at 22h, not at midnight. **The après-midi / soirée boundary and
the loto / concerts boundary are the same line**, which is why there is still only one field.

## The weight, measured rather than argued

`againstPreference: 1500` per hour, between `outsideChoice` (800) and `staffing` (3000).
`npm run preference` re-runs the table. 1000 iterations, five seeds averaged:

|  poids | balanced créneaux | manque | contre | shortage-moderate créneaux | manque | contre |
|---|---|---|---|---|---|---|
|     0 | 90.2/91 |   2h | 186h | 73.2/91 | 119h | 143h |
|   400 | 89.2/91 |   7h | 146h | 73.8/91 | 120h | 118h |
|  1500 | 89.2/91 |   5h |  95h | 75.8/91 | 121h |  94h |
|  3000 | 88.2/91 |  14h |  63h | 74.0/91 | 126h |  66h |
|  6000 | 85.4/91 |  34h |  51h | 73.6/91 | 131h |  48h |
| 20000 | 83.2/91 |  41h |  39h | 73.2/91 | 135h |  35h |

**1500 is the last row that costs nothing.** At zero the preference is decorative; from 3000 the
solver starts leaving shifts short to protect an answer, and by 6000 it is five créneaux and 30 h
down, which is the old hard rule coming back wearing a price tag. Same knee on
`balanced+afternoon-heavy`. The residual breaches are structural, which is why 20000 buys little.

## What softening it bought the event, and this is the headline

**`balanced` went from 85/91 créneaux and 60 h short to 91/91 and nothing short.** The same 165
registrations now cover the whole event. The hard rule had been refusing placements volunteers
would have accepted, and it was refusing them silently. `surplus` also reaches 91/91 from 89.

**Consequence that broke two tests, and will surprise the next reader: `balanced` is no longer a
shortage scenario.** Two screen tests asserted on gaps that no longer exist and now ask for
`shortage-moderate` explicitly. Zero tier 1 on every scenario, as before.

## 2. Pole refusals are a list

`Volunteer.refusedPoleKey: string | null` is now **`refusedPoleKeys: string[]`**. The form asks
the question with checkboxes, so somebody can rule out three poles and only one was kept. It is
a hard constraint, so a dropped refusal is somebody standing in a pole they wrote down that they
would not work.

`refusedRootOf()` in `validate.ts` is the one helper both the legality check and the report pass
use, and it returns the *first* matching root because the sentence names one pole and one is
enough to make the placement illegal. The generator now produces a second refusal 30% of the
time, so the list code is actually exercised.

## The database

`db/migrations/2026-09-08_preference_and_plural_refusals.sql`, and **this one runs against a
database holding a real plan**, so it is idempotent throughout and carries the existing
refusals across before dropping the column.

- `event_half` -> `half_preference`, `volunteer.half` -> `volunteer.half_preference`. No value
  changes; the three answers still mean the same thing.
- `volunteer.refused_pole_id` becomes the table **`volunteer_refused_pole`**, modelled on
  `volunteer_artist` because it is the same shape. RLS and the organiser policy included.
- The two `event` defaults move to 8 and 10. Existing rows keep what the régisseur set.

**`load_plan` and `write_plan_body` in the migration are lifted verbatim from `schema.sql` by a
script, never retyped.** That is not tidiness: hand-reconstructing `load_plan` from partial
reads produced something subtly different from the real one (slot ordering, and the `||` pattern
that omits optional pole fields rather than nulling them), and pasting it would have regressed
all of it silently. **If either function is edited again, edit `schema.sql` and lift.**

Verified without a database, the same way as before: 63 + 11 top-level statements and 32 + 22
function-body statements parse clean against the real Postgres 17 grammar, and 70 fields over 10
interfaces are carried in both directions. Column names and type coercions are still only proven
by the first paste into the SQL editor.

**Rebuilding the throwaway SQL scripts cost more than the twenty minutes [[feature-supabase]]
estimates, and for two avoidable reasons worth writing down.** `@pgsql/parser`'s `parse` is
async: use `await loadModule()` then `parseSync`. And two hangs that were not hangs: slicing the
whole file per character made the statement splitter quadratic on a 40 KB schema, and an
all-comments filter written as a nested quantifier backtracked catastrophically. Both looked
exactly like a wasm deadlock.

## Known gap, pre-existing, not touched

**A refusal naming a pole the plan no longer has survives in the app and is dropped by a
database round trip.** `deletePole` deliberately keeps a volunteer's answer as they gave it
(there is a test for that), but `write_plan_body` resolves refusals by key through an inner join,
so an unresolvable key vanishes on save. The old `refused_pole_id` lost it the same way, so this
is unchanged behaviour, not a regression. Fixing it means storing the raw key rather than a
reference, which is a schema decision nobody has taken. Flagged to the user 2026-09-08.

## Where the persistence boundary handles the rename

`app/src/persistence/normalise.ts` now normalises volunteers field by field, and it is **the one
place in the app allowed to read the old names**: `half` -> `halfPreference` and a singular
`refusedPoleKey` -> a one-element list. A plan saved before today would otherwise load with an
undefined preference and no refusals at all, which is every veto silently gone.

Related: [[feature-form-import]], [[project-engine-api]], [[feature-supabase]],
[[feature-admin-ui]], [[project-brief]].
