-- migration-sequence: 13
-- Migration 2026-09-10: orgas beside bénévoles, and the montage / démontage.
--
-- WHY. Two things the tool had wrong, and they are the same thing seen twice.
--
-- The first: the people imported through what this repository called the responsables' form are
-- ORGAS. A responsable is an orga who has been put in charge of a pole, and most orgas are not
-- responsables. `leader` therefore becomes `organiser`, and `leader_role` keeps its name and its
-- meaning: holding one is exactly what being a responsable is. Nothing about the codes, the
-- fiches or the read-only planning changes; what changes is which people are in the table and
-- what the table is called.
--
-- The second: the event is three moments, not one. The eighteen hours the public is on site are
-- *l'exploit*, and everything this schema held until today is the exploit's. Around it sit a
-- montage over several days before and a démontage over several days after: their own poles,
-- their own days, their own placements, and NOT ONE of the exploit's rules. Nothing is solved
-- there, nobody's hours are counted there, and the régisseur distributes it by hand.
--
-- TIME IN A PHASE COUNTS FROM THAT PHASE'S OWN START, never from the event's. `phase.starts_at`
-- is the origin, and `start_hours` on anything belonging to a phase is measured from it. A
-- montage three days early expressed as hours -72 to 0 of the event would have made every ruler,
-- every export and every helper that assumes an hour lands inside the event quietly wrong.
--
-- NOTHING IS TURNED ON BY THIS MIGRATION. Both phases are created disabled, anchored on the
-- event's own start, with Général as their only pole. Every existing plan therefore opens
-- exactly as it did yesterday, and a phase appears the day the régisseur configures one.
--
-- min_plan_format GOES TO 5 in the last section. A browser built before today knows nothing of
-- `montage`, `demontage` or the four new answers, and `normalise.ts` writes a plan back field by
-- field: letting such a tab save would wipe both phases, every hand-made placement in them and
-- every orga's arrival, in one write, without a word.
--
-- ORDER OF SECTIONS MATTERS. The rename happens before anything refers to `organiser`, the
-- tables exist before the functions that read them are replaced, and the format number rises
-- last, after every function has been replaced: between the two a saving tab must still meet a
-- database that works.

-- ---------------------------------------------------------------------------
-- 1. `leader` becomes `organiser`
--
-- A rename, not a rebuild: the rows, the keys, the access codes and the roles are all the same
-- rows they were a second before. `leader_role.leader_id` follows, because the field name is
-- what makes the type checker walk every site in the app rather than leaving one to be found on
-- the night.
-- ---------------------------------------------------------------------------

do $rename$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'leader') then
    alter table leader rename to organiser;
    alter table leader_role rename column leader_id to organiser_id;
    alter index leader_access_code_key rename to organiser_access_code_key;
    -- The policy convention is `<table>_organiser`, where the suffix means "the authenticated
    -- régisseur". On this table that reads oddly and it is still the convention.
    alter policy leader_organiser on organiser rename to organiser_organiser;
  end if;
end
$rename$;

comment on table organiser is
  'An orga: somebody who runs the event. A responsable is an orga holding a leader_role.';

-- ---------------------------------------------------------------------------
-- 2. What an orga declares about the two phases
--
-- An arrival for the montage and a departure for the démontage, both in hours from THEIR OWN
-- phase's start, both null when the person is not there at all. Null is the answer that matters:
-- an orga who has not said when they arrive is not drawn anywhere, because being on the montage
-- is a thing somebody said, never a thing this tool assumed for them.
-- ---------------------------------------------------------------------------

alter table organiser add column if not exists montage_from    numeric(6,2);
alter table organiser add column if not exists demontage_until numeric(6,2);

comment on column organiser.montage_from is
  'Hours from the MONTAGE start. Null: not on the montage.';
comment on column organiser.demontage_until is
  'Hours from the DÉMONTAGE start. Null: not on the démontage.';

-- An orga standing in a créneau of the exploit, placed by hand and by hand only.
--
-- NOT AN `assignment`, and deliberately not. An assignment is a volunteer under every rule of
-- this schema and of the solver; an orga is subject to none of them. The one thing the engine
-- knows about these rows is that they take a place: `PlanIndex.headcountOf` subtracts them from
-- what a créneau still needs, so the solver stops offering a seat that is already held.
create table if not exists organiser_shift (
  id           uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references organiser(id) on delete cascade,
  shift_id     uuid not null references shift(id)     on delete cascade,
  key          text not null,
  sort_order   int  not null default 0,
  unique (shift_id, key)
);

create index if not exists organiser_shift_organiser_idx on organiser_shift (organiser_id);
create index if not exists organiser_shift_shift_idx     on organiser_shift (shift_id);

