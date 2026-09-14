---
name: feedback-gender-neutral-french
description: "Any user-facing French string naming a person must avoid gendered pronouns and participle agreement. Roughly half the volunteers are women."
metadata:
  type: feedback
---

Every French message built around a person's name must read correctly whoever that person is.
No `il`, no `elle`, no masculine participle agreement.

**Why.** Found 2026-09-07 while reading a solver proposal out loud: "Met Laure Thomas en réserve:
il n'y a plus aucun créneau qu'il puisse tenir." Every message the engine built from a volunteer's
name was silently masculine, and roughly half the volunteers at this event will be women, so half
of those messages were wrong for the person they named. French makes the masculine the accidental
default, so this happens by omission rather than by choice, which is exactly why it needs to be a
rule rather than a matter of care.

**How to apply.** Three moves cover nearly every case:

- an impersonal turn: `${name} est placé sur X` becomes `${name} : placement sur X`
- `lui`, which is neutral: `Lui fait atteindre le plancher de 4h`
- naming the person again, or the role: `Ce bénévole occupe déjà ce créneau`

Watch for participle agreement too, not just pronouns: `est placé`, `s'est inscrit`, `est affecté`
and `S'est cité` all carry it. The present tense usually dodges it (`Se cite soi-même`).

Applies to every string a régisseur, a pole leader or a volunteer can read: validation messages,
proposal rationales, import warnings, and later the UI itself. Sits alongside
[[feedback-no-em-dash]] as a standing rule on user-visible text. See [[project-brief]] round 11.
