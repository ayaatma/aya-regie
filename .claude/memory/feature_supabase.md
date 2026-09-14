---
name: feature-supabase
description: "The Supabase layer, started 2026-09-08: why db/schema.sql was rewritten whole, the eight decisions behind it, what is verified without a database and what is not, and what remains to wire in the app."
metadata:
  type: project
---

**Status 2026-09-10: migrations 12 and 13 were applied and deployed by the developer.** 13 (orgas and the two phases) renames `leader` to `organiser`, adds
`organiser_shift`, `phase`, `phase_pole`, `phase_event`, `phase_assignment`,
`organiser_phase_pole` and `volunteer_phase_window`, replaces `load_plan` and `write_plan_body`
whole, renames `get_leader_planning` to `get_organiser_planning`, and raises `min_plan_format`
to 5. It also **enables RLS on `volunteer_refused_slot`, which migration 11 created with none**:
that table has been readable with the anon key since 2026-09-10. `npm run migrate` applies both.
See [[feature-montage-demontage]].

**Status 2026-09-08: the live project is up to date, every migration applied and verified by
`npm run migrate` and `npm run db-check`. The last one missing,
`2026-09-08_preference_and_plural_refusals.sql`, was applied at 20:49 with the data intact:
120 volunteers kept their preference (29 afternoon, 59 evening, 32 any) and the 65 pole
refusals were carried into `volunteer_refused_pole` before the old column was dropped. See
"The ledger lied" below. `db/schema.sql` is rewritten, statically verified, and APPLIED to the real
Supabase project (SQL Editor, "Success. No rows returned"). The next change to it is a migration.**

The Supabase project was created by the user on 2026-09-07, and the schema pasted into the SQL
editor on 2026-09-08. No app code talks to Supabase yet.

## Why the schema was rewritten rather than patched

The plan was a two-column patch: a `version` column for the optimistic lock. It became a rewrite,
because `db/schema.sql` was written at round 7 and the engine froze its model at rounds 9 to 11.
They had drifted apart, and every mismatch was a silent data loss waiting for the first save:

- no `key` anywhere, while the engine addresses everything by a readable slug (`bar--service`,
  `nom:marie-dupont`),
- `time_slot` as an enum, baking the form's wording into the database, after the engine had
  deliberately turned `SlotId` into a free string so the régisseur can reword a question,
- no `pole.locked`, no `pole.default_shift_hours`, no leader hours, no `event.length_hours`, no
  `evening_starts_at`,
- times as `timestamptz` while the engine reasons in decimal hours from the event start.

The schema had never been run anywhere, so the rewrite cost nothing. **That window is now closed:
once it is applied to the Supabase project, the next change is a migration.**

## The eight decisions

1. **Natural keys are the real references.** Every table carries the engine's `key` next to its
   uuid, unique per event, and every reference in a saved plan resolves through the key. The uuid
   stays only because the foreign keys and Supabase want one.

2. **Decimal hours are the single time truth.** `start_hours` / `end_hours` everywhere, with
   `event.starts_at` as the only anchor. Real timestamps are computed at read time, inside the two
   functions that show a time to a human. Storing both would have meant two truths and a drift.

3. **A plan is written whole, not diffed.** `save_plan` deletes the event's contents and
   re-inserts them from one JSON document, in one transaction. A few thousand rows is
   milliseconds, and it buys the property a diff cannot: what is in the database after a save is
   exactly the plan that was saved, with no stale row surviving a rule the diff forgot.

4. **Four RPCs, no table access from the browser**: `list_plans`, `load_plan`, `save_plan`,
   `create_plan`. They are SECURITY INVOKER on purpose, so row level security still governs every
   row they touch. The front end never issues a PostgREST table query.

5. **`write_plan_body` lives in a `private` schema.** It replaces an event's contents with no
   version check, and Supabase exposes only `public` as an API, so a mistyped RPC name in the
   front end cannot reach it. This is the one function that could destroy an afternoon of work.

6. **No `unique (volunteer_id, shift_id)` on `assignment`.** The engine tolerates a doublon and
   draws it in red (`validate.ts`, `TIER1.doublon`); a unique constraint would turn that red box
   into a failed autosave the régisseur cannot clear. Referential integrity is still enforced
   loudly: a shift naming an unknown pole, or an assignment naming an unknown volunteer, raises
   rather than being dropped by the resolving join. **Loud refusal yes, silent drop never.**

7. **Every column is either part of the `Plan` or derived at read time.** A column the Plan cannot
   express would be wiped by the next full-replace save, so `imported_at`, `cancelled_at`,
   `cancel_reason`, `shift.note` and `artist.stage` are gone. `pole.path` is the mirror case:
   derived on load by a recursive CTE, never stored, so renaming a parent cannot leave a stale
   path behind.

8. **`buddy_request` and the proposal tables are gone.** `buddy_request` held a resolution
   workflow the `Plan` cannot express; it is now `volunteer.buddy_raw_names` (what people typed)
   plus `buddy_pair` (what was resolved), which is exactly the engine's split. Proposals are built
   in the browser, reviewed as groups and applied into assignments by the very next save, so a
   table for them would have held state nothing writes and nothing reads.

