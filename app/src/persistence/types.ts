/**
 * The one seam between the screens and wherever the plan actually lives.
 *
 * Today that is a fixture file plus localStorage; tomorrow it is Supabase. Nothing above this
 * interface knows the difference, which is the whole reason the grid could be built and
 * exercised on real-sized data before a line of SQL was written.
 *
 * THE VERSION IS THE LOCK. Every save states which version it was built on. A store that has
 * moved on refuses the write and hands back what it holds, so a second organiser's afternoon
 * of work can never be overwritten in silence. This is the "quelqu'un a modifié ce planning"
 * banner, decided 2026-09-07, and it is why there is no realtime and no WebSocket anywhere.
 */

import type { Plan } from '../engine.ts';
import type { LogEntry } from '../log/logger.ts';

export interface PlanRef {
  id: string;
  label: string;
  /** What the picker shows under the name: "120 bénévoles, 91 créneaux". */
  detail: string;
}

export interface StoredPlan {
  id: string;
  plan: Plan;
  version: number;
  /** ISO timestamp of the last accepted write, or null when nothing has been saved yet. */
  savedAt: string | null;
}

/**
 * Three outcomes, not two.
 *
 * `conflict` is somebody else having saved first, and it is a negotiation: the régisseur chooses
 * whose version wins. `outdated` is this browser being too old to be allowed to write at all,
 * and it is not a negotiation: a build that does not know about a field would strip it from the
 * document and write the result over everybody's. There is nothing to choose, only a page to
 * reload, so the two must never be shown as the same thing.
 */
export type SaveResult =
  | { ok: true; version: number; savedAt: string }
  | { ok: false; conflict: StoredPlan }
  | { ok: false; outdated: { required: number } };

/**
 * One kept version of a plan, as the history screen lists it.
 *
 * Counts rather than a diff: what a régisseur recognises a version by is its shape, "avant
 * l'import il y avait 78 bénévoles", plus the label of the edit that produced it. A field by
 * field comparison of two plans is a build of its own and is deliberately not here.
 */
export interface PlanVersionRef {
  version: number;
  /** When this version was written. */
  savedAt: string;
  /** When it was displaced by the save that replaced it. */
  archivedAt: string;
  /**
   * French. The name the régisseur gave this version if they pinned it, otherwise what they did
   * to produce it. Null for versions written before 2026-09-08.
   */
  label: string | null;
  /**
   * Named by the régisseur, and therefore exempt from every automatic retention rule.
   *
   * The automatic versions are kept on a clock: one every ten minutes of work, the newest fifty,
   * nothing older than sixty days. That is right for an afternoon of dragging boxes and wrong
   * for the four or five states of this plan that will matter in March, which is what pinning
   * is for.
   */
  pinned: boolean;
  volunteers: number;
  shifts: number;
  assignments: number;
}

/**
 * Going back to a kept version.
 *
 * A restore is a save, not a rewind: it writes the old body as a NEW version, so the state it
 * replaces is kept too and a restore can itself be undone. It is refused on a stale version for
 * exactly the reason a save is, and the refusal carries what the store actually holds.
 */
export type RestoreResult =
  | { ok: true; stored: StoredPlan }
  | { ok: false; conflict: StoredPlan };

/**
 * Naming the version currently stored, so it is kept until somebody says otherwise.
 *
 * Refused when the store has moved on, and that refusal is not the optimistic lock doing its
 * usual job: there is nothing to overwrite here. It is that naming a version is a statement
 * about the plan you are looking at, and if somebody else has saved since, the version you would
 * be naming is theirs.
 */
export type CheckpointResult = { ok: true; version: number } | { ok: false; version: number };

/** One line of the journal, as the screen that shows it reads it back. */
export interface LogRow {
  id: number;
  /** ISO, from the browser that recorded it. */
  at: string;
  /** ISO, from the database that received it. Lags by a few seconds, since entries are batched. */
  receivedAt: string;
  level: 'info' | 'warn' | 'error';
  kind: string;
  message: string;
  detail: Record<string, unknown> | null;
  actor: string | null;
  session: string;
}

/**
 * What a volunteer sees, and the only thing they can reach.
 *
 * THE FIELD NAMES ARE FRENCH BECAUSE POSTGRES OWNS THIS SHAPE. `get_volunteer_schedule` builds
 * it inside the database, filters it there by the access code, and returns it to a caller who has
 * no account at all. Renaming the keys on the way in would put a translation layer between the
 * security boundary and the screen, for nothing.
 *
 * What it deliberately does not carry: anybody else's phone number or mail address. Other
 * volunteers appear as "Marie D.", and the only contact details are the pole organisers', who are
 * exactly the people a volunteer may need to call.
 */
export interface VolunteerSchedule {
  benevole: { prenom: string; nom: string; heures_demandees: number };
  creneaux: Array<{
    debut: string;
    fin: string;
    pole: string;
    responsables: Array<{ nom: string; telephone: string; email: string }>;
    avec: string[];
  }>;
  /**
   * What this person does on the montage and on the démontage, when they are on either.
   *
   * DECISIONS ONLY. A bénévole placed nowhere in particular is on site without a box, and the
   * default placement is computed from the phase's own settings by whoever draws the grid: this
   * query answers one person at a time and could only guess at it. Empty is therefore a normal
   * answer for somebody who is coming, and the page says so rather than saying nothing.
   */
  phases: Array<{
    phase: 'montage' | 'demontage';
    debut: string;
    fin: string;
    pole: string;
    evenement: string;
  }>;
}

