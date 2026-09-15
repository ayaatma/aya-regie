---
name: feature-admin-ui
description: "The admin UI as of 2026-09-09: the forty-three decisions taken, the four measurements not to redo, the bugs found and what caused them. Grid, grouped proposals, dashboard, recruitment, Réglages, import, printing, keyboard and the phone night view are done; Supabase, plan history, the volunteer view and the pole-leader phone access are not."
metadata:
  type: project
---

**Status 2026-09-08: everything the régisseur touches on a laptop is built and working.** The
grid, the proposals screen, the dashboard, the recruitment view, Réglages (rules, poles, shifts,
leaders, the event itself and the form's time slots), import from a file or a Google Sheet link,
a printable page of every schedule, keyboard navigation on the grid, and a read-only night view
on a phone. **103 engine tests, 109 app tests**, typecheck and build clean. Read
[[project-engine-api]] for the surface the UI codes against.

## Where the code is

```
app/
  vite.config.ts        Vite + React. Aliases @engine/* to ../tools/src and rewrites the
                        engine's Node-style .js imports to .ts. The engine is shared verbatim
                        with the CLIs, never copied.
  src/engine.ts         The single door onto the engine. No screen imports @engine/* directly.
  src/store/edits.ts    Every edit as a pure function on Plan. No rule check lives here.
  src/store/store.tsx   The working copy: immutable plan, undo stack, autosave, conflict state.
  src/store/applyProposals.ts   Applying accepted groups, with prerequisites and dependents.
  src/store/setupEdits.ts       Poles, shifts, leaders and rules. Destructive ones come with a
                                companion that prices them first.
  src/solver/           The solver in a Web Worker, plus the hook that drives it.
  src/persistence/      PlanStore interface, FixtureStore (fixtures + localStorage), and
                        normalise (everything from storage comes through it).
  src/components/       ShiftBlock (the boxes), TimeRuler + LaneRuler, PoolPanel + InfoPanel +
                        VolunteerFiche + selection.ts (the two right-hand panes, see the 2026-09-11
                        entry below; SidePanel and PhasePool are gone), drag, layout,
                        poleColours, relations (buddiesOf), labels, gridNav (the arrow keys, as
                        pure geometry), useIsPhone, clock + ClockField (the 24 h hour field
                        every Réglages hour goes through).
  src/import/sheet.ts   Google Sheet URL to a CSV request, and the private-sheet answer.
  src/screens/          GridScreen, ProposalsScreen, DashboardScreen, RecruitmentScreen,
                        SetupScreen (+ EventCard, SlotsCard), ImportScreen, PrintScreen,
                        NightView, PlanPicker.
  src/**/*.test.ts(x)   npm test. Edit invariants + a server render of every screen.
```

`npm run dev` in `app/`. Fixtures from `npm run fixture -- --all` in `tools/`, which writes
`app/public/fixtures/*.json` plus a manifest. All ten scenarios export with zero tier 1.

## Decisions taken 2026-09-07, first round

1. **Build the grid on fixtures first, wire Supabase after.** Everything above `PlanStore` is
   written against the interface, so the swap is `main.tsx` plus one class.
2. **Working copy in memory, autosave with an optimistic lock.** Immutable plan, 100-deep undo,
   revalidate on every edit (4 ms). Saving 1.2 s after the last edit against the version the copy
   was built on; a store that moved on refuses and the conflict becomes a banner. No realtime.
3. **Desktop grid, phone view for the night.** The night-of read-only view is still to build.

## Decisions taken 2026-09-07, second round (user feedback on the first version)

4. **Keeping a volunteer in one place is a solver weight, not a shift-length change.** See the
   measurements below. Fine-grained shifts describe the *need* (a rush hour carries more people
   than a quiet one in the same pole, and 4/6/8 h volumes need granularity to compose). The
   weight gets the tidiness without losing that. Shift length per pole stays the lever for the
   residue, and it belongs in Réglages, not hardcoded.
5. **Proposals are accepted as groups, never line by line.** The dependency is directed. See
   below: this is the single most important thing in this file.
6. **Red belongs to a box, never to a person, and never to a gap.** An unfilled shift is not red.
   A problem on somebody's evening shift does not colour their afternoon box.
7. **Pole colour lives on `Pole.colour`,** so it travels with the plan and reaches a DB column.
   Presentation only; nothing in the engine reads it.

## Decisions taken 2026-09-07, third round

8. **A problem with a shift is drawn on the shift, not on the people in it.** `SHIFT_SCOPED` in
   `validate.ts` lists the codes that are about a shift and about no box: `sureffectif`,
   `que-des-debutants`, `experience-insuffisante`, plus the three that never named a volunteer
   anyway. They stay in `ShiftReport.issues` and are kept out of `stars[].issues`. Five débutants
   on one shift are not five faulty people, they are one shift short of an experienced pair of
   hands, and outlining five boxes says the opposite of what the régisseur has to do about it.
   **The border keeps the tier distinction the legend teaches**: solid red for tier 1, dashed
   orange for tier 2. The user asked for a red border; going literal would have contradicted the
   legend they can now read, so this was flagged to them as a deliberate deviation.
9. **One colour per root pole, inherited by every sub-pole.** Bar, Bar / Service and Bar / Plonge
   are one place with three stations. The picker in Réglages therefore sits on the root, and
   Réglages is grouped by root instead of listing leaves flat.
10. **The hour axis repeats once per root pole, not once per row**, and the pole heading is large
    and in the pole colour, with real space before the next pole. The group, not the lane, is the
    unit of the grid's rhythm.
11. **The per-shift N/M counter strip is gone.** It cost 15 px on every shift for a figure the
    dashed boxes already imply. The exact count moved into the block tooltip, along with whatever
    is wrong with the shift, so the border always has its explanation one hover away.
12. **Refusals get their own line in the volunteer panel**, as chips, rather than a clause at the
    end of a grey sentence. Placing somebody in a slot or pole they ruled out is a tier 1 issue,
    so the veto has to be visible without hunting for it.

## Decisions taken 2026-09-07, fourth round

13. **"Recalculer jusqu'à stabilité"**, backed by `solveToConvergence` in `solver.ts`. It runs
    rounds until three consecutive searches find nothing, capped at 24 rounds and 120 s, and
    returns one batch measured against the plan it started from. The first version of this
    stopping rule was wrong; see the section below, it is the most useful thing in this file
    after the proposal grouping. Locked places are safe by construction: `solve`
    refuses every mutation touching one, so running it a dozen times cannot erode a guarantee it
    never relaxes once. A test asserts it end to end, over a multi-round convergence, including
    that no `reserve` line ever names somebody holding a locked place.
14. **Shift-wide issues stay out of a person's report entirely**, not just off their box:
    `issuesByVolunteer` now skips `SHIFT_SCOPED` too. A volunteer on an all-débutants shift is no
    longer coloured red and no longer carries a signalement they can do nothing about.
15. **The status chips in the panel are derived from tiers, never from `VolunteerReport.colour`.**
    Red wins in `colour`, so using it announced anyone with a single tier 2 remark as "Planning
    illégal". Now: red only on a real tier 1, orange "À surveiller" on a tier 2, and orange "Hors
    choix" for a placement outside both chosen poles, which is a quality result and not a fault.
16. **A bin appears while a box from the grid is dragged**, near the pointer, and grows when the
    drop would land. The side panel already accepted a drop, but it is a narrow strip on the far
    right of a wide grid. Dragging from a pool shows nothing: there is no assignment to remove.
17. **Selecting a box highlights that person's other boxes in blue and their buddies' in green.**
    `buddiesOf` in `components/relations.ts` reads `plan.buddies` in both directions, because the
    régisseur does not care who wrote whose name down.
18. **`Plan.leaders` exists**, as `PoleLeader[]`, matching the `pole_leader` table already in
    `db/schema.sql`. Leaders hang off the root pole: you call the head of the bar, not the head
    of the plonge. They are never volunteers and nothing ever schedules them.
19. **Réglages is finished.** Scheduling rules, pole create/rename/delete, sub-poles, per-pole
    defaults, colour, shift add/delete/retime, pole leaders, and a per-pole shift regeneration
    tool. Every destructive action states its price before the second click, and none of them
    ever moves a volunteer somewhere else to tidy up: they remove, or they refuse. Deleting a
    pole leaves volunteers' stated choices exactly as given, dangling reference and all, because
    rewriting what somebody said they wanted is the one thing this tool must not do.

## Decisions taken 2026-09-07, fifth round

20. **The lock is now enforced by the edit layer, not just by the solver.** `edits.ts` refuses
    `move`, `unassign`, `swap` (either side) and `setReserve(true)` on a pinned box. It had been
    the stated invariant since the grid was designed, and only the solver honoured it: by hand a
    locked box could still be dragged, exchanged, binned, or wiped by reserving its owner. An
    earlier version of `move` deliberately carried the lock along, reasoning that dragging a
    pinned box was the régisseur changing their mind. It is not: the point of pinning is that a
    drag across a dense grid cannot move it by accident. The way through is to unlock, one click.
    In the UI a pinned box is not `draggable`, is not an exchange target, and offers no bin.
21. **"Chef de pôle" is "Responsable de pôle"** everywhere the régisseur reads it.
22. **`PoleLeader` has optional hours** (`start`/`end`, decimal hours or null), editable in
    Réglages and drawn as a band on the pole's own axis on the grid. The question it answers is
    the 3 a.m. one: the bar having nobody in charge between 02h and 04h is a gap you see rather
    than work out. No rule reads them; a leader with no hours draws nothing.
23. **The panel's first pool is "Disponibles": everyone with hours left to give**, most first,
    each saying how much is left. "Sans affectation" only ever showed people at zero, which is
    the smaller half of the question: somebody down for 2 h of the 8 h they offered is just as
    available and far easier to miss. It is renamed "À zéro" and kept.
24. **The buddy weight is 5000, up from 100**, on request. See the measurement below. The "sauf
    si" in that request needs no weight at all: a pole somebody refused is a tier 1 rule, and the
    measurement confirms volunteers in a refused pole stay at zero at every weight tried.

## Decisions taken 2026-09-07, sixth round

25. **A pole lock, distinct from a box lock and never merged with it.** `Pole.locked` says "the
    solver leaves this pole and its sub-poles exactly as they are", and is aimed at the solver
    only: the régisseur keeps dragging inside a locked pole. `Assignment.locked` is the other
    thing, pinned against everybody.

    The implementation detail that matters: `SolverState` keeps `pinned` (untouchable during
    this search) apart from `ownLocks` (the assignment's own flag), and `toAssignments` writes
    `ownLocks`. Merging them would have written a lock into every box of a locked pole, so
    unlocking the pole later would leave every one of its places individually pinned forever.
    Additions are refused in `canAdd`, which covers swap, relocate and recreate in one place.
26. **`Plan.lengthHours` is explicit**, no longer inferred from the last shift. The grid spans
    the event, not the shifts, and it still stretches past the end when a shift or a set was left
    there: shortening an event hides nothing.
27. **The event itself is editable**: name, start (a real timestamp), duration, and the line-up
    with each set's hours. Moving the start slides the whole plan without rescheduling anything,
    which is what the decimal-hours model was for. Deleting a set keeps the answers of the
    volunteers who named it, same rule as deleting a pole.
28. **The dashboard leads with the number of volunteers imported.** Every other figure on the
    coverage card is meaningless without it.
29. **`Pole.defaultShiftHours`**, same doctrine as `defaultHeadcount`: copied into a shift when
    it is created, never read again. Per pole because shift length is a property of the job, and
    it is the main lever on whether somebody works four hours in one place or two here and two
    there. Absent means two hours, as every pole did before.

### Two small bugs the new tests caught immediately

`addArtist` placed a new set after the last one, which produced a **zero-length set** when the
line-up already ran to the closing hour: not a set the régisseur could even grab to move. It now
falls back to the start of the event.

`setPoleLocked(…, false)` set `locked: undefined` rather than removing the key. An `undefined`
left behind is a real own property: two otherwise identical poles compare unequal, and it
survives serialisation in shapes that are hard to notice. **Prefer removing an optional key to
setting it undefined**, everywhere in this codebase.

### The leader hours field that did nothing

Reported: typing a number into a pole leader's hours did nothing at all. `setLeaderWindow`
refused anything that was not a coherent interval, and a new leader starts with neither end set,
so typing the first of the two numbers hit `end === null` and was discarded. The field looked
broken because it was: you could never enter the first half of a pair that has to be entered one
half at a time.

**Storing half a window is correct; judging it is the renderer's job.** The grid already refuses
to draw a band unless both ends are set and the end is after the start, and Réglages now says
"horaires incomplets" or "la fin doit être après le début" in words. A value that silently
vanishes is the worst of the three.

### The noon assumption, and why making the date editable exposed it

Two places still computed a clock time as "midday plus the offset" after the start became
editable in round six. `clockLabel` on the grid did it for every hour label, every artist window
and every leader band; `toLabel` added a fixed +01:00 with a comment saying the event never
crossed a DST boundary, which stopped being true the moment the date could move to July. Neither
would have failed loudly: every label would simply have been an hour or several out, in unison.

Both now read the event's real start, `toClock(startISO, hours)` and `toLabel(startISO, hours)`
in `model.ts`, in the runtime's own timezone, threaded through the ruler components as a prop.

**What is still tied to a midday start** and was deliberately not changed: `DEFAULT_SLOTS` in
`model.ts` names its three windows "12h-18h", "18h-00h" and "00h-06h". Those ids are the Google
Form's own wording and are stored on every volunteer as `refusedSlot`, so they are form
vocabulary rather than derived values. An event moved to a different time of day would keep slot
names that no longer describe the hours they cover. Worth deciding before the form is written,
not after.

The boundary this paragraph used to call `EVENING_START = 6` is `rules.eveningStartsAt`, and it
is **8 (20h) since 2026-09-08**, when it also stopped being a hard rule. See
[[feature-preference-refactor]].

### A browser autofill that renamed poles

Picking a Google-suggested address for a pole leader silently renamed the pole above it. Chrome
autofills a whole contact by guessing at nearby fields, and an unnamed text input next to an
email input is a name field as far as it is concerned, so it wrote the name attached to that
address into the pole title and React's `onChange` dutifully applied the rename.

Fixed by telling the browser what each field is: the leader's name, phone and email carry
`autoComplete="name" | "tel" | "email"` and a distinct `name`, and the pole title carries
`autoComplete="off"` and a `name` Chrome cannot read as a person's. **Any future free-text field
sitting near a contact field needs the same treatment**, because the failure is silent and looks
like the tool corrupting data on its own.

## Deux retours d'usage, 2026-09-13: la frise des responsables et l'onglet Historique

**DEUX RESPONSABLES À LA MÊME HEURE SUR UN PÔLE ONT CHACUN LEUR LIGNE.** « Au lieu de superposer
les cases, ajouter de l'espace vertical et les afficher l'une au-dessus de l'autre. » Ils étaient
dessinés l'un par-dessus l'autre: `.organiser-band` avait une hauteur fixe de 18 px et chaque
`.organiser-band-item` était en `position: absolute; top: 1px; bottom: 1px`. Le second était donc
invisible, et une répartition parfaitement légitime ressemblait à une seule personne.

`OrganiserBand` empile maintenant avec `packRows`, le paqueteur de la grille des phases, **clé sur
la PERSONNE**: quelqu'un qui tient le bar de 14h à 18h puis de 22h à 02h garde une seule ligne
pour ses deux fenêtres, exactement comme sur une voie de montage, et seul un vrai chevauchement
coûte une ligne de plus. La hauteur de la frise est posée en ligne (`lignes × 18 px`), la feuille
de style ne garde qu'un `min-height` pour que la frise vide reste une cible de dépôt. Rien n'est
fusionné et rien n'est refusé: deux personnes sur un pôle à une heure donnée est une réponse, pas
une erreur.

**L'ONGLET HISTORIQUE S'AFFICHAIT TRÈS MAL, et les deux causes étaient sa boîte.** Il était dans
une `.screen`, la grille qui réserve 330 px à un volet que cet écran n'a pas, donc un tiers de la
largeur était vide. Et tout son contenu était dans une `.card`, plafonnée à 520 px parce qu'une
carte sert à tenir un paragraphe: une table de dates, d'intitulés, de formes de plan et de deux
boutons par ligne y était écrasée dans une moitié d'écran. Il ne pouvait pas non plus défiler,
pour la raison déjà rencontrée sur le Catering: `.screen-main` est une grille de deux lignes, une
barre d'outils et UN corps, et avec un seul enfant la carte tombait dans la ligne `auto` et sortait
du bas de la fenêtre.

**Les classes de coquille sont communes depuis ce jour**: `.screen-body`, `.screen-card`,
`.screen-card-note` et `.screen-scroll`, nées `.catering-*` la veille et renommées ici parce qu'un
deuxième écran en avait besoin. Tout écran large les emploie: une `.screen is-wide`, un corps qui
défile, des cartes sans plafond de largeur, et le défilement horizontal confiné aux tableaux.


## Volunteer phone numbers: what is decided and what is not built

The form captures a phone number, and `Volunteer.phone` has always existed. Decided 2026-09-07:
**a pole leader, logged in with their own identifier, may see the numbers of the volunteers in
their pole, and call them from the interface.** Nobody else may.

**Not built, and deliberately not half-built.** It needs a leader login, which does not exist:
organiser auth is Supabase Auth for the régisseur, and the volunteer view uses an access code.
A leader is a third kind of reader. Like the volunteer view this is a GDPR matter and not a
convenience, so it goes the same way: a `SECURITY DEFINER` function taking the leader's
credential as an argument and returning only their own pole's roster, with RLS denying everything
else. Filtering a full roster in the browser would be exactly the wrong shape.

What is built now: the régisseur's own panel shows a volunteer's phone and email as `tel:` and
`mailto:` chips. The régisseur is already trusted with every field on the form.

## The blank settings page, and the two defects behind it

**Reported 2026-09-07: opening Réglages showed nothing at all, and took the navigation with it.**

Cause: a plan sitting in localStorage from before `Plan.leaders` was added. `plan.leaders.length`
threw, and React unmounts the whole tree on an uncaught render error, so one missing array turned
into a blank page with no way back to the grid.

Two separate defects, two separate fixes, both tested.

1. **Old stored data was trusted.** `persistence/normalise.ts` now runs on everything crossing
   the persistence boundary, in `FixtureStore` and later in the Supabase store. It is written out
   field by field on purpose: a spread with a couple of fallbacks would compile happily the next
   time a field is added to `Plan`, and the next régisseur would meet the same blank page. Naming
   every field means adding one to the type puts a compile error in that function, which is the
   only reliable reminder. Rules are merged rather than replaced, so a plan from before a rule
   existed keeps its own values and picks up the default for the one it lacks.
2. **A screen crash took the shell with it.** `ScreenBoundary` sits inside the shell, around the
   screen only, so the tabs, the undo buttons and the save state survive and the answer to any
   future crash is "click another tab". It shows the error text, because the régisseur is the one
   who will report it and "something went wrong" wastes that.

**React does not invoke error boundaries during server rendering**, so the boundary class cannot
be tested end to end by this suite. Its two pieces are tested directly instead:
`getDerivedStateFromError` and the `ScreenError` card, which is why the fallback is a separate
function component. The wiring between them is React's own.

## The convergence bug, and why the fix is what it is

**Reported 2026-09-07: "Jusqu'à stabilité" finished in about 5 s, the régisseur accepted
everything, and pressing "Recalculer" immediately found more proposals.**

The cause was not the loop. It was that **convergence was a property of the seed, not of the
plan.** The loop stopped when one round changed nothing, and each round used a different offset
of a constant base seed. Probed on `balanced` (`npm run converge-probe`), a plan the loop had
declared settled still yielded proposals under **three seeds out of seven**, with real gains,
including under the constant that `solve` used by default, which is precisely the search the
"Recalculer" button runs. A stochastic search coming back empty once says something about that
search, not about the plan.

Two changes, both needed:

1. **The default seed is now derived from the plan**, `planSeed` in `solver.ts`, FNV-1a over the
   sorted assignment and reserve keys. Solving plan P without a seed always runs the same search,
   so if a round ran it and found nothing, a manual re-solve of P finds nothing either. The
   promise became provable rather than lucky. Determinism is unchanged and in fact stronger: the
   same plan gives the same result, and an explicit seed still overrides.
2. **The stopping rule is three consecutive quiet rounds**, `stableRounds`, and the first attempt
   on any plan always uses that plan's own default seed, with later attempts offsetting it. So
   the loop ends on a plan whose own search came back empty, plus two other searches that also
   found nothing.

Verified across four scenarios: a plain re-solve after convergence returns **0 proposals** on
all of them. What other seeds could still find is now small, 0 to 1.2% of the plan's cost against
the 30% the first round buys, except `over-recruited` at 3.2%.

Cost: convergence went from 2 to 8 rounds up to 12 to 17, so 10 s (`shortage-heavy`) to 65 s
(`over-recruited`). The time budget is 120 s, and a per-round progress message now goes from the
worker to the screen, because a minute of undecorated spinner reads as a hang. Stopping on the
budget or the cap is reported as `converged: false`, and the screen then says a further calculation
will find more, because a plan cut off mid-loop may well be one whose own search never ran.

`npm run converge` shows the round-by-round gains; `npm run converge-probe` checks the promise.

## Decisions taken 2026-09-07, seventh round: re-importing the form

The form is exported and re-imported for months. Rows are corrected, added and deleted, and each
import has to answer who is new, what changed and who is gone.

30. **`Volunteer.key` is an identity, not a row number.** It was `row1`, `row2`… which survives
    nothing: delete one row and everybody below shifts up, so every assignment in the plan
    silently points at the wrong person. `volunteerIdentity` in `import.ts` is now the email when
    there is one, the name otherwise. **The email is compared as an address**, lowercased and
    trimmed only: `normalise` strips punctuation, which is right for a name typed from memory and
    wrong here, since it turns `j.dupont@example.org` into `j dupont example org` and could merge
    two different people. Two answers landing on the same identity get a suffix and an
    `identite-ambigue` issue rather than being merged.
31. **`reconcile.ts` diffs a fresh import against the plan** and applies what the régisseur
    accepts. The line that governs it: **the CSV is the source of truth for answers, and only for
    answers.** An update overwrites what somebody said they want and keeps every placement the
    régisseur made; if the new answers make a placement illegal it goes red, like any manual
    edit. Access codes are preserved, because they may already be in somebody's inbox.
32. **Removals are individually refusable.** A row missing from an export usually means a
    withdrawal, but it can also mean a filtered view was exported by mistake, and the difference
    between those two is a person turning up to a shift that no longer exists. Each one is listed
    with the shifts and hours it would cost.
33. **Buddy pairs are rebuilt from the export**, because that is where they come from. Pairs
    involving somebody kept despite being absent from the export are carried over from the plan,
    since the export has nothing to say about them.

### Fetching a Google Sheet from the browser, and why it works without a backend

Checked against Google in September 2026, with an `Origin` header:

| endpoint | answer |
|---|---|
| `/export?format=csv` | 307 to `googleusercontent`, which sends `Access-Control-Allow-Origin: *` |
| `/gviz/tq?tqx=out:csv` | **200 directly**, echoing the caller's origin |

`gviz` is the one used: a request that never redirects has one less thing to break, and the
redirect target is a hostname Google is free to change. Both need the sheet readable without
signing in, which for a form response sheet means "anyone with the link". **Nothing authenticates
and nothing should**: a tool that asks for a Google password is one nobody should give one to. A
private sheet answers with an HTML sign-in page rather than an error, so the response is checked
for markup and reported as "the sheet is private", not as a broken file.

## Decisions taken 2026-09-08, eighth round: slots, paper, keyboard, phone

The four things the user asked for after the import round, plus one deferral. **Plan history is
deferred until Supabase is configured**, by the user's own call: a history worth having is a row
per version on a server, and building one on top of `localStorage` would be building it twice.

34. **The time slots are data, not a type.** `SlotId` was a union of three literals and
    `EVENING_START` was a constant. Both were wrong for the same reason: they are the wording of
    two questions on a form the régisseur owns and will edit. `Plan.slots` is now
    `EventSlot[]` (`id`, `label`, `start`, `end`) and `eveningStartsAt` is a scheduling rule
    alongside the others. `DEFAULT_SLOTS` keeps the three the brief started from.
35. **Availability windows are derived from the clock, not enumerated.** `usableWindows` used to
    pick from a hardcoded list of the seven combinations of three slots. It now cuts one span
    (`afternoon`, `evening` or the whole event) with the refused slot's window, which produces
    the same seven answers for the original slots and keeps working for any other set. Verified
    equivalent before the old code was deleted.
36. **Editing a slot never rewrites an answer.** A label is free to change, because `refusedSlot`
    stores the id. Removing a slot leaves every volunteer's answer exactly as they gave it: it
    stops matching, so it stops constraining, and the panel shows the stale id rather than
    pretending they answered nothing. The Réglages card states the refusal count before the
    second click. Rewriting what somebody said so the data looks tidy is the one thing this tool
    must not do.
37. **The printable page is three documents, not one.** A sheet per pole (what a pole leader pins
    up), a line per volunteer (what the welcome desk reads when somebody arrives), and the
    reserve with each person's answers on it (what you call from when somebody does not turn up).
    Each is a checkbox. The sheet is drawn on screen exactly as it prints, so `@media print` only
    has to remove the application around it.
38. **Volunteer phone numbers are off the printout by default.** They are personal data collected
    to run one evening, and a pinned-up sheet is a broadcast. One checkbox, per print, with the
    reason next to it. Leaders' own numbers are always printed: reaching the person in charge is
    what the sheet is for. This is the same principle as [[feature-admin-ui]]'s unbuilt
    pole-leader phone access, applied to paper.
39. **The keyboard cursor is a place, not a person.** `{ shiftKey, index }`, not a volunteer key,
    so deleting the box under it leaves the cursor where it was while the person below slides up.
    Left and right are time along the same pole, up and down are the column of people and then
    the next pole at the same hour. Empty places are stepped over: there is nobody to select in
    one and nobody to remove from it. Suppr on a locked box refuses **and says so**, because a
    key that silently declines is indistinguishable from a key that is not wired up.
40. **The movement is in `components/gridNav.ts`, with no React around it.** It is geometry, it
    is easy to get subtly wrong, and it is impossible to see wrong in a screenshot. Nine tests
    over a two-row fixture cover it.
41. **A phone gets a different application, not a squeezed grid.** Eighteen hours across and
    fifteen rows down do not survive a 5-inch screen at 03h, and a version that looks usable and
    is not would be worse than none. `NightView` answers the one question a phone is asked on the
    night: who is on right now, and who comes next. It follows the real clock by the minute until
    somebody scrolls the hour themselves.
42. **It says "Lecture seule" before it says anything else**, above the event's own name, and a
    test asserts that ordering. Nothing on it can move a person: that is deliberate, not
    unfinished. An accidental drag at arm's length in the dark, on a plan somebody else is
    editing on a laptop, is exactly the silent change this tool must never make.
43. **The width is a guess, so the guess is escapable.** A button on the night view opens the
    full tool anyway. Somebody on a tablet, or holding a phone next to a keyboard, is entitled to
    the real thing rather than to our reading of their screen.

## What was measured, and must not be re-argued from scratch

### Anti-fragmentation weights

`balanced`, 1000 iterations, **averaged over five seeds** because one run of a stochastic search
moves these figures by tens of hours. Reading a single seed produced a confident wrong conclusion
once already, in this very session.

| poleFragmentation / blockSplit | une seule place | journée nette | manque | hors choix |
|---|---|---|---|---|
| 0 / 0 | 60/120 | 46/120 | 26 h | 218 |
| 600 / 300 | 74/120 | 62/120 | 27 h | 260 |
| **2500 / 1200** | 84/120 | 74/120 | 30 h | 277 |
| 6000 / 3000 | 86/120 | 76/120 | 39 h | 238 |
| 20000 / 10000 | 97/120 | 84/120 | 51 h | 219 |
| **2500 / 1200 + outsideChoice 800** | 85/120 | 73/120 | 34 h | **217** |

The last row is the setting that shipped. The solver had been paying for tidiness by placing
people outside both their choices, which the brief forbids except to fill a shift; raising
`outsideChoice` from 120 to 800 buys that back for free. `staffing` stays 3.75x above it, so a
shift is never left short out of politeness. Net price of the whole feature: about 8 h of
coverage out of 600, for 24 more volunteers working in a single place.

The penalty has **three terms on two weights**, and each one catches a case the others miss:
`poleFragmentation × (poles − 1)` for working in a second place at all, plus
`poleFragmentation × (poleRuns − blocks)` for changing place without even getting a break out of
it, plus `blockSplit × (blocks − needed)` for turning up more often than the 4 h cap forces.
Dropping the first term made "un seul pôle" stop improving; dropping the second let mid-block
pole changes climb back from 4 to 16. `needed = ceil(hours / maxConsecutiveHours)`, so an 8 h day
pays nothing for the second block it cannot avoid.

### Proposal grouping

**The dependency between proposals is directed, and getting that wrong wastes the whole idea.**
If A takes the place B gives up, A needs B; B does not need A. A first attempt used symmetric
connected components and returned 78 proposals as **one group of 65** plus ten singletons, which
is "accept everything or nothing". Directed, with strongly connected components over "same
volunteer, or same shift with no room to spare":

| scénario | propositions | groupes | plus gros | prérequis moyens |
|---|---|---|---|---|
| balanced | 78 | 43 | 11 lignes | 7.6 groupes |
| shortage-heavy | 28 | 20 | 2 lignes | 1.4 groupes |
| surplus | 64 | 41 | 7 lignes | 2.4 groupes |
| over-recruited | 52 | 43 | 3 lignes | 1.3 groupes |

Zero non-autonomous groups on all four: a group taken with its transitive prerequisites never
introduces a tier 1 issue. Accepting every group still reproduces the solver's plan exactly.
A two-person exchange falls out on its own as a cycle of length two, titled "Échange entre X
et Y", which is the case the user described.

Why "same volunteer or same full shift" is the whole of it: every tier 1 rule is scoped either to
one volunteer (overlap, consecutive hours, blocks, break, volume, refusals) or to one shift
(over-staffing). Two proposals sharing neither cannot make each other illegal.

### Does a re-solve ever stop proposing things?

The régisseur asked, and the answer is yes. Ten rounds of "solve at 3000 iterations, accept
everything, solve again" from an untouched plan, counting proposals and the quality cost with
the stability term switched off. The ordinary score cannot be compared between rounds, because
stability is measured against the plan each round started from and is therefore always zero at
the start of one.

| scénario | propositions par tour | converge |
|---|---|---|
| balanced | 244, 38, 2, 2, 7, 2, 7, 0, 0, 0 | tour 8 |
| shortage-heavy | 126, 7, 3, 0, 0, 0, 0 | tour 4 |
| over-recruited | 277, 7, 3, 7, 7, 0, 0 | tour 6 |
| surplus | 254, 12, 6, 2, 9, 7, 11 | pas encore au tour 7 |

**Every round showed a strictly positive gain.** There is no churn: the solver never proposed
moves that left the plan no better. Two reasons more than one round is needed. The `stability`
weight makes a round refuse any improvement worth less than 400 (two changes at 200 each); once
a round is accepted that cost is banked, and the next round can afford the next tier of
improvements. And iterated local search is stochastic, so starting from a better plan explores
different neighbourhoods. `surplus` is the one still finding gains at round 7 because it has the
most slack to optimise, and its quality cost fell 11% over those rounds.

Measured by `npm run converge` in `tools/`. If this ever needs to look converged in one press,
the lever is running rounds until the batch comes back empty, not raising the iteration count.

## What is built and works

- **The grid.** Leaf poles as lanes, 18 hours across, **the hour axis repeated above every pole**,
  the line-up on the top ruler, one box per volunteer needed. Drag to move, drop on an occupied
  box to exchange, drop on the panel to unassign or reserve, per-box lock, click to select. Zoom,
  a pole filter (all poles by default), "incomplets seulement", volunteer search, and a legend.
  Shift blocks carry no title: the repeated axis answers "what time is this" better than a label
  on every block did.
- **Legality is asked, never written.** On drag start the legal targets are computed once with
  `isLegal` on the plan with the dragged box already removed. Illegal targets grey out but still
  accept the drop, and `blockersFor` gives the French reason.
- **Colours.** Red is one box: a tier 1 issue naming this volunteer *and* this shift, attributed
  by `validate` through `ShiftReport.stars[].issues`. A problem with the shift itself goes on the
  shift border instead, never on its people. Tier 2 on a box is a dashed orange border,
  not red. The 6 h / 8 h band is `VolunteerReport.volumeBand`, drawn as a stripe down the left
  edge because a long day is a label, not an alarm. A shift short of people is never red.
- **Proposals as groups**, with prerequisites pulled in on accept and dependents pushed out on
  reject, and a pre-apply validation banner.
- **Dashboard** and **recruitment view**, straight off `PlanSummary` and `GapDiagnosis`.
- **Réglages**: scheduling rules, poles and sub-poles (create, rename, delete), per-pole
  defaults and colour, shifts (add, delete, retime), a per-pole regeneration tool for shift
  length, pole leaders with their contact details and hours, the event itself (name, start,
  length, line-up), and the form's time slots with the afternoon/evening boundary.
- **Import**: a Google Sheet link or a CSV file, reconciled against the plan, with the added,
  updated and removed lists reviewed before anything is applied.
- **Printing**: a sheet per pole, a line per volunteer, and the reserve. Volunteer phone numbers
  are opt-in per print.
- **The keyboard on the grid**: arrows move a cursor box to box, Suppr takes the person off that
  shift (and refuses out loud on a locked place), Échap drops the cursor, Ctrl+Z undoes.
- **The night view on a phone**: read-only, one pole per card, following the clock, with the
  leaders reachable by a tap.
- **Historique**: the versions kept, what changed between two of them, going back to one, and the
  "Point de sauvegarde" button in the top bar that names the version on screen so it is never
  removed automatically. See [[feature-supabase]].
- **The volunteer view**, built 2026-09-08 and the only screen reachable without an account. A
  code, no password, their own shifts, who is on with them as "Jean M.", and the pole leader's
  number as a tap-to-call. It sits OUTSIDE `AuthGate` and inside `StoreContext`, since its
  credential is the access code and Postgres does the filtering; the login form offers the way
  across, because most people opening that address are volunteers and a form asking for an email
  they were never invited with reads as "you are not welcome" rather than "wrong page". The
  régisseur reaches the same screen from the top bar, to see what a volunteer sees.
  **Having no shift yet is a normal answer**, not an error: between the form closing and the
  first solve everybody is in that state.
- **CORRECTION 2026-09-08, and it was wrong in this file:** the offer to copy a generated
  scenario was documented as "never in a production build, since the fixtures are not reachable
  there". They were. `public/fixtures/` is copied verbatim into `dist/` by Vite, so every
  production build carried 884 KB of invented volunteers AND re-armed that offer, which on a
  fresh database would have proposed seeding a hundred and twenty imaginary people into the real
  project. A `dropFixtures` plugin in `vite.config.ts` removes them after the bundle is
  written, the deploy script refuses a build that still has them, and it cleans them off the
  server. Found while writing the deployment, not by testing.
- **The codes export**, on the print screen, built 2026-09-08. A CSV for Brevo whose headers are
  attribute names (`EMAIL,PRENOM,NOM,CODE_ACCES,CRENEAUX`) rather than French labels, because a
  contact import matches the header against the list's attributes. `CRENEAUX` exists so that
  nobody with no shift receives "voici ton planning". Two things are reported under the button
  because they are silent everywhere else: a volunteer with no address is not in the file, and
  two people behind one address become one contact, so one of the two codes does not survive the
  import. `brevoContactsCsv` is in the engine (`tools/src/csv.ts`) and tested there.
- **Journal**: everything the tool did on this planning, and a "Copier pour diagnostic" button
  producing a plain-text block to paste into a message. It exists because the person running the
  event is not the developer, and a report from memory a day later is not enough to act on.

## Traps found while building, worth not rediscovering

- **A partly accepted batch could go over headcount.** That is what grouping fixed. The pre-apply
  validation banner stays as the backstop, and a test keeps it honest.
- **The fixtures ship solved at 3000 iterations, so re-solving them proposes nothing.** Any test
  needing a real batch must perturb the plan first (dropping a seventh of the assignments).
- **The solver refuses cosmetic swaps**, and rightly: two changes cost 400 in stability, more
  than a choice 2 to choice 1 upgrade is worth. A test that wants a swap must make it worth at
  least that, which means `outsideChoice`, not `choice2`.
- **`swap` could create a `doublon`.** Dragging one box of a two-shift volunteer onto somebody
  standing in their other shift sent them to a shift they already held. `swap` now drops the
  dragged box instead of duplicating the person.
- **`import.ts` no longer uses `node:crypto`.** Web Crypto with rejection sampling, so it runs in
  the browser too.
- **React escapes quotes and apostrophes**, and the engine's French messages are full of both.
  Screen tests compare against escaped HTML or they fail on every message.

## What is left

1. **Supabase.** See [[feature-supabase]]: the schema is rewritten, statically verified and ready
   to run, and it now mirrors the `Plan` field for field, so the columns the later rounds needed
   (`slots`, `lengthHours`, leader hours, `pole.colour`, `pole.locked`) are all there. What is
   left on this side is the app's: auth by magic link, a `SupabasePlanStore` behind the same
   interface, and the one-line swap in `main.tsx`. Everything else waits on this.
2. ~~**Plan history.**~~ Built 2026-09-08, see [[feature-supabase]] for the seven decisions. The
   Historique tab lists the versions kept with their counts and the French of the edit that
   produced each one, and going back is itself a save. Both stores implement it, the fixtures
   included, so it is exercised without a network. What was NOT built and was a deliberate cut:
   a field by field diff between two versions. Counts plus the label are what a régisseur picks a
   version by; a real diff is a build of its own.
3. **The volunteer view**, last. Access code, `get_volunteer_schedule`, `get_public_planning`.
4. **Pole-leader phone access.** See the section above: a third login type, and a
   `SECURITY DEFINER` function taking the credential as an argument. Never browser-side filtering.

## A failed save must never take the working copy with it, 2026-09-08

Found by the régisseur, testing the deployed tool. The database was one migration behind (see
[[feature-supabase]]), so every autosave was refused, and `store.tsx` answered a refusal by
resetting itself to `INITIAL`. The plan left the screen, the undo stack with it, and what was
left was an error card with no button on it: "toute l'interface a disparu, je ne sais même pas
trop quoi faire". **The plan in the database was untouched the whole time. The edits made since
the last save existed nowhere else, and those really were gone.**

One action reset the state for two very different events, and separating them is the fix:

- `load-failed` has nothing to keep, since no plan was ever built, **but it keeps the id** of
  what somebody tried to open. That is what lets the error screen offer "Réessayer" and "Revenir
  à la liste des plannings" instead of being a dead end. The screen also says, in French, that
  nothing was written and that a message naming a missing column or function means the database
  is behind.
- `save-failed` keeps everything: plan, undo stack, dirty flag, base version. It raises a fourth
  banner, between `outdated` (which cannot be retried at all) and `conflict` (which is a
  choice), saying the working copy is still on screen and is the only copy, with a "Réessayer".
- **The autosave is held back while that banner is up.** A database that refused this document
  1.2 s ago will refuse it again, and a retry loop would fill the journal with the same line
  until somebody noticed. Pressing Réessayer clears the flag, the plan is still dirty, and the
  effect picks it straight back up.

The reducer and `INITIAL` are exported now, for `app/src/store/failures.test.ts`. What it
asserts is not a screen but a rule: which actions may throw the working copy away. Exactly one
may, and the last test walks the others so that adding a ninth is a decision rather than an
omission.

## Every hour in Réglages is typed on a 24 h clock, 2026-09-09

Reported by the régisseur looking at the artists and the form's time slots: 12 h AM/PM where a
French event wants 24 h, and controls that were not adjustable in any comfortable way. Both had
the same root. Réglages held **two** kinds of hour control and neither was one somebody would
choose:

- A number spinner holding **the offset from the start of the event**, with the real hour written
  next to it as a read-only echo. Reading was easy, writing meant doing the subtraction in your
  head: 21h30 is "9,5". That was the artists, the tranches, the créneaux table, the leaders'
  windows, the loto overflow rule and the loto / soirée boundary.
- One `<input type="datetime-local">`, on the event's start. **That is where the AM/PM came
  from.** The native control follows the operating system's locale, not the page's, so an
  English-language Windows shows "12:00 PM" on a French event and no attribute changes it.

The answer is one control, `components/ClockField.tsx`, over `components/clock.ts`:

- **A text field on a 24 h base**, not a native time input, precisely so the format is ours.
  Takes "21h30", "21:30", "21.30", "21h", "21", "2130", "930"; "24h" means midnight. A minute
  past 59 or an hour past 24 turns the field red and reverts on blur rather than being
  reinterpreted into whatever parses.
- **Typed values land on blur or Enter, never per keystroke.** "2" is not two in the morning, it
  is somebody on their way to 21h30. Arrow keys nudge by a quarter of an hour, shift-arrow by a
  full one, and both commit immediately: that is the adjusting gesture. The same two nudges are a
  stepper inside the field, shown on hover or focus, because arrow keys are invisible otherwise.
- **The clock to offset conversion goes through a real Date**, per candidate day, never modular
  arithmetic on 24. The candidate inside the event wins, and the one nearest the value already
  there breaks a tie, which is what makes retyping "13h" on a créneau at 13h05 move five minutes
  rather than a day. An hour outside the event is kept, not refused: a set running past the end
  is a real thing to describe.
- **A "+1" superscript inside the field** when the hour is the next day. It was a badge notched
  over the top border first, which read as belonging to the row above on a list whose rows are
  five pixels apart.
- The event's start is now a `type="date"` (no hour to get wrong) next to `TimeOfDayField`, the
  same field for an absolute time of day, stepping wrapped around midnight.

**Moving a start moves the whole window, 2026-09-09.** Asked for right after, and it is the same
idea one level up: nobody retypes a start hour to make something longer, they type it because the
thing happens later. So the start field slides the end by the same amount and the duration is
kept, while the end field changes only the end, which is how a length is set. The rule is one
pure function, `slideEnd` in `clock.ts`, used by the artists, the tranches, the créneaux table
and the leaders' windows; each field's tooltip says which of the two it does, because the
asymmetry is invisible otherwise. Two deliberate exceptions: half a leader's window has no length
to keep, so nothing slides until both ends are filled, and the **De / À of "Régénérer les
créneaux" do not slide each other** because they are the two ends of a span to fill, not a window
("de 14h" on a pole running to 06h means starting later, not finishing at 08h). Nothing is
clamped, as everywhere else here: a window pushed past the end of the event goes there and turns
red. Sliding a créneau moves nobody: whoever no longer fits is shown in red, exactly as after any
other edit on this screen.

Consequences worth knowing: the read-only clock echoes are gone from the artists, the tranches
and the leaders, and what sits after the two fields is now the duration, which is the one thing
the fields cannot say themselves. `.hour-input` and `.setup-leader-hours` left the stylesheet;
the leaders' phone and e-mail stretch instead of being a fixed 190 px, because the wider hour
fields were pushing the delete button onto a line of its own. `components/clock.test.ts` covers
the parser's refusals and the offset arithmetic, which is the half that could be wrong silently:
a misread hour does not look like a bug, it looks like a créneau starting an hour late.

**Duplicating a sous-pôle, and reordering them, 2026-09-09.** Two additive edits on Réglages,
`duplicatePole` / `movePole` + `canMovePole` + `poleCopyPreview` in `store/setupEdits.ts`, wired
as `DuplicatePole` and `MovePole` in `SetupScreen.tsx`, on the sub-pole rows only.

- **A copy carries the skeleton and nobody.** The pole, its sub-poles, their créneaux with the
  same hours and the same effectifs, and zero affectation. Copying the people would put every one
  of them in two places at once, which is the tier 1 the tool exists to avoid; what was tedious
  was never the volunteers, it was retyping seven créneaux. The copy is also neither `locked` (an
  empty pole has nothing balanced by hand) nor given the original's own `colour` (the colour
  belongs to the root, which a copied sub-pole already shares).
- **Named the way a file manager names a copy**: "Plonge" gives "Plonge 2", then "Plonge 3", and
  duplicating "Plonge 2" continues the series rather than producing "Plonge 2 2". Uniqueness is
  checked among the siblings only, because that is what the path is built from.
- **It lands right after the original**, not at the bottom of the list, so it reads as a copy.
- **No second click.** Every destructive button here states its price and waits; this one has
  nothing to lose, so the tooltip says what it will make (the name, the number of créneaux, and
  that nobody comes with them) and the click makes it.
- **Reordering is ▲/▼ among siblings, not drag and drop.** The order of `plan.poles` is the order
  every screen draws: the lanes of the grid, the printed schedules, Réglages itself, and it
  round-trips through the database as `pole.sort_order`. So a move changes the order and strictly
  nothing else, and the buttons at the ends of the list are disabled rather than inert.
- **Both are exposed on sub-poles only, deliberately.** `poleColours` indexes the palette by
  root position, so inserting or moving a root repaints every pole after it, and the promise that
  a pole keeps its colour across edits would quietly stop holding. `movePole` and `duplicatePole`
  are generic and would work on a root the day that is worth solving (pin the resolved colour on
  every root first, then move).
- Implementation note: `movePole` rebuilds the array as a walk of the tree rather than swapping
  two slots, so a pole always lands after its parent whatever moved and however deep. The path
  recomputation `renamePole` used inline became `withPaths`, shared with `duplicatePole`.

Ten tests in `store/setupEdits.test.ts`. 185 app tests, typecheck and build clean, checked in the
real app on the `balanced` fixture: Plonge duplicated to "Plonge 2" with its 7 créneaux empty,
moved to the top of the Bar group, grid and journal both correct.

## What a colour on the grid is allowed to say, 2026-09-09

Three changes in one evening, all of them about a colour saying more than it means.

- **The selected box is filled blue, its siblings keep the ring.** `is-picked` (the box that was
  actually clicked) fills the way an illegal box fills in red; `is-kin` (the same person on their
  other shifts) keeps the thin blue outline it always had. The first attempt filled every box of
  the selected volunteer and was wrong: it made "the same person is also here" shout as loudly as
  "you are here". `picked = selected && row === cursorIndex`, which is exactly one box because
  `GridScreen` keeps the cursor and the selection in step.
- **The keyboard cursor lost its ring**, and the legend lost its "case au clavier" entry. The
  cursor only ever stands on an occupied box, and that box is the picked one, already filled: the
  ring repeated it, and in the dark theme `var(--ink)` read as a white border fighting the fill.
  **The `is-cursor` class stays in the DOM with no CSS rule at all**, because `GridScreen` scrolls
  `.box.is-cursor` into view. Do not delete it as dead. The keyboard help tooltip (flèches, Suppr,
  Échap, Ctrl+Z) hung on that legend entry and went with it; it has no home yet.
- **The shift border reads `SHIFT_SCOPED` codes only.** `report.issues` carries every issue that
  names the shift, a person's own signalements included, so one volunteer with a contrariety put a
  dashed orange border around the whole créneau. The border is about composition: que des
  débutants, expérience insuffisante, créneau trop long, and the tier 1 sureffectif. Vide and
  incomplet still drop out, because the dashed "à pourvoir" boxes already say it.

## Two panes on the right, and one panel for the three moments, 2026-09-11

The régisseur used the deployed tool and reported the panel as "un mauvais design" on the montage,
asking for one panel in all three moments with the same tabs. What was there:

- The exploit had `SidePanel`: five tabs, one of them ("Bénévole") being a FICHE rather than a
  list, so reading about somebody meant leaving the list they had just been found in.
- The phases had `PhasePool`: two tabs of its own, different words, different markup, and **not
  one line of CSS**. `.side-panel` was never defined in `styles.css`, so the montage's panel was
  browser defaults. Worse, `.screen` is a two-column grid, and a phase rendered THREE asides into
  it: the third landed in an implicit second row, UNDER the grid. That is the "affiché en dessous,
  sans titre" in the report, and it was a layout bug rather than a design choice.

What it is now:

- **`PoolPanel`**, one component for the exploit, the montage and the démontage, three tabs:
  Disponibles, Réserve, À relire (the last only when it has something in it, as before). What
  differs between the moments is the CONTENT of Disponibles, computed by `poolRows.ts`: on the
  exploit the volume somebody asked for minus what they are down for, on a phase the presence
  they declared minus the boxes that cover it. A phase adds two filters INSIDE that tab, the kind
  of person and the day, rather than two tabs: that is what lets the tab set be the same.
- **"À zéro" is deleted as a tab.** It was Disponibles filtered down, so the régisseur had to walk
  two lists to be sure they had seen everybody. Being at zero is a `chip is-zero` on the row now,
  which is what they asked for.
- **`InfoPanel`**, "Info sélection", a pane of its own in a third column (`.screen.has-info`,
  `--info-w`). It describes whatever is selected, and `Selection` in `components/selection.ts` is
  the one type for that: a bénévole, an orga, a créneau of the exploit, a box of a phase, an
  événement of a phase. A créneau or an événement selected on one of its places to fill carries
  `fill: true` and the pane then also offers who goes there, which is where the two floating
  pickers went.
- **A box shows the person it holds**, in full, under the box's own hours: that is the request
  word for word ("cliquer sur une case devrait afficher la fiche ... de la même manière que ce que
  fait l'exploit"). `CaseBody` renders `OrgaBody` or `BenevoleBody` below its own details.
- `SidePanel.tsx` became `VolunteerFiche.tsx`, keeping the fiche and losing the tabs. It is
  self-contained now: it reads `index`, `report` and `edit` from the plan context rather than
  taking five props, because three screens draw it instead of one.

**Clicking never decides.** A click on somebody inside an événement used to REMOVE them from it on
the spot, reported as "cliquer sur une case dans un événement supprime une personne". Every click
on the three grids now selects, and every removal is a named button in the pane. The exploit's own
`.shift` background became selectable at the same time, which is why `ShiftBlock`'s boxes now
`stopPropagation` on their click: without it a click on a person would also read as a click on the
créneau underneath.

**One state and not four.** `GridScreen` held a volunteer key, a "whose orga fiche is open" and a
"which créneau is waiting for an orga", all settable at once and all drawing a panel into the same
column. It holds one `Selection | null`, and `selectedVolunteerKey(selection)` is what the grid's
own highlighting reads.

`PhaseGrid` is keyed on the phase in `PlanningScreen`: the montage and the démontage are the same
component, so without a key React kept the selection across the switch and the panel described a
montage box while the démontage was on screen.

## The two panes, one round later, 2026-09-12

Four reports, all of them about these panes or about the phase grid beside them. The full account
is in [[feature-montage-demontage]] under "Seventh round"; what matters for the panes:

- **`PoolPanel` lists orgas in the three moments now**, not only on the two phases, because the
  exploit is where an orga is put on a créneau or made responsable and its one draggable list had
  half the people missing. `exploitPoolRows` has two halves, bénévoles by hours left then orgas by
  name: an orga declared no volume, so there is no figure to sort them on. The "Qui" filter is no
  longer phase-only; the DAY filter left this pane for the phase screen's toolbar, where one picker
  narrows the grid and the list together.
- **`InfoPanel`'s orga body gained "Responsable de"**, with each role's hours and a Retirer button.
  Being responsable is created by a drag on the grid since this round, so the way out had to be in
  the pane describing the person rather than in Réglages.
- **A bénévole's name was written twice** at the top of the pane: `VolunteerFiche` repeated the
  `h2` that `Head` had just written. The head is the one that stays, it carries the person mark.
- **`.rule-input` was written for Réglages and clipped in a 320 px pane.** An orga's montage and
  démontage rows draw two selects side by side; inside `.panel` they stack, and every field may be
  narrower than its own content. Nothing outside the two panes carries the `panel` class, so
  Réglages is untouched. This is the general shape of the fix: a pane that borrows Réglages markup
  needs `min-width: 0` on the chain and a stacking rule, not a narrower copy of the component.
  **Stacking alone was not enough**: `.rules-grid` asks for `minmax(240px, 1fr)` tracks and the
  pane narrows to 240 px under a 1500 px window, so the track was wider than its own container and
  the clipping became a horizontal scrollbar. Inside `.panel` the grid is one column with no side
  padding of its own, and `.panel-body` carries `overflow-wrap: anywhere` (never `break-word`:
  only `anywhere` lowers the min-content width, which is what stops a long word widening a column).
- **Phase grids ring the other boxes of the selected person**, as the exploit always has.
  `selectedPerson(selection, assignments)` in `selection.ts` is the shared answer to "who is this
  selection about", and it compares the KIND as well as the key, because an orga `o1` and a
  bénévole `o1` are two people. Its own tests in `selection.test.ts`.
- **`CreneauBody` offers an orga whether or not the créneau has a hole.** The picker was behind
  `fill`, so a full créneau offered nothing at all. Over-headcount is a legitimate thing to write;
  the grid draws the sureffectif in red rather than refusing it.

## A control that renders is not a control that is found, 2026-09-12

Two of the five reports that afternoon were about this, and both are worth keeping as a rule
rather than as a fix:

- The phase day filter was in the DOM, asserted by a passing test, and the régisseur reported not
  seeing it. It was a bare `<select>` reading "Tous les jours" between the zoom buttons. It is
  first in the toolbar now, inside a `.toolbar-field` label carrying the word « Jour ». The pole
  filter next door gets away with being bare because "Tous les pôles" names its own subject.
- A responsable's band on the exploit offered two 6 px grips, invisible until hovered, and the
  gesture was reported as simply not working. **The whole band is the handle now**: dragging the
  body slides the window keeping its length, dragging an edge moves that end, and a press that
  travels under three pixels is a click that opens the fiche. One `pointerdown` handler decides
  between the three by distance, so no click can fire at the end of a committed drag. 18 px tall,
  9 px grips with a permanent hairline, `cursor: grab`.

## The chrome, reworked 2026-09-12 (ninth round)

Six reports, and three of them were about a colour code or a control being unreadable rather than
about behaviour. The full account is in [[feature-montage-demontage]] under "Ninth round".

- **`--paper` was never defined in this stylesheet and four rules used it.** An undefined custom
  property is invalid at computed-value time: `color: var(--paper)` falls back to inherit and
  `background: var(--paper)` to transparent. The moment selector's current button was therefore
  ink on ink, which in the dark theme is nearly white on nearly white. **When a colour looks
  wrong, grep the token before theorising about the theme.** The selected button is `--accent`
  with `--accent-ink` now, the one pair defined to sit on each other in both themes.
- **The zoom is one logarithmic slider plus "Ajuster", on both grids**, and the grid fits itself to
  the screen when a phase's day filter changes. Five fixed steps were both too coarse and not wide
  enough. `EXPLOIT_ZOOM` / `PHASE_ZOOM` / `fitZoom` in `layout.ts`, `ZoomSlider.tsx`,
  `axisSpan` in `phaseAxis.ts`. The fit never runs on a resize or a plan edit: a zoom chosen by
  hand is a decision.
- **A long day is 💪 / 💪💪 and no longer two shades of orange.** The grid already spends red on
  "illegal" and blue on "selected"; a fourth colour code three pixels wide lost every time.
  `volumeMark` / `volumeLabel`, `.box-volume`, `.legend-mark`.
- **Dropping a box on the grid's own background unplaces the person, on all three grids**, beside
  the pane and the bin. What makes it work is that every real target calls `stopPropagation` on
  its own drop, so "reached the scroll container" means "landed on nothing". `TrashTarget` is a
  component now rather than a private function of `GridScreen`. A custom cursor during the drag is
  not possible: HTML5 drag and drop only offers the browser's own `dropEffect` icons.
- **An exchange no longer claims to be forbidden.** `DragReason` asked "may this person be added
  here", which is the wrong question for a swap: both people move, in opposite directions. It asks
  `blockersFor` twice on the plan the drop would produce, and says nothing when that is clean.

## The right-hand panes give the grid its room back, 2026-09-15

« Les volets de droite prennent de la place dans la partie grille. » No schema, no plan format.

- **« Info sélection » folds** to a 28 px strip (`--info-folded-w`) with its title written
  sideways and a dot when something is selected; « » » in its head folds, the strip unfolds. The
  state is `localStorage` (`aya-regie.info-panel.collapsed`), shared by the three moments. The
  screen's grid column follows through `.screen.has-info:has(> .panel.is-info.is-collapsed)`,
  not a prop through `GridScreen` / `PhaseGrid`. A selection made while folded does not unfold it.
  The zoom does not refit on fold (a zoom chosen by hand is a decision): « Ajuster » does.
- **The pool pane is 250 px** (`--panel-w`, was 330; `.panel.is-pool` tightens its padding). Its
  how-to sentence is the Disponibles tab's tooltip, the two filters are bare selects side by side
  (no « Qui » / « Pôle demandé » label line), a row's figure is bare hours (`PoolRow.meta`, the
  row's tooltip says libres / placées / à placer), and « à zéro » is an orange dot (`.pool-zero`).
- **The « Réserve » tab is gone from the pool pane**, and with it the drop-to-reserve on the
  exploit (`onDropReserve`). The reserve is a card of its own in Personnes, see
  [[feature-people-tab]]; putting somebody in it is the fiche's button, as before.

## Things that are decided and should not be reopened

- Toute personne placée sert: no minimum viable headcount per pole, the staffing penalty stays
  linear.
- Reserve means zero hours, on purpose. Joining it gives up every shift; leaving it places nobody.
- No recruitment target is ever shown as a goal. The dashboard reports what is missing.
- The solver must never return "infeasible", and never produces a tier 1 issue.
- The grid never hides a person to make a figure look right: a shift over its headcount draws
  every one of its people and shows the overflow in red.
- Red means illegal, and nothing else. Not a gap, not a long day, not a tier 2 problem.
- A screen that reports a failure carries its own way out. There is no navigation around the
  error card, so the buttons on it are the only ones there are.

Related: [[project-brief]], [[project-engine-api]], [[feedback-no-em-dash]],
[[feedback-gender-neutral-french]], [[feedback-verify-root-cause-before-fixing]].