## What is verified, and what is not

Verified, with no database anywhere on this machine (no Postgres, no Docker, no WSL):

- **Syntax, against the real Postgres 17 grammar** via the `@pgsql/parser` wasm build. 61
  top-level statements, plus 31 statements extracted from the nine function bodies, which the
  outer parse skips because they are dollar-quoted literals. Zero failures.
- **Field coverage**, against the engine's own interfaces in `model.ts` and `plan.ts`: 70 fields
  over 10 interfaces (72 before the 2026-09-08 renames), each one present in both `load_plan`
  and `write_plan_body`. The exclusions are `Pole.path`, by decision 7, and `Plan.rules`, which
  is a container rather than a leaf.

Not verified, and this is where a first run will fail if it fails: **column names and type
coercions**. The parser knows the grammar, not the catalogue, so a mistyped column or a numeric
that will not cast is invisible to it. The first paste into the SQL editor is the real test.

**SUPERSEDED 2026-09-08: the parser check is now `npm run sql-check` in `tools/`, in the
repository, and there is nothing left to rebuild. The rest of this section is kept because it is
the record of why that script looks the way it does.** It was throwaway and lived in the session
scratchpad. Rebuilding it was about twenty minutes: `npm i @pgsql/parser`, require the **CommonJS** build (`@pgsql/parser/v17`,
the ESM one has a broken directory import on Node 22), split each `$fn$` body on top-level
semicolons while honouring line comments and quoted strings, rewrite `perform` to `select`,
`return` to `select` and strip `into <vars>`, then parse each piece.

**Rebuilt 2026-09-08 and it cost more than twenty minutes, for three reasons worth knowing
before starting.** `parse` is async: `await loadModule()` first, then use `parseSync`. Two
apparent hangs were not hangs, and both looked exactly like a wasm deadlock: slicing the whole
file per character made the statement splitter quadratic on a 40 KB schema, and an all-comments
filter written with a nested quantifier backtracked catastrophically. And plpgsql `declare`
blocks get broken up by the splitter's own semicolon handling, so each declared variable arrives
as its own fragment; skip anything starting with `declare`, containing `:=`, or matching
`<name> <type>`, or eleven false failures bury the real output.

Two more things the field-coverage check needs to know, or it reports gaps that are not there:
`write_plan_body` reaches the scheduling rules through `#>>'{rules,field}'`, where the field name
never appears in its own quotes, and `Plan.rules` itself is a container that is never named.

## The app side, built 2026-09-08

`app/src/persistence/supabaseStore.ts` implements the same `PlanStore` the fixtures do, over
four RPCs and no table access. `main.tsx` picks between the two: `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` present means Supabase, absent means the fixtures. **The fixture path is
kept alive on purpose** since it is the only way to work on the grid without a network, and the
only reason the tests run at all.

Four decisions worth not rediscovering:

- **`load_plan` returns an envelope**, `{version, savedAt, plan}`, not a bare plan. `PlanStore.load`
  needs the plan and the version it was read at together; two calls would leave a window where the
  version moves under the working copy, and a stale version there is either a save refused for
  nothing or a save accepted over somebody else's. This was found while wiring the store, after
  the schema had already been applied, hence `db/migrations/2026-09-08_load_plan_envelope.sql`.
- **The store takes an `RpcCaller`, not a `SupabaseClient`.** A two-method interface the real
  client satisfies as it stands, so `supabaseStore.test.ts` exercises the whole seam against a
  stub, with no network and no configuration. The conflict path is tested there.
- **Everything from the database goes through `normalisePlan`.** The database is as much "from
  outside" as localStorage was, and the blank settings page came from exactly that assumption.
- **`PlanStore.shared`** says whether other organisers see this store's plans, so the picker can
  promise the right thing. "Saved in this browser" and "visible to everyone" are different
  promises and swapping them is how work goes missing.

Auth is a magic link (`auth/AuthGate.tsx`, `auth/useSession.ts`), with `shouldCreateUser: false`
saying out loud what the project setting already enforces. GoTrue answers an uninvited address
with "Signups not allowed for otp", which reads like a bug in the tool, so it is translated.

**Superseded on 2026-09-09, read [[feature-auth]].** The link is still there and still opens an
account the first time, but the everyday door is now a password each régisseur chooses for
themselves from « Mon compte ». Nothing below changed: same project settings, same SMTP, same
Site URL trap, and still no `service_role` key anywhere.

The picker offers to copy a generated scenario into an empty database. Without it a fresh project
is a dead end: an empty list and no way to create anything until the import screen can. It only
appears when the list is empty and the fixtures are reachable, so never in a production build.

## What the anonymous key could actually reach, 2026-09-08

Worth redoing after any change to the grants, because nothing else finds this. Call the live
project's REST endpoint with the anon key from `app/.env.local` and look at what answers:
`POST {url}/rest/v1/rpc/{fn}` with `apikey` and `Authorization: Bearer` both set to that key.

