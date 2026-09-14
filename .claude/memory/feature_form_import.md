---
name: feature-form-import
description: "The real Google Form as read on 2026-09-08: its exact questions and option labels, the four places it does not match the engine's model, and how to re-extract it."
metadata:
  type: project
---

> **Superseded in part on 2026-09-10, re-read against the real export the same day.**
>
> - **44 columns now, not 40.** Four were added at the end: 40 « une précision », 41 vide,
>   42 « impératif horaire », 43 « montage / démontage ». 40 and 43 are new decoys.
> - **The time question was not replaced.** Column 25 is unchanged and still closed; column 42
>   is a NEW free-text one. Both are read.
> - **Each pole choice gained an « Autre » box**, and column 20 now says so in its own title.
>
> Read [[feature-free-text-answers]] before touching the binding or the answer parsing. What
> stays true here: the decoys of 2026-09-08, the volume wording, the buddy answer, and how to
> re-extract the form.

**Read from the live form on 2026-09-08.** Form "Formulaire d'inscription Bénévole Loto Tekno© #6",
15 sections, 41 export columns, zero responses so far. The engine's assumptions were written
before it existed, and this is where the two meet.

## How to read the form again

The editor lazily renders only the visible sections, so its DOM holds about 22 question cards out
of the real total: reading it that way silently misses whole sections. The form was also not
published yet, so `/d/e/<id>/viewform` answered an error page.

What works: open `https://docs.google.com/forms/d/<docId>/preview` and read
`window.FB_PUBLIC_LOAD_DATA_[1][1]`. Each entry is `[id, title, description, type, [[entryId,
[[optionLabel], ...], required]]]`, with type 2 single choice, 4 checkboxes, 8 a section break.
That carries every section at once, published or not. Keep the script short: a longer one that
also touched `document` was refused by the extension as cookie/query access.

## The exact option labels

**Volume** ("Nous demandons à chaque bénévole un minimum de 4 h..."), single choice plus Autre:
- "Je préfère rester sur un seul créneau de 4 h. 😊" → 4 h
- "Je veux bien donner un coup de main 2 h de plus, ça ne me fait pas peur ! 💪" → 6 h
- "Je suis partant·e pour 4 h de plus, j'ai l'habitude ! 💪💪" → 8 h
- "J'ai quelques questions avant de me décider, je les préciserai dans « Autre ». 💬" → **no volume**

**Level** (both choices), single choice: `Débutant`, `Intermédiaire`, **`Habitué`**. The engine's
third level is `expert`; the form never says that word.

**Poles**, identical list for choice 1, choice 2 and the refusal. **The labels carry emoji**, and
they will be in the CSV exactly as written:
`🍻 BAR fix`, `🍻🛒 BAR Ambulant`, `🎫 LES ENTREES`, `👕 VENTE MERCH`, `💦🌳 BRIGADE VERTE`,
`👨‍🍳 CATERING`, `🛠️ MONTAGE / DÉMONTAGE / ÉQUIPE VOLANTE TECHNIQUE`, `🚗 RUNNER / RUNNEUSE`,
`🎭ANIMATION SUR TABLE`, plus, on the two choice questions only,
`🧩 J'AI DÉJÀ UN RÔLE ATTITRÉ QUI N'EST PAS DANS LA LISTE À PRÉCISER DANS « AUTRE ».`

Section 2's prose describes four bars (scène, Dance Floor, intérieur, ambulant) while the choice
list offers two (`BAR fix`, `BAR Ambulant`). **The form's granularity is the root pole**, and the
sub-poles are the régisseur's business. That works as it stands: `PlanIndex.isUnder` already
satisfies a choice on a root pole with any shift under it.

**Refused time slot**, single choice: `de 12h à 18h`, `de 18h à 00h`, `de 00h à 06h`,
`Aucune, tout me va !`. Maps onto `DEFAULT_SLOTS` one for one; only the labels differ.

**"Qu'est ce que tu préfères ?"**, single choice: `Travailler pendant le loto`,
`Travailler pendant les concerts`, `Peux importe`.

## Where the form and the engine disagree

1. **The refusal is a checkbox question.** A volunteer can rule out several poles, and
   `Volunteer.refusedPoleKey` holds exactly one. This is a hard constraint (H2), so a dropped
   refusal is a volunteer placed somewhere they said no to.
