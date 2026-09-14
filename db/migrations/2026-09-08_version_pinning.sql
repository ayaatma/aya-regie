-- migration-sequence: 6
-- Migration 2026-09-08: a version the régisseur names is kept until they say otherwise.
--
-- Sorts after 2026-09-08_version_history_and_delete.sql, which is what it extends.
--
-- WHY. The history built earlier that day keeps versions on a clock: one every ten minutes of
-- work, the newest fifty. That is the right rule for an afternoon of dragging boxes, and the
-- wrong one for the four or five states of this plan that will actually matter over the six
-- months before the event. "Juste avant l'import du 20 octobre" is worth keeping in March; the
-- autosave from 14h07 is not, and under a rule that only counts, the second one pushes the first
-- one out.
--
-- So a version can be PINNED: given a name by the régisseur, and from then on exempt from every
-- automatic rule. What is automatic is now bounded on both ends, by count and by age, precisely
-- because what matters is no longer at the mercy of that bound.
--
-- Everything here is idempotent except the two functions whose signature changes, which are
-- dropped first and say why.

-- ---------------------------------------------------------------------------
-- 1. The flag
-- ---------------------------------------------------------------------------

-- Named by the régisseur, and therefore never removed by a rule. The only ways out are
-- delete_plan_version, which is a deliberate press, and deleting the whole plan.
alter table plan_version add column if not exists pinned boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Archiving, with pinning and with an age limit
-- ---------------------------------------------------------------------------

-- Two things change from the version-history migration.
--
-- p_label and p_pinned are what a named checkpoint passes. The label then describes what the
-- régisseur meant rather than what they last did, and `on conflict` becomes an update: pressing
-- the button on a version that is already in the history is a request to NAME that version, and
-- answering it with silence would look exactly like a button that does nothing.
--
-- keep_days is the second bound, and it only ever applies to automatic versions. Sixty days of
-- autosaves and every named checkpoint, which is the trade the button exists to make: what is
-- worth keeping in March is what somebody said was worth keeping, not what happened to be the
-- fiftieth most recent thing.
--
-- DROPPED FIRST, and the order matters. Adding defaulted arguments through `create or replace`
-- creates a SECOND function rather than replacing the first, and `archive_plan_version(id, true)`
-- would then match both through their defaults, which Postgres refuses as "function is not
-- unique". save_plan and restore_plan_version call it exactly that way. Both statements belong
-- to the same transaction, so nothing is ever left pointing at a function that is not there.
drop function if exists private.archive_plan_version(uuid, boolean);

create or replace function private.archive_plan_version(
  p_event_id uuid,
  p_force    boolean default false,
  p_label    text    default null,
  p_pinned   boolean default false)
returns void
language plpgsql
set search_path = public, private
as $fn$
declare
  keep_every constant interval := interval '10 minutes';
  keep_max   constant int      := 50;
  keep_days  constant interval := interval '60 days';
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

  insert into plan_version (event_id, version, saved_at, label, body, pinned)
  select p_event_id, v_version, coalesce(v_saved, now()),
         coalesce(p_label, v_label), load_plan(p_event_id)->'plan', p_pinned
  on conflict (event_id, version) do update
    set label = excluded.label, pinned = true, archived_at = now()
    where p_pinned;

  -- Too many, oldest first. Pinned rows are neither deleted nor counted: fifty automatic
  -- versions stay fifty automatic versions however many checkpoints sit among them.
  delete from plan_version old
  where old.event_id = p_event_id
    and not old.pinned
    and old.id not in (
      select keep.id from plan_version keep
      where keep.event_id = p_event_id and not keep.pinned
      order by keep.version desc
      limit keep_max
    );

  -- Too old. Same exemption, same reason.
  delete from plan_version old
  where old.event_id = p_event_id
    and not old.pinned
    and old.archived_at < now() - keep_days;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Naming the version on screen
-- ---------------------------------------------------------------------------

