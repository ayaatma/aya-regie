-- migration-sequence: 3
-- Migration 2026-09-08: the event half becomes a preference, and pole refusals become a list.
--
-- Applied after db/schema.sql had already been run on the live project, WHICH ALREADY HOLDS A
-- REAL PLAN. The window where the schema could simply be rewritten closed the previous evening,
-- so this file is what an existing database needs and schema.sql carries the same end state for
-- a fresh install. Everything here is idempotent: re-running it is harmless.
--
-- Why, in two parts.
--
-- 1. The form asks "Qu'est ce que tu préfères ?", offering "Travailler pendant le loto",
--    "Travailler pendant les concerts" and "Peux importe". The engine read that answer as a hard
--    availability: 'evening' forbade any placement before the boundary, 'afternoon' any past the
--    overflow limit. That turned a preference into a veto and refused placements the volunteer
--    would have accepted. It is scored and reported now, never enforced, so the column is
--    renamed to say what it is. No value changes: the three answers still mean the same thing.
--
-- 2. The refusal question uses CHECKBOXES. A volunteer can rule out several poles, and the
--    single refused_pole_id kept exactly one of them. That is a hard constraint, so a dropped
--    refusal is somebody standing in a pole they wrote down that they would not work. The
--    column becomes a join table, modelled on volunteer_artist, which is the same shape.
--
-- The two boundary defaults move as well: the loto hands over to the concerts at 20h rather
-- than 18h, and the accepted overflow ends at 22h rather than midnight. Existing rows keep the
-- values the regisseur set; only the default for a new event changes.

-- ---------------------------------------------------------------------------
-- 1. The preference
-- ---------------------------------------------------------------------------

do $rename$
begin
  if exists (select 1 from pg_type where typname = 'event_half') then
    alter type event_half rename to half_preference;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'volunteer' and column_name = 'half'
  ) then
    alter table volunteer rename column half to half_preference;
  end if;
end
$rename$;

comment on type half_preference is
  'What the volunteer answered to "Qu''est ce que tu préfères ?". Scored by the solver and '
  'reported to the regisseur; it never makes a placement illegal. The hard answer about time is '
  'volunteer.refused_slot_key.';

comment on column volunteer.half_preference is
  'A preference, never a rule. Renamed from "half" on 2026-09-08 so that nothing reads it as one.';

alter table event alter column evening_starts_at        set default 8;   -- 20:00
alter table event alter column afternoon_overflow_until set default 10;  -- 22:00

-- ---------------------------------------------------------------------------
-- 2. Refusals, as a list
-- ---------------------------------------------------------------------------

-- Poles a volunteer ruled out. A set of references per volunteer, exactly like
-- volunteer_artist, because the form asks the question with checkboxes. Refusing a pole refuses
-- its whole subtree, which is why only root poles are ever named here.
create table if not exists volunteer_refused_pole (
  volunteer_id uuid not null references volunteer(id) on delete cascade,
  pole_id      uuid not null references pole(id)      on delete cascade,
  primary key (volunteer_id, pole_id)
);

alter table volunteer_refused_pole enable row level security;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'volunteer_refused_pole'
      and policyname = 'volunteer_refused_pole_organiser'
  ) then
    create policy volunteer_refused_pole_organiser on volunteer_refused_pole
      for all to authenticated using (true) with check (true);
  end if;
end
$policy$;

-- Carry the existing refusals across before dropping the column. Somebody wrote each of these
-- down; none of them may be lost in the move.
do $carry$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'volunteer' and column_name = 'refused_pole_id'
  ) then
    insert into volunteer_refused_pole (volunteer_id, pole_id)
    select v.id, v.refused_pole_id
    from volunteer v
    where v.refused_pole_id is not null
    on conflict do nothing;

    alter table volunteer drop column refused_pole_id;
  end if;
end
$carry$;

-- ---------------------------------------------------------------------------
-- 3. Both directions of the round trip
-- ---------------------------------------------------------------------------
--
-- Lifted verbatim from db/schema.sql, so the two can never describe different databases. Both
-- are create or replace: re-running this file is harmless.

