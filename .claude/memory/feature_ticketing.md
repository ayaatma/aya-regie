---
name: feature-ticketing
description: "2026-09-13, la billetterie: one derived list of everybody who gets in without a ticket (bénévoles, orgas, artistes, their named guests, prestataires, other invitations) with drink and meal tickets from the catering, a ticket type and a bracelet with defaults from Réglages, search, status filter, CSV with or without phones. Invitations became names. MIGRATION 18 WRITTEN AND NOT APPLIED, PLAN_FORMAT 10. Checked in headless Chrome."
metadata:
  type: project
---

**State 2026-09-13: BUILT and green. 293 engine tests, 397 app tests, both typechecks, build,
`sql-check` (557 statements), `schema-check` (220 fields).** Checked in headless Chrome on the
`balanced+phases` fixture (which now carries ticket types, bracelets, two extras and one ticket
chosen by hand), both schemes: the list, the search, the incohérence row, the Réglages card, the
guests on the fiche.

**MIGRATION 18 IS APPLIED (the developer ran it); MIGRATION 19 IS WRITTEN AND NOT APPLIED, PLAN_FORMAT 11, see the round below.** Originally: **MIGRATION 18 WAS WRITTEN**, `db/migrations/2026-09-13_ticketing_and_named_guests.sql`.
`npm run migrate` (dry) lists it as the one pending migration and 7 missing objects.
**PLAN_FORMAT is 10.** It ships with its deploy or a régisseur's tab writes every act back without
its guests and the plan with no billetterie. The developer runs `npm run migrate -- --apply` and
`npm run deploy` themselves. Migration 17 is applied and deployed.

## The brief, and what each line became

The people at the entrance need one list of everybody who gets in without a ticket, with the
tickets to hand them, the kind of entry and the bracelet; searchable, filterable by status,
exportable with or without phones. Ticket types (a name and a stretch of the event) and
bracelets (a name and the statuses it goes to by default) are Réglages'. Invitations of an act
must be names, not a checkbox. A person who is artist AND orga/bénévole gets the artist's
effects unless the tickets are cumulative.

## The decisions

**1. THE LIST IS DERIVED, EVERY TIME.** `ticketingReport(plan, index)` in `tools/src/ticketing.ts`
walks the orgas, the bénévoles, the acts' members (skipping the linked ones, who are on the
person's row with `Artiste: X` among their statuses), every guest (`Invité de X`), and
`Plan.ticketing.extras`. Sorted by `lastName` then `firstName`, `localeCompare('fr')`.
**The tickets are the catering's figures** (`cateringReport` rows: `drinks`, `serviceKeys.length`),
so the door's number is the caterer's number; extras carry `drinkTickets` / `mealTickets` typed
by hand; guests get nothing unless the régisseur types it (they are not extras; if they need
tickets, the régisseur adds them as an extra person instead). Statuses: `PersonStatus` =
benevole | orga | responsable (an orga with a `leaderRole`) | artiste | invite-artiste |
prestataire | autre, labels in `PERSON_STATUS_LABEL`.

**2. DEFAULTS, AND ONLY THE DISAGREEMENTS STORED.** `defaultTicketType` = the type opening the
most of the event (first typed on a tie); `defaultBracelet` = the first bracelet naming the
person's highest status in `STATUS_PRIORITY` (artiste > responsable > orga > benevole >
invite-artiste > prestataire > autre): "on lui attribue par défaut les effets Artiste".
`TicketingChoice {personKind, personKey, ticketTypeKey|null, braceletKey|null}` holds one
person's pick; `setTicketingChoice` writes null where the pick equals the default and drops the
row when both are null. `TicketPersonKind = MealPersonKind | 'invite' | 'extra'`.
**One status, one bracelet** (`setBraceletDefault` unticks it elsewhere), so the list's order
never decides.

**3. « EFFETS ARTISTE » REACHED THE CATERING.** Until today a linked person got `max(own,
artist)` drinks and the union of both statuses' meals. Now, non-cumulative (default): the
artist's drink figure and the act's presence alone (no orga floor, no tiers); cumulative: sum
and union on the same row. `defaultMealChoices` / `personRow` in `catering.ts`, tests in
`artists.test.ts` (`planWithCamille(cumulative, soundcheck)`).

**4. INVITATIONS ARE NAMES.** `ArtistMember.guests: Guest[]` and `Artist.extraGuests: Guest[]`
replace `invited` and `extraInvitations`; `Guest {key, firstName, lastName}`, keys unique across
every act (`freeGuestKey`). `TicketingSettings.guestsPerArtist` (Réglages) is a ceiling the
billetterie REPORTS (`N invités pour M prévu par artiste`) and the fiche shows (« 2 sur 1 · au-delà
du réglage »), never a refusal. Migration 18 converts a stored `extra_invitations` count into
that many guests named « Invité n » and drops both columns.

