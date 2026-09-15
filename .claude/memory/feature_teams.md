---
name: feature-teams
description: 2026-09-15, teams kept together (roadmap item 12): Plan.teamsEnabled / teams, Volunteer.teamKey, incremental solver term teamSplit (weight 400/h, weight-only), TeamReport in validate, Réglages card with composition, grid rings teammates. PLAN_FORMAT 22, migration 30.
metadata:
  type: project
---

# Équipes (2026-09-15)

**State: BUILT, green (352 engine, 424 app tests, sql-check 1264, schema-check 261), shot 102 read.
PLAN_FORMAT 22. MIGRATION 30 (`2026-09-15_teams.sql`) WRITTEN AND NOT APPLIED, after 29, ships with
its deploy.** Part of [[project-field-test-roadmap]].

## Decisions

1. **Per-event mode** `Plan.teamsEnabled` (off by default) and `Plan.teams: Team[]` ({key, name,
   poleKey: the usual pole, informative only}). `Volunteer.teamKey` is the régisseur's, not an
   answer: carried whole by `mergeWithManual`, never compared, never imported (the festival's
   team letters were assigned by the orga, not asked on the form).
2. **Never blocking**: criterion `teamSplit`, modes weight / off, default 400 an hour, priced per
   hour a member works a créneau holding NO teammate. Above a rank step (100), far under
   `staffing` (3000): a place is never left empty to keep a team together. Not measured with a
   probe (unlike buddy and preference weights); `solver.test.ts` checks two teammates end on one
   créneau over three seeds.
3. **Solver, incremental**: `SolverState.teamOf`, per-créneau counts per team, `teamAloneHours`
   updated in `mutate` (adding to a créneau with 0 teammates makes one alone, with exactly 1 frees
   that one; removal mirrors), added straight to the score, so `deltaOfAdd` and seeding stay exact.
4. **No issue codes**, on purpose: one signalement per member per split créneau would bury the
   grid. `ValidationResult.teams: TeamReport[]` (members, hours, aloneHours) feeds the card's
   « N h ensemble sur M h ».
5. UI: `TeamsCard` in Réglages (Activer, name, usual pole, member chips with remove, add from the
   unteamed), team select on the fiche's Candidature section, « Équipe » column in Personnes'
   Candidature view, and on the exploit grid `teammatesOf` rings the selected bénévole's teammates
   dashed (`.box.is-teammate`, only while the mode is on). Phases: not done.
