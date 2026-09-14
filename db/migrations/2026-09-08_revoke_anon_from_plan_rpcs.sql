-- migration-sequence: 4
-- Migration 2026-09-08: shut the organiser functions to the anonymous key.
--
-- Found by calling the live project with the anon key, which is the only way this shows up:
-- list_plans, load_plan and save_plan all answered. They should not be reachable at all without
-- a session.
--
-- Cause. Supabase grants EXECUTE on every new function in the public schema to anon,
-- authenticated and service_role through default privileges. `revoke all ... from public` does
-- not undo that, because PUBLIC and anon are different grantees: revoking from one leaves the
-- other exactly where it was.
--
-- Row level security meant an anonymous caller still saw no rows and could write nothing, so no
-- data was ever exposed. That is not a reason to leave the door: an entry point that should not
-- exist is not made safe by happening to be empty.
--
-- get_volunteer_schedule and get_public_planning stay open to anon on purpose. They are the
-- volunteer's way in, they are SECURITY DEFINER, and they filter inside Postgres.
--
-- Safe to re-run.

revoke all on function public.load_plan(uuid)               from public, anon;
revoke all on function private.write_plan_body(uuid, jsonb) from public, anon;
revoke all on function public.save_plan(uuid, int, jsonb)   from public, anon;
revoke all on function public.create_plan(jsonb)            from public, anon;
revoke all on function public.list_plans()                  from public, anon;

-- Unchanged, and restated so this file leaves the grants in a known state.
grant usage   on schema private                             to authenticated;
grant execute on function public.load_plan(uuid)            to authenticated;
grant execute on function private.write_plan_body(uuid, jsonb) to authenticated;
grant execute on function public.save_plan(uuid, int, jsonb) to authenticated;
grant execute on function public.create_plan(jsonb)          to authenticated;
grant execute on function public.list_plans()                to authenticated;
