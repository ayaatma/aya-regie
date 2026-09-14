-- migration-sequence: 5
-- Migration 2026-09-08: a plan keeps its past versions, and a plan can be deleted.
--
-- Sorts after 2026-09-08_revoke_anon_from_plan_rpcs.sql, which matters: the grants at the
-- bottom of this file are the ones that must have the last word. Everything here is idempotent
-- apart from the save_plan signature change, which drops the old function first and says why.
--
-- Why, in two parts.
--
-- 1. A SAVE IS DESTRUCTIVE AND NOTHING KEPT THE OUTGOING VERSION. save_plan deletes the event's
--    whole contents and rewrites them from the JSON it is handed (decision 3, see
--    .claude/memory/feature_supabase.md). That was harmless while the database held nothing; it
--    stopped being harmless the day it held a real plan. Ctrl+Z covers the mistake noticed in
--    the same breath, in one browser. It covers nothing about yesterday, another tab, or the
--    other organiser. A version is archived here before it is overwritten, so going back is a
--    restore rather than an afternoon of re-doing.
--
-- 2. THERE WAS NO WAY TO DELETE A PLAN. No RPC, no screen, so seeding a test scenario into the
--    real project was one-way. delete_plan takes the plan's name as a second argument and
--    refuses if it does not match, which makes the guard the database's rather than a modal's.
--
-- What is NOT here, on purpose: a diff between two versions. The list carries what changed in
-- shape (people, creneaux, affectations) plus the label of the edit that produced each version,
-- which is what a regisseur needs in order to pick one. A field by field diff is a build of its
-- own and would have delayed the thing that actually stops work being lost.

-- ---------------------------------------------------------------------------
-- 1. Where a past version lives
-- ---------------------------------------------------------------------------

-- THE ONE TABLE THAT IS NOT PART OF THE PLAN. Decision 7 says every column is either part of the
-- Plan or derived at read time, because a full-replace save wipes anything else. plan_version is
-- the deliberate exception: it is not part of a plan, it is about plans, and write_plan_body
-- never touches it. That is exactly why it survives the save it exists to protect against.
create table if not exists plan_version (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references event(id) on delete cascade,
  -- The version this body WAS, not the version that replaced it.
  version     int  not null,
  -- When that version was written, by whoever wrote it.
  saved_at    timestamptz not null,
  -- When it was moved here, which is when the save that replaced it happened.
  archived_at timestamptz not null default now(),
  -- French, and shown as it stands: the label of the edit that produced this body, carried
  -- through event.last_label. Null for a body written before this migration existed.
  label       text,
  -- The whole plan document, exactly as load_plan builds it, which is exactly what
  -- write_plan_body consumes. That round trip is the proven one, so a restore is a load.
  body        jsonb not null,
  unique (event_id, version)
);

create index if not exists plan_version_event_idx on plan_version (event_id, version desc);

-- The label of the edit that produced the CURRENT version, moved into plan_version when that
-- version is archived. It lives on event rather than being passed at archive time because the
-- label describes the body being kept, not the save that displaces it.
alter table event add column if not exists last_label text;

alter table plan_version enable row level security;

do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'plan_version'
      and policyname = 'plan_version_organiser'
  ) then
    create policy plan_version_organiser on plan_version
      for all to authenticated using (true) with check (true);
  end if;
end
$policies$;

-- ---------------------------------------------------------------------------
-- 2. Archiving, and the two rules that keep it from swallowing the project
-- ---------------------------------------------------------------------------

-- The autosave writes about 1.2 s after the last edit, so an afternoon of dragging boxes is
-- hundreds of saves, and a plan is about 100 KB of JSON. Kept naively that is gigabytes of
-- near-identical documents, for a history nobody can read.
--
-- Two rules, and both are about what a regisseur would actually reach for:
--
--   KEEP_EVERY: a routine save whose predecessor was archived less than this ago archives
--   nothing. Note which body that keeps: the OLDER one. A restore point thirty seconds back is
--   worth nothing, since Ctrl+Z already goes there; ten minutes back is worth the row.
--
--   KEEP_MAX: only the newest this many versions of an event are kept.
--
-- p_force is what a restore passes. Restoring is punctual and it overwrites the live plan, so
-- the state it overwrites is archived whatever the clock says.
create or replace function private.archive_plan_version(
  p_event_id uuid, p_force boolean default false)