-- ---------------------------------------------------------------------------
-- 3. The phases
-- ---------------------------------------------------------------------------

create table if not exists phase (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references event(id) on delete cascade,
  phase_key text not null check (phase_key in ('montage', 'demontage')),
  -- Off until the régisseur configures it. Every plan that predates this migration is here.
  enabled   boolean not null default false,
  label     text not null default '',
  -- THE PHASE'S OWN ORIGIN. Every start_hours below counts from this moment, not from the
  -- event's. See the header.
  starts_at timestamptz not null,
  length_hours numeric(6,2) not null default 72 check (length_hours > 0),
  -- The hours of the clock nobody works, as a band repeated every day: 00h to 08h by default.
  -- A daily pattern rather than a list of windows, because adding a day to the montage must not
  -- mean typing the night in again. The band may wrap past midnight (22 to 8 is legal), and the
  -- two being equal means the phase runs around the clock.
  off_start_hour numeric(4,2) not null default 0  check (off_start_hour >= 0 and off_start_hour < 24),
  off_end_hour   numeric(4,2) not null default 8  check (off_end_hour   >= 0 and off_end_hour   < 24),
  -- Where a day is cut into a morning and an afternoon. Not a rule: it is the box a click makes.
  day_part_split_hour numeric(4,2) not null default 13
    check (day_part_split_hour >= 0 and day_part_split_hour <= 24),
  -- Whether bénévoles are on site at all, and the window the régisseur opened to them. It is
  -- also the placement a bénévole gets when they said they were coming without saying when.
  volunteers_allowed boolean not null default false,
  volunteers_from    numeric(6,2) not null default 0,
  volunteers_until   numeric(6,2) not null default 72,
  unique (event_id, phase_key)
);

create index if not exists phase_event_idx on phase (event_id);

-- The poles of a phase, and deliberately not `pole` rows: an experience requirement, a default
-- headcount and a lock for the solver are all meaningless here, and having the columns would
-- read as promises the phase does not keep.
create table if not exists phase_pole (
  id         uuid primary key default gen_random_uuid(),
  phase_id   uuid not null references phase(id) on delete cascade,
  key        text not null,
  name       text not null,
  colour     text,
  sort_order int not null default 0,
  unique (phase_id, key)
);

create index if not exists phase_pole_phase_idx on phase_pole (phase_id);

-- Something that happens at a precise moment and needs a given number of people: "déchargement
-- du camion, 14h à 16h, six personnes". It has NO POLE on purpose, since the six may come from
-- anywhere, and it is the only thing in a phase that can be short of people.
create table if not exists phase_event (
  id          uuid primary key default gen_random_uuid(),
  phase_id    uuid not null references phase(id) on delete cascade,
  key         text not null,
  label       text not null default '',
  start_hours numeric(6,2) not null,
  end_hours   numeric(6,2) not null,
  -- Zero means "as many as turn up" and is never reported short.
  headcount   int not null default 0 check (headcount >= 0),
  sort_order  int not null default 0,
  unique (phase_id, key),
  check (end_hours > start_hours)
);

create index if not exists phase_event_phase_idx on phase_event (phase_id);

-- One person, in one pole or in one événement, over one window: A DECISION THE RÉGISSEUR TOOK.
-- What everybody does by default is derived in the app from their own declared presence and is
-- never stored, because storing a default freezes it: changing an orga's arrival, or opening one
-- more day to the bénévoles, would otherwise leave yesterday's picture on the grid.
create table if not exists phase_assignment (
  id             uuid primary key default gen_random_uuid(),
  phase_id       uuid not null references phase(id) on delete cascade,
  key            text not null,
  -- Exactly one of the two, which is what "orga or bénévole" means at this end. Both cascade:
  -- deleting a person takes their placements with them rather than leaving a box with no name.
  volunteer_id   uuid references volunteer(id) on delete cascade,
  organiser_id   uuid references organiser(id) on delete cascade,
  -- Exactly one of the two targets: a pole of this phase, or an événement of it.
  phase_pole_id  uuid references phase_pole(id)  on delete cascade,
  phase_event_id uuid references phase_event(id) on delete cascade,
  start_hours    numeric(6,2) not null,
  end_hours      numeric(6,2) not null,
  sort_order     int not null default 0,
  unique (phase_id, key),
  check (num_nonnulls(volunteer_id, organiser_id) = 1),
  check (num_nonnulls(phase_pole_id, phase_event_id) = 1),
  check (end_hours > start_hours)
);

create index if not exists phase_assignment_phase_idx  on phase_assignment (phase_id);
create index if not exists phase_assignment_person_idx on phase_assignment (volunteer_id, organiser_id);

