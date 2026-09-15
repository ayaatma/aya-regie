-- Loto Tekno volunteer planning: Postgres / Supabase schema.
--
-- Naming is English (code side). Every string a volunteer or a pole leader reads is French and
-- lives in the front end, never here.
--
-- Four rules this schema encodes, that the rest of the app depends on:
--
--   1. Nothing is readable by an anonymous client. Volunteers reach their own data only through
--      get_volunteer_schedule(code), which filters inside Postgres.
--
--   2. No scheduling rule is enforced as a database constraint. The validation engine owns them,
--      because a regisseur must always be able to save a plan that is temporarily wrong and see
--      it flagged in red, rather than be blocked by a constraint violation.
--
--   3. THE TABLES MIRROR THE ENGINE'S `Plan`, KEY FOR KEY. Every entity carries the engine's own
--      `key` (a readable slug such as 'bar--service' or 'nom:marie-dupont') next to its uuid, and
--      that key, not the uuid, is what every reference in a saved plan resolves through. The uuid
--      stays because Supabase and the foreign keys want one.
--
--   4. EVERY COLUMN IS EITHER PART OF THE PLAN OR DERIVED AT READ TIME. save_plan() replaces an
--      event's whole contents from one JSON document, so a column the Plan cannot express would
--      be silently wiped by the next save. That is why `imported_at`, `cancelled_at` and
--      `shift.note` are not here: they looked useful, and the first save would have destroyed
--      them without a word.
--
-- Time. The engine counts decimal hours from the event start, and that is the only truth stored
-- here: `start_hours` / `end_hours` everywhere, `event.starts_at` as the single anchor. Real
-- timestamps are computed at read time, in the two functions that show times to a human. Storing
-- both would mean two truths and a slow drift between them.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums, mirroring the Google Form answers
-- ---------------------------------------------------------------------------

create type skill_level as enum ('debutant', 'intermediaire', 'expert');

-- What the volunteer answered to "Qu'est ce que tu preferes ?" is NOT an enum any more, since
-- 2026-09-13. It was half_preference ('afternoon', 'evening', 'any'), which baked the loto and
-- the concerts into the database: another event has neither. It is volunteer.preferred_slot_key
-- now, naming an event_slot of kind 'preference' the way a refusal names one of kind 'refusal'.
-- A PREFERENCE, NEVER A RULE: it is scored by the solver and reported to the regisseur. The hard
-- answer about time is volunteer_refused_slot, which is a different question.

create type assignment_source as enum ('solver', 'manual');

-- The slots the form asks "which one can you not do" about are NOT an enum. They were one, and
-- that baked the form's wording into the database: renaming a question meant a migration. They
-- are rows in event_slot now, and a volunteer's refusal names one by its key.

-- ---------------------------------------------------------------------------
-- Event. One event is one plan.
-- ---------------------------------------------------------------------------

create table event (
  id           uuid primary key default gen_random_uuid(),
  name         text        not null,
  -- The anchor for every hour offset in the plan. 2027-03-13 12:00 Europe/Paris.
  starts_at    timestamptz not null,
  -- How long the event runs. The grid spans this, not the shifts.
  length_hours numeric(6,2) not null default 18 check (length_hours > 0),
  -- The Google Sheet the form exports to, remembered after the first import so the screen can
  -- offer a refresh instead of asking for the link again. On the event and not in a browser:
  -- it is a fact about this event, not about one regisseur's laptop.
  sheet_url    text not null default '',
  -- Where it happens, as the regisseur writes it on the poster. Free text, since 2026-09-13.
  address      text not null default '',

  -- Scheduling rules, stored so the regisseur can loosen them without a deploy. None of them
  -- names a moment of the event: evening_starts_at and afternoon_overflow_until, which did,
  -- became event_slot rows of kind 'preference' on 2026-09-13.
  max_consecutive_hours    numeric(4,2) not null default 4,
  max_blocks               int          not null default 2,
  min_break_hours          numeric(4,2) not null default 2,
  min_hours_per_person     numeric(4,2) not null default 4,

  -- LES REPAS ET LES TICKETS BOISSON, 2026-09-12. Off until the regisseur turns them on, which
  -- is the state every plan written before that date opens in: nothing drawn, nothing counted.
  -- The services of a day and the meal tiers are rows of their own, two tables below; what is
  -- here is the handful of figures that are one per event.
  catering_enabled      boolean not null default false,
  -- One drink ticket per this many hours worked. Zero means the event hands out none.
  drink_per_hours       numeric(4,2) not null default 2 check (drink_per_hours >= 0),
  -- Whether the montage and demontage hours count towards the drink tickets as well.
  drink_counts_phases   boolean not null default false,
  -- What an orga is due on the exploit whatever they worked there. A FLOOR, never a ceiling: an
  -- orga who does work a creneau keeps whatever the tiers give them when that is more.
  organiser_meals       int not null default 2 check (organiser_meals >= 0),
  organiser_drinks      int not null default 2 check (organiser_drinks >= 0),
  -- What a member of an act is handed whatever the hours, since 2026-09-13. A member's own
  -- drink_tickets overrides it for that one person.
  artist_drinks         int not null default 2 check (artist_drinks >= 0),
  -- A member who is also a benevole or an orga: both figures added, or the higher of the two.
  artist_drinks_cumulative boolean not null default false,
  -- La billetterie: how many named guests each member of an act may bring. Since 2026-09-13.
  guests_per_artist     int not null default 1 check (guests_per_artist >= 0),
  -- La billetterie: whether the benevoles in reserve are on the door's list. Since 2026-09-15; off
  -- by default, because somebody in reserve is normally not on site.
  reserve_on_door_list  boolean not null default false,
  -- What a car journey is reimbursed at: a fuel price per litre (kWh) by kind, a toll per km.
  fuel_price_essence    numeric(6,3) not null default 1.75,
  fuel_price_diesel     numeric(6,3) not null default 1.70,
  fuel_price_electrique numeric(6,3) not null default 0.22,
  fuel_price_gpl        numeric(6,3) not null default 0.95,
  fuel_price_autre      numeric(6,3) not null default 1.75,
  toll_per_km           numeric(6,3) not null default 0.10,

  -- REGLAGES AVANCES, 2026-09-13: which rule blocks, which one costs and how much, for this event.
  -- ONE JSONB DOCUMENT AND NOT A COLUMN PER CRITERION, the one place this schema stores a plan
  -- field as a document, for two reasons. It is sparse by design (only the criteria the regisseur
  -- changed, so a default improved later reaches every event that never touched it), and a
  -- column per criterion would store the defaults and freeze them. And no query ever reads inside
  -- it: the engine resolves the whole table at once, so there is nothing an index or a join would
  -- ever want. Shape: { criteria: { <id>: { mode?, weight? } }, longDayHours, veryLongDayHours }.
  constraint_settings   jsonb not null default '{}'::jsonb
    check (jsonb_typeof(constraint_settings) = 'object'),

  -- 2026-09-14, the event stops assuming the Loto Tekno's form.
  -- Whether a volunteer's pole choices are an order of preference (true) or a set of equals.
  pole_choices_ranked   boolean not null default true,
  -- Whether the volume asked is for the whole event or for each day, the clock hour a day hands
  -- over to the next, and the volumes the form offers. See tools/src/days.ts.
  volume_scope          text not null default 'event' check (volume_scope in ('event', 'day')),
  day_start_hour        numeric(4,2) not null default 12 check (day_start_hour >= 0 and day_start_hour < 24),
  volume_options        numeric(6,2)[] not null default '{4,6,8}',
  -- The import correspondence the regisseur settled on: columns and closed answers. A document,
  -- for the reason constraint_settings is one: sparse, and never queried inside.
  form_mapping          jsonb not null default '{}'::jsonb
    check (jsonb_typeof(form_mapping) = 'object'),
  -- The messages and checks ticked per benevole (« Mail de confirmation envoyé »...), in order,
  -- as [{key, label}]. Since 2026-09-15. A document for the reason form_mapping is one.
  -- « Fonctionnement en equipe » and the teams, [{key, name, poleKey}]. Since 2026-09-15.
  teams_enabled         boolean not null default false,
  teams                 jsonb not null default '[]'::jsonb
    check (jsonb_typeof(teams) = 'array'),
  -- The competences this event names, [{key, label}] in order. Since 2026-09-15.
  skills                jsonb not null default '[]'::jsonb
    check (jsonb_typeof(skills) = 'array'),
  application_steps     jsonb not null default
    '[{"key":"confirmation","label":"Mail de confirmation envoyé"},{"key":"reconfirmee","label":"Présence reconfirmée"},{"key":"infos","label":"Infos pratiques envoyées"}]'::jsonb
    check (jsonb_typeof(application_steps) = 'array'),

  -- THE OPTIMISTIC LOCK. Every save states the version it was built on; a save against a stale
  -- version is refused and hands back what the database holds. This is the "quelqu'un a modifie
  -- ce planning" banner, and it is why there is no realtime and no WebSocket anywhere.
  version    int not null default 1,
  updated_at timestamptz,
  -- French, shown as it stands in the history screen: the label of the edit that produced the
  -- CURRENT version. It moves into plan_version.label when that version is archived, because
  -- the label describes the body being kept and not the save that displaces it.
  last_label text,
  -- The plan format the current contents were written with. A fact about these rows, not a
  -- requirement about writers: that one is app_setting.min_plan_format.
  plan_format int not null default 1
);