What it found: **`list_plans`, `load_plan` and `save_plan` all answered the anonymous key.**
Supabase grants EXECUTE on every new function in `public` to anon, authenticated and service_role
through default privileges, and `revoke all ... from public` does not undo it, because PUBLIC and
`anon` are different grantees. Fixed by `db/migrations/2026-09-08_revoke_anon_from_plan_rpcs.sql`.
No data was ever exposed, since row level security returned nothing and an anonymous save could
write nothing, but the door should not have been there.

What it confirmed, and what is therefore already known to work: the `private` schema is not
exposed (`write_plan_body` answers 404, PGRST202), `event` and `volunteer` return `[]` to the
anonymous key so RLS is doing its job, and `get_public_planning` and `get_volunteer_schedule` are
correctly open to anon.

**The lesson for the rest of this build: a grant is not verified until the anonymous key has been
pointed at it.** Reading the SQL is not enough, and neither is a parser.

## The project's own settings, and why

Decided 2026-09-08, after the built-in email service refused a second invitation with "email rate
limit exceeded".

**Magic link, over OVH's SMTP.** Supabase's built-in email service is a development stopgap capped
at a couple of messages an hour for the whole project. That cap does not just slow down invites:
a magic link sends an email at every single login, so it would have bitten on the night of the
event. The alternative considered was email plus password, with accounts created by hand from the
dashboard and no mail server at all. Magic link won because the association already owns the
domain and a mailbox at OVH, and because a password shared around an association is a password
that ends up in a group chat.

**Half revised on 2026-09-09, see [[feature-auth]].** The SMTP relay stays, and so does this
reasoning about shared passwords: the password added that day is not shared, each régisseur
chooses their own from inside the tool. What changed is the traffic. A mail is now sent on a
first connection and on a forgotten password, not on every single login, so the rate cap that
drove this decision matters even less than it did.

Settings, for when this has to be redone:

- SMTP host `ssl0.ovh.net`, port 465, username and sender both the full address of a real mailbox
  on `ayaatma.fr`. OVH refuses to relay for a sender it does not own, so the sender address and
  the account must be the same one.
- Site URL is `https://planning.ayaatma.fr`, **with the scheme and without `www.`**. Redirect
  URLs must carry `https://planning.ayaatma.fr/**` and `http://localhost:5173/**`, or a magic
  link opened during development lands on the production subdomain instead of the dev server.

  **THIS BIT AND EXACTLY THIS BIT, and it cost the first real login on 2026-09-08.** The mail
  arrived carrying `redirect_to=www.planning.ayaatma.fr`, schemeless and with a `www.` the
  site does not use, and the link answered `{"error":"requested path is invalid"}`. The app was
  innocent: it asks for `window.location.origin + window.location.pathname`, which is absolute
  and correct. **GoTrue validates the requested address against the Redirect URLs and, when it
  does not match, silently substitutes the Site URL.** So a wrong Site URL surfaces as a broken
  link whose address never appears in any code, and nothing in the browser can detect the
  substitution. The login screen now prints the address it asked to come back to, so the two can
  be compared; that is the only diagnosis available from the client side.
- Sign-ups are off. The policies grant everything to `authenticated`, so an open sign-up would
  hand the whole planning to anybody who can type an email address. Organisers are invited by
  hand from Authentication > Users.
- The email templates are French, because everything a régisseur reads is. They are dashboard
  content, not repository content, so they live in Authentication > Email Templates and are
  copied in [[feature-supabase]] only as a fallback if the project is ever rebuilt.

## Version history and deletion, built 2026-09-08

`db/migrations/2026-09-08_version_history_and_delete.sql`, mirrored into `db/schema.sql` for a
fresh install. **Not yet applied to the live project**: paste it into the SQL editor, then run
`npm run anon-check` in `tools/`.

The problem it closes: `save_plan` deletes the event's whole contents and rewrites them, and
nothing kept the outgoing version. Ctrl+Z covers the mistake noticed in the same breath, in one
browser, and covers nothing about yesterday, another tab, or the other organiser.

Seven decisions:

1. **`plan_version` is the one table that is not part of the `Plan`**, and the deliberate
   exception to decision 7 above. It is not part of a plan, it is about plans, and
   `write_plan_body` never touches it, which is exactly why it survives the save it protects
   against.
2. **The archived body is `load_plan(id)->'plan'`, not the incoming JSON.** What is kept is
   therefore what the database actually held, built by the same function a load uses, so a
   restore is a load of a document that has already made the round trip.
3. **Two retention rules, and they are about what a régisseur reaches for.** A save whose
   predecessor was archived less than ten minutes ago archives nothing, keeping the OLDER body,
   since a restore point thirty seconds back is what Ctrl+Z already is. Fifty versions per event
   at about 100 KB each. `FixtureStore` runs the same rules with a cap of five, because
   localStorage is 5 MB in total and losing the plan would be worse than a short history.
4. **A restore is a save.** `restore_plan_version` writes the old body as a NEW version, archives
   what it replaces (forced, whatever the clock says) and takes `p_base_version` so it is refused
   on a stale version exactly as a save is. Nothing in the file destroys a version except the two
   retention rules.
