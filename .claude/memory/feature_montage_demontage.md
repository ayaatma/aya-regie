---
name: feature-montage-demontage
description: "Orgas beside bénévoles, and the montage / démontage phases: built 2026-09-10, eight rounds of the régisseur’s own use since. The brief, the model, the two grids, the trimming bugs and the phase-start time zone bug of 2026-09-11, the day filter and the orgas on the exploit of 2026-09-12."
metadata:
  type: project
---

**2026-09-13, see [[feature-event-abstraction]]: ONE EDGE OF EACH PHASE IS THE EVENT'S.** The montage ends where the event starts and the démontage starts where it ends; `alignPhase` writes the derived edge and every writer runs it. A phase nobody configured is the two days before or after the event. The bénévole window has one edge to set per phase. The 2026-09-11 note below about the phase start being an hour late in the live data is unchanged by this.

**State 2026-09-12, tenth round: BUILT and green. 261 engine tests and 348 app tests pass**,
both packages typecheck, `npm --prefix app run build` succeeds, `npm run sql-check` (397
statements) and `npm run schema-check` (150 fields round trip) are green.

**MIGRATION 14 IS APPLIED since 2026-09-12** (`npm run migrate` lists it as such; the paragraph
below was written before it was run and is kept for what it says about why it matters).
**PLAN_FORMAT is 7 since the catering, not 6**, see [[feature-catering]].

**Dixième round 2026-09-12, sans schéma ni format.** Trois changements sur les phases, venus de
l'usage réel, et le premier est une règle:

- **Une réponse de bénévole n'est plus une affectation.** `declaredPlacements` ne répond que pour
  les orgas, donc « Placer N présences déclarées » ne compte plus que les orgas, et
  `setVolunteerPhase` n'appelle plus `syncPerson`: celui-ci REMPLACE les cases d'une personne
  depuis sa déclaration, donc le laisser aurait effacé les cases posées à la main dès que le
  régisseur corrigeait la réponse. Un bénévole reste dans `phasePeople` et dans « Disponibles »,
  et une case posée sur lui est toujours mesurée contre sa déclaration. Le paragraphe « Une
  déclaration est un placement » ci-dessus ne vaut donc plus que pour les orgas. Voir
  [[feature-catering]] pour ce que cela a changé aux repas.
- **Une case d'événement rougit**, comme n'importe quelle autre case: c'était le seul endroit
  d'une phase où rien ne rougissait jamais, et celui où ça compte le plus, puisqu'un événement se
  remplit avec qui est là et que « est-ce que cette personne était seulement présente » n'y est
  demandé à personne. `phaseIssues` produisait déjà l'anomalie; seule la classe manquait.
- **`.phase-bar.is-illegal` prend le fond rouge**, comme une case de l'exploit, et le bloc d'un
  événement mesure enfin la hauteur que la feuille de style lui donne: il était trop court de
  trois pixels et `overflow: hidden` rognait la dernière case en silence. `eventBlockHeight`
  écrit la somme, une constante par valeur CSS qu'elle recopie, et `phaseGeometry.test.tsx`
  vérifie la même somme.


**MIGRATION 14**, `db/migrations/2026-09-12_pole_leader_support_only.sql`:
one column on `pole` (`leader_support_only`), both plan functions replaced whole, and
`min_plan_format` to 6. **PLAN_FORMAT is 6.** It ships with its deploy or a régisseur's tab loses
the flag on every pole at its next save. The seventh and eighth rounds (the day filter, the orgas
on the exploit, the responsable frise, and the five corrections that followed) touch no schema and
would deploy on their own. The developer runs `npm run migrate` and `npm run deploy` themselves.

**ONE THING IS STILL WRONG IN THE LIVE DATA, and it is not code.** The phase start of both phases is
stored an hour late (see the sixth round below, the time zone bug). The fix ships with this work,
but the stored value only corrects itself when somebody re-enters the start hour of each phase in
Réglages once on the deployed tool. Until they do, the montage is full of red boxes.

**The grid was rewritten the same day, after the first look at it.** The first version was a
table of half-day cells, and it read badly: a pole was far taller than its contents, an
événement filled the height of the screen, and a phase with no événement left a wide empty band
under the hours. The régisseur asked for the exploit’s shape instead, and for a granular
timeline: the form may well ask for half-days, but the tool has to be able to say "cet orga est
là de 8h à 20h, celui-là de 12h à 16h".

So a phase grid is now **poles down the side, hours across the top, and one bar per person**.
There is no créneau on a phase: a pole simply holds people, each on their own window, and
"présent toute la journée" is a bar across the day. Événements keep a lane each and are the one
thing that behaves like a créneau, title and headcount included. Two people at the same time are
two rows (`packRows`, greedy interval packing), so a lane is exactly as tall as its busiest
moment. The nights are not drawn at all: `app/src/components/phaseAxis.ts` lays each day’s
worked stretches end to end with a gap between them, which is what makes an hour the same width
everywhere. `phaseGeometry.test.tsx` checks the pixels, because "a lane too tall" and "an
événement filling the screen" are numbers in a style attribute and no markup assertion catches
them. `phasePreview.tsx` writes the grid to a standalone HTML file with the real stylesheet,
for looking at it without a database.

