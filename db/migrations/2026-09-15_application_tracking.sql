-- migration-sequence: 24
-- Migration 2026-09-15: le suivi des candidatures.
--
-- WHY. A field test on another festival showed how a volunteer team is actually run: every
-- registration is decided (validee, annulee, liste d'attente) and followed through a sequence of
-- messages (confirmation sent, presence reconfirmed...). About one registration in five was
-- cancelled, and this tool had no way to say so other than deleting somebody. Two answers of the
-- same form come with it: ready to reinforce beyond one's volume (the new Reserve; the old reserve
-- is called Liste d'attente on every screen from today, on_reserve is unchanged), and stamina.
--
-- WHAT CHANGES.
--   event.application_steps, new, the three default steps for every event already there.
--   volunteer.status ('candidature' for everybody already there), status_steps, regie_note,
--   registered_at, backup, energy, all new.
--   load_plan and write_plan_body replaced whole, identical to migration 23's but for those.
--
-- min_plan_format GOES TO 16. A tab built before today would write every benevole back as a fresh
-- candidature with nothing ticked.
--
-- Idempotent: re-running it changes nothing.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

alter table event add column if not exists application_steps jsonb not null default
  '[{"key":"confirmation","label":"Mail de confirmation envoyé"},{"key":"reconfirmee","label":"Présence reconfirmée"},{"key":"infos","label":"Infos pratiques envoyées"}]'::jsonb;

alter table volunteer add column if not exists status text not null default 'candidature';
alter table volunteer add column if not exists status_steps text[] not null default '{}';
alter table volunteer add column if not exists regie_note text not null default '';
alter table volunteer add column if not exists registered_at text not null default '';
alter table volunteer add column if not exists backup boolean not null default false;
alter table volunteer add column if not exists energy text;

do $chk$
begin
  if not exists (select 1 from pg_constraint where conname = 'event_application_steps_check') then
    alter table event add constraint event_application_steps_check
      check (jsonb_typeof(application_steps) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'volunteer_status_check') then
    alter table volunteer add constraint volunteer_status_check
      check (status in ('candidature', 'valide', 'annule'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'volunteer_energy_check') then
    alter table volunteer add constraint volunteer_energy_check
      check (energy in ('fonce', 'regulier', 'fatigable', 'premiere'));
  end if;
end;
$chk$;

-- ---------------------------------------------------------------------------
-- The two functions that carry a plan in and out, replaced whole
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
    from event_slot s where s.event_id = p_event_id and s.kind = 'refusal'
  ),
  preference_slots as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',            s.slot_key,
             'label',         s.label,
             'start',         s.start_hours,
             'end',           s.end_hours,
             'overflowHours', s.overflow_hours) order by s.sort_order, s.slot_key), '[]'::jsonb) as j
    from event_slot s where s.event_id = p_event_id and s.kind = 'preference'
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
             'key',                a.key,
             'name',               a.name,
             'start',              a.start_hours,
             'end',                a.end_hours,
             'size',               a.size,
             'changeoverBefore',   a.changeover_before,
             'changeoverAfter',    a.changeover_after,
             'trainTickets',       a.train_tickets,
             'trainDone',          a.train_done,
             'trainCost',          a.train_cost,
             'planeTickets',       a.plane_tickets,
             'planeDone',          a.plane_done,
             'planeCost',          a.plane_cost,
             'contactPhone',       a.contact_phone,
             'technicalNeeds',     a.technical_needs,
             'patchSize',          a.patch_size,
             'notes',              a.notes,
             'soundcheckNeeded',   a.soundcheck_needed,
             'soundcheckStart',    a.soundcheck_start,
             'soundcheckEnd',      a.soundcheck_end,
             'soundcheckEngineer', a.soundcheck_engineer,
             'extraGuests', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'key',       g.key,
                        'firstName', g.first_name,
                        'lastName',  g.last_name)
                      order by g.sort_order, g.key)
               from artist_guest g where g.artist_id = a.id and g.member_id is null), '[]'::jsonb),
             'members', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'key',          m.key,
                        'firstName',    m.first_name,
                        'lastName',     m.last_name,
                        'role',         m.role,
                        'diet',         m.diet,
                        'allergies',    m.allergies,
                        -- Null travels as null: "follow the event's figure".
                        'drinkTickets', m.drink_tickets,
                        'payment',      m.payment,
                        'guests', coalesce((
                          select jsonb_agg(jsonb_build_object(
                                   'key',       g.key,
                                   'firstName', g.first_name,
                                   'lastName',  g.last_name)
                                 order by g.sort_order, g.key)
                          from artist_guest g where g.member_id = m.id), '[]'::jsonb),
                        'linkedKind',   case when m.organiser_id is not null then 'orga'
                                             when m.volunteer_id is not null then 'benevole'
                                             else null end,
                        'linkedKey',    coalesce(mo.key, mv.key, ''))
                      order by m.sort_order, m.key)
               from artist_member m
               left join organiser mo on mo.id = m.organiser_id
               left join volunteer mv on mv.id = m.volunteer_id
               where m.artist_id = a.id), '[]'::jsonb),
             'carTrips', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'key',               c.key,
                        'fromAddress',       c.from_address,
                        'fromVenue',         c.from_venue,
                        'toAddress',         c.to_address,
                        'toVenue',           c.to_venue,
                        'fuel',              c.fuel,
                        'consumptionPer100', c.consumption_per_100,
                        'tolls',             c.tolls,
                        -- Null travels as null: not computed, not typed.
                        'distanceKm',        c.distance_km,
                        'cost',              c.cost)
                      order by c.sort_order, c.key)
               from artist_car_trip c where c.artist_id = a.id), '[]'::jsonb))
           order by a.sort_order, a.key), '[]'::jsonb) as j
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
             'preferredSlotId', v.preferred_slot_key,
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
             -- In rank order; an unresolved choice has no pole and keeps its answer.
             'choices',         coalesce((
                                  select jsonb_agg(jsonb_build_object(
                                           'poleKey', coalesce(cp.key, ''),
                                           'raw',     vc.raw,
                                           'level',   vc.level) order by vc.rank)
                                  from volunteer_choice vc
                                  left join pole cp on cp.id = vc.pole_id
                                  where vc.volunteer_id = v.id), '[]'::jsonb),
             'artistKeys',      coalesce((
                                  select jsonb_agg(a.key order by a.sort_order, a.key)
                                  from volunteer_artist va
                                  join artist a on a.id = va.artist_id
                                  where va.volunteer_id = v.id), '[]'::jsonb),
             'buddyRawNames',   to_jsonb(v.buddy_raw_names),
             'manualFields',    to_jsonb(v.manual_fields),
             'needsReview',     v.needs_review,
             'reviewReasons',   to_jsonb(v.review_reasons),
             'enteredByHand',   v.entered_by_hand,
             'status',          v.status,
             'statusSteps',     to_jsonb(v.status_steps),
             'regieNote',       v.regie_note,
             'registeredAt',    v.registered_at,
             'backup',          v.backup,
             'energy',          v.energy,
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
    where v.event_id = p_event_id
  ),
  buddies as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'fromKey', f.key,
             'toKey',   t.key)
             || case when b.manual then jsonb_build_object('manual', true) else '{}'::jsonb end
             order by b.sort_order, f.key, t.key), '[]'::jsonb) as j
    from buddy_pair b
    join volunteer f on f.id = b.from_volunteer_id
    join volunteer t on t.id = b.to_volunteer_id
    where f.event_id = p_event_id and not b.dismissed
  ),
  dismissed_buddies as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'fromKey', f.key,
             'toKey',   t.key) order by b.sort_order, f.key, t.key), '[]'::jsonb) as j
    from buddy_pair b
    join volunteer f on f.id = b.from_volunteer_id
    join volunteer t on t.id = b.to_volunteer_id
    where f.event_id = p_event_id and b.dismissed
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
        'artistDrinks',      e.artist_drinks,
        'artistDrinksCumulative', e.artist_drinks_cumulative,
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
                 'personKind', case when mc.organiser_id is not null then 'orga'
                                    when mc.artist_member_id is not null then 'artiste'
                                    else 'benevole' end,
                 'personKey',  coalesce(mo.key, mv.key, mm.key),
                 'serviceKey', mc.service_key,
                 'takes',      mc.takes)
               order by mc.sort_order, mc.service_key)
        from meal_choice mc
        left join organiser mo on mo.id = mc.organiser_id
        left join volunteer mv on mv.id = mc.volunteer_id
        left join artist_member mm on mm.id = mc.artist_member_id
        left join artist ma on ma.id = mm.artist_id
        where coalesce(mo.event_id, mv.event_id, ma.event_id) = e.id), '[]'::jsonb)) as j
    from event e where e.id = p_event_id
  ),
  -- La billetterie: the configuration and the hand-picked rows. The list itself is derived.
  ticketing as (
    select jsonb_build_object(
      'guestsPerArtist', e.guests_per_artist,
      'reserveOnDoorList', e.reserve_on_door_list,
      'ticketTypes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'key',   t.key,
                 'label', t.label,
                 'start', t.start_hours,
                 'end',   t.end_hours)
               order by t.sort_order, t.key)
        from ticket_type t where t.event_id = e.id), '[]'::jsonb),
      'bracelets', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'key',   b.key,
                 'label', b.label,
                 'defaultFor', coalesce((
                   select jsonb_agg(d.status order by d.sort_order, d.status)
                   from bracelet_default d where d.bracelet_id = b.id), '[]'::jsonb))
               order by b.sort_order, b.key)
        from bracelet_type b where b.event_id = e.id), '[]'::jsonb),
      'extras', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'key',          x.key,
                 'firstName',    x.first_name,
                 'lastName',     x.last_name,
                 'status',       x.status,
                 'phone',        x.phone,
                 'drinkTickets', x.drink_tickets,
                 'mealTickets',  x.meal_tickets)
               order by x.sort_order, x.key)
        from extra_person x where x.event_id = e.id), '[]'::jsonb),
      'choices', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'personKind',    c.person_kind,
                 'personKey',     c.person_key,
                 'ticketTypeKey', ct.key,
                 'braceletKey',   cb.key,
                 'drinkTickets',  c.drink_tickets,
                 'note',          c.note)
               order by c.sort_order, c.person_kind, c.person_key)
        from ticketing_choice c
        left join ticket_type   ct on ct.id = c.ticket_type_id
        left join bracelet_type cb on cb.id = c.bracelet_id
        where c.event_id = e.id), '[]'::jsonb)) as j
    from event e where e.id = p_event_id
  ),
  travel as (
    select jsonb_build_object(
      'fuelPrices', jsonb_build_object(
        'essence',    e.fuel_price_essence,
        'diesel',     e.fuel_price_diesel,
        'electrique', e.fuel_price_electrique,
        'gpl',        e.fuel_price_gpl,
        'autre',      e.fuel_price_autre),
      'tollPerKm', e.toll_per_km) as j
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
      'address',     e.address,
      'rules', jsonb_build_object(
        'maxConsecutiveHours',    e.max_consecutive_hours,
        'maxBlocks',              e.max_blocks,
        'minBreakHours',          e.min_break_hours,
        'minHoursPerPerson',      e.min_hours_per_person),
      'slots',       slots.j,
      'preferenceSlots', preference_slots.j,
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
      'catering',    catering.j,
      'ticketing',   ticketing.j,
      'travel',      travel.j,
      'constraints', e.constraint_settings,
      'poleChoicesRanked', e.pole_choices_ranked,
      'volume', jsonb_build_object(
        'scope',        e.volume_scope,
        'dayStartHour', e.day_start_hour,
        'options',      to_jsonb(e.volume_options)),
      'formMapping', e.form_mapping,
      'applicationSteps', e.application_steps,
      'dismissedBuddies', dismissed_buddies.j))
  from event e, slots, preference_slots, poles, shifts, artists, organisers, leader_roles, volunteers, buddies,
       dismissed_buddies, assignments, reserve, organiser_shifts, catering, ticketing, travel
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
  -- here: it hangs off volunteer, organiser and artist_member, which were deleted above, and it
  -- went with them.
  delete from catering_service_window where event_id = p_event_id;
  delete from catering_meal_tier      where event_id = p_event_id;
  -- La billetterie, rewritten whole. ticketing_choice goes first: it points at the two types.
  delete from ticketing_choice where event_id = p_event_id;
  delete from ticket_type      where event_id = p_event_id;
  delete from bracelet_type    where event_id = p_event_id;
  delete from extra_person     where event_id = p_event_id;

  update event set
    name                     = p_plan->>'name',
    starts_at                = (p_plan->>'startISO')::timestamptz,
    length_hours             = (p_plan->>'lengthHours')::numeric,
    sheet_url                = coalesce(p_plan->>'sheetUrl', ''),
    address                  = coalesce(p_plan->>'address', ''),
    max_consecutive_hours    = (p_plan#>>'{rules,maxConsecutiveHours}')::numeric,
    max_blocks               = (p_plan#>>'{rules,maxBlocks}')::int,
    min_break_hours          = (p_plan#>>'{rules,minBreakHours}')::numeric,
    min_hours_per_person     = (p_plan#>>'{rules,minHoursPerPerson}')::numeric,
    -- Absent from anything written before PLAN_FORMAT 7, and the defaults are then the state a
    -- plan with no catering opens in: off, with the Loto Tekno figures behind it.
    catering_enabled      = coalesce((p_plan#>>'{catering,rules,enabled}')::boolean, false),
    drink_per_hours       = coalesce((p_plan#>>'{catering,rules,drinkPerHours}')::numeric, 2),
    drink_counts_phases   = coalesce((p_plan#>>'{catering,rules,drinkCountsPhases}')::boolean, false),
    organiser_meals       = coalesce((p_plan#>>'{catering,rules,organiserMeals}')::int, 2),
    organiser_drinks      = coalesce((p_plan#>>'{catering,rules,organiserDrinks}')::int, 2),
    artist_drinks         = coalesce((p_plan#>>'{catering,rules,artistDrinks}')::int, 2),
    artist_drinks_cumulative = coalesce((p_plan#>>'{catering,rules,artistDrinksCumulative}')::boolean, false),
    guests_per_artist     = coalesce((p_plan#>>'{ticketing,guestsPerArtist}')::int, 1),
    reserve_on_door_list  = coalesce((p_plan#>>'{ticketing,reserveOnDoorList}')::boolean, false),
    fuel_price_essence    = coalesce((p_plan#>>'{travel,fuelPrices,essence}')::numeric, 1.75),
    fuel_price_diesel     = coalesce((p_plan#>>'{travel,fuelPrices,diesel}')::numeric, 1.70),
    fuel_price_electrique = coalesce((p_plan#>>'{travel,fuelPrices,electrique}')::numeric, 0.22),
    fuel_price_gpl        = coalesce((p_plan#>>'{travel,fuelPrices,gpl}')::numeric, 0.95),
    fuel_price_autre      = coalesce((p_plan#>>'{travel,fuelPrices,autre}')::numeric, 1.75),
    toll_per_km           = coalesce((p_plan#>>'{travel,tollPerKm}')::numeric, 0.10),
    -- Absent from anything written before PLAN_FORMAT 12, and anything that is not an object is
    -- the defaults too: the column's check would otherwise refuse the whole save for one field.
    constraint_settings   = case when jsonb_typeof(p_plan->'constraints') = 'object'
                                 then p_plan->'constraints' else '{}'::jsonb end,
    -- Absent from anything written before PLAN_FORMAT 13: ranked, per event, 4, 6 or 8, noon.
    pole_choices_ranked   = coalesce((p_plan->>'poleChoicesRanked')::boolean, true),
    volume_scope          = case when p_plan#>>'{volume,scope}' = 'day' then 'day' else 'event' end,
    day_start_hour        = coalesce((p_plan#>>'{volume,dayStartHour}')::numeric, 12),
    volume_options        = coalesce((select array_agg((o #>> '{}')::numeric order by (o #>> '{}')::numeric)
                                      from jsonb_array_elements(case when jsonb_typeof(p_plan#>'{volume,options}') = 'array'
                                                                     then p_plan#>'{volume,options}' else '[]'::jsonb end) as vo(o)),
                                     '{4,6,8}'),
    form_mapping          = case when jsonb_typeof(p_plan->'formMapping') = 'object'
                                 then p_plan->'formMapping' else '{}'::jsonb end,
    -- Absent from anything written before PLAN_FORMAT 16: the column keeps what it holds.
    application_steps     = case when jsonb_typeof(p_plan->'applicationSteps') = 'array'
                                 then p_plan->'applicationSteps' else application_steps end
  where id = p_event_id;

  insert into ticket_type (event_id, key, label, start_hours, end_hours, sort_order)
  select p_event_id, x->>'key', coalesce(x->>'label', ''),
         (x->>'start')::numeric, (x->>'end')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan#>'{ticketing,ticketTypes}', '[]'::jsonb))
       with ordinality as t(x, ord);

  insert into bracelet_type (event_id, key, label, sort_order)
  select p_event_id, x->>'key', coalesce(x->>'label', ''), (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan#>'{ticketing,bracelets}', '[]'::jsonb))
       with ordinality as t(x, ord);

  insert into bracelet_default (bracelet_id, status, sort_order)
  select b.id, st.status, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan#>'{ticketing,bracelets}', '[]'::jsonb)) as t(x)
  join bracelet_type b on b.event_id = p_event_id and b.key = x->>'key'
  cross join lateral jsonb_array_elements_text(coalesce(x->'defaultFor', '[]'::jsonb))
             with ordinality as st(status, ord)
  on conflict do nothing;

  insert into extra_person (event_id, key, first_name, last_name, status, phone,
                            drink_tickets, meal_tickets, sort_order)
  select p_event_id, x->>'key', coalesce(x->>'firstName', ''), coalesce(x->>'lastName', ''),
         coalesce(x->>'status', 'autre'), coalesce(x->>'phone', ''),
         coalesce((x->>'drinkTickets')::int, 0), coalesce((x->>'mealTickets')::int, 0),
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan#>'{ticketing,extras}', '[]'::jsonb))
       with ordinality as t(x, ord);

  -- A choice naming a ticket type or a bracelet the plan no longer holds loses that half; a
  -- choice left with nothing at all is not written, which is what "the default" means.
  insert into ticketing_choice (event_id, person_kind, person_key, ticket_type_id, bracelet_id,
                                drink_tickets, note, sort_order)
  select p_event_id, x->>'personKind', x->>'personKey', ct.id, cb.id,
         (x->>'drinkTickets')::int, coalesce(x->>'note', ''), (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan#>'{ticketing,choices}', '[]'::jsonb))
       with ordinality as t(x, ord)
  left join ticket_type   ct on ct.event_id = p_event_id and ct.key = x->>'ticketTypeKey'
  left join bracelet_type cb on cb.event_id = p_event_id and cb.key = x->>'braceletKey'
  where num_nonnulls(ct.id, cb.id, (x->>'drinkTickets')::int) >= 1 or coalesce(x->>'note', '') <> ''
  on conflict do nothing;

  insert into catering_service_window (event_id, key, label, from_hour, to_hour, sort_order)
  select p_event_id, x->>'key', coalesce(x->>'label', ''),
         (x->>'fromHour')::numeric, (x->>'toHour')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan#>'{catering,rules,services}', '[]'::jsonb))
       with ordinality as t(x, ord);

  insert into catering_meal_tier (event_id, from_hours, meals, sort_order)
  select p_event_id, (x->>'fromHours')::numeric, (x->>'meals')::int, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan#>'{catering,rules,exploitTiers}', '[]'::jsonb))
       with ordinality as t(x, ord);

  insert into event_slot (event_id, kind, slot_key, label, start_hours, end_hours, sort_order)
  select p_event_id, 'refusal', x->>'id', x->>'label',
         (x->>'start')::numeric, (x->>'end')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'slots', '[]'::jsonb)) with ordinality as t(x, ord);

  insert into event_slot (event_id, kind, slot_key, label, start_hours, end_hours,
                          overflow_hours, sort_order)
  select p_event_id, 'preference', x->>'id', x->>'label',
         (x->>'start')::numeric, (x->>'end')::numeric,
         coalesce((x->>'overflowHours')::numeric, 0), (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'preferenceSlots', '[]'::jsonb))
       with ordinality as t(x, ord);

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

  -- Every column past the set's hours is absent from a plan written before PLAN_FORMAT 9, and
  -- each default is the state an act nobody has filled in is in.
  insert into artist (event_id, key, name, start_hours, end_hours, sort_order,
                      size, changeover_before, changeover_after,
                      train_tickets, train_done, train_cost, plane_tickets, plane_done, plane_cost,
                      contact_phone, technical_needs, patch_size, notes,
                      soundcheck_needed, soundcheck_start, soundcheck_end, soundcheck_engineer)
  select p_event_id, x->>'key', x->>'name',
         (x->>'start')::numeric, (x->>'end')::numeric, (ord - 1)::int,
         coalesce((x->>'size')::int, 1),
         coalesce((x->>'changeoverBefore')::numeric, 0),
         coalesce((x->>'changeoverAfter')::numeric, 0),
         coalesce((x->>'trainTickets')::int, 0),
         coalesce((x->>'trainDone')::boolean, false),
         coalesce((x->>'trainCost')::numeric, 0),
         coalesce((x->>'planeTickets')::int, 0),
         coalesce((x->>'planeDone')::boolean, false),
         coalesce((x->>'planeCost')::numeric, 0),
         coalesce(x->>'contactPhone', ''),
         coalesce(x->>'technicalNeeds', ''),
         coalesce((x->>'patchSize')::int, 0),
         coalesce(x->>'notes', ''),
         coalesce((x->>'soundcheckNeeded')::boolean, false),
         coalesce((x->>'soundcheckStart')::numeric, (x->>'start')::numeric),
         coalesce((x->>'soundcheckEnd')::numeric, (x->>'end')::numeric),
         coalesce((x->>'soundcheckEngineer')::boolean, false)
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
                         requested_hours, preferred_slot_key, availability_note,
                         buddy_raw_names, manual_fields, needs_review, review_reasons,
                         montage_present, montage_note, demontage_present, demontage_note,
                         on_reserve, entered_by_hand,
                         status, status_steps, regie_note, registered_at, backup, energy,
                         sort_order)
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
         (x->>'requestedHours')::numeric,
         nullif(x->>'preferredSlotId', ''),
         coalesce(x->>'availabilityNote', ''),
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
         coalesce((x->>'enteredByHand')::boolean, false),
         case when x->>'status' in ('candidature', 'valide', 'annule') then x->>'status' else 'candidature' end,
         coalesce((select array_agg(step #>> '{}')
                   from jsonb_array_elements(case when jsonb_typeof(x->'statusSteps') = 'array'
                                                  then x->'statusSteps' else '[]'::jsonb end)
                        as ss(step)),
                  '{}'::text[]),
         coalesce(x->>'regieNote', ''),
         coalesce(x->>'registeredAt', ''),
         coalesce((x->>'backup')::boolean, false),
         case when x->>'energy' in ('fonce', 'regulier', 'fatigable', 'premiere') then x->>'energy' end,
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'volunteers', '[]'::jsonb))
       with ordinality as t(x, ord)
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

  -- A list, in order: the rank is the position in the JSON. A choice naming a pole the plan does
  -- not hold keeps its answer and loses the pole, which is how the engine reads it.
  insert into volunteer_choice (volunteer_id, rank, pole_id, raw, level)
  select v.id, (ch.ord - 1)::int, p.id, coalesce(ch.c->>'raw', ''),
         coalesce((ch.c->>'level')::skill_level, 'debutant')
  from jsonb_array_elements(coalesce(p_plan->'volunteers', '[]'::jsonb)) as t(x)
  join volunteer v on v.event_id = p_event_id and v.key = x->>'key'
  cross join lateral jsonb_array_elements(coalesce(x->'choices', '[]'::jsonb)) with ordinality as ch(c, ord)
  left join pole p on p.event_id = p_event_id and p.key = ch.c->>'poleKey';

  insert into volunteer_artist (volunteer_id, artist_id)
  select v.id, a.id
  from jsonb_array_elements(coalesce(p_plan->'volunteers', '[]'::jsonb)) as t(x)
  join volunteer v on v.event_id = p_event_id and v.key = x->>'key'
  cross join lateral jsonb_array_elements(coalesce(x->'artistKeys', '[]'::jsonb)) as ak(k)
  join artist a on a.event_id = p_event_id and a.key = k #>> '{}'
  on conflict do nothing;

  -- After the people, because a member may point at one of them. A link naming somebody the
  -- plan does not hold is written as no link, which is exactly how the engine reads it.
  insert into artist_member (artist_id, key, first_name, last_name, role, diet, allergies,
                             drink_tickets, payment, volunteer_id, organiser_id,
                             sort_order)
  select a.id, m->>'key',
         coalesce(m->>'firstName', ''), coalesce(m->>'lastName', ''),
         coalesce(m->>'role', 'musicien'),
         coalesce(m->>'diet', ''), coalesce(m->>'allergies', ''),
         -- A JSON null reads as SQL null here, which is the "follow the setting" it means.
         (m->>'drinkTickets')::int,
         coalesce(m->>'payment', 'cash'),
         lv.id, lo.id,
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'artists', '[]'::jsonb)) as t(x)
  join artist a on a.event_id = p_event_id and a.key = x->>'key'
  cross join lateral jsonb_array_elements(coalesce(x->'members', '[]'::jsonb))
             with ordinality as e(m, ord)
  left join volunteer lv on lv.event_id = p_event_id and m->>'linkedKind' = 'benevole'
                        and lv.key = m->>'linkedKey'
  left join organiser lo on lo.event_id = p_event_id and m->>'linkedKind' = 'orga'
                        and lo.key = m->>'linkedKey';

  -- The guests: a member's, then the act's own. Written after the members they hang off.
  insert into artist_guest (artist_id, member_id, key, first_name, last_name, sort_order)
  select a.id, m.id, g->>'key', coalesce(g->>'firstName', ''), coalesce(g->>'lastName', ''),
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'artists', '[]'::jsonb)) as t(x)
  join artist a on a.event_id = p_event_id and a.key = x->>'key'
  cross join lateral jsonb_array_elements(coalesce(x->'members', '[]'::jsonb)) as e(mx)
  join artist_member m on m.artist_id = a.id and m.key = mx->>'key'
  cross join lateral jsonb_array_elements(coalesce(mx->'guests', '[]'::jsonb))
             with ordinality as gg(g, ord);

  insert into artist_guest (artist_id, member_id, key, first_name, last_name, sort_order)
  select a.id, null, g->>'key', coalesce(g->>'firstName', ''), coalesce(g->>'lastName', ''),
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'artists', '[]'::jsonb)) as t(x)
  join artist a on a.event_id = p_event_id and a.key = x->>'key'
  cross join lateral jsonb_array_elements(coalesce(x->'extraGuests', '[]'::jsonb))
             with ordinality as gg(g, ord);

  insert into artist_car_trip (artist_id, key, from_address, from_venue, to_address, to_venue,
                               fuel, consumption_per_100, tolls, distance_km, cost, sort_order)
  select a.id, c->>'key',
         coalesce(c->>'fromAddress', ''), coalesce((c->>'fromVenue')::boolean, false),
         coalesce(c->>'toAddress', ''),   coalesce((c->>'toVenue')::boolean, true),
         coalesce(c->>'fuel', 'essence'),
         coalesce((c->>'consumptionPer100')::numeric, 0),
         coalesce((c->>'tolls')::boolean, true),
         (c->>'distanceKm')::numeric, (c->>'cost')::numeric,
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'artists', '[]'::jsonb)) as t(x)
  join artist a on a.event_id = p_event_id and a.key = x->>'key'
  cross join lateral jsonb_array_elements(coalesce(x->'carTrips', '[]'::jsonb))
             with ordinality as e(c, ord);

  insert into buddy_pair (from_volunteer_id, to_volunteer_id, manual, sort_order)
  select f.id, t.id, coalesce((x->>'manual')::boolean, false), (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'buddies', '[]'::jsonb)) with ordinality as e(x, ord)
  join volunteer f on f.event_id = p_event_id and f.key = x->>'fromKey'
  join volunteer t on t.event_id = p_event_id and t.key = x->>'toKey'
  on conflict do nothing;

  -- The removed pairs after the planned ones: a pair both planned and removed is planned.
  insert into buddy_pair (from_volunteer_id, to_volunteer_id, dismissed, sort_order)
  select f.id, t.id, true, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan->'dismissedBuddies', '[]'::jsonb)) with ordinality as e(x, ord)
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
  insert into meal_choice (volunteer_id, organiser_id, artist_member_id, service_key, takes,
                           sort_order)
  select mv.id, mo.id, mm.id, x->>'serviceKey', coalesce((x->>'takes')::boolean, false),
         (ord - 1)::int
  from jsonb_array_elements(coalesce(p_plan#>'{catering,choices}', '[]'::jsonb))
       with ordinality as t(x, ord)
  left join volunteer mv on mv.event_id = p_event_id and x->>'personKind' = 'benevole'
                        and mv.key = x->>'personKey'
  left join organiser mo on mo.event_id = p_event_id and x->>'personKind' = 'orga'
                        and mo.key = x->>'personKey'
  left join artist ma on ma.event_id = p_event_id and x->>'personKind' = 'artiste'
  left join artist_member mm on mm.artist_id = ma.id and mm.key = x->>'personKey'
  where num_nonnulls(mv.id, mo.id, mm.id) = 1;

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
  left join artist_member mm on mm.id = mc.artist_member_id
  left join artist ma on ma.id = mm.artist_id
  where coalesce(mv.event_id, mo.event_id, ma.event_id) = p_event_id;
  if n_written <> n_expected then
    raise exception
      'save_plan: % repas coches in, % written: un nomme une personne inconnue',
      n_expected, n_written;
  end if;

  n_expected := (
    select coalesce(sum(jsonb_array_length(coalesce(x->'extraGuests', '[]'::jsonb))), 0)
         + coalesce(sum((select coalesce(sum(jsonb_array_length(coalesce(mx->'guests', '[]'::jsonb))), 0)
                         from jsonb_array_elements(coalesce(x->'members', '[]'::jsonb)) as e(mx))), 0)
    from jsonb_array_elements(coalesce(p_plan->'artists', '[]'::jsonb)) as t(x));
  select count(*) into n_written
  from artist_guest g join artist a on a.id = g.artist_id where a.event_id = p_event_id;
  if n_written <> n_expected then
    raise exception
      'save_plan: % invites in, % written: un nomme un groupe ou un membre inconnu',
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
-- The guard against a stale tab
-- ---------------------------------------------------------------------------

update app_setting set number = 16 where name = 'min_plan_format';
