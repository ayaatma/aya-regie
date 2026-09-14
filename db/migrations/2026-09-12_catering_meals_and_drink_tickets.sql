-- migration-sequence: 15
-- Migration 2026-09-12: les repas et les tickets boisson.
--
-- WHY. The caterer asks two questions and only two: how many people eat at each service, and
-- what they cannot eat. Nothing in the tool could answer either. The regisseur's brief:
-- "travailler 4h donne droit a 1 repas, travailler 6h ou 8h donne droit a 2 repas. Chaque
-- tranche de 2h travaille donne droit a 1 ticket boisson. Les orgas ont droit aux 2 repas meme
-- s'ils ne travaillent pas pendant l'exploit", and, for the montage and the demontage, "ils ont
-- le repas prevu par defaut s'ils sont presents a l'heure du repas".
--
-- WHAT IS STORED AND WHAT IS NOT. The rules are stored: the services of a day, the tiers, the
-- drink rate, the orga floor. WHO EATS AT WHICH SERVICE IS NOT, and that is the decision worth
-- reading twice. It is derived from the hours somebody works, every time it is read, because a
-- stored default is a frozen default: move a creneau, open one more montage day, change a tier,
-- and yesterday's picture would stay on the caterer's sheet with nothing saying it had stopped
-- following the plan. It is the same doctrine phase_assignment already follows.
--
-- What IS stored is a regisseur DISAGREEING with that derivation, in meal_choice: one row per
-- box ticked or unticked by hand, and nothing else.
--
-- THE TWO ANSWERS THE FORM HAS ALWAYS COLLECTED. volunteer.diet and volunteer.allergies are new
-- columns for questions the form has asked since its first export and the importer threw away.
-- Every volunteer already in the base gets an empty answer here; a re-import of the same export
-- fills them in, and reconcile.ts shows them as changes so the regisseur is told.
--
-- THE TWO FUNCTIONS ARE REPLACED WHOLE, as always: db-check compares tables and columns, never
-- function bodies. Adding the tables alone would leave load_plan returning no catering at all
-- and write_plan_body dropping the one it is given, silently, with every check green.
--
-- min_plan_format GOES TO 7. A browser tab built before today knows nothing of Plan.catering and
-- would drop it on its next save, taking every ticked box and every rule with it.
--
-- Idempotent: re-running it changes nothing.

-- ---------------------------------------------------------------------------
-- 1. The columns on the two tables that already exist
-- ---------------------------------------------------------------------------

alter table event add column if not exists catering_enabled    boolean not null default false;
alter table event add column if not exists drink_per_hours     numeric(4,2) not null default 2;
alter table event add column if not exists drink_counts_phases boolean not null default false;
alter table event add column if not exists organiser_meals     int not null default 2;
alter table event add column if not exists organiser_drinks    int not null default 2;

alter table volunteer add column if not exists diet      text not null default '';
alter table volunteer add column if not exists allergies text not null default '';

comment on column event.catering_enabled is
  'Faux tant que le regisseur n''a pas active les repas. Etat de tout plan ecrit avant le 2026-09-12.';
comment on column volunteer.diet is
  'Le regime alimentaire tel qu''il a ete repondu au formulaire. Texte libre, lu par le catering.';
comment on column volunteer.allergies is
  'Les allergies telles qu''elles ont ete repondues. Tenues a part du regime: un traiteur les lit autrement.';

-- ---------------------------------------------------------------------------
-- 2. The three tables of the catering
--
-- Copied from db/schema.sql, which is the mirror this migration keeps true. The comments that
-- say why each of them is shaped this way live there.
-- ---------------------------------------------------------------------------

create table if not exists catering_service_window (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references event(id) on delete cascade,
  key        text not null,
  label      text not null default '',
  from_hour  numeric(4,2) not null check (from_hour >= 0 and from_hour < 24),
  to_hour    numeric(4,2) not null check (to_hour   >= 0 and to_hour  <= 24),
  sort_order int not null default 0,
  unique (event_id, key)
);

create index if not exists catering_service_window_event_idx on catering_service_window (event_id);

