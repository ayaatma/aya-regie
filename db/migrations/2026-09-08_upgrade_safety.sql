-- migration-sequence: 8
-- Migration 2026-09-08: making the NEXT change safe, whatever it turns out to be.
--
-- ORDER. This one runs after 2026-09-08_writing_an_activity_log.sql, and its filename does not
-- say so, because "upgrade" sorts before "writing". That is exactly the problem it fixes: from
-- here on the order of migrations is the `sequence` column of the schema_migration table below,
-- not the alphabet. Filenames are dated for humans; the ledger is what a machine reads.
--
-- Three unrelated guards, in one file because they are one decision: the tool is about to grow
-- new fields (a dietary requirement, a setup and teardown period, a timeline), and each of those
-- is a moment where data can go missing without anybody noticing.
--
-- 1. A STALE BROWSER TAB MUST NOT BE ABLE TO WRITE. This is the one that would have cost real
--    data. A save rewrites the plan whole, from the JSON the browser sends, and the browser
--    rebuilds that JSON field by field from what its own build knows about (normalise.ts, and it
--    is written that way on purpose). So an old tab, left open across a deploy, silently strips
--    every field it has never heard of and writes the result over everybody's. Add a column,
--    deploy, and the régisseur's yesterday-tab wipes it for a hundred and twenty people without
--    a word. The plan format is a number the browser states on every write; the server refuses
--    anything older than it requires, and the tool says "rechargez la page" instead.
--
-- 2. A LEDGER OF WHAT HAS BEEN APPLIED. "Is that one in?" has already been answered twice by
--    pointing the anonymous key at the API and reading which functions exist, which works by
--    accident rather than by design.
--
-- 3. requested_hours STOPS BEING A DATABASE CONSTRAINT. It is a form answer, and the schema says
--    in its own header that no planning rule is enforced as a constraint, for the reason that a
--    constraint turns a questionable value into an autosave the régisseur cannot clear. The day
--    the form offers 2 h or 10 h, `check (requested_hours in (4, 6, 8))` stops being a safeguard
--    and becomes a locked door.

-- ---------------------------------------------------------------------------
-- 1. The ledger
-- ---------------------------------------------------------------------------

create table if not exists schema_migration (
  -- The real order. Alphabetical filenames were never going to hold: two migrations written the
  -- same day sort by their subject, which has nothing to do with the order they must run in.
  sequence   int primary key,
  filename   text not null unique,
  applied_at timestamptz not null default now(),
  -- Free text, so a line can say what it did without anybody opening the file.
  note       text
);

-- The five that came before, backfilled in the order they were actually run on the live project
-- on 2026-09-08. Recorded rather than inferred: after this, nothing has to be inferred again.
--
-- EXCEPT THAT LINE 3 WAS INFERRED, AND IT WAS WRONG. `preference_and_plural_refusals` had been
-- written, reviewed and mirrored into db/schema.sql, and never run. Backfilling a ledger from
-- memory writes the belief down, not the fact, and from then on the ledger is what everybody
-- reads. It corrects itself at the end of that file, and `npm run db-check` in tools/ is the
-- thing that asks the database instead of asking the ledger.
insert into schema_migration (sequence, filename, note) values
  (1, 'db/schema.sql',                                    'Schéma initial, appliqué en entier'),
  (2, '2026-09-08_load_plan_envelope.sql',                'load_plan renvoie {version, savedAt, plan}'),
  (3, '2026-09-08_preference_and_plural_refusals.sql',    'La demi-journée devient une préférence'),
  (4, '2026-09-08_revoke_anon_from_plan_rpcs.sql',        'Portes anonymes refermées'),
  (5, '2026-09-08_version_history_and_delete.sql',        'Historique des versions, suppression'),
  (6, '2026-09-08_version_pinning.sql',                   'Points de sauvegarde nommés'),
  (7, '2026-09-08_writing_an_activity_log.sql',           'Journal'),
  (8, '2026-09-08_upgrade_safety.sql',                    'Format de plan, registre, contrainte horaire')
on conflict (sequence) do nothing;

alter table schema_migration enable row level security;

do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'schema_migration'
      and policyname = 'schema_migration_organiser'
  ) then
    -- Readable by an organiser so a support question can be answered from the tool. Written only
    -- by whoever is pasting SQL into the editor, which is nobody's browser.
    create policy schema_migration_organiser on schema_migration
      for select to authenticated using (true);
  end if;
