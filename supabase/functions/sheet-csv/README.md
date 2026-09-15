# sheet-csv

Reads a private Google Sheet for the import screen, through a Google service account.
Why and how: `core.ts` (the pure part, tested in `tools/src/private-sheet.test.ts`) and
`index.ts` (HTTP, the régisseur's session check, the secret).

## One-time setup

1. **Google Cloud** (free, no billing): a project, the Google Sheets API enabled, a service
   account with no role, a JSON key. The key is a password: never in this repository.
2. **Supabase secret**: Project Settings (or Edge Functions) > Secrets, add
   `GOOGLE_SERVICE_ACCOUNT` with the whole content of the JSON key file as its value.
3. **Deploy**, from the repository root, with a Supabase personal access token:

   ```
   npx supabase login
   npx supabase functions deploy sheet-csv --project-ref <project-ref>
   ```

   `<project-ref>` is the id in the project's dashboard URL. JWT verification stays on (the
   default): the function also checks that the caller is a signed-in régisseur.

## Per sheet

Share the form's response sheet, read-only (« Lecteur »), with the service account's address
(`...@....iam.gserviceaccount.com`), without notification. The link-sharing can then be removed.

Until the function is deployed and its secret set, the import falls back to the public
« anyone with the link » CSV endpoint, exactly as before.
