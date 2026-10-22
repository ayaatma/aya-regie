---
name: feature-follow-up-mails
description: 2026-10-22, the follow-up by mail after validation. Steps carry a mail (target, reply), grouped sendings from Personnes > Mails with a 180/h throttle, bulk validation of placed people, answers via the personal link /?code= (answer_step, step_reply). PLAN_FORMAT 27, migration 36 WRITTEN NOT APPLIED.
metadata:
  type: project
---

# Suivi par mail (2026-10-22)

**State: BUILT, green (395 engine, 447 app tests, both typechecks, vite build, sql-check 1513,
schema-check 273), shots 110-117 read in both schemes (`npm run shots suivi`). PLAN_FORMAT 27.
MIGRATION 36 (`2026-10-22_follow_up_mails.sql`, header sequence 36, after 35) WRITTEN, NOT
APPLIED, min_plan_format 27: ships with its deploy. `send-mail` changed (stepKey, planning,
reasons etape/relance): deploy it with the front.** Builds on [[feature-registration-validation]]
and [[feature-application-tracking]].

## The developer's need (Loto Tekno, generic for any event)

Pedro (responsable bénévoles) places the people he trusts, then validates everybody placed at
once, after a confirmation listing every name; each gets the validation mail. Then grouped mails:
extra-hours check (only those who asked 6 h or more, yes/no), personal planning to confirm
(planning may still change), final practical info with the final planning. The developer chose:
everything through the tool (OVH SMTP, about 200/h limit), not Brevo; answers through a personal
link (8b) plus reminders (8c); build everything at once.

## Decisions

1. **Status stays separate from communication** (data), but the screen shows a frise: the furthest
   step reached replaces « Validé·e » (`followUpOf`: stage, badges for conditional steps i.e.
   `minRequestedHours > 0` once something happened, alerts that add up).
2. **A step = `ApplicationStep.mail?: StepMail`** {subject, body, placedOnly, minRequestedHours,
   reply aucune|confirmer|oui-non, question}. No mail = box ticked by hand, as before. Defaults
   of a new event: heures-supp, planning, infos (key `infos` kept from 2026-09-15). Existing events
   are not touched: Réglages « Ajouter les étapes types » (`addDefaultSteps`) on demand.
3. **Facts outside the plan**: `mail_log` gains `step_key`, `planning` (the {planning} text sent);
   new `step_reply` (append-only, RLS select/insert authenticated). « Planning modifié » = current
   `planningText` ≠ the planning of the last sent mail. An answer to a {planning} step older than
   the last sent mail does not count (same rule in TS and in get_volunteer_schedule).
4. **Personal link** `{lien}` = origin + `/?code=CODE` for a bénévole; main.tsx opens the
   volunteer view on `?code`. Questions come in `get_volunteer_schedule.questions`; answering is
   `answer_step(code, step, answer)`, SECURITY DEFINER, anon: refuses empty code, unknown step,
   « non » to a confirmer step, a step never sent to this person, more than 50 answers.
5. **Grouped sending** runs in `mailStore.startBatch` (module state, survives tab switches, not a
   browser close): one mail, 1.5 s gap, pause when the book holds 180 sent in the last hour.
   Resumable by design: the lists are computed from the book (`batchMembers` premier / relance /
   modifie). Reminder = same mail, subject « Rappel : ». Every grouped action opens `SendDialog`
   (names, click one to preview their mail, those without address listed apart).
6. Bulk validation (`BulkValidateButton`, Mails tab and Personnes toolbar): status candidature +
   placed (`placedPending`: créneau, leader window, phase box; bénévoles and orgas), one edit, then
   a batch of validation mails. Placements untouched.
7. Campaign steps are bénévoles only. Orgas get only the validation.
8. Régie can note an answer by hand from the fiche (`recordReply`, source regie).

## Pitfall of this session

In this Bash tool, heredocs and `node -e` strings HALVE backslashes (`\\n` became a real newline
in a file). Write anything with backslashes through the Write tool, then apply it with node.

## Not done

Bounces unseen (accepted ≠ delivered). Hourly count only knows the mails in the loaded book.
Someone removed from every shift after their planning mail is flagged on the fiche but not in a
« modifié » batch (not in target any more). Mails are plain text.
