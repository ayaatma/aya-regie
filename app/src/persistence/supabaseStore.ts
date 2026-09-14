/**
 * The real store: the same four methods, against Postgres.
 *
 * It calls four functions and touches no table. That is deliberate on both sides. In the
 * database, `save_plan` writes a whole plan in one transaction with the version check inside
 * it, which a series of table writes from a browser could never do atomically. Here, it means
 * the whole surface is four names, and a change to the storage shape is a change to one SQL
 * function rather than to a query builder scattered across the app.
 *
 * The version is the lock, exactly as in `FixtureStore`. `load_plan` returns the plan and the
 * version it was read at together, in one call, because reading them separately would leave a
 * window where the version moves under the working copy.
 */

import { normalisePlan } from './normalise.ts';
import { PLAN_FORMAT, PlanIndex, type Plan } from '../engine.ts';
import type { LogEntry } from '../log/logger.ts';
import type {
  CheckpointResult,
  LogRow,
  PlanRef,
  PlanStore,
  PlanVersionRef,
  RestoreResult,
  SaveResult,
  StoredPlan,
  OrganiserPlanning,
  VolunteerSchedule,
} from './types.ts';

/**
 * The one thing this store needs from the Supabase client.
 *
 * Narrowed to an interface so the store can be tested against a stub, with no network, no
 * client and no configuration. The real `SupabaseClient` satisfies it as it stands.
 */
export interface RpcCaller {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * The plan as the database wants it, which is the plan plus one derived field per volunteer.
 *
 * `volunteer.display_name` is the short label a person is shown under wherever the whole name
 * does not fit, and it is written from here rather than computed in SQL. How much of a surname a
 * label needs is a question about the whole roster; the two anonymous read paths in the database,
 * a volunteer's own schedule and the public planning, answer one person at a time. Working it out
 * there would mean a second implementation of `display.ts` that has to agree with this one
 * forever, and the two would eventually disagree about somebody's name.
 *
 * It is deliberately not part of `Plan`. Nothing reads it back: `load_plan` does not return it,
 * `normalise.ts` would drop it, and every save recomputes all of them from scratch. A plan
 * carries no derived value, and this is the write path's business rather than the document's.
 */
function forDatabase(plan: Plan): Record<string, unknown> {
  const index = new PlanIndex(plan);
  return {
    ...plan,
    volunteers: plan.volunteers.map((v) => ({
      ...v,
      displayName: index.volunteerShortName(v.key),
    })),
  };
}

/** What `list_plans()` returns, one row per event. */
interface PlanRow {
  id: string;
  name: string;
  version: number;
  saved_at: string | null;
  volunteer_count: number;
  shift_count: number;
}

/** What `load_plan()` returns, and what a refused `save_plan()` returns alongside its verdict. */
interface Envelope {
  version: number;
  savedAt: string | null;
  plan: unknown;
}

/**
 * An accepted save always carries a timestamp, since `save_plan` sets it in the same statement
 * that bumps the version. Only a refusal can report a null one, for a plan created and never
 * yet written to.
 */
type SaveRow =
  | { ok: true; version: number; savedAt: string }
  | { ok: false; reason: 'format'; required: number }
  | ({ ok: false; reason?: 'conflit' } & Envelope);

interface CreatedRow {
  id: string;
  version: number;
  savedAt: string;
}

/** What `list_plan_versions()` returns. Postgres names its columns with underscores. */
interface VersionRow {
  version: number;
  saved_at: string;
  archived_at: string;
  label: string | null;
  pinned: boolean;
  volunteer_count: number;
  shift_count: number;
  assignment_count: number;
}

/** French, because a régisseur reads it. The server's own words are appended, not translated. */
const WHAT: Record<string, string> = {
  list_plans: 'Impossible de lire la liste des plannings',
  load_plan: 'Impossible de charger le planning',
  save_plan: "Impossible d'enregistrer le planning",
  create_plan: 'Impossible de créer le planning',
  list_plan_versions: "Impossible de lire l'historique du planning",
  restore_plan_version: 'Impossible de restaurer cette version',
  create_plan_checkpoint: "Impossible d'enregistrer cette version",
  delete_plan_version: 'Impossible de supprimer cette version',
  delete_plan: 'Impossible de supprimer le planning',
  read_log: 'Impossible de lire le journal',
  get_volunteer_schedule: 'Impossible de lire votre planning',
  get_organiser_planning: 'Impossible de lire le planning',
};

/** "0 bénévole", "1 bénévole", "2 bénévoles". French takes the singular for zero. */
const plural = (count: number, one: string, many: string): string =>
  `${count} ${count > 1 ? many : one}`;

export class SupabasePlanStore implements PlanStore {
  /** Everything here is visible to every invited organiser. That is the whole point of it. */
  readonly shared = true;