create table if not exists catering_meal_tier (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references event(id) on delete cascade,
  from_hours numeric(6,2) not null check (from_hours >= 0),
  meals      int not null check (meals >= 0),
  sort_order int not null default 0
);

create index if not exists catering_meal_tier_event_idx on catering_meal_tier (event_id);

create table if not exists meal_choice (
  id           uuid primary key default gen_random_uuid(),
  volunteer_id uuid references volunteer(id) on delete cascade,
  organiser_id uuid references organiser(id) on delete cascade,
  service_key  text not null,
  takes        boolean not null,
  sort_order   int not null default 0,
  check (num_nonnulls(volunteer_id, organiser_id) = 1)
);

create index if not exists meal_choice_person_idx on meal_choice (volunteer_id, organiser_id);

-- ---------------------------------------------------------------------------
-- 3. Row level security, exactly as every other table of a plan carries it
--
-- Copied from the RLS block of db/schema.sql. A table with RLS on and no policy is readable by
-- nobody, which is the safe end to fail at, and the policies below are the ones the regisseurs
-- already hold over every other table of the document.
-- ---------------------------------------------------------------------------

alter table catering_service_window enable row level security;
alter table catering_meal_tier      enable row level security;
alter table meal_choice             enable row level security;

-- The regisseurs' own policy, the same "for all to authenticated" every other table of a plan
-- carries. Written one by one rather than in a loop, and guarded, so a re-run changes nothing.
do $policies$
declare t text;
begin
  foreach t in array array['catering_service_window', 'catering_meal_tier', 'meal_choice']
  loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_organiser') then
      execute format(
        'create policy %I on %I for all to authenticated using (true) with check (true)',
        t || '_organiser', t);
    end if;
  end loop;
end
$policies$;

