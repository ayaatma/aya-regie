---
name: feature-staff-places
description: "2026-10-24, built, green, MIGRATION 40 WRITTEN AND NOT APPLIED, PLAN_FORMAT 31. A créneau has bénévole places AND Staff places; the Suivi counts the bénévoles apart, lists the Staff posts to find and the hours a pole runs without a Responsable."
metadata:
  type: project
---

**The problem (régisseur, 2026-10-24).** A « Régie générale » pole with créneaux the length of
the event, for Staff not yet in the tool, showed as eighteen hours of bénévole gap in the Suivi.
Two real shapes on this event: a Responsable of a pole with bénévoles, or a créneau held by Staff
only (techs doing long hours).

**Decisions (validated by the régisseur: 4a, 4b, 4c).**
- Per-créneau figures with a pole default: `Shift.staffHeadcount` (absent = 0) beside
  `headcount`, `Pole.defaultStaffHeadcount` copied at creation like `defaultHeadcount`. A pole
  may be mixed (2 techs + 1 bénévole runner). `headcount` may now be 0; DB keeps
  `headcount + staff_headcount > 0` (`shift_needs_somebody`), the store clamps the same way.
- Any orga (Staff or Responsable) on the créneau fills the Staff places first; one beyond them
  still takes a bénévole place, as before (4b: Staff will hold bénévole créneaux). One rule,
  `seatsOf` in `model.ts`; `PlanIndex.headcountOf` = `benevoleSeats`.
- Responsables: no new data. `PlanSummary.leaderGaps` is computed: span of a pole's bénévole
  créneaux minus the `LeaderRole` windows on that pole or an ancestor (null hours = all).
- Bug fixed in the same chantier (4c): `gapHours` was `demand - assignedHours`, so a bénévole
  place held by a Staff counted as a gap. Now the sum of `missing × length`; `filledHours` added;
  `shiftsEmpty` no longer counts a créneau held by orgas; `proposals.ts` slack reads
  `headcountOf`. `creneauTropLong` skips créneaux with no bénévole place.

**UI.** Grid: hatched « Staff à trouver » boxes under the Staff, click offers the Staff in the
info pane; mode édition has a second row (« + » / « − » on hatching) for Staff places; lane label
says « n Staff à trouver ». Réglages: « Staff par défaut » on the pole, « Staff » column per
créneau. Suivi: « Couverture bénévoles », « Postes Staff: x sur y » (posts, not hours),
« Responsables manquants ». The `balanced+phases` fixture has a Régie générale (2 Staff places,
1 held) and `npm run shots -- staff` shoots it.

**Pending:** apply migration 40 (min_plan_format 31), then deploy the front. Not yet seen
against the live base.