5. **`save_plan` gained a fourth argument and the three-argument signature was DROPPED**, not
   left in place. With a default argument both would exist and a three-argument call would bind
   to the old one, which archives nothing: a save that silently keeps no history is the failure
   the migration exists to remove. `p_label` is the French of the last edit, stored against the
   version this save creates and read back by the history screen. `event.last_label` carries it,
   because the label describes the body being kept, not the save that displaces it.
6. **`delete_plan` takes the plan's name and checks it in SQL.** A modal is one stray Entrée away
   from an event and everyone in it. The browser sends what was typed and never compares.
7. **Counts, not a diff.** `list_plan_versions` reads the counts out of the archived document
   itself. A field by field comparison of two plans is a build of its own and would have delayed
   the part that stops work being lost.

App side: `PlanStore` gained optional `history`, `restore` and `remove`, `save` gained a label,
`HistoryScreen.tsx` is the Historique tab, and the picker deletes a plan behind a re-typed name.
`HistoryTable` is split out of the screen so tests can render it against known rows.

## Named checkpoints, 2026-09-08

`db/migrations/2026-09-08_version_pinning.sql`, asked for by the user right after the history
landed, and it is the piece that makes the retention rules safe to have. **Applied? Check with
`npm run anon-check`: `create_plan_checkpoint` and `delete_plan_version` answer "non exposée"
until it is.** Unlike the previous migration, this one is not breaking: the app degrades to
showing every version as automatic and the button failing.

The reasoning, which is the part worth keeping: an automatic rule cannot tell the difference
between the autosave from 14h07 and the state of the plan just before the October import. Under a
rule that only counts, the second one is pushed out by five months of the first. So a version can
be **pinned**, and once pinning exists the automatic side can be bounded harder rather than
softer: fifty versions AND sixty days, where before there was only a count.

- `plan_version.pinned`, and both retention rules ignore pinned rows entirely: they are neither
  deleted nor counted, so fifty automatic versions stay fifty however many checkpoints sit among
  them.
- `create_plan_checkpoint(event, name, base_version)` archives the version the database currently
  holds, forced, under the typed name. It changes nothing about the plan: no new version, no
  bump, nothing to overwrite. It still takes a base version, and NOT as the optimistic lock doing
  its usual job: naming a version is a statement about the plan you are looking at, and if
  somebody else has saved since, the version you would be naming is theirs.
- **`on conflict` became an update, and this is the bug that would have been reported as "the
  button does nothing".** Pressing it on a version already archived automatically is a request to
  NAME that version, and `do nothing` would have answered it with silence.
- `delete_plan_version` exists because pinning is otherwise a one-way door. It is the only thing
  in the whole history that destroys anything, and it takes a deliberate press.
- **The old two-argument `archive_plan_version` is DROPPED before the four-argument one is
  created.** Adding defaulted arguments through `create or replace` creates a SECOND function,
  and `archive_plan_version(id, true)` would then match both through their defaults, which
  Postgres refuses as "function is not unique". `save_plan` and `restore_plan_version` call it
  exactly that way. Same reason `list_plan_versions` is dropped first: `create or replace` cannot
  change a return type, and it gains the `pinned` column.

In the app: a "Point de sauvegarde" button in the top bar, opening `CheckpointBar` in the same
slot as the conflict banner (which wins the slot, since one of the two is about work that could
be lost). It waits for the autosave, because a checkpoint keeps what the STORE holds and naming
it mid-edit would name the state before that edit. `PlanState.historyRevision` is what tells the
history screen to re-read when the plan itself has not changed.

## The journal, 2026-09-08

`db/migrations/2026-09-08_writing_an_activity_log.sql`, named to sort after the pinning one:
two migrations written the same day must run in the order they were written, and the directory
is read alphabetically. **Check whether it is applied with `npm run anon-check`: `write_log`
and `read_log` answer "non exposée" until it is.** Not breaking either way; without it the
journal simply records nothing and the Journal tab says the storage keeps none.

Asked for by the user, and the reasoning is theirs: the person running this on the night is not
the developer, a problem will be reported afterwards in a sentence from memory, and by then the
browser that saw it is closed. What answers that is not a stack trace at the moment of the crash,
it is the twenty things that happened before it, in order, still readable months later.

- **`app_log`, the second table that is not part of the `Plan`.** Same exemption as
  `plan_version` and the same reason: `write_plan_body` never touches it. `event_id` is
  nullable on purpose, because the login, the picker and everything that fails before a plan is
  open are exactly the moments worth keeping.
- **Two clocks, deliberately.** `at` is the browser's, which is what somebody compares against
  "c'était vers deux heures", and `received_at` is Postgres's, which is what settles it when a
  browser's clock is wrong.
- **Bounded like everything else here**: the newest 5000 entries per plan, nothing past 90 days,
  pruned inside `write_log` and only over the partition just written to, so it costs an index
  lookup rather than a scan. `FixtureStore` keeps 500 in localStorage.
