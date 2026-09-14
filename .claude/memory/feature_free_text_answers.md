---
name: feature-free-text-answers
description: "Two form questions became free text on 2026-09-10: the time constraint and an Autre box on each pole choice. The importer interprets them, flags what it is unsure of, the régisseur corrects the fiche by hand, and a re-import never undoes a correction. PLAN_FORMAT 4, migration 11."
metadata:
  type: project
---

**State 2026-09-10: built and bound against the real export, 189 engine + 225 app tests green,
typecheck and build clean. Migration 11 is APPLIED; migration 12, which carries
`event.sheet_url`, is written and dry-run but NOT applied. Nothing is deployed.** The real CSV binds all seventeen fields with nothing missing and no decoy taken;
it carries no responses yet, so nothing has been rehearsed on real answers.

## What changed in the form, and why any of this exists

**THE FORM HAS 44 COLUMNS SINCE 2026-09-10, NOT 40**, and the four new ones are 40 to 43.

**THE OLD TIME QUESTION WAS NOT REPLACED. A SECOND ONE WAS ADDED.** This is the thing to know
before touching any of it, and it is not what the feature was first built against:

- column 25, « Il y a t'il des horaire ou tu ne veux/peux absolument pas travailler ? », is
  still there, word for word, still offering the slots.
