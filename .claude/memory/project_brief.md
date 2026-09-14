---
name: project-brief
description: "Loto Tekno volunteer planning tool: full brief, hard/soft constraints, open questions and current decision state. Read this first."
metadata:
  type: project
---

**State as of 2026-09-08. THE TOOL IS DEPLOYED AND IN USE at https://planning.ayaatma.fr:** an
organiser logs in by magic link, the whole admin UI works against Supabase, and volunteers reach
their own shifts with an access code. Every migration is applied. What remains, in the order it
matters: a dress rehearsal with the real form before it goes out in mid-October 2026, sending the
access codes through Brevo (the export exists, the mailing is an organisational decision), and
pole-leader access, which is the first real exercise of the PLAN_FORMAT machinery since it needs
a new field on `pole_leader`.**

**State as of 2026-09-07. The headless engine is complete and verified. Next task: the admin UI.**

Built, typechecking clean, 63 tests passing, exercised over ten generated scenarios: the Postgres
schema (`db/schema.sql`) and the whole `tools/` package. That is the domain model, the
availability arithmetic, the synthetic data generator, the CSV importer, the validation engine,
the solver, the incremental re-solve and the proposal builder. Nothing of the UI exists.

**If you are building the UI, do not read this whole file.** Read [[project-engine-api]] for the
surface to code against and [[feature-admin-ui]] for what is already decided and what is still
open. Come back here only for the why behind a rule.

**How to read this file.** It is written as dated layers, newest last, and later sections
supersede earlier ones. Read it in this order:

1. **The rounds 3 to 6 sections** carry the live model: the four hard form questions, the
   afternoon/evening asymmetry, the two tiers of hard constraints, the objective ordering, the
   test scenario matrix. These are authoritative.
2. **The rounds 7 and 8 sections** say what is built, what was verified, and what the code's
   own invariants are (time in decimal hours, `csv.ts` as the single form-adjustment point).
3. **The rounds 9 to 11 sections** carry the engine as built: the two tiers, the objective
   ranking and its measured weights, the reserve list, and why the 4h floor is a threshold rather
   than a per-hour amount.
4. **"Constraints", "What the tool must do" and "Existing assets"** near the top stay accurate
   for the product requirements: the colour codes, the stars, the dashboard, the volunteer view.
5. **"Open questions" and "Decision state"** are historical. Every question there was answered
   in a later section. Do not act on them.

## The event

Loto Tekno, run by the Aya Atma association. One afternoon plus one evening, single day.
Several poles (Entree, Bar, Volante, Secu, and others), each possibly with sub-poles. Each pole
or sub-pole has shifts (creneaux) of variable length, each needing a given number of volunteers.
Volunteers answer a Google Form; the responses arrive as a CSV.

## What each volunteer declares in the form

- Total volume wanted: 4h, 6h or 8h.
- Choice 1: a pole, plus their own level in it (debutant, intermediaire, expert).
- Choice 2: a pole, plus their level in it.
- One pole they absolutely refuse.
- One or more people they would like to volunteer with (same sub-pole, same time).

## Constraints

Hard (a violation is illegal, shown in red):
- H1: never two assignments overlapping in time for the same person.
- H2: never assigned to their refused pole.
- H3: never more than 4h consecutive, counted across poles, not per pole.
- H4: at most 2 blocks of work in the day, and if there are 2, at least a 2h break between them.
  So 4h, or 4h + 4h, or 4h + 2h, but never 2h + 2h + 2h and never 4h + 2h + 2h.
- H5: total hours must not exceed what the volunteer asked for.
- H6: a shift never holds more volunteers than it needs.

Soft (optimised, shown in the dashboard):
- S1: fill every shift (highest priority).
- S2: maximise choice 1, then choice 2. Never assign outside choice 1 / choice 2 unless there
  is no other way to fill a shift, and list every such case.
- S3: honour buddy requests (same sub-pole, same shift), and make it visible on the grid
  whether each request was honoured.
- S4: avoid stacking too many debutants on the same shift.
- S5: give each volunteer the total volume they asked for.

## What the tool must do

Regisseur side:
- Define poles, sub-poles, shifts per pole/sub-pole, number of volunteers needed, and the pole
  leader with their contact details.
- Import the volunteer list from the Google Form CSV.
- Assign automatically with optimisation, with manual overrides always possible.
- Add and remove shifts; add, remove and edit volunteers.
- **Incremental re-optimisation.** Data changes over time: a shift added or removed, a new pole,
  a volunteer cancelling. A change must not reshuffle the whole plan. Only what is affected
  moves, and when shifts are added or freed, already-assigned volunteers may be re-placed if it
  gives them a better fit. Every change produces suggestions the regisseur validates or rejects.
- Show remaining unfilled slots per pole.
- Colour codes, recomputed after every single change:
  - red on anything impossible (same volunteer on two shifts at once in different poles, 6h in a
    row even across poles because of the mandatory 2h break, and so on),
  - light orange for a volunteer totalling 6h, dark orange for 8h,
  - stars on a shift showing the volunteer's level (debutant / intermediaire / expert).
- Dashboard: how many volunteers did not get choice 1 or choice 2, the list of volunteers placed
  in a pole they chose neither, remaining gaps, honoured and unhonoured buddy requests.
