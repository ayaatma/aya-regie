---
name: feature-grid-edit-mode
description: "2026-09-16/17, built, green, no schema: the « mode édition » of the three grids (🖍️ / 👀 in the corner), stretching créneaux with a glued neighbour, « + » for a place, a click in the void creating a créneau; on the phases it acts on the événements."
metadata:
  type: project
---

**Built 2026-09-17, green (440 app tests), checked in headless Chrome, no schema, no plan format.**

The régisseur asked for a mode where the grid edits the créneaux themselves rather than who is
in them.

- **The switch**: `EditModeButton` (components/EditModeButton.tsx) in the `.grid-corner` of both
  `GridScreen` and `PhaseGrid`, a framed `.btn-emoji.is-framed`, 🖍️ to enter and 👀 to leave.
  Hidden under `readOnly`. The mode is LOCAL STATE of each grid: changing tab or moment unmounts
  the grid, which is what leaves the mode (PhaseGrid is keyed on the phase). Échap leaves it
  before it clears a selection.
- **Visible**: `.grid-scroll.is-editing` = a 3 px `--ok` BORDER (not an outline: an outline is
  painted under the sticky heads and labels) plus a green tint; the border is transparent
  outside the mode so nothing jumps. The toolbar note says what the mode does.
- **No drag and drop in the mode**: boxes not draggable, `PoolPanel`, `PoleTrack` and `Bars`
  get `readOnly || editing`, événement drops refused.
- **Stretching**: grips `.shift-grip` on each créneau. `edgeLimits` decides: a neighbour that
  TOUCHES is glued and follows the edge both ways, each keeping `MIN_WINDOW_HOURS` (15 min); a
  neighbour with a gap is a wall. Snap 15 min. Pointer followed on the window (same reason as
  `Bars`), the last window carried in a local, both créneaux written in ONE edit
  (`setShiftWindow` twice). People stay on a retimed créneau and turn red if they must.
- **« + »**: a `.box.is-add` row under every créneau, `setHeadcount(+1)`; lane height grows a row.
  No « − » (not asked); Ctrl+Z undoes.
- **Creating**: hovering the empty part of a lane shows `.shift-ghost`; `ghostWindow` starts it
  on the whole hour under the pointer, never before the previous créneau's end, for the pole's
  `defaultShiftHours` (per pole in Réglages, 2 h by default; the régisseur thought it was under
  Événement), cut by the next créneau and the end of the event. Click = `addShift`.
- **Phases have no créneaux**: there the mode acts on the ÉVÉNEMENTS (same three gestures, clamped
  to the day like `Bars`; « + » on a headcount of 0 becomes taken + 1). The événements lane shows
  even when empty in the mode; a created one is « Nouvel événement », 2 h, one place, opened in
  the info pane, which now has a Nom field for an événement. Pole lanes create nothing.
- Tests: `components/editMode.test.ts` (limits, glue, ghost), `screens.test.tsx` (button in both
  corners, grips and « + » on a ShiftBlock, nothing draggable). `npm run shots -- edition` walks
  the whole thing and prints each check.

## 2026-09-17, second round: « − », and the event's default length

**MIGRATION 33 WRITTEN AND NOT APPLIED** (`2026-09-17_event_default_shift_hours.sql`, after 32,
`min_plan_format` 25, `PLAN_FORMAT` 25). Migration first, then deploy.

- **« − » beside « + »** (`.edit-place-row`, both on one box height). One place fewer, the last
  drawn. AN EMPTY PLACE GOES FIRST: when the créneau still has a hole, only the headcount drops;
  when every place is taken, the last person drawn (a bénévole, else the last orga) is taken off
  WITH the place, in one edit, and the toolbar says who (« X retiré·e du créneau avec sa place.
  Ctrl+Z annule. »), the edit mode's note giving way to it. A locked place refuses, like Suppr.
  Same on an événement, where the person goes back to their declared presence as the pane's
  « Retirer » does. The régisseur asked « même si occupée »; the hole-first rule was my reading,
  stated to them.
- **`Plan.defaultShiftHours`**, the event's default length of a créneau, field in Réglages >
  L'événement. **`Pole.defaultShiftHours` now means « set by hand »**: absent follows the event.
  `defaultShiftHours(plan, pole)` resolves, `shiftHoursByHand(pole)` says which,
  `setPoleShiftHours(plan, key, hours | null)` REMOVES the key when given null or the event's own
  value, `setEventShiftHours` moves every following pole and no existing créneau. The pole field
  is green (`.rule-input input.is-manual`) with « Revenir à l'événement » when set by hand. A new
  sub-pole copies its parent's length only if the parent was set by hand. The migration nulls
  every pole holding exactly the event's value (2), so only poles at another length stay green.
  The phase grid's new événements take the event's value.
