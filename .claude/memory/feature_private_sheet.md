---
name: feature-private-sheet
description: 2026-09-15, reading a private Google Sheet (roadmap item 1, sync part): a Google service account shared read-only on the sheet, its key in the Supabase secret GOOGLE_SERVICE_ACCOUNT, the first Edge Function `sheet-csv`, and the import falling back to the public link. BUILT, NOT DEPLOYED, waiting for the developer's Google Cloud setup.
metadata:
  type: project
---

# Feuille privée (2026-09-15)

**State 2026-09-16: DEPLOYED by the developer (service account created in the no-organisation project aya-regie, key in the secret, function deployed, sheet shared Lecteur; migrations 24 to 32 applied and app deployed), end-to-end check against a private sheet NOT YET CONFIRMED. Gotcha: the first key attempt failed with iam.disableServiceAccountKeyCreation because the service account had been created in a project under the org aya-atma-org; a project with no organisation has no org policy. Built 2026-09-15: green (358 engine incl. 5 for the function core, 429 app tests).
No schema, no PLAN_FORMAT change, no migration. The app change is safe to deploy before the function:
it falls back to the public link.** Part of [[project-field-test-roadmap]], item 1 (sync). The
automatic periodic sync and the confirmation form are NOT built.

## Decisions (with the developer, 2026-09-15)

1. **Why**: the import read the sheet through the public « anyone with the link » CSV endpoint; a
   form carrying emergency contacts and health notes ([[feature-field-data]]) must not be public.
   Apps Script push was proposed first; the developer asked for « the sheet shared with one
   address », which is a Google **service account**. An @ayaatma.fr address was considered: the
   association has no Google Workspace (a Google One 100 Go plan on a personal account), so no
   external-sharing restriction applies, and a service account is the robust choice (no OAuth
   refresh token to expire).
2. **Free**: Google Cloud project + Sheets API + service account, no billing; Supabase Edge
   Functions are in the free tier.
3. **The function** `supabase/functions/sheet-csv` (the project's FIRST edge function; everything
   else is SQL RPCs): POST {url} with the régisseur's session → text/csv. Checks the session with
   `auth.getUser` (sign-ups are closed, so any account is a régisseur, same trust as RLS). Signs an
   RS256 JWT with WebCrypto, exchanges it for a `spreadsheets.readonly` token (cached per instance),
   resolves the link's gid to a tab title, reads FORMATTED values, pads rows, returns CSV. Errors are
   JSON {error, serviceAccount}: 403 names the address to share with.
4. **Client** (`app/src/import/sheet.ts`): `readThroughFunction` first; `unavailable` (not
   configured, function not deployed = gateway 404 without our JSON, our 503 without the secret,
   network) falls back to the public endpoint; a function error still tries the public link and,
   if that fails too, shows the function's message.
5. **Public repo care**: the test first used the festival's real sheet id; replaced by a fake id
   before any commit. Never put a real sheet id, the service account key, or the project ref in a
   tracked file.

## To finish (developer)

Create the Google Cloud project / service account / JSON key, set the secret
`GOOGLE_SERVICE_ACCOUNT` in Supabase, `npx supabase login` then
`npx supabase functions deploy sheet-csv --project-ref <ref>`, share the sheet (Lecteur) with the
service account address. Then verify « Rafraîchir » on a sheet with link sharing removed.
