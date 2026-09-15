---
name: feature-field-data
description: 2026-09-15, field data (roadmap item 5): emergency contact and health note on bénévoles and orgas, minor flag (birth date read, never stored), nicknameMatters; stripped from the plan an orga holding no pole reads. PLAN_FORMAT 20, migration 28.
metadata:
  type: project
---

# Données de terrain (2026-09-15)

**State: BUILT, green (349 engine, 422 app tests, sql-check 1146, schema-check 257), shot 87 read.
PLAN_FORMAT 20. MIGRATION 28 (`2026-09-15_field_data.sql`) WRITTEN AND NOT APPLIED, after 27,
ships with its deploy. The RPC filtering is NOT tested against a database (none locally): check a
non-responsable orga code after applying.** Part of [[project-field-test-roadmap]].

## Decisions

1. Fields: `Volunteer.emergencyContact`, `healthNote` (free text), `minor` (boolean | null),
   `nicknameMatters` (boolean | null); `Organiser.emergencyContact`, `healthNote`. All bénévole
   ones in `EDITABLE_FIELDS` and compared on re-import.
2. **Visibility « régie et responsables »**: every orga code used to open the whole plan (see
   [[feature-leader-access]]). `get_organiser_planning` now strips `emergencyContact` and
   `healthNote` from every volunteer and orga when the caller holds no `leader_role`. The volunteer
   schedule RPC never carried them; no CSV export carries them.
3. **Minimisation**: the birth date column is read by `isMinorAt` (under 18 on the event's first
   day) and dropped; only `minor` is stored.
4. **Nickname**: `display.ts` uses the nickname unless `nicknameMatters === false` (an explicit
   « non »); absent keeps the old behaviour.
5. Import matchers: `emergencyContact` /urgence/ (the real Loto Tekno column 10, a former decoy
   for the phone: test updated), `healthNote` (details, handicap, contrainte physique) before
   `healthCheck` (problèmes de santé / besoins spécifiques; a bare « oui » becomes « Oui, sans
   précision »), `birthDate`, `nicknameMatters`.
6. UI: fiche « Sur le terrain » block shown only when there is something (contact, health, minor
   chip), editable in the fiche's edit form; orga fiche gets two fields; Personnes « Contact »
   view gains « En cas d'urgence ».