create or replace function public.load_plan(p_event_id uuid)
returns jsonb
language sql
stable
as $fn$
  with recursive paths as (
    select p.id, p.name::text as path
    from pole p
    where p.event_id = p_event_id and p.parent_id is null
    union all
    select c.id, (paths.path || ' / ' || c.name)::text
    from pole c
    join paths on paths.id = c.parent_id
  ),
  slots as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',    s.slot_key,
             'label', s.label,
             'start', s.start_hours,
             'end',   s.end_hours) order by s.sort_order, s.slot_key), '[]'::jsonb) as j
    from event_slot s where s.event_id = p_event_id
  ),
  poles as (
    select coalesce(jsonb_agg(
             jsonb_build_object(
               'key',               p.key,
               'name',              p.name,
               'parentKey',         parent.key,
               'path',              paths.path,
               'allowAllDebutants', p.allow_all_debutants,
               'minExperienced',    p.min_experienced,
               'locked',            p.locked,
               'defaultHeadcount',  p.default_headcount)
             -- Optional in the engine's type, so absent rather than null when unset.
             || case when p.colour is null then '{}'::jsonb
                     else jsonb_build_object('colour', p.colour) end
             || case when p.default_shift_hours is null then '{}'::jsonb
                     else jsonb_build_object('defaultShiftHours', p.default_shift_hours) end
             order by p.sort_order, p.key), '[]'::jsonb) as j
    from pole p
    join paths on paths.id = p.id
    left join pole parent on parent.id = p.parent_id
    where p.event_id = p_event_id
  ),
  shifts as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key',       s.key,
             'poleKey',   p.key,
             'start',     s.start_hours,
             'end',       s.end_hours,
             'headcount', s.headcount) order by s.sort_order, s.key), '[]'::jsonb) as j
    from shift s join pole p on p.id = s.pole_id
    where p.event_id = p_event_id
  ),
  artists as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key',   a.key,
             'name',  a.name,
             'start', a.start_hours,
             'end',   a.end_hours) order by a.sort_order, a.key), '[]'::jsonb) as j
    from artist a where a.event_id = p_event_id
  ),
  leaders as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key',      l.key,
             'poleKey',  p.key,
             'fullName', l.full_name,
             'phone',    l.phone,
             'email',    l.email,
             'note',     l.note,
             'start',    l.start_hours,
             'end',      l.end_hours) order by l.sort_order, l.key), '[]'::jsonb) as j
    from pole_leader l join pole p on p.id = l.pole_id
    where p.event_id = p_event_id
  ),
  volunteers as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key',            v.key,
             'firstName',      v.first_name,
             'lastName',       v.last_name,
             'email',          v.email,
             'phone',          v.phone,
             'accessCode',     v.access_code,
             'requestedHours',  v.requested_hours,
             'halfPreference',  v.half_preference,
             'refusedSlot',     v.refused_slot_key,
             -- A list since 2026-09-08, ordered by the pole's own sort order so the same
             -- database always produces the same JSON. That is what makes the round trip
             -- checkable at all.
             'refusedPoleKeys', coalesce((
                                  select jsonb_agg(rp.key order by rp.sort_order, rp.key)
                                  from volunteer_refused_pole vrp
                                  join pole rp on rp.id = vrp.pole_id
                                  where vrp.volunteer_id = v.id), '[]'::jsonb),
             'choice1PoleKey',  c1.key,
             'choice1Level',    v.choice1_level,
             'choice2PoleKey',  c2.key,
             'choice2Level',    v.choice2_level,
             'artistKeys',      coalesce((
                                  select jsonb_agg(a.key order by a.sort_order, a.key)
                                  from volunteer_artist va
                                  join artist a on a.id = va.artist_id
                                  where va.volunteer_id = v.id), '[]'::jsonb),
             'buddyRawNames',   to_jsonb(v.buddy_raw_names))
           order by v.sort_order, v.key), '[]'::jsonb) as j
    from volunteer v
    left join pole c1 on c1.id = v.choice1_pole_id
    left join pole c2 on c2.id = v.choice2_pole_id
    where v.event_id = p_event_id
  ),
  buddies as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'fromKey', f.key,
             'toKey',   t.key) order by b.sort_order, f.key, t.key), '[]'::jsonb) as j
    from buddy_pair b
    join volunteer f on f.id = b.from_volunteer_id
    join volunteer t on t.id = b.to_volunteer_id
    where f.event_id = p_event_id
  ),
  assignments as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'volunteerKey', v.key,
             'shiftKey',     s.key,
             'locked',       a.locked,
             'source',       a.source) order by a.sort_order, v.key, s.key), '[]'::jsonb) as j
    from assignment a
    join volunteer v on v.id = a.volunteer_id
    join shift s     on s.id = a.shift_id
    where v.event_id = p_event_id
  ),
  reserve as (
    select coalesce(jsonb_agg(v.key order by v.sort_order, v.key), '[]'::jsonb) as j
    from volunteer v where v.event_id = p_event_id and v.on_reserve
  )
  -- The envelope, not the bare plan: `PlanStore.load` needs the plan and the version it was read
  -- at, and reading them in two calls would leave a window where the version moves under the
  -- working copy. A stale version there is either a save refused for nothing or, worse, a save
  -- accepted over somebody else's, which is the whole thing the lock exists to prevent.
  select jsonb_build_object(
    'version', e.version,
    'savedAt', as_iso(e.updated_at),
    'plan', jsonb_build_object(
      'name',        e.name,
      'startISO',    as_iso(e.starts_at),
      'lengthHours', e.length_hours,
      'rules', jsonb_build_object(
        'eveningStartsAt',        e.evening_starts_at,
        'maxConsecutiveHours',    e.max_consecutive_hours,
        'maxBlocks',              e.max_blocks,
        'minBreakHours',          e.min_break_hours,
        'minHoursPerPerson',      e.min_hours_per_person,
        'afternoonOverflowUntil', e.afternoon_overflow_until),
      'slots',       slots.j,
      'poles',       poles.j,
      'shifts',      shifts.j,
      'artists',     artists.j,
      'leaders',     leaders.j,
      'volunteers',  volunteers.j,
      'buddies',     buddies.j,
      'assignments', assignments.j,
      'reserve',     reserve.j))
  from event e, slots, poles, shifts, artists, leaders, volunteers, buddies, assignments, reserve
  where e.id = p_event_id;
