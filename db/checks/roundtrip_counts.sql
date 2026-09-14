-- Did the plan survive the trip into Postgres, entity for entity?
--
-- save_plan already guards the ones that matter most: shifts, volunteers, assignments, orgas,
-- responsable roles and the placements of both phases are counted after every write, and a
-- mismatch raises rather than passing silently. This covers the ones it does not guard, where a
-- reference resolved through a join could have dropped a row without a word: slots, poles,
-- artists, buddy pairs, reserve, artist links, phase poles and événements.
--
-- ONE ROW PER EVENT, and that is the whole point. The first version of this file counted whole
-- tables and reported six slots against three expected, which read as a duplication bug and was
-- simply a second plan sitting in the database. A check that cannot tell those two apart is not
-- a check.
--
-- The `leaders` column named `pole_leader` until 2026-09-10 and had been broken since migration
-- 9 dropped that table: the query simply errored. It reads `organiser` now, which is where those
-- people live.
--
-- The `balanced` fixture, for comparison:
--   slots 3, poles 20, artists 8, shifts 91, orgas 0, volunteers 120, reserve 0,
--   buddies 34, assignments 242, artist_links 33, phase_poles 2, phase_events 0, phase_places 0
--
-- A plan created empty by the picker holds slots 3, phase_poles 2 (one Général per phase) and
-- zero of everything else.

select e.name,
       e.version,
       (select count(*) from event_slot s where s.event_id = e.id) as slots,
       (select count(*) from pole p where p.event_id = e.id) as poles,
       (select count(*) from artist a where a.event_id = e.id) as artists,
       (select count(*) from artist_member m
          join artist a on a.id = m.artist_id
         where a.event_id = e.id) as artist_members,
       (select count(*) from artist_car_trip c
          join artist a on a.id = c.artist_id
         where a.event_id = e.id) as artist_trips,
       (select count(*) from artist_guest g
          join artist a on a.id = g.artist_id
         where a.event_id = e.id) as artist_guests,
       (select count(*) from extra_person x where x.event_id = e.id) as extra_people,
       (select count(*) from ticketing_choice c where c.event_id = e.id) as ticketing_choices,
       (select count(*) from shift s
          join pole p on p.id = s.pole_id
         where p.event_id = e.id) as shifts,
       (select count(*) from organiser o where o.event_id = e.id) as orgas,
       (select count(*) from leader_role r
          join organiser o on o.id = r.organiser_id
         where o.event_id = e.id) as roles_responsable,
       (select count(*) from volunteer v where v.event_id = e.id) as volunteers,
       (select count(*) from volunteer v where v.event_id = e.id and v.on_reserve) as reserve,
       (select count(*) from buddy_pair b
          join volunteer v on v.id = b.from_volunteer_id
         where v.event_id = e.id) as buddies,
       (select count(*) from assignment a
          join volunteer v on v.id = a.volunteer_id
         where v.event_id = e.id) as assignments,
       (select count(*) from volunteer_artist va
          join volunteer v on v.id = va.volunteer_id
         where v.event_id = e.id) as artist_links,
       -- The two phases together. A plan that has never had one configured still has two rows
       -- here, each carrying its Général, which is the state this schema creates them in.
       (select count(*) from phase ph where ph.event_id = e.id) as phases,
       (select count(*) from phase_pole pp
          join phase ph on ph.id = pp.phase_id
         where ph.event_id = e.id) as phase_poles,
       (select count(*) from phase_event pe
          join phase ph on ph.id = pe.phase_id
         where ph.event_id = e.id) as phase_events,
       (select count(*) from phase_assignment pa
          join phase ph on ph.id = pa.phase_id
         where ph.event_id = e.id) as phase_places,
       e.updated_at
from event e
order by e.updated_at nulls first;
