---
name: feature-kept-volunteer-fiche
description: "2026-10-24, built, green, MIGRATION 41 WRITTEN AND NOT APPLIED, PLAN_FORMAT 32. A bénévole passed Staff / Responsable keeps their whole bénévole fiche (Organiser.asVolunteer), put back on the way back; and a responsable's windows on one pole that overlap or touch merge into one."
metadata:
  type: project
---

Reported by the régisseur on 2026-10-24.

**Kept fiche.** `Organiser.asVolunteer?: Volunteer`, written by `convertPerson` bénévole → orga
(the whole `Volunteer`), read back by orga → bénévole: answers and hand corrections
(`manualFields`, `needsReview` as they were) return; the orga fiche's newer contact, diet,
skills and field data win; a phase presence keeps its windows only if present/absent still
agrees; a NEW access code all the same. Without a kept fiche, the old blank « À relire »
behaviour. The bénévole → orga way now also carries skills, emergencyContact, healthNote,
sideActivityKeys to the orga. Binômes are still dropped (plan-level pairs, not on the fiche).
DB: `organiser.as_volunteer jsonb` (migration 41 `2026-10-24_organiser_as_volunteer.sql`,
load_plan / write_plan_body replaced, min_plan_format 32). App reads it through the `volunteer`
normaliser. A person converted BEFORE this has nothing kept: a sync or retyping is needed once.

**Responsable windows.** Same person dropped twice on a frise = two identical roles drawn on
one row, so removing one left its twin: "je ne peux plus les supprimer". `packRows` now gives a
person's own overlapping windows separate rows (phase grids too); `mergeOwnWindows(plan, roleKey)`
unions overlapping or touching windows of one person on one pole, called by the frise drop
(`assignOrganiserToPoleAt`) and the band pull (GridScreen `onResizeRole`), NOT by Réglages'
fields (typed one end at a time).

**Pending:** apply migration 41, then deploy the front.
