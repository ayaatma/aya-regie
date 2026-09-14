-- migration-sequence: 9
-- Migration 2026-09-09: pole leaders stop being rows and become people.
--
-- WHY. `pole_leader` held one row per person per pole. The same human running the bar and the
-- plonge was two unrelated rows, so the tool could not give them one fiche, one access code, or
-- one answer to "which poles is this person responsible for". That was enough while a leader was
-- a name and a number printed beside a pole. It stops being enough now that leaders fill in a
-- form of their own and log in to read the planning.
--
-- WHAT. `pole_leader` splits in two: `leader` is the person, `leader_role` is one pole they run
-- and when. A person may hold several roles, on several poles or twice on the SAME pole, which
-- is how "de 14h à 18h, puis de 22h à 02h" is written down. Nothing about a role is checked
-- against anything and two windows may overlap, on purpose.
--
-- THE DATA IS CONVERTED, NOT DROPPED. The live event holds leaders typed in by hand since
-- 2026-09-07. Section 2 rebuilds them with the same identity rule the browser uses in
-- `app/src/persistence/normalise.ts` (`splitLegacyLeaders`) and the leaders' importer uses in
-- `tools/src/import-leaders.ts` (`leaderIdentity`): two rows are the same person when they share
-- an e-mail address, and otherwise when they share a name. **THOSE THREE MUST AGREE.** If they
-- diverge, a plan converted by one and re-imported through another gains a duplicate leader, or
-- worse, hands one person another's poles.
--
-- THE NAME IS NOT SPLIT. `full_name` goes to `last_name` whole and `first_name` stays empty.
-- Guessing where a first name ends is wrong for every particle, every compound surname and every
-- person with two given names, and a wrong guess is somebody's name misspelt on the night. The
-- app joins the two with a trim, so each of these still displays exactly the string that was
-- typed, and Réglages separates the handful that predate the form.
--
-- NO ACCESS CODE IS INVENTED HERE. A converted leader gets an empty code, and an empty code can
-- never authenticate: `get_leader_planning` refuses it explicitly. A credential appearing because
-- somebody ran a migration would hand the whole planning to whoever the row happened to name.
-- The régisseur issues them one at a time, on purpose.
--
-- min_plan_format GOES TO 2 in the last section, which is what stops a browser tab left open
-- across this deploy from writing a format 1 document over the converted data. That guard is the
-- whole reason the number exists; this is the first migration to use it.
--
-- ORDER OF SECTIONS MATTERS. The tables exist before the data moves, the data moves before the
-- old table is dropped, and the functions are replaced before the format number rises: between
-- the drop and the replacement no query mentioning leaders would work, and `npm run migrate`
-- runs this whole file in one transaction so no other connection ever sees that gap.

-- ---------------------------------------------------------------------------
-- 1. The two new tables
-- ---------------------------------------------------------------------------

-- Whoever runs a pole, as a person. Split out of `pole_leader` on 2026-09-09: one row per person
-- per pole meant the same human running the bar and the plonge was two unrelated rows, so there
-- was no fiche to show, no single credential to issue, and no answer to "which poles is this
-- person responsible for".
create table leader (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references event(id) on delete cascade,
  key         text not null,
  first_name  text not null default '',
  last_name   text not null default '',
  email       text not null default '',
  phone       text not null default '',
  -- The credential, and the only one a leader has. Longer than a volunteer's on purpose: this
  -- one opens the whole planning, the contact details of every volunteer included, so it guards
  -- what a régisseur's password guards. Empty means no code issued yet, which is where every
  -- leader converted from the old table starts and why the uniqueness below is partial.
  access_code text not null default '',
  -- Kept apart because a caterer reads them differently: a diet is a preference to cater for,
  -- an allergy is a thing that must not be in the food.
  diet        text not null default '',
  allergies   text not null default '',
  note        text not null default '',
  sort_order  int not null default 0,
  unique (event_id, key)
);

-- Two leaders may not share a code. Any number of them may have none yet.
create unique index leader_access_code_key on leader (access_code) where access_code <> '';

create index on leader (event_id);

-- One pole somebody runs, and when. Nothing here is checked against anything: two windows may
-- overlap, and a person may hold two of them on the SAME pole, which is how "de 14h à 18h, puis
-- de 22h à 02h" is written down. A leader is recorded, never scheduled.
create table leader_role (
  id          uuid primary key default gen_random_uuid(),
  leader_id   uuid not null references leader(id) on delete cascade,
  pole_id     uuid not null references pole(id)   on delete cascade,
  key         text not null,
  start_hours numeric(6,2),
  end_hours   numeric(6,2),
  sort_order  int not null default 0,
  -- Per pole, like `shift`. Deliberately NOT unique per (leader, pole): a second role on the
  -- same pole is a second window, and refusing it would lose a legitimate answer.
  unique (pole_id, key)
);