-- Where an orga works during a phase when nothing else has been decided for the half-day. The
-- first one is where they are drawn; the others are recorded so the régisseur knows where else
-- this person is useful. No row at all means Général.
create table if not exists organiser_phase_pole (
  organiser_id  uuid not null references organiser(id)  on delete cascade,
  phase_pole_id uuid not null references phase_pole(id) on delete cascade,
  sort_order    int not null default 0,
  primary key (organiser_id, phase_pole_id)
);

-- Both phases, for every event that already exists, disabled and anchored on the event's own
-- start. This is the same state `defaultPhase` produces in the app, on purpose: a plan loaded
-- before it has ever been saved again must look exactly like one the app built itself.
insert into phase (event_id, phase_key, enabled, label, starts_at, length_hours,
                   volunteers_until)
select e.id, k.phase_key, false,
       case when k.phase_key = 'montage' then 'Montage' else 'Démontage' end,
       e.starts_at, 72, 72
from event e
cross join (values ('montage'), ('demontage')) as k(phase_key)
on conflict (event_id, phase_key) do nothing;

insert into phase_pole (phase_id, key, name, sort_order)
select ph.id, 'general', 'Général', 0
from phase ph
on conflict (phase_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. What a bénévole answered about the two phases
--
-- The same three-part shape as the free-text answers of migration 11, and for the same reason:
-- the question is asked in prose, the importer's reading of it is a guess, and a guess has to
-- stay checkable against what the person actually wrote. So the sentence is kept verbatim beside
-- the reading, and the reading is correctable on the fiche.
--
-- No window at all while present is true is not a missing answer: it means "there, hours not
-- stated", and the tool then takes the whole window the régisseur opened to the bénévoles.
-- ---------------------------------------------------------------------------

alter table volunteer add column if not exists montage_present   boolean not null default false;
alter table volunteer add column if not exists montage_note      text    not null default '';
alter table volunteer add column if not exists demontage_present boolean not null default false;
alter table volunteer add column if not exists demontage_note    text    not null default '';

create table if not exists volunteer_phase_window (
  id           uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references volunteer(id) on delete cascade,
  phase_key    text not null check (phase_key in ('montage', 'demontage')),
  start_hours  numeric(6,2) not null,
  end_hours    numeric(6,2) not null,
  sort_order   int not null default 0,
  check (end_hours > start_hours)
);

create index if not exists volunteer_phase_window_idx on volunteer_phase_window (volunteer_id);

-- ---------------------------------------------------------------------------
-- 5. Row level security on everything new
--
-- PostgREST exposes every table of the public schema as its own endpoint, so a table with RLS
-- off is a table anybody with the anon key can read. `npm run anon-check` asks these questions
-- from outside and is the check that this section is right.
--
-- volunteer_refused_slot is in this list although it is not new: migration 11 created it and
-- never enabled RLS on it, so it has been readable by anonymous callers since 2026-09-10. It
-- holds a volunteer id and a slot key, no names, which is why nothing has leaked that means
-- anything; it is closed here because an open table is an open table.
-- ---------------------------------------------------------------------------

do $rls$
declare t text;
begin
  foreach t in array array['phase', 'phase_pole', 'phase_event', 'phase_assignment',
                           'organiser_phase_pole', 'organiser_shift',
                           'volunteer_phase_window', 'volunteer_refused_slot']
  loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = t
                     and policyname = t || '_organiser') then
      execute format(
        'create policy %I on %I for all to authenticated using (true) with check (true)',
        t || '_organiser', t);
    end if;
  end loop;
end
$rls$;

-- ---------------------------------------------------------------------------
-- 6. The two functions that carry a plan in and out, replaced whole
--
-- Replaced rather than patched, for the reason the earlier migrations give: these two are the
-- shape of the document, and a shape half-changed is a save that drops a field in silence.
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
      'demontage',   (select j from phases where phase_key = 'demontage')))
  from event e, slots, poles, shifts, artists, organisers, leader_roles, volunteers, buddies,
       assignments, reserve, organiser_shifts
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
                         email, phone, access_code,
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
-- 7. The read-only doors, which all name the renamed table
--
-- `get_leader_planning` becomes `get_organiser_planning`, because every orga now holds a code
-- and not only those in charge of a pole. The old name is dropped in the same breath: leaving it
-- behind would leave a second, unmaintained way into the whole planning.
-- ---------------------------------------------------------------------------

