---
name: feature-skills
description: 2026-09-15, les compétences (roadmap item 3): Plan.skills tags, held by bénévoles and orgas, required by exploit and phase poles; criterion missingSkill (BWO, weight 4000/h), code competence-manquante on both grids; import from free text and a yes/no question. PLAN_FORMAT 19, migration 27.
metadata:
  type: project
---

# Compétences (2026-09-15)

**State: BUILT, green (347 engine, 421 app tests, sql-check 1086, schema-check 251), shots 100-101
read. PLAN_FORMAT 19. MIGRATION 27 (`2026-09-15_skills.sql`) WRITTEN AND NOT APPLIED, after 26,
ships with its deploy.** Part of [[project-field-test-roadmap]].

## Decisions

1. **The vocabulary is the event's**: `Plan.skills: SkillTag[]` ({key, label}), Réglages card
   « Compétences » (`SkillsCard`). Keys are stable, labels renamable. Removing a tag strips it
   from every person and every pole in the same edit (`removeSkill`): an invisible requirement
   would keep boxes red with nothing to tick.
2. **Held**: `Volunteer.skills` (an answer, in `EDITABLE_FIELDS`, backed by `skillsNote`, the raw
   form text) and `Organiser.skills` (set by hand only). **Required**: `Pole.requiredSkills`
   (sub-poles inherit, `PlanIndex.requiredSkillsOf` / `missingSkillsOf`) and
   `PhasePole.requiredSkills`.
3. **Exploit**: criterion `missingSkill`, block / weight / off, default WEIGHT 4000 an hour, above
   `staffing` (3000): a short créneau is preferred to an unqualified one; blocking is one click
   for an event where a CACES is a legal matter. `LegalityContext` gained `missingSkillsOf` and
   `skillLabel`; code `competence-manquante` (TIER1 name, tier follows the mode, like pole-refuse).
4. **Phases**: `phaseIssues(phase, organisers, volunteers, skills)` raises
   `competence-manquante` on the box, never refuses (phases are placed by hand). The fourth
   argument is optional; without it nothing is checked, so every caller passes `plan.skills`.
5. **Import**: `skills` (free text, matcher competences / permis / caces / ton métier) is read
   by WHOLE normalised label (« Permis B » yes, « permis poids lourd » no), never a doubt since the
   sentence stays on the fiche; `skillCheck` (« as-tu des compétences en bricolage ? », matched
   first) gives the tag its header names when the answer starts with « oui ». `ImportOptions.skills`.
6. UI: `SkillPicker` (chips with checkboxes) on the bénévole fiche (with the raw answer), the orga
   fiche, a pole's defaults in Réglages and each phase pole row.
