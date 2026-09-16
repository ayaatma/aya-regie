---
name: feature-setup-from-form
description: 2026-09-16, « Préparer l'événement depuis ce formulaire »: the first import proposes the event's settings (dates, montage/démontage, poles with their answers, night tranches, competences, side activities, status steps), validated item by item, applied as one edit. Plus the binding fixes found by checking a real festival export.
metadata:
  type: project
---

# Préparer l'événement depuis le formulaire (2026-09-16)

**State: BUILT, green (363 engine, 430 app tests), shot 105 read, NOT DEPLOYED (app deploy only,
no migration, no PLAN_FORMAT change).** Asked by the developer: « un premier setup serait l'import
du Google Sheet et un remplissage auto, puis le régisseur change les réglages si besoin ».

## Engine: `tools/src/setup-inference.ts`

- `inferSetup(csv, mapping?)` → `SetupProposal`. Reads, never assumes an event:
  - **dates** from the arrival / departure headers' dates (« arriver vendredi 18 Septembre »), at the
    earliest arrival hour and latest departure hour written; the year follows the first submission;
  - **montage** start = first ticked day at 08:00; **démontage** length = to the end of the last
    ticked day after the event's end (the other edges are `alignPhases`');
  - **poles** = distinct choice answers; an answer that starts another word for word merges into the
    more chosen one (« Maraude » into « Maraude (Réduction des risques) »), the name drops a trailing
    parenthesis, `suggested` false when written once (prose);
  - **slots**: a night question with « entre Xh et Yh » gives day / night tranches tiling the event,
    one « Nuit ... (Xh-Yh) » per night; `parseSlotComfort` now answers for EVERY tranche sharing the word;
  - **skills**: the yes/no competence question's subject + `KNOWN_SKILLS` written by ≥ 2 people;
  - **side activities**: unbound yes/no columns naming a pré-montage or a « week-end X »;
  - **application steps**: tags (≥ 2) of a « Statut » column LEFT of the timestamp, statuses excluded.
- `applySetup(plan, proposal, choice)` adds, never removes; reuses a same-named root pole; writes every
  answer a pole covers into `formMapping.answers.pole` (renaming later keeps the match); idempotent.

## App: `app/src/screens/SetupFromFormCard.tsx`

On the import screen above the correspondence, as soon as a file is read. Defaults: everything the
event lacks is ticked, except one-off poles; dates, montage/démontage (when already enabled) and
tranches are ticked only while the event holds no bénévole, since they replace. Pole names editable.
Apply = one edit, merges the pole answers into the screen's mapping state, and re-reads the file
(`rereadPending` effect, the plan arriving through the context). `npm run shots preparer` → 105.

## Checked against the real festival export (kept only in a session scratchpad, never tracked)

After the fixes, 215 bénévoles, 582 of 591 pole choices resolved, nights refused 27 / avoided 70,
22 not on the exploit, montage days read for 52, competences for 166. Fixes made on the way (commits
4ce99b2 and 4cec43e): no auto-binding LEFT of « Horodateur » (orga-added columns); phase question must
be a question and `\bmontage` (« démontage » contains « montage »); buddy matcher no longer takes
« avec qui on a déjà bossé »; « premier / troisième choix » found; new field `exploitHelp` (a no =
absent from the whole event, no volume error); « Oui mais pas l'intégralité » is a yes; a departure
naming a later weekday is no constraint. Remaining doubts on that export are legitimate (responsables,
« envoyé par un respo », prose times, unresolved buddies).

Gotcha for future sessions: shell heredocs and `node -e` strings ate backslashes several times
(`\b`, `\p{M}`, `̀`); write patch scripts to files with the Write tool instead.