2. **"Qu'est ce que tu préfères ?" is a preference, not an availability.** `EventHalf` is hard in
   one direction: `evening` means never before the evening boundary. Reading "concerts" as
   `evening` would turn a stated preference into a rule that refuses a legal placement.
3. **One volume answer carries no volume**, and `Autre` is free text on that question as well as
   on both choice questions.
4. **Montage and démontage happen on other days.** The convention in section 13 names 11, 12 and
   15 March 2027 alongside the event on the 13th and 14th, and one of the nine poles is
   `MONTAGE / DÉMONTAGE`. The tool models a single event of 18 hours.

## Decisions taken 2026-09-08, and the work they imply

Answers to the four disagreements above. **All four are implemented, see the section after.**

1. **"Qu'est ce que tu préfères ?" becomes a soft preference**, optimised by the solver and
   reported in the dashboard, never a rule that refuses a placement. That is what the question
   promises the volunteer. Consequence: `EventHalf` stops being a hard constraint, which is a
   change to `availability.ts` and to the solver's objective, not just to the importer. **Still
   missing: the hour at which the loto gives way to the concerts.** Nothing can map "loto" and
   "concerts" onto hours without it.
2. **Refusals become a list.** `Volunteer.refusedPoleKey` becomes plural, everywhere. A dropped
   refusal is a volunteer placed on a pole they ruled out in writing, and that is a hard
   constraint, so keeping one of three was not acceptable.
3. **Montage and démontage stay outside the tool.** Volunteers who choose that pole are imported
   and flagged; no montage shift exists in the planning. The tool stays on one day of 18 hours,
   which is what it was designed and measured for.
4. A volume answer that carries no volume imports the person anyway, with an issue saying the
   volume is to be confirmed. Rejecting the row would make somebody disappear.

## The hours, given 2026-09-08, and they are not what was first said

**The loto / soirée boundary is 20h, not 18h**, and the boundary between "après-midi" and
"soirée" turned out to be the same question as the boundary between the loto and the concerts.
There is one line, not two.

- Somebody who prefers the loto **may overflow into the evening until 22h**. That was midnight
  in the first pass; the régisseur corrected it to 22h.
- Somebody who prefers the soirée **starts from 20h**.

In hours from the event start (midday): `eveningStartsAt: 8`, `afternoonOverflowUntil: 10`.
Both were 6 and 12. **These are the only two numbers the whole refactor was waiting on.**

**Assumption stated, worth confirming if it ever matters:** "elle commencera à partir de 20h" is
implemented as a soft rule with no tolerated band, matching decision 1 above, which says the
question is a preference and never refuses a placement. So an evening answer worked before 20h
is legal, costs 1500 an hour, and is reported. An afternoon answer gets a two-hour tolerated
band and only pays the flat rate past 22h. That asymmetry is exactly what was asked for.

## Column binding, as measured and then fixed against the real export

`bindColumns` was written against invented headers, which is why it passed. Against the real
export it bound `submittedAt`, `firstName`, `lastName`, `email` and `phone`, failed to find the
six scheduling fields, and **bound two columns wrongly**: `volume` to "Combien faut-il de
personnes pour déplacer un fût de 30 litres de bière ?" and `refusedPole` to the volume question.

Rewritten 2026-09-08 and now binding all fifteen with none missing. **The real export has 40
columns, not 41.** Three decoys are what make it hard, and each one cost a real column:

| Decoy | Column | Ate |
|---|---|---|
| "Surnom (si tu préfères qu'on t'appelle par celui-ci)" | 4 | the preference question |
| "Combien faut-il de personnes pour déplacer un fût" | 32 | the volume question |
| "Tu veux qu'on appelle qui en cas d'urgence : nom, prénom, numéro de téléphone" | 10 | the phone |

**Column 4 stopped being a decoy on 2026-09-09** and is read into `Volunteer.nickname`, bound by
its own `^surnom` matcher placed early enough to take the column before the preference matcher
looks at it. The tight anchor below stays anyway. See [[feature-display-names]].

So the matchers are anchored tightly on purpose: `ce que tu preferes` and not `prefere`,
`demandons a chaque benevole` and not `combien`, `^numero de telephone` and not `tel`. The two
choice questions carry no digit in this form: they are "choix principal" and "deuxième choix".

**The volume answers do not state their own totals**, and this was the nastiest find. "Je veux
bien donner un coup de main **2 h de plus**" means six hours, and "partant·e pour **4 h de
plus**" means eight. A parser reaching for the first digit made the six-hour answer unreadable
and read the eight-hour answer as four: one visible failure and one silent wrong value.