create index on leader_role (leader_id);
create index on leader_role (pole_id);

-- ---------------------------------------------------------------------------
-- 2. The conversion
--
-- Through temporary tables rather than one heroic statement, because the identity expression
-- has to be computed once and then joined against twice: once to build the people, once to hang
-- the roles off them. Repeating it inline in both places is how the two halves drift apart.
-- ---------------------------------------------------------------------------

create temporary table _leader_seed on commit drop as
select p.event_id,
       l.id          as old_id,
       l.pole_id,
       l.key,
       l.full_name,
       l.phone,
       l.email,
       l.note,
       l.start_hours,
       l.end_hours,
       l.sort_order,
       case
         when btrim(l.email) <> '' then 'mail:' || lower(btrim(l.email))
         else 'nom:' || lower(btrim(l.full_name))
       end as identity
from pole_leader l
join pole p on p.id = l.pole_id;

create temporary table _leader_person on commit drop as
select event_id,
       identity,
       min(sort_order) as first_seen,
       (array_agg(full_name order by sort_order, old_id))[1] as full_name,
       -- The first NON-EMPTY answer wins, rather than simply the first: of two rows for one
       -- human, it is common for only one to carry the phone number.
       coalesce(min(nullif(btrim(phone), '')), '') as phone,
       coalesce(min(nullif(btrim(email), '')), '') as email,
       coalesce(min(nullif(btrim(note),  '')), '') as note
from _leader_seed
group by event_id, identity;

alter table _leader_person add column leader_key text;
alter table _leader_person add column ordinal int;

update _leader_person p
set ordinal = r.n,
    -- Prefixed so a leader key can never collide with a role key, which is the old row's key
    -- kept exactly as it was.
    leader_key = 'resp-' || r.n
from (
  select event_id, identity,
         row_number() over (partition by event_id order by first_seen, identity) as n
  from _leader_person
) r
where r.event_id = p.event_id and r.identity = p.identity;

insert into leader (event_id, key, first_name, last_name, email, phone, access_code,
                    diet, allergies, note, sort_order)
select event_id, leader_key, '', full_name, email, phone, '', '', '', note, ordinal - 1
from _leader_person;

-- Every old row becomes exactly one role, keeping its own key so nothing that referred to it by
-- key has to be rewritten.
insert into leader_role (leader_id, pole_id, key, start_hours, end_hours, sort_order)
select nl.id, s.pole_id, s.key, s.start_hours, s.end_hours, s.sort_order
from _leader_seed s
join _leader_person lp on lp.event_id = s.event_id and lp.identity = s.identity
join leader nl on nl.event_id = s.event_id and nl.key = lp.leader_key;

-- Nothing may be lost. One role per old row, or this file raises and the whole transaction rolls
-- back: `npm run migrate` runs each migration in a single transaction, so this is a real guard
-- rather than a hopeful comment.
do $convert$
declare
  n_old int;
  n_new int;
begin
  select count(*) into n_old from pole_leader;
  select count(*) into n_new from leader_role;
  if n_old <> n_new then
    raise exception 'conversion des responsables: % lignes en entrée, % rôles écrits', n_old, n_new;
  end if;
end;
$convert$;

drop table pole_leader;

-- ---------------------------------------------------------------------------
-- 3. Row level security, on the same terms as every other table
-- ---------------------------------------------------------------------------

alter table leader      enable row level security;
alter table leader_role enable row level security;

