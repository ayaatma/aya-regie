---
name: feature-orga-two-places
description: "2026-10-24, built, green, front only, seen in headless shots. A Staff / Responsable in two places at once (two overlapping créneaux, or a créneau on another pole during a responsable window) is greyed during the drag, refused in the bottom banner, and red on box, band and panel, like a bénévole's chevauchement."
metadata:
  type: project
---

Reported by the régisseur on 2026-10-24: a responsable window on one pole and a Staff créneau
on another at the same hour, and two overlapping Staff créneaux, were both accepted silently.

**Rule (engine, `PlanIndex`).** `organiserConflicts()` replaced the unused `organiserClashes()`:
créneau vs créneau, and créneau vs a `LeaderRole` window on a pole the créneau is NOT under.
Not a conflict: a créneau on the pole run or below it (`supportOnlyBreaches` covers that), a role
with unset hours (unknown, not "all event"), two roles on two poles at once (allowed on purpose,
see `LeaderRole` comment). `organiserBlockersFor(orga, shift, fromShiftKey)` is the drag question;
`organiserConflictNotes()` files sentences by `orgaKey|shiftKey` and by role key;
`describeConflict` / `describeClash` write the French.

**UI.** Same as bénévoles: no edit is refused (edits.ts rule), the drag greys the créneaux and
`DragReason` says « Placement interdit. » with the reason; afterwards the orga box is
`.is-illegal`, the band `.organiser-band-item.is-illegal`, and InfoPanel (orga fiche, role,
créneau) shows a « chevauchement » signalement. Same day, round 2: `validate()` adds tier 1 `orga-chevauchement` (créneaux named, no volunteer) so the Suivi « affectations illégales » and the Grille badge count them; the créneau panel shows it through `detail.issues`. `roleBlockersFor` warns BEFORE letting go: the bottom « Placement interdit » banner over a pole frise, and a red `DragReadout` (`warning`) while a band is pulled (`OrganiserBand.checkWindow`). Fixture `balanced+phases` has one conflict; `npm run shots -- conflit`.
