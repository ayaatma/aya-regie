-- migration-sequence: 34
-- Migration 2026-10-10: les photos du trombinoscope, dans un bucket prive.
--
-- WHY. The volunteers' form asks for a photo, and the regie wants to see who somebody is from their
-- fiche. A photo is a file, not an answer: it lives in Supabase Storage, never in the plan document,
-- so load_plan and write_plan_body are untouched and PLAN_FORMAT does not move.
--
-- WHAT CHANGES.
--   A PRIVATE bucket `photos`: nothing in it has a public URL, a picture is read through a signed
--   URL the regisseur's session asks for. Small files only (the app keeps a 320 px square, around
--   20 KB): 2 MB and two image types, so the bucket cannot become somebody's file host.
--   Objects are named `<event id>/<sha-256 of the person's key>--<source>.webp`, see
--   tools/src/photos.ts. No name, no address in a path.
--   Policies on storage.objects for that bucket only: a signed-in regisseur may read, add, replace
--   and remove, the same trust as every table's `_organiser` policy. Nothing for anon: an orga code
--   or a volunteer code reaches no photo, not yet.
--
-- APPLY AFTER 33. No min_plan_format change.
--
-- Idempotent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists photos_organiser_select on storage.objects;
drop policy if exists photos_organiser_insert on storage.objects;
drop policy if exists photos_organiser_update on storage.objects;
drop policy if exists photos_organiser_delete on storage.objects;

create policy photos_organiser_select on storage.objects
  for select to authenticated using (bucket_id = 'photos');
create policy photos_organiser_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');
create policy photos_organiser_update on storage.objects
  for update to authenticated using (bucket_id = 'photos') with check (bucket_id = 'photos');
create policy photos_organiser_delete on storage.objects
  for delete to authenticated using (bucket_id = 'photos');