-- What the button does. It keeps the version the database currently holds, under the name the
-- régisseur typed, and changes nothing about the plan: no new version, no bump, nothing to
-- overwrite.
--
-- It still takes p_base_version, and this is not the optimistic lock doing its usual job. There
-- is nothing here to overwrite. It is that naming a version is a statement about the plan you
-- are looking at, and if somebody else has saved since, the version you would be naming is
-- theirs. Refusing is the honest answer, and no work is at risk either way.
create or replace function public.create_plan_checkpoint(
  p_event_id uuid, p_name text, p_base_version int)
returns jsonb
language plpgsql
as $fn$
declare
  v_version int;
begin
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'create_plan_checkpoint: un point de sauvegarde doit porter un nom';
  end if;

  select version into v_version from event where id = p_event_id for update;

  if not found then
    raise exception 'create_plan_checkpoint: unknown event %', p_event_id;
  end if;

  if v_version <> p_base_version then
    return jsonb_build_object('ok', false, 'version', v_version);
  end if;

  perform private.archive_plan_version(p_event_id, true, btrim(p_name), true);

  return jsonb_build_object('ok', true, 'version', v_version);
end;
$fn$;

-- Forgetting one kept version, and only ever on a deliberate press.
--
-- It exists because pinning is otherwise a one-way door: a checkpoint named by mistake, or one
-- that has served its purpose, would sit there for the life of the plan with no way to remove it
-- short of deleting everything. Automatic versions are removable here too, which costs nothing:
-- a rule would have taken them eventually anyway.
create or replace function public.delete_plan_version(p_event_id uuid, p_version int)
returns jsonb
language plpgsql
as $fn$
declare
  v_deleted int;
begin
  delete from plan_version where event_id = p_event_id and version = p_version;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'delete_plan_version: version % introuvable', p_version;
  end if;

  return jsonb_build_object('ok', true);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Reading the history, now saying which versions are named
-- ---------------------------------------------------------------------------

-- DROPPED, NOT REPLACED. `create or replace` cannot change the return type of an existing
-- function, and this one gains a column.
drop function if exists public.list_plan_versions(uuid);

create or replace function public.list_plan_versions(p_event_id uuid)
returns table (
  version int, saved_at text, archived_at text, label text, pinned boolean,
  volunteer_count int, shift_count int, assignment_count int
)
language sql
stable
as $fn$
  select pv.version,
         as_iso(pv.saved_at),
         as_iso(pv.archived_at),
         pv.label,
         pv.pinned,
         jsonb_array_length(coalesce(pv.body->'volunteers',  '[]'::jsonb)),
         jsonb_array_length(coalesce(pv.body->'shifts',      '[]'::jsonb)),
         jsonb_array_length(coalesce(pv.body->'assignments', '[]'::jsonb))
  from plan_version pv
  where pv.event_id = p_event_id
  order by pv.version desc;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Grants
--
-- FROM PUBLIC IS NOT ENOUGH: Supabase's default privileges grant EXECUTE on every new function
-- in public to anon, and PUBLIC and anon are different grantees. Both functions below are new,
-- and list_plan_versions has just been dropped and recreated, so all three carry a fresh grant
-- to anon right now. Verified with `npm run anon-check` in tools/, never by reading this file.
--
-- The old two-argument archive_plan_version is gone rather than revoked: see the drop in
-- section 2 and the reason next to it.
-- ---------------------------------------------------------------------------

revoke all on function private.archive_plan_version(uuid, boolean, text, boolean)    from public, anon;
revoke all on function public.create_plan_checkpoint(uuid, text, int)                from public, anon;
revoke all on function public.delete_plan_version(uuid, int)                         from public, anon;
revoke all on function public.list_plan_versions(uuid)                               from public, anon;

grant execute on function private.archive_plan_version(uuid, boolean, text, boolean) to authenticated;
grant execute on function public.create_plan_checkpoint(uuid, text, int)             to authenticated;
grant execute on function public.delete_plan_version(uuid, int)                      to authenticated;
grant execute on function public.list_plan_versions(uuid)                            to authenticated;