- **NO CONTACT DETAILS, EVER.** A line names people the way the interface already does
  ("déplacement de Marie Perrin"); it never carries a phone number, an address or a mail address
  of a volunteer. Everybody who can read the journal can already read the planning, so that is
  the one thing that would widen what they see.

`app/src/log/logger.ts` is ambient on purpose (`export const log`): threading a logger through
every component would mean touching every component to add a line, and the lines worth having are
the ones nobody plans for. Four rules, and the first outranks the rest: **logging never breaks the
tool**, every path swallows its own failures, and a refused batch goes back into the buffer rather
than being lost. It is bounded at 400 entries and says how many it dropped. It batches on a 4 s
timer that is NOT a debounce, so a continuous stream still lands.

Where the lines come from, and why so few call sites: **`apply` and `edit` in `store.tsx`
are the only doors into an edit**, so covering those two covers the drag, the keyboard, Réglages,
the import and the accepted proposals. It happens in the callbacks and never in the reducer, which
must stay pure and which React calls twice in development. The rest is the save path (accepted,
refused, failed, and both answers to the conflict banner), the restore and checkpoint calls,
`ScreenBoundary`, and the two window handlers in `main.tsx` for what React never sees: an
error thrown outside rendering and a promise nobody awaited.

The Journal tab exists for one conversation: somebody says "ça a planté hier soir", presses
**Copier pour diagnostic**, and pastes the block into a message. Plain text, not JSON and not a
file, because it has to survive being pasted by somebody in a hurry. The listing is newest first
and the exported block is oldest first, on purpose: one answers "what just happened", the other
"how did it get there". The filter defaults to everything, because what explains a failure is
almost never the failure itself.

## Making the next change safe, 2026-09-08

`db/migrations/2026-09-08_upgrade_safety.sql`. Written when the user asked what to prepare
before adding features (a dietary requirement, a setup and teardown period, a timeline, a
catering view) and changing rules. **Sequence 8 in the ledger; its filename sorts BEFORE the
journal's, which is the last time that matters, see below.**

**THE ONE THAT WOULD HAVE COST REAL DATA: a stale browser tab.** A save rewrites the plan whole
from the JSON the browser sends, and `normalise.ts` rebuilds that JSON field by field from what
its own build knows, deliberately. So a tab left open across a deploy strips every field it has
never heard of and writes the result over everybody's: add a column, deploy, and yesterday's tab
wipes it for 120 people without a word. Verified by reading `normalise.ts` rather than assumed.
The reverse direction was already safe: a new build against an old database fails loudly with
PGRST202, as seen twice in this build.

- `PLAN_FORMAT` in `tools/src/plan.ts` (currently 1) is stated on every write.
  `app_setting.min_plan_format` is what the database requires. Older is refused with
  `{ok:false, reason:'format', required:N}`, which the app shows as a **blocking banner that
  outranks the conflict banner**: a conflict is a choice between two versions, this one is not a
  choice at all, only a page to reload. `SaveResult` has three branches now, not two.
- `p_format` defaults to 0 in SQL, so a caller that says nothing is treated as outdated. That is
  exactly what an old build is.
- `event.plan_format` records what the current rows were written with; `plan_version.format`
  does the same for an archived body, and `restore_plan_version` refuses a body older than the
  requirement rather than feeding it back into `write_plan_body`.
- **Same drop-before-create dance as twice before**: a defaulted argument added through
  `create or replace` makes a SECOND function and the old call then matches both.

**The ledger.** `schema_migration(sequence, filename, applied_at, note)`, backfilled with the
eight applied so far in the order they were actually run. **The sequence column is the order, not
the filename**: two migrations written the same day sort by their subject, which has nothing to
do with what must run first. That trap was hit twice in one afternoon (`version_pinning` had to
be named to sort after `version_history`, and `writing_an_activity_log` after that).

**`requested_hours in (4, 6, 8)` is gone**, replaced by `> 0`. It was a form answer enforced as
a database constraint, which contradicts the schema's own header, and the day the form offers
another duration it stops being a safeguard and becomes an autosave the régisseur cannot clear.
Exactly the "hard constraint that becomes flexible" case the user asked about, already present.

**`changesBetween` in `reconcile.ts` is now exhaustive by type** (`ComparedFields` is keyed on
`keyof Volunteer`, with `key` and `accessCode` explicitly null). Not cosmetic: the planned way
to fill a new field for people already in the plan is to re-import the same export, and
`applyReconciliation` takes each imported volunteer whole, so the value lands whether or not it
is listed. What would not happen is anybody being TOLD: the review screen would announce "aucune
modification" over a re-import that changes every row.

## Deployment, 2026-09-08

`npm run deploy` in `tools/`: builds, mirrors `app/dist` into the subdomain's folder, verifies
over HTTPS. `--probe` reports what the host accepts, `--dry-run` what it would send and remove.
OVH shared hosting is a folder behind a file transfer protocol, so that is the whole deployment.
There is no router in the app and no history API, so no `.htaccess` and no rewrite rule either.

