---
name: feature-people-tab
description: "2026-09-15, the Billetterie tab became « Personnes »: the central list of everybody, three column sets, a fiche pane per kind of person where everything is editable, reachable from the grids; V2 converts a bénévole into an orga and back as a validated proposal."
metadata:
  type: project
---

**State 2026-09-15: V1 BUILT, green, checked in headless Chrome (both schemes), committed. No
schema, no PLAN_FORMAT change.** V2 (conversion bénévole ↔ orga) in progress, see below.

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

## V2: conversion bénévole ↔ orga

See the section appended when built. Planned rules: a proposal listing every consequence, the
régisseur confirms; placements carried over (exploit assignments ↔ `organiserShifts`, phase boxes
rekeyed), meal and ticketing choices and artist links rekeyed; buddies, reserve, leader roles and
the old access code dropped and listed; an import must not recreate the person in the old list.