**Test data, and the fiche, 2026-09-10 (third round).** `npm run orgas` writes `out/orgas.csv`,
twenty orgas with their arrival dates, imported from Réglages; `npm run generate` now fills the
form’s column 43 for about a third of the bénévoles, so re-importing `out/<scénario>/benevoles.csv`
gives a plan people on the montage. Both go through the real import path on purpose: writing rows
into the database would leave the column binding, which is what actually breaks, unexercised.

Three things came with it. `parsePhaseAnswer` takes the phase it is reading for, so the single
question the real form asks answers both: "oui, pour le démontage" is a yes there and a no on the
montage, and `\bmontage\b` is what stops "démontage" reading as "montage". `parsePhaseMoment`
turns "10/03/2027 08:00" into an hour of its phase, so an imported arrival lands on the grid
rather than in a note; it answers null outside the phase, and the answer stays in the note.
And `app/src/components/OrganiserFiche.tsx` is the one editable fiche, used by the Réglages list
and by the grid, whose search box now offers the orgas beside the bénévoles.

**Fourth round, 2026-09-10, after the régisseur used it on the deployed tool.** Six things:

- **Clicking a bar used to decide.** A click on a declared presence turned it into an
  assignment on the spot, which reads as "the box lit up and stayed lit". Clicking now selects
  and changes nothing; deciding is a button in the panel that says what it does.
- **One person, one row.** `packRows` takes the person as a key, so two windows in the same
  pole share a line. Same on the exploit through the new `app/src/components/laneRows.ts`:
  somebody working two créneaux in a row keeps their row from one to the next, so four hours
  straight read as four hours straight. A kept row NEVER makes a créneau draw an extra place,
  because "à pourvoir" has to mean a place to fill: a row that would fall past the end of a
  shorter créneau moves up instead.
- **Orga or bénévole, at a glance**: `PersonMark` draws a ◆ before an orga’s name on all three
  grids. Not a star, because stars already mean the level a volunteer declared in their pole.
- **One événements lane**, drawn only when there is at least one, each événement a block with
  its title on the lid and one place per person needed, "à pourvoir" included. It used to be
  one lane per événement, each as tall as the screen.
- **The import shows what it had to interpret**, before applying: the sentence as typed, the
  reading of it, and `VolunteerEdit` to correct it on the spot. The correction travels with the
  import and is marked in `manualFields`, so the next export does not undo it.
- **`npm run form-csv -- --plan=…`** rewrites the form export for the people a plan ALREADY
  holds, changing only the montage answer. The generated `benevoles.csv` is useless against a
  live plan, since its hundred and twenty invented people match nobody and the import offers to
  create them all. Verified on `balanced`: 0 added, 0 removed, 64 updated, and the only fields
  that move are Montage and Démontage. The plan itself comes out of the new "Télécharger le
  plan" button on the import screen, which is also the only backup this tool offers.

**Fifth round, 2026-09-11, and it changed the doctrine.** The régisseur asked what the two
states were for, and the answer was nothing: **a declaration IS a placement.** Somebody who
filled in the form is placed on the days they gave, one box per worked day, in the pole they
named or in Général. `placementsFor` no longer derives anything, `PhasePlacement.explicit` is
gone, and the grid draws `phase.assignments` and nothing else.

What the declaration is still the reference for is **the red**: `phaseIssues` reports a box
outside what somebody declared (`hors-presence`), a box in a pole other than the one they
named (`autre-pole`, orgas only, since the volunteers’ form never asks), and the overlaps.
Reported on the box, under the grid and on the dashboard; never refused, never moved.

Two writers, deliberately different, in `phaseEdits.ts`: `placeDeclared` ADDS what is missing
for everybody and is the toolbar button; `syncPerson` REPLACES one person’s boxes and runs
only when their own arrival date changes. **A change of declared POLE writes nothing**, because
the boxes on the grid may have been arranged by hand and following a form answer would undo
that; the red flag says so instead.

Also this round: the événement title is ink on paper at 11 px inside its own strip (it was
accent on accent-soft at 10 px, unreadable); every box has a grip at each edge, dragged to the
quarter-hour and clamped to its own day, because trimming is the gesture a phase is actually
worked with; and `app/src/components/PhasePool.tsx` is the right-hand panel, two tabs and a day
filter, listing who declared that day and still has hours to place. Dropping from it places the
hours THEY declared for the day dropped on, never the whole day.

**Sixth round, 2026-09-11, after the régisseur used the deployed tool again.** Six reports, and two
of them were real bugs rather than design:

- **The orga mark is `🤩` and no longer `◆`.** The régisseur picked the emoji. `PersonMark` exports
  `ORGA_MARK` for the rare place that needs the character outside a React tree, and the glyph's
  9 px accent-coloured CSS became a 10 px baseline-aligned emoji.