**What --probe measured on ftp.cluster0XX.hosting.ovh.net.** SFTP works (home `/home/<compte>`).
Explicit FTPS answers `500 This security scheme is not implemented`. Implicit FTPS is filtered.
Plain FTP works and is never chosen automatically: it puts the password of an account that can
overwrite the association's website in clear on the wire, so `DEPLOY_PROTOCOL=ftp` has to be
typed by hand. **The two protocols spell paths differently**: an OVH FTP login is chrooted at the
account's home, so the folder is `/www/planning`, while SFTP sees `/home/<compte>/www/planning`.
The script resolves one from the other.

**The folder is `/planning`, not `/www/planning`.** The OVH multisite "dossier racine" field is
relative to the FTP root, so a subdomain pointed at `./planning` lands beside `www` rather than
inside it. Proven end to end on 2026-09-08: `--dry-run` connects in SFTP, resolves `/planning`
to `/home/<compte>/planning`, and lists four files to send with `index.html` last. Nothing has
been uploaded yet.

**A folder that does not exist is a stop, not a mkdir**, and that rule was written after the
first real deploy went into `/home/<compte>/www/planning`: the config still said
`/www/planning` while the subdomain had been repointed at `./planning`. The upload succeeded,
the site was unchanged, and only the HTTPS check at the end noticed. By then four files sat in a
directory that now existed and would look right to whoever found it next. The deploy now refuses
and lists what is beside it (`planning, www`), which names the mistake outright.
`--create-dir` is for a genuine first deploy.

Six defects found by running it rather than by reading it, all fixed, and the first five of the
same family: **a network call with no bound looks exactly like a script that has frozen.**

- No per-attempt timeout, so a filtered port hung the whole run for five minutes. Ten seconds
  now, wrapped around the library's own timeout rather than trusting it.
- A refused attempt kept its socket, so a run trying three transports never exited.
- The probe called a working SFTP "refusé" because the listing failed on a path. Connecting and
  finding the folder are two different questions and are now reported as two.
- The "what can this transport see" listing used the recursive walk, which went through the
  entire hosting space. One level is what it wanted.
- `basic-ftp`'s `list` answers an empty array for a folder that does not exist, which read as
  "the folder is there and empty". Checked with a `cd` now.

**DEPLOYED AND PROVEN, 2026-09-08.** `https://planning.ayaatma.fr` serves the build, an
organiser receives a magic link and logs in. The two things that stood between the first
`npm run deploy` and a working login were both settings rather than code: the subdomain's folder
(`/planning`, not `/www/planning`) and the Site URL. Neither would have been found by reading
anything; both came out of running it and reading what came back.

## The ledger lied, 2026-09-08

