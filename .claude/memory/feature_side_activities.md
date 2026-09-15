---
name: feature-side-activities
description: 2026-09-15, side activities without a grid (roadmap item 8): Plan.sideActivities, sideActivityKeys on bénévoles and orgas, read from any unbound column naming the activity; Réglages list with CSV export. Also fixed the montage matcher taking « pré-montage ». PLAN_FORMAT 23, migration 31.
metadata:
  type: project
---

# Activités annexes (2026-09-15)

**State: BUILT, green (353 engine, 425 app tests, sql-check 1323, schema-check 264), shot 103 read.
PLAN_FORMAT 23. MIGRATION 31 (`2026-09-15_side_activities.sql`) WRITTEN AND NOT APPLIED, after 30,
ships with its deploy.** Part of [[project-field-test-roadmap]].

## Decisions

1. **No grid** (the régisseur's decision): `Plan.sideActivities` ({key, label, when: free text});
   `Volunteer.sideActivityKeys` (an answer, `EDITABLE_FIELDS`) and `Organiser.sideActivityKeys`
   (by hand). Removing an activity unticks everybody.
2. **Import reads N questions, not one field**: `sideActivityColumns` takes, for each activity, the
   first column NO field of the correspondence took whose normalised header holds the label (or
   every 4+ letter word of it); a « oui » (`yesNo`) ticks it. `ImportOptions.sideActivities`.
3. **Bug fixed on the way**: the `montage` matcher bound « ... nous aider sur le pré-montage
   aussi ? ». It now excludes « pre montage »; on the festival form a pré-montage question placed
   before the montage one would have been read as the montage presence.
4. UI: `SideActivitiesCard` in Réglages (label, when, count, names with phone and mail on hover,
   « Exporter » CSV: nom, prénom, statut, téléphone, e-mail; cancelled bénévoles left out), ticks on
   both fiches through `SkillPicker`.