-- The slots the form asks about, and their hours. Configuration, not constants.
--
-- TWO KINDS IN ONE TABLE, since 2026-09-13. 'refusal' rows answer "which one can you not do":
-- a hard rule, and together they tile the event. 'preference' rows answer "qu'est ce que tu
-- preferes": a price, not a rule, each with its own tolerated overflow on either side, and they
-- may overlap. The engine reads them as two lists (Plan.slots and Plan.preferenceSlots), never
-- as one, and a key is unique within its kind only.
create table event_slot (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references event(id) on delete cascade,
  kind           text not null default 'refusal' check (kind in ('refusal', 'preference')),
  slot_key       text not null,
  label          text not null,
  start_hours    numeric(6,2) not null,
  end_hours      numeric(6,2) not null,
  -- "Debordement accepte", preference rows only: how far past either edge a placement may run
  -- before it counts as going against the answer. Always 0 on a refusal row.
  overflow_hours numeric(6,2) not null default 0 check (overflow_hours >= 0),
  sort_order     int not null default 0,
  unique (event_id, kind, slot_key)
);

create index on event_slot (event_id);

-- ---------------------------------------------------------------------------
-- Poles and sub-poles
-- ---------------------------------------------------------------------------

create table pole (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references event(id) on delete cascade,
  key         text not null,
  parent_id   uuid references pole(id) on delete cascade,
  name        text not null,
  -- Presentation only, and nothing in the engine reads it. It lives with the plan because the
  -- regisseur chooses it and it has to travel with the plan.
  colour      text,
  sort_order  int  not null default 0,
  -- Per-pole relaxation of the global "never an all-debutant shift" rule. Off by default.
  allow_all_debutants  boolean not null default false,
  -- Per-pole requirement, 0 by default. Counts intermediaire and expert.
  min_experienced      int     not null default 0,
  -- "The solver leaves this pole alone." A DIFFERENT THING from a locked assignment: a locked
  -- pole is aimed at the solver only, and leaves the regisseur free to keep adjusting it.
  locked               boolean not null default false,
  -- "Whoever runs this pole stays in support and takes no creneau in it." A fact about the job:
  -- on some poles the two fit into one pair of hands, on others they do not. Reported when
  -- contradicted, never refused; nothing in the engine's rules reads it.
  leader_support_only  boolean not null default false,
  -- The competence keys a person needs here (event.skills), since 2026-09-15. Sub-poles inherit.
  required_skills      text[] not null default '{}',
  -- Starting values for a new shift of this pole, not rules. They are copied into the shift at
  -- creation and never read again, so raising one later cannot silently rewrite the shifts the
  -- regisseur has already tuned by hand.
  default_headcount    int     not null default 1 check (default_headcount > 0),
  default_shift_hours  numeric(4,2),
  unique (event_id, key)
);

create index on pole (event_id);
create index on pole (parent_id);

-- AN ORGA: somebody who runs the event rather than signs up for a shift of it. Never a
-- volunteer, never assigned to a créneau by the solver, and subject to none of the volunteers'
-- rules: no hour ceiling, no preference, no score.
--
-- A RESPONSABLE IS AN ORGA HOLDING A leader_role, and that is the whole of the difference.
-- Every responsable is an orga; most orgas are not responsables. Called `leader` until
-- 2026-09-10, when the form these rows are imported from turned out to be the orga form.
create table organiser (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references event(id) on delete cascade,
  key         text not null,
  first_name  text not null default '',
  last_name   text not null default '',
  email       text not null default '',
  phone       text not null default '',
  -- The credential, and the only one an orga has. Longer than a volunteer's on purpose: this
  -- one opens the whole planning, the contact details of every volunteer included, so it guards
  -- what a régisseur's password guards. Empty means no code issued yet, which is where every
  -- orga converted from the old table starts and why the uniqueness below is partial.
  access_code text not null default '',
  -- Kept apart because a caterer reads them differently: a diet is a preference to cater for,
  -- an allergy is a thing that must not be in the food.
  diet        text not null default '',
  allergies   text not null default '',
  note        text not null default '',
  -- When they arrive for the montage, and when they leave the démontage, each in hours from
  -- THEIR OWN phase's start. Null means not on that phase at all, which is the answer that
  -- matters: being drawn on a montage is always something somebody said.
  montage_from    numeric(6,2),
  demontage_until numeric(6,2),
  -- The competence keys this orga holds (event.skills), set by hand. Since 2026-09-15.
  skills      text[] not null default '{}',
  -- Field data, since 2026-09-15, as for a benevole.
  emergency_contact text not null default '',
  health_note text not null default '',
  sort_order  int not null default 0,
  unique (event_id, key)
);

-- Two orgas may not share a code. Any number of them may have none yet.
create unique index organiser_access_code_key on organiser (access_code) where access_code <> '';

create index on organiser (event_id);

-- BEING A RESPONSABLE: one pole an orga runs, and when. Nothing here is checked against
-- anything: two windows may overlap, and a person may hold two of them on the SAME pole, which
-- is how "de 14h à 18h, puis de 22h à 02h" is written down. A responsable is recorded, never
-- scheduled.
create table leader_role (
  id           uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references organiser(id) on delete cascade,
  pole_id     uuid not null references pole(id)   on delete cascade,
  key         text not null,
  start_hours numeric(6,2),
  end_hours   numeric(6,2),
  sort_order  int not null default 0,
  -- Per pole, like `shift`. Deliberately NOT unique per (organiser, pole): a second role on
  -- the same pole is a second window, and refusing it would lose a legitimate answer.
  unique (pole_id, key)
);

create index on leader_role (organiser_id);
create index on leader_role (pole_id);

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------

-- A shift has its own duration. Two 2h shifts at different times and one 4h shift are both
-- normal. Only leaf poles carry shifts, but that is a UI rule, not a constraint here.
create table shift (
  id             uuid primary key default gen_random_uuid(),
  pole_id        uuid not null references pole(id) on delete cascade,
  key            text not null,
  start_hours    numeric(6,2) not null,
  end_hours      numeric(6,2) not null,
  -- Per shift, always. The UI draws one box per unit, and a rush hour simply has more boxes than
  -- a quiet one in the same pole. Starts from pole.default_headcount, then diverges freely.
  headcount      int not null check (headcount > 0),
  sort_order     int not null default 0,
  duration_hours numeric(6,2) generated always as (end_hours - start_hours) stored,
  unique (pole_id, key),
  check (end_hours > start_hours)
);

create index on shift (pole_id);
create index on shift (start_hours);

-- An orga standing in a créneau of the exploit, placed by hand and by hand only.
--
-- NOT AN `assignment`, and deliberately not. An assignment is a volunteer under every rule of
-- this schema and of the solver; an orga is subject to none of them. The one thing the engine
-- knows about these rows is that they take a place: `PlanIndex.headcountOf` subtracts them from
-- what a créneau still needs, so the solver stops offering a seat that is already held.
create table organiser_shift (
  id           uuid primary key default gen_random_uuid(),
  organiser_id uuid not null references organiser(id) on delete cascade,
  shift_id     uuid not null references shift(id)     on delete cascade,
  key          text not null,
  sort_order   int  not null default 0,
  unique (shift_id, key)
);

create index organiser_shift_organiser_idx on organiser_shift (organiser_id);
create index organiser_shift_shift_idx     on organiser_shift (shift_id);

