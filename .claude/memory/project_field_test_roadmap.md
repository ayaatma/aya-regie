---
name: project-field-test-roadmap
description: 2026-09-15, what a field test on another festival's volunteer form taught us, and the developer's decisions on each point; the roadmap after the Personnes tab, built item by item since.
metadata:
  type: project
---

# Field test roadmap (2026-09-15)

The developer is volunteering-side on another festival (about 220 volunteers, montage and
démontage over several days, a three-day exploit running through the night) and shared that
event's filled volunteer sheet: 45 form questions plus 8 columns the organisers added by hand.
The raw export was profiled in a session scratchpad and never entered the repository. **No real
answer, name or event figure belongs in this file or in a fixture** (see [[project-open-source]]).

**State: being built in order, one commit per item.** Each block says when it is built and
where its `feature_*.md` is.

## Decided, in the developer's words turned into specs

### 1. Application tracking and automatic sync (top priority)
- **Tracking BUILT 2026-09-15, see [[feature-application-tracking]]. Private sheet reading BUILT (not deployed), see [[feature-private-sheet]]. Periodic sync and confirmation form NOT built.**
- The organisers' "Statut" column stacks a decision (validé / annulé / liste d'attente) with a
  checklist of messages sent (confirmation, demande de reconfirmation, présence reconfirmée,
  infos importantes, relance photo). About one registration in five was cancelled.
- Decision: a **status per person** (candidature, validé·e, liste d'attente, annulé·e) plus
  **communication steps** to tick, and a régie note per person.
- A cancellation never deletes and never unplaces silently: it produces a proposal freeing the
  places (ground rule in CLAUDE.md).
- The form's Google Sheet is **synchronised automatically** onto its event: new rows are added
  without a manual import.
- Statuses change by hand, or from **another form's import**: a second "je confirme ma venue"
  form, the first one being registration only. The form-mapping (`form-mapping.ts`) will need a
  notion of which form a sheet is (inscription / confirmation / orga).
- SETTLED 2026-09-15 as a service account, see [[feature-private-sheet]]. Was: today's import reads the sheet through `gviz` (see
  `app/src/import/sheet.ts`), which only works when the sheet is readable by anyone with the
  link. With health and emergency-contact fields that exposure is not acceptable. Recommended
  instead: an Apps Script `onFormSubmit` trigger in the sheet pushing each row to a Supabase
  edge function with a per-event secret, the sheet staying private.

### 2. Two people behind one e-mail address
- `volunteerIdentity` (tools/src/import.ts) is `mail:<address>` whenever there is one. Two
  different people sharing an address therefore become `key` and `key#2` with an
  `identite-ambigue` warning, and **a person re-submitting the form is duplicated the same way**.
  On the field-test sheet all 9 repeated addresses were re-submissions by the same person and
  none was shared; the re-submission case is the real, present one.
- **DECIDED 2026-09-15: one address per person, required.** The developer chose simplicity
  over supporting a couple sharing one address (an address + first-name identity was proposed
  and rejected). So the identity stays `mail:<address>`, and the work is the RE-SUBMISSION:
  several rows on one address are one person, the latest answer wins (earliest timestamp kept
  as the registration date, useful for the waiting list), `manualFields` rules unchanged. Rows
  on one address with different names are not merged silently: an issue asks the régisseur,
  and the form says an address must be personal. Existing keys are never rewritten.
- The confirmation form should be reached through a pre-filled link carrying the person's
  code, which removes all matching ambiguity.
- **BUILT 2026-09-15, no schema:** `supersededRows` + `parseSubmittedAt` in `tools/src/import.ts`.
  Rows sharing a `mail:` identity collapse to the latest (timestamp when both readable, row order
  otherwise); each replaced row raises warning `reponse-en-double`, whose message also flags
  differing names. Name-only identities still get `#n` + `identite-ambigue` (real homonyms).
  Orga import (`import-organisers.ts`) not touched.

### 3. Skill tags
- **BUILT 2026-09-15, see [[feature-skills]].**
- Tags on a person (permis, CACES, conduite d'engins, métier, bricolage...), and a pole or a
  créneau that requires one, on the exploit AND the two phases, and for montage-only events.
  Signalled, never refused (the régisseur decides), in the spirit of [[feature-advanced-settings]].

### 4. "Préférer éviter" a slot
- **BUILT 2026-09-15, see [[feature-avoided-slots]].**
- The night question has three answers: yes, "yes but I'd rather not", no. The engine knows
  refused slots and one preferred slot, not an avoided one. Generic: per preference slot a
  person is préféré / neutre / à éviter, scored. See [[feature-preference-refactor]].

### 5. Field data, visible to the régie and pole leaders only
- **BUILT 2026-09-15, see [[feature-field-data]].**
- Emergency contact, health / specific needs (special-category data under GDPR), minor or not
  (store the flag, not the birth date), whether the nickname matters to them. Not readable
  through a volunteer code. See [[feature-leader-access]] for the leader read path.

### 6. Pole imposed by a leader
- **BUILT 2026-09-15, see [[feature-imposed-pole]].**
- "Envoyé·e par un·e responsable sur un poste précis": a default placement made up front. The
  régisseur can still change everything; the solver keeps it by default.
- The orga form and the volunteer form may be the same form, per event.

### 7. Availability day by day
- **BUILT 2026-09-15, see [[feature-availability-by-day]].**
- The tool stores availability per day even when a form offers coarser choices (arrival and
  departure brackets, montage days ticked).

### 8. Side activities without a grid
- **BUILT 2026-09-15, see [[feature-side-activities]].**
- Pré-montage, prep weekends, déco weekends: no grid, handled differently; what matters is the
  **list of people keen on each activity**.

### 9. Magasin mode
- **BUILT 2026-09-15, see [[feature-magasin]].**
- Equipment a person can bring (form answer) feeds a future "Magasin" mode managing the general
  equipment: available, lent, returned.

### 10. Réserve becomes Liste d'attente, and a new Réserve
- **BUILT 2026-09-15 with item 1, see [[feature-application-tracking]].**
- Today's Réserve (see [[feature-people-tab]]) is used for people with no créneau who will
  probably not be taken: **rename it "Liste d'attente"**.
- A new **Réserve** holds validated people ready to work more hours (the form's "je viens en
  renfort" answer).

### 11. Energy profile
- **BUILT 2026-09-15 with item 1 (display only).**
- On the person's fiche ("je fonce", "je maîtrise", "je fatigue vite", "première fois"), read
  together with the hours given to them, notably when drawing someone from the Réserve.

### 12. Teams (équipes)
- **BUILT 2026-09-15, see [[feature-teams]].**
- The festival keeps groups of 4 to 6 volunteers together across a pole's créneaux (letter
  codes in their sheet). Decision: an **event setting "fonctionnement en équipe"**, never
  blocking: a créneau may hold a partial team plus someone else when people are unavailable.
- Needs a view of each team's composition, and a way to see a team on the grid, probably by
  selecting one box (the same mechanism as `selectedPerson` highlighting the person's other
  boxes, see [[feature-montage-demontage]]).
- Engine: a scored cohesion term, larger than a binôme; measure its cost like the buddy weight.

## Not retained or later
- Cross-edition person history ("super au bar la dernière fois"): heavy, later.
- Safety quiz and charter answers: awareness only, at most a "à relire" mark.
