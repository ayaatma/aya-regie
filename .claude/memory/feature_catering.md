---
name: feature-catering
description: "Les repas et les tickets boisson, built 2026-09-12. Meal services as real dates, an earned quota on the exploit against a plain presence on the phases, ticked boxes that store only the régisseur's disagreements, the volunteer diet and allergy columns the importer used to throw away, MIGRATION 15 WRITTEN AND NOT APPLIED, PLAN_FORMAT 7."
metadata:
  type: project
---

**State 2026-09-12, after a second round on the régisseur's reports: BUILT and green.** 261
engine tests and 348 app tests pass, both packages typecheck, `npm --prefix app run build`
succeeds, `npm run sql-check` (397 statements) and `npm run schema-check` (150 fields round trip)
are green. The second round touched no schema and no plan format: it is code and CSS only.

**MIGRATION 15 IS APPLIED (the migrator listed it as « déjà appliquée » on 2026-09-13; the paragraph below predates that).** The Réglages line under a service was reworded on 2026-09-13, see [[feature-event-abstraction]].

**MIGRATION 15 IS WRITTEN AND NOT APPLIED**,
`db/migrations/2026-09-12_catering_meals_and_drink_tickets.sql`: five columns on `event`, two on
`volunteer`, three new tables, RLS for all three, both plan functions replaced whole, and
`min_plan_format` to 7. **PLAN_FORMAT is 7.** It ships with its deploy or a régisseur's tab drops
`Plan.catering` on its next save, taking every rule and every ticked box with it. The developer
runs `npm run migrate -- --apply` and `npm run deploy` themselves; `npm run migrate` (dry) already
reports it as the one pending migration, and `db-check` reports the ten missing objects until it
is applied. Migration 14 IS applied, contrary to what `MEMORY.md` said before today.

## The brief, in the régisseur's own words (2026-09-12)

> Le catering a besoin de savoir combien de personnes mangent chaque jour, de répertorier le
> nombre de régimes alimentaires particuliers ainsi que les allergies. Chaque personne a aussi
> droit à des tickets boissons. Un bénévole ou un orga a droit à des repas et tickets boissons
> selon le nombre d'heures qu'il a travaillé. Cela doit être consigné dans les réglages de
> l'événement. Ici par exemple pour l'exploit, travailler 4h donne droit à 1 repas, travailler 6h
> ou 8h donne droit à 2 repas. Chaque tranche de 2h travaillé donne droit à 1 ticket boisson. Les
> orgas eux ont droit aux 2 repas même s'ils ne travaillent pas pendant l'exploit, et ont 2
> tickets boissons. Mais pour un autre événement, ces règles peuvent être différentes, il faudra
> donc faire un réglage assez flexible. Pendant le montage/démontage, les orgas et bénévoles ont
> le repas prévu par défaut s'ils sont présents à l'heure du repas (12h-14h le midi, 19h-21h le
> soir). Pour l'instant ce sera des checkbox à indiquer par le régisseur par personne (par défaut
> rempli selon leur temps d'affectations sur le montage).

## The five decisions

**1. A SERVICE IS A REAL DATE AND A REAL HOUR, not an offset into a moment.** Everything else in
this codebase counts decimal hours from an origin, and is right to: a créneau belongs to the
exploit, a box belongs to the montage. A meal belongs to neither. The last day of the montage IS
the day of the event, and midi that day is ONE service with ONE queue at it, whichever moment
each person is on site for. Counting it once per moment would have told the caterer to cook
twice. So `MealService` carries `startISO`/`endISO` plus `inMoment`, the same window expressed in
each moment's own hour axis, and presence is tested per moment against the same plate. Its key is
`2027-03-13|midi`: a day and a window id, never a label.

This is also why `MealWindow.fromHour` is a CLOCK hour, alone in this project. "Le repas de midi
est de 12h à 14h" is true of every day of the montage and of the event alike. `PlainClockField`
in `app/src/components/ClockField.tsx` exists only for these four fields.

**2. ENTITLEMENT AND PRESENCE ARE TWO DIFFERENT RULES**, because the régisseur described two
different rules:

- **exploit**: a meal is EARNED. `mealsForHours` is a step function over `exploitTiers`, the
  highest tier reached wins, and an orga floor (`organiserMeals`) lifts it and never caps it. The
  quota is then SPENT on the services nearest the hours the person works.
- **montage / démontage**: a meal is EATEN. A strict overlap between a phase placement and the
  service window, no quota and no tolerance, which is the régisseur's own wording.

A service already ticked by a phase SPENDS the exploit quota rather than adding to it: one plate
is one plate.

