-- migration-sequence: 36
-- Migration 2026-10-22: le suivi par mail, envois groupes et reponses par lien personnel.
--
-- WHY. After the validation, the regisseur sends the validated benevoles a sequence of grouped
-- mails (Loto Tekno: a check of the extra hours, their planning to confirm, the practical
-- information), and wants to see who answered, without ticking a hundred boxes. A mail's link
-- opens the benevole's own page by their code, where they answer in one click.
--
-- WHAT CHANGES.
--   mail_log: step_key (which step a mail is, '' for a validation), planning (the {planning}
--   lines it carried, what « planning modifie depuis l'envoi » compares against), and three more
--   reasons, 'etape', 'relance' and 'test' (a mail sent to the regisseur's test address, which
--   counts for nobody).
--   step_reply, a table of its own and NOT part of the plan document, append only: the answers.
--   answer_step(code, step, answer), the second function an anonymous caller may run: it writes
--   one answer, only to a question that was sent to the holder of the code.
--   get_volunteer_schedule replaced whole: the same, plus 'questions'.
--   The steps' mails live in event.application_steps, a jsonb already written whole: no column.
--
-- APPLY AFTER 35. min_plan_format GOES TO 27: a tab built before this would write every step
-- back without its mail.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- 1. mail_log
-- ---------------------------------------------------------------------------

alter table mail_log add column if not exists step_key text not null default '';
alter table mail_log add column if not exists planning text not null default '';
alter table mail_log drop constraint if exists mail_log_reason_check;
alter table mail_log add constraint mail_log_reason_check
  check (reason in ('validation', 'renvoi', 'etape', 'relance', 'test'));

-- ---------------------------------------------------------------------------
-- 2. step_reply
-- ---------------------------------------------------------------------------

create table if not exists step_reply (
  id            bigint generated always as identity primary key,
  event_id      uuid not null references event(id) on delete cascade,
  volunteer_key text not null,
  step_key      text not null,
  answer        text not null check (answer in ('oui', 'non')),
  mail_id       bigint references mail_log(id) on delete set null,
  source        text not null default 'regie' check (source in ('lien', 'regie')),
  answered_at   timestamptz not null default now(),
  answered_by   uuid default auth.uid()
);

create index if not exists step_reply_person_idx on step_reply (event_id, volunteer_key, step_key, id desc);

alter table step_reply enable row level security;

drop policy if exists step_reply_organiser_select on step_reply;
drop policy if exists step_reply_organiser_insert on step_reply;

create policy step_reply_organiser_select on step_reply for select to authenticated using (true);
create policy step_reply_organiser_insert on step_reply for insert to authenticated with check (true);

-- ---------------------------------------------------------------------------
-- 3. get_volunteer_schedule, with the questions (copied whole from db/schema.sql)
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
    ), '[]'::jsonb),
    -- The questions of the follow-up this person was sent, since 2026-10-22: one per step asking
    -- for a reply whose mail the server accepted, with the answer already given if any. An answer
    -- older than the last mail of a step carrying {planning} answered an older planning and is not
    -- returned: the question is asked again. Same rule as tools/src/followup.ts.
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key',        st.s->>'key',
               'label',      coalesce(st.s->>'label', ''),
               'question',   coalesce(st.s->'mail'->>'question', ''),
               'reply',      st.s->'mail'->>'reply',
               'sentAt',     m.sent_at,
               'answer',     r.answer,
               'answeredAt', r.answered_at)
             order by st.ord)
      from event e
      cross join lateral jsonb_array_elements(e.application_steps) with ordinality as st(s, ord)
      join lateral (
        select ml.sent_at
        from mail_log ml
        where ml.event_id = e.id and ml.person_kind = 'benevole' and ml.person_key = me.key
          and ml.step_key = st.s->>'key' and ml.outcome = 'envoye'
        order by ml.id desc
        limit 1
      ) m on true
      left join lateral (
        select sr.answer, sr.answered_at
        from step_reply sr
        where sr.event_id = e.id and sr.volunteer_key = me.key and sr.step_key = st.s->>'key'
          and (sr.answered_at >= m.sent_at
               or position('{planning}' in coalesce(st.s->'mail'->>'subject', '') || coalesce(st.s->'mail'->>'body', '')) = 0)
        order by sr.id desc
        limit 1
      ) r on true
      where e.id = me.event_id
        and coalesce(st.s->'mail'->>'reply', 'aucune') in ('confirmer', 'oui-non')
    ), '[]'::jsonb)
  )
  from volunteer me
  where me.access_code = upper(trim(p_code));
$fn$;

revoke all on function public.get_volunteer_schedule(text) from public;
grant execute on function public.get_volunteer_schedule(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. answer_step (copied whole from db/schema.sql)
-- ---------------------------------------------------------------------------

create or replace function public.answer_step(p_code text, p_step text, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event uuid;
  v_key   text;
  v_reply text;
  v_mail  bigint;
  v_at    timestamptz;
begin
  -- An empty code is the state of a benevole nobody issued one to: it opens nothing.
  if p_answer is null or p_answer not in ('oui', 'non') or btrim(coalesce(p_code, '')) = '' then
    return null;
  end if;

  select me.event_id, me.key into v_event, v_key
  from volunteer me
  where me.access_code = upper(trim(p_code));
  if v_event is null then
    return null;
  end if;

  select st.s->'mail'->>'reply' into v_reply
  from event e
  cross join lateral jsonb_array_elements(e.application_steps) as st(s)
  where e.id = v_event and st.s->>'key' = p_step
  limit 1;
  if v_reply is null or v_reply not in ('confirmer', 'oui-non') then
    return null;
  end if;
  if v_reply = 'confirmer' and p_answer <> 'oui' then
    return null;
  end if;

  select ml.id into v_mail
  from mail_log ml
  where ml.event_id = v_event and ml.person_kind = 'benevole' and ml.person_key = v_key
    and ml.step_key = p_step and ml.outcome = 'envoye'
  order by ml.id desc
  limit 1;
  if v_mail is null then
    return null;
  end if;

  if (select count(*) from step_reply r
      where r.event_id = v_event and r.volunteer_key = v_key and r.step_key = p_step) >= 50 then
    return null;
  end if;

  insert into step_reply (event_id, volunteer_key, step_key, answer, mail_id, source, answered_by)
  values (v_event, v_key, p_step, p_answer, v_mail, 'lien', null)
  returning answered_at into v_at;

  return jsonb_build_object('key', p_step, 'answer', p_answer, 'answeredAt', v_at);
end;
$fn$;

revoke all on function public.answer_step(text, text, text) from public, anon, authenticated;
grant execute on function public.answer_step(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The writers' format
-- ---------------------------------------------------------------------------

update app_setting set number = 27 where name = 'min_plan_format';