- **Trimming a box barely worked, for three separate reasons, each of which would come back alone.**
  Reported as "au début ça le déplace un cran puis ça ne marche plus ... à la fin ça marche desfois
  mais pas toujours, et ça change l'horaire du début de la case".

  1. The bars were keyed on their own left edge (`key={piece.x}`) and the drag was followed with
     `setPointerCapture` ON THE GRIP. Moving the start edge changes that edge, React saw a new key,
     unmounted the grip mid-drag and threw the capture away with it: exactly one quarter of an hour
     of movement, then nothing. Keys are the piece's rank now, and the drag is followed with
     listeners on `window`, which no remount can interrupt.
  2. `onPointerUp` called a commit that read the proposed window out of React state. The listener
     had been created before that state existed, so it read null and let go committed nothing. The
     move handler keeps the last window it computed and hands it to the commit.
  3. The position was turned into an hour by `hoursAt`, which answers **null in the gap between two
     days** on purpose, with the START of the day as the fallback. So pulling the end of a box into
     the night set its end to that morning, and the minimum length turned it into a fifteen-minute
     box. There are two such boxes in the live plan, which is how the bug was confirmed rather than
     guessed. `hourOn` in `phaseAxis.ts` clamps to the day's own bounds instead, and `trimTo` keeps
     the minimum inside THE DAY BEING DRAGGED rather than inside the whole box, so the end of a box
     that runs over two days cannot be dragged to before the second day begins. Both are pure and
     tested in `phaseAxis.test.ts`; the component only converts a client X into a track offset.

  A fourth, smaller one: `.phase-bar-grip` was 6 px at each edge with no cap, so on a short box the
  two grips covered each other and grabbing the right edge grabbed the left one. `max-width: 35%`.

- **The montage turned every imported orga red, "jusqu'à 1h", and it was a TIME ZONE BUG in the
  save path.** Not a phase bug, not an import bug. Réglages builds the field's value as a wall
  clock with no zone, `2027-03-10T08:00`; `new Date()` reads that in the régisseur's own zone, so
  the screen was right. That same string travelled to Postgres, where `::timestamptz` reads a naked
  wall clock **in the session's zone, which on Supabase is UTC**. So 08:00 Paris was stored as
  08:00 UTC and came back as 09:00 Paris: the phase slid an hour forward under boxes that did not
  move with it, every box ended up an hour past the end of its worked day, and `phaseIssues`
  reported the lot as `hors-presence`. 64 h after a 09:00 origin is 01:00, which is the "1h".
  `setPhase` now runs `startISO` through `toISOString`, the way `setEventStart` always has, which
  is why the exploit never had this. **The live data is still an hour out**: re-entering the start
  hour of each phase in Réglages once, with this fix deployed, is what puts it back.

  How it was confirmed rather than theorised: a read-only query against the live base, which showed
  `phase.starts_at = 08:00Z` beside assignments at 24→40 and 48→64 while the worked days were
  [23,39] and [47,63]. Exactly one hour. See [[feedback-verify-root-cause-before-fixing]].

- **Clicking a person inside an événement removed them from it.** Reported as a bug and it was one
  in spirit: the click was wired straight to the removal, tooltip and all. Every click on the three
  grids selects now, and every removal is a named button in the panel. Same doctrine as the fourth
  round's "clicking a bar used to decide".

- **The panel was rebuilt, and it is now the same panel in all three moments.** `PhasePool` is gone,
  `PoolPanel` and `InfoPanel` replace it and `SidePanel` both. The full account, including why the
  montage's panel had no CSS at all and why its third aside landed under the grid, is in
  [[feature-admin-ui]] under "Two panes on the right". What matters here: a phase's panel is no
  longer its own thing, so the next change to either lands on both.

**Seventh round, 2026-09-12, four reports, and the biggest one moves the orgas onto the exploit.**

- **A day filter on the montage and the démontage.** "Il faudrait pouvoir filtrer par jour ... pour
  n'afficher qu'un seul jour." `buildPhaseAxis(phase, pxPerHour, onlyDay)` takes the day and the
  AXIS is what narrows, not the grid: everything drawn goes through `piecesOf` and everything read
  back goes through `segmentAt` and `hourOn`, so a day off the axis draws nothing, takes no drop
  and holds no dragged edge. One place to change, no second rule to keep in step. A day index the
  phase does not have leaves an empty axis rather than falling back to the whole phase.

  Two things came with it. `PhaseGrid` filters its own `boxes` and `fills` to what the axis has
  room for, so a lane is as tall as the day shown and "3 case(s)" counts what is under it. And
  **the picker is on the toolbar, not in the panel**: `PoolPanel` lost its own day select and
  takes `day` as a prop, because once the grid had a filter the screen carried two of them asking
  the same question. The kind filter stayed in the pane, it is about the list alone.

  **A grip now goes on the piece that CARRIES that edge of the box**, not simply on the first and
  last piece drawn (`Math.abs(piece.start - shown.start) < 1e-6`). With no filter the two rules
  agree; with one they do not, and a box running over Wednesday and Thursday looked at on Thursday
  alone would otherwise offer a "début" grip whose every position drops the Wednesday half nobody
  can see. An edge that is not on screen has no grip.