**WHY TIERS AND NOT A FORMULA.** "4h → 1 repas, 6h ou 8h → 2 repas" is a step function with two
steps, and the next event will have different steps, or three, or one. `hours / 4` rounded and
capped fits this year and is wrong the next, with no way for anybody but a developer to say so.

**3. REACH_HOURS IS A CONSTANT AND NOT A SETTING** (`catering.ts`, 2 h). It is not a rule anybody
agreed to, it is the file's guess at what a régisseur would have ticked, and a guess does not
belong in Réglages beside the figures the association actually decided. Somebody whose créneau
ends at 14h eats at midi; somebody whose first créneau starts at 20h does not, even though they
are owed a plate, and the régisseur ticks it themselves if they know better. A person with a
quota and NO presence at all (the orga floor) has nothing to be near, so every service of the day
is a candidate in clock order.

**4. ONLY THE DISAGREEMENTS ARE STORED.** `MealChoice` is one row per box the régisseur ticked or
unticked AGAINST what the engine computed, and `setMealChoice` deletes the row the moment the two
agree again. A stored default is a frozen default: move a créneau, change a tier, open one more
montage day, and yesterday's picture would stay on the caterer's sheet with nothing saying it had
stopped following the plan. Same doctrine as `phase_assignment`, written down in the same words
over the three SQL tables. A hand-ticked box is outlined in blue on screen and survives
everything; `↺` on a row gives that person's boxes back to the tool.

**5. THE DIET AND THE ALLERGY WERE ALWAYS IN THE FORM.** Columns 11 and 12 of the real export
("Ton régime alimentaire", "As-tu une allergie…") have been there since the first export and the
importer threw them away, because nothing downstream had a use for them. They are now
`Volunteer.diet` and `Volunteer.allergies`, beside the ones `Organiser` already had. **The
allergy matcher runs BEFORE the diet matcher**, the same order and for the same reason as
`import-organisers.ts`: a form asking about both in one sentence is asking about allergies, the
diet matcher is the broader of the two, and binding them the wrong way round puts an allergy in
the column a caterer reads as a preference. Both are in `EDITABLE_FIELDS`, so a régisseur can
tidy "végé" into "Végétarien" and a re-import never undoes it.

## Where the code lives

- `tools/src/catering.ts`: the whole engine half. `mealServices`, `defaultMealChoices`,
  `cateringReport`, `setMealChoice`, `cateringCsv`, `isStandardDiet` / `isNoAllergy`.
- `tools/src/model.ts`: `MealWindow`, `MealTier`, `CateringRules`, `MealChoice`,
  `CateringSettings`, `DEFAULT_CATERING`, and `Volunteer.diet` / `.allergies`. **`PersonKind`
  moved here from `phase.ts`**, which now re-exports it, because the catering types name it and
  `model.ts` imports nothing.
- `tools/src/plan.ts`: `Plan.catering`, PLAN_FORMAT 7.
- `app/src/screens/CateringScreen.tsx`: the tab. `app/src/screens/CateringCard.tsx`: the Réglages
  card. `app/src/store/cateringEdits.ts`: every edit.
- `db/schema.sql`: `catering_service_window`, `catering_meal_tier`, `meal_choice`, the five
  `event` columns and the two `volunteer` ones.

`schema-check-cli.ts` gained two things: the catering interfaces in its list, and a third way of
recognising a written field, `{catering,`, which is a field that is itself the ROOT of a jsonb path. Without
it `Plan.catering` read as never written, which is exactly the check working as intended.

## Second round, 2026-09-12: eight reports from the régisseur's own use

Four of them were the catering's, four were the montage's. The two that changed a rule rather
than a stylesheet are the first two.

**1. A BÉNÉVOLE'S PHASE ANSWER IS NO LONGER A PLACEMENT.** "Les bénévoles qui ont répondu être
disponible au montage / démontage ne devraient pas être automatiquement affectés, mais seulement
dans l'onglet disponible." The two answers never meant the same thing: an orga writes down when
they ARE on site, a bénévole answers whether they WOULD BE WILLING to come, and there are a
hundred and twenty of the second for a montage that needs fifteen. Drawing the second buried the
handful the régisseur actually wanted there.

`declaredPlacements` returns nothing for a bénévole, so `placeDeclared` and its button count only
orgas. `setVolunteerPhase` stopped calling `syncPerson`, which matters as much: `syncPerson`
REPLACES a person's boxes from their declaration, so leaving it in would have DELETED the boxes a
régisseur had dragged by hand the moment they corrected the answer. A bénévole is still in
`phasePeople`, still in « Disponibles », still measured against their own declaration when placed.