/**
 * What a pole organiser gets back for their code: the plan, and who they are.
 *
 * The plan half is the same document the régisseur loads, deliberately. One source for its shape
 * means a field added to `Plan` reaches the organisers' view for free and cannot be forgotten in a
 * second query. The rest is the envelope the screen needs before it can draw anything: whose
 * code this was, and which poles they run, so the grid can open on their own filter rather than
 * on everything.
 *
 * `poleKeys` empty is a normal answer, not an error: somebody imported from the organisers' form
 * but not yet put in charge of anything. The screen opens on the whole grid and says so.
 */
export interface OrganiserPlanning {
  responsable: { key: string; prenom: string; nom: string; poleKeys: string[] };
  eventId: string;
  plan: Plan;
  version: number;
}

export interface PlanStore {
  /**
   * Whether other organisers see what this store holds.
   *
   * False for the fixtures, which never leave one browser, true once the plans live in the
   * database. The picker says which of the two the régisseur is looking at, because "your
   * changes are saved in this browser" and "your changes are visible to everyone" are not the
   * same promise and getting them the wrong way round is how work goes missing.
   */
  readonly shared: boolean;
  /** The plans this store can open. */
  list(): Promise<PlanRef[]>;
  load(id: string): Promise<StoredPlan>;
  /**
   * `label` is what the régisseur just did, in French, and it is stored against the version this
   * save creates. It is only ever read back by the history screen, so a store with no history
   * ignores it.
   */
  save(id: string, plan: Plan, baseVersion: number, label?: string | null): Promise<SaveResult>;
  /** Throws away local edits and returns the pristine plan. */
  reset(id: string): Promise<StoredPlan>;
  /**
   * The versions this store kept, newest first, or undefined for a store that keeps none.
   *
   * A save overwrites a plan whole, so without this the only way back is Ctrl+Z, which covers
   * one browser and one sitting and nothing else.
   */
  history?(id: string): Promise<PlanVersionRef[]>;
  restore?(id: string, version: number, baseVersion: number): Promise<RestoreResult>;
  /** Keeps the stored version under a name of the régisseur's choosing, for good. */
  checkpoint?(id: string, name: string, baseVersion: number): Promise<CheckpointResult>;
  /**
   * Forgets one kept version, named or automatic.
   *
   * Pinning would otherwise be a one-way door: a checkpoint made by mistake would sit there for
   * the life of the plan. This is the only thing in the history that destroys anything, and it
   * happens on a deliberate press and nowhere else.
   */
  forgetVersion?(id: string, version: number): Promise<void>;
  /**
   * Writes a batch of journal entries, for a plan or for none.
   *
   * Called by the logger and by nothing else. It must never be the reason an edit fails, so
   * whatever it rejects with is swallowed one level up.
   */
  appendLog?(eventId: string | null, entries: readonly LogEntry[]): Promise<unknown>;
  /** Reads the journal back, newest first. */
  readLog?(eventId: string | null, limit?: number, before?: number): Promise<LogRow[]>;
  /**
   * Deletes a plan outright, cascading to everything in it.
   *
   * `confirmName` is the plan's own name, re-typed, and the store checks it. That check lives as
   * far down as it can go: a modal is one stray Entrée away from an event and everyone in it.
   */
  remove?(id: string, confirmName: string): Promise<void>;
  /**
   * One volunteer's own schedule, by access code, with no account and no session.
   *
   * The code is the authentication and the database is the enforcement: filtering happens in
   * Postgres, so a wrong or guessed code returns nothing rather than returning everything for
   * the browser to filter. Null means no such code.
   */
  volunteerSchedule?(code: string): Promise<VolunteerSchedule | null>;
  /**
   * The whole planning, read only, for a pole organiser's access code.
   *
   * Same shape of guarantee as `volunteerSchedule` and the same reason: `get_organiser_planning` is
   * SECURITY DEFINER, takes the code as its argument, and a wrong code returns null rather than
   * returning everything for the browser to sift. Null means no such code.
   *
   * WHAT COMES BACK IS THE WHOLE PLAN, contact details of every volunteer included. That is what
   * the régisseur asked for on 2026-09-09, and it is why a organiser's code is fourteen characters
   * rather than eight. See `.claude/memory/feature_leader_access.md`.
   *
   * There is no matching write. A organiser has no account, and every write in the schema requires
   * `authenticated`, so read-only is a property of the database rather than of the interface.
   */
  organiserPlanning?(code: string): Promise<OrganiserPlanning | null>;
  /**
   * Puts a plan the store has never seen into it, under a new id.
   *
   * Optional, because a store over fixed scenarios has nothing to create into. The import
   * screen will want this once an accepted import becomes a plan of its own.
   */
  create?(plan: Plan): Promise<StoredPlan>;
}
