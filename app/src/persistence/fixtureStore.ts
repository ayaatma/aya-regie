/**
 * The development store: the generated scenarios, edited locally.
 *
 * A scenario is fetched once from `public/fixtures/`, then every save writes to localStorage
 * with a version number, exactly as Supabase will. The optimistic lock is real here too: open
 * the same scenario in two tabs, edit both, and the second save is refused with the banner.
 * That is deliberate, because a conflict path only ever works if it is exercised.
 *
 * Fixtures are written by `npm run fixture -- --all` in `tools/`.
 */

import { PlanIndex, type Plan } from '../engine.ts';
import type { LogEntry } from '../log/logger.ts';
import { normalisePlan } from './normalise.ts';
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

interface Manifest {
  generatedAt: string;
  scenarios: Array<{ id: string; file: string; label: string; volunteers: number; shifts: number }>;
}

interface Envelope {
  plan: Plan;
  version: number;
  savedAt: string;
  /** What the régisseur did to produce this plan. Absent on an envelope written before 2026-09-08. */
  label?: string | null;
}

/** One archived version, the localStorage twin of a `plan_version` row. */
interface Archived extends Envelope {
  archivedAt: string;
  /** Named by the régisseur, and therefore exempt from both retention rules below. */
  pinned?: boolean;
}

const KEY_PREFIX = 'lototekno:plan:';
const VERSIONS_PREFIX = 'lototekno:versions:';
const LOG_PREFIX = 'lototekno:log:';

/**
 * How many journal entries this store keeps, against 5000 in Postgres.
 *
 * The same reason the version cap is 5 here and 50 there: localStorage is about 5 MB in total,
 * shared with the plan itself, and losing the plan to make room for its journal would be the
 * wrong way round.
 */
const LOG_MAX = 500;

/**
 * The same two retention rules as the database, and the same reasoning, with one number changed.
 *
 * KEEP_EVERY: a save whose predecessor was archived less than this ago archives nothing, keeping
 * the OLDER body. A restore point thirty seconds back is worth nothing, since Ctrl+Z already
 * goes there.
 *
 * KEEP_MAX is 5 here against 50 in Postgres, and that is the one deliberate difference: a plan
 * is about 100 KB of JSON and the whole of localStorage is about 5 MB, shared with everything
 * else this origin stores. Fifty versions here would break the plan itself, which is a worse
 * failure than a short history on the development path.
 *
 * KEEP_DAYS bounds the other end. Neither rule ever touches a pinned version: a version the
 * régisseur named is kept until they say otherwise, which is the whole point of naming it.
 */
const KEEP_EVERY_MS = 10 * 60 * 1000;
const KEEP_MAX = 5;
const KEEP_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

const readLocal = (id: string): Envelope | null => {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + id);
    return raw ? (JSON.parse(raw) as Envelope) : null;
  } catch {
    // A private window, or storage the browser refuses. Falling back to the pristine fixture is
    // the right answer: the régisseur loses local edits, never the scenario itself.
    return null;
  }
};

const writeLocal = (id: string, envelope: Envelope): void => {
  try {
    window.localStorage.setItem(KEY_PREFIX + id, JSON.stringify(envelope));
  } catch {
    // Out of quota or storage denied. The save is reported as accepted because the in-memory
    // plan is still the truth; the real store will not have this failure mode.
  }
};

const readVersions = (id: string): Archived[] => {
  try {
    const raw = window.localStorage.getItem(VERSIONS_PREFIX + id);
    return raw ? (JSON.parse(raw) as Archived[]) : [];
  } catch {
    return [];
  }
};

const writeVersions = (id: string, versions: Archived[]): void => {
  try {
    window.localStorage.setItem(VERSIONS_PREFIX + id, JSON.stringify(versions));
  } catch {
    // The history is the first thing to give up its space, never the plan. Losing a restore
    // point is a smaller failure than a save that cannot land.
  }
};

/**
 * Keeping the version about to be overwritten, under the two rules above.
 *
 * `force` is what a restore passes: restoring overwrites the live plan, so what it overwrites is
 * kept whatever the clock says.
 */
