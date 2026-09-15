---
name: feature-magasin
description: 2026-09-15, le Magasin (roadmap item 9): a new tab ledgering the event's equipment (owned or lent, attendu / en stock / sorti / rendu, where it is), fed by the form's « peux-tu ramener du matos ? » answer. PLAN_FORMAT 24, migration 32.
metadata:
  type: project
---

# Magasin (2026-09-15)

**State: BUILT, green (353 engine, 426 app tests, sql-check 1382, schema-check 266), shot 104 read.
PLAN_FORMAT 24. MIGRATION 32 (`2026-09-15_magasin.sql`) WRITTEN AND NOT APPLIED, after 31, ships with
its deploy.** Part of [[project-field-test-roadmap]].

## Decisions

1. **A ledger, not a plan**: `Plan.equipment: EquipmentItem[]` ({key, name, quantity, lender,
   lenderKind, lenderKey, status, holder, note}), one jsonb document on `event`. Nothing in the
   engine reads it. Statuses `attendu` (promised), `stock`, `sorti` (with `holder`: where or who),
   `rendu` (loan closed). An empty lender means the association's own.
2. **From the form**: `Volunteer.equipmentNote` (field `equipmentOffer`, matcher « ramener /
   apporter / prêter du matos / matériel »; a bare « non » is dropped). The tab lists the offers
   under the ledger; « Ajouter au magasin » (`equipmentFromOffer`) creates an `attendu` line lent by
   that bénévole with their sentence as the name; an offer already turned into a line shows
   « au magasin ». Cancelled bénévoles' offers are hidden.
3. UI: new tab « Magasin » between Catering and Réglages (`MagasinScreen`), editable table, filter
   (tout, prêts pas encore rendus, each status), « N prêts à rendre » chip, CSV export.
   `npm run shots magasin` captures 104. Orgas' offers and a link from a person's fiche to what
   they lent are not built.
