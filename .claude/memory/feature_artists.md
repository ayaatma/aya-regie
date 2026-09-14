---
name: feature-artists
description: "2026-09-13, « Artistes V2 »: the line-up stops being a name and two hours and becomes a fiche per act on its own tab. Size, changement de plateau, balances (which may fall the day before, on the montage), défraiement with car trips, technical rider, members with meals, tickets, payment and invitations. MIGRATION 17 WRITTEN AND NOT APPLIED, PLAN_FORMAT 9. No visual check in a browser."
metadata:
  type: project
---

**State 2026-09-13, after a second round (a member may also be a bénévole or an orga): BUILT and green. 286 engine tests and 384 app tests pass**, both packages
typecheck, `npm --prefix app run build` succeeds, `npm run sql-check` (488 statements) and
`npm run schema-check` (193 fields, `ArtistMember` and `CarTrip` added to its list) are green.

**MIGRATION 17 IS APPLIED AND THE FRONT DEPLOYED (the developer did both on 2026-09-13); the paragraph below predates that.** `db/migrations/2026-09-13_artists_as_files.sql`.
`npm run migrate` (dry) lists it as the one pending migration and reports the 19 objects it adds
as missing until it runs (20 objects since the second round). **PLAN_FORMAT is 9.** Migration 17 was EDITED for the second round, which is allowed because it has never run. It ships with its deploy or a régisseur's tab
writes every act back as a name and two hours, which is every member, every trajet and every
ticked plate of the line-up gone at once. The developer runs `npm run migrate -- --apply` and
`npm run deploy` themselves. Migration 16 IS applied (the migrator said « déjà appliquée » today),
whatever [[feature-event-abstraction]] says.

**CHECKED IN HEADLESS CHROME on 2026-09-13** (`npm run shots`, see
[[feedback-visual-check-with-headless-chrome]]), both schemes: the fiche, the folded rows, the
ruler with balances, the pool filter, the stacked tabs. Three things were fixed from the shots:
the two textareas were 260 px wide (now full width, 900 px max), the folded rows' summaries did
not line up (`.artist-toggle` min-width 170 px), and « 2 sur 1 » read wrong (now « 2 nommées sur
2 prévues », and `addArtistMember` raises `size` when the names outnumber it). The montage's
Artistes lane, the démontage, the catering with a linked member and the orga fiche were checked
on the `balanced+phases` fixture (built for that, see [[feedback-visual-check-with-headless-chrome]]);
from those shots: a changeover band narrower than 48 px carries no text (the tooltip has it),
the members' fields keep 120 px so the row scrolls sideways instead of squeezing the selects.

## The brief (ToDo.txt, « ARTISTES V2 »), and what each line became

The régisseur listed every fact they know about an act and had nowhere to write. All of it is on
`Artist` now, flat, in `tools/src/model.ts`:

- Nom du groupe → `name` (unchanged). Nombre de personnes → `size`, **a number of its own and
  not `members.length`**, because « ils sont cinq » is known weeks before a single name and the
  caterer needs the five; the fiche says « 3 nommées sur 5 ».