const archive = (
  id: string,
  outgoing: Envelope | null,
  force: boolean,
  pin?: { name: string },
): void => {
  if (!outgoing) return;
  const versions = readVersions(id);
  const newest = versions[versions.length - 1];
  if (!force && newest && Date.now() - Date.parse(newest.archivedAt) < KEEP_EVERY_MS) return;

  const already = versions.find((v) => v.version === outgoing.version);
  if (already) {
    // Naming a version already in the history is a request to NAME it, and answering with
    // silence would look exactly like a button that does nothing.
    if (!pin) return;
    already.label = pin.name;
    already.pinned = true;
    already.archivedAt = new Date().toISOString();
    writeVersions(id, versions);
    return;
  }

  versions.push({
    ...outgoing,
    label: pin ? pin.name : outgoing.label,
    pinned: pin !== undefined,
    archivedAt: new Date().toISOString(),
  });

  // Both rules count and cut only the automatic versions. Five automatic versions stay five
  // however many checkpoints sit among them.
  const pinned = versions.filter((v) => v.pinned);
  const automatic = versions
    .filter((v) => !v.pinned && Date.now() - Date.parse(v.archivedAt) < KEEP_DAYS_MS)
    .slice(-KEEP_MAX);
  writeVersions(
    id,
    [...pinned, ...automatic].sort((a, b) => a.version - b.version),
  );
};

export class FixtureStore implements PlanStore {
  /** One browser, one régisseur. Nothing here reaches anybody else. */
  readonly shared = false;

  private manifest: Manifest | null = null;
  private readonly pristine = new Map<string, Plan>();

  private async loadManifest(): Promise<Manifest> {
    if (this.manifest) return this.manifest;
    const response = await fetch('fixtures/manifest.json');
    if (!response.ok) {
      throw new Error(
        'Aucun jeu de test trouvé. Lancez `npm run fixture -- --all` dans le dossier tools.',
      );
    }
    this.manifest = (await response.json()) as Manifest;
    return this.manifest;
  }

  async list(): Promise<PlanRef[]> {
    const manifest = await this.loadManifest();
    return manifest.scenarios.map((s) => ({
      id: s.id,
      label: s.label,
      detail: `${s.volunteers} bénévoles, ${s.shifts} créneaux`,
    }));
  }

  private async fetchPristine(id: string): Promise<Plan> {
    const cached = this.pristine.get(id);
    if (cached) return cached;
    const manifest = await this.loadManifest();
    const entry = manifest.scenarios.find((s) => s.id === id);
    if (!entry) throw new Error(`Jeu de test inconnu: ${id}`);
    const response = await fetch(`fixtures/${entry.file}`);
    if (!response.ok) throw new Error(`Jeu de test illisible: ${entry.file}`);
    const plan = normalisePlan(await response.json());
    this.pristine.set(id, plan);
    return plan;
  }

  async load(id: string): Promise<StoredPlan> {
    const local = readLocal(id);
    // Normalised on the way in, always. A plan in storage was written by an older version of
    // this code and can be missing a field the screens now read. See normalise.ts.
    if (local) {
      return {
        id,
        plan: normalisePlan(local.plan),
        version: local.version,
        savedAt: local.savedAt,
      };
    }
    return { id, plan: await this.fetchPristine(id), version: 0, savedAt: null };
  }

  async save(
    id: string,
    plan: Plan,
    baseVersion: number,
    label?: string | null,
  ): Promise<SaveResult> {
    const current = readLocal(id);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== baseVersion) {
      return {
        ok: false,
        conflict: {
          id,
          plan: current ? normalisePlan(current.plan) : await this.fetchPristine(id),
          version: currentVersion,
          savedAt: current?.savedAt ?? null,
        },
      };
    }
    // Before the overwrite, exactly as save_plan does. The pristine scenario is never archived
    // here, because it is not in storage in the first place: `reset` is the way back to it.
    archive(id, current, false);