$fn$;

create or replace function private.write_plan_body(p_event_id uuid, p_plan jsonb)
returns void
language plpgsql
set search_path = public, private
as $fn$
declare
  n_expected int;
  n_written  int;
begin
  -- Out with the old. volunteer cascades to its assignments, buddies and artist links; pole
  -- cascades to its shifts and leaders.
  delete from volunteer  where event_id = p_event_id;
  delete from pole       where event_id = p_event_id;
  delete from artist     where event_id = p_event_id;
  delete from event_slot where event_id = p_event_id;

  update event set
    name                     = p_plan->>'name',
    starts_at                = (p_plan->>'startISO')::timestamptz,
    length_hours             = (p_plan->>'lengthHours')::numeric,
    evening_starts_at        = (p_plan#>>'{rules,eveningStartsAt}')::numeric,
    max_consecutive_hours    = (p_plan#>>'{rules,maxConsecutiveHours}')::numeric,
    max_blocks               = (p_plan#>>'{rules,maxBlocks}')::int,
    min_break_hours          = (p_plan#>>'{rules,minBreakHours}')::numeric,
    min_hours_per_person     = (p_plan#>>'{rules,minHoursPerPerson}')::numeric,
    afternoon_overflow_until = (p_plan#>>'{rules,afternoonOverflowUntil}')::numeric
  where id = p_event_id;

  insert into event_slot (event_id, slot_key, label, start_hours, end_hours, sort_order)
  select p_event_id, x->>'id', x->>'label',
         (x->>'start')::numeric, (x->>'end')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'slots', '[]'::jsonb)) with ordinality as t(x, ord);

  -- Poles land parentless first, then the tree is tied together by key: a plan is free to list a
  -- sub-pole before its parent.
  insert into pole (event_id, key, name, colour, sort_order, allow_all_debutants,
                    min_experienced, locked, default_headcount, default_shift_hours)
  select p_event_id, x->>'key', x->>'name', x->>'colour', (ord - 1)::int,
         coalesce((x->>'allowAllDebutants')::boolean, false),
         coalesce((x->>'minExperienced')::int, 0),
         coalesce((x->>'locked')::boolean, false),
         coalesce((x->>'defaultHeadcount')::int, 1),
         (x->>'defaultShiftHours')::numeric
  from jsonb_array_elements(coalesce(p_plan->'poles', '[]'::jsonb)) with ordinality as t(x, ord);

  update pole child set parent_id = parent.id
  from jsonb_array_elements(coalesce(p_plan->'poles', '[]'::jsonb)) as t(x)
  join pole parent on parent.event_id = p_event_id and parent.key = x->>'parentKey'
  where child.event_id = p_event_id and child.key = x->>'key';

  insert into artist (event_id, key, name, start_hours, end_hours, sort_order)
  select p_event_id, x->>'key', x->>'name',
         (x->>'start')::numeric, (x->>'end')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'artists', '[]'::jsonb)) with ordinality as t(x, ord);

  insert into shift (pole_id, key, start_hours, end_hours, headcount, sort_order)
  select p.id, x->>'key', (x->>'start')::numeric, (x->>'end')::numeric,
         (x->>'headcount')::int, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'shifts', '[]'::jsonb)) with ordinality as t(x, ord)
  join pole p on p.event_id = p_event_id and p.key = x->>'poleKey';

  insert into pole_leader (pole_id, key, full_name, phone, email, note,
                           start_hours, end_hours, sort_order)
  select p.id, x->>'key', x->>'fullName',
         coalesce(x->>'phone', ''), coalesce(x->>'email', ''), coalesce(x->>'note', ''),
         (x->>'start')::numeric, (x->>'end')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'leaders', '[]'::jsonb)) with ordinality as t(x, ord)
  join pole p on p.event_id = p_event_id and p.key = x->>'poleKey';

  insert into volunteer (event_id, key, first_name, last_name, email, phone, access_code,
                         requested_hours, half_preference, refused_slot_key,
                         choice1_pole_id, choice1_level, choice2_pole_id, choice2_level,
                         buddy_raw_names, on_reserve, sort_order)
  select p_event_id, x->>'key', x->>'firstName', x->>'lastName',
         coalesce(x->>'email', ''), coalesce(x->>'phone', ''), x->>'accessCode',
         (x->>'requestedHours')::int,
         (x->>'halfPreference')::half_preference, x->>'refusedSlot',
         c1.id, (x->>'choice1Level')::skill_level,
         c2.id, (x->>'choice2Level')::skill_level,
         coalesce((select array_agg(raw #>> '{}')
                   from jsonb_array_elements(coalesce(x->'buddyRawNames', '[]'::jsonb))
                        as bn(raw)),
                  '{}'::text[]),
         held.k is not null,
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'volunteers', '[]'::jsonb))
       with ordinality as t(x, ord)
  left join pole c1 on c1.event_id = p_event_id and c1.key = x->>'choice1PoleKey'
  left join pole c2 on c2.event_id = p_event_id and c2.key = x->>'choice2PoleKey'
  left join (select entry #>> '{}' as k
             from jsonb_array_elements(coalesce(p_plan->'reserve', '[]'::jsonb))
                  as rv(entry)) held
         on held.k = x->>'key';

  -- These three are sets, not lists: a plan naming the same refusal, artist or buddy pair twice
  -- loses the repeat, which carries no information either way.
  insert into volunteer_refused_pole (volunteer_id, pole_id)
  select v.id, p.id
  from jsonb_array_elements(coalesce(p_plan->'volunteers', '[]'::jsonb)) as t(x)
  join volunteer v on v.event_id = p_event_id and v.key = x->>'key'
  cross join lateral jsonb_array_elements_text(coalesce(x->'refusedPoleKeys', '[]'::jsonb))
             as rk(pole_key)
  join pole p on p.event_id = p_event_id and p.key = rk.pole_key
  on conflict do nothing;

  insert into volunteer_artist (volunteer_id, artist_id)
  select v.id, a.id
  from jsonb_array_elements(coalesce(p_plan->'volunteers', '[]'::jsonb)) as t(x)
  join volunteer v on v.event_id = p_event_id and v.key = x->>'key'
  cross join lateral jsonb_array_elements(coalesce(x->'artistKeys', '[]'::jsonb)) as ak(k)
  join artist a on a.event_id = p_event_id and a.key = k #>> '{}'
  on conflict do nothing;

  insert into buddy_pair (from_volunteer_id, to_volunteer_id, sort_order)
  select f.id, t.id, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'buddies', '[]'::jsonb)) with ordinality as e(x, ord)
  join volunteer f on f.event_id = p_event_id and f.key = x->>'fromKey'
  join volunteer t on t.event_id = p_event_id and t.key = x->>'toKey'
  on conflict do nothing;

  insert into assignment (volunteer_id, shift_id, locked, source, sort_order)
  select v.id, s.id,
         coalesce((x->>'locked')::boolean, false),
         coalesce((x->>'source')::assignment_source, 'solver'),
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'assignments', '[]'::jsonb))
       with ordinality as e(x, ord)
  join volunteer v on v.event_id = p_event_id and v.key = x->>'volunteerKey'
  join pole p      on p.event_id = p_event_id
  join shift s     on s.pole_id = p.id and s.key = x->>'shiftKey';

  -- Every insert above resolves its references by key through a join, so a reference to a key
  -- the plan does not contain would drop the row without a word. This tool must never silently
  -- drop a volunteer, so each count is checked instead.
  n_expected := jsonb_array_length(coalesce(p_plan->'shifts', '[]'::jsonb));
  select count(*) into n_written
  from shift s join pole p on p.id = s.pole_id where p.event_id = p_event_id;
  if n_written <> n_expected then
    raise exception 'save_plan: % shifts in, % written: one names an unknown pole',
      n_expected, n_written;
  end if;

  n_expected := jsonb_array_length(coalesce(p_plan->'volunteers', '[]'::jsonb));
  select count(*) into n_written from volunteer where event_id = p_event_id;
  if n_written <> n_expected then
    raise exception 'save_plan: % volunteers in, % written', n_expected, n_written;
  end if;

  n_expected := jsonb_array_length(coalesce(p_plan->'assignments', '[]'::jsonb));
  select count(*) into n_written
  from assignment a join volunteer v on v.id = a.volunteer_id where v.event_id = p_event_id;
  if n_written <> n_expected then
    raise exception
      'save_plan: % assignments in, % written: one names an unknown volunteer or shift',
      n_expected, n_written;
  end if;

  n_expected := jsonb_array_length(coalesce(p_plan->'leaders', '[]'::jsonb));
  select count(*) into n_written
  from pole_leader l join pole p on p.id = l.pole_id where p.event_id = p_event_id;
  if n_written <> n_expected then
    raise exception 'save_plan: % leaders in, % written: one names an unknown pole',
      n_expected, n_written;
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. The ledger, corrected
-- ---------------------------------------------------------------------------
--
-- THIS FILE WAS NEVER APPLIED TO THE LIVE PROJECT, and the ledger said otherwise.
--
-- `2026-09-08_upgrade_safety.sql` created schema_migration and backfilled the eight files that
-- came before it. Seven of those eight lines recorded something that had happened; line 3
-- recorded something that had only been written. Nothing checked, because nothing could: the
-- ledger was the check.
--
-- What the live project actually looked like when this was found: volunteer.half still there and
-- not null, volunteer.half_preference absent, volunteer.refused_pole_id still there,
-- volunteer_refused_pole absent, and every other table and column of db/schema.sql present. So
-- load_plan still handed the browser a `half` key that the app stopped reading, and
-- write_plan_body still read `x->>'half'` from a document that no longer carries it, which
-- arrived as `null value in column "half" of relation "volunteer" violates not-null constraint`.
--
-- Guarded on the table existing, because on a database where the migrations are replayed in
-- order this file runs long before the one that creates it.
do $ledger$
begin
  if to_regclass('public.schema_migration') is not null then
    insert into schema_migration (sequence, filename, note) values
      (3, '2026-09-08_preference_and_plural_refusals.sql',
          'La demi-journée devient une préférence')
    on conflict (sequence) do update
      set applied_at = now(),
          note = excluded.note ||
                 ' (appliquée réellement le 2026-09-08, après la 8: le registre la disait '
                 'appliquée alors qu''elle ne l''était pas)';
  end if;
end
$ledger$;