- **ORGAS ARE IN THE EXPLOIT'S "Disponibles" NOW**, and can be dragged from it onto a créneau or
  onto a pole's frise. This is the round's real work.
  - `exploitPoolRows` has two halves: bénévoles ordered by the volume they have left, then orgas by
    name. An orga declared no volume and is under no hour rule, so there is nothing to be short of
    and no figure to sort on; mixing them in would have ordered them by an answer none of them gave.
    The "Qui" filter is therefore no longer phase-only.
  - `DragPayload` became `{ kind, personKey, personName, fromShiftKey }`. Renaming the two fields
    is what made the type checker walk all four call sites rather than leaving an orga key to
    travel through `volunteerKey` and fail one lookup later.
  - `DRAG_MIME_ORGA` is set IN ADDITION to `DRAG_MIME` while an orga is in flight. A second type
    and not a field, because `dataTransfer.getData` answers nothing during a dragover and a pole's
    frise has to decide on hover whether it accepts what is coming.
  - A drop on a créneau writes an `OrganiserShift` (`addOrganiserToShift` / the new
    `moveOrganiserToShift`, one edit so one undo). A drop on somebody's box is an ordinary
    placement and never an exchange: an orga's place and a bénévole's are not the same thing, and
    sending the volunteer back would take a place off the créneau the orga was holding. Every
    créneau is a legal target, so `isLegal` is not consulted and no red banner can appear.
    The reserve refuses an orga outright: it means giving up a volume, and they have none.
  - An orga's box in a créneau is draggable now, so changing créneau is one gesture instead of ✕
    then place again.

- **A drop on the frise above a pole makes somebody responsable of it for two hours**, at the
  moment the pointer was on, snapped to the quarter and pushed back inside the event at the end.
  `assignOrganiserToPoleAt` is the one place in the tool that invents a window, and the comment
  says why it is allowed to when `assignOrganiserToPole` is not: the régisseur pointed at a moment.
  The whole `.pole-group-axis` strip takes the drop, ruler included, because `OrganiserBand` draws
  nothing until somebody is on it and the pole this gesture is for is exactly the one with nobody.
  **Both edges are then pulled on the band**, with the drag mechanics `Bars` paid for on 2026-09-11
  copied deliberately: listeners on the window, not a capture on the grip, and the last computed
  window handed to the commit. `InfoPanel`'s orga body gained "Responsable de" with the hours and a
  Retirer button, because a gesture that creates needs a way back that is not in Réglages.

- **A bénévole's name appeared twice in the info pane.** `VolunteerFiche` wrote an `h2` the pane's
  own `Head` had written two lines above. The head stays, it carries the orga / bénévole mark.

- **An orga's montage and démontage rows were truncated in the info pane.** `.rule-input` was
  written for Réglages, where a row is as wide as the window; `InfoPanel` is 320 px and draws the
  same markup, so the second select ran off the edge and was clipped. Inside `.panel` the two now
  stack and every field may be narrower than its own content. Réglages is untouched: no screen
  outside the two panes carries the `panel` class.

**Eighth round, 2026-09-12, same afternoon: five corrections of the seventh, and four of them are
about a control nobody could find rather than a control that did not work.**

- **The day filter was rendered and invisible.** It was a bare select between the zoom buttons and
  the head count, reading "Tous les jours", and the régisseur reported not seeing it at all. It was
  in the DOM the whole time, which is the lesson: *rendering is not the same as being found.* It is
  now first in the toolbar, after the switcher, inside a `.toolbar-field` label carrying the word
  « Jour ». The pole filter next door gets away with being bare because "Tous les pôles" names its
  own subject; "Tous les jours" does not say which jours, of what.

- **Stacking the panel's two selects left a horizontal scrollbar.** The clipping was gone and the
  overflow was not: `.rules-grid` asks for tracks of `minmax(240px, 1fr)`, and under 1500 px the
  info pane narrows to 240 px, so the track was wider than the pane that held it. Inside `.panel`
  the grid is one column with no side padding of its own, and `.panel-body` carries
  `overflow-wrap: anywhere` (**not** `break-word`: only `anywhere` lowers the min-content width,
  which is what actually stops a long e-mail widening the column).

- **Selecting a box on a phase now rings every other box of the same person**, which the exploit
  has always done and the phases never did. `selectedPerson(selection, assignments)` in
  `selection.ts` answers who a selection is about, box included, and it compares the KIND as well
  as the key: two files, two key spaces, and an orga `o1` is not a bénévole `o1`.
  `.phase-bar.is-kin` is the exploit's `.box.is-kin` said about a bar. Its own unit test file,
  `selection.test.ts`.

- **The pane offers an orga on a créneau whether or not it has a hole.** The picker was behind
  `fill`, so it only appeared after clicking one of the dashed "à pourvoir" boxes: on a full
  créneau, or one clicked anywhere else, the pane offered nothing. A créneau over its headcount is
  a legitimate thing to write, exactly as it is for a bénévole, and the grid draws the sureffectif
  in red rather than refusing it. The wording still narrows under `fill`.

- **The responsable's band could not be "tirée".** Two 6 px grips on a 13 px band, invisible until
  hovered, on an element that gave no sign of being draggable. **The whole band is the handle now**:
  dragging the body SLIDES the window keeping its length, dragging an edge changes that end alone,
  and a press that travels under three pixels is a click that opens the fiche. One `pointerdown`
  handler decides between the three by distance, so no click can fire at the end of a committed
  drag. The band is 18 px, the grips 9 px with a permanent hairline, `cursor: grab`.