  constructor(private readonly db: RpcCaller) {}

  private async call(fn: string, args?: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw new Error(`${WHAT[fn] ?? 'Erreur de la base'}: ${error.message}`);
    return data;
  }

  async list(): Promise<PlanRef[]> {
    const rows = ((await this.call('list_plans')) ?? []) as PlanRow[];
    return rows.map((row) => ({
      id: row.id,
      label: row.name,
      detail: `${plural(row.volunteer_count, 'bénévole', 'bénévoles')}, ${plural(
        row.shift_count,
        'créneau',
        'créneaux',
      )}`,
    }));
  }

  async load(id: string): Promise<StoredPlan> {
    const envelope = (await this.call('load_plan', { p_event_id: id })) as Envelope | null;
    // Null covers both "no such plan" and "row level security showed you nothing", which from
    // here are the same thing and have the same answer.
    if (!envelope) throw new Error(`Planning introuvable ou inaccessible: ${id}`);
    return this.stored(id, envelope);
  }

  async save(
    id: string,
    plan: Plan,
    baseVersion: number,
    label?: string | null,
  ): Promise<SaveResult> {
    const result = (await this.call('save_plan', {
      p_event_id: id,
      p_base_version: baseVersion,
      p_plan: forDatabase(plan),
      // The version this save creates is archived under this line the next time somebody saves,
      // so a history row reads "déplacement de Marie Perrin" rather than a number.
      p_label: label ?? null,
      // What this build knows the document to look like. The database refuses anything older
      // than it requires, which is the only thing standing between a tab left open across a
      // deploy and a field silently wiped for everybody.
      p_format: PLAN_FORMAT,
    })) as SaveRow;

    if (result.ok) return { ok: true, version: result.version, savedAt: result.savedAt };
    if (result.reason === 'format') return { ok: false, outdated: { required: result.required } };
    // Refused, and the refusal carries what the database actually holds, so the banner can
    // offer both versions without a second round trip.
    return { ok: false, conflict: this.stored(id, result) };
  }

  /**
   * There are no local edits to throw away here, so this is a reload.
   *
   * `FixtureStore.reset` drops what localStorage holds and goes back to the pristine scenario.
   * Against the database the pristine plan is what the database holds, and re-reading it is
   * exactly what the régisseur is asking for when they press the button.
   */
  async reset(id: string): Promise<StoredPlan> {
    return this.load(id);
  }

  async create(plan: Plan): Promise<StoredPlan> {
    const created = (await this.call('create_plan', {
      p_plan: forDatabase(plan),
      p_format: PLAN_FORMAT,
    })) as CreatedRow;
    return {
      id: created.id,
      plan: normalisePlan(plan),
      version: created.version,
      savedAt: created.savedAt,
    };
  }

  async history(id: string): Promise<PlanVersionRef[]> {
    const rows = ((await this.call('list_plan_versions', { p_event_id: id })) ??
      []) as VersionRow[];
    return rows.map((row) => ({
      version: row.version,
      savedAt: row.saved_at,
      archivedAt: row.archived_at,
      label: row.label,
      pinned: row.pinned,
      volunteers: row.volunteer_count,
      shifts: row.shift_count,
      assignments: row.assignment_count,
    }));
  }