**The failure.** The régisseur, testing the deployed tool, got "Impossible de charger le
planning" and then `Impossible d'enregistrer le planning: null value in column "half" of
relation "volunteer" violates not-null constraint`, and the whole interface was replaced by an
error card with no button on it.

**The cause.** `2026-09-08_preference_and_plural_refusals.sql` had never been applied to the live
project. Everything after it had. So `volunteer.half` was still there and still not null,
`half_preference` and `volunteer_refused_pole` did not exist, and the database still held the
pre-refactor `load_plan` and `write_plan_body`: one handed the browser a `half` key the app no
longer reads, the other read `x->>'half'` out of a document that now says `halfPreference`,
which is where the null came from.

**Why nothing caught it.** `sql-check` reads the files. `schema-check` compares two files.
`anon-check` calls the functions and they all answered, with the wrong bodies inside. And the
migration ledger, backfilled by hand in `upgrade_safety` three migrations later, listed it as
applied: seven of those eight lines recorded something that had happened, and the eighth recorded
something that had only been written. **Backfilling a ledger from memory writes down the belief,
not the fact, and from then on the ledger is what everybody reads.**

**What was done.** The migration is unchanged except for a fourth section that corrects its own
ledger row, guarded on `schema_migration` existing since a replay in order would reach it first.
Its `load_plan` and `write_plan_body` were diffed against `db/schema.sql` before saying so:
identical, and no later migration redefines either, so applying it late is safe rather than a
rollback of everything since.

**`npm run db-check`, the check that would have caught it.** Reads `db/schema.sql` for every
`create table` and asks the live project for each one with `select=<column>&limit=0`, which
PostgREST answers with `[]` when the column exists and 42703 when it does not. `limit=0` means
no row ever moves, so RLS has nothing to hide and the anonymous key is enough: it reads the shape
of the database and never its contents, and nothing it sends can write. It found exactly two
objects missing and nothing else, which is what proved the drift was one migration wide. It does
not know types, defaults, constraints, policies or function bodies.

## A migration that has run is never edited, 2026-09-10

Migration 11 was applied. Minutes later a new field (`event.sheet_url`) was added to the plan,
and the column was written **into migration 11**, on the assumption that it had not run yet.
A file recorded as applied never runs again, so the ALTER sat in a file nothing would ever
execute. The next `npm run migrate` said so: **"VÉRIFICATION EN ÉCHEC, 1 objet manquant:
event.sheet_url"**, which is precisely the job db-check was added for two days earlier.

- **The fix is a new migration, never `--only`.** `--only` re-runs a file the ledger claims is
  done, and it exists for a ledger that lied. This ledger did not lie: 11 as it stood at run
  time really was applied. Re-running an edited 11 would leave two databases both claiming to
  be at 11 while holding different schemas, which is the ledger going back to being a statement
  of intent.
- **Migration 11 was put back to exactly what ran.** The file in the repository has to be the
  thing the database executed, or the next reader is comparing against fiction.
- **The new migration replaces load_plan and write_plan_body again**, and that is the half that
  is easy to miss: db-check compares tables and columns, never function bodies. The column
  alone would have left load_plan returning no `sheetUrl` and write_plan_body dropping the one
  it was given, silently, with every check in the repository green.

## Applying a migration from the repository, 2026-09-08

**Both from VS Code since 2026-09-09.** `.vscode/launch.json` holds two Run and Debug targets,
"BDD update (migrations Supabase)" and "Front update (build + déploiement OVH)", both with
`cwd` on `tools/`. **Neither goes through npm or a shell**, and that is the point: the first
version ran `npm run migrate` as a `node-terminal` target, and in a PowerShell terminal `npm`
resolves `npm.ps1` before `npm.cmd`, which Windows' default execution policy refuses to load
("running scripts is disabled on this system"). So each target launches `node.exe` on the CLI
with `--import tsx`, which is what `npm run` does once the wrapper is removed. The `execSync('npm
run build')` inside `deploy-cli.ts` is unaffected: `execSync` goes through `cmd.exe`, which picks
`npm.cmd` and never sees a policy. They are two targets rather
than one because the two updates rarely travel together, and when a version needs both, **the
base goes first**: a front deployed against a schema that has not moved yet asks for columns
nobody has.

`npm run migrate` in `tools/`, added the same afternoon as the incident above and for it. The
copy-paste into the SQL editor was the step that got skipped, so it stopped being a step.

- `npm run migrate` lists and applies nothing. `--apply` runs. **Explicit on purpose**, unlike
  `npm run deploy`, which applies by default: a deploy overwrites static files, a migration
  alters a database holding real people's answers.
- `--only=<fichier>` runs one named file even when the ledger says it is done. That is the escape
  hatch for a ledger that lied, and it is how migration 3 was finally applied.
- **One file, one transaction, and the ledger row is written inside it.** So the schema and the
  ledger commit together or not at all, and `schema_migration` stops being a statement of intent.
  Nothing else in the repository writes a ledger row any more; `upgrade_safety` was the last, by
  hand, and it is what went wrong.
- **Order comes from `-- migration-sequence: N`, the first line of every migration**, not from
  the filename. The alphabet was wrong twice in one afternoon. A file with no such line, a
  duplicate number or a number below 2 (1 is `db/schema.sql`) stops the run before it connects.
- It always finishes with the `db-check` comparison, run against `information_schema` over the
  same connection, **including when it had nothing to apply**. That is the run where a lying
  ledger shows itself.
- `SUPABASE_DB_URL` in `.env.deploy.local`, the **Session pooler** string, port 5432. The
  transaction pooler on 6543 hands out a different backend per statement, which would quietly
  break the one property the whole design rests on, so the script refuses that port by name
  rather than working badly. Without the variable, the command still lists the files and their
  order: looking at it costs no password.
- `pg` is a devDependency of `tools/` now. TLS is strict, with no insecure escape hatch, unlike
  the FTPS one in the deployment: this password can drop every table.
- Not covered: a migration that cannot run inside a transaction (`create index concurrently`).
  None of ours are, and one that is should say so at the top rather than weaken this for all.

## The two things that stop a first connection, 2026-09-08

Both were met on the first real run of `npm run migrate`, and both name the wrong culprit.

**`self-signed certificate in certificate chain`.** Supabase does not use a public certificate
authority for Postgres: `aws-1-eu-west-1.pooler.supabase.com` presents `*.pooler.supabase.com`
signed by "Supabase Intermediate 2021 CA", under the self-signed "Supabase Root 2021 CA". Node's
default store therefore refuses, correctly. **The answer is not `rejectUnauthorized: false`**,
which encrypts the password and proves nothing about who receives it. `tools/supabase-ca.crt`
holds that root, fetched from `supabase-downloads.s3.amazonaws.com/prod/ssl/prod-ca-2021.crt`
(the `supabase.com/downloads/...` URL is a 404 now), and it is the only authority the connection
accepts. The hostname is still checked, so the verification is whole. Valid until 2031-04-26; it
is a public certificate and belongs in the repository.

**`(ENOTFOUND) tenant/user postgres.<ref> not found`.** Reads like a password problem and is a
hostname problem: Supavisor answers before it looks at any password. **The project is on
`aws-1-eu-west-1`**, not on a Paris pooler, and neither the digit nor the region can be guessed
from anything. It cost an hour here because the example file carried a fully formed URL with the
real project ref and an invented region, which got pasted verbatim. The example says to copy the
whole string now, and `explain()` in `migrate-cli.ts` translates both errors.

**How the region was found without sending the password**: connect with a deliberately wrong one.
"tenant not found" means the wrong host, "password authentication failed" means the right one.

## Two checks that are now repository commands, 2026-09-08

Both were throwaway scratchpad scripts, and rebuilding the first one twice is what paid for
making them permanent. In `tools/`:

- **`npm run sql-check`** parses `db/schema.sql` and every migration with the real Postgres 17
  grammar (`@pgsql/parser`, wasm, now a devDependency). It parses the whole file, then splits
  each dollar-quoted body and parses those statements one by one, rewriting `perform` and
  `return` and stripping `into <vars>`. 98 statements, 0 failures as of this migration.
  `--verbose` lists what was actually checked, which is how the skipped count is audited.
  Everything the old scratchpad notes said still applies: `parse` is async, a per-character slice
  for line numbers is quadratic and looks exactly like a wasm deadlock, and `declare` fragments
  must be filtered out or eleven false failures bury the real output.
- **`npm run schema-check`** compares the engine's ten interfaces, field by field, against
  `load_plan` and `write_plan_body` in `db/schema.sql`. 70 fields, 2 deliberate exclusions
  (`Pole.path`, derived by a recursive CTE, and `Plan.rules`, a container whose own fields are
  checked as `SchedulingRules` and reached through `#>>'{rules,x}'` where the name carries no
  quotes). It catches the silent data loss nothing else can: a field added to the model and
  forgotten in ONE of the two SQL functions type-checks, parses, passes the tests, displays on
  screen, and vanishes at the next save. Proven by adding `regimeAlimentaire` to `Volunteer` and
  watching it fail.
- **`npm run anon-check`** points the anonymous key from `app/.env.local` at every RPC and prints
  which doors are open. It only ever names an event id that exists nowhere, so nothing it sends
  can change anything. Read `fermée (non exposée)` carefully: PostgREST matches on the name AND
  the argument list, so it also means "migration pas encore appliquée". Run on 2026-09-08 before
  applying this migration: all eight organiser functions closed, `get_volunteer_schedule` and
  `get_public_planning` open, as they must be.
- **`npm run db-check`** compares the live database to `db/schema.sql`, table by table and column
  by column, and is the only check that asks the database anything about its shape. Added after
  the ledger lied, see the section above. Run it before believing any migration is applied, and
  after applying one.

## What remains

1. ~~Run the schema in the Supabase SQL editor.~~ Done 2026-09-08, first pass, no error. It is not
   idempotent (`create type` fails on a second pass), so re-running it means resetting first:
   `drop schema public cascade; create schema public;` plus `drop schema private cascade;` and the
   usual Supabase grants. That reset is only harmless while the project holds no real plan.
2. Auth: magic links, with **"Allow new users to sign up" turned off**. The policies grant
   everything to `authenticated`, so an open sign-up hands the whole planning to anyone who can
   type an email address. Organisers are invited by hand.
3. ~~`SupabasePlanStore`, the swap in `main.tsx`, a connection screen.~~ Done 2026-09-08. 116 app
   tests, typecheck and build clean.
4. ~~Never yet run against the real project.~~ **The whole chain is proven, 2026-09-08.**
   Magic-link login, `list_plans`, `create_plan`, `load_plan`, `save_plan` and the optimistic
   lock, all against the live project. A `balanced` fixture seeded through the picker came back
   from Postgres matching the fixture on all ten entity counts
   (`db/checks/roundtrip_counts.sql`); an edit then saved, bumping the event to version 2 with
   those same ten counts intact, which is the real test since a save deletes the event's whole
   contents and rewrites them from the JSON. Two tabs on one plan produced the conflict banner
   rather than a silent overwrite.
5. The volunteer view, on `get_volunteer_schedule` and `get_public_planning`, both already
   granted to `anon`.
6. ~~Deleting a plan has no path at all.~~ `delete_plan` plus the picker, 2026-09-08.
7. ~~Apply `2026-09-08_version_history_and_delete.sql`.~~ Applied 2026-09-08, and
   `npm run anon-check` confirmed the four new functions closed to the anonymous key.
8. ~~Apply `2026-09-08_version_pinning.sql`.~~ Applied, confirmed by `npm run anon-check`
   reporting `create_plan_checkpoint` and `delete_plan_version` as "droit refusé".
9. ~~Apply `2026-09-08_writing_an_activity_log.sql`.~~ Applied, confirmed by `anon-check`.
10. ~~Apply `2026-09-08_upgrade_safety.sql`.~~ Applied 2026-09-08.
11. ~~Apply `2026-09-08_preference_and_plural_refusals.sql`.~~ Applied 2026-09-08 at 20:49 by
    `npm run migrate -- --apply --only=...`, data intact, verified by `db-check` and
    `anon-check`. **The database is now level with the repository.**
12. Redeploy the app: the save-failure banner of [[feature-admin-ui]] is not on
    planning.ayaatma.fr yet. `npm run deploy` in `tools/`.

Related: [[feature-admin-ui]], [[project-engine-api]], [[project-brief]].