create policy leader_organiser      on leader      for all to authenticated using (true) with check (true);
create policy leader_role_organiser on leader_role for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. Both directions of the round trip, and the two anonymous doors
--
-- Copied verbatim from db/schema.sql, which is the canonical definition. `npm run schema-check`
-- compares the two halves below against the engine's interfaces field by field, and catches the
-- silent loss nothing else does: a field added to the model and forgotten in ONE of the two
-- functions type-checks, parses, passes the tests, displays on screen, and vanishes at the next
-- save.
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
  leaders as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key',        l.key,
             'firstName',  l.first_name,
             'lastName',   l.last_name,
             'email',      l.email,
             'phone',      l.phone,
             'accessCode', l.access_code,
             'diet',       l.diet,
             'allergies',  l.allergies,
             'note',       l.note) order by l.sort_order, l.key), '[]'::jsonb) as j
    from leader l where l.event_id = p_event_id
  ),
  -- Ordered by the role's own sort order, so the same database always produces the same JSON.
  -- That is what makes the round trip checkable at all.
  leader_roles as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'key',       r.key,
             'leaderKey', l.key,
             'poleKey',   p.key,
             'start',     r.start_hours,
             'end',       r.end_hours) order by r.sort_order, r.key), '[]'::jsonb) as j
    from leader_role r
    join leader l on l.id = r.leader_id
    join pole   p on p.id = r.pole_id
    where l.event_id = p_event_id
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
      'leaderRoles', leader_roles.j,
      'volunteers',  volunteers.j,
      'buddies',     buddies.j,
      'assignments', assignments.j,
      'reserve',     reserve.j))
  from event e, slots, poles, shifts, artists, leaders, leader_roles, volunteers, buddies,
       assignments, reserve
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
  -- cascades to its shifts; leader and pole both cascade to leader_role, which is why the
  -- leaders are deleted explicitly rather than left to follow their poles: a leader belongs to
  -- the event, not to any one pole.
  delete from volunteer  where event_id = p_event_id;
  delete from leader     where event_id = p_event_id;
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

  insert into leader (event_id, key, first_name, last_name, email, phone, access_code,
                      diet, allergies, note, sort_order)
  select p_event_id, x->>'key',
         coalesce(x->>'firstName', ''), coalesce(x->>'lastName', ''),
         coalesce(x->>'email', ''), coalesce(x->>'phone', ''),
         coalesce(x->>'accessCode', ''),
         coalesce(x->>'diet', ''), coalesce(x->>'allergies', ''), coalesce(x->>'note', ''),
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'leaders', '[]'::jsonb)) with ordinality as t(x, ord);

  -- A role naming a leader or a pole that is not in the same document simply does not join, and
  -- the count check at the end of this function turns that silence into a refused save.
  insert into leader_role (leader_id, pole_id, key, start_hours, end_hours, sort_order)
  select l.id, p.id, x->>'key',
         (x->>'start')::numeric, (x->>'end')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'leaderRoles', '[]'::jsonb)) with ordinality as t(x, ord)
  join leader l on l.event_id = p_event_id and l.key = x->>'leaderKey'
  join pole   p on p.event_id = p_event_id and p.key = x->>'poleKey';

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
  select count(*) into n_written from leader l where l.event_id = p_event_id;
  if n_written <> n_expected then
    raise exception 'save_plan: % responsables in, % written', n_expected, n_written;
  end if;

  n_expected := jsonb_array_length(coalesce(p_plan->'leaderRoles', '[]'::jsonb));
  select count(*) into n_written
  from leader_role r join leader l on l.id = r.leader_id where l.event_id = p_event_id;
  if n_written <> n_expected then
    raise exception
      'save_plan: % rôles de responsable in, % written: one names an unknown leader or pole',
      n_expected, n_written;
  end if;
end;
$fn$;

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
               -- One entry per PERSON, not per role: a leader holding two windows on this pole
               -- is still one name and one number to the volunteer reading their schedule.
               coalesce((
                 select jsonb_agg(distinct jsonb_build_object(
                   'nom', btrim(l.first_name || ' ' || l.last_name),
                   'telephone', l.phone,
                   'email', l.email))
                 from leader_role r
                 join leader l on l.id = r.leader_id
                 where r.pole_id = p.id or r.pole_id = parent.id
               ), '[]'::jsonb) as responsables,
               coalesce((
                 select jsonb_agg(o.first_name || ' ' || left(o.last_name, 1) || '.'
                                  order by o.first_name)
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
    ), '[]'::jsonb)
  )
  from volunteer me
  where me.access_code = upper(trim(p_code));
$fn$;

create or replace function public.get_leader_planning(p_code text)
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
      -- Empty is a normal answer: somebody imported but not yet put in charge of anything.
      'poleKeys', coalesce((
        select jsonb_agg(distinct p.key)
        from leader_role r join pole p on p.id = r.pole_id
        where r.leader_id = me.id
      ), '[]'::jsonb)
    ),
    'eventId', me.event_id,
    -- The same envelope the régisseur loads, reused whole rather than rebuilt. One source for
    -- the plan's shape means a field added to the plan reaches the leaders' view for free, and
    -- cannot be forgotten here.
    'plan',    loaded.envelope->'plan',
    'version', loaded.envelope->'version'
  )
  from leader me
  cross join lateral (select load_plan(me.event_id) as envelope) loaded
  where me.access_code <> '' and me.access_code = upper(trim(p_code));
$fn$;

revoke all on function public.get_volunteer_schedule(text) from public;
grant execute on function public.get_volunteer_schedule(text) to anon, authenticated;

revoke all on function public.get_leader_planning(text) from public;
grant execute on function public.get_leader_planning(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The stale-tab guard
--
-- The first real use of this number. A browser built before today writes `leaders` in the old
-- shape and knows nothing of `leaderRoles`, so letting it save would drop every pole a leader
-- runs, in one write, without a word.
-- ---------------------------------------------------------------------------

update app_setting set number = 2 where name = 'min_plan_format';

-- The stored rows are format 2 from the moment the conversion above ran.
update event set plan_format = 2 where plan_format < 2;
