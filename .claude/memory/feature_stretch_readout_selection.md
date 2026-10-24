---
name: feature-stretch-readout-selection
description: "2026-10-24, built, green, front only; the role selection seen in headless Chrome (round 2). A readout « 14h → 16h30 · 2h30 » while a créneau, a responsable's band, an événement or a phase box is pulled; a visible picked state on créneau / événement / band; a responsable's window is selectable (Selection kind 'role')."
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

**Round 2, same day: the window selectable like a box.** The régisseur reported it as not
selectable at all. Cause: `.grid-scroll`'s onClick clears the selection on any click outside
`.box, button, [role="button"]`, and the band was none of these, so the click ending the press
selected and cleared at once (the static tests could not see it). The band now has
`role="button"`. `RoleBody` is now `OrgaBody` with `pickedRoleKey`: the full fiche, the window lit
as `.panel-picked-row` in « Responsable de » (with its length and the Suppr hint), the other poles
there clickable to select their window. Suppr / Retour on a `role` selection calls
`GridScreen.deleteRole` (removeLeaderRole, selection moves to the orga fiche, key note
« Ctrl+Z annule »); `pickRole` drops the arrow cursor so Suppr cannot hit a bénévole box. The
selected Staff / Responsable (orga or role selection) rings their créneau boxes (`ShiftBlock`
`selectedOrganiserKey`) and other bands (`OrganiserBand` `kinOrganiserKey`, `.is-kin`). Seen in
headless Chrome: `npm run shots -- responsable`.

**Round 3, same day: Staff boxes too.** `Selection` `orga` carries an optional `shiftKey` when
the box itself was clicked (`ShiftBlock.onSelectOrga(orgaKey, shiftKey)`, `GridScreen.pickOrgaBox`,
which drops the cursor). That box is `.is-picked` (filled), the person's others `.is-kin`;
the fiche lights the créneau in « Sur l'exploit », which now has a « Retirer » per line. Suppr
calls `deleteOrgaBox` (= `takeOrgaOut`, the place stays empty), selection back to the plain
fiche. From the list or the search box no `shiftKey`, nothing lit. `npm run shots -- staff`.