- Multi-user: several organisers consult and edit it online.

Volunteer side:
- Enter first name and last name, see their own shifts, who they are with, and their pole
  leader's contact details. Full read-only access to the whole planning table. No editing at all.

## Existing assets

A WordPress site hosted at OVH, presenting the association and the event. No tool yet.

## Open questions (asked 2026-09-06, not yet answered)

1. Event date, and therefore the real deadline.
2. Number of volunteers, poles, sub-poles and shifts (order of magnitude drives the solver
   choice).
3. **Volunteer availability is not collected by the form.** Someone available only in the
   evening cannot be modelled today. This is probably a required extra form field.
4. Buddy names arrive as free text, so they need fuzzy matching to real volunteers, and the
   request may not be reciprocal. Needs a resolution and review step at import.
5. Does refusing a pole also refuse its sub-poles?
6. Must every shift have at least one experienced volunteer, or a pole leader present?
7. Is "too many debutants" a hard cap or a preference?

## Decision state

Nothing decided yet. Recommendation given on 2026-09-06 was a custom web app (React + Supabase,
solver running client side in TypeScript, linked from the WordPress site) rather than Google
Sheets, an off-the-shelf volunteer tool, or a WordPress plugin. Waiting on the user's answer.
Record the final decision here before writing any code.

## Update 2026-09-06: scale, date and hosting

Answers to open questions 1 and 2:

- **Event date: 13 March 2027.** Roughly 6 months of runway. The real deadline is not the event
  though, it is the day the Google Form goes out to volunteers, because the form fields cannot
  be fixed once answers start arriving. That date is still unknown and needs asking.
- **Scale: about 100 volunteers, about 15 poles and sub-poles, about 200 shifts of 2h.**

Sizing consequences:

- The solver is small. Roughly 100 x 200 = 20 000 assignment booleans, which is trivial for a
  client-side heuristic in TypeScript and would also be trivial for CP-SAT. The client-side
  solver decision holds, no backend needed for it.
- **Capacity is tight and needs checking early.** 100 volunteers at an average of 6h gives about
  600 volunteer-hours, which is 300 person-slots of 2h. 200 shifts covers that only if each
  shift needs one person. If shifts need 2 or 3 people each, the demand is 400 to 600
  person-slots against 300 available, and the tool is then arbitrating a shortage rather than
  optimising comfort. This changes which objective dominates. Ask whether the 200 figure counts
  shifts or person-slots.

Hosting recommendation given (not yet confirmed by the user): split the two questions.

- Subdomain on the existing association domain, for example `benevoles.` or `planning.`. Costs
  nothing, one DNS record, no new domain.
- Front end is a static build, so OVH Pro shared hosting serves it fine from that subdomain.
  Needs an `.htaccess` rewrite fallback to `index.html` for client-side routing, plus the free
  Let's Encrypt certificate on the subdomain.
- Database stays on Supabase in an EU region (Paris or Frankfurt), because OVH shared hosting
  gives MySQL and no WebSockets, so no realtime and no auth.
- Full self-hosting is possible on an OVH VPS but adds setup plus ongoing maintenance for a
  one-shot event tool. Only worth it if the association wants everything on French infra.

**Security point that must not be skipped:** the volunteer view has no login, and the Supabase
anon key is public by construction. Volunteer personal data (names, phone numbers, emails) must
never be exposed through a direct table read. It goes through a `SECURITY DEFINER` Postgres
function that takes a name and returns only that person's own schedule plus their pole leader's
contact, with row level security denying everything else. This is a GDPR matter, not a nicety.

## Decisions 2026-09-06 (round 3). These supersede the Open questions section above.

**Event span is wider than first described.** The three availability slots are 12h-18h,
18h-00h and 00h-06h, so the event runs 18 hours, from midday to 6am the next morning. Not
"an afternoon and an evening". The night slot exists and will be the hard one to staff.

**Availability.** The form gains a question with those three slots. It also gains an arbitration
question: does this volunteer prefer their preferred time slot or their preferred pole when both
cannot be satisfied. That arbitration is a per-volunteer weight flip in the objective, not a new
constraint. **Still unresolved: whether a ticked slot is a hard window or a preference.**
Recommendation given: ticked slots are the hard window (never assign outside), and the
arbitration only applies inside them. Awaiting confirmation.

**Derived rule that constrains the form itself.** Max 4h consecutive plus max 2 blocks plus a 2h
minimum break means:
- 4h total needs a 4h span, so one ticked slot is enough.
- 6h total cannot be one block, so it needs 4h+2h with a 2h gap, so an 8h span minimum.
- 8h total needs 4h+4h with a 2h gap, so a 10h span minimum.
A single ticked slot is only 6h wide, so **anyone requesting 6h or 8h must tick at least two
slots** (adjacent or not; 12h-18h plus 00h-06h works fine, the gap only helps). Anyone ticking
one slot can be given at most 4h. This must be enforced or at least warned about in the form,
and validated at CSV import.

**Buddies.** One-way request is enough, reciprocal consent assumed. Names that fail to match a
real volunteer are surfaced clearly at import with fuzzy-match candidates, and the regisseur
resolves them by hand. Modelling decision: each request is a **pairwise** soft bonus, never a
transitive group, so a chain A wants B, B wants C does not silently create an unplaceable
3-person block.

