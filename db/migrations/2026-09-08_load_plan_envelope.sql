-- migration-sequence: 2
-- Migration 2026-09-08: load_plan returns an envelope, not a bare plan.
--
-- Applied after db/schema.sql had already been run on the live project, so schema.sql carries
-- the same definitions for a fresh install and this file is what an existing database needs.
--
-- Why. PlanStore.load must hand back the plan AND the version it was read at, in one call.
-- Two calls would leave a window where the version moves under the working copy, and a stale
-- version there is either a save refused for nothing or a save accepted over somebody else's.
--
-- Both are create or replace, so re-running this file is harmless.
--
-- SUPERSEDED THE SAME DAY by 2026-09-08_preference_and_plural_refusals.sql, which replaces
-- load_plan again for the halfPreference / refusedPoleKeys renames. This file is kept as the
-- record of what was applied, and the two sort in the right order, so a fresh database that
-- runs the whole directory ends up correct. Do not run this one on its own against a database
-- that already has the later migration: it would put the old volunteer keys back.

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
             'requestedHours', v.requested_hours,
             'half',           v.half,
             'refusedSlot',    v.refused_slot_key,
             'refusedPoleKey', rp.key,
             'choice1PoleKey', c1.key,
             'choice1Level',   v.choice1_level,
             'choice2PoleKey', c2.key,
             'choice2Level',   v.choice2_level,
             'artistKeys',     coalesce((
                                 select jsonb_agg(a.key order by a.sort_order, a.key)
                                 from volunteer_artist va
                                 join artist a on a.id = va.artist_id
                                 where va.volunteer_id = v.id), '[]'::jsonb),
             'buddyRawNames',  to_jsonb(v.buddy_raw_names))
           order by v.sort_order, v.key), '[]'::jsonb) as j
    from volunteer v
    left join pole rp on rp.id = v.refused_pole_id
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

create or replace function public.save_plan(p_event_id uuid, p_base_version int, p_plan jsonb)
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

  perform private.write_plan_body(p_event_id, p_plan);

  update event set version = version + 1, updated_at = now()
  where id = p_event_id
  returning version, updated_at into v_version, v_saved;

  return jsonb_build_object('ok', true, 'version', v_version, 'savedAt', as_iso(v_saved));
end;
$fn$;