**Ninth round, 2026-09-12, six reports. THIS IS THE ONE THAT NEEDS A MIGRATION: 14, PLAN_FORMAT 6.**

- **`--paper` was never a token in the stylesheet**, and four rules used it. The moment selector's
  current button was `background: var(--ink); color: var(--paper)`, and an undefined custom
  property is invalid at computed-value time, so `color` fell back to inherit: the label kept the
  surrounding ink and was painted on a background of that same ink. In the dark theme `--ink` is
  nearly white, hence "un background clair sur écriture claire". The other three were silently
  transparent backgrounds (`.phase-bar`, `.box.is-orga-box`). The selected button is the accent
  with `--accent-ink` now, which is the one pair defined to sit on each other in both themes.

- **The zoom is a continuous slider and the grid fits itself to the screen.** Five fixed steps
  behind − and +, whose widest was 46 px/h on a phase, left a filtered montage day two thirds
  empty: "le zoom maximal ... reste trop petit", and "il faudrait que la vue se cale pour
  automatiquement prendre toute la place disponible quand on change de filtre". So:
  `EXPLOIT_ZOOM` / `PHASE_ZOOM` bounds and `fitZoom` in `layout.ts`, `axisSpan` in `phaseAxis.ts`
  (the same arithmetic `buildPhaseAxis` lays out, so the fit and the drawing cannot disagree), and
  `ZoomSlider.tsx` whose track is **logarithmic**: the useful range is eighty to one, and on a
  linear track the readable half of it would sit in the last centimetre. The fit runs on the way in
  and on every change of day, never on a window resize or a plan edit, because a zoom chosen by
  hand is a decision. "Ajuster" asks for it again.

- **The 6 h / 8 h band is 💪 and 💪💪, not two oranges.** "Pas assez clair ... au lieu d'avoir une
  couleur, qui peut être confuse avec les autres couleurs, il pourrait y avoir un émoticone." The
  régisseur first proposed 💪🏼 and 💪, which differ only in skin tone and would have been a colour
  difference again at 11 px; they chose one arm against two when that was put to them. `volumeMark`
  and `volumeLabel` in `layout.ts`, `.box-volume` on the box, `.legend-mark` in the legend, and the
  hours still written in words in the tooltip and on the fiche's chip.

- **A pole says whether its responsable stays in support.** `Pole.leaderSupportOnly`, because
  whether running a pole and holding a créneau of it fit into one pair of hands is a fact about the
  JOB: "selon les pôles, soit il y a besoin qu'il reste en support, donc sans créneau, et sur
  d'autre pôle il peut prendre un créneau en même temps". `PlanIndex.supportOnlyBreaches` reports
  what contradicts it, in orange, on the box and in the pane; `validate.ts` does not read it and
  nothing is ever refused. **The role's own hours narrow it**: responsable of the bar from 14h to
  18h and working the bar at 22h is two jobs in a row, not two at once. A role with no hours covers
  the whole event. Default false, which is exactly what the tool did before the field, so no
  existing plan lights up the day it ships. **Migration 14 and PLAN_FORMAT 6**, and the régisseur
  chose "réglage + signalement" over "réglage muet" when asked.

