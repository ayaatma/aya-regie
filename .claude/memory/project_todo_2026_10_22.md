---
name: project-todo-2026-10-22
description: The developer's ToDo.txt of 2026-10-22, all built and pushed by 2026-10-23; MIGRATION 38 WRITTEN, NOT APPLIED, PLAN_FORMAT 29; apply it, then deploy the front.
metadata:
  type: project
---

The developer asked (2026-10-22) to do everything in `ToDo.txt`, framing each item with questions
first and keeping the tool generic. Numbers are those of the framing questions.

**State 2026-10-23: EVERY ITEM BUILT AND PUSHED. MIGRATION 38 (`2026-10-23_todo_batch.sql`,
sequence 38, after 37) WRITTEN, NOT APPLIED; min_plan_format and PLAN_FORMAT 29. Order: apply the
migration, then deploy the front (the developer deploys everything at the end, answer 17).**
sql-check and schema-check clean, 419 engine and 467 app tests, vite build OK. The fingerprint
SQL was run read-only on the balanced test event: identical to the TS one on 120/120 bénévoles.

**Built:**
- Overflow count removed from a preferable tranche's row; événements at the same hours stack on
  the phase grid; a half-day picker on creation and a day picker per événement in Réglages;
  « Billet d'entrée » everywhere (door CSV too); Import and Export split.
- 10 phase pole colours (`phasePoleColours`): hand pick, else the exploit pole of the same name,
  else the palette.
- 11 `Plan.phaseOptions.eventHours`, shared by both phases.
- 12 démontage copy of a montage événement (`phaseOptions.mirrorEvents` on by default,
  `mirrorWords` editable, Chargement -> Déchargement); `PhaseEvent.mirrorOf` lets a rename of the
  montage one follow while the copy keeps its generated name.
- 16 Réglages in three tabs: Réglages, « Pôles et créneaux », « Montage / Démontage »
  (`SetupScreen part`, `PhasesSharedCard`).
- 13 `CateringRules.organiserDrinksFixed`, responsables included.
- 14 `TicketingSettings.guestTypes` (drinks and meals copied to a new guest); an extra person's
  `status` is a guest type key; Invité d'artiste stays with the acts.
- 15 bracelets cumulative (`braceletKeys`), `TicketType.bracelet`, one « Bracelets » CSV column.
- 8 a window before every send (`SendDialog` for one person, `ConfirmDialog` for a test).
- 7 `Plan.mailTemplates` is `MailSet` {validation, annulation}, lists of `AudienceMail`, a kind
  on one mail at most (`withAudience`), absent list = defaults; old per-kind texts carried over
  by normalise. Steps: `StepMail.audiences` (absent = bénévoles) and `variants`; default
  « Planning » and « Infos » of a NEW event go to orgas too (existing events: tick them).
  `stepPersons`, `stepTextFor`; only bénévoles answer by link.
- 6 cancelling from a fiche sends the cancellation mail (ticked); `resubmittedCancelled` offers
  « Réintégrer ? » in the import review, unticked.
- 9 `planningFingerprint` (TS) = `private.planning_fingerprint` (SQL): a confirmation holds while
  the planning keeps its fingerprint, else state `perime` « confirmé, puis modifié », reminded by
  the relance batch; « Il y a un souci » on the personal page (answer `souci`, `comment`), an
  alert on the fiche.

**Known limits:** an orga's `{lien}` still opens the whole planning (`?responsable`), not a
personal page; orgas cannot confirm by link. A créneau hour that is not a multiple of 0.01 h
would round differently in numeric(6,2) and break a fingerprint (the grids snap to 0.25 h).
