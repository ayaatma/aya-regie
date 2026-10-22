---
name: feature-import-review
description: "2026-10-22, the import screen's « À régler » list: doubts grouped by answer and settled once through the form correspondence, a jump to the fiche and back, the review kept across tabs, signalements folded into fiches, the form's answer beside a corrected pole choice. App + engine, no schema, no PLAN_FORMAT change."
metadata:
  type: project
---

**State 2026-10-22: built, green (411 engine + 454 app tests), build clean, checked in headless
Chrome (`npm run shots -- aregler`). No migration, no PLAN_FORMAT change, app deploy only.**
Asked by the developer after a first real refresh of the October form, where every warning had
to be cleared fiche by fiche.

## What it does

- **« À régler » sits right under the import summary** (`screens/ImportReview.tsx`). Three kinds of
  line: signalements about the file (no `key`), one line per CLOSED ANSWER in doubt shared by all
  the fiches carrying it, and every other review line, identical texts grouped.
- **A closed answer is settled once**: the select + « Retenir pour les N fiches » writes
  `FormMapping.answers[kind][normalise(answer)]`, the same store the mapping card writes, so the
  file is re-read, every fiche carrying it is cleared, and the next exports read it the same way.
  The options are `answerOptions(plan, kind, survey)`, exported from `FormMappingCard.tsx` and
  shared with its tables.
- **Each person on a line is a button** to their fiche: it opens the editor, scrolls down, and on
  Enregistrer / La lecture est bonne / Annuler scrolls the same box back to where it was
  (measured: 436 → 5876 → 436). A validated or corrected fiche leaves the list.
- **The review survives a tab switch and a reload** (`import/importSession.ts`): csv, source,
  mapping, flipped removals and per-fiche fixes `{changes, validated}`, in memory and in
  `sessionStorage`, keyed by event id, cleared on apply and on abandon. The file is RE-READ from
  `csv` against the current plan (a `useMemo` on `[session, plan]`, which replaced the old
  `rereadPending` effect) and the fixes are replayed by `withFix`. Consequence: changing the
  correspondence no longer drops the corrections (the card's text says so now). A NEW fetch or
  file starts with no fixes but keeps the mapping being worked on.
- **The screen promises that whatever is not settled stays « À relire » in Personnes**, and that
  is made true by `foldIssuesIntoFiches` (engine): every signalement with a `key` and without
  `onFiche` becomes a review reason of its fiche before reconciliation. `mergeWithManual` keeps a
  validated fiche's state when the answers are unchanged, so this does not re-raise anything on
  the next import.
- **Personnes, Ses choix de pôle**: « · réponse au formulaire: « … » » beside a choice that differs
  from what the import would read of its raw answer today (mapping first, then
  `parsePoleAnswer`). `answerDiffers` in `VolunteerFiche.tsx`.

## Engine additions, `tools/src/import.ts`

- `ImportIssue.key` (filled after the loop from `rowOf`) and `ImportIssue.onFiche` (the fiche
  already says it: the unread choice, the contradictory choice).
- `ImportResult.doubts: AnswerDoubt[]` `{key, kind, answer, read, messages}` for: a pole choice read
  with a reason, an unknown refused pole, an unknown slotComfort, an unreadable preferred slot or
  volume. Free-text sentences are NOT doubts: they are per person.

## Not done, worth offering

- Only pole choices keep their raw answer. Refused poles, the preferred slot and the volume store
  no raw answer, so a correction of those cannot show « réponse au formulaire » without new
  fields (model + PLAN_FORMAT + migration). Raised to the developer on 2026-10-22.

See [[feature-free-text-answers]], [[feature-generic-event]], [[feature-form-import]].

## Follow-up the same day: doubles and binômes

- **A pole chosen twice is choice 1 and no choice 2**, without a signalement (`choix-identique` is
  gone, on request). Same for « peu importe » twice; two unread answers stay two.
- **Binômes are settled on a fiche still being imported** (`screens/ImportBuddies.tsx`): the
  resolved pairs, the unresolved answer with its « Peut-être » candidates, and a picker over this
  file's people AND the plan's people not in the file. Held on `FicheFix.buddies {added, removed}`
  and laid on the plan after the reconciliation by `withBuddyFixes` (manual pairs via `addBuddy`,
  form pairs taken off via `removeBuddy`, so dismissed). Shown when the person answered the
  question, has a buddy fix, or the editor is open.
- **The engine resolves binômes against the plan too**: `ImportOptions.roster` (the app passes
  `plan.volunteers`), searched only, never imported; a candidate off-file is labelled « déjà dans
  le plan ».
- The rule, unchanged since the brief: one-way requests, reciprocity assumed, several per person,
  each a PAIR (A with B and A with C never pairs B with C), weight 5000 when honoured.
- `npm run shots -- binomes` replays it.