**Veto** is declared on a pole and applies to that pole and all of its sub-poles.

**Experience.** No expert required per shift by default. A pole or sub-pole may carry an
optional per-pole requirement (for example "at least one non-debutant"). "Too many debutants" is
a soft preference. "Only debutants on a shift" is a hard error shown in red. **Edge case still
open:** a shift needing only one volunteer is 100% debutants as soon as a debutant is placed
there. Proposal given: the red rule applies only to shifts needing 2 or more volunteers, and
1-person shifts use the per-pole requirement instead.

**Pole leaders (responsables) are not volunteers.** They are a separate entity, absent from the
CSV, added by hand by the regisseur in the admin interface. They are never part of the
assignment problem. Their contact details are what a volunteer sees in the volunteer view.

**Hosting confirmed.** Static front on an OVH subdomain, Supabase in an EU region for the data.
The association does not require everything on French infrastructure it controls, so no VPS.

**Volunteer access: a unique per-volunteer code**, rather than a name lookup. This is
complementary to, not a replacement for, the `SECURITY DEFINER` function: the code is
authentication, the function is enforcement. The code must be passed as an argument to the
function so that filtering happens in Postgres, never in the browser. Row level security denies
direct table reads. Codes should be generated by the tool at import (unambiguous alphabet, 8
characters) rather than typed into the CSV by hand.

**New objective: minimise how many volunteers need recruiting.** The tool will be fed
progressively as form answers arrive, and must answer "how much is still unstaffed, where, and
when". This makes the recruitment dashboard a first-class feature, not a phase 5 nicety: residual
person-hours broken down by time slot and by pole, and the reason a gap exists (nobody available
at that hour, versus everybody available has vetoed that pole). **Tension flagged, unresolved:**
minimising the number of volunteers pulls towards concentrating hours on high-volume volunteers,
which can leave a registered volunteer with zero shifts. Asked whether that is ever acceptable,
and whether requested hours are a target or a ceiling.

## Decisions 2026-09-06 (round 4). Form redesigned. Supersedes the availability model above.

**Form goes out mid-October 2026.** The user writes the Google Form himself and wants a review
of it. Fake CSVs will be generated in advance so the tool can be built and tested before real
answers exist.

**Availability is now expressed as refusals plus a half-event choice, not as ticked slots.**
The four hard questions:

1. The pole the volunteer refuses (or "anything suits me"). Applies to the pole's whole subtree.
2. The time slot the volunteer refuses among 12h-18h, 18h-00h, 00h-06h (or "anything suits me").
3. Whether they work the afternoon (12h-18h) or the evening (18h-06h). A special part of the
   event runs 12h to 18h, which is why this exists.
4. An artist of the night they do not want to miss, asked only if they chose the evening.

Question 4 introduces **a new entity in the data model: the line-up**, with artist names and set
start/end times, entered by the regisseur. A named artist becomes a hard forbidden window for
that volunteer. Set times change late in real events, so a line-up change is a first-class
change event feeding the incremental re-solve.

**Consequence the user should be aware of (raised 2026-09-06, awaiting his answer):** question 3
makes the afternoon pool and the evening pool disjoint. The afternoon is a single 6h span, and
6h of span only allows one 4h block, so **an afternoon volunteer can never do more than 4h**.
Only evening volunteers can reach 6h or 8h, and only if they refuse neither evening slot.
Recommended adding a "both / no preference" option to question 3, because it is the only bridge
across 18h and it directly serves the goal of minimising volunteer count.

**All-debutant shift stays a hard error** with no 1-person exception for now, since no pole is
expected to have single-person shifts. If debutants turn out to be too numerous, the escape
hatch is a per-pole exemption flag on the less sensitive poles. Build the flag, default it off.

**Volunteer access codes**: generated by the tool at import, unambiguous alphabet, 8 characters,
passed as the argument to the `SECURITY DEFINER` function. Confirmed.

**Nobody finishes with zero shifts. The absolute minimum is 4h per registered volunteer.** If it
happens anyway, hours are taken from volunteers holding 8h. Requested volume is a ceiling with a
soft target, and since the goal is to minimise volunteer count, the tool should try to use every
hour a registered volunteer offered.

**Design principle that follows: the solver must never return "infeasible".** Split the hard
constraints in two tiers.
- Tier 1, never violated, never present in any output: time overlap, refused pole, refused time
  slot, wrong half of the event, more than 4h consecutive, more than 2 blocks, less than 2h
  break, artist window.
- Tier 2, must not happen but is reported in red rather than blocking the solve: a volunteer
  under 4h, an unstaffed shift, an all-debutant shift.
A régisseur needs the least-bad plan with the problems highlighted, never an error message. This
also matches the user's own stated process: spot the impossible cases, phone the people, fix by
hand, cancel the volunteer if needed.

**Objective ordering** (weights, tunable, not lexicographic):
1. every registered volunteer reaches 4h
2. every shift staffed
3. no all-debutant shift
4. choice 1, then choice 2, never outside choice 1 or 2
5. each volunteer reaches their requested volume
6. buddy pairs honoured
7. debutants spread out
8. stability against the current plan
The "take hours back from 8h volunteers to rescue someone at 0h" behaviour falls out of 1 being
weighted above 5. No special-case code needed. **Relative order of 1 versus 2 is the one pair
worth confirming with the user.**