-- ---------------------------------------------------------------------------
-- 4. The two functions that carry a plan in and out, replaced whole
--
-- Copied from db/schema.sql, which is the mirror this migration keeps true.
-- ---------------------------------------------------------------------------

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
               'leaderSupportOnly', p.leader_support_only,
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
  organisers as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key',        l.key,
             'firstName',  l.first_name,
             'lastName',   l.last_name,
             'email',      l.email,
             'phone',      l.phone,
             'accessCode', l.access_code,
             'diet',       l.diet,
             'allergies',  l.allergies,
             'note',       l.note,
             -- Null travels as null, and means "not on that phase at all".
             'montageFrom',    l.montage_from,
             'demontageUntil', l.demontage_until,
             'montagePoleKeys', coalesce((
                                  select jsonb_agg(pp.key order by opp.sort_order, pp.key)
                                  from organiser_phase_pole opp
                                  join phase_pole pp on pp.id = opp.phase_pole_id
                                  join phase ph      on ph.id = pp.phase_id
                                  where opp.organiser_id = l.id and ph.phase_key = 'montage'
                                ), '[]'::jsonb),
             'demontagePoleKeys', coalesce((
                                  select jsonb_agg(pp.key order by opp.sort_order, pp.key)
                                  from organiser_phase_pole opp
                                  join phase_pole pp on pp.id = opp.phase_pole_id
                                  join phase ph      on ph.id = pp.phase_id
                                  where opp.organiser_id = l.id and ph.phase_key = 'demontage'
                                ), '[]'::jsonb))
           order by l.sort_order, l.key), '[]'::jsonb) as j
    from organiser l where l.event_id = p_event_id
  ),
  -- Ordered by the role's own sort order, so the same database always produces the same JSON.
  -- That is what makes the round trip checkable at all.
  leader_roles as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key',          r.key,
             'organiserKey', l.key,
             'poleKey',      p.key,
             'start',        r.start_hours,
             'end',          r.end_hours) order by r.sort_order, r.key), '[]'::jsonb) as j
    from leader_role r
    join organiser l on l.id = r.organiser_id
    join pole      p on p.id = r.pole_id
    where l.event_id = p_event_id
  ),
  volunteers as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key',            v.key,
             'firstName',      v.first_name,
             'lastName',       v.last_name,
             'nickname',       v.nickname,
             'email',          v.email,
             'phone',          v.phone,
             'accessCode',     v.access_code,
             'diet',            v.diet,
             'allergies',       v.allergies,
             'requestedHours',  v.requested_hours,
             'halfPreference',  v.half_preference,
             -- A list since 2026-09-10, ordered by the slot key so the same database always
             -- produces the same JSON: that is what makes the round trip checkable.
             'refusedSlotIds',  coalesce((
                                  select jsonb_agg(vrs.slot_key order by vrs.slot_key)
                                  from volunteer_refused_slot vrs
                                  where vrs.volunteer_id = v.id), '[]'::jsonb),
             'availabilityNote', v.availability_note,
             -- A list since 2026-09-08, ordered by the pole's own sort order so the same
             -- database always produces the same JSON. That is what makes the round trip
             -- checkable at all.
             'refusedPoleKeys', coalesce((
                                  select jsonb_agg(rp.key order by rp.sort_order, rp.key)
                                  from volunteer_refused_pole vrp
                                  join pole rp on rp.id = vrp.pole_id
                                  where vrp.volunteer_id = v.id), '[]'::jsonb),
             'choice1PoleKey',  c1.key,
             'choice1Raw',      v.choice1_raw,
             'choice1Level',    v.choice1_level,
             'choice2PoleKey',  c2.key,
             'choice2Raw',      v.choice2_raw,
             'choice2Level',    v.choice2_level,
             'artistKeys',      coalesce((
                                  select jsonb_agg(a.key order by a.sort_order, a.key)
                                  from volunteer_artist va
                                  join artist a on a.id = va.artist_id
                                  where va.volunteer_id = v.id), '[]'::jsonb),
             'buddyRawNames',   to_jsonb(v.buddy_raw_names),
             'manualFields',    to_jsonb(v.manual_fields),
             'needsReview',     v.needs_review,
             'reviewReasons',   to_jsonb(v.review_reasons),
             -- The two phase answers. The windows are the régisseur's reading of the sentence,
             -- ordered so the same database always produces the same JSON.
             'montage', jsonb_build_object(
                          'present', v.montage_present,
                          'note',    v.montage_note,
                          'windows', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'start', w.start_hours, 'end', w.end_hours)
                                   order by w.sort_order, w.start_hours)
                            from volunteer_phase_window w
                            where w.volunteer_id = v.id and w.phase_key = 'montage'
                          ), '[]'::jsonb)),
             'demontage', jsonb_build_object(
                          'present', v.demontage_present,
                          'note',    v.demontage_note,
                          'windows', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'start', w.start_hours, 'end', w.end_hours)
                                   order by w.sort_order, w.start_hours)
                            from volunteer_phase_window w
                            where w.volunteer_id = v.id and w.phase_key = 'demontage'
                          ), '[]'::jsonb)))
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
  ),
  organiser_shifts as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key',          os.key,
             'organiserKey', l.key,
             'shiftKey',     s.key) order by os.sort_order, os.key), '[]'::jsonb) as j
    from organiser_shift os
    join organiser l on l.id = os.organiser_id
    join shift s     on s.id = os.shift_id
    where l.event_id = p_event_id
  ),
  -- The two phases, each built whole and picked out by key below. One row per phase, so this is
  -- read through scalar subqueries rather than joined into the envelope: joining it would
  -- multiply the single event row by two.
  phases as (
    select ph.phase_key,
           jsonb_build_object(
             'id',                ph.phase_key,
             'enabled',           ph.enabled,
             'label',             ph.label,
             'startISO',          as_iso(ph.starts_at),
             'lengthHours',       ph.length_hours,
             'offStartHour',      ph.off_start_hour,
             'offEndHour',        ph.off_end_hour,
             'dayPartSplitHour',  ph.day_part_split_hour,
             'volunteersAllowed', ph.volunteers_allowed,
             'volunteersFrom',    ph.volunteers_from,
             'volunteersUntil',   ph.volunteers_until,
             'poles', coalesce((
               select jsonb_agg(
                        jsonb_build_object('key', pp.key, 'name', pp.name)
                        || case when pp.colour is null then '{}'::jsonb
                                else jsonb_build_object('colour', pp.colour) end
                        order by pp.sort_order, pp.key)
               from phase_pole pp where pp.phase_id = ph.id), '[]'::jsonb),
             'events', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'key',       pe.key,
                        'label',     pe.label,
                        'start',     pe.start_hours,
                        'end',       pe.end_hours,
                        'headcount', pe.headcount)
                      order by pe.sort_order, pe.key)
               from phase_event pe where pe.phase_id = ph.id), '[]'::jsonb),
             'assignments', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'key',        pa.key,
                        'personKind', case when pa.organiser_id is not null
                                           then 'orga' else 'benevole' end,
                        'personKey',  coalesce(po.key, pv.key),
                        'poleKey',    coalesce(ppp.key, ''),
                        'eventKey',   coalesce(pee.key, ''),
                        'start',      pa.start_hours,
                        'end',        pa.end_hours)
                      order by pa.sort_order, pa.key)
               from phase_assignment pa
               left join organiser   po  on po.id  = pa.organiser_id
               left join volunteer   pv  on pv.id  = pa.volunteer_id
               left join phase_pole  ppp on ppp.id = pa.phase_pole_id
               left join phase_event pee on pee.id = pa.phase_event_id
               where pa.phase_id = ph.id), '[]'::jsonb)) as j
    from phase ph where ph.event_id = p_event_id
  ),
  -- The catering: the rules, and the boxes a human ticked against them. Nothing derived, for the
  -- reasons written over the three tables it reads.
  catering as (
    select jsonb_build_object(
      'rules', jsonb_build_object(
        'enabled',           e.catering_enabled,
        'drinkPerHours',     e.drink_per_hours,
        'drinkCountsPhases', e.drink_counts_phases,
        'organiserMeals',    e.organiser_meals,
        'organiserDrinks',   e.organiser_drinks,
        'services', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'key',      w.key,
                   'label',    w.label,
                   'fromHour', w.from_hour,
                   'toHour',   w.to_hour)
                 order by w.sort_order, w.key)
          from catering_service_window w where w.event_id = e.id), '[]'::jsonb),
        'exploitTiers', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'fromHours', t.from_hours,
                   'meals',     t.meals)
                 order by t.sort_order, t.from_hours)
          from catering_meal_tier t where t.event_id = e.id), '[]'::jsonb)),
      'choices', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'personKind', case when mc.organiser_id is not null then 'orga' else 'benevole' end,
                 'personKey',  coalesce(mo.key, mv.key),
                 'serviceKey', mc.service_key,
                 'takes',      mc.takes)
               order by mc.sort_order, mc.service_key)
        from meal_choice mc
        left join organiser mo on mo.id = mc.organiser_id
        left join volunteer mv on mv.id = mc.volunteer_id
        where coalesce(mo.event_id, mv.event_id) = e.id), '[]'::jsonb)) as j
    from event e where e.id = p_event_id
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
      'sheetUrl',    e.sheet_url,
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
      'organisers',  organisers.j,
      'leaderRoles', leader_roles.j,
      'volunteers',  volunteers.j,
      'buddies',     buddies.j,
      'assignments', assignments.j,
      'reserve',     reserve.j,
      'organiserShifts', organiser_shifts.j,
      -- Absent rather than null when a phase row is somehow missing: the app then falls back to
      -- the defaults it would have built itself, which is the same state.
      'montage',     (select j from phases where phase_key = 'montage'),
      'demontage',   (select j from phases where phase_key = 'demontage'),
      'catering',    catering.j))
  from event e, slots, poles, shifts, artists, organisers, leader_roles, volunteers, buddies,
       assignments, reserve, organiser_shifts, catering
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
  -- Out with the old. volunteer cascades to its assignments, buddies, artist links, refused
  -- slots and phase windows; pole cascades to its shifts; organiser and pole both cascade to
  -- leader_role, which is why the organisers are deleted explicitly rather than left to follow
  -- their poles: an orga belongs to the event, not to any one pole. phase cascades to its own
  -- poles, its événements and every placement in it.
  delete from volunteer  where event_id = p_event_id;
  delete from organiser  where event_id = p_event_id;
  delete from pole       where event_id = p_event_id;
  delete from artist     where event_id = p_event_id;
  delete from event_slot where event_id = p_event_id;
  delete from phase      where event_id = p_event_id;
  -- The catering rules are rewritten whole like everything else. meal_choice is not deleted
  -- here: it hangs off volunteer and organiser, which were deleted three lines up, and it went
  -- with them.
  delete from catering_service_window where event_id = p_event_id;
  delete from catering_meal_tier      where event_id = p_event_id;

  update event set
    name                     = p_plan->>'name',
    starts_at                = (p_plan->>'startISO')::timestamptz,
    length_hours             = (p_plan->>'lengthHours')::numeric,
    sheet_url                = coalesce(p_plan->>'sheetUrl', ''),
    evening_starts_at        = (p_plan#>>'{rules,eveningStartsAt}')::numeric,
    max_consecutive_hours    = (p_plan#>>'{rules,maxConsecutiveHours}')::numeric,
    max_blocks               = (p_plan#>>'{rules,maxBlocks}')::int,
    min_break_hours          = (p_plan#>>'{rules,minBreakHours}')::numeric,
    min_hours_per_person     = (p_plan#>>'{rules,minHoursPerPerson}')::numeric,
    afternoon_overflow_until = (p_plan#>>'{rules,afternoonOverflowUntil}')::numeric,
    -- Absent from anything written before PLAN_FORMAT 7, and the defaults are then the state a
    -- plan with no catering opens in: off, with the Loto Tekno figures behind it.
    catering_enabled      = coalesce((p_plan#>>'{catering,rules,enabled}')::boolean, false),
    drink_per_hours       = coalesce((p_plan#>>'{catering,rules,drinkPerHours}')::numeric, 2),
    drink_counts_phases   = coalesce((p_plan#>>'{catering,rules,drinkCountsPhases}')::boolean, false),
    organiser_meals       = coalesce((p_plan#>>'{catering,rules,organiserMeals}')::int, 2),
    organiser_drinks      = coalesce((p_plan#>>'{catering,rules,organiserDrinks}')::int, 2)
  where id = p_event_id;

  insert into catering_service_window (event_id, key, label, from_hour, to_hour, sort_order)
  select p_event_id, x->>'key', coalesce(x->>'label', ''),
         (x->>'fromHour')::numeric, (x->>'toHour')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan#>'{catering,rules,services}', '[]'::jsonb))
       with ordinality as t(x, ord);

  insert into catering_meal_tier (event_id, from_hours, meals, sort_order)
  select p_event_id, (x->>'fromHours')::numeric, (x->>'meals')::int, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan#>'{catering,rules,exploitTiers}', '[]'::jsonb))
       with ordinality as t(x, ord);

  insert into event_slot (event_id, slot_key, label, start_hours, end_hours, sort_order)
  select p_event_id, x->>'id', x->>'label',
         (x->>'start')::numeric, (x->>'end')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'slots', '[]'::jsonb)) with ordinality as t(x, ord);

  -- Poles land parentless first, then the tree is tied together by key: a plan is free to list a
  -- sub-pole before its parent.
  insert into pole (event_id, key, name, colour, sort_order, allow_all_debutants,
                    min_experienced, locked, leader_support_only, default_headcount,
                    default_shift_hours)
  select p_event_id, x->>'key', x->>'name', x->>'colour', (ord - 1)::int,
         coalesce((x->>'allowAllDebutants')::boolean, false),
         coalesce((x->>'minExperienced')::int, 0),
         coalesce((x->>'locked')::boolean, false),
         coalesce((x->>'leaderSupportOnly')::boolean, false),
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

  insert into organiser (event_id, key, first_name, last_name, email, phone, access_code,
                         diet, allergies, note, montage_from, demontage_until, sort_order)
  select p_event_id, x->>'key',
         coalesce(x->>'firstName', ''), coalesce(x->>'lastName', ''),
         coalesce(x->>'email', ''), coalesce(x->>'phone', ''),
         coalesce(x->>'accessCode', ''),
         coalesce(x->>'diet', ''), coalesce(x->>'allergies', ''), coalesce(x->>'note', ''),
         (x->>'montageFrom')::numeric, (x->>'demontageUntil')::numeric,
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'organisers', '[]'::jsonb)) with ordinality as t(x, ord);

  -- A role naming an orga or a pole that is not in the same document simply does not join, and
  -- the count check at the end of this function turns that silence into a refused save.
  insert into leader_role (organiser_id, pole_id, key, start_hours, end_hours, sort_order)
  select l.id, p.id, x->>'key',
         (x->>'start')::numeric, (x->>'end')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'leaderRoles', '[]'::jsonb)) with ordinality as t(x, ord)
  join organiser l on l.event_id = p_event_id and l.key = x->>'organiserKey'
  join pole      p on p.event_id = p_event_id and p.key = x->>'poleKey';

  insert into volunteer (event_id, key, first_name, last_name, nickname, display_name,
                         email, phone, access_code, diet, allergies,
                         requested_hours, half_preference, availability_note,
                         choice1_pole_id, choice1_raw, choice1_level,
                         choice2_pole_id, choice2_raw, choice2_level,
                         buddy_raw_names, manual_fields, needs_review, review_reasons,
                         montage_present, montage_note, demontage_present, demontage_note,
                         on_reserve, sort_order)
  select p_event_id, x->>'key', x->>'firstName', x->>'lastName',
         coalesce(x->>'nickname', ''),
         -- The short label, computed over the whole roster by the browser that is saving. The
         -- fallback is the form this database produced on its own until 2026-09-09: good enough
         -- to read, and replaced by the real thing on the next save. See volunteer.display_name.
         coalesce(nullif(x->>'displayName', ''),
                  btrim(coalesce(x->>'firstName', '') ||
                        case when coalesce(x->>'lastName', '') = '' then ''
                             else ' ' || left(x->>'lastName', 1) || '.' end)),
         coalesce(x->>'email', ''), coalesce(x->>'phone', ''), x->>'accessCode',
         coalesce(x->>'diet', ''), coalesce(x->>'allergies', ''),
         (x->>'requestedHours')::int,
         (x->>'halfPreference')::half_preference,
         coalesce(x->>'availabilityNote', ''),
         c1.id, coalesce(x->>'choice1Raw', ''), (x->>'choice1Level')::skill_level,
         c2.id, coalesce(x->>'choice2Raw', ''), (x->>'choice2Level')::skill_level,
         coalesce((select array_agg(raw #>> '{}')
                   from jsonb_array_elements(coalesce(x->'buddyRawNames', '[]'::jsonb))
                        as bn(raw)),
                  '{}'::text[]),
         coalesce((select array_agg(field #>> '{}')
                   from jsonb_array_elements(coalesce(x->'manualFields', '[]'::jsonb))
                        as mf(field)),
                  '{}'::text[]),
         coalesce((x->>'needsReview')::boolean, false),
         coalesce((select array_agg(reason #>> '{}')
                   from jsonb_array_elements(coalesce(x->'reviewReasons', '[]'::jsonb))
                        as rr(reason)),
                  '{}'::text[]),
         coalesce((x#>>'{montage,present}')::boolean, false),
         coalesce(x#>>'{montage,note}', ''),
         coalesce((x#>>'{demontage,present}')::boolean, false),
         coalesce(x#>>'{demontage,note}', ''),
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
  insert into volunteer_refused_slot (volunteer_id, slot_key)
  select v.id, sk.slot_key
  from jsonb_array_elements(coalesce(p_plan->'volunteers', '[]'::jsonb)) as t(x)
  join volunteer v on v.event_id = p_event_id and v.key = x->>'key'
  cross join lateral jsonb_array_elements_text(coalesce(x->'refusedSlotIds', '[]'::jsonb))
             as sk(slot_key)
  on conflict do nothing;

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

  -- An orga in a créneau. Both ends resolve by key or the row is not written, and the count
  -- check at the end turns that into a refused save.
  insert into organiser_shift (organiser_id, shift_id, key, sort_order)
  select l.id, s.id, x->>'key', (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'organiserShifts', '[]'::jsonb))
       with ordinality as t(x, ord)
  join organiser l on l.event_id = p_event_id and l.key = x->>'organiserKey'
  join pole p      on p.event_id = p_event_id
  join shift s     on s.pole_id = p.id and s.key = x->>'shiftKey';

  -- ------------------------------------------------------------------------
  -- The two phases, in dependency order: the phase, then its poles and its événements, then
  -- what refers to them.
  -- ------------------------------------------------------------------------

  insert into phase (event_id, phase_key, enabled, label, starts_at, length_hours,
                     off_start_hour, off_end_hour, day_part_split_hour,
                     volunteers_allowed, volunteers_from, volunteers_until)
  select p_event_id, k.phase_key,
         coalesce((j.x->>'enabled')::boolean, false),
         coalesce(j.x->>'label',
                  case when k.phase_key = 'montage' then 'Montage' else 'Démontage' end),
         coalesce((j.x->>'startISO')::timestamptz, (p_plan->>'startISO')::timestamptz),
         coalesce((j.x->>'lengthHours')::numeric, 72),
         coalesce((j.x->>'offStartHour')::numeric, 0),
         coalesce((j.x->>'offEndHour')::numeric, 8),
         coalesce((j.x->>'dayPartSplitHour')::numeric, 13),
         coalesce((j.x->>'volunteersAllowed')::boolean, false),
         coalesce((j.x->>'volunteersFrom')::numeric, 0),
         coalesce((j.x->>'volunteersUntil')::numeric,
                  coalesce((j.x->>'lengthHours')::numeric, 72))
  from (values ('montage'), ('demontage')) as k(phase_key)
  cross join lateral (select coalesce(p_plan->k.phase_key, '{}'::jsonb) as x) j;

  insert into phase_pole (phase_id, key, name, colour, sort_order)
  select ph.id, x->>'key', coalesce(x->>'name', ''), x->>'colour', (ord - 1)::int
  from phase ph
  cross join lateral jsonb_array_elements(
    coalesce(p_plan->ph.phase_key->'poles', '[]'::jsonb)) with ordinality as t(x, ord)
  where ph.event_id = p_event_id;

  insert into phase_event (phase_id, key, label, start_hours, end_hours, headcount, sort_order)
  select ph.id, x->>'key', coalesce(x->>'label', ''),
         (x->>'start')::numeric, (x->>'end')::numeric,
         coalesce((x->>'headcount')::int, 0), (ord - 1)::int
  from phase ph
  cross join lateral jsonb_array_elements(
    coalesce(p_plan->ph.phase_key->'events', '[]'::jsonb)) with ordinality as t(x, ord)
  where ph.event_id = p_event_id;

  -- Where each orga works during each phase. A key naming a pole the phase does not have simply
  -- does not join: the app treats a missing pole as Général, and so does this.
  insert into organiser_phase_pole (organiser_id, phase_pole_id, sort_order)
  select l.id, pp.id, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'organisers', '[]'::jsonb)) as t(x)
  join organiser l on l.event_id = p_event_id and l.key = x->>'key'
  cross join (values ('montage', 'montagePoleKeys'), ('demontage', 'demontagePoleKeys'))
             as f(phase_key, field)
  cross join lateral jsonb_array_elements_text(coalesce(x->f.field, '[]'::jsonb))
             with ordinality as k(pole_key, ord)
  join phase ph      on ph.event_id = p_event_id and ph.phase_key = f.phase_key
  join phase_pole pp on pp.phase_id = ph.id and pp.key = k.pole_key
  on conflict do nothing;

  -- A placement resolves both ends or it is not written, and the count check below turns that
  -- into a refused save rather than a box quietly disappearing off somebody's montage.
  insert into phase_assignment (phase_id, key, volunteer_id, organiser_id,
                                phase_pole_id, phase_event_id,
                                start_hours, end_hours, sort_order)
  select ph.id, x->>'key', v.id, l.id, pp.id, pe.id,
         (x->>'start')::numeric, (x->>'end')::numeric, (ord - 1)::int
  from phase ph
  cross join lateral jsonb_array_elements(
    coalesce(p_plan->ph.phase_key->'assignments', '[]'::jsonb)) with ordinality as t(x, ord)
  left join volunteer v   on x->>'personKind' = 'benevole'
                         and v.event_id = p_event_id and v.key = x->>'personKey'
  left join organiser l   on x->>'personKind' = 'orga'
                         and l.event_id = p_event_id and l.key = x->>'personKey'
  left join phase_pole pp on pp.phase_id = ph.id and pp.key = nullif(x->>'poleKey', '')
  left join phase_event pe on pe.phase_id = ph.id and pe.key = nullif(x->>'eventKey', '')
  where ph.event_id = p_event_id
    and num_nonnulls(v.id, l.id) = 1
    and num_nonnulls(pp.id, pe.id) = 1;

  insert into volunteer_phase_window (volunteer_id, phase_key, start_hours, end_hours, sort_order)
  select v.id, f.phase_key, (w->>'start')::numeric, (w->>'end')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'volunteers', '[]'::jsonb)) as t(x)
  join volunteer v on v.event_id = p_event_id and v.key = x->>'key'
  cross join (values ('montage'), ('demontage')) as f(phase_key)
  cross join lateral jsonb_array_elements(coalesce(x->f.phase_key->'windows', '[]'::jsonb))
             with ordinality as e(w, ord);

  -- The boxes a human ticked against the tool. A row naming somebody the plan does not contain
  -- does not join and is counted below like every other reference.
  insert into meal_choice (volunteer_id, organiser_id, service_key, takes, sort_order)
  select mv.id, mo.id, x->>'serviceKey', coalesce((x->>'takes')::boolean, false), (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan#>'{catering,choices}', '[]'::jsonb))
       with ordinality as t(x, ord)
  left join volunteer mv on mv.event_id = p_event_id and x->>'personKind' = 'benevole'
                        and mv.key = x->>'personKey'
  left join organiser mo on mo.event_id = p_event_id and x->>'personKind' = 'orga'
                        and mo.key = x->>'personKey'
  where num_nonnulls(mv.id, mo.id) = 1;

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

  n_expected := jsonb_array_length(coalesce(p_plan->'organisers', '[]'::jsonb));
  select count(*) into n_written from organiser l where l.event_id = p_event_id;
  if n_written <> n_expected then
    raise exception 'save_plan: % orgas in, % written', n_expected, n_written;
  end if;

  n_expected := jsonb_array_length(coalesce(p_plan->'leaderRoles', '[]'::jsonb));
  select count(*) into n_written
  from leader_role r join organiser l on l.id = r.organiser_id where l.event_id = p_event_id;
  if n_written <> n_expected then
    raise exception
      'save_plan: % rôles de responsable in, % written: one names an unknown orga or pole',
      n_expected, n_written;
  end if;

  n_expected := jsonb_array_length(coalesce(p_plan->'organiserShifts', '[]'::jsonb));
  select count(*) into n_written
  from organiser_shift os join organiser l on l.id = os.organiser_id
  where l.event_id = p_event_id;
  if n_written <> n_expected then
    raise exception
      'save_plan: % orgas en créneau in, % written: one names an unknown orga or créneau',
      n_expected, n_written;
  end if;

  n_expected := jsonb_array_length(coalesce(p_plan#>'{catering,choices}', '[]'::jsonb));
  select count(*) into n_written
  from meal_choice mc
  left join volunteer mv on mv.id = mc.volunteer_id
  left join organiser mo on mo.id = mc.organiser_id
  where coalesce(mv.event_id, mo.event_id) = p_event_id;
  if n_written <> n_expected then
    raise exception
      'save_plan: % repas coches in, % written: un nomme une personne inconnue',
      n_expected, n_written;
  end if;

  -- The placements of both phases together, since one number is enough to say that one of them
  -- did not resolve, and the message names both phases anyway.
  n_expected := jsonb_array_length(coalesce(p_plan#>'{montage,assignments}', '[]'::jsonb))
              + jsonb_array_length(coalesce(p_plan#>'{demontage,assignments}', '[]'::jsonb));
  select count(*) into n_written
  from phase_assignment pa join phase ph on ph.id = pa.phase_id
  where ph.event_id = p_event_id;
  if n_written <> n_expected then
    raise exception
      'save_plan: % affectations montage / démontage in, % written: une nomme une personne, un pôle ou un événement inconnu',
      n_expected, n_written;
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The guard against a stale tab
-- ---------------------------------------------------------------------------

update app_setting set number = 7 where name = 'min_plan_format';