- **Dropping a box on nothing takes the person out of it, on all three grids.** The grid's own
  viewport (under the last pole, past the end of the axis) and the pane on the right, plus the bin.
  Every real target (`ShiftBlock`, `PoleTrack`, the poles' frises) calls `stopPropagation` on its
  own drop, which is what makes "reached the scroll container" mean "landed on the background".
  `TrashTarget` left `GridScreen` and became a component; a phase drag now carries `assignmentKey`
  (the window alone cannot say which box was grabbed when a person holds two with the same hours)
  and sets `DRAG_MIME` beside its `text/plain`, so the pane and the bin can recognise it during a
  dragover. `PoolPanel`'s "Disponibles" accepts the drop in the three moments; "Réserve" stays the
  exploit's, said by `onDropReserve` being absent rather than by a second rule.

  Not done, and it cannot be: **a custom mouse cursor during the drag**. HTML5 drag and drop lets
  the page choose only among the browser's own `dropEffect` icons; the dashed highlight and the
  bin are the whole of the feedback available.

- **No red banner on an exchange.** `legalShifts` answers "may this person be ADDED here", computed
  with their own box removed and nobody else's. On a swap the other person leaves at the same
  instant and the two travel in opposite directions, so `DragReason` now asks the question on the
  plan the drop would actually produce: both assignments gone, then `blockersFor` once per
  direction. Silent when the exchange is fine, which it usually is.

**Where the code is:**

- `tools/src/phase.ts` (new): the two phases, their window algebra, their days and half-days,
  who is on site, and what the grid draws. `tools/src/phase.test.ts` is its 25 tests.
- `tools/src/model.ts`: `Organiser` (was `Leader`), `OrganiserShift`, `PhasePresence`.
- `tools/src/plan.ts`: `Plan.montage`, `Plan.demontage`, `Plan.organiserShifts`,
  `PlanIndex.headcountOf / orgasOn / organiserClashes`, PLAN_FORMAT 5.
- `app/src/store/phaseEdits.ts` (new) with `phaseEdits.test.ts`: every edit a phase takes.
  `assignWindow` is the one to read first.
- `app/src/screens/PhaseGrid.tsx`, `PhaseCard.tsx`, `PlanningScreen.tsx` (all new), and
  `app/src/components/phaseAxis.ts` with its tests: the geometry of a multi-day axis with holes,
  `hourOn` and `trimTo` included, which is where every trimming rule lives since 2026-09-11.
- `app/src/components/PoolPanel.tsx`, `InfoPanel.tsx`, `VolunteerFiche.tsx`, `poolRows.ts` and
  `selection.ts`: the two right-hand panes, shared with the exploit since 2026-09-11.
  `PhasePool.tsx` and `SidePanel.tsx` are gone. See [[feature-admin-ui]].
- `db/migrations/2026-09-10_orgas_and_phases.sql`: the rename, six new tables, both plan
  functions replaced, `get_leader_planning` renamed, `min_plan_format` to 5.

**Two things found and fixed on the way, neither of them asked for:** `volunteer_refused_slot`
had been created by migration 11 **with RLS off**, so it was readable with the anon key since
2026-09-10; migration 13 closes it and `anon-check` now probes it. And
`db/checks/roundtrip_counts.sql` still counted `pole_leader`, a table migration 9 dropped, so
the query had simply been erroring since then.

**The brief, unchanged:** Read this before touching
`Leader` anywhere, before adding anything to `Plan`, and before deciding where a new screen
goes. The three answers the régisseur gave on the blocking questions are in "Decisions" below
and are settled, not open.

**Onzième round 2026-09-12, trois retours, et les trois étaient dans deux règles CSS.** Le
dixième round avait cru corriger la troncature et le rouge; il s'était trompé sur les deux, et la
suite dit pourquoi, parce que c'est la même leçon deux fois.

- **`.box.is-mini` déclarait `height: 22px` sans jamais toucher au `flex: 0 0 24px` hérité de
  `.box`.** Dans `.phase-event-slots`, qui est une COLONNE, c'est la base flex qui fait la
  hauteur: chaque place était posée à 24 px, rigide, deux de plus que ce que `eventBlockHeight`
  comptait, soit `2 × n` pixels manquants, et `overflow: hidden` les mangeait. Le dixième round
  avait corrigé une autre erreur de trois pixels dans la même somme et conclu trop vite. La règle
  porte maintenant `flex: 0 0 22px` à côté de `height: 22px`, et `.phase-event-title` porte
  `flex: 0 0 auto` pour ne jamais rétrécir.
- **`.box.is-orga-box` posait le fond, la bordure et la couleur du texte sans condition, et elle
  arrive APRÈS `.box.is-illegal` et `.box.is-picked` dans le fichier, à spécificité égale
  (0,2,0).** L'ordre l'emportait: une case d'orga en faute gardait son fond blanc et ne passait au
  rouge qu'au survol, parce que `.box.is-illegal:not(.is-picked):hover` compte un sélecteur de
  plus. C'est pour ça que le fond rouge ajouté au dixième round ne se voyait pas sur ces cases: il
  était bien écrit, il perdait. La règle est coupée en deux: la marque (`border-left-width: 3px`)
  reste inconditionnelle, les couleurs passent sous `:not(.is-illegal):not(.is-picked)`. Vaut
  aussi pour la grille Exploit, où le même bug existait sans avoir été remarqué.
- **L'italique des noms d'orga est retiré**: le bord gauche épais et l'émoji de `PersonMark`
  disent déjà « orga ».

**LA LEÇON, ÉCRITE EN TEST.** Les deux erreurs de géométrie ont survécu à une suite verte parce
que chaque test mesurait la même arithmétique que le composant. `EVENT_GEOMETRY` est exporté de
`PhaseGrid.tsx` et `phaseGeometry.test.tsx` RELIT `styles.css` pour comparer chiffre par chiffre,
plus une somme complète pour 1, 2 et 6 places. Vérifié en remettant le bug: le test tombe.
Un test qui ne lit que le code ne peut pas attraper un désaccord entre le code et la feuille de
style.

**Douzième round 2026-09-13: les flèches et Suppr sur le montage et le démontage.**

L'exploit se parcourt au clavier depuis le 2026-09-08, les phases non. `phaseNav.ts` est un
second fichier plutôt qu'un paramètre de `gridNav.ts`, **parce que la géométrie n'est pas la
même**. L'exploit est un damier: des créneaux de longueur fixe tenant N places, donc un curseur
est un créneau plus un indice, et « bas » est la place du dessous. Une phase n'a pas de damier du
tout: une case est une personne sur sa propre fenêtre, les cases sont empilées par `packRows`, et
deux cases voisines ne commencent presque jamais à la même heure. « Bas » ne peut donc pas être
« le même indice une ligne plus bas »; c'est **la case la plus proche dans le temps sur la ligne
d'en dessous**, ce que fait l'œil quand il descend d'une ligne. Une case sous le curseur gagne
toujours, même si une autre commence plus près.

Trois décisions valent d'être notées:

- **Le curseur EST la sélection**, et non un second état à côté. Deux états seraient deux réponses
  à « quelle case », et ils divergeraient au premier clic qui n'en met à jour qu'un. C'est aussi
  ce qui fait que la case se dessine toute seule: la case pointée est la case sélectionnée, donc
  déjà remplie en bleu, exactement comme sur l'exploit où `.box.is-cursor` n'a volontairement
  aucun style.
- **Les lignes vides sont conservées dans le modèle mais traversées par les flèches.** Une voie
  sans personne prend quand même une ligne à l'écran, donc elle en prend une ici; mais s'y arrêter
  serait une touche qui a l'air de ne rien faire.
- **Suppr décide où aller AVANT de supprimer.** Après la suppression il ne reste rien d'où
  s'élancer, et laisser la sélection sur une case disparue viderait le volet sans autre retour
  vers la grille que la souris. La barre d'outils dit ce qui vient d'être fait: une touche qui
  retire sans un mot ne se distingue pas d'une touche non branchée.

`rowsByPole` est calculé une fois et partagé entre les voies qui les dessinent et les flèches qui
les parcourent, pour que les deux ne puissent pas être en désaccord sur l'emplacement d'une case.

## What the régisseur asked for, 2026-09-10

**Two kinds of person, not one.** Until now the tool knew *bénévoles* (who fill the volunteer
form and are scheduled) and *responsables de pôle* (who fill their own form and are only
recorded). That was a misreading of who fills the second form. There are **bénévoles** and
**orgas**, and:

- The form built for "responsables" is in fact **the orga form**. It is how an orga enters the
  tool and it carries their whole profile.
- **A responsable is an orga who has been put in charge of a pole.** Every responsable is an
  orga; most orgas are not responsables. The régisseur picks a responsable **from the list of
  orgas**, they are never typed in twice.
- **An orga is not subject to the volunteers' rules**: no hour ceiling, no pole preference, no
  time preference, none of the scoring.
- What an orga declares instead: **from when they are on site for the montage**, and **until
  when for the démontage**, plus **one or several poles** where they work during those phases.

**Montage and démontage are two more grids.** Same idea as the existing grid, different rules:

- **The poles are not the event's poles.** They are their own list, per phase.
- People are placed **by day or by half-day**, not by two-hour créneau. The exceptions are
  punctual **événements** ("Déchargement camion"), which sit on a precise time range, ask for a
  **number of people**, and may take them **from any pole**.
- A phase **runs over several days**. A setting says which hours are **not worked**, typically
  00h to 08h, so the grid does not draw an empty night every day.
- A setting says which **poles** the phase has. Whatever else it has, it always has **Général**,
  where every orga present that day or half-day sits **by default**, unless they have been given
  a pole for that particular half-day.
- **A bénévole may also come to the montage and/or the démontage.** The régisseur sets **from
  which montage day** bénévoles may come and **until which démontage day** they may stay. If a
  bénévole says they are there for the montage without giving hours, they are placed over **the
  whole bénévole-open window of that phase**.
- **No solving on these two phases for now.** The régisseur distributes the orgas by hand. The
  automatic distribution stays the exploit's business.

The existing scope, the event itself from 12h to 06h, is called **l'exploit** (the word is in
`ToDo.txt` and is the one to use in the UI).