returns void
language plpgsql
set search_path = public, private
as $fn$
declare
  keep_every constant interval := interval '10 minutes';
  keep_max   constant int      := 50;
  v_version  int;
  v_saved    timestamptz;
  v_label    text;
  v_last     timestamptz;
begin
  select version, updated_at, last_label into v_version, v_saved, v_label
  from event where id = p_event_id;
  if not found then
    return;
  end if;

  if not p_force then
    select max(archived_at) into v_last from plan_version where event_id = p_event_id;
    if v_last is not null and v_last > now() - keep_every then
      return;
    end if;
  end if;

  insert into plan_version (event_id, version, saved_at, label, body)
  select p_event_id, v_version, coalesce(v_saved, now()), v_label, load_plan(p_event_id)->'plan'
  on conflict (event_id, version) do nothing;

  delete from plan_version old
  where old.event_id = p_event_id
    and old.id not in (
      select keep.id from plan_version keep
      where keep.event_id = p_event_id
      order by keep.version desc
      limit keep_max
    );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. save_plan, which now archives before it overwrites
-- ---------------------------------------------------------------------------

-- DROPPED RATHER THAN REPLACED. The new one takes a fourth argument with a default, so both
-- signatures would exist side by side and a three-argument call would bind to the old one,
-- which archives nothing. A save that silently keeps no history is precisely the failure this
-- migration exists to remove, so the old signature has to go rather than merely be shadowed.
drop function if exists public.save_plan(uuid, int, jsonb);

create or replace function public.save_plan(
  p_event_id uuid, p_base_version int, p_plan jsonb, p_label text default null)
returns jsonb
language plpgsql
as $fn$
declare
  v_version int;
  v_saved   timestamptz;
begin
  -- The row lock is the serialisation point: two organisers saving at the same instant queue
  -- here, and the second one reads the first one's version rather than racing past it.
  select version, updated_at into v_version, v_saved
  from event where id = p_event_id for update;

  if not found then
    raise exception 'save_plan: unknown event %', p_event_id;
  end if;

  if v_version <> p_base_version then
    -- The refusal, plus the envelope load_plan already builds. Same transaction and same row
    -- lock, so the version it reports is exactly the one that refused this write.
    return jsonb_build_object('ok', false) || load_plan(p_event_id);
  end if;

  -- Before the overwrite, inside the same transaction and under the same lock. A save that
  -- fails takes its archive row down with it, so the history can never hold a version the
  -- database never had.
  perform private.archive_plan_version(p_event_id);

  perform private.write_plan_body(p_event_id, p_plan);

  update event set version = version + 1, updated_at = now(), last_label = p_label
  where id = p_event_id
  returning version, updated_at into v_version, v_saved;

  return jsonb_build_object('ok', true, 'version', v_version, 'savedAt', as_iso(v_saved));
end;
$fn$;

-- A new plan gets the one label nothing else can supply: no edit produced version 1.
create or replace function public.create_plan(p_plan jsonb)
returns jsonb
language plpgsql
as $fn$
declare
  v_id    uuid;
  v_saved timestamptz := now();
begin
  insert into event (name, starts_at, version, updated_at, last_label)
  values (coalesce(p_plan->>'name', 'Sans nom'), (p_plan->>'startISO')::timestamptz, 1, v_saved,
          'Création du planning')
  returning id into v_id;

  perform private.write_plan_body(v_id, p_plan);

  return jsonb_build_object('id', v_id, 'version', 1, 'savedAt', as_iso(v_saved));
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Reading the history, and going back
-- ---------------------------------------------------------------------------

-- Counts rather than sentences, as in list_plans: the French belongs in the front end. They are
-- read from the archived document itself and not from the tables, because the tables hold the
-- current version and the whole point here is to describe a version that is no longer there.
create or replace function public.list_plan_versions(p_event_id uuid)
returns table (
  version int, saved_at text, archived_at text, label text,
  volunteer_count int, shift_count int, assignment_count int
)
language sql
stable
as $fn$
  select pv.version,
         as_iso(pv.saved_at),
         as_iso(pv.archived_at),
         pv.label,
         jsonb_array_length(coalesce(pv.body->'volunteers',  '[]'::jsonb)),
         jsonb_array_length(coalesce(pv.body->'shifts',      '[]'::jsonb)),
         jsonb_array_length(coalesce(pv.body->'assignments', '[]'::jsonb))
  from plan_version pv
  where pv.event_id = p_event_id
  order by pv.version desc;
