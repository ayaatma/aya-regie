---
name: feature-display-names
description: "The short label a person is drawn under, reworked 2026-09-09: the surname grows only as far as it takes to tell two people apart, and the form's Surnom answer replaces the first name. PLAN_FORMAT 3, migration 10."
metadata:
  type: project
---

**State 2026-09-09 23:20: built, green, and migration 10 is applied.** 170 engine + 218 app
tests. The ledger lists sequence 10 as applied and the run's own check answers "la base a bien
tout ce que db/schema.sql décrit", so the two columns are really there, not merely recorded.
**The deployed bundle was not checked against the server**; `npm run deploy` is the developer's.

## What was asked, 2026-09-09

Two lines in `ToDo.txt`, both about the form:

- « Si 2 personne on la même prénom initiale, mettre la 2ième lettre »
- « Si surnom => surnom + nom de famille »

Widened in the same message to "toutes les personnes travaillant sur le projet (bénévole,
salarié, responsable, partenaires confondus)". The model has volunteers and leaders and nothing
else, so the collision universe is those two, together.

## The rule, in one place

`tools/src/display.ts`, `shortNames(people)`, one label per person in the order given.

1. The given part is the nickname when the form carries one, the first name otherwise.
2. The surname is cut at the **shortest prefix that separates this person from everybody else
   sharing their given name**, folded for case and accents. One letter when nothing collides,
   three when two Marie both have a name in D.
3. **Only the people who collide grow.** Three Marie, two of them Mar-something, gives
   "Marie Mart.", "Marie Marc." and "Marie D.", not three four-letter cuts. Per-person minima
   can never collide with each other: if A is unique at one letter, nobody else starts with it.
4. A cut that reaches the whole surname loses the full stop ("Jean Ma", not "Jean Ma."), because
   the dot would claim an abbreviation that is not one.
5. Two people the tool cannot tell apart, same given name and same surname, **both keep their
   whole name and read identically**. Nothing is invented to separate them: an index number on a
   grid box would say something about a person that is not true, and two identical labels at
   least show the régisseur there are two.
6. The universe is deduped by the identity rule first (address, else registered name), so a
   leader who also signed up as a volunteer does not push their own surname longer for no reason.
   That is a fourth statement of the rule, on display only; see the warning in
   [[feature-leader-access]] about the three that must agree.

`fold` here is NOT `normalise` from `text.ts`. `normalise` collapses punctuation and spaces, so
its output no longer lines up index by index with what it was given, and this fold decides where
to cut a string that is then shown as typed.

## Where it is computed, and why it is stored in Postgres

`PlanIndex.volunteerShortName` / `leaderShortName`, built on first use, volunteers and leaders in
one pass. `ShiftReport.stars[].short` carries it to the grid. `app/src/components/layout.ts`
used to hold a `shortName(name)` that cut the string on its own; it is gone, and the comment
where it stood says why: **how much of a surname a box needs is a question about the whole
roster, and a function handed one string answered it confidently and wrongly.**

The database cannot ask that question either. `get_volunteer_schedule` (the `avec` list) and
`get_public_planning` name one person at a time, so they read `volunteer.display_name`, a column
the browser writes on every save through `forDatabase()` in `supabaseStore.ts`. **Deliberately
derived and deliberately stored:** the alternative was a second implementation of `display.ts` in
PL/pgSQL that has to agree with the first one forever, about people's names. It is not part of
`Plan`, `load_plan` does not return it, and every save recomputes all of them.

`write_plan_body` falls back to the old `Prénom N.` form when a document carries no label, and
migration 10 backfills existing rows with the same thing. So the volunteer view is never worse
than it was an hour before the deploy, and it becomes right at the first save.

## The nickname

`Volunteer.nickname`, from column 4 of the real export, "Surnom (si tu préfères qu'on t'appelle
par celui-ci)". **It was one of the three decoys** listed in [[feature-form-import]]: the matcher
for the preference question is anchored on `ce que tu preferes` and not `prefere` precisely
because this header also says "préfères". It is now bound by its own matcher, `^surnom`, which
runs early enough to take the column before the preference matcher looks at it. The tight anchor
stays anyway: the day the form rewords the surname question is not the day to discover the
preference matcher was relying on it.

Read everywhere it helps and nowhere it could mislead:

- short labels: it replaces the first name;
- the import review and the printable volunteer sheets: shown in brackets after the registered
  name, because somebody at the welcome desk says "c'est moi, Titi" and the sheet is read against
  an identity;
- identity, exports, the Brevo file, the buddy matching: untouched. Two people may go by the same
  nickname, and a surname does not stop being somebody's because they go by Titi.

`reconcile.ts` compares it like any other answer, so a re-import shows a nickname that changed.

## What shipping this needs

The README's own checklist, followed to the letter. `PLAN_FORMAT` is **3**, and
`db/migrations/2026-09-09_nickname_and_short_labels.sql` (sequence 10) carries the two columns,
the four functions, the backfill and `min_plan_format = 3`. **It must ship with its deploy**: a
browser built before today writes every volunteer back without a nickname.

## The fixtures were left alone, on purpose

`app/public/fixtures/*.json` carry no `nickname`, and the app reads them through `normalisePlan`,
which fills it in as empty. Regenerating them means `npm run generate` first, and **`tools/out/`
is gitignored and stale**: rebuilding `balanced` from a fresh CSV moved the buddy count from 56
to 30 and the score by 15%, which is the accumulated drift of every generator change since that
CSV was written, not this one. That is a separate decision with its own measurements to redo, so
the fixture was restored as it was.

The generator does write nicknames now, for whenever they are rebuilt, and it draws them with a
hash of the name rather than from `rng`: **any draw from `rng` shifts every later one**, so
reaching for it would have silently rewritten every scenario the measurements in
[[feature-admin-ui]] rest on.

`screens.test.tsx` now reads fixtures through `normalisePlan` like the application does. Casting
the JSON straight to `Plan` was a lie the type checker could not catch, and the screens were
running against volunteers with holes in them.
