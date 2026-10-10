# drive-photo

Reads one photo uploaded through the volunteers' Google Form, for the trombinoscope, with the
same Google service account as `sheet-csv`. Why and how: `core.ts` (the pure part, tested in
`tools/src/drive-photo.test.ts`) and `index.ts` (HTTP, the régisseur's session check, the secret).

## One-time setup

Everything `sheet-csv` needs (project, service account, secret `GOOGLE_SERVICE_ACCOUNT`), plus:

1. **Google Cloud**: enable the **Google Drive API** in the same project (APIs & Services >
   Library). Free, no billing.
2. **Deploy**, from the repository root:

   ```
   npx supabase functions deploy drive-photo --project-ref <project-ref>
   ```

3. **Database**: the private bucket `photos` and its policies come with the migration
   `db/migrations/2026-10-10_photos_bucket.sql` (`npm run migrate -- --apply` in `tools/`).

## Per form

A form's uploads land in a Drive folder named after the form, with one sub-folder per upload
question. Share that folder, read-only (« Lecteur »), with the service account's address
(`...@....iam.gserviceaccount.com`), without notification. Files already in it inherit the
sharing.

Until this is done, the photos are simply not fetched: the import still applies, and a photo can
always be dropped on a fiche by hand.