$fn$;

-- A restore is a save, not a rewind. It writes the old body as a NEW version, so the state it
-- replaces is archived on the way past and a restore of a restore walks back out again. Nothing
-- in this file ever destroys a version except the two retention rules above.
--
-- It takes p_base_version for the same reason save_plan does: the regisseur is looking at a list
-- read at some earlier point, and the other organiser may have saved since.
create or replace function public.restore_plan_version(
  p_event_id uuid, p_version int, p_base_version int)
returns jsonb
language plpgsql
as $fn$
declare
  v_version int;
  v_body    jsonb;
  v_label   text;
begin
  select version into v_version from event where id = p_event_id for update;

  if not found then
    raise exception 'restore_plan_version: unknown event %', p_event_id;
  end if;

  if v_version <> p_base_version then
    return jsonb_build_object('ok', false) || load_plan(p_event_id);
  end if;

  select body, label into v_body, v_label
  from plan_version where event_id = p_event_id and version = p_version;

  if v_body is null then
    raise exception 'restore_plan_version: version % introuvable', p_version;
  end if;

  perform private.archive_plan_version(p_event_id, true);
  perform private.write_plan_body(p_event_id, v_body);

  update event
  set version = version + 1,
      updated_at = now(),
      last_label = 'Retour à la version ' || p_version
                   || coalesce(' (' || nullif(v_label, '') || ')', '')
  where id = p_event_id;

  -- The whole new state, so the caller replaces its working copy with what the database now
  -- holds rather than guessing at it.
  return jsonb_build_object('ok', true) || load_plan(p_event_id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Deleting a plan
-- ---------------------------------------------------------------------------

-- The name is the confirmation, and it is checked HERE rather than in a modal, because a modal
-- is one stray Entree away from gone and this cascades to every volunteer, shift and assignment
-- of the event. Case and surrounding spaces are forgiven; nothing else is.
create or replace function public.delete_plan(p_event_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
as $fn$
declare
  v_name text;
begin
  select name into v_name from event where id = p_event_id for update;

  if not found then
    raise exception 'delete_plan: unknown event %', p_event_id;
  end if;

  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(v_name)) then
    raise exception 'delete_plan: le nom saisi ne correspond pas au planning';
  end if;

  -- plan_version, event_slot, pole, artist and volunteer all cascade from here, and shift,
  -- pole_leader, assignment, buddy_pair and the two join tables cascade from those.
  delete from event where id = p_event_id;

  return jsonb_build_object('ok', true);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. Grants
--
-- FROM PUBLIC IS NOT ENOUGH. Supabase grants EXECUTE on every new function in public to anon,
-- authenticated and service_role through default privileges, and PUBLIC and anon are different
-- grantees, so revoking from one leaves the other. This was found the hard way against the live
-- project on 2026-09-08. Every function below is new or re-created, so every one of them has a
-- fresh default grant to anon sitting on it right now.
--
-- And a grant is not verified until the anonymous key has been pointed at it: see
-- db/checks/anon_reachability.md, which now covers these four as well.
-- ---------------------------------------------------------------------------

revoke all on function public.save_plan(uuid, int, jsonb, text)        from public, anon;
revoke all on function public.list_plan_versions(uuid)                 from public, anon;
revoke all on function public.restore_plan_version(uuid, int, int)     from public, anon;
revoke all on function public.delete_plan(uuid, text)                  from public, anon;
revoke all on function private.archive_plan_version(uuid, boolean)     from public, anon;

grant execute on function public.save_plan(uuid, int, jsonb, text)     to authenticated;
grant execute on function public.list_plan_versions(uuid)              to authenticated;
grant execute on function public.restore_plan_version(uuid, int, int)  to authenticated;
grant execute on function public.delete_plan(uuid, text)               to authenticated;
grant execute on function private.archive_plan_version(uuid, boolean)  to authenticated;