    const envelope: Envelope = {
      plan,
      version: currentVersion + 1,
      savedAt: new Date().toISOString(),
      label: label ?? null,
    };
    writeLocal(id, envelope);
    return { ok: true, version: envelope.version, savedAt: envelope.savedAt };
  }

  async reset(id: string): Promise<StoredPlan> {
    try {
      window.localStorage.removeItem(KEY_PREFIX + id);
      // The history goes with the edits it describes. Keeping it would leave version numbers
      // that restart at zero pointing at bodies from a previous life.
      window.localStorage.removeItem(VERSIONS_PREFIX + id);
    } catch {
      // Nothing to undo if storage was never reachable.
    }
    return { id, plan: await this.fetchPristine(id), version: 0, savedAt: null };
  }

  async history(id: string): Promise<PlanVersionRef[]> {
    return readVersions(id)
      .map((version) => ({
        version: version.version,
        savedAt: version.savedAt,
        archivedAt: version.archivedAt,
        label: version.label ?? null,
        pinned: version.pinned === true,
        volunteers: version.plan.volunteers.length,
        shifts: version.plan.shifts.length,
        assignments: version.plan.assignments.length,
      }))
      .reverse();
  }

  /**
   * A volunteer's own schedule, rebuilt here from a scenario.
   *
   * Postgres does this in `get_volunteer_schedule`, filtered inside the database. There is no
   * database on this path, so the same shape is assembled from the plan, and every scenario is
   * searched because a code belongs to one of them and nothing says which. That is a development
   * convenience and would be a security hole against real data, which is exactly why the real
   * store does not work this way: there, the browser never sees a row it was not given.
   */
  async volunteerSchedule(code: string): Promise<VolunteerSchedule | null> {
    const wanted = code.trim().toUpperCase();
    if (wanted === '') return null;

    const manifest = await this.loadManifest();
    for (const scenario of manifest.scenarios) {
      const stored = await this.load(scenario.id);
      const plan = stored.plan;
      const me = plan.volunteers.find((v) => v.accessCode.toUpperCase() === wanted);
      if (!me) continue;

      const index = new PlanIndex(plan);
      const start = new Date(plan.startISO).getTime();
      const at = (hours: number): string => new Date(start + hours * 3600_000).toISOString();
      const pathOf = (poleKey: string): string =>
        plan.poles.find((p) => p.key === poleKey)?.path ?? poleKey;

      const creneaux = plan.assignments
        .filter((a) => a.volunteerKey === me.key)
        .map((a) => plan.shifts.find((s) => s.key === a.shiftKey))
        .filter((shift): shift is NonNullable<typeof shift> => shift !== undefined)
        .sort((a, b) => a.start - b.start)
        .map((shift) => ({
          debut: at(shift.start),
          fin: at(shift.end),
          pole: pathOf(shift.poleKey),
          // One entry per person, not per role: a organiser running two windows on the pole above
          // this shift is still one name and one number to a volunteer reading their schedule.
          responsables: [
            ...new Map(
              plan.leaderRoles
                .filter((role) => pathOf(shift.poleKey).startsWith(pathOf(role.poleKey)))
                .flatMap((role) => {
                  const organiser = plan.organisers.find((l) => l.key === role.organiserKey);
                  return organiser ? [[organiser.key, organiser] as const] : [];
                }),
            ).values(),
          ].map((organiser) => ({
            nom: `${organiser.firstName} ${organiser.lastName}`.trim(),
            telephone: organiser.phone,
            email: organiser.email,
          })),
          // The short label and nothing else: a volunteer may know who they are working with,
          // never how to reach them. The database does it from `volunteer.display_name`, which
          // the browser computes with this same function and writes on every save, so the two
          // sides cannot drift into two different answers.
          avec: index
            .assigneesOf(shift.key)
            .filter((other) => other.key !== me.key)
            .map((other) => index.volunteerShortName(other.key))
            .sort((a, b) => a.localeCompare(b, 'fr')),
        }));

      return {
        benevole: {
          prenom: me.firstName,
          nom: me.lastName,
          heures_demandees: me.requestedHours,
        },
        creneaux,
        // The same reading as `get_volunteer_schedule`: decisions only, both phases together,
        // in clock order. A phase that is off answers nothing at all.
        phases: (['montage', 'demontage'] as const).flatMap((id) => {
          const phase = id === 'montage' ? stored.plan.montage : stored.plan.demontage;
          if (!phase.enabled) return [];
          const at = (hours: number): string =>
            new Date(new Date(phase.startISO).getTime() + hours * 3600_000).toISOString();
          return phase.assignments
            .filter((a) => a.personKind === 'benevole' && a.personKey === me.key)
            .sort((a, b) => a.start - b.start)
            .map((a) => ({
              phase: id,
              debut: at(a.start),
              fin: at(a.end),
              pole: phase.poles.find((p) => p.key === a.poleKey)?.name ?? '',
              evenement: phase.events.find((e) => e.key === a.eventKey)?.label ?? '',
            }));
        }),
      };
    }
    return null;
  }

  /**
   * The development twin of `get_organiser_planning`.
   *
   * Same caveat as `volunteerSchedule` above and it matters more here, because what this returns
   * is the entire plan: every scenario is searched, in the browser, over data the browser already
   * holds. That is a development convenience and would be a security hole against real data. It
   * is precisely why the real store asks Postgres instead: there the filtering happens on the
   * far side of the boundary, and a wrong code is handed nothing rather than being handed
   * everything and asked not to look.
   *
   * The fixtures carry no organisers and no codes, so on the standard scenarios this always answers
   * null. It is here so the screen has a store method to call at all, and so a scenario edited
   * by hand to hold a organiser with a code opens the view without a database.
   */
  async organiserPlanning(code: string): Promise<OrganiserPlanning | null> {
    const wanted = code.trim().toUpperCase();
    if (wanted === '') return null;

    const manifest = await this.loadManifest();
    for (const scenario of manifest.scenarios) {
      const stored = await this.load(scenario.id);
      const me = stored.plan.organisers.find(
        (l) => l.accessCode !== '' && l.accessCode.toUpperCase() === wanted,
      );
      if (!me) continue;

      return {
        responsable: {
          key: me.key,
          prenom: me.firstName,
          nom: me.lastName,
          poleKeys: [
            ...new Set(
              stored.plan.leaderRoles.filter((r) => r.organiserKey === me.key).map((r) => r.poleKey),
            ),
          ],
        },
        eventId: stored.id,
        plan: stored.plan,
        version: stored.version,
      };
    }
    return null;
  }

  /**
   * Naming the stored version, which changes nothing about the plan itself.
   *
   * Version 0 is the pristine scenario, which lives in a file rather than in storage, so there
   * is nothing to name until something has been saved. The database never has that state.
   */
  async checkpoint(id: string, name: string, baseVersion: number): Promise<CheckpointResult> {
    const current = readLocal(id);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== baseVersion || !current) {
      return { ok: false, version: currentVersion };
    }
    archive(id, current, true, { name: name.trim() });
    return { ok: true, version: currentVersion };
  }

  /**
   * The journal, in this browser.
   *
   * It exists on this path for one reason: the code that reads and writes it has to be exercised
   * somewhere, and the fixtures are the only place the tests can reach. Nothing written here ever
   * leaves the browser, which is exactly why the real store keeps it in Postgres instead.
   */
  async appendLog(eventId: string | null, entries: readonly LogEntry[]): Promise<unknown> {
    const key = LOG_PREFIX + (eventId ?? '_');
    const existing = this.readLogRows(key);
    const nextId = (existing[0]?.id ?? 0) + 1;
    const added: LogRow[] = entries.map((entry, index) => ({
      id: nextId + index,
      at: entry.at,
      receivedAt: new Date().toISOString(),
      level: entry.level,
      kind: entry.kind,
      message: entry.message,
      detail: entry.detail ?? null,
      actor: entry.actor ?? null,
      session: entry.session,
    }));

    try {
      // Newest first in storage, which is the order everything reads it in.
      window.localStorage.setItem(key, JSON.stringify([...added.reverse(), ...existing].slice(0, LOG_MAX)));
    } catch {
      // Out of quota, or storage refused. The journal is the first thing to give up its space.
    }
    return added.length;
  }

  async readLog(eventId: string | null, limit = 200, before?: number): Promise<LogRow[]> {
    const rows = this.readLogRows(LOG_PREFIX + (eventId ?? '_'));
    return rows.filter((row) => before === undefined || row.id < before).slice(0, limit);
  }

  private readLogRows(key: string): LogRow[] {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as LogRow[]) : [];
    } catch {
      return [];
    }
  }

  async forgetVersion(id: string, version: number): Promise<void> {
    const versions = readVersions(id);
    const kept = versions.filter((v) => v.version !== version);
    if (kept.length === versions.length) throw new Error(`Version ${version} introuvable.`);
    writeVersions(id, kept);
  }

  /** A restore is a save: the state it replaces is archived, and it lands as a new version. */
  async restore(id: string, version: number, baseVersion: number): Promise<RestoreResult> {
    const current = readLocal(id);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== baseVersion) {
      return {
        ok: false,
        conflict: {
          id,
          plan: current ? normalisePlan(current.plan) : await this.fetchPristine(id),
          version: currentVersion,
          savedAt: current?.savedAt ?? null,
        },
      };
    }

    const wanted = readVersions(id).find((v) => v.version === version);
    if (!wanted) throw new Error(`Version ${version} introuvable dans l'historique.`);

    archive(id, current, true);
    const envelope: Envelope = {
      plan: wanted.plan,
      version: currentVersion + 1,
      savedAt: new Date().toISOString(),
      label: `Retour à la version ${version}`,
    };
    writeLocal(id, envelope);
    return {
      ok: true,
      stored: {
        id,
        plan: normalisePlan(envelope.plan),
        version: envelope.version,
        savedAt: envelope.savedAt,
      },
    };
  }
}
