---
name: feature-photos
description: 2026-10-10, the trombinoscope photos: fetched from the form's Drive uploads after an applied import, or dropped on a fiche by the régie; one 320 px square per person in the private Storage bucket `photos`, never in the plan. Function drive-photo and migration 34 WRITTEN, NOT DEPLOYED / NOT APPLIED.
metadata:
  type: project
---

# Photos du trombinoscope (2026-10-10)

**State: BUILT, green (375 engine, 441 app tests, sql-check, vite build). NOT VERIFIED IN A
BROWSER OR AGAINST SUPABASE.** To make it live (developer): enable the Google Drive API in the
service account's Google Cloud project, `npx supabase functions deploy drive-photo`, apply
migration 34 (`2026-10-10_photos_bucket.sql`, after 33), share the form's upload folder in Drive
(Lecteur) with the service account. On 2026-10-10 `npm run migrate` could not reach the database
(« tenant/user ... not found »: the pooler host in `.env.deploy.local` no longer matches), so
whether 33 is applied was not re-checked.

## Decisions (the developer, 2026-10-10)

1. **Two ways in, both wanted**: automatic from the form's upload question (Google exports Drive
   links `open?id=<id>`), and a file the admin drops on the fiche or picks in a file dialog.
2. **Not in the plan.** A photo is a file: no `Volunteer` field, no load_plan / write_plan_body
   change, no PLAN_FORMAT bump. The importer returns `ImportResult.photos` (key + Drive id); the
   import screen fetches them once the import is APPLIED (never on a read the régisseur abandons).
3. **Storage**: private bucket `photos`, 2 MB, webp/jpeg only, policies for `authenticated` only
   (anon, so orga and volunteer codes, reach nothing; the fiche hides the photo when read-only).
   Object name `<event id>/<sha256(key) 32 hex>--drive-<id>.webp` or `--manuel-<ms>.webp`: no
   personal data in paths, and ONE listing tells for everybody what is held and where it came from.
4. **A hand-picked photo is never replaced by the form's**; the same Drive file is never fetched
   twice; a different Drive file (re-submission) replaces. `needsDriveFetch` in `tools/src/photos.ts`.
5. **Shrunk in the browser**: square crop of the short side, 30 % from the top on a portrait,
   320 px, WebP 0.85 (JPEG if the browser cannot write WebP), about 20 KB.
6. **Drive's thumbnail first** (asked at 800 px) in `supabase/functions/drive-photo/core.ts`,
   because iPhones send HEIC, which no canvas reads; the file itself only for a drawable type.
   A HEIC dropped by hand is refused with a sentence saying to convert it.
7. Same service account and secret as [[feature-private-sheet]]; `accessToken` gained a scope.

## Where

`tools/src/photos.ts` (pure, tested), `import.ts` field `photo` (matcher /photo|trombinoscope/,
early, not a consent question), `form-mapping.ts` label, `app/src/photos/photoStore.ts` (book per
event, signed URLs 6 h, `putPhoto`, `removePhoto`, `syncFormPhotos` three at a time),
`components/PersonPhoto.tsx` on VolunteerFiche and OrganiserFiche, `PhotoSyncNotice` in ImportScreen.

## Not done

Orphan photos (a person removed, a plan deleted) stay in the bucket. No photo in the Personnes
list, the printable trombinoscope, or the volunteer view, although the form promises volunteers
they will see who they work with. The orgas' own form is not read for a photo.

## 2026-10-24: a 403 is not always the sharing

The developer had shared the folder and still read « Photo inaccessible. Partagez le dossier »
on every photo: `readDrivePhoto` turned EVERY 403/404 into that sentence. It now reads Google's
`reason`: Drive API disabled in the Cloud project (`accessNotConfigured`, `SERVICE_DISABLED`)
and a token without the Drive scope (old deployed function) answer 503 with their own sentence,
which stops the run; only a 404 or `notFound`/`forbidden` still blames the sharing; any other
403 shows Google's message. Needs `drive-photo` redeployed to take effect.
Same day, the import « went well » but brought no photo and the fiche showed no « Récupérer »
button: both come from the photo column (no binding, or no Drive link in it), and an import with
no photo said nothing. Now: an unbound photo column is a « colonne-non-reliee » warning, a column
where no answer holds a Drive link is « colonne-mal-associee », and the import always shows the
« Photos du formulaire » notice, « aucune réponse n'en contient » included. Cause on the real
form still unknown when this was written.
Then « 34 déjà là » yet no photo on the developer's own fiche: they are Responsable. A row of
somebody already Staff / Responsable (`reconciliation.alreadyOrga`) still sent its photo link
under the BÉNÉVOLE key, so the photo landed under a hash no fiche reads; and `convertPerson`
gives a new key (`resp-...`), stranding a photo too. Now `startPhotoSync` redirects such links
to the organiser's key (by `organiserIdentity`), and the « Passer Staff / Responsable / bénévole »
button calls `movePhoto`. The stranded objects under the old hashes stay in the bucket.
**Verified live by the developer on 2026-10-24: bénévoles' photos show, and with this fix the
Staff / Responsables' too.** Open: orphan objects under old hashes (cleanup offered, not asked).