- column 42, « Si tu as un impératif horaire stricte pendant l'exploitation, précise le ici
  (avec la raison si ce n'est pas indiscret) », is new, and is the sentence.

So both are bound and both are read, and their refusals are merged and deduplicated: answering
either is an answer, answering both is somebody saying the same thing twice. Column 25 is read
by `parseSlotChoice`, which has THREE outcomes rather than two: a slot id, null for "aucune",
and `inconnu` for text matching no slot. `inconnu` is sent to the sentence parser, so the day
the régisseur turns that question into a text field the import keeps working and starts
flagging instead of quietly reading nothing.

The other half of the change:
- Each pole choice gained an « Autre » box. Google Forms writes what was typed into the SAME
  column, so an answer naming a pole the form never listed arrives as prose in `choice1Pole` /
  `choice2Pole`.

An answer that is read is a fact. An answer that is INTERPRETED is a guess, and a guess that
looks like a fact is the failure mode this whole feature exists to prevent: nobody ever checks
it again. So the rule everything here is built on:

> The tool may guess. A guess is never allowed to look like an answer, and the sentence the
> person typed is kept beside it, forever.

## The model, `tools/src/model.ts`

- `refusedSlot: SlotId | null` became **`refusedSlotIds: SlotId[]`**. A sentence can name two
  slots, this is a hard rule, and the single id would have dropped the second one in silence.
  Same move, same reason, as `refusedPoleKeys` on 2026-09-08. See [[feature-preference-refactor]].
- **`availabilityNote`, `choice1Raw`, `choice2Raw`**: the answers as typed. Never rewritten by
  anything, never editable in any screen.
- **`manualFields: EditableField[]`**: which answers the régisseur corrected by hand.
- **`needsReview` + `reviewReasons`**: the doubt, in French, one line per doubt.
- **`EDITABLE_FIELDS`** is the closed list of what a régisseur may correct. Deliberately not
  every field: a key is an identity, an access code is ours, and a raw answer is what the person
  said. What is left is exactly the interpretations.

## Reading prose, `tools/src/answers.ts` (new)

`parseAvailabilityNote` and `parsePoleAnswer`, both returning an `AnswerReading<T>`:
`{ value, confident, reason }`. **No function here ever returns a bare value**, which is what
makes "the importer was unsure" a thing the type system carries rather than a convention.

Shapes the time parser knows: `de X à Y` / `entre X et Y` (every occurrence, not just the
first), `avant X`, `après X` / `à partir de X`, `jusqu'à X` / `je pars à X`, `j'arrive à X`.
`minuit` and `midi` are hours. A sentence with no hour in it is never guessed at.

**THE READING IS SLOT-GRANULAR BECAUSE THE PLAN IS.** "pas après 22h" over a slot running 18h to
minuit cannot be stored as anything finer, so the whole slot is refused **and flagged**. Refusing
too much is a pair of hands the régisseur gives back in one click; refusing too little is
somebody placed at an hour they said they could not come.

The pole parser widens in four passes: exact path, unambiguous leaf name, a pole named inside a
sentence, a near miss within two edits. Only the first two come back confident. **An answer
naming two poles is never resolved to the first one**: choosing for somebody in silence is the
exact mistake the file exists to avoid.

Measured on the regenerated `balanced` scenario, which now answers one question or the other:
**6 fiches out of 120 flagged**, 26 refusals of a tranche, 11 of them ticked in column 25 and 15
written as a sentence in column 42.

## The column binding

Two fields, two tight anchors, each on a phrase belonging to that question and to nothing else
in the forty-four:

- `refusedSlotChoice`: `/ne veux peux absolument pas travailler/` → column 25.
- `availabilityNote`: `/imperatif horaire/` → column 42.

**Neither is `required`**, because either can be reworded away, but an import that binds
NEITHER raises an error of its own: a file with no availability question at all would
otherwise look like it worked.

A first version used one broad matcher for both halves. Against the real file it took column
25 for `availabilityNote` and never read 42 at all, which is the same failure as 2026-09-08
in a new costume. See [[feature-form-import]].

**Two of the three new columns are decoys**, and the binding test now pins them: 40 says « une
précision » and 43 says « créneaux ». Taking 43 would have read "yes, I can help set up the
day before" as an availability constraint.

`pole-inconnu` dropped from error to warning: with an « Autre » box, an unmatched answer is an
ordinary event, and an error would stop an import over one person's wording.

## Corrections that survive a re-import, `mergeWithManual` in `reconcile.ts`

Exported, and called by BOTH `reconcileVolunteers` (to diff) and `applyReconciliation` (to
write). Two implementations of "what will happen" would eventually disagree, and that day the
régisseur reads a screen about a plan that never existed.

Three rules, in order:

1. every answer comes from the export, as before.
2. a field in `manualFields` keeps the corrected value.
3. the fiche goes back to the queue only when the doubt is NEW.

Rule 3 is subtler than it looks, and both halves were found by a failing test:

- **A doubt already settled is not raised again.** The parser is unsure of the same sentence
  every single time it reads it, and the form is exported every few days. Taking the fresh
  import's `needsReview` at face value put every validated fiche straight back in the queue on
  the next import, forever. So a doubt only counts as new when one of the three raw answers
  changed.
- **On an interpreted field, the export "disagreeing" with the correction is not news**, because
  the correction IS a human overruling that reading. What is news is the SENTENCE changing: the
  correction was then made against something the person no longer says. On an ordinary field (a
  phone number retyped from a voicemail) the opposite holds, and a differing export does flag.

## The fiche, `components/SidePanel.tsx` + `components/VolunteerEdit.tsx` (new)

- The doubt sits at the top, orange, with its reasons and one button: **« Valider la fiche »**.
  Deliberately a human action rather than a consequence of editing: a régisseur may read the
  sentence and conclude the parser had it right, and that review has to be expressible or the
  queue never empties. Validating clears the tag and the reasons.
- **« Ce qu'elle a écrit »** shows the raw answers, always, not only when flagged. A reading
  nobody doubted can still be wrong.
- **« Modifier la fiche »** opens `VolunteerEdit`: slots as checkboxes, the two choices and their
  levels, refused poles, volume, preference, contact. Nothing autosaves, and **only the fields
  that actually differ are sent**, because `correctVolunteer` marks everything it receives as
  corrected by hand and that freezes it against future imports.
- **The « À relire » tab** lists every flagged fiche, sorted by name so the list does not
  reorder as it empties, and only exists when there is something in it.
- Read-only (pole leaders) sees the doubt and no button.

`correctVolunteer` and `markReviewed` live in `store/edits.ts` and go through `edit`, so both
land in the undo stack and in the journal like a drag does.

## The Google Sheet is remembered, 2026-09-10

Asked for in the same session, and unrelated to the prose parsing: `plan.sheetUrl` holds the
link the answers were last fetched from, and the import screen offers **« Rafraîchir »**
instead of an empty field.

- **On the plan, not in a browser**, like a pole’s colour and for the same reason: it is a fact
  about this event. The second régisseur, or the same one on another machine, finds it there.
  `event.sheet_url` in SQL, **migration 12**. It was written into migration 11 first, on a wrong
  assumption about whether 11 had run; see "A migration that has run is never edited" in
  [[feature-supabase]].
- **Written when a fetch succeeds, not when an import is applied.** Fetching proves the link is
  a readable sheet; applying is a separate decision, and a link that brought back an export the
  régisseur then abandoned is still the right link.
- **A file import never sets it.** A CSV downloaded once is not somewhere the tool can go back
  to on its own.
- The button says « Rafraîchir » only while the field still holds the remembered link, and
  « Récupérer » as soon as it holds anything else: fetching a different sheet is not a refresh.
- `rememberSheet` returns the same plan object when the link has not changed, so re-importing
  from the same sheet does not produce a save, an undo step and a journal line every time.

## Database, migration 11

`db/migrations/2026-09-10_free_text_answers_and_manual_review.sql`, mirrored into `db/schema.sql`
(verified by `npm run schema-check`: 23 Volunteer fields round-trip).

- `volunteer_refused_slot`, a table, replacing `refused_slot_key`. Backfilled first, then the
  column is dropped, all guarded so re-running is harmless.
- Six new columns on `volunteer`, `load_plan` and `write_plan_body` replaced whole.
- **`min_plan_format` 3 → 4**: a tab loaded before this deploy would drop the second refusal of
  everybody who named two and erase every sentence. It must ship WITH its deploy, like migration
  9 and 10. See [[feature-supabase]].

## What is left

1. `npm run migrate -- --apply`, then `npm run deploy`, in that order. Both are VS Code targets
   since 2026-09-09.
2. Nothing has ever been imported from a real answer: the export carries no responses yet. The
   first real import is where the parser meets sentences nobody wrote for it.
3. Migration 10 is applied but the display-names front was never deployed, so the next deploy
   carries both. See [[feature-display-names]].

Related: [[feature-form-import]], [[feature-preference-refactor]], [[feature-admin-ui]],
[[feature-supabase]], [[project-engine-api]].