**Watch item for the dashboard:** if many volunteers name the same headliner, the tool must warn
about a coverage hole at exactly that time, since it is likely to be the peak of the night.

## Decisions 2026-09-06 (round 5). Capacity problem identified.

**Demand is about 600 person-hours**, not the 400 previously assumed. A "creneau" has its own
duration and is not always 2h: it can be one 4h block, or two separate 2h blocks. 600 person-hours
is the figure that matters and the tool computes it from the pole / shift / headcount definition.

**This is the headline finding: 100 volunteers is not enough.** 600 hours over 100 volunteers
requires a 6h average, and 6h is the middle option of three. Volunteers needed:

| Average volume | Volunteers needed |
|---|---|
| 4h | 150 |
| 5h | 120 |
| 6h | 100 |
| 8h | 75 |

A realistic mix lands near 5h, so the recruitment target should be **120 to 130 registrations,
not 100**. Since the goal is to minimise volunteer count and demand is fixed, the only real lever
is raising the average volume, and that lever lives in the form wording, not in the solver.
Raised with the user 2026-09-06, awaiting his recruitment target.

**Consequence for the objective weights:** with a shortage rather than a surplus, the tier-2
constraint "a volunteer ends up under 4h" becomes almost unreachable, and "a shift is unstaffed"
becomes the dominant problem. The question of which of the two prevails is therefore moot in
practice. Keep both weights, do not spend time tuning their relative order.

**Question 3 is asymmetric, and this fixes the earlier capacity worry.**
- "Evening" is hard: never anything between 12h and 18h.
- "Afternoon" is soft in one direction: shifts may overflow past 18h if needed.
- "No preference" is fully flexible.

So the 4h cap identified in round 4 no longer applies to afternoon volunteers, since their usable
span reopens. The only volunteers still capped at 4h are those who choose the evening and also
refuse one of the two evening slots, leaving a single 6h span.

**Open on this point:** how far the afternoon overflow may go. Being assigned 02h-06h when you
answered "afternoon" ignores the answer. Proposal put to the user: overflow allowed into 18h-00h
with a penalty growing with distance past 18h, and 00h-06h treated as hard refused unless the
volunteer answered "no preference". Awaiting confirmation.

> **SUPERSEDED 2026-09-08. Every word of the three bullets above is now wrong**, and the layer
> is kept because the reasoning that replaced it only makes sense against it. Reading the real
> form showed that question 3 is worded as a preference, not an availability, so it stopped
> being a hard rule in either direction: it is scored by the solver and reported, never
> enforced. The boundary also moved from 18h to **20h**, and the accepted overflow from midnight
> to **22h**. The 4h cap argument above no longer applies to anybody, because the only answer
> that still narrows a volunteer's day is the refused slot. See
> [[feature-preference-refactor]] for what the code does, and note the headline: softening this
> took `balanced` from 85/91 créneaux to 91/91 with nothing short, on the same registrations.

**Artist window moves from tier 1 to tier 2.** It is now a red flag in the output rather than an
inviolable constraint, so a shift never goes unstaffed purely to protect someone's artist. Artist
names will be known when the form goes out in mid-October, so the question ships in the first
form as a dropdown. The peak-hour coverage alert on the dashboard is confirmed as sufficient.

**Next action: the user sends the Google Form draft for review.** Then the fake CSV generator.

## Decisions 2026-09-06 (round 6). No recruitment target. Test scenario matrix.

**No recruitment target.** The user does not want one. The tool minimises the volunteer count and
the dashboard simply reports what is still missing. Drop the "120 to 130" target from round 5:
it stays useful as an order of magnitude for sizing test data, not as a goal shown in the UI.

One hard threshold does exist and the dashboard should show it: with 600 person-hours of demand
and a 4h floor per volunteer, **beyond 150 registered volunteers somebody necessarily falls below
4h**. That is the over-recruitment stop signal.

**Test data must span the range**, from heavily under-staffed (many gaps left) to near saturation
(everyone must be placed, preferences collide). Agreed scenario matrix, every dataset generated
from a fixed seed so a regression is reproducible:

Volume scenarios, against 600 person-hours of demand:

| Id | Name | Volunteers | Hours offered | What it exercises |
|---|---|---|---|---|
| V1 | Heavy shortage | 60 | about 330 | Gap dashboard, coverage priority, gap diagnosis by slot and pole |
| V2 | Moderate shortage | 90 | about 500 | Realistic mid-campaign state, November |
| V3 | Exact balance | 105 | about 600 | Hardest case: zero slack, preferences collide head-on |
| V4 | Comfortable surplus | 120 | about 700 | Preference quality, stability of the plan across re-solves |
| V5 | Over-recruitment | 160 | about 900 | The 4h floor breaks, tier-2 red flags must appear and be readable |

Stress scenarios, layered on top of any volume scenario:

