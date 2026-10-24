---
name: feature-registration-validation
description: 2026-10-22, validation of everybody (bénévole, orga, artist member, extra) with a validation mail per kind of person sent through OVH SMTP by the Edge Function send-mail, recorded in mail_log. PLAN_FORMAT 26, migration 35 WRITTEN NOT APPLIED, function NOT DEPLOYED.
metadata:
  type: project
---

# Validation des inscriptions (2026-10-22)

**State: BUILT, green (386 engine, 442 app tests, both typechecks, vite build, sql-check,
schema-check 273), shots 105-109 read in both schemes. PLAN_FORMAT 26. MIGRATION 35 (applied 2026-10-22, see the migration state hook)
(`2026-10-22_registration_validation.sql`, after 34) WRITTEN, NOT APPLIED, min_plan_format 26: it
ships with its deploy. Function `send-mail` NOT DEPLOYED, secrets SMTP_HOST / SMTP_USER /
SMTP_PASSWORD (+ optional SMTP_FROM_NAME, SMTP_REPLY_TO) to set; see its README.** Dry-run on
2026-10-22 (Supabase had been paused, resumed by the developer): 33 applied, 34 and 35 pending.
Extends [[feature-application-tracking]].

## Decisions (the developer, 2026-10-22)

1. Every person entered is « Inscription » until validated by hand: bénévoles (`Volunteer.status`,
   the existing field), orgas, artist members, extra people (`applicationStatus`, since
   `ExtraPerson.status` already means prestataire/autre). Guests of an act have none. The label of
   'candidature' is « Inscription » on screen; the identifier stayed. Placeable either way.
2. Grids mark a non-validated bénévole or orga with **⏳ before the name** (the developer chose it
   over a dashed box): `PendingMark` / `pendingPeople` in `PersonMark.tsx`, on the exploit, both
   phases, the pool. Personnes: an « Inscription » column on every column set (✉️ / ⚠️ for the last
   mail) and a « Suivi » filter with « Mail en échec ».
3. Fiche: `RegistrationSection` at the top of every fiche (orange / green / red banner). « Valider »
   opens a preview of the exact mail (rendered in the browser by `renderMail`), « Envoyer ce mail »
   ticked when the address is valid, then « Valider et envoyer ». « Renvoyer le mail » whatever the
   last outcome, same preview. The status select moved out of `ApplicationSection` (now « Suivi »).
4. One template per audience (`benevole | orga | responsable | artiste | prestataire | autre`;
   responsable = orga holding a LeaderRole), `Plan.mailTemplates` stores ONLY rewritten ones,
   defaults in `tools/src/registration.ts`. Blanks `{prenom} {nom} {evenement} {date} {lieu}
   {groupe} {code} {lien}`; `{lien}` is origin + `?responsable` for orgas. Réglages card « Mails de
   validation ». `email` added to ArtistMember and ExtraPerson (their fiches).
5. **Sending: OVH SMTP** (the developer's choice over Brevo), port 465, nodemailer, from the
   function `supabase/functions/send-mail` (pure part `core.ts`, tested in
   `tools/src/send-mail.test.ts`). The function writes `mail_log` with the régisseur's own JWT
   (no service_role). **`mail_log` is NOT in the plan** (kind + key, append-only RLS: select and
   insert for authenticated) so a stale whole-plan save cannot erase it; a failure the function
   could not record is inserted by the browser (`app/src/mail/mailStore.ts`). With the fixtures,
   a send records a failure « pas de serveur de mail ».
6. A cancelled orga, member or extra leaves the door CSV like a cancelled bénévole (`ticketing.ts`
   now fills `applicationStatus` for them). Conversion bénévole ↔ orga carries the status.

## Not done

A person whose key changes (conversion) loses sight of their mail history. Accepted ≠ delivered:
bounces are not seen. No bulk validation.

## 2026-10-24, tested on a real fiche by the developer

- « Valider sans envoyer de mail » (and « Annuler sans envoyer de mail ») is a second button of the
  window (`SendDialog.secondary`), replacing the « Envoyer ce mail » checkbox.
- `{code}` was empty for a Staff typed into Réglages (no code, see `addOrganiser`). Now
  `drawMissingCodes` (setupEdits.ts) draws one when the window opens (fiche and « Valider les
  personnes placées »), the preview shows it, and `giveDrawnCodes` stores it only with a mail that
  leaves. Validating without a mail still invents no credential.

## 2026-10-24, second round (ToDo of the developer)

- The status is no longer a boxed banner above the buttons: one line, the status name alone in its
  colour (orange / green / red, no icon, no « pas encore validée »), then « Valider » / « Annuler »
  (or « Remettre en inscription »), the audience pushed right. « Envoyer / Renvoyer le mail » stays
  on its own line in Suivi. Labels unchanged (« Inscription », not « En attente »).
- On a fiche, the warning (« Fiche à relire · N signalements ») sits right under the photo, on
  bénévoles and orgas. Its « Valider la fiche » was blue on blue: the later `.btn.is-small` rule
  set `color: var(--accent)`; `.btn.is-primary.is-small` restores `--accent-ink`.