- Heure de début et de fin → `start` / `end` (unchanged, the validator's only two fields).
- Changement de plateau avant / après → `changeoverBefore` / `changeoverAfter`, hours, 0 is
  « none » and the default. Typed in MINUTES on the fiche.
- Défraiement → `trainTickets` + `trainDone`, `planeTickets` + `planeDone`, `carTrips: CarTrip[]`
  (`fromAddress`/`fromVenue`, `toAddress`/`toVenue`, `fuel`, `consumptionPer100`, `tolls`).
  `*Venue` true means « lieu de l'événement » and reads `Plan.address` at display time, never a
  copy: the address may be typed after the trip is.
- Besoins techniques → `technicalNeeds`, Taille du patch → `patchSize`, Champ libre → `notes`.
- Balances → `soundcheckNeeded`, `soundcheckStart`, `soundcheckEnd`, `soundcheckEngineer`.
  **HOURS FROM THE EVENT'S START, AND NEGATIVE WHEN THE DAY BEFORE.** The one window in the
  tool allowed before hour zero. Typed on the fiche as a `<input type="date">` plus a
  `TimeOfDayField` (`hoursAtLocal` / `localDateOf` in `clock.ts`); the end is a clock on the same
  day, read as the next day when before the start. Durée is displayed, not stored.
- Pour chaque personne → `members: ArtistMember[]`: `firstName`, `lastName`, `role`
  ('musicien' | 'technicien'), `diet`, `allergies` (two fields like everybody else's, not one),
  `drinkTickets: number | null`, `payment` ('cash' | 'facture' | 'declare'), `invited`.
- Invitations supplémentaires → `extraInvitations` (a count) and `invited` (a tick) UNTIL THE BILLETTERIE THE SAME DAY: they are `Artist.extraGuests` and `ArtistMember.guests`, lists of names, see [[feature-ticketing]]. `artistInvitations()` counts the names.

`makeArtist`, `makeArtistMember`, `makeCarTrip` carry the defaults; the two literal construction
sites (`event-config.ts`, `validate.test.ts`) go through `makeArtist`.

## The five decisions

**1. A MEMBER'S TICKETS: NULL MEANS « FOLLOW THE SETTING ».** « Changer le réglage met à jour la
valeur ici même si déjà importé. » The way a setting reaches a hundred rows is not to copy it into
them. `CateringRules.artistDrinks` (new, default 2, a card field in Réglages under the orga
floors, `event.artist_drinks`) is what a member gets unless `drinkTickets` is a number; on the
fiche the field is EMPTY while following and shows the setting as its placeholder, and emptying
it goes back to following. `artistMemberDrinks(member, rules)` is the one reader.

**2. A MEMBER'S MEALS ARE `MealChoice` ROWS, KIND 'artiste'.** « À afficher de la même façon que
le choix des repas pour les orgas pendant le montage, modifiable par le régisseur. » So the same
doctrine as [[feature-catering]]: computed, only the disagreements stored. `MealPersonKind =
PersonKind | 'artiste'` is a WIDER type and not a widening of `PersonKind`, because `PersonKind`
is what the phases place and an artist is never placed on a phase. The rule for a member is
PRESENCE IN EVERY MOMENT (no quota, no tiers, no orga floor): `artistPresence(artist)` is ONE
window from the first moment (balances or changeover) to the last, split per moment by
`artistPresenceByMoment` in `catering.ts`, and a member eats every service that overlaps it.
Balances the afternoon before therefore tick the montage's soir. The boxes are drawn on the fiche
AND on the Catering screen (marked 🎤, `ARTIST_MARK`, with the act's name beside the person; the
« Droits » column reads « selon la présence du groupe »); ticking in either place is the same
`setMeal`. Deleting a member or an act deletes its choices (`deleteArtistMember`,
`removeArtist` in `artistEdits.ts`), because nothing can carry that key again. **A member's key
is unique across EVERY act** (`freeMemberKey` reads all of them) for the same reason.
`meal_choice` gained `artist_member_id` and the check became `num_nonnulls(...) = 1` over three.

**3. THE MOMENTS ARE DERIVED AND DRAWN, NEVER STORED ON A PHASE.** « Mis comme événement (sans
besoin de bénévoles) durant le montage ou l'exploit… avec des couleurs différentes. » A
`PhaseEvent` written from an act would be a frozen copy. `tools/src/artists.ts`:
`artistMoments(artist)` (set, changeover ×2, soundcheck, in event hours, a zero changeover and
unneeded balances produce nothing), `artistMomentsInExploit(lengthHours, artists)` (clipped),
`artistMomentsIn(eventStartISO, phase, artists)` (translated by `phaseOffset` into the phase's
axis and clipped). The exploit's `TimeRuler` draws every moment as an `.artist-band.is-set /
.is-changeover / .is-soundcheck` packed by `packRows` (no key: a set and its own changeover
touch and share a row), and the ruler's height is now inline, `RULER_HEAD_H (43) + rows ×
ARTIST_ROW_H (19)`; 62 px in the CSS is the one-row fallback. `PhaseGrid` has a read-only
« Artistes » lane under the événements with the same bands, drawn through `piecesOf` so the
day filter cuts them like everything else. Colours: set = `--accent`, changement de plateau =
`--plateau` (violet, hatched), balances = `--balances` (teal), both in light and dark palettes;
the three brief colours were left alone as their comment demands.

**4. THE TAB, NOT THE CARD.** `app/src/screens/ArtistsScreen.tsx`, tab « Artistes » between
Recrutement and Catering. One `.screen-card.artist-card` per act, folded to: the set
(« 13/03 22:00 à 23h30 (1h30) »), size and named count, changeover minutes, balances or « pas de
balances » (+ « avec ingé son »), patch, the défraiement line (`artistTravelLine`), invitations,
and how many bénévoles named the act. Open (`ArtistCard open`, exported for the test): five
sections, « Le groupe et son passage », « Balances », « Technique », « Défraiement » (tickets
with a fait / à faire chip, trips as sub-cards), « Les personnes du groupe » (a table with an
input per cell, the meal boxes, the tickets field, payment, invitation, ↺ and ✕). Several fiches
may be open at once. Adding is a name in the toolbar (`addArtist`, unchanged: after the last set).
Deletion arms a confirm and calls `removeArtist`. **The « Programmation » block left
`EventCard.tsx`** as the brief asked; `addArtist` / `setArtist` / `deleteArtist` stay in
`setupEdits.ts`, `setArtist` now takes any field but `members` / `carTrips`, which are edited BY
KEY in `artistEdits.ts` (`addArtistMember`, `setArtistMember`, `deleteArtistMember`,
`addCarTrip`, `setCarTrip`, `deleteCarTrip`, `removeArtist`).

**5. `NumberField` MOVED TO `components/NumberField.tsx`** and takes `number | null`: with a
`placeholder` an emptied field commits null, without one it keeps its value. `CateringCard`'s
callers pass `value ?? 0`.

## Second round, same day: « un artiste peut être bénévole OU orga également »

**The brief.** "Compter ça de la bonne façon pour ne pas ajouter plus de repas que ce qu'il en
faut, et aussi les tickets boissons peuvent ne pas être cumulatifs (à voir dans Réglages)."

**`ArtistMember.linkedKind: PersonKind | null` + `linkedKey`**, the bénévole or the orga the
member ALSO is. In the base `artist_member.volunteer_id` / `organiser_id`, at most one, ON DELETE
SET NULL (losing the person does not lose the member). Members are written AFTER the people in
`write_plan_body` because they may point at one. A link to somebody the plan no longer holds
reads as no link (`memberIsLinked`), everywhere.

**ONE PERSON, ONE ROW, ONE PLATE.** A linked member has NO row of their own in `cateringReport`
(filtered out of the acts block); the person's own row carries the act's name in `group` and
`defaultMealChoices` ticks, on top of what their own status gives, every service the act is on
the venue for (`actsOfPerson` + `actPresenceByMoment`). Those ticks SPEND the exploit quota
rather than adding to it, and the act's hours are never added to the worked hours, so the tiers
never turn a set into a créneau. On the fiche the member's meal boxes are bound to the PERSON's
kind and key (`eater` in `MembersSection`): ticking there or on the Catering tab is the same
`setMeal`. The person's own diet and allergies are what the caterer reads, not the member's copy.

**Tickets: `CateringRules.artistDrinksCumulative`** (default false, `event.artist_drinks_cumulative`,
a checkbox « Les tickets boisson se cumulent » in the Catering card). Off: THE ARTIST'S figure and the act's presence alone (« effets Artiste », since the billetterie later the same day; it was the max before). On: the sum, and the union of the meals on the same row. The fiche shows « → N au total » beside the member's field.

**Linking copies the name, diet and allergies ONCE into empty fields** (`linkArtistMember` in
`artistEdits.ts`): they are copies, so unlinking leaves the fiche as it reads. The « Aussi »
column is a `<select>` with two optgroups, orgas then bénévoles, « personne d'autre » first.

## Where the code lives

- `tools/src/model.ts`: the types, the three factories, `MealPersonKind`,
  `CateringRules.artistDrinks` / `.artistDrinksCumulative`, `ArtistMember.linkedKind` / `.linkedKey`.
  `tools/src/artists.ts` + `artists.test.ts`: everything derived, plus `memberIsLinked`, `actsOfPerson`.
  `tools/src/catering.ts`: `CateringPerson.kind: MealPersonKind`, `.group`,
  `artistPresenceByMoment`, members appended to the report after the bénévoles, CSV role
  « Artiste (groupe) ». `tools/src/plan.ts`: PLAN_FORMAT 9.
- `app/src/persistence/normalise.ts`: `artist`, `artistMember`, `carTrip`; a member or trip with
  no key is dropped. `app/src/store/artistEdits.ts` + test. `app/src/screens/ArtistsScreen.tsx`.
  `app/src/components/TimeRuler.tsx` (`RULER_HEAD_H`, `ARTIST_ROW_H`), `PhaseGrid.tsx` (the lane),
  `PersonMark.tsx` (🎤), `CateringScreen.tsx`, `CateringCard.tsx`, `EventCard.tsx` (block gone),
  `clock.ts` (`localDateOf`, `hoursAtLocal`), `App.tsx` (the tab).
- `db/schema.sql`: 15 columns on `artist`, `artist_member`, `artist_car_trip`, `event.artist_drinks`,
  `meal_choice.artist_member_id`; both functions. `db/checks/roundtrip_counts.sql` counts the two
  new tables. `db/migrations/2026-09-13_artists_as_files.sql`, idempotent, min_plan_format 9.

## Not done, on purpose

- No cost computed for a car trip (distance is not asked, so consumption × distance cannot be).
  The fields are recorded for whoever does the défraiement.
- No import of acts from anywhere; « en partant de 0 » is what was asked.
- Nothing about an act on the volunteer view, the night view or the print page beyond what was
  already there (the set's name and hours).
- The fixtures were regenerated on 2026-09-13 (`npm run fixture -- --all`, eleven files now,
  `balanced+phases` included) so they carry full acts; `artistEdits.test.ts` tests the old
  four-field shape from a literal.
- `ToDo.txt` left as the régisseur wrote it.