  /**
   * The database does the whole restore in one transaction and hands back the resulting state,
   * so there is no window here where the plan and the version it is at could disagree.
   */
  async restore(id: string, version: number, baseVersion: number): Promise<RestoreResult> {
    const result = (await this.call('restore_plan_version', {
      p_event_id: id,
      p_version: version,
      p_base_version: baseVersion,
    })) as { ok: boolean } & Envelope;

    const stored = this.stored(id, result);
    return result.ok ? { ok: true, stored } : { ok: false, conflict: stored };
  }

  /**
   * Naming the stored version. Nothing about the plan changes, so there is no envelope to read
   * back and no working copy to replace: the history screen re-reads its list and that is all.
   */
  async checkpoint(id: string, name: string, baseVersion: number): Promise<CheckpointResult> {
    const result = (await this.call('create_plan_checkpoint', {
      p_event_id: id,
      p_name: name,
      p_base_version: baseVersion,
    })) as CheckpointResult;
    return result;
  }

  async forgetVersion(id: string, version: number): Promise<void> {
    await this.call('delete_plan_version', { p_event_id: id, p_version: version });
  }

  /**
   * The journal, written in batches.
   *
   * It goes through `call` like everything else, so a refusal is a French error, and the logger
   * is what swallows it: a journal that can take an edit down with it is worse than no journal.
   */
  async appendLog(eventId: string | null, entries: readonly LogEntry[]): Promise<unknown> {
    return this.call('write_log', { p_event_id: eventId, p_entries: entries });
  }

  async readLog(eventId: string | null, limit = 200, before?: number): Promise<LogRow[]> {
    const rows = ((await this.call('read_log', {
      p_event_id: eventId,
      p_limit: limit,
      p_before: before ?? null,
    })) ?? []) as Array<{
      id: number;
      at: string;
      received_at: string;
      level: LogRow['level'];
      kind: string;
      message: string;
      detail: Record<string, unknown> | null;
      actor: string | null;
      session: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      receivedAt: row.received_at,
      level: row.level,
      kind: row.kind,
      message: row.message,
      detail: row.detail,
      actor: row.actor,
      session: row.session,
    }));
  }

  /**
   * The one call that works without an account.
   *
   * `get_volunteer_schedule` is SECURITY DEFINER and granted to anon, so this reaches it with
   * the anonymous key and no session. It returns null for a code nobody has, which is the same
   * answer as for a code that exists but belongs to nobody: from here they are the same thing.
   */
  async volunteerSchedule(code: string): Promise<VolunteerSchedule | null> {
    const found = await this.call('get_volunteer_schedule', { p_code: code });
    return (found as VolunteerSchedule | null) ?? null;
  }

  /**
   * The second call that works without an account, and the one that returns the most.
   *
   * `get_organiser_planning` is SECURITY DEFINER and granted to anon, like the volunteers' one. A
   * code nobody has returns null, and so does an empty code: the function refuses `access_code =
   * ''` explicitly, because that is the state every organiser starts in before the régisseur issues
   * one, and matching on it would open the planning to an empty string.
   *
   * NORMALISED ON THE WAY IN, like every other plan crossing this boundary. Without it a organiser
   * opening an event saved by an older build would meet the blank screen `normalise.ts` exists
   * to prevent, and they have no way to report it and no way around it.
   */
  async organiserPlanning(code: string): Promise<OrganiserPlanning | null> {
    const found = (await this.call('get_organiser_planning', { p_code: code })) as
      | (Omit<OrganiserPlanning, 'plan'> & { plan: unknown })
      | null;
    if (!found) return null;
    return { ...found, plan: normalisePlan(found.plan) };
  }

  /**
   * The name is checked by `delete_plan` itself, not here. A guard in the browser is a guard
   * that a broken build removes.
   */
  async remove(id: string, confirmName: string): Promise<void> {
    await this.call('delete_plan', { p_event_id: id, p_confirm_name: confirmName });
  }

  /** Normalised on the way in, always. See normalise.ts: the database is outside too. */
  private stored(id: string, envelope: Envelope): StoredPlan {
    return {
      id,
      plan: normalisePlan(envelope.plan),
      version: envelope.version,
      savedAt: envelope.savedAt,
    };
  }
}