create or replace function public.get_volunteer_schedule(p_code text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $fn$
  select jsonb_build_object(
    'benevole', jsonb_build_object(
      'prenom', me.first_name,
      'nom',    me.last_name,
      'heures_demandees', me.requested_hours
    ),
    'creneaux', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.debut)
      from (
        select ev.starts_at + make_interval(secs => (s.start_hours * 3600)::float8) as debut,
               ev.starts_at + make_interval(secs => (s.end_hours   * 3600)::float8) as fin,
               coalesce(parent.name || ' / ', '') || p.name as pole,
               -- One entry per PERSON, not per role: a responsable holding two windows on this
               -- pole is still one name and one number to the volunteer reading their schedule.
               coalesce((
                 select jsonb_agg(distinct jsonb_build_object(
                   'nom', btrim(l.first_name || ' ' || l.last_name),
                   'telephone', l.phone,
                   'email', l.email))
                 from leader_role r
                 join organiser l on l.id = r.organiser_id
                 where r.pole_id = p.id or r.pole_id = parent.id
               ), '[]'::jsonb) as responsables,
               -- The short label and nothing else. Read from the column rather than assembled
               -- here: whether one letter of a surname is enough is a question about the whole
               -- roster, and this query looks at one person at a time. See volunteer.display_name.
               coalesce((
                 select jsonb_agg(o.display_name order by o.display_name)
                 from assignment a2
                 join volunteer o on o.id = a2.volunteer_id
                 where a2.shift_id = s.id and o.id <> me.id
               ), '[]'::jsonb) as avec
        from assignment a
        join shift s  on s.id = a.shift_id
        join pole  p  on p.id = s.pole_id
        join event ev on ev.id = p.event_id
        left join pole parent on parent.id = p.parent_id
        where a.volunteer_id = me.id
      ) c
    ), '[]'::jsonb),
    -- The two phases, in the same call: a bénévole who comes to the montage needs their whole
    -- event on one page, not one page per phase. Derived boxes are not here, only decisions,
    -- because the default placement is computed from the phase's settings by whoever draws it.
    'phases', coalesce((
      select jsonb_agg(jsonb_build_object(
               'phase',  ph.phase_key,
               'debut',  ph.starts_at + make_interval(secs => (pa.start_hours * 3600)::float8),
               'fin',    ph.starts_at + make_interval(secs => (pa.end_hours   * 3600)::float8),
               'pole',   coalesce(pp.name, ''),
               'evenement', coalesce(pe.label, ''))
             order by ph.starts_at + make_interval(secs => (pa.start_hours * 3600)::float8))
      from phase_assignment pa
      join phase ph on ph.id = pa.phase_id and ph.enabled
      left join phase_pole  pp on pp.id = pa.phase_pole_id
      left join phase_event pe on pe.id = pa.phase_event_id
      where pa.volunteer_id = me.id
    ), '[]'::jsonb)
  )
  from volunteer me
  where me.access_code = upper(trim(p_code));
$fn$;

create or replace function public.get_organiser_planning(p_code text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $fn$
  select jsonb_build_object(
    'responsable', jsonb_build_object(
      'key',    me.key,
      'prenom', me.first_name,
      'nom',    me.last_name,
      -- The poles this person runs, root keys included, so the grid can preselect the filter.
      -- Empty is the NORMAL answer now: most orgas are not responsables of anything.
      'poleKeys', coalesce((
        select jsonb_agg(distinct p.key)
        from leader_role r join pole p on p.id = r.pole_id
        where r.organiser_id = me.id
      ), '[]'::jsonb)
    ),
    'eventId', me.event_id,
    -- The same envelope the régisseur loads, reused whole rather than rebuilt. One source for
    -- the plan's shape means a field added to the plan reaches this view for free, and cannot
    -- be forgotten here.
    'plan',    loaded.envelope->'plan',
    'version', loaded.envelope->'version'
  )
  from organiser me
  cross join lateral (select load_plan(me.event_id) as envelope) loaded
  where me.access_code <> '' and me.access_code = upper(trim(p_code));
$fn$;

drop function if exists public.get_leader_planning(text);

revoke all on function public.get_volunteer_schedule(text) from public;
grant execute on function public.get_volunteer_schedule(text) to anon, authenticated;

revoke all on function public.get_organiser_planning(text) from public;
grant execute on function public.get_organiser_planning(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The stale-tab guard
--
-- Last, and after every function above has been replaced. A browser built before today writes a
-- plan with no `montage`, no `demontage`, no arrival for any orga and no phase answer for any
-- bénévole: letting one save would wipe both grids in a single write.
-- ---------------------------------------------------------------------------

update app_setting set number = 5 where name = 'min_plan_format';

-- The stored rows are format 5 from the moment the inserts above ran.
update event set plan_format = 5 where plan_format < 5;