| Id | Name | What it exercises |
|---|---|---|
| S1 | Afternoon-heavy pool | 70% pick the afternoon, the night is unstaffed. Gap diagnosis must say "nobody available", not "everyone vetoed this pole" |
| S2 | Headliner pile-up | 40% name the same artist at peak hour, coverage alert must fire |
| S3 | Debutant flood | 60% debutants, exercises the all-debutant red rule and the spreading preference |
| S4 | Buddy tangle | Many buddy requests, including chains A wants B wants C, plus typos and nicknames to exercise fuzzy matching and the regisseur's manual pass |
| S5 | Shunned pole | One pole vetoed by a large share and picked by nobody as choice 1 or 2 |


## Progress 2026-09-06 (round 7). Phase 0 built.

Data model and test-data generator exist and run. Nothing else is built.

- `db/schema.sql`: full Postgres/Supabase schema. Poles with self-reference for sub-poles,
  separate `pole_leader` table (leaders are not volunteers), shifts with their own duration,
  `artist` line-up, volunteers with the four hard form answers, `buddy_request` keeping the raw
  typed name plus a resolution state for the regisseur's manual pass, `assignment` with a
  `locked` flag, and `proposal_batch` / `proposal` so a re-solve writes proposals rather than
  mutating assignments. RLS is on for every table with no anonymous policy, so the only
  anonymous entry points are `get_volunteer_schedule(code)` and `get_public_planning(event_id)`,
  both `SECURITY DEFINER`. **No scheduling rule is a database constraint**, deliberately: the
  regisseur must be able to save a temporarily wrong plan and see it in red.
- `tools/`: TypeScript, zero runtime dependencies, `npm run generate`. Typechecks clean and runs.
  - `availability.ts` holds the real domain logic and the solver will reuse it: `usableWindows`
    encodes the afternoon/evening asymmetry, `maxAchievableHours` derives the span arithmetic,
    `allowedVolumes` is what the form should offer once availability is known.
  - `event-config.ts` builds a synthetic event of 91 shifts over 16 leaf poles totalling **594
    person-hours**, close to the real 600. Editable; the generator prints the resulting total.
  - Scenario sizes were tuned against the realised average, which lands near 4.9h rather than the
    5.5h first assumed, because roughly 20% of volunteers get capped at 4h by their own
    availability answers. `balanced` is 120 volunteers, which comes out within 2h of the demand.
  - Verified: the over-recruitment alert fires on `over-recruited` (165 volunteers, 17 people
    cannot reach their 4h floor), the night ceiling flag fires on `afternoon-heavy`, and the
    headliner alert reaches 51% of volunteers unavailable at peak under `headliner`.

**Time is decimal hours from the event start throughout the code.** 0 is 12:00, 18 is 06:00 the
next day. Real timestamps only appear at export. Keep it that way.

**`tools/src/csv.ts` is the single adjustment point for the real Google Form.** Its
`FORM_COLUMNS` and the value labels next to it are the only place the form wording appears.

## Progress 2026-09-06 (round 8). Importer built. Plan reordered.

**The Google Form is no longer a dependency.** The user pointed out it only matters once real
data exists, and he is right for the code: only the CSV export matters. It still matters as an
irreversible collection decision before mid-October, but that review is now decoupled from the
build and the form spec is already written down in the round-3 and round-4 sections above.

**Plan reordered: build the engine headless first, the UI on top of a working engine.**
Order is now importer, then validation engine, then solver and incremental re-solve, then the
admin UI, then the volunteer view. This front-loads the risky part and means the UI is written
against something that already works.

**`tools/src/import.ts` and `tools/src/text.ts` exist, typecheck clean, verified running.**

- Columns are bound **by keyword, not by exact header text**, so a reworded form question does
  not break the import. Verified against a hand-written CSV whose every question was reworded
  ("Tu préfères l'après-midi...", "Combien d'heures au total ?"): all fifteen columns bound.
  A required column that cannot be bound is reported, never silently skipped.
- Nothing is ever dropped. A contradictory row is imported and flagged, because the regisseur's
  process is to phone the person.