end
$policies$;

-- ---------------------------------------------------------------------------
-- 2. The plan format
-- ---------------------------------------------------------------------------

-- One row per named number. A table rather than a constant inside a function, so the front end
-- can be told what is required rather than only that it was refused.
create table if not exists app_setting (
  name   text primary key,
  number int not null,
  note   text
);

insert into app_setting (name, number, note) values
  ('min_plan_format', 1,
   'Le format de document que le navigateur doit déclarer pour avoir le droit d''écrire. ' ||
   'À incrémenter dans la MÊME migration que tout ajout de champ au Plan.')
on conflict (name) do nothing;

alter table app_setting enable row level security;

do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_setting'
      and policyname = 'app_setting_organiser'
  ) then
    create policy app_setting_organiser on app_setting for select to authenticated using (true);
  end if;
end
$policies$;

-- The format the contents of this event were last written with. Not the same number as
-- min_plan_format: this one is a fact about the rows, that one is a requirement about writers.
alter table event add column if not exists plan_format int not null default 1;

-- And the format an archived body was written with, because a restore feeds it back into
-- write_plan_body, which is a writer like any other.
alter table plan_version add column if not exists format int not null default 1;

-- ---------------------------------------------------------------------------
-- 3. The three functions that write a plan now state their format
-- ---------------------------------------------------------------------------

-- Archiving carries the format across, so an old body is still recognisable as old years later.
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
  v_format   int;
  v_last     timestamptz;
begin
  select version, updated_at, last_label, plan_format
    into v_version, v_saved, v_label, v_format
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

  insert into plan_version (event_id, version, saved_at, label, body, pinned, format)
  select p_event_id, v_version, coalesce(v_saved, now()),
         coalesce(p_label, v_label), load_plan(p_event_id)->'plan', p_pinned, v_format
  on conflict (event_id, version) do update
    set label = excluded.label, pinned = true, archived_at = now()
    where p_pinned;

  delete from plan_version old
  where old.event_id = p_event_id
    and not old.pinned
    and old.id not in (
      select keep.id from plan_version keep
      where keep.event_id = p_event_id and not keep.pinned
      order by keep.version desc
      limit keep_max
    );

  delete from plan_version old
  where old.event_id = p_event_id
    and not old.pinned
    and old.archived_at < now() - keep_days;
end;
$fn$;

-- DROPPED, NOT REPLACED, for the third time in this directory and for the same reason: adding a
-- defaulted argument through `create or replace` creates a SECOND function, and a four-argument
-- call would then match both through defaults, which Postgres refuses as "function is not
-- unique". Dropping first also means an old front end gets a clean "function not found" rather
-- than reaching the version with no format check.
drop function if exists public.save_plan(uuid, int, jsonb, text);

create or replace function public.save_plan(
  p_event_id uuid, p_base_version int, p_plan jsonb, p_label text default null,
  p_format int default 0)
returns jsonb
language plpgsql
as $fn$
declare
  v_version int;
  v_saved   timestamptz;
  v_min     int;
begin
  -- BEFORE THE LOCK AND BEFORE THE VERSION CHECK. An outdated writer is not in a conflict with
  -- anybody, it is holding a document that no longer describes this plan, and the only useful
  -- answer is "reload". Default 0 means a caller that says nothing is treated as outdated, which
  -- is what an unchanged old build is.
  select number into v_min from app_setting where name = 'min_plan_format';
  if coalesce(p_format, 0) < coalesce(v_min, 1) then
    return jsonb_build_object('ok', false, 'reason', 'format', 'required', coalesce(v_min, 1));
  end if;

  -- The row lock is the serialisation point: two organisers saving at the same instant queue
  -- here, and the second one reads the first one's version rather than racing past it.
  select version, updated_at into v_version, v_saved
  from event where id = p_event_id for update;

  if not found then
    raise exception 'save_plan: unknown event %', p_event_id;
  end if;

  if v_version <> p_base_version then
    return jsonb_build_object('ok', false, 'reason', 'conflit') || load_plan(p_event_id);
  end if;

  perform private.archive_plan_version(p_event_id);
  perform private.write_plan_body(p_event_id, p_plan);

  update event
  set version = version + 1, updated_at = now(), last_label = p_label, plan_format = p_format
  where id = p_event_id
  returning version, updated_at into v_version, v_saved;

  return jsonb_build_object('ok', true, 'version', v_version, 'savedAt', as_iso(v_saved));
