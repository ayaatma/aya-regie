---
name: feature-people-tab
description: "2026-09-15, the Billetterie tab became « Personnes »: the central list of everybody, three column sets, a fiche pane per kind of person where everything is editable, reachable from the grids; V2 converts a bénévole into an orga and back as a validated proposal."
metadata:
  type: project
---

**State 2026-09-15: V1 AND V2 BUILT, green (326 engine, 412 app tests, both typechecks, build,
`sql-check` 791, `schema-check` 235), checked in headless Chrome, committed. V1 had no schema.
V2: PLAN_FORMAT 14, MIGRATION 22 (`2026-09-15_entered_by_hand.sql`) WRITTEN AND NOT APPLIED; it
must ship with its deploy (min_plan_format 14).**

## The brief

The régisseur: the Billetterie tab is the only place showing every person (bénévoles, orgas,
artistes, guests, extras); make it the central place to see and edit everything about a person,
including switching bénévole / orga and editing hours and names, without cluttering the list.
Rename it.

## Decisions (V1)

1. **Name « Personnes »**, tab id `personnes`, placed right after Tableau de bord. The door's
   list survives whole as the « Accueil » column set; « Contact » and « Repas » are the two others.
   The CSV button is « Exporter la liste d'entrée » (same `ticketingCsv`).
2. **A pane, not a popup** (`.screen.has-person`, `PersonPanel`): the list stays visible, arrow
   keys walk the filtered rows, Escape closes, nothing fires while a field has focus. The open
   person is held in `App` (`personFocus`), so it survives a trip to another tab.
3. **No fiche written twice.** A bénévole's fiche is `VolunteerFiche` (its draft/Enregistrer edit
   mode kept on purpose: corrections set `manualFields`), an orga's is `OrganiserFiche`. New small
   fiches only for the kinds that had none: artist member, guest, extra (the extra's name is now
   typed in the fiche only; a new extra opens its fiche via `nextExtraKey`).
4. **The door's four fields are `DoorFields.tsx`**, used by the row and the fiche; the fiche's
   copies are prefixed `fiche-` in their `name`.
5. **`TicketingRow` carries `email`, `diet`, `allergies`**, copied field by field: a whole
   Organiser is handed to the row builder and spreading it would leak the access code into the CSV.
6. **Navigation is a context** (`personNav.ts`, `NavigationContext`): the grids' info pane shows
   « Ouvrir dans Personnes » only inside the shell and never read-only.
7. `VolunteerEdit` gained Prénom and Nom (already in `EDITABLE_FIELDS`; the key stays the import
   identity). `.fiche-edit .field-label` is `flex: 0 0 auto`: labels broke mid-word in both panes.

`npm run shots personnes` captures 85 to 92.

## The reserve, listed apart (2026-09-15, no schema)

Asked the same day: reserve people are normally not on site, so they left the grids' pool pane
and sit in a « Réserve (n) » card under the main list (`.people-reserve`, `PeopleTable` drawn
twice). Split in the screen only (`plan.reserve`, bénévoles); search and statut filter apply to
both, the arrow keys walk the main list then the reserve, the toolbar counts « N personnes + n en
réserve ». **`ticketingCsv` (the door's export) still includes them**: an open question put to the
régisseur, not decided. Shot `95-personnes-reserve`.

## V2: conversion bénévole ↔ orga

`tools/src/convert.ts`, `convertPerson(plan, kind, key)`: pure, returns `{toKind, newKey, carried,
lost, blocked, plan}`. The fiche's « Statut » section (`StatusSection` in `PersonPanel`) shows the
two lists, then applies `plan` as ONE edit (one Ctrl+Z) and moves the focus to the new key.

- **Carried**: exploit places (assignment → `OrganiserShift`; back as a LOCKED manual assignment),
  phase boxes, catering and ticketing choices, act member links, all rekeyed (`rekey`).
- **Dropped and listed**: binômes and reserve (bénévole side), leader roles and the orga note
  (orga side), the old access code both ways (orga gets '' and a code from Réglages; a new
  bénévole gets a fresh 8-char code). A bénévole's form answers go into the orga's note as text.
  The catering figures before/after are computed with `cateringReport` and listed when they differ
  (an orga with a floor can drop to 0 meals as a bénévole with no hours).
- **Keys**: orga `resp-<slug>`; bénévole = `volunteerIdentity` (with `#n`), so a later form row
  matches them. **Blocked** when the other list already holds the same identity.
- **New bénévole**: `needsReview` with a reason (volume is a placeholder: smallest option covering
  the hours held), and `enteredByHand: true`.
- **Imports**: `reconcileVolunteers` puts a new row whose identity is an orga in `alreadyOrga` (not
  added, listed on the import screen, counted in the summary); `keptByDefault` makes absent
  `enteredByHand` people ticked to KEEP (ImportScreen stores `flipped`, not `kept`);
  `importOrganisers({volunteers})` skips a row naming a bénévole with warning `deja-benevole`.
- Migration 22 was generated from `db/schema.sql`'s two functions after checking they were
  byte-identical to migration 21's (scratch script, not kept).