**5. INCOHÉRENCE = a meal of the EXPLOIT served entirely outside the ticket's window** (a montage
lunch is not the event). Reported on the row (`issues`), counted in the toolbar, never refused.

**6. THE EXTRAS LIVE ON THE BILLETTERIE TAB**, typed in place on their row (name, status,
phone, note, the two figures), because it is the only place they exist. `Plan.ticketing.extras`.

## Where the code lives

- `tools/src/model.ts`: `PersonStatus`, `PERSON_STATUS_LABEL`, `TicketType`, `BraceletType`,
  `ExtraPerson`, `TicketPersonKind`, `TicketingChoice`, `TicketingSettings`, `DEFAULT_TICKETING`,
  `Guest`. `tools/src/ticketing.ts` + test. `tools/src/artists.ts`: `artistGuests`,
  `artistInvitations` (a count of names). `plan.ts`: `Plan.ticketing`, PLAN_FORMAT 10.
- `app/src/store/ticketingEdits.ts` + test (types, bracelets, extras, `chooseForPerson`,
  `clearChoices`); `artistEdits.ts`: `addGuest` / `setGuest` / `deleteGuest`, and the deletes now
  clear ticketing choices too. `app/src/screens/TicketingScreen.tsx` (tab « Billetterie »,
  between Catering and Réglages), `TicketingCard.tsx` (Réglages, after Catering),
  `ArtistsScreen.tsx` (`GuestsSection`, the Invitation column gone). `normalise.ts`: `ticketing`,
  `guests`. CSS `.ticketing-*`, `.chip.is-status`, `.setup-ticket-row`, `.setup-bracelet-row`,
  `.artist-guest*` at the end of `styles.css`.
- `db/schema.sql`: `event.guests_per_artist`, `artist_guest`, `ticket_type`, `bracelet_type`,
  `bracelet_default`, `extra_person`, `ticketing_choice` (person named by kind + key text, not
  FK: five tables could hold them; a dangling one is ignored on read); both functions; a count
  check on the guests. `db/checks/roundtrip_counts.sql` counts the three new lists.

## Not done, on purpose

- No cumulative rule for bracelets: a bracelet is one wristband, so priority always decides.
- A guest never eats through the rules; the régisseur uses an extra person for that.
- No print page for the list: the CSV is the export the brief asked for.

## Round two, 2026-09-13: seven remarks, and a migration that had to be split

1. Billetterie headers « Boissons » / « Repas » instead of emojis.
2. The remark is editable on EVERY row: `TicketingChoice.note`; `ExtraPerson.note` is gone
   (migration 19 carries existing text over).
3. Drink tickets editable on every row: `TicketingChoice.drinkTickets` (null = computed). The
   computed figure is the field's placeholder (`TicketingRow.computedDrinks`), a typed one is
   green (`td.is-by-hand`); typing the computed figure back stores nothing. FIRST CUT RECOMPUTED
   THE CATERING PER ROW: the screen test took 59 s. The figure rides on the row now.
4. Catering: the drinks column and the toolbar count are gone (the billetterie owns them).
5. **The exploit quota is ALWAYS spent, nearest services first**: `REACH_HOURS` (2 h) is gone
   from `catering.ts`. A hand-changed box is outlined GREEN (`--ok`) instead of blue.
6. Costs: `Artist.trainCost` / `planeCost` (€, shown when tickets > 0), `CarTrip.distanceKm` /
   `cost` (null until computed or typed). « Calculer automatiquement »
   (`app/src/components/travel.ts`): Nominatim geocodes both ends (the venue = `Plan.address`),
   the public OSRM router gives the road km, `priceTrip` multiplies by `Plan.travel`
   (`TravelRates`: a price per fuel kind, a toll per km, card « Défraiement des trajets » in
   Réglages). Prices are the association's, never fetched. Tested on a fake fetch; NOT tried
   against the live services from this machine.
7. `Artist.contactPhone`, « Téléphone référent » on the fiche.

**THE MIGRATION ACCIDENT.** These columns were first appended to migration 18's file while the
developer had already applied 18. The migrator's post-check caught it (13 missing objects with
« déjà appliquée »). 18 was rebuilt to exactly what ran (this round's schema edits reversed,
1184 lines as originally written) and everything new is migration 19,
`db/migrations/2026-09-13_travel_costs_and_door_remarks.sql`. LESSON: before editing a
migration written earlier in a session, run `npm run migrate` (dry) to see whether it is still
pending; the developer applies migrations between turns.
