---
name: feedback-real-people-imported
description: "Since 2026-10-23 real volunteers are in the live plan (about forty). Every fix to reading, import or a fiche must say how it reaches the people already imported, and never mutate them silently."
metadata:
  type: feedback
---

**On 2026-10-23 the developer said the first real volunteers are imported (about forty), and that
from now on every correction must be thought through for how it reaches the people already in
the plan.**

**Why:** until then a reading bug could be fixed and the plan re-imported from scratch. Now the
plan holds validated fiches, hand corrections, statuses and soon assignments, and a fix that only
works on a fresh import leaves those forty wrong, or worse, changes them without the régisseur
seeing it.

**How to apply:**
- For every change to the import or a reading rule, write down (in the reply and the feature
  memory) what happens to an already-imported person on the next import: does the change appear
  as a line in the reconciliation (the régisseur accepts it), does it stay invisible because of
  `mergeWithManual`'s « same raw answers keep the review state » rule, or is it carried by a
  hand correction (`manualFields`)?
- Prefer fixes that go through the form correspondence (`FormMapping.answers`): one decision,
  re-read for everybody, shown as reconciliation lines, never a silent write.
- A new field or a changed meaning needs a backfill story (migration default, or a re-import
  shown as a change), stated before building.
- Still the ground rule: never drop or reassign a volunteer silently.

See [[feature-import-review]], [[feature-free-text-answers]].

**Principle the developer stated the same day:** a correction by the régisseur must never come
back « à relire » on a refresh unless the form's own answer behind it changed. Raw form answers
and corrected values are stored apart for that (`Volunteer.formAnswers`, migration 39).