- Import-time checks, all verified firing: `volume-impossible` (the span arithmetic),
  `choix-contradictoire` (a choice inside the refused pole's subtree), `pole-inconnu`,
  `artiste-inconnu`, `choix-identique`, `homonyme`, `binome-soi-meme`, plus the buddy codes.
- Buddy matching in `text.ts`: exact full name, inverted name, first name plus initial, first
  name alone, nickname, then Levenshtein. **Auto-resolution requires a margin**: distance <= 1
  with margin >= 1, or distance <= 2 with margin >= 2. Two similar names collapse the margin and
  the request goes to the manual pass, which is the safe outcome. On the `buddies` stress
  scenario (136 requests, heavy mangling) this auto-resolves 81% and every one of the remaining
  26 carries at least one suggestion. Candidate labels include the CSV row number, which is what
  separates real homonyms on the review screen.
- A first name shared by two volunteers is **never** auto-resolved, however obvious it looks.

**Next: the validation engine.** A pure `validate(state) -> issues[]` over a plan, implementing
the two tiers from the round-4 section, tested on hand-built cases plus deliberately broken
plans over the generated scenarios. It is the harness the solver will be judged against, so it
comes before the solver.

## Progress 2026-09-06 (round 9). Validation engine built.

`tools/src/plan.ts`, `validate.ts`, `plan-fixtures.ts`, `validate.test.ts`, `validate-cli.ts`.
Typechecks clean, 33 unit tests pass, verified running over all ten generated scenarios.

    npm test                                              33 hand-built cases
    npm run validate -- --all                             every scenario, one line each
    npm run validate -- --scenario=balanced --verbose     the full régisseur dashboard
    npm run validate -- --scenario=balanced --broken      one injected violation per tier 1 code

**`blockersFor(index, volunteer, shift)` is the single source of truth for tier 1.** It answers
"why can this person not work this shift, right now". `validate()` uses it to explain existing
assignments, the gap diagnosis uses it to count who could have taken a shift, and the solver
must use it before every placement. One function, never three, so they cannot drift apart.
Tier 2 is deliberately absent from it: an artist clash is a cost, not a veto.

**Codes.** Tier 1: `chevauchement`, `pole-refuse`, `tranche-refusee`, `moitie-evenement`,
`hors-disponibilite`, `duree-consecutive`, `trop-de-blocs`, `pause-insuffisante`,
`volume-depasse`, `sureffectif`, `reference-inconnue`, `doublon`. Tier 2: `sans-affectation`,
`plancher-non-atteint`, `creneau-vide`, `creneau-incomplet`, `que-des-debutants`,
`experience-insuffisante`, `artiste-manque`, `creneau-trop-long`.

**Decisions taken while building, worth keeping:**

- Soft constraints are not issues. Choice 1 versus choice 2, buddies, débutant spread and
  afternoon overflow are quality measures and live in the reports and the summary. Only tier 1
  and tier 2 are issues.
- **Experience is only judged on a full shift.** An incomplete shift is already red for being
  incomplete, and the people still missing may well be the experienced ones. Reporting all three
  would put three red rows on the dashboard for one problem.
- **An undeclared level counts as inexperienced.** A volunteer states a level only for their two
  chosen poles; placed anywhere else there is no evidence they know the job, and this is a
  safety rule.
- **A shift longer than the 4h consecutive cap is a tier 2 data error** (`creneau-trop-long`),
  because nobody can legally hold it. It tells the régisseur to split the shift.
- **The gap diagnosis ranks reasons by how specific a lever they give, not by count.** Under a
  shortage nearly everyone is saturated, so saturation wins every count while explaining
  nothing. Order is indisponible, then refus de pôle, then saturé, and the narrowest reason
  accounting for at least 25% of the blocked pool wins. Verified: `afternoon-heavy` reports a
  time-slot shortage, `shortage-heavy+shunned-pole` reports a shunned pole (25 vetoes against
  28 saturated), `balanced` reports saturation. This is the S1 versus S5 distinction the brief
  asks for.
- validate() never mutates and never throws. A dangling reference is itself a reported issue,
  because the régisseur must be able to save a temporarily wrong plan.

**`greedyFill` in `plan-fixtures.ts` is a baseline, not the solver.** Hardest shifts first,
choice 1 over choice 2, whoever is furthest from their requested volume. No backtracking, no
re-placement, no objective function. It exists so the engine had real plans to chew on, and it
is now the score the solver has to beat. Its numbers on `balanced`: 84/91 shifts complete, 68h
still missing, 41% of hours placed outside both choices, 25% of buddy requests honoured.

**Two properties are asserted on every CLI run**, and both hold on all ten scenarios: the
baseline never produces a tier 1 issue (so `blockersFor` and `validate` agree), and `--broken`
recovers every one of the eleven tier 1 codes it injected.

**Next: the solver**, then incremental re-solve. The objective ordering is in the round-4
section. The engine is the harness it is judged against.

## Progress 2026-09-07 (round 10). Solver and incremental re-solve built.

`tools/src/solver.ts`, `proposals.ts`, `solver.test.ts`, `solve-cli.ts`, plus a refactor of
`validate.ts`. Typechecks clean, 51 unit tests pass, verified over all ten scenarios.

    npm test
    npm run solve                                        scenario "balanced"
    npm run solve -- --all                               base greedy versus solveur, everywhere
    npm run solve -- --scenario=balanced --resolve       désistements, re-solve, propositions

**Shape: greedy construction, then iterated local search by ruin and recreate, plus a swap
descent.** No dependency, deterministic from a seed, about 2.5s for 3000 iterations on the real
size. Iteration-based rather than time-based so runs are reproducible; a time budget exists only
as a safety valve and the result says if it was hit.

**Refactor that made it possible: `LegalityContext` in `validate.ts`.** The tier 1 rules now read
a small interface (`shiftsOf`, `assigneeCount`, `windowsOf`, `isUnder`, plus labels) rather than a
`PlanIndex`. `PlanIndex` implements it over an immutable plan, `SolverState` implements it over
its mutable working state. **The solver therefore owns no copy of the scheduling rules and cannot
drift from the validator.** `isLegal` is the fast yes-or-no path into the very same function.
Verified behaviour-neutral: the 33 validation tests passed unchanged across the refactor.

**The swap descent is the piece that was missing and is worth remembering.** Ruin and recreate
always disturbs staffing, and next to a 3000-per-hour staffing swing a 120-per-hour choice
improvement is invisible, so choice, buddies and débutant spread never moved at all. A swap
exchanges two volunteers between two shifts, leaving both headcounts identical, so the staffing
and floor terms cancel and the lower-ranked terms decide. Two of its three operators are targeted:
one at people parked in a pole they never chose, one at unhonoured buddy pairs.

**Results against the greedy baseline** (`npm run solve -- --all`, 3000 iterations):

| Scénario | base | solveur |
|---|---|---|
| balanced | 84/91, manque 68h, <4h 31, hors choix 40% | 85/91, manque 23h, <4h 4, hors choix 36% |
| surplus | 87/91, manque 39h, 0h 4, <4h 30 | **91/91, manque 0h, 0h 0**, <4h 14 |
| shortage-moderate | 60/91, manque 178h, <4h 20 | 63/91, manque 150h, **<4h 0** |
| over-recruited | 91/91, 0h 4, <4h 59 | 91/91, **0h 1**, <4h 61 |

Tier 1 stays at zero everywhere. Tier 2 roughly halves on most scenarios.

**Two weights were set by measurement, and both are event decisions, not code details.** The
numbers are recorded next to `DEFAULT_WEIGHTS`. `buddy` trades one for one against choice quality
(0 -> 7 requests honoured, 100 -> 31, 400 -> 44, 1500 -> 53, with hours outside both choices
rising to 46%); 100 keeps choice ahead as ranks 4 and 6 require. `stability` at 200 gives 92% of
assignments kept and 26 proposals after five cancellations, against 83%/45 at 3 and 97%/14 at 500,
where three shifts needlessly stay unstaffed. At 200 a move costs 400, so **every surviving
proposal is worth at least that much real improvement**: the régisseur's list holds no cosmetic
churn by construction.

**Stability applies only against a non-empty anchor.** A first solve has nothing to stay close to,
and charging it per placement biased it against making any.

**Bug found and fixed while building:** a locked assignment that failed the legality check was
being silently skipped, so the régisseur's own decision vanished from the plan. `forceAdd` now
carries a locked assignment in whatever it costs and lets `validate()` paint it red, which is the
tool's stated rule. The state stays safe because an illegal lock only ever makes `isLegal` more
conservative around it.

**`proposals.ts` turns a re-solve into add / remove / move lines**, matching the `proposal` table.
A removal and an addition for the same volunteer are paired into one move, chosen by same pole
first then nearest in time, and each line carries the reason it exists (reaches the 4h floor,
moves closer to choice 1, joins a named buddy, fills a gap, or is an illegal leftover being
handed back).

**Open questions for the user, both real arbitrations:**
- Under a heavy shortage the solver spreads people thinner than the baseline: on `shortage-heavy`
  it completes 29 shifts against the baseline's 33, while assigning 21 more hours overall. The
  staffing penalty is linear in missing person-hours, so half-staffed and empty cost the same per
  hour. If a half-staffed shift is worth more than that to the event, the penalty should be
  convex. Not changed unilaterally.
- On `over-recruited` (165 volunteers for 594h), volunteers below 4h went from 59 to 61 while
  volunteers at 0h went from 4 to 1. The 4h floor penalty is linear, so it is indifferent between
  "several people slightly short" and "fewer people at zero". The brief says nobody at zero, which
  is what happens, but whether many people at 2h beats fewer people at a full 4h is the user's
  call.

**Next: the admin UI**, then the volunteer view. The engine is complete: import, validate, solve,
re-solve, propose.

## Decisions and progress 2026-09-07 (round 11). Reserve list, headcount per shift.

Three answers from the user, and what each cost.

**1. The lock is per box, not per shift.** The UI draws one box per volunteer needed on a shift
(5 needed, 5 boxes), and the régisseur locks a box, meaning one person. **That is exactly what
`Assignment.locked` already was**, so nothing was built. The earlier idea of a `Shift.locked`
field was a misreading of the UI model and was dropped. `db/schema.sql` now spells the box model
out above the `assignment` table so the next reader cannot make the same mistake.

**2. Headcount varies per shift, from a per-pole default.** `Pole.defaultHeadcount` is a starting
value copied into a shift at creation and never read again: raising it later must not silently
rewrite shifts the régisseur has tuned. `Shift.headcount` was already per shift and is still the
only figure anything downstream reads, so the solver and the validator were untouched. The
generator now models rush hours (`headcountOverrides` in `event-config.ts`): Bar / Service runs 7
at 20h-02h and 3 at 14h-18h against a default of 5. Total demand deliberately still 594h.

**3. "Toute personne placée sert", so the staffing penalty stays linear.** No minimum viable
headcount per pole. If shifts are short the association recruits more, or phones people to see if
their constraints can move. Settled, do not revisit. Measured beforehand, the linear penalty was
not the problem it looked like: on `shortage-heavy` the solver leaves 28 shifts empty against the
baseline's 47, and brings 26 to at least half staffed against 8, at the cost of 4 fewer complete
shifts. It converts empty into half tenu; it does not dismantle complete shifts.

**4. The reserve list exists, and reserve means zero hours.** The user was explicit: someone in
reserve holds no shift, so that "we did not need you in the end" is a sentence that can actually
be said. `Plan.reserve` is validated state like an assignment, and `volunteer.on_reserve` in the
schema. A reserve volunteer at 0h is never an error.

**The floor penalty had to change shape, and this is the part worth remembering.** A per-hour
floor cannot tell "four people at 2h" from "two people at 4h and two at zero": both are eight
hours short, both cost 80000, so the solver shrugged and spread hours thin, which is exactly why
`over-recruited` had 61 people under 4h. The floor is now **a fixed penalty for being under 4h**
(`floorBelow` 30000) plus a small per-hour tie-break (`floorPerHour` 2000). That says what the
rule says: 4h is a threshold to reach, not a quantity to approach. `reserve` costs 20000, dearer
than finding someone real work and cheaper than leaving them at zero unexplained.

Result on `over-recruited` (165 registered, ceiling 148), against the previous round:

| | avant | après |
|---|---|---|
| créneaux | 91/91 | 91/91 |
| à 0h sans explication | 1 | **0** |
| sous 4h | 61 | **18** |
| en réserve | n/a | **22** |

Reserve fires on `over-recruited` and **nowhere else**: zero on all nine other scenarios. The
guard is what does it. A volunteer is only offered to the reserve when they hold no hours AND
there is not one legal free place anywhere they could take, so reserve means "there is nothing
for you", never "I could not be bothered". A ruin operator calls people back off the reserve,
without which it would be a one-way door. Verified end to end: five cancellations on
`over-recruited` produce five call-ups, 95% of assignments kept, all locks held, 91/91 back.

New tier 2 codes: `reserve-injustifiee` (someone in reserve while a gap they could fill exists,
which catches a stale list after shifts are added) and `reserve-affectee` (in reserve yet holding
a shift). New proposal kinds `reserve` and `unreserve`, listed first in the batch because they
are the only lines that mean telling somebody they are not needed. The gap diagnosis now leads
with the reserve when one of them could take the shift: it is the one gap with a phone number
attached.

**Defect fixed in passing: the French was silently masculine.** Messages built from a volunteer's
name read "il", "est placé", "s'est inscrit", "Le met avec". Roughly half the volunteers will be
women, so every such message was wrong for them. All user-facing strings now avoid pronouns and
participle agreement: impersonal turns ("placement dans"), "lui" (neutral), or naming the person
again. **Any new French string naming a person has to pass the same bar.** See
[[feedback-no-em-dash]] for the neighbouring rule about user-visible text.

63 tests pass, zero tier 1 on all ten scenarios, all eleven injected tier 1 codes still caught.

**Next: the admin UI.**

## Update 2026-09-10: the scope widens to orgas and to the montage / démontage

The event is three moments, not one. What the whole tool has modelled until now is **l'exploit**,
the 18 hours from 12h to 06h. Around it sit a **montage** over several days before and a
**démontage** over several days after, each its own grid with its own poles and its own rules.
And there are two kinds of person, not one: **bénévoles**, who answer the volunteer form and are
scheduled under every rule in this file, and **orgas**, who answer what this repository has so
far called the responsables' form and are subject to none of them. A **responsable** is an orga
put in charge of a pole, chosen from the list of orgas.

The whole of it, the régisseur's words, the three decisions taken with them, the model and the
two grids, is in [[feature-montage-demontage]]. **Built, migration 13 applied and deployed the same day.** Nothing in the sections above changes: every rule in this
file is the exploit's. The one thing the exploit gained is that an orga may hold a place in a
créneau, which is why every capacity read now goes through `PlanIndex.headcountOf` rather than
`shift.headcount`.

## Update 2026-09-12: feeding everybody, and the drink tickets

A fourth thing the tool owes somebody, and the somebody is not the régisseur: **le traiteur**. The
régisseur's brief, in full, is quoted in [[feature-catering]]. What it asks for is two numbers and
a list: how many people eat at each service, how many of them are not on the standard plate, and
what the allergies are. Drink tickets ride along because they are earned the same way.

Two rules, and they are not the same rule. On the exploit a meal is **earned** by the hours
worked, as steps the régisseur types in Réglages ("4h → 1 repas, 6h ou 8h → 2 repas"), with a
floor for the orgas that lifts and never caps. On the montage and the démontage a meal is
**eaten**: whoever is placed on the grid at the hour of the service has it. The régisseur then
ticks and unticks per person, and only their disagreements with that reading are stored.

Nothing in the sections above changes. No rule of this file reads a meal, the solver never sees
one, and no plate is ever refused: the catering counts what the planning already decided, and
says so out loud where the two disagree.

**Built 2026-09-12. Migration 15 is applied since; PLAN_FORMAT was 7.**

## Update 2026-09-13: the tool stops being the Loto Tekno's

The régisseur's ToDo, first eight lines, applied in one round; the full account is in
[[feature-event-abstraction]]. The event has an address and may run a week. The montage ends
where the event starts and the démontage starts where it ends, two days each by default, and
nobody types those edges any more. The loto and the concerts left the code: what a volunteer
prefers is one of the event's own preference tranches, each with its own tolerated overflow, and
the Loto Tekno is now two rows the régisseur could rename or replace. The day is written on the
exploit's axis. **Migration 16 is written and not yet applied; PLAN_FORMAT is 8.** The rest of
the ToDo (artists, billetterie, bracelets) is the next brief and is not started.
