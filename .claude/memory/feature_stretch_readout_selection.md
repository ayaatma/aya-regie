---
name: feature-stretch-readout-selection
description: "2026-10-24, built, green, front only, NOT SEEN IN A BROWSER. A readout « 14h → 16h30 · 2h30 » while a créneau, a responsable's band, an événement or a phase box is pulled; a visible picked state on créneau / événement / band; a responsable's window is selectable (Selection kind 'role')."
metadata:
  type: project
---

Asked by the régisseur on 2026-10-24.

- **Readout**: `DragReadout` (`components/DragReadout.tsx`), a sibling of the block pulled (every
  block clips its overflow), laid on its top-left corner (above the first lane sits the sticky
  head). Wired on the exploit's `retime` (edge pull and slide in mode édition), `BandItem.shown`,
  the phase `eventRetime` and the phase box `resize`. Text from `toClock` + `fmtHours`.
- **Picked**: `.shift.is-picked` had a class and no rule, so selecting an empty créneau showed
  nothing. Now a 3 px accent outline (outside, not clipped) + shadow on `.shift`,
  `.phase-event-block`, `.organiser-band-item`.
- **Role selection**: `{ kind: 'role'; roleKey }`. A click on a band selects the window, no
  longer the person; `RoleBody` in `InfoPanel` says pole, hours, length, « Voir la fiche »,
  « Retirer cet horaire ». `OrganiserBand.onSelect(roleKey)`, `pickedRoleKey`.

Related: [[project-todo-2026-10-23]] (Staff never holds a pole since the same day).