## Decisions (answered by the régisseur, 2026-09-10)

1. **An orga can be placed on an exploit créneau, by hand only.** The solver never picks one.
   An orga placed there is exempt from the hour rules (H3 consecutive, H4 blocks, H5 volume)
   and from every preference score, but is still refused a **double booking** (H1) and still
   counts in the créneau's headcount (H6).
2. **Every orga gets an access code**, the 14-character one, not only the responsables. They all
   need to read the planning. This carries forward the cost already accepted in
   [[feature-leader-access]]: a code opens the personal details of every bénévole.
3. **Montage and démontage each have their own pole list**, with a "reprendre les pôles du
   montage" button on the démontage side. `Général` exists in both and cannot be deleted.

## The design taken from it (2026-09-10, no code yet)

### One plan, three phases

Montage, exploit and démontage live in **the same `Plan`**, saved together. A person is one
person across the three: one access code, one fiche, one line in the volunteer view listing
everything they do. Splitting them into three plans would have meant three saves, three
imports and no way to draw somebody's whole event.

### A phase carries its own origin, it is not a negative offset

Every hour in this codebase is decimal hours from the event start, and every screen, ruler,
export and rule assumes `0 <= h <= lengthHours`. A montage three days earlier as hours -72 to 0
would have broken that assumption everywhere, silently.

So **each phase carries its own `startISO` and its own `lengthHours`**, and its shifts are
decimal hours from **that** phase's start. Every helper (`toIso`, `toLabel`, `toClock`,
`fmtHours`) already takes the origin as an argument, so they are reused unchanged: what changes
is which origin is passed. The exploit keeps `Plan.startISO` and `Plan.lengthHours` exactly as
they are today, so no existing plan moves.

### What a phase holds

- `id`: `'montage' | 'demontage'`, `label`, `startISO`, `lengthHours`.
- `offHours`: the windows nobody works, given as a daily pattern (00h to 08h by default) so
  adding a day does not mean re-entering the night. The grid skips them, drawing days as
  separated columns rather than one long empty stretch.