**2. THE MEALS OF A PHASE READ THE BOXES, AND THE DECLARATION WHEN THERE ARE NO BOXES.** Straight
out of the first change: "les bénévoles qui sont au montage ne sont pas indiqués dans les repas du
montage". With nobody placed, `presenceByMoment` found nothing and the caterer's sheet lost every
bénévole of the montage at once.

The order is the decision. A BOX ALWAYS WINS, because a box is a decision: somebody whose Thursday
was trimmed to 09h-11h leaves before lunch, and feeding them anyway would be the tool overruling
the one person who knows. THE DECLARATION FILLS IN FOR SOMEBODY WITH NO BOX AT ALL, because they
turn up and expect lunch, and a missing plate is the worse failure. It is already narrowed twice
before it is read: only if the régisseur opened the phase to bénévoles, and only inside the window
they opened.

**3. An événement box turns red.** It was the one place on a phase where nothing ever did, and the
place it matters most: an événement is filled from whoever is around, so "was this person even
there" is asked of nobody. Same `phaseIssues`, same `is-illegal`, same messages in the tooltip as
a bar on a pole lane. `phaseIssues` already produced the issue; only the class was missing.

**4. `.phase-bar.is-illegal` gained the fill.** "La même coloration que pour la grille Exploit,
donc avec le background de la case aussi en rouge." A red border on a white bar among fifty white
bars is a detail. The pole's colour on the left edge goes with it, on purpose.

**5. THE ÉVÉNEMENT BLOCK WAS THREE PIXELS SHORT, so the last place was drawn with its bottom
sliced off.** `eventLaneHeight` was `EVENT_TITLE_H(18) + n * (ROW_H + ROW_GAP) + LANE_PAD` and the
block was that minus the padding, while the stylesheet lays out 2 px of border, a 17 px lid, 2 px
of slot padding top and bottom, n rows of 22 and n-1 gaps of 2. `overflow: hidden` swallowed the
difference in silence. `eventBlockHeight(rows)` now spells the sum out with a constant per CSS
value it mirrors, and `phaseGeometry.test.tsx` asserts the same sum.

**6. The Orgas card had literally no padding, because its container had no CSS at all.** The list
was in a `.setup-shifts`, a class used at that one place and matching no rule in the stylesheet, so
the rows and both explanation paragraphs touched the card's border. It is `.setup-orgas-list` now,
laid out like `.setup-lineup`, with `.setup-orgas-note` on the two paragraphs and no double rule
under the head.

**7. EVERY SECTION OF RÉGLAGES ARRIVES FOLDED**, through `SetupSection`: a caret, the title, one
line of counts, and `actions` for what has to stay reachable while folded (a phase's « Activer »).
The pole groups fold too, with a caret of their own rather than the whole head, because their head
holds a colour picker, an editable name and three buttons and a `<button>` around those is invalid
markup. **THE CONTENT IS HIDDEN, NOT UNMOUNTED**: a card holds drafts (`ClockField`,
`NumberField`, which fiche is open, which deletion is armed) and unmounting would throw an edit in
progress away; `hidden` also takes the subtree out of the tab order.

**8. The Catering screen had the wrong shell, which was both of its layout complaints.**
`.screen-main` is a two-row grid, a toolbar and ONE body; the screen handed it five children, so
every row past the second was sized `auto` and ran off the bottom of the window with nothing to
scroll. And the cards were `.setup-group`, capped at 900 px with `overflow: hidden`, so the people
table scrolled inside a third of the screen while the rest stayed empty and the overflow was
clipped rather than scrollable. It is `.screen is-wide` over one `.catering-body` that scrolls,
`.catering-card` with no width cap, and `.catering-scroll` as the only place horizontal scrolling
is allowed. The two summary cards sit side by side while there is room.

## What is deliberately NOT built

- **Nothing is refused, ever.** No rule reads the catering, the solver never sees it, and a
  person can be ticked for a service they are not on site for: the régisseur may know something
  the tool does not.
- **No per-person meal choice on the form.** The régisseur said "on fera peut-être un choix par
  personne"; for now it is the régisseur's checkbox, defaulted from the placements.
- **Nothing on the volunteer's own view.** A bénévole is not told "tu as droit à 2 repas et 3
  tickets" yet. It would be a small addition to `VolunteerView` and nobody asked.
- **The fixtures carry no diets.** `app/public/fixtures/*.json` were written before the field
  existed, so the Catering screen shows zero special diets on them. `npm run fixture -- --all` in
  `tools/` re-imports the SAME CSVs (which already carry the answers in columns 11 and 12) and
  fills them in. Not run here: it rewrites ten files and this project is not under git.

See [[feature-montage-demontage]] for the phases the meals are counted across,
[[feature-form-import]] for the 44 columns, [[feature-supabase]] for the save doctrine these
tables follow, and [[project-engine-api]] for the barrel every screen reads this through.