-- ---------------------------------------------------------------------------
-- Line-up. A named artist becomes a forbidden window for the volunteers who named them.
-- Set times move late in real events, which is a normal change event for the solver.
--
-- A FILE ON EVERY ACT, since 2026-09-13. The four columns the validator reads (key, name, the
-- set's two hours) are what the table was; the rest is what the regisseur, the caterer and the
-- person booking the trains know about an act and had nowhere to write. Every hour here counts
-- from the event's start, and the balances may be NEGATIVE: a soundcheck the afternoon before
-- the doors open is drawn on the montage, translated at read time, and stored nowhere else.
-- ---------------------------------------------------------------------------

create table artist (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references event(id) on delete cascade,
  key         text not null,
  name        text not null,
  start_hours numeric(6,2) not null,
  end_hours   numeric(6,2) not null,
  sort_order  int not null default 0,
  -- How many people travel with the act. A figure of its own: known before any name is.
  size                int     not null default 1 check (size >= 0),
  -- The changement de plateau on each side of the set, in hours. Zero is none.
  changeover_before   numeric(6,2) not null default 0 check (changeover_before >= 0),
  changeover_after    numeric(6,2) not null default 0 check (changeover_after >= 0),
  -- Defraiement: what is to be booked, and whether it is.
  train_tickets       int     not null default 0 check (train_tickets >= 0),
  train_done          boolean not null default false,
  train_cost          numeric(9,2) not null default 0,
  plane_tickets       int     not null default 0 check (plane_tickets >= 0),
  plane_done          boolean not null default false,
  plane_cost          numeric(9,2) not null default 0,
  contact_phone       text    not null default '',
  technical_needs     text    not null default '',
  patch_size          int     not null default 0 check (patch_size >= 0),
  notes               text    not null default '',
  -- The balances. The hours are kept when not needed, so unticking and ticking again loses nothing.
  soundcheck_needed   boolean not null default false,
  soundcheck_start    numeric(6,2) not null default 0,
  soundcheck_end      numeric(6,2) not null default 0,
  soundcheck_engineer boolean not null default false,
  unique (event_id, key)
);

create index on artist (event_id);

-- One person of an act. The key is unique across the event and not only within the act, because
-- a meal_choice points at it alone. drink_tickets null means "follow event.artist_drinks".
create table artist_member (
  id            uuid primary key default gen_random_uuid(),
  artist_id     uuid not null references artist(id) on delete cascade,
  key           text not null,
  first_name    text not null default '',
  last_name     text not null default '',
  role          text not null default 'musicien' check (role in ('musicien', 'technicien')),
  diet          text not null default '',
  allergies     text not null default '',
  drink_tickets int check (drink_tickets is null or drink_tickets >= 0),
  payment       text not null default 'cash' check (payment in ('cash', 'facture', 'declare')),
  -- The benevole or the orga this member ALSO is: at most one of the two, and null for nobody.
  -- SET NULL rather than cascade: losing the person does not lose the member, the link simply
  -- stops resolving and the member is counted on their own again.
  volunteer_id  uuid references volunteer(id) on delete set null,
  organiser_id  uuid references organiser(id) on delete set null,
  sort_order    int not null default 0,
  unique (artist_id, key),
  check (num_nonnulls(volunteer_id, organiser_id) <= 1)
);

create index artist_member_artist_idx on artist_member (artist_id);

-- One car journey the association reimburses. from_venue / to_venue true means "le lieu de
-- l'evenement", read from event.address when shown rather than copied here.
create table artist_car_trip (
  id                  uuid primary key default gen_random_uuid(),
  artist_id           uuid not null references artist(id) on delete cascade,
  key                 text not null,
  from_address        text not null default '',
  from_venue          boolean not null default false,
  to_address          text not null default '',
  to_venue            boolean not null default true,
  fuel                text not null default 'essence'
                      check (fuel in ('essence', 'diesel', 'electrique', 'gpl', 'autre')),
  consumption_per_100 numeric(6,2) not null default 0 check (consumption_per_100 >= 0),
  tolls               boolean not null default true,
  -- Null until computed from the map or typed. Kept apart so a typed cost survives a recompute.
  distance_km         numeric(8,1),
  cost                numeric(9,2),
  sort_order          int not null default 0,
  unique (artist_id, key)
);

create index artist_car_trip_artist_idx on artist_car_trip (artist_id);

-- Somebody let in on an act's word, by name: a member's guest (member_id set) or one of the
-- act's own (member_id null). "Ce ne doit pas etre une checkbox, mais un nom et un prenom."
-- The key is unique across the event, like a member's: a ticket or a bracelet points at it.
create table artist_guest (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references artist(id) on delete cascade,
  member_id  uuid references artist_member(id) on delete cascade,
  key        text not null,
  first_name text not null default '',
  last_name  text not null default '',
  sort_order int not null default 0,
  unique (artist_id, key)
);

create index artist_guest_artist_idx on artist_guest (artist_id);
create index artist_guest_member_idx on artist_guest (member_id);

-- ---------------------------------------------------------------------------
-- Volunteers
-- ---------------------------------------------------------------------------

create table volunteer (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references event(id) on delete cascade,
  key            text not null,
  first_name     text not null,
  last_name      text not null,
  -- "Surnom (si tu préfères qu'on t'appelle par celui-ci)", as answered. Empty when it was not.
  nickname       text not null default '',
  -- The label this person is shown under wherever the whole name does not fit: their nickname or
  -- first name, then only as much of the surname as it takes to tell them apart from everybody
  -- else the tool knows, volunteers and pole leaders together.
  --
  -- DERIVED, AND WRITTEN HERE ON PURPOSE. How much of a surname a label needs is a question
  -- about the whole roster, and the two functions at the bottom of this file that read it,
  -- get_volunteer_schedule and get_public_planning, answer one person at a time. Computing it in
  -- SQL would mean a second implementation of `tools/src/display.ts` that has to agree with the
  -- first one forever. The browser computes it and every save rewrites it, so it is a cache of
  -- something recomputed in full each time rather than a fact anybody edits.
  display_name   text not null default '',
  email          text not null default '',
  phone          text not null default '',
  -- Generated by the tool at import, never typed by hand. Unambiguous alphabet, 8 characters.
  access_code    text not null,
  -- What the caterer reads, as answered, since 2026-09-12. The form has asked both since the
  -- first export and the importer threw the columns away until then. Free text on purpose, like
  -- organiser.diet beside it: a closed list would have to be invented here, and the answer that
  -- did not fit it would be the one that mattered.
  diet           text not null default '',
  allergies      text not null default '',
  -- Form answers.
  -- 4, 6 and 8 are what the form offers today, and that list is NOT enforced here. The header of
  -- this file says no planning rule is a database constraint, for the reason that a constraint
  -- turns a questionable answer into a failed autosave the regisseur cannot clear. The day the
  -- form offers another duration, a list would be a locked door rather than a safeguard.
  -- Hours, for the event or per day as event.volume_scope says. Numeric since 2026-09-14: an
  -- event may offer 3,5 h.
  requested_hours numeric(6,2) not null check (requested_hours > 0),
  -- A preference, never a rule: the event_slot of kind 'preference' they would rather work, by
  -- key, or null for "peu importe". Was the half_preference enum until 2026-09-13. Not a foreign
  -- key, for the reason volunteer_refused_slot gives: a removed tranche must not delete answers.
  preferred_slot_key text,
  -- The time constraint in the volunteer's own words, as typed, since 2026-09-10. The form
  -- stopped offering four answers and started asking for a sentence. The slots it rules out
  -- are an interpretation of this and live in volunteer_refused_slot; this is the evidence,
  -- and nothing in the tool ever rewrites it.
  availability_note text not null default '',
  -- The refusable tranches this person would rather avoid without refusing them (« oui, mais je
  -- préfère ne pas »), by slot key. Since 2026-09-15. A cost, never a rule; not a foreign key for
  -- the reason volunteer_refused_slot gives.
  avoided_slot_keys text[] not null default '{}',
  -- Windows of the event this person is not there, [{start, end}] in event hours: an arrival, a
  -- departure, a day off. Since 2026-09-15, on top of the refused tranches. A document: never
  -- queried inside, read and written whole with the plan.
  unavailable     jsonb not null default '[]'::jsonb,
  -- The competence keys this person holds (event.skills), read from skills_note or ticked by hand,
  -- and the form's answer as typed. Since 2026-09-15.
  skills          text[] not null default '{}',
  skills_note     text not null default '',
  -- Field data, since 2026-09-15: who to call, health or specific needs, under 18 at the event (the
  -- birth date is read at import and never stored), whether the nickname matters. The first two
  -- are stripped from what an orga holding no pole reads, see get_organiser_planning.
  emergency_contact text not null default '',
  health_note     text not null default '',
  minor           boolean,
  nickname_matters boolean,
  -- The pole a responsable sent this person to, by key, or null. Since 2026-09-15. Not a foreign
  -- key, for the reason volunteer_refused_slot gives: a removed pole must not delete the decision.
  imposed_pole_key text,
  -- The team (event.teams key) this person belongs to, or null. Since 2026-09-15.
  team_key        text,
  -- The pole choices live in volunteer_choice since 2026-09-14: a form may ask for any number.
  -- Answers the regisseur corrected by hand, by field name, and the reason the fiche is in
  -- the review queue. Both are bookkeeping about the fiche rather than answers: they are what
  -- stops a re-import undoing a correction, and what lets a human say "I have read this".
  manual_fields   text[] not null default '{}',
  needs_review    boolean not null default false,
  review_reasons  text[] not null default '{}',
  -- What the volunteer typed for "who would you like to work with", not a resolved reference.
  -- Typos and nicknames are kept on purpose: resolving them is a reviewed step, and the resolved
  -- result lands in buddy_pair.
  buddy_raw_names text[] not null default '{}',
  -- Held in reserve: no shift at all, on purpose, because the event has more registrations than
  -- it has hours to offer. Zero hours is the point, since it is what makes "we did not need you
  -- in the end" a sentence someone can actually say. Never an error, unlike an unexplained 0h.
  on_reserve      boolean not null default false,
  -- Written by the regisseur rather than read from the form, since 2026-09-15: an orga turned into
  -- a benevole on the Personnes tab. The import screen keeps such a person by default when the
  -- export has no row for them, since they never had one to lose.
  entered_by_hand boolean not null default false,
  -- The regisseur's tracking of the application, since 2026-09-15, never read from a form: where
  -- it stands, the steps ticked (event.application_steps keys) and a note. The waiting list is
  -- NOT a status, it is on_reserve above.
  status          text not null default 'candidature'
    check (status in ('candidature', 'valide', 'annule')),
  status_steps    text[] not null default '{}',
  regie_note      text not null default '',
  -- The form's timestamp of the first answer, as the export writes it. Their place in the queue.
  registered_at   text not null default '',
  -- Two answers of the same date: ready to reinforce beyond their volume (the Reserve on every
  -- screen), and how they describe their stamina.
  backup          boolean not null default false,
  energy          text check (energy in ('fonce', 'regulier', 'fatigable', 'premiere')),
  sort_order      int not null default 0,
  unique (event_id, key),
  unique (event_id, access_code)
);

create index on volunteer (event_id);

-- The two phase answers, added 2026-09-10. Same three-part shape as the free-text answers:
-- whether the person comes, the sentence they wrote, and the windows read out of it. A yes
-- with no window is not a missing answer: it means the whole window the régisseur opened to
-- the bénévoles for that phase.
alter table volunteer add column montage_present   boolean not null default false;
alter table volunteer add column montage_note      text    not null default '';
alter table volunteer add column demontage_present boolean not null default false;
alter table volunteer add column demontage_note    text    not null default '';

-- The volunteer view looks a code up on its own, with no event in hand, so codes are unique
-- across every event this database ever holds.
create unique index volunteer_access_code_idx on volunteer (access_code);

-- Slots a volunteer cannot work, one row each, by event_slot.slot_key.
--
-- A TABLE AND NOT A COLUMN, since 2026-09-10, for the same reason volunteer_refused_pole is
-- one: the answer became free text, and a sentence can name two slots. The single
-- refused_slot_key kept exactly one of them, and this is a hard constraint, so a dropped
-- refusal is somebody placed at an hour they told us they could not come.
--
-- Deliberately not a foreign key onto event_slot: a regisseur who renames or removes a slot
-- must not have hundreds of answers deleted under them. A key naming a slot that no longer
-- exists simply stops matching, which is exactly what the engine does with it.
create table volunteer_refused_slot (
  volunteer_id uuid not null references volunteer(id) on delete cascade,
  slot_key     text not null,
  primary key (volunteer_id, slot_key)
);

-- Poles a volunteer ruled out, one row each. Refusing a pole refuses its whole subtree, so only
-- root poles are ever named here.
--
-- A TABLE AND NOT A COLUMN, since 2026-09-08. The form asks this with checkboxes, so somebody
-- can rule out three poles, and the single refused_pole_id kept exactly one of them. That is a
-- hard constraint: a dropped refusal is somebody standing in a pole they wrote down that they
-- would not work.
create table volunteer_refused_pole (
  volunteer_id uuid not null references volunteer(id) on delete cascade,
  pole_id      uuid not null references pole(id)      on delete cascade,
  primary key (volunteer_id, pole_id)
);

-- Artists a volunteer does not want to miss. Modelled as a list even though the form asks for
-- one, because widening it later costs nothing here.
-- A volunteer's pole choices, in the order given (rank 0 first). A LIST SINCE 2026-09-14, where
-- two pairs of columns used to hold exactly two. The raw answer is kept for the reason
-- availability_note is: a form's "Autre" box writes prose into the same column, and the prose is
-- what the regisseur reads back. The pole is set null when a pole is deleted; the answer stays.
create table volunteer_choice (
  volunteer_id uuid not null references volunteer(id) on delete cascade,
  rank         int  not null check (rank >= 0),
  pole_id      uuid references pole(id) on delete set null,
  raw          text not null default '',
  level        skill_level not null default 'debutant',
  primary key (volunteer_id, rank)
);

create table volunteer_artist (
  volunteer_id uuid not null references volunteer(id) on delete cascade,
  artist_id    uuid not null references artist(id)    on delete cascade,
  primary key (volunteer_id, artist_id)
);

-- A resolved buddy request: one-way and pairwise, never a transitive group. A chain "A wants B,
-- B wants C" stays two independent rows, or the group becomes unplaceable.
create table buddy_pair (
  from_volunteer_id uuid not null references volunteer(id) on delete cascade,
  to_volunteer_id   uuid not null references volunteer(id) on delete cascade,
  -- Added by hand on a fiche, so a re-import keeps it. Since 2026-09-14.
  manual            boolean not null default false,
  -- A pair from the form the regisseur removed by hand: planned with by nothing, kept so the next
  -- re-import does not bring it back. Loaded as Plan.dismissedBuddies.
  dismissed         boolean not null default false,
  sort_order        int not null default 0,
  primary key (from_volunteer_id, to_volunteer_id)
);

create index on buddy_pair (to_volunteer_id);

-- ---------------------------------------------------------------------------
-- Assignments
-- ---------------------------------------------------------------------------

-- Deliberately free of scheduling constraints. Overlaps, over-long runs and all-debutant shifts
-- are detected by the validation engine and shown in red, never rejected by the database.
--
-- One row is one box on the grid. A shift needing 5 volunteers shows 5 boxes and holds up to 5
-- of these rows, and the lock below is per box, meaning per person: locking Marie into the 22h
-- bar shift says nothing about the four people beside her.
create table assignment (
  id           uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references volunteer(id) on delete cascade,
  shift_id     uuid not null references shift(id)     on delete cascade,
  -- Locked assignments are hard constraints for every later re-solve. This is what makes
  -- incremental re-optimisation safe: what the regisseur validated by hand never moves.
  locked       boolean not null default false,
  source       assignment_source not null default 'solver',
  sort_order   int not null default 0
);

-- AND NO unique (volunteer_id, shift_id), on purpose. The same person twice on one shift is a
-- tier 1 issue the engine raises as `doublon` and draws in red, not something the database
-- refuses: a régisseur must be able to save a plan that is temporarily wrong. A unique
-- constraint here would turn a red box into a failed autosave with nothing they can do about it.

create index on assignment (shift_id);
create index on assignment (volunteer_id);

-- A solver run's proposals are NOT stored. They are built in the browser from the plan, reviewed
-- as groups, and the accepted ones become assignments in the very next save. A table holding
-- them would hold state nothing writes and nothing reads, which the next reader would trust.
-- ---------------------------------------------------------------------------
-- The montage and the démontage: the two phases around the event.
--
-- Everything above this line models *l'exploit*, the eighteen hours the public is on site.
-- These tables model the days before and after it, and NOT ONE of the exploit's rules applies
-- to them: nothing is solved, nobody's hours are counted, and the régisseur places people by
-- hand. TIME COUNTS FROM phase.starts_at, never from the event's own start.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------

create table phase (
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

create index phase_event_idx on phase (event_id);

-- The poles of a phase, and deliberately not `pole` rows: an experience requirement, a default
-- headcount and a lock for the solver are all meaningless here, and having the columns would
-- read as promises the phase does not keep.
create table phase_pole (
  id         uuid primary key default gen_random_uuid(),
  phase_id   uuid not null references phase(id) on delete cascade,
  key        text not null,
  name       text not null,
  colour     text,
  -- The competence keys needed here, since 2026-09-15. Signalled on a box, never refused.
  required_skills text[] not null default '{}',
  sort_order int not null default 0,
  unique (phase_id, key)
);

create index phase_pole_phase_idx on phase_pole (phase_id);

-- Something that happens at a precise moment and needs a given number of people: "déchargement
-- du camion, 14h à 16h, six personnes". It has NO POLE on purpose, since the six may come from
-- anywhere, and it is the only thing in a phase that can be short of people.
create table phase_event (
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

create index phase_event_phase_idx on phase_event (phase_id);

-- One person, in one pole or in one événement, over one window: A DECISION THE RÉGISSEUR TOOK.
-- What everybody does by default is derived in the app from their own declared presence and is
-- never stored, because storing a default freezes it: changing an orga's arrival, or opening one
-- more day to the bénévoles, would otherwise leave yesterday's picture on the grid.
create table phase_assignment (
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

create index phase_assignment_phase_idx  on phase_assignment (phase_id);
create index phase_assignment_person_idx on phase_assignment (volunteer_id, organiser_id);

-- Where an orga works during a phase when nothing else has been decided for the half-day. The
-- first one is where they are drawn; the others are recorded so the régisseur knows where else
-- this person is useful. No row at all means Général.
create table organiser_phase_pole (
  organiser_id  uuid not null references organiser(id)  on delete cascade,
  phase_pole_id uuid not null references phase_pole(id) on delete cascade,
  sort_order    int not null default 0,
  primary key (organiser_id, phase_pole_id)
);

-- The windows a bénévole gave for a phase, as read from their answer and corrected by hand.
create table volunteer_phase_window (
  id           uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null references volunteer(id) on delete cascade,
  phase_key    text not null check (phase_key in ('montage', 'demontage')),
  start_hours  numeric(6,2) not null,
  end_hours    numeric(6,2) not null,
  sort_order   int not null default 0,
  check (end_hours > start_hours)
);

create index volunteer_phase_window_idx on volunteer_phase_window (volunteer_id);

-- ---------------------------------------------------------------------------
-- Les repas et les tickets boisson
--
-- The caterer asks two questions and only two: how many people eat at each service, and what
-- they cannot eat. These three tables carry the rules that answer the first, and nothing else.
--
-- WHAT IS DELIBERATELY NOT HERE: the services themselves, and who eats at each of them. A
-- service is derived from the event's own days and the windows below, and who eats at one is
-- derived from the hours somebody works, every time it is read. Storing either would freeze it:
-- move a creneau, open one more montage day, change a tier, and yesterday's picture would stay
-- on the caterer's sheet with nothing saying it had stopped following the plan. It is the same
-- doctrine as phase_assignment three tables up, written down there in the same words.
--
-- What IS stored is a regisseur DISAGREEING with that derivation: meal_choice, at the bottom.
-- ---------------------------------------------------------------------------

-- The services of a day, as clock hours. Midi and soir by default.
--
-- A CLOCK RATHER THAN AN OFFSET, alone in this database, and on purpose: a meal is at 12h30
-- every day of the montage, it is not at "hour 37 of the montage". An end at or before the start
-- means the service runs past midnight, which is how a 23h to 01h night service is written down.
create table catering_service_window (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references event(id) on delete cascade,
  -- Stable id, part of a ticked box's key, so renaming the label never moves a tick.
  key        text not null,
  label      text not null default '',
  from_hour  numeric(4,2) not null check (from_hour >= 0 and from_hour < 24),
  to_hour    numeric(4,2) not null check (to_hour   >= 0 and to_hour  <= 24),
  sort_order int not null default 0,
  unique (event_id, key)
);

create index catering_service_window_event_idx on catering_service_window (event_id);

-- "A partir de from_hours travaillees, meals repas." A step, and the highest one reached wins.
--
-- WHY TIERS AND NOT A FORMULA, in the regisseur's own words of 2026-09-12: "travailler 4h donne
-- droit a 1 repas, travailler 6h ou 8h donne droit a 2 repas". That is a step function with two
-- steps, and the next event will have different steps, or three of them, or one. A formula would
-- fit this year and be wrong the next, with no way for the regisseur to say so.
--
-- THE EXPLOIT ONLY. The montage and the demontage do not work this way: there, somebody on site
-- at the hour of a meal eats, which is a presence and not an entitlement.
create table catering_meal_tier (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references event(id) on delete cascade,
  from_hours numeric(6,2) not null check (from_hours >= 0),
  meals      int not null check (meals >= 0),
  sort_order int not null default 0
);

create index catering_meal_tier_event_idx on catering_meal_tier (event_id);

-- ONE BOX THE REGISSEUR TICKED OR UNTICKED AGAINST WHAT THE TOOL WORKED OUT, and never the whole
-- grid of checkboxes. A row here means "this one was decided by a human", which is exactly the
-- thing that must survive a re-solve; everything else is recomputed from the plan every time.
--
-- service_key is a text key and not a foreign key, because there is no table to point at: a
-- service is a real date and a window, derived. '2027-03-13|midi' is the shape, and it is built
-- from ids rather than labels so that rewording "Midi" never moves a tick.
create table meal_choice (
  id           uuid primary key default gen_random_uuid(),
  -- Exactly one of the three, which is what "orga, benevole or artiste" means at this end. All
  -- cascade: deleting a person takes their decisions with them.
  volunteer_id     uuid references volunteer(id) on delete cascade,
  organiser_id     uuid references organiser(id) on delete cascade,
  artist_member_id uuid references artist_member(id) on delete cascade,
  service_key  text not null,
  takes        boolean not null,
  sort_order   int not null default 0,
  check (num_nonnulls(volunteer_id, organiser_id, artist_member_id) = 1)
);

create index meal_choice_person_idx on meal_choice (volunteer_id, organiser_id, artist_member_id);

-- ---------------------------------------------------------------------------
-- La billetterie: what the door hands out, since 2026-09-13.
--
-- The list of who gets in is DERIVED, every time, from the people, the acts and the catering
-- (see tools/src/ticketing.ts), and none of it is here. What is here is the configuration
-- (ticket types with the stretch of the event each opens, bracelets with the statuses each goes
-- to by default), the people the door alone knows (prestataires, other invitations), and the
-- few tickets or bracelets the regisseur picked against the default.
-- ---------------------------------------------------------------------------

create table ticket_type (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references event(id) on delete cascade,
  key         text not null,
  label       text not null default '',
  start_hours numeric(6,2) not null,
  end_hours   numeric(6,2) not null,
  sort_order  int not null default 0,
  unique (event_id, key)
);

create index ticket_type_event_idx on ticket_type (event_id);

create table bracelet_type (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references event(id) on delete cascade,
  key        text not null,
  label      text not null default '',
  sort_order int not null default 0,
  unique (event_id, key)
);

create index bracelet_type_event_idx on bracelet_type (event_id);

-- Which statuses a bracelet goes to by default. One row per status, so "backstage pour les
-- artistes ET leurs invites" is two rows and not a list in a text column.
create table bracelet_default (
  bracelet_id uuid not null references bracelet_type(id) on delete cascade,
  status      text not null check (status in ('benevole', 'orga', 'responsable', 'artiste',
                                              'invite-artiste', 'prestataire', 'autre')),
  sort_order  int not null default 0,
  primary key (bracelet_id, status)
);

-- Somebody the tool knows only through the billetterie. No form, no creneau, no act: what they
-- are handed is typed by hand, since no rule of the event applies to them.
create table extra_person (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references event(id) on delete cascade,
  key           text not null,
  first_name    text not null default '',
  last_name     text not null default '',
  status        text not null default 'autre' check (status in ('prestataire', 'autre')),
  phone         text not null default '',
  drink_tickets int not null default 0 check (drink_tickets >= 0),
  meal_tickets  int not null default 0 check (meal_tickets >= 0),
  sort_order    int not null default 0,
  unique (event_id, key)
);

create index extra_person_event_idx on extra_person (event_id);

-- What the regisseur decided about one person on the billetterie, beyond the defaults: a
-- ticket or a bracelet, a drink figure, a remark for the door. The person is named by kind and
-- key rather than by a foreign key, because five tables can hold them and a row naming somebody
-- the plan no longer holds is simply ignored on read. A row with nothing in it is never
-- written: that is the default, and the default follows Reglages.
create table ticketing_choice (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references event(id) on delete cascade,
  person_kind    text not null check (person_kind in ('benevole', 'orga', 'artiste', 'invite', 'extra')),
  person_key     text not null,
  ticket_type_id uuid references ticket_type(id) on delete set null,
  bracelet_id    uuid references bracelet_type(id) on delete set null,
  drink_tickets  int check (drink_tickets is null or drink_tickets >= 0),
  note           text not null default '',
  sort_order     int not null default 0,
  unique (event_id, person_kind, person_key)
);

create index ticketing_choice_event_idx on ticketing_choice (event_id);

-- ---------------------------------------------------------------------------
-- The past versions of a plan
--
-- THE ONE TABLE THAT IS NOT PART OF THE PLAN, and the deliberate exception to the rule two
-- paragraphs down: every other column here is either part of the Plan or derived at read time,
-- because a full-replace save wipes anything else. plan_version is not part of a plan, it is
-- about plans, and write_plan_body never touches it. That is exactly why it survives the save
-- it exists to protect against.
--
-- A save deletes the event's whole contents and rewrites them. Ctrl+Z covers the mistake noticed
-- in the same breath, in one browser; it covers nothing about yesterday, another tab, or the
-- other organiser. save_plan archives the outgoing body here first, so going back is a restore.
-- ---------------------------------------------------------------------------

create table plan_version (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references event(id) on delete cascade,
  -- The version this body WAS, not the version that replaced it.
  version     int  not null,
  -- When that version was written, by whoever wrote it.
  saved_at    timestamptz not null,
  -- When it was moved here, which is when the save that replaced it happened.
  archived_at timestamptz not null default now(),
  -- The label of the edit that produced this body, carried through event.last_label, or the name
  -- the regisseur typed when they pinned it.
  label       text,
  -- Named by the regisseur, and therefore exempt from every automatic retention rule. The only
  -- ways out are delete_plan_version, which is a deliberate press, and deleting the plan.
  pinned      boolean not null default false,
  -- The whole plan document, exactly as load_plan builds it, which is exactly what
  -- write_plan_body consumes. That round trip is the proven one, so a restore is a load.
  body        jsonb not null,
  -- The format this body was written with. A restore feeds it back into write_plan_body, which
  -- makes it a writer like any other, so it has to be able to say how old it is.
  format      int not null default 1,
  unique (event_id, version)
);

create index plan_version_event_idx on plan_version (event_id, version desc);

-- ---------------------------------------------------------------------------
-- The journal
--
-- The person running this on the night is not the developer. When something goes wrong they will
-- say so afterwards, in a sentence, from memory, and by then the browser that saw it is closed.
-- What is needed is not a stack trace at the moment of the crash, it is the twenty things that
-- happened before it, in order, readable months later by somebody who was not there.
--
-- WHAT IS NOT IN IT, and this is a rule rather than an oversight: no phone number, no address, no
-- mail address of a volunteer. A line names people the way the interface already does
-- ("deplacement de Marie Perrin"), because that is what makes it readable, and stops there. Every
-- organiser who can read this table can already read the whole planning, so nothing here widens
-- what anybody can see. Contact details would be the exception, and they are excluded.
--
-- This is the second table that is not part of the Plan, and it survives a full-replace save for
-- the same reason plan_version does: write_plan_body never touches it.
-- ---------------------------------------------------------------------------

create table app_log (
  id          bigint generated always as identity primary key,
  -- Nullable: the picker, the login and any failure before a plan is open have no event yet, and
  -- those are exactly the moments worth keeping.
  event_id    uuid references event(id) on delete cascade,
  -- When the browser recorded it. The one to read, and the one to distrust: it is a clock on
  -- somebody else's machine.
  at          timestamptz not null,
  -- When the row reached Postgres. Batched, so it lags by a few seconds, and it is what settles
  -- an argument when a browser's clock is wrong.
  received_at timestamptz not null default now(),
  level       text not null check (level in ('info', 'warn', 'error')),
  -- A coarse family, for filtering: edition, enregistrement, import, solveur, ecran, session.
  kind        text not null,
  -- The sentence, in French, usually the same one the interface said at the time.
  message     text not null,
  -- Anything structured worth keeping: counts, a version number, an error name. Small on purpose;
  -- the browser truncates it before sending.
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

create index app_log_event_idx on app_log (event_id, id desc);
create index app_log_at_idx on app_log (received_at);

-- ---------------------------------------------------------------------------
-- Two administrative tables. Neither belongs to a plan; both are about the tool itself.
-- ---------------------------------------------------------------------------

-- What has been applied, and IN WHICH ORDER. Alphabetical filenames were never going to hold:
-- two migrations written the same day sort by their subject, which has nothing to do with the
-- order they must run in. The sequence column is the order; the filename is for humans.
create table schema_migration (
  sequence   int primary key,
  filename   text not null unique,
  applied_at timestamptz not null default now(),
  note       text
);

insert into schema_migration (sequence, filename, note)
values (1, 'db/schema.sql', 'Schéma complet, installation neuve');

-- Named numbers the tool reads at runtime. One entry so far.
--
-- min_plan_format is THE GUARD AGAINST A STALE BROWSER TAB, and it is the most important number
-- in this file. A save rewrites the plan whole from the JSON the browser sends, and the browser
-- rebuilds that JSON field by field from what its own build knows (normalise.ts, deliberately).
-- So a tab left open across a deploy silently strips every field it has never heard of and
-- writes the result over everybody's: add a column, deploy, and yesterday's tab wipes it for a
-- hundred and twenty people without a word. Every writer states its format; anything older than
-- this number is refused and told to reload.
--
-- INCREMENT IT IN THE SAME MIGRATION AS ANY FIELD ADDED TO THE PLAN.
create table app_setting (
  name   text primary key,
  number int not null,
  note   text
);

insert into app_setting (name, number, note)
values ('min_plan_format', 22,
        'Le format de document que le navigateur doit déclarer pour avoir le droit d''écrire.');

-- ---------------------------------------------------------------------------
-- Row level security: deny everything to anonymous clients.
-- The anon key is public by construction, so no table is ever readable directly.
-- ---------------------------------------------------------------------------

alter table event            enable row level security;
alter table event_slot       enable row level security;
alter table pole             enable row level security;
alter table organiser        enable row level security;
alter table organiser_shift  enable row level security;
alter table leader_role      enable row level security;
alter table shift            enable row level security;
alter table artist           enable row level security;
alter table artist_member    enable row level security;
alter table artist_car_trip  enable row level security;
alter table artist_guest     enable row level security;
alter table ticket_type      enable row level security;
alter table bracelet_type    enable row level security;
alter table bracelet_default enable row level security;
alter table extra_person     enable row level security;
alter table ticketing_choice enable row level security;
alter table volunteer        enable row level security;
alter table volunteer_refused_pole enable row level security;
alter table volunteer_refused_slot enable row level security;
alter table volunteer_choice enable row level security;
alter table volunteer_phase_window enable row level security;
alter table phase            enable row level security;
alter table phase_pole       enable row level security;
alter table phase_event      enable row level security;
alter table phase_assignment enable row level security;
alter table organiser_phase_pole   enable row level security;
alter table catering_service_window enable row level security;
alter table catering_meal_tier      enable row level security;
alter table meal_choice             enable row level security;
alter table volunteer_artist enable row level security;
alter table buddy_pair       enable row level security;
alter table assignment       enable row level security;
alter table plan_version     enable row level security;
alter table app_log          enable row level security;
alter table schema_migration enable row level security;
alter table app_setting      enable row level security;

-- Organisers are authenticated users and get full access. Anonymous clients get no policy at
-- all, which under RLS means no row is ever returned.
do $policies$
declare t text;
begin
  foreach t in array array['event', 'event_slot', 'pole', 'organiser', 'leader_role', 'shift',
                           'artist', 'artist_member', 'artist_car_trip', 'artist_guest',
                           'ticket_type', 'bracelet_type', 'bracelet_default', 'extra_person',
                           'ticketing_choice',
                           'volunteer', 'volunteer_refused_pole',
                           'volunteer_refused_slot', 'volunteer_artist', 'volunteer_phase_window',
                           'volunteer_choice',
                           'buddy_pair', 'assignment', 'plan_version', 'app_log',
                           'phase', 'phase_pole', 'phase_event', 'phase_assignment',
                           'organiser_phase_pole', 'organiser_shift',
                           'catering_service_window', 'catering_meal_tier', 'meal_choice']
  loop
    execute format(
      'create policy %I_organiser on %I for all to authenticated using (true) with check (true)',
      t || '_organiser', t);
  end loop;
end
$policies$;

-- The two administrative tables are readable by an organiser, so a support question can be
-- answered from inside the tool, and written by nobody's browser: they are changed by whoever is
-- pasting SQL into the editor, and by nothing else.
create policy schema_migration_organiser on schema_migration for select to authenticated using (true);
create policy app_setting_organiser      on app_setting      for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- The plan, loaded and saved whole.
--
-- The front end never touches these tables directly. It calls list_plans, load_plan, save_plan
-- and create_plan, which are the SQL side of the `PlanStore` interface, and they are SECURITY
-- INVOKER on purpose: row level security still governs every row they touch, so a caller who is
-- not an authenticated organiser gets nothing out of them.
--
-- A plan is written whole, not diffed. save_plan deletes the event's contents and re-inserts
-- them from the JSON, inside one transaction. With a few thousand rows that is milliseconds, and
-- it buys the one property a diff cannot: what is in the database after a save is exactly the
-- plan that was saved, with no room for a stale row to survive a rule the diff forgot.
-- ---------------------------------------------------------------------------

-- ISO 8601 in UTC, which is what `new Date(...)` on the other side expects.
create or replace function public.as_iso(p_ts timestamptz)
returns text
language sql
immutable
as $fn$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$fn$;

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
               'requiredSkills',    to_jsonb(p.required_skills),
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
             'skills',         to_jsonb(l.skills),
             'emergencyContact', l.emergency_contact,
             'healthNote',     l.health_note,
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
             'avoidedSlotIds',  to_jsonb(v.avoided_slot_keys),
             'unavailable',     v.unavailable,
             'skills',          to_jsonb(v.skills),
             'skillsNote',      v.skills_note,
             'emergencyContact', v.emergency_contact,
             'healthNote',      v.health_note,
             'minor',           v.minor,
             'nicknameMatters', v.nickname_matters,
             'imposedPoleKey',  v.imposed_pole_key,
             'teamKey',         v.team_key,
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
                        jsonb_build_object('key', pp.key, 'name', pp.name,
                                           'requiredSkills', to_jsonb(pp.required_skills))
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
      'skills', e.skills,
      'teamsEnabled', e.teams_enabled,
      'teams', e.teams,
      'dismissedBuddies', dismissed_buddies.j))
  from event e, slots, preference_slots, poles, shifts, artists, organisers, leader_roles, volunteers, buddies,
       dismissed_buddies, assignments, reserve, organiser_shifts, catering, ticketing, travel
  where e.id = p_event_id;
$fn$;

-- The write half, and the one thing here that must never be reachable from the browser: it
-- replaces an event's whole contents with no version check at all. Supabase exposes `public` as
-- an API and nothing else, so it lives in `private`, where a mistyped RPC name cannot find it.
-- create_plan and save_plan wrap it, and save_plan owns the version check.
create schema if not exists private;

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
                                 then p_plan->'applicationSteps' else application_steps end,
    skills                = case when jsonb_typeof(p_plan->'skills') = 'array'
                                 then p_plan->'skills' else '[]'::jsonb end,
    teams_enabled         = coalesce((p_plan->>'teamsEnabled')::boolean, false),
    teams                 = case when jsonb_typeof(p_plan->'teams') = 'array'
                                 then p_plan->'teams' else '[]'::jsonb end
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
                    default_shift_hours, required_skills)
  select p_event_id, x->>'key', x->>'name', x->>'colour', (ord - 1)::int,
         coalesce((x->>'allowAllDebutants')::boolean, false),
         coalesce((x->>'minExperienced')::int, 0),
         coalesce((x->>'locked')::boolean, false),
         coalesce((x->>'leaderSupportOnly')::boolean, false),
         coalesce((x->>'defaultHeadcount')::int, 1),
         (x->>'defaultShiftHours')::numeric,
         coalesce((select array_agg(k #>> '{}')
                   from jsonb_array_elements(case when jsonb_typeof(x->'requiredSkills') = 'array'
                                                  then x->'requiredSkills' else '[]'::jsonb end) as rs(k)),
                  '{}'::text[])
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
                         diet, allergies, note, montage_from, demontage_until, skills,
                         emergency_contact, health_note, sort_order)
  select p_event_id, x->>'key',
         coalesce(x->>'firstName', ''), coalesce(x->>'lastName', ''),
         coalesce(x->>'email', ''), coalesce(x->>'phone', ''),
         coalesce(x->>'accessCode', ''),
         coalesce(x->>'diet', ''), coalesce(x->>'allergies', ''), coalesce(x->>'note', ''),
         (x->>'montageFrom')::numeric, (x->>'demontageUntil')::numeric,
         coalesce((select array_agg(k #>> '{}')
                   from jsonb_array_elements(case when jsonb_typeof(x->'skills') = 'array'
                                                  then x->'skills' else '[]'::jsonb end) as os(k)),
                  '{}'::text[]),
         coalesce(x->>'emergencyContact', ''), coalesce(x->>'healthNote', ''),
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
                         requested_hours, preferred_slot_key, availability_note, avoided_slot_keys, unavailable,
                         skills, skills_note, emergency_contact, health_note, minor, nickname_matters,
                         imposed_pole_key, team_key,
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
         coalesce((select array_agg(slot #>> '{}')
                   from jsonb_array_elements(case when jsonb_typeof(x->'avoidedSlotIds') = 'array'
                                                  then x->'avoidedSlotIds' else '[]'::jsonb end)
                        as av(slot)),
                  '{}'::text[]),
         case when jsonb_typeof(x->'unavailable') = 'array' then x->'unavailable' else '[]'::jsonb end,
         coalesce((select array_agg(k #>> '{}')
                   from jsonb_array_elements(case when jsonb_typeof(x->'skills') = 'array'
                                                  then x->'skills' else '[]'::jsonb end) as vs(k)),
                  '{}'::text[]),
         coalesce(x->>'skillsNote', ''),
         coalesce(x->>'emergencyContact', ''),
         coalesce(x->>'healthNote', ''),
         (x->>'minor')::boolean,
         (x->>'nicknameMatters')::boolean,
         nullif(x->>'imposedPoleKey', ''),
         nullif(x->>'teamKey', ''),
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

  insert into phase_pole (phase_id, key, name, colour, sort_order, required_skills)
  select ph.id, x->>'key', coalesce(x->>'name', ''), x->>'colour', (ord - 1)::int,
         coalesce((select array_agg(k #>> '{}')
                   from jsonb_array_elements(case when jsonb_typeof(x->'requiredSkills') = 'array'
                                                  then x->'requiredSkills' else '[]'::jsonb end) as rs(k)),
                  '{}'::text[])
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

-- Archiving the version about to be overwritten, and the two rules that keep the history from
-- swallowing the project.
--
-- The autosave writes about 1.2 s after the last edit, so an afternoon of dragging boxes is
-- hundreds of saves, and a plan is about 100 KB of JSON. Kept naively that is gigabytes of
-- near-identical documents, for a history nobody can read.
--
-- Two rules, and both are about what a regisseur would actually reach for:
--
--   keep_every: a routine save whose predecessor was archived less than this ago archives
--   nothing. Note which body that keeps: the OLDER one. A restore point thirty seconds back is
--   worth nothing, since Ctrl+Z already goes there; ten minutes back is worth the row.
--
--   keep_max: only the newest this many versions of an event are kept.
--
-- p_force is what a restore passes. Restoring is punctual and it overwrites the live plan, so
-- the state it overwrites is archived whatever the clock says.
create or replace function private.archive_plan_version(
  p_event_id uuid,
  p_force    boolean default false,
  p_label    text    default null,
  p_pinned   boolean default false)
returns void
language plpgsql
set search_path = public, private
as $fn$
declare
  keep_every constant interval := interval '10 minutes';
  keep_max   constant int      := 50;
  keep_days  constant interval := interval '60 days';
  v_version  int;
  v_saved    timestamptz;
  v_label    text;
  v_format   int;
  v_last     timestamptz;
begin
  select version, updated_at, last_label, plan_format
    into v_version, v_saved, v_label, v_format
  from event where id = p_event_id;
  if not found then
    return;
  end if;

  if not p_force then
    select max(archived_at) into v_last from plan_version where event_id = p_event_id;
    if v_last is not null and v_last > now() - keep_every then
      return;
    end if;
  end if;

  -- p_label and p_pinned are what a named checkpoint passes. `on conflict` is an update there
  -- and not a no-op: pressing the button on a version already in the history is a request to
  -- NAME that version, and answering it with silence would look like a button that does nothing.
  insert into plan_version (event_id, version, saved_at, label, body, pinned, format)
  select p_event_id, v_version, coalesce(v_saved, now()),
         coalesce(p_label, v_label), load_plan(p_event_id)->'plan', p_pinned, v_format
  on conflict (event_id, version) do update
    set label = excluded.label, pinned = true, archived_at = now()
    where p_pinned;

  -- Too many, oldest first. Pinned rows are neither deleted nor counted: fifty automatic
  -- versions stay fifty automatic versions however many checkpoints sit among them.
  delete from plan_version old
  where old.event_id = p_event_id
    and not old.pinned
    and old.id not in (
      select keep.id from plan_version keep
      where keep.event_id = p_event_id and not keep.pinned
      order by keep.version desc
      limit keep_max
    );

  -- Too old. Same exemption, same reason: what is worth keeping in March is what somebody said
  -- was worth keeping, not what happened to be the fiftieth most recent thing.
  delete from plan_version old
  where old.event_id = p_event_id
    and not old.pinned
    and old.archived_at < now() - keep_days;
end;
$fn$;

-- Returns {ok: true, version, savedAt} or, when the plan moved on underneath, the refusal plus
-- the envelope load_plan builds: {ok: false, version, savedAt, plan}. That is the shape of
-- `SaveResult` in app/src/persistence/types.ts, conflict branch included.
--
-- p_label is what the regisseur just did, in French, and it is stored against the version this
-- save creates rather than against the one it replaces. It is only ever read back by the
-- history screen.
create or replace function public.save_plan(
  p_event_id uuid, p_base_version int, p_plan jsonb, p_label text default null,
  p_format int default 0)
returns jsonb
language plpgsql
as $fn$
declare
  v_version int;
  v_saved   timestamptz;
  v_min     int;
begin
  -- BEFORE THE LOCK AND BEFORE THE VERSION CHECK. An outdated writer is not in a conflict with
  -- anybody, it is holding a document that no longer describes this plan, and the only useful
  -- answer is "reload". Default 0 means a caller that says nothing is treated as outdated, which
  -- is exactly what an old build is.
  select number into v_min from app_setting where name = 'min_plan_format';
  if coalesce(p_format, 0) < coalesce(v_min, 1) then
    return jsonb_build_object('ok', false, 'reason', 'format', 'required', coalesce(v_min, 1));
  end if;

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
    return jsonb_build_object('ok', false, 'reason', 'conflit') || load_plan(p_event_id);
  end if;

  -- Before the overwrite, inside the same transaction and under the same lock. A save that
  -- fails takes its archive row down with it, so the history can never hold a version the
  -- database never had.
  perform private.archive_plan_version(p_event_id);

  perform private.write_plan_body(p_event_id, p_plan);

  update event
  set version = version + 1, updated_at = now(), last_label = p_label, plan_format = p_format
  where id = p_event_id
  returning version, updated_at into v_version, v_saved;

  return jsonb_build_object('ok', true, 'version', v_version, 'savedAt', as_iso(v_saved));
end;
$fn$;

create or replace function public.create_plan(p_plan jsonb, p_format int default 0)
returns jsonb
language plpgsql
as $fn$
declare
  v_id    uuid;
  v_saved timestamptz := now();
  v_min   int;
begin
  select number into v_min from app_setting where name = 'min_plan_format';
  if coalesce(p_format, 0) < coalesce(v_min, 1) then
    raise exception 'create_plan: format de document périmé (% < %), rechargez la page',
      coalesce(p_format, 0), coalesce(v_min, 1);
  end if;

  -- The label the history screen shows against version 1, which is the only version nothing
  -- else can describe: no edit produced it.
  insert into event (name, starts_at, version, updated_at, last_label, plan_format)
  values (coalesce(p_plan->>'name', 'Sans nom'), (p_plan->>'startISO')::timestamptz, 1, v_saved,
          'Création du planning', p_format)
  returning id into v_id;

  perform private.write_plan_body(v_id, p_plan);

  return jsonb_build_object('id', v_id, 'version', 1, 'savedAt', as_iso(v_saved));
end;
$fn$;

-- What the plan picker lists. Counts, not sentences: the French belongs in the front end.
create or replace function public.list_plans()
returns table (
  id uuid, name text, version int, saved_at text, volunteer_count int, shift_count int
)
language sql
stable
as $fn$
  select e.id, e.name, e.version, as_iso(e.updated_at),
         (select count(*)::int from volunteer v where v.event_id = e.id),
         (select count(*)::int from shift s join pole p on p.id = s.pole_id
          where p.event_id = e.id)
  from event e
  order by e.updated_at desc nulls last, e.name;
$fn$;

-- ---------------------------------------------------------------------------
-- The history: reading it, going back, and deleting a plan outright
-- ---------------------------------------------------------------------------

-- Counts rather than sentences, as in list_plans: the French belongs in the front end. They are
-- read from the archived document itself and not from the tables, because the tables hold the
-- current version and the whole point here is to describe a version that is no longer there.
create or replace function public.list_plan_versions(p_event_id uuid)
returns table (
  version int, saved_at text, archived_at text, label text, pinned boolean,
  volunteer_count int, shift_count int, assignment_count int
)
language sql
stable
as $fn$
  select pv.version,
         as_iso(pv.saved_at),
         as_iso(pv.archived_at),
         pv.label,
         pv.pinned,
         jsonb_array_length(coalesce(pv.body->'volunteers',  '[]'::jsonb)),
         jsonb_array_length(coalesce(pv.body->'shifts',      '[]'::jsonb)),
         jsonb_array_length(coalesce(pv.body->'assignments', '[]'::jsonb))
  from plan_version pv
  where pv.event_id = p_event_id
  order by pv.version desc;
$fn$;

-- A restore is a save, not a rewind. It writes the old body as a NEW version, so the state it
-- replaces is archived on the way past and a restore of a restore walks back out again. Nothing
-- here ever destroys a version except the two retention rules in archive_plan_version.
--
-- It takes p_base_version for the same reason save_plan does: the regisseur is looking at a list
-- read at some earlier point, and the other organiser may have saved since.
create or replace function public.restore_plan_version(
  p_event_id uuid, p_version int, p_base_version int)
returns jsonb
language plpgsql
as $fn$
declare
  v_version int;
  v_body    jsonb;
  v_label   text;
  v_format  int;
  v_min     int;
begin
  select version into v_version from event where id = p_event_id for update;

  if not found then
    raise exception 'restore_plan_version: unknown event %', p_event_id;
  end if;

  if v_version <> p_base_version then
    return jsonb_build_object('ok', false) || load_plan(p_event_id);
  end if;

  select body, label, format into v_body, v_label, v_format
  from plan_version where event_id = p_event_id and version = p_version;

  if v_body is null then
    raise exception 'restore_plan_version: version % introuvable', p_version;
  end if;

  -- A restore feeds an archived body back into write_plan_body, so the body's own format is what
  -- matters here and not the caller's. One older than the tool now requires is refused loudly:
  -- reviving it needs a data migration, which is a decision rather than a click.
  select number into v_min from app_setting where name = 'min_plan_format';
  if coalesce(v_format, 1) < coalesce(v_min, 1) then
    raise exception
      'restore_plan_version: la version % date d''un format de document plus ancien (% < %). '
      'Elle ne peut pas être restaurée telle quelle.',
      p_version, coalesce(v_format, 1), coalesce(v_min, 1);
  end if;

  perform private.archive_plan_version(p_event_id, true);
  perform private.write_plan_body(p_event_id, v_body);

  update event
  set version = version + 1,
      updated_at = now(),
      plan_format = coalesce(v_format, 1),
      last_label = 'Retour à la version ' || p_version
                   || coalesce(' (' || nullif(v_label, '') || ')', '')
  where id = p_event_id;

  -- The whole new state, so the caller replaces its working copy with what the database now
  -- holds rather than guessing at it.
  return jsonb_build_object('ok', true) || load_plan(p_event_id);
end;
$fn$;

-- What the "enregistrer cette version" button does. It keeps the version the database currently
-- holds, under the name the regisseur typed, and changes nothing about the plan: no new version,
-- no bump, nothing to overwrite.
--
-- It still takes p_base_version, and this is not the optimistic lock doing its usual job, since
-- there is nothing here to overwrite. It is that naming a version is a statement about the plan
-- you are looking at, and if somebody else has saved since, the version you would be naming is
-- theirs. Refusing is the honest answer, and no work is at risk either way.
create or replace function public.create_plan_checkpoint(
  p_event_id uuid, p_name text, p_base_version int)
returns jsonb
language plpgsql
as $fn$
declare
  v_version int;
begin
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'create_plan_checkpoint: un point de sauvegarde doit porter un nom';
  end if;

  select version into v_version from event where id = p_event_id for update;

  if not found then
    raise exception 'create_plan_checkpoint: unknown event %', p_event_id;
  end if;

  if v_version <> p_base_version then
    return jsonb_build_object('ok', false, 'version', v_version);
  end if;

  perform private.archive_plan_version(p_event_id, true, btrim(p_name), true);

  return jsonb_build_object('ok', true, 'version', v_version);
end;
$fn$;

-- Forgetting one kept version, and only ever on a deliberate press.
--
-- It exists because pinning is otherwise a one-way door: a checkpoint named by mistake, or one
-- that has served its purpose, would sit there for the life of the plan with no way to remove it
-- short of deleting everything. Automatic versions are removable here too, which costs nothing:
-- a rule would have taken them eventually anyway.
create or replace function public.delete_plan_version(p_event_id uuid, p_version int)
returns jsonb
language plpgsql
as $fn$
declare
  v_deleted int;
begin
  delete from plan_version where event_id = p_event_id and version = p_version;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    raise exception 'delete_plan_version: version % introuvable', p_version;
  end if;

  return jsonb_build_object('ok', true);
end;
$fn$;

-- The name is the confirmation, and it is checked HERE rather than in a modal, because a modal
-- is one stray Entree away from gone and this cascades to every volunteer, shift and assignment
-- of the event. Case and surrounding spaces are forgiven; nothing else is.
create or replace function public.delete_plan(p_event_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
as $fn$
declare
  v_name text;
begin
  select name into v_name from event where id = p_event_id for update;

  if not found then
    raise exception 'delete_plan: unknown event %', p_event_id;
  end if;

  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(v_name)) then
    raise exception 'delete_plan: le nom saisi ne correspond pas au planning';
  end if;

  -- plan_version, event_slot, pole, artist and volunteer all cascade from here, and shift,
  -- leader_role, assignment, buddy_pair and the two join tables cascade from those.
  delete from event where id = p_event_id;

  return jsonb_build_object('ok', true);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- The journal: writing it in batches, and reading it back
-- ---------------------------------------------------------------------------

-- One call per batch, never one per line: an afternoon of dragging boxes is hundreds of entries
-- and a round trip each would be a tax on the very thing being measured. The browser buffers for
-- a few seconds and sends an array.
--
-- The two limits are the same shape as the ones on plan_version, and for the same reason: a log
-- nobody bounds is a log that eventually costs more than the thing it describes. The newest 5000
-- entries per plan, and nothing older than 90 days whatever the count. Pruning only ever touches
-- the partition just written to, so it costs an index lookup rather than a scan.
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

-- FROM PUBLIC IS NOT ENOUGH, AND THIS WAS FOUND THE HARD WAY. Supabase grants EXECUTE on every
-- new function in the public schema to anon, authenticated and service_role through default
-- privileges, and PUBLIC and anon are different grantees, so revoking from one leaves the other
-- in place. Verified against the live project with the anonymous key. Without the
-- explicit revoke below, list_plans, load_plan and save_plan answered the anonymous key. Row
-- level security still returned nothing and an anonymous save could write nothing, but an entry
-- point that should not exist is not made safe by happening to be empty.
revoke all on function public.load_plan(uuid)                     from public, anon;
revoke all on function private.write_plan_body(uuid, jsonb)       from public, anon;
revoke all on function private.archive_plan_version(uuid, boolean, text, boolean) from public, anon;
revoke all on function public.save_plan(uuid, int, jsonb, text, int) from public, anon;
revoke all on function public.create_plan(jsonb, int)             from public, anon;
revoke all on function public.list_plans()                        from public, anon;
revoke all on function public.list_plan_versions(uuid)            from public, anon;
revoke all on function public.restore_plan_version(uuid, int, int) from public, anon;
revoke all on function public.delete_plan(uuid, text)             from public, anon;
revoke all on function public.create_plan_checkpoint(uuid, text, int) from public, anon;
revoke all on function public.delete_plan_version(uuid, int)      from public, anon;
revoke all on function public.write_log(uuid, jsonb)              from public, anon;
revoke all on function public.read_log(uuid, int, bigint)         from public, anon;

grant usage   on schema private                                   to authenticated;
grant execute on function public.load_plan(uuid)                  to authenticated;
grant execute on function private.write_plan_body(uuid, jsonb)    to authenticated;
grant execute on function private.archive_plan_version(uuid, boolean, text, boolean) to authenticated;
grant execute on function public.save_plan(uuid, int, jsonb, text, int) to authenticated;
grant execute on function public.create_plan(jsonb, int)          to authenticated;
grant execute on function public.list_plans()                     to authenticated;
grant execute on function public.list_plan_versions(uuid)         to authenticated;
grant execute on function public.restore_plan_version(uuid, int, int) to authenticated;
grant execute on function public.delete_plan(uuid, text)          to authenticated;
grant execute on function public.create_plan_checkpoint(uuid, text, int) to authenticated;
grant execute on function public.delete_plan_version(uuid, int)   to authenticated;
grant execute on function public.write_log(uuid, jsonb)           to authenticated;
grant execute on function public.read_log(uuid, int, bigint)      to authenticated;

-- ---------------------------------------------------------------------------
-- The only anonymous entry point: a volunteer's own schedule, by access code.
--
-- The code is authentication, this function is enforcement. Filtering happens here, in
-- Postgres, so a wrong or guessed code returns nothing rather than returning everything to be
-- filtered in the browser. Contact details of other volunteers are never returned; only the
-- responsable's are.
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

revoke all on function public.get_volunteer_schedule(text) from public;
grant execute on function public.get_volunteer_schedule(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- What an orga sees: the whole planning, read only.
--
-- THE CODE IS THE ONLY CREDENTIAL, and the lookup happens here rather than in the browser. Same
-- shape as get_volunteer_schedule and for the same reason: a wrong code returns nothing, instead
-- of returning everything for the browser to filter, which is the difference between a
-- restriction and a curtain.
--
-- WHAT IT RETURNS IS EVERYTHING A RÉGISSEUR SEES MINUS THE ABILITY TO WRITE: the whole plan,
-- every volunteer's contact details included. That is what the régisseur asked for on 2026-09-09
-- and it is a deliberate widening of the earlier rule, which scoped a responsable to their pole.
-- It is also why an orga's access_code is fourteen characters rather than eight. The decision
-- and its price are written up in `.claude/memory/feature_leader_access.md`.
--
-- Read only is enforced HERE, not in the interface. This is the only function an anonymous
-- caller with an orga code can reach; save_plan and every other write requires `authenticated`.
-- A leader has no account, so there is nothing for them to write with, whatever the UI offers.
--
-- The envelope carries who the code belongs to and which poles they run, because the grid opens
-- on their own pole's filter and needs to know which one that is.
-- ---------------------------------------------------------------------------

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
    --
    -- EXCEPT THE FIELD DATA, since 2026-09-15: an emergency contact and a health note are for the
    -- regie and the responsables. An orga holding no pole reads every person without them.
    'plan',    case when exists (select 1 from leader_role r where r.organiser_id = me.id)
                 then loaded.envelope->'plan'
                 else jsonb_set(jsonb_set(loaded.envelope->'plan',
                   '{volunteers}', coalesce((
                     select jsonb_agg(v - 'emergencyContact' - 'healthNote' order by ord)
                     from jsonb_array_elements(loaded.envelope#>'{plan,volunteers}') with ordinality as t(v, ord)
                   ), '[]'::jsonb)),
                   '{organisers}', coalesce((
                     select jsonb_agg(o - 'emergencyContact' - 'healthNote' order by ord)
                     from jsonb_array_elements(loaded.envelope#>'{plan,organisers}') with ordinality as t(o, ord)
                   ), '[]'::jsonb))
               end,
    'version', loaded.envelope->'version'
  )
  from organiser me
  cross join lateral (select load_plan(me.event_id) as envelope) loaded
  where me.access_code <> '' and me.access_code = upper(trim(p_code));
$fn$;

revoke all on function public.get_organiser_planning(text) from public;
grant execute on function public.get_organiser_planning(text) to anon, authenticated;

-- The full planning table, which volunteers may consult. Names only: no contact details, no
-- form answers, no access codes.

create or replace function public.get_public_planning(p_event_id uuid)
returns table (
  pole text, debut timestamptz, fin timestamptz, effectif int, benevoles text[]
)
language sql
security definer
set search_path = public
stable
as $fn$
  select coalesce(parent.name || ' / ', '') || p.name,
         ev.starts_at + make_interval(secs => (s.start_hours * 3600)::float8),
         ev.starts_at + make_interval(secs => (s.end_hours   * 3600)::float8),
         s.headcount,
         coalesce(array_agg(v.display_name order by v.display_name)
                  filter (where v.id is not null), '{}')
  from shift s
  join pole  p  on p.id = s.pole_id
  join event ev on ev.id = p.event_id
  left join pole parent on parent.id = p.parent_id
  left join assignment a on a.shift_id = s.id
  left join volunteer  v on v.id = a.volunteer_id
  where p.event_id = p_event_id
  group by parent.name, p.name, s.id, ev.starts_at, s.start_hours, s.end_hours, s.headcount
  order by s.start_hours, 1;
$fn$;

revoke all on function public.get_public_planning(uuid) from public;
grant execute on function public.get_public_planning(uuid) to anon, authenticated;
