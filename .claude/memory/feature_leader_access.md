---
name: feature-leader-access
description: "Pole leaders as people rather than rows, built and deployed 2026-09-09: the model split (PLAN_FORMAT 2), their own form import, a 14-character access code, and a read-only view of the whole planning opened on their pole."
metadata:
  type: project
---

**Superseded in part on 2026-09-10, read [[feature-montage-demontage]] first.** The form
imported here is the ORGA form, not a responsables form: a responsable is now an orga holding a
`LeaderRole`, `Leader` is being renamed `Organiser`, and every orga gets the 14-character code,
not only those in charge of a pole. Everything below about the code itself, its length, its
revocation and what it opens stays true.

**State 2026-09-09: built, deployed and verified against the live base.** 160 engine + 216 app
tests, migration 9 applied, `npm run deploy` done, both live events at plan format 2. What was
checked afterwards is at the bottom, under "What the live base actually answered".

## What the régisseur asked for, 2026-09-09

Responsables de pôle fill in **a different form from the volunteers'**, carrying the usual basic
fields (nom, prénom, mail, tel, régime alimentaire). The régisseur imports it the way they import
the volunteers' form, then puts a responsable in charge of **one or several poles**, each with its
own hours, **and those hours may overlap**. No volume limit, no preference, no rule applies: a
leader is recorded, never scheduled.

They then get **the whole planning, read only**, no other tab, their grid opening on **their own
pole's filter**, and **the full fiche of every volunteer**.

## The decision taken before any code, and what it costs

**The credential is an access code, like a volunteer's.** Put to the régisseur as a three-way
choice: a Supabase account with a read-only role (the safest, and what this session recommended),
an access code over the whole planning, or an access code scoped to their own poles. **They chose
the middle one.**

**What that costs, stated at the time and accepted:** a leader's code unlocks the personal details
of all 120 volunteers, so a code forwarded once is the whole register. No password, no second
factor. It is also a widening of an earlier decision in [[feature-admin-ui]] (2026-09-07) which
said a leader sees the numbers of the volunteers **in their own pole** and nobody else's, framed
as a GDPR matter rather than a convenience. The régisseur was told and decided; the association is
the data controller.

**The two mitigations that follow from it, and are therefore built rather than optional:**

- A leader's code is **14 characters** of the 31-letter alphabet, about 69 bits, against 8 and
  about 40 for a volunteer. `LEADER_CODE_LENGTH` in `tools/src/import.ts`.
- The régisseur can **revoke and reissue** per person, from Réglages. Regenerating kills the old
  code immediately, which is the answer to a code forwarded to the wrong person.

## The model split, PLAN_FORMAT 2

`PoleLeader` is gone. In `tools/src/model.ts`:

- **`Leader`** is the person: `key`, `firstName`, `lastName`, `email`, `phone`, `accessCode`,
  `diet`, `allergies`, `note`.
- **`LeaderRole`** is one pole they run: `key`, `leaderKey`, `poleKey`, `start`, `end`.

`Plan.leaders` kept its name and changed its meaning, deliberately: every site that read
`leader.poleKey` broke at compile time and the type checker walked through all twelve.
`Plan.leaderRoles` is new and sits beside it, as `assignments` sits beside `volunteers`.

- **A person may hold several roles on the SAME pole.** The only way to write down a leader
  present 14h to 18h and again 22h to 02h. So a role carries its own key, never the pair's, and
  every screen keys its rows on the role: two rows sharing a person's key would collapse into one
  as far as React is concerned.
- **Nothing about a role is validated.** Overlapping windows are a legitimate answer. No rule, no
  solver weight and no issue code knows leaders exist.
- **`PlanIndex.leadersOn(poleKey)`** owns the join; `polesLedBy(leaderKey)` the reverse. The grid,
  the night view and the printable sheets were each doing it by hand. A role whose leader is gone
  is skipped silently: nothing is scheduled there, so nothing can be lost.
- **`deletePole` cuts roles and keeps people; `deleteLeader` cuts both.** Losing a pole is not
  losing the person who ran it, and they very often run another one.
- **A code is never a side effect.** Not of creating a leader, not of importing the form, not of
  converting an old plan. `giveLeaderCode` in `setupEdits.ts` is the only thing in the tool that
  issues one, behind a button pressed per person. Tested three ways.

## The identity rule, written in three places

**Two records are the same person when they share an e-mail address, and otherwise when they
share a name.** The address first because it is what the leaders' form keys on; the name second
because leaders were typed by hand for a month and most carry no address. Wrong in the safe
direction means one person listed twice, which the régisseur sees and merges; wrong the other way
silently gives one person another's poles.

It is spelled out in three places and **they must agree, or a re-import duplicates somebody the
conversion had merged**:

1. `splitLegacyLeaders` in `app/src/persistence/normalise.ts` (format 1 arriving in the browser)
2. `leaderIdentity` in `tools/src/import-leaders.ts` (re-importing the form)
3. Section 2 of `db/migrations/2026-09-09_leaders_as_people.sql` (the live rows)

**The name is not split by the conversion.** `fullName` goes to `lastName` whole, `firstName`
stays empty. Guessing where a first name ends is wrong for every particle, every compound surname
and every person with two given names, and a wrong guess is somebody's name misspelt on the night.
`leaderName` in `components/labels.ts` trims the join, so each still displays the exact string
typed. `addLeader` in `setupEdits.ts` DOES split on the first space: different situation, the
régisseur is looking at both fields and can fix either.

