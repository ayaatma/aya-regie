---
name: feature-imposed-pole
description: 2026-09-15, the pole a responsable sent somebody to (roadmap item 6): Volunteer.imposedPoleKey counts as first choice, criterion imposedPole (BWO, weight 10000/h), code hors-pole-impose; import turns « envoyé par un respo » and « je suis respo » into review doubts. PLAN_FORMAT 21, migration 29.
metadata:
  type: project
---

# Pôle imposé (2026-09-15)

**State: BUILT, green (351 engine, 423 app tests, sql-check 1205, schema-check 258), shot 101 read.
PLAN_FORMAT 21. MIGRATION 29 (`2026-09-15_imposed_pole.sql`) WRITTEN AND NOT APPLIED, after 28,
ships with its deploy.** Part of [[project-field-test-roadmap]].

## Decisions

1. `Volunteer.imposedPoleKey` (a pole key, subtree included), set by the régisseur on the fiche
   (« Pôle imposé par un·e responsable »), in `EDITABLE_FIELDS`. The festival form never says
   WHICH pole, so the import never sets it.
2. **Default placement, never a lock**: `PlanIndex.rankOf` answers 0 inside the imposed pole (so
   it is their first choice and never « hors choix »), and criterion `imposedPole` (block / weight
   / off, default weight 10000 an hour) prices hours elsewhere. In weight mode a drag elsewhere is
   allowed and reported as tier 2 `hors-pole-impose`; block makes it illegal.
3. **Same form for orgas and bénévoles**: the import reads `assignedBy` (« si tu es déjà affecté à
   une équipe ») and `leadsTeam`: « envoyé·e par un respo » and « je suis respo (de X) » become a
   review reason on the fiche. The conversion to orga stays the fiche's explicit « Passer en orga »
   ([[feature-people-tab]]), never an import side effect.