end;
$fn$;

drop function if exists public.create_plan(jsonb);

create or replace function public.create_plan(p_plan jsonb, p_format int default 0)
returns jsonb
language plpgsql
as $fn$
declare
  v_id    uuid;
  v_saved timestamptz := now();
  v_min   int;
begin
  select number into v_min from app_setting where name = 'min_plan_format';
  if coalesce(p_format, 0) < coalesce(v_min, 1) then
    raise exception 'create_plan: format de document périmé (% < %), rechargez la page',
      coalesce(p_format, 0), coalesce(v_min, 1);
  end if;

  insert into event (name, starts_at, version, updated_at, last_label, plan_format)
  values (coalesce(p_plan->>'name', 'Sans nom'), (p_plan->>'startISO')::timestamptz, 1, v_saved,
          'Création du planning', p_format)
  returning id into v_id;

  perform private.write_plan_body(v_id, p_plan);

  return jsonb_build_object('id', v_id, 'version', 1, 'savedAt', as_iso(v_saved));
end;
$fn$;

-- A restore writes an archived body back through write_plan_body, so the body's own format is
-- what matters here, not the caller's. A body older than what the tool now requires is refused
-- loudly: reviving it needs a data migration, which is a decision, not something to do silently
-- on a régisseur's click.
create or replace function public.restore_plan_version(
  p_event_id uuid, p_version int, p_base_version int)
returns jsonb
language plpgsql
as $fn$
declare
  v_version int;
  v_body    jsonb;
  v_label   text;
  v_format  int;
  v_min     int;
begin
  select version into v_version from event where id = p_event_id for update;

  if not found then
    raise exception 'restore_plan_version: unknown event %', p_event_id;
  end if;

  if v_version <> p_base_version then
    return jsonb_build_object('ok', false) || load_plan(p_event_id);
  end if;

  select body, label, format into v_body, v_label, v_format
  from plan_version where event_id = p_event_id and version = p_version;

  if v_body is null then
    raise exception 'restore_plan_version: version % introuvable', p_version;
  end if;

  select number into v_min from app_setting where name = 'min_plan_format';
  if coalesce(v_format, 1) < coalesce(v_min, 1) then
    raise exception
      'restore_plan_version: la version % date d''un format de document plus ancien (% < %). '
      'Elle ne peut pas être restaurée telle quelle.',
      p_version, coalesce(v_format, 1), coalesce(v_min, 1);
  end if;

  perform private.archive_plan_version(p_event_id, true);
  perform private.write_plan_body(p_event_id, v_body);

  update event
  set version = version + 1,
      updated_at = now(),
      plan_format = coalesce(v_format, 1),
      last_label = 'Retour à la version ' || p_version
                   || coalesce(' (' || nullif(v_label, '') || ')', '')
  where id = p_event_id;

  return jsonb_build_object('ok', true) || load_plan(p_event_id);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. The form answer that had become a locked door
-- ---------------------------------------------------------------------------

-- 4, 6 and 8 are what the form offers TODAY. The schema's own header says no planning rule is a
-- database constraint, for the reason that a constraint turns a questionable value into a failed
-- autosave the régisseur cannot clear. A positive number is a sanity check; the list was a rule.
alter table volunteer drop constraint if exists volunteer_requested_hours_check;
alter table volunteer add constraint volunteer_requested_hours_check check (requested_hours > 0);

-- ---------------------------------------------------------------------------
-- 5. Grants
--
-- FROM PUBLIC IS NOT ENOUGH: every function re-created above carries a fresh default grant to
-- anon. Verified with `npm run anon-check` in tools/, never by reading this file.
-- ---------------------------------------------------------------------------

revoke all on function public.save_plan(uuid, int, jsonb, text, int)  from public, anon;
revoke all on function public.create_plan(jsonb, int)                 from public, anon;
revoke all on function public.restore_plan_version(uuid, int, int)    from public, anon;
revoke all on function private.archive_plan_version(uuid, boolean, text, boolean) from public, anon;

grant execute on function public.save_plan(uuid, int, jsonb, text, int) to authenticated;
grant execute on function public.create_plan(jsonb, int)                to authenticated;
grant execute on function public.restore_plan_version(uuid, int, int)   to authenticated;
grant execute on function private.archive_plan_version(uuid, boolean, text, boolean) to authenticated;

grant select on table schema_migration to authenticated;
grant select on table app_setting      to authenticated;