**Which shape arrived is decided on the rows, not on a format number.** A `poleKey` on a leader is
format 1 and exists on nothing else. That means a plan whose format number is wrong still
converts, which matters because that number is exactly what an older writer got wrong.

## Where the code lives

- `tools/src/import-leaders.ts` + its test: the leaders' form. Eight keyword-bound columns.
  **Written before the real form exists** and safe to be: this form has eight columns naming
  distinct things, where the volunteers' has forty sharing vocabulary. A missing required column
  stops the import and names itself. When the real form arrives, run it through, read the issues,
  adjust a `test` regex.
- `app/src/screens/LeaderImportCard.tsx`: a card at the bottom of the Import tab. **Nobody is
  ever removed** by this import: a leader absent from the file did not resign, and dropping them
  would cut every pole they run.
- `app/src/screens/LeadersCard.tsx`: the people, in Réglages, above the poles. Codes issued,
  revoked and regenerated here; diet and allergies edited here because somebody has to order food
  and no other screen would ever read those two fields.
- `app/src/screens/LeaderView.tsx`: the third door. Code entry, then the régisseur's own grid.
- `GridScreen` gained `readOnly` and `initialPoleFilter`; `ShiftBlock` and `SidePanel` gained
  `readOnly`.
- `db/schema.sql`: `leader`, `leader_role`, both halves of the round trip, and
  `get_leader_planning(p_code text)`.

## How read-only is actually guaranteed

Three layers, and **only the first is load-bearing**:

1. **Postgres.** A leader has no account. Every write in the schema requires `authenticated`, and
   the one function their code reaches is `get_leader_planning`, which is `stable`. An empty code
   is refused explicitly (`access_code <> ''`), so the state every leader starts in cannot be used
   to open anything.
2. **The context.** `LeaderView` renders the grid inside a `PlanContext` whose `apply` and `edit`
   are no-ops. No-ops rather than throws: a throw would take the grid down on a stray click, in
   front of somebody with no way to report it.
3. **The `readOnly` flag.** Ergonomics only. It stops the screen OFFERING what would silently
   fail, which is worse than not offering it. An open padlock that does nothing reads as a broken
   button; its absence reads as "nothing to say here", which is the truth.

**The grid is the régisseur's grid, not a copy.** A second read-only grid would drift over six
months and the leader would end up looking at last month's idea of the plan.

## The migration and the deploy went together, and had to

Applied 2026-09-09: `npm run migrate -- --apply` then `npm run deploy`, minutes apart.

**They cannot be separated.** The migration raises `min_plan_format` to 2, which is its job: it
stops a tab left open across the deploy writing a format 1 document over the converted data. It
also means the previously deployed build lost the ability to save the moment the migration landed.
**Any future migration that bumps the plan format inherits this constraint.**

`pole_leader` on production held **zero rows** when the migration ran, read directly beforehand,
so the conversion converted nothing and the drop lost nothing. The conversion code in section 2 is
therefore UNEXERCISED against real data: what it protects now is the archived version bodies,
which are still format 1 and convert in the browser through `splitLegacyLeaders` on a restore.
If a restore of a pre-2026-09-09 version ever looks wrong, that is the code to read first.

## What the live base actually answered, 2026-09-09

Not to be redone unless the round trip changes. The write half was exercised inside a transaction
that ended in `rollback`, so nothing below was kept.

- `npm run db-check`: every table matches `db/schema.sql`, `leader` and `leader_role` included.
- `npm run anon-check`: every organiser function closed, every table empty to the anon key, and
  exactly three doors open: `get_volunteer_schedule`, `get_public_planning`,
  `get_leader_planning`.
- `load_plan` returns 14 plan fields with `leaderRoles` present, on both live events, both now at
  `plan_format` 2. `min_plan_format` is 2.
- **`get_leader_planning` returns null for an unknown code AND for the empty string.** The second
  is the one that mattered: an empty code is the state every leader starts in, and matching it
  would have opened the planning to `''`.
- A save declaring format 1 is refused with `{"ok":false,"reason":"format","required":2}`. The
  stale-tab guard works, on the first migration ever to use it.
- **One person, three roles, two of them on the SAME pole with overlapping windows (2..8 and
  6..10), survives a save and a reload field for field.** That is the combination the whole split
  exists for. The rest of the plan came back untouched: 120 volunteers, and every assignment,
  shift, pole, buddy, reserve entry, artist and slot count unchanged.
- `get_leader_planning` accepts the code in lower case (it uppercases and trims) and returns the
  person, both their poles, and the full 14-field plan with all 120 volunteers.

**One trap worth remembering: `JSON.stringify` cannot compare two plans.** `jsonb` reorders object
keys, so a correct round trip compares unequal as strings. The first verification reported a false
failure for exactly that reason. Compare field by field.

Deliberately not built: the leaders' codes do not go out through the Brevo contact file the way
the volunteers' do. There are about fifteen leaders against a hundred and twenty volunteers, the
codes are on screen in Réglages ready to copy, and a mail merge for fifteen people is more machine
than the job needs. Say so if that turns out to be wrong.

Sits with [[feature-admin-ui]] (the grid and the Réglages card this changes), [[feature-supabase]]
(the RPC pattern, the RLS posture, the migration runner), [[feature-form-import]] (the importer
this copies) and [[feature-auth]] (the third kind of reader, after the régisseur and the
volunteer).