- `dayPartSplit`: where a day is cut into matin and après-midi. Drives the default box a click
  creates; it is not a rule, an edge can be dragged afterwards.
- `poles`: its own list, `Général` always present and undeletable.
- `events`: the punctual ones. A window, a `headcount`, a label, and no pole: they are drawn as
  a band over the grid, the way artists are drawn on the exploit, and people are dragged into
  them from any pole. A short band is the only thing on these two phases that has a target
  count and can therefore be shown as short.
- `volunteersFrom` / `volunteersUntil`: the day from which (montage) or until which (démontage)
  a bénévole may be on site. Also the default window a bénévole who declared no hours is given.

### Where the grids go, since the choice was left open

**A phase selector inside the existing Grille tab**, not two new tabs. Three reasons:

- It is the same object: poles down the side, time across the top, people in boxes. The
  toolbar, the side panel, the keyboard navigation, the undo stack and the colour code are all
  reused rather than reimplemented twice.
- The tab bar already carries eight tabs. Two more would make the shell the widest thing on
  screen and would suggest three unrelated tools.
- The régisseur thinks "le planning", in three moments. The selector reads Montage / Exploit /
  Démontage and carries the same badge the Grille tab carries, per phase.

Réglages gains a Montage and a Démontage section beside the event's. The dashboard gains a
short montage / démontage block (who is on site, which événements are short). The print screen
and the volunteer, orga and responsable views list the three phases one after another, because a
person needs their whole event on one page, not one page per phase.

### `Leader` becomes `Organiser`

`Leader` is renamed **`Organiser`** and `Plan.leaders` becomes `Plan.organisers`, because the
type now means "somebody who fills the orga form", not "somebody in charge of a pole". Keeping
the old name would leave every future session reading `Leader` as responsable, which is now a
different and narrower thing. `LeaderRole` keeps its name and its meaning, **being a
responsable**: an orga holding a `LeaderRole` on a pole is a responsable of that pole, and that
relation is exactly how a responsable is picked from the list of orgas. Its `leaderKey` becomes
`organiserKey`. As in the 2026-09-09 split, renaming the field is what makes the type checker
walk every site instead of leaving one to be found at runtime.

`Organiser` gains, beside the fields it already has: `montageFrom` and `demontageUntil` (the
moment they are on site, per phase), and `poleKeys` per phase (where they work when they are
not in `Général`).

`Volunteer` gains, for each of the two phases, the same three-part shape the form answers
already use in [[feature-free-text-answers]]: a boolean "is there", the sentence as typed kept
verbatim, and the windows the importer read out of it, correctable by hand, `manualFields` and
`needsReview` included. No hours given means the phase's whole bénévole window.

### What does not change

- The engine's rules, the solver and the proposals stay the exploit's. `validate()` is extended
  with the orga exemption of decision 1 and with nothing else. No solving on montage or
  démontage, by explicit instruction.
- The exploit's grid, rules and imports keep their current behaviour to the letter.

## The staged build (all five done, 2026-09-10)

1. **Model and persistence.** `Organiser` rename, the phase types, `PLAN_FORMAT` 5, the schema
   and its migration, `normalise.ts`, the round trip and its tests.
2. **Réglages.** The two phase sections: dates, unworked hours, day split, poles, the bénévole
   window.
3. **The grid.** The phase selector, the multi-day axis with its skipped nights, day and
   half-day boxes, the événements band, drag and drop, the orga exemption on the exploit.
4. **Imports.** The orga form (which is today's leader import, widened), and the bénévoles'
   montage / démontage answers.
5. **The rest of the screens.** Dashboard, impression, and the volunteer, orga and responsable
   views.

All five are built. What was decided while building them, beyond the design above:

- **The unit of a phase grid is the half-day, not the pixel.** The exploit is drawn to the
  quarter-hour because 03h and 04h are different jobs; a phase is worked by the half-day, so a
  column is a half-day and a box is a person. It also means the phase grid shares no rendering
  code with the exploit's, which is why the two could be built without touching each other.
- **Default placements are derived, never stored.** `placementsFor` recomputes them from what
  each person declared, every render. Storing them would freeze them: changing an arrival, or
  opening one more day to the bénévoles, would leave yesterday's picture on the grid with nobody
  able to see why.
- **The orga on an exploit créneau went in as `OrganiserShift`, beside `assignments`.** Putting
  them in the same list would have meant teaching a dozen rules in `validate.ts` to ask "is this
  one exempt". Instead the engine knows exactly one thing about them, `PlanIndex.headcountOf`,
  which every capacity read now goes through: the solver, the gap counts, the legality predicate
  and the shift report. That is the whole of the change to the exploit.
- **The two phase answers arrive as one column.** The real volunteers' form already asks
  "Serais-tu prêt à faire du montage / démontage ?" at column 43, which the import used to treat
  as a decoy. It is bound as `phaseHelp` and answers for both phases; two narrow matchers stand
  ready for the day the form splits the question.
- **The orga form's phase answers are kept as words, not hours.** Turning "je serai là mercredi
  midi" into a number needs dates that move for months; the sentence goes into the orga's note
  and the régisseur sets the arrival on the fiche, from a list of that phase's own half-days.