The guard is in: **a bound column where no row yields an interpretable value raises
`colonne-mal-associee`**, naming the column rather than the rows. Against the old binding every
row would have said "réponse illisible" and nothing would have said the column was wrong, so the
régisseur would have gone looking at a hundred volunteers.

`tools/src/import.test.ts` holds all 40 real headers verbatim, asserts the exact column each
field binds to, asserts the three decoys stay untaken, and covers each of the four volume
answers. **A fixture written in the tool's own imagined words proves nothing**, which is the
whole lesson here: `csv.ts`'s `FORM_COLUMNS` and `reconcile.test.ts` were both moved onto the
real headers and the real option labels for the same reason.

`DEFAULT_SLOTS` labels are now the form's four answers word for word ("de 12h à 18h" and so
on), because the label is what a CSV answer is matched against. They read tersely in Réglages
and that is the right trade.

## The buddy answer, handled 2026-09-08

The question asks for four things in one box: "indique son nom, prénom, mail et numéro de
téléphone". The answer is therefore a sentence about ONE person, and `splitList` was exactly the
wrong tool: `"Bob Durand, bob@example.org, 06 11 22 33 44"` came out as three names, two of which
could never match anybody. Two spurious "binôme non résolu" warnings per request, over a hundred
volunteers, drowning the handful that are real. And it threw away the one field that resolves
exactly: the mail address is the strongest identity in the import, since `volunteerIdentity`
builds the volunteer's own key from it.

`parseBuddyAnswer` now lifts the addresses and the numbers out first (which is both how they get
used and how the name is left clean), and `resolveBuddies` tries them in order of how much they
can be trusted: **address, then number, then name**. The first two are identities somebody
copied, the third is a name somebody remembered how to spell. A number matches on its last nine
digits, so `06 11 22 33 44` and `+33 6 11 22 33 44` are the same person.

Three rules worth not relitigating:

- **A comma is not a separator, until it is.** It separates the details of one person in the
  answer the form asks for, and two people in the answer some will give, and the two are not
  distinguishable. So the whole string is matched first, and only then its comma pieces, **all or
  nothing**: two friends both in the file become two requests, and anything else goes to the
  manual pass whole, in one line. Splitting whenever some pieces happen to resolve would turn
  "Marie Dupont, du bar, dispo le soir" into one pairing plus two warnings about a bar.
  A semicolon, a new line, an "&" or an "et" are separators outright: they are a statement of
  intent, a comma is not.
- **An address matching nobody is an answer, not a failure to read one.** New code
  `binome-non-inscrit`: the friend has not filled in the form, so the fix is to go and ask them
  rather than to hunt for a spelling. `binome-ambigu`, `binome-non-resolu` and `binome-soi-meme`
  are unchanged.
- **`buddyRawNames` holds one entry per person named**, the name if there is one and otherwise
  the address or the number. Note for the next import against an existing plan: this changes what
  the reconciliation diff shows on "Binômes demandés" for everybody who answered the question,
  once. That is the old three-fragment reading being corrected, not a change of answer.

Covered by ten tests in `import.test.ts` built on two and three real-export rows, including the
exact shape the form asks for, the misspelled name saved by the address, and the number alone.

## The generator writes the real export now, 2026-09-08

`FORM_COLUMNS` was the fifteen useful columns; it is the forty real ones, spliced byte for byte
out of the verbatim copy in `import.test.ts` rather than retyped (the headers carry typographic
apostrophes, trailing spaces and newlines). `volunteerToFormRow` fills them positionally,
**decoys included**: without them a rehearsal on generated data exercises none of the matchers
that were tightened because of them. `import.test.ts` asserts the two lists are identical, so
neither copy can drift; they stay separate because one is evidence and the other is a generator.

The buddy answers are generated in the shape the question asks for, "Nom, mail, téléphone", with
the friend's real details about seven times out of ten, and several friends separated by "et".
Measured on a regenerated `balanced`: 57 requests, 56 resolved, **33 of them by mail address**,
and the single failure is a real homonym. That is the new resolver exercised end to end for the
first time rather than only in unit tests.

`reconcile.test.ts` builds its rows by index into the forty columns for the same reason.

Related: [[project-brief]], [[project-engine-api]], [[feature-admin-ui]].
