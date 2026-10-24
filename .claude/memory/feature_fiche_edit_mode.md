---
name: feature-fiche-edit-mode
description: "2026-10-24, built, green, front only, seen in headless shots (photos not: fixtures have none). Fiches (bénévole, Staff / Responsable) are read by default; the planning's 🖍️ at the top right edits each section in place. Photo large by default, its tools and the click-to-crop only in edit mode."
metadata:
  type: project
---

Asked by the régisseur on 2026-10-24.

**Mode.** `FicheEditButton` (wraps `EditModeButton`, 🖍️ / 👀) in the fiche head: `PersonPanel`
(state held by the panel, so it survives the arrow keys) and `InfoPanel` `BenevoleBody` /
`OrgaBody` (`Head` gained `action`, `.fiche-head`). « Modifier la fiche » (bottom button,
whole-form swap) is gone. `VolunteerFiche` / `OrganiserFiche` take `editing`.

**In place.** `VolunteerEdit.tsx` is split into exported sections (`IdentityEdit`,
`ContactEdit`, `RequestEdit`, `ChoicesEdit`, `RefusedSlotsEdit` (`withRanges`),
`RefusedPolesEdit`, `AvoidedSlotsEdit`, `ArtistsEdit`, `PhasesEdit`, `FieldDataEdit`,
`MealsEdit`) taking `set(field, value)`: the import's « Corriger la lecture » still passes a
draft + Enregistrer; the fiche passes `correctVolunteer` directly. Text fields are `FicheText`
(commit on blur / Enter / unmount, one journal line per field). Read mode: contact chips moved
under the photo (where the fields are in edit). Skills, activities, availability, binômes,
phases (`PhaseDaysEdit.readOnly`, `PhasePresenceRow.readOnly`), team, energy, imposed pole and
the door block (« À l'entrée », bénévole / orga only) are read-only out of edit mode.

**Always live (régisseur's list):** Valider / status, « Placer en réserve » (renamed from
« Réserve (renfort) », `Volunteer.backup`), follow-up steps, note de la régie, Passer
Staff / Responsable / bénévole; also kept: liste d'attente, Valider la fiche / Remettre à relire,
Libérer ses places, code responsable.

**Photo.** `PersonPhoto` `editing`: large whenever there is a photo; out of edit mode no buttons,
no drop, no click; in it a click crops (or opens the file dialog without a photo).
`npm run shots -- personnes` shoots 86 (read), 87 (edit), 88 / 88b (orga edit / read).
