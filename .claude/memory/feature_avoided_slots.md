---
name: feature-avoided-slots
description: 2026-09-15, « préférer éviter » a tranche (roadmap item 4): Volunteer.avoidedSlotIds on the refusable tranches, criterion avoidedSlot (weight 1000/h), issue tranche-evitee, the slotComfort form field. PLAN_FORMAT 17, migration 25.
metadata:
  type: project
---

# Tranches à éviter (2026-09-15)

**State: BUILT, green (337 engine, 419 app tests, sql-check 968, schema-check 244), shot 87 read.
PLAN_FORMAT 17. MIGRATION 25 (`2026-09-15_avoided_slots.sql`) WRITTEN AND NOT APPLIED, apply after
24, ships with its deploy.** Part of [[project-field-test-roadmap]].

## Decisions

1. **Avoided tranches are the REFUSABLE tranches (`Plan.slots`)**, not the preference slots: the
   night is one tranche, refused by some and avoided by others, and one form question answers
   both. `Volunteer.avoidedSlotIds?: SlotId[]`, in `EDITABLE_FIELDS`. Refused wins over avoided
   (import drops the overlap; the edit form disables the box).
2. **Criterion `avoidedSlot`**, modes weight/off only (blocking would be a refusal the person did
   not give), default 1000 per hour: under `preference` (1500), well under `staffing` (3000), so
   an avoided hour is taken whenever it fills a place. Solver: `Placement.avoidedHours`,
   `SolverWeights.avoided`. Validate: tier 2 `tranche-evitee` once per person per tranche, and a
   cost line in `costsFor` under a drop. Not measured with a probe like the preference weight was.
3. **Import field `slotComfort`** (« Tranche refusée ou à éviter (une question) »), matcher on
   « shifts / créneaux / postes de nuit ». `parseSlotComfort(header, answer, slots)`: the tranche
   from its label (whole or a word of 4+ letters) in the header or the answer, the verdict from the
   answer (avoidance tested before refusal, since « je préfère ne pas » also says « pas »);
   unreadable = fiche to review. Answer map kind `slotComfort` = `{refused, avoided}`, editable in
   the correspondence card. One field binds one column: a form with two such questions needs the
   second read by hand (known limit).
