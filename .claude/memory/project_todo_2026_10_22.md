---
name: project-todo-2026-10-22
description: The developer's ToDo.txt of 2026-10-22, item by item - the framing answers, what is built, what is left (the mails, migration 38).
metadata:
  type: project
---

The developer asked (2026-10-22) to do everything in `ToDo.txt`, framing each item with questions
first and keeping the tool generic. Numbers below are the ones of the framing questions.

**Done before the answers (no migration):**
- Preferable tranche row: the « N la préfèrent » count removed beside the overflow field.
- Événements at the same hours stack in lines on the phase grid (`packRows`, `EVENT_LINE_GAP`).
- Réglages > Montage/Démontage: half-day picker on creation, day picker on each événement row
  (moves it with its people, `slidePhaseEvent`).
- « Billet d'entrée » for the entry everywhere (door CSV header too); « ticket » is only for meals
  and drinks. Identifiers (`TicketType`, `ticketTypeKey`) unchanged.
- Import and Export are two tabs of the Réglages group.

**Built after the answers (all green, pushed, 2026-10-22/23):**
- 10 phase pole colours: hand pick, else the exploit pole of the same name, else the palette
  (`phasePoleColours`). The developer: « it does not matter » whether the palette is shared.
- 11 `Plan.phaseOptions.eventHours`, one value shared by both phases.
- 12 démontage copy of a montage événement (`phaseOptions.mirrorEvents`, on by default;
  `mirrorWords` editable, the developer's pairs by default, Chargement -> Déchargement); same
  time of day, same places, a name with no listed word copied as is; independent once created,
  but `PhaseEvent.mirrorOf` lets a rename of the montage one follow while the copy keeps its
  generated name (my addition: grid creation names it « Nouvel événement »).
- 16 Réglages split in three tabs: Réglages, « Pôles et créneaux », « Montage / Démontage »
  (`SetupScreen part`), with the shared card `PhasesSharedCard`.
- 13 `CateringRules.organiserDrinksFixed` (off by default), responsables included.
- 14 `TicketingSettings.guestTypes` (Partenaire, Prestataire, Autre invitation; drinks and meals
  copied to a new guest, followed on a change of type unless typed by hand; a type in use cannot
  be removed); `ExtraPerson.status` is a guest type key. Invité d'artiste stays with the acts.
- 15 bracelets cumulative (`TicketingChoice.braceletKeys`, `defaultBracelets`), `TicketType.bracelet`
  the billet's own wristband, one « Bracelets » CSV column. « Donner ordre » is not tracked.

**MIGRATION 38 NOT WRITTEN YET, nothing of 11-15 is persisted**: phaseOptions, mirrorOf,
organiserDrinksFixed, guestTypes, TicketType.bracelet, braceletKeys, free extra statuses (drop the
checks on extra_person.status and bracelet_default.status). schema-check flags them. PLAN_FORMAT
goes to 29 with it. The developer deploys everything at the end of the batch (answer 17).

**Mails: 8 (popups) BUILT; 7 validation lists per kind + 6 cancellation mail and « réintégrer ? » in the import BUILT 2026-10-23 (`mailsOf`, `withAudience`, `resubmittedCancelled`), mail_log reason « annulation » needs migration 38. LEFT: 7 step variants per kind + orgas getting planning/infos, 9 planning fingerprint + « souci » comment, migration 38, PLAN_FORMAT 29. Decisions:**
- 6 cancelled = status « Annulée » in the tool (already kept across a re-sync by
  `mergeWithManual`); a re-submitted form of a cancelled person is a « réintégrer ? » line in the
  import review; a cancellation mail per kind, checked by default in the popup.
- 7 validation mails: one mail may carry several kinds, and each kind its own mail; steps get
  variants per kind, and « planning » / « infos » also go to orgas, with their montage /
  démontage hours.
- 8 a popup with OK / Annuler before every send, naming recipients and subject.
- 9 the link shows the current planning; « Je confirme » records that exact planning and lapses if
  it changes; states confirmé à jour / confirmé puis modifié / pas confirmé; whole planning, not
  per créneau; a « Prévenir les plannings modifiés » button, never an automatic send; no
  scheduled send (Pedro presses the button on the day); a « il y a un souci » comment on the page,
  shown on the fiche.

Context: most of 9 existed ([[feature-follow-up-mails]]): step `planning` with reply
`confirmer`, link `/?code=`, batches premier / relance / modifié. What was missing is that the
answer is tied to the last MAIL, not to the planning the person saw on the page.
