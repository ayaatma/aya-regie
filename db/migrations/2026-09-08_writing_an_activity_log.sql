-- migration-sequence: 7
-- Migration 2026-09-08: a journal of what happened, so a report can be read rather than guessed at.
--
-- Named to sort after 2026-09-08_version_pinning.sql, which is the rule for two migrations
-- written the same day: they must run in the order they were written, and the directory is read
-- alphabetically. This one is independent of the other three, but the property is worth keeping.
--
-- WHY. The person running this on the night is not the developer. When something goes wrong they
-- will say so afterwards, in a sentence, from memory, and by then the browser that saw it is
-- closed. What is needed is not a stack trace at the moment of the crash, it is the twenty things
-- that happened before it, in order, readable months later by somebody who was not there.
--
-- So: every action the tool takes, every refused save, every screen that failed, written in the
-- same French the tool already speaks. Kept in the database rather than the browser, because the
-- browser that saw the problem belongs to somebody else.
--
-- WHAT IS NOT IN IT, and this is a rule rather than an oversight: no phone number, no address,
-- no mail address of a volunteer. A line names people the way the interface already does
-- ("déplacement de Marie Perrin"), because that is what makes it readable, and stops there.
-- Every organiser who can read this table can already read the whole planning, so nothing here
-- widens what anybody can see. Contact details would be the exception, and they are excluded.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

create table if not exists app_log (
  id          bigint generated always as identity primary key,
  -- Nullable: the picker, the login and any failure before a plan is open have no event yet, and
  -- those are exactly the moments worth keeping.
  event_id    uuid references event(id) on delete cascade,
  -- When the browser recorded it. This is the one to read, and the one to distrust: it is a
  -- clock on somebody else's machine.
  at          timestamptz not null,
  -- When the row reached Postgres. Batched, so it lags by a few seconds, and it is what settles
  -- an argument when a browser's clock is wrong.
  received_at timestamptz not null default now(),
  level       text not null check (level in ('info', 'warn', 'error')),
  -- A coarse family, for filtering: edition, enregistrement, import, solveur, ecran, session.
  kind        text not null,
  -- The sentence, in French, usually the same one the interface said at the time.
  message     text not null,
  -- Anything structured worth keeping: counts, a version number, an error name. Small on
  -- purpose; the browser truncates it before sending.
  detail      jsonb,
  -- Who, as their own browser knows them. See created_by for the version nobody can type.
  actor       text,
  -- Who, as Postgres knows them. The one that cannot be forged, and the reason actor is allowed
  -- to be a convenience.
  created_by  uuid default auth.uid(),
  -- One value per browser tab, so two organisers working at once can be told apart in a listing
  -- that interleaves them.
  session     text not null
);

create index if not exists app_log_event_idx on app_log (event_id, id desc);
create index if not exists app_log_at_idx on app_log (received_at);

alter table app_log enable row level security;

-- Organisers write and read; anonymous clients get no policy at all, which under row level
-- security means no row, in either direction.
do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_log' and policyname = 'app_log_organiser'
  ) then
    create policy app_log_organiser on app_log for all to authenticated using (true) with check (true);
  end if;
end
$policies$;

-- ---------------------------------------------------------------------------
-- 2. Writing, in batches, with the pruning attached
-- ---------------------------------------------------------------------------

-- One call per batch, never one per line: an afternoon of dragging boxes is hundreds of entries
-- and a round trip each would be a tax on the very thing being measured. The browser buffers for
-- a few seconds and sends an array.
--
-- The two limits are the same shape as the ones on plan_version, and for the same reason: a log
-- nobody bounds is a log that eventually costs more than the thing it describes.
--
--   keep_rows: the newest 5000 entries per plan. About a week of heavy use.
--   keep_days: nothing older than 90 days, whatever the count. The event is in March 2027 and
--   the form goes out in October 2026, so this keeps every busy period intact while it matters
--   and forgets it a season later.
--
-- Pruning only ever touches the partition just written to, so it costs an index lookup rather
-- than a scan of the table.
create or replace function public.write_log(p_event_id uuid, p_entries jsonb)
returns int
language plpgsql
as $fn$
declare
  keep_rows constant int      := 5000;
  keep_days constant interval := interval '90 days';
  v_written int;
begin
  insert into app_log (event_id, at, level, kind, message, detail, actor, session)
  select p_event_id,
         coalesce((x->>'at')::timestamptz, now()),
         coalesce(nullif(x->>'level', ''), 'info'),
         coalesce(nullif(x->>'kind', ''), 'divers'),
         coalesce(nullif(x->>'message', ''), '(sans message)'),
         x->'detail',
         nullif(x->>'actor', ''),
         coalesce(nullif(x->>'session', ''), 'inconnue')
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as t(x);

  get diagnostics v_written = row_count;

  delete from app_log old
  where old.event_id is not distinct from p_event_id
    and old.id < (
      select min(newest.id)
      from (
        select l.id from app_log l
        where l.event_id is not distinct from p_event_id
        order by l.id desc
        limit keep_rows
      ) newest
    );

  delete from app_log old
  where old.event_id is not distinct from p_event_id
    and old.received_at < now() - keep_days;

  return v_written;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Reading it back
-- ---------------------------------------------------------------------------

-- Newest first, because the question is always "what just happened". p_before pages backwards
-- through the ids, which are the only ordering that cannot be argued with: two entries recorded
-- in the same millisecond on a clock that may itself be wrong still arrive in order here.
create or replace function public.read_log(
  p_event_id uuid, p_limit int default 200, p_before bigint default null)
returns table (
  id bigint, at text, received_at text, level text, kind text,
  message text, detail jsonb, actor text, session text
)
language sql
stable
as $fn$
  select l.id, as_iso(l.at), as_iso(l.received_at), l.level, l.kind,
         l.message, l.detail, l.actor, l.session
  from app_log l
  where l.event_id is not distinct from p_event_id
    and (p_before is null or l.id < p_before)
  order by l.id desc
  limit least(coalesce(p_limit, 200), 2000);
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Grants
--
-- FROM PUBLIC IS NOT ENOUGH: Supabase's default privileges grant EXECUTE on every new function
-- in public to anon, and PUBLIC and anon are different grantees. Verified with
-- `npm run anon-check` in tools/, never by reading this file.
--
-- write_log in particular must never answer the anonymous key: it is the one function here that
-- writes, and an open one would let anybody fill the table until the pruning is all it does.
-- ---------------------------------------------------------------------------

revoke all on function public.write_log(uuid, jsonb)          from public, anon;
revoke all on function public.read_log(uuid, int, bigint)     from public, anon;

grant execute on function public.write_log(uuid, jsonb)       to authenticated;
grant execute on function public.read_log(uuid, int, bigint)  to authenticated;
