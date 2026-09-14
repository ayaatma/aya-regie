/**
 * The edits the Réglages screen makes: poles, shifts, organisers, and the scheduling rules.
 *
 * These change the shape of the event rather than who works when, and several of them destroy
 * assignments as a side effect: deleting a pole deletes its shifts, and deleting a shift removes
 * the people standing in it. That is allowed, but it is never quiet. Each of those functions has
 * a companion that says exactly what would be lost, so the screen can put the number in front of
 * the régisseur before they commit. Nothing here ever moves a volunteer somewhere else to tidy
 * up: it removes, or it refuses.
 *
 * Two of them are purely additive and need no such warning: duplicating a pole copies the shape
 * of the work and nobody standing in it, and reordering poles changes the order every screen draws
 * them in and nothing else.
 *
 * Volunteers' answers are never rewritten. If somebody chose a pole that is later deleted, their
 * answer stays as they gave it and the reference simply stops resolving, which the screen
 * reports. Editing what a person said they wanted, to make the data tidy, is the one thing this
 * tool must not do.
 */

import { ORGANISER_CODE_LENGTH, alignPhases, makeArtist, newAccessCode } from '../engine.ts';
import type { Artist, Organiser, LeaderRole, Plan, Pole, SchedulingRules, Shift, VolumeSettings } from '../engine.ts';

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** "Bar / Réassort" becomes "bar--reassort", matching what the generator produces. */
const slug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** What a pole's shifts last when nothing says otherwise. Two hours, as they always did. */
export const FALLBACK_SHIFT_HOURS = 2;

/** The length a new shift of this pole gets. Read at creation only, never afterwards. */
export const defaultShiftHours = (pole: Pole): number =>
  pole.defaultShiftHours && pole.defaultShiftHours > 0
    ? pole.defaultShiftHours
    : FALLBACK_SHIFT_HOURS;

/** A key nothing else in the plan uses, however many poles share a name. */
function freeKey(taken: ReadonlySet<string>, base: string): string {
  const root = base === '' ? 'pole' : base;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------------------
// Scheduling rules
// ---------------------------------------------------------------------------

/**
 * The rules every screen validates against, changed in one go.
 *
 * Loosening a rule cannot break an existing plan. Tightening one can, and does so visibly:
 * dropping the consecutive cap to 3 h turns every 4 h block red on the grid. That is the right
 * behaviour, and the reason nothing is re-solved here.
 */
export function setRules(plan: Plan, rules: Partial<SchedulingRules>): Plan {
  const merged = { ...plan.rules, ...rules };
  return {
    ...plan,
    rules: {
      maxConsecutiveHours: Math.max(0.5, merged.maxConsecutiveHours),
      maxBlocks: Math.max(1, Math.round(merged.maxBlocks)),
      minBreakHours: Math.max(0, merged.minBreakHours),
      minHoursPerPerson: Math.max(0, merged.minHoursPerPerson),
    },
  };
}

// ---------------------------------------------------------------------------
// Poles
// ---------------------------------------------------------------------------

const pathOf = (poles: readonly Pole[], parentKey: string | null, name: string): string => {
  const parent = parentKey ? poles.find((p) => p.key === parentKey) : undefined;
  return parent ? `${parent.path} / ${name}` : name;
};

export function addPole(plan: Plan, name: string, parentKey: string | null): Plan {
  const trimmed = name.trim();
  if (trimmed === '') return plan;

  const taken = new Set(plan.poles.map((p) => p.key));
  const parent = parentKey ? plan.poles.find((p) => p.key === parentKey) : undefined;
  const key = freeKey(taken, parent ? `${parent.key}--${slug(trimmed)}` : slug(trimmed));

  const created: Pole = {
    key,
    name: trimmed,
    parentKey: parent?.key ?? null,
    path: pathOf(plan.poles, parent?.key ?? null, trimmed),
    allowAllDebutants: parent?.allowAllDebutants ?? false,
    minExperienced: parent?.minExperienced ?? 0,
    defaultHeadcount: parent?.defaultHeadcount ?? 2,
    defaultShiftHours: parent ? defaultShiftHours(parent) : FALLBACK_SHIFT_HOURS,
  };

  return { ...plan, poles: [...plan.poles, created] };
}

/** Every pole's path rebuilt from the names, since a path is nothing but the names of a branch. */
function withPaths(poles: readonly Pole[]): Pole[] {
  const byKey = new Map(poles.map((p) => [p.key, p]));
  const pathFor = (pole: Pole): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let current: Pole | undefined = pole;
    while (current && !seen.has(current.key)) {
      seen.add(current.key);
      parts.unshift(current.name);
      current = current.parentKey ? byKey.get(current.parentKey) : undefined;
    }
    return parts.join(' / ');
  };
  return poles.map((p) => ({ ...p, path: pathFor(p) }));
}

/** Renaming rewrites the pole's path and every descendant's, since a path is built from names. */
export function renamePole(plan: Plan, poleKey: string, name: string): Plan {
  const trimmed = name.trim();
  if (trimmed === '') return plan;
  const renamed = plan.poles.map((p) => (p.key === poleKey ? { ...p, name: trimmed } : p));
  return { ...plan, poles: withPaths(renamed) };
}

export function setPoleDefaults(
  plan: Plan,
  poleKey: string,
  over: Partial<
    Pick<
      Pole,
      | 'defaultHeadcount'
      | 'allowAllDebutants'
      | 'minExperienced'
      | 'defaultShiftHours'
      | 'leaderSupportOnly'
    >
  >,
): Plan {
  return {
    ...plan,
    poles: plan.poles.map((p) =>
      p.key === poleKey
        ? {
            ...p,
            ...over,
            defaultHeadcount: Math.max(0, Math.round(over.defaultHeadcount ?? p.defaultHeadcount)),
            minExperienced: Math.max(0, Math.round(over.minExperienced ?? p.minExperienced)),
            defaultShiftHours: Math.max(
              0.5,
              over.defaultShiftHours ?? p.defaultShiftHours ?? FALLBACK_SHIFT_HOURS,
            ),
          }
        : p,
    ),
  };
}

/** Every pole in the subtree rooted at `poleKey`, itself included. */
function subtree(plan: Plan, poleKey: string): Set<string> {
  const keys = new Set([poleKey]);
  for (;;) {
    const before = keys.size;
    for (const pole of plan.poles) {
      if (pole.parentKey && keys.has(pole.parentKey)) keys.add(pole.key);
    }
    if (keys.size === before) return keys;
  }
}

export interface PoleRemoval {
  poles: number;
  shifts: number;
  /** Assignments that disappear with the shifts. Named people, so the screen can say how many. */
  assignments: number;
  /** Volunteers whose declared choice or veto points at a pole about to vanish. */
  choices: number;
}

/** What deleting this pole would cost, so the régisseur can read it before deciding. */
export function poleRemovalCost(plan: Plan, poleKey: string): PoleRemoval {
  const keys = subtree(plan, poleKey);
  const shifts = plan.shifts.filter((s) => keys.has(s.poleKey));
  const shiftKeys = new Set(shifts.map((s) => s.key));
  return {
    poles: keys.size,
    shifts: shifts.length,
    assignments: plan.assignments.filter((a) => shiftKeys.has(a.shiftKey)).length,
    choices: plan.volunteers.filter(
      (v) =>
        v.choices.some((c) => keys.has(c.poleKey)) ||
        v.refusedPoleKeys.some((key) => keys.has(key)),
    ).length,
  };
}

/**
 * Deletes a pole, its sub-poles, their shifts and the assignments on them.
 *
 * The volunteers' own answers are left exactly as they were given, even when they now name a
 * pole that no longer exists. Rewriting somebody's stated choice so the data looks clean is not
 * this function's decision to make, and the screen reports how many are affected instead.
 */
export function deletePole(plan: Plan, poleKey: string): Plan {
  const keys = subtree(plan, poleKey);
  const shiftKeys = new Set(
    plan.shifts.filter((s) => keys.has(s.poleKey)).map((s) => s.key),
  );

  return {
    ...plan,
    poles: plan.poles.filter((p) => !keys.has(p.key)),
    shifts: plan.shifts.filter((s) => !keys.has(s.poleKey)),
    assignments: plan.assignments.filter((a) => !shiftKeys.has(a.shiftKey)),
    // The roles go, the people stay. Losing a pole is not losing the person who ran it, and
    // they very often run another one: deleting the people here would quietly take somebody off
    // the bar because the plonge was reorganised.
    leaderRoles: plan.leaderRoles.filter((r) => !keys.has(r.poleKey)),
  };
}

// ---------------------------------------------------------------------------
// Duplicating a pole, and the order they are drawn in
// ---------------------------------------------------------------------------

/**
 * "Service" copied becomes "Service 2", then "Service 3": the index a file manager adds.
 *
 * A name that already ends in a number carries on from there, so a copy of "Service 2" is
 * "Service 3" and not "Service 2 2". Uniqueness is only checked among the siblings, because that
 * is what the path is built from and what the régisseur reads down the list.
 */
function nextFreeName(taken: ReadonlySet<string>, name: string): string {
  const numbered = /^(.*\S)\s+(\d+)$/.exec(name);
  const base = numbered ? numbered[1]! : name;
  let n = numbered ? Number(numbered[2]!) + 1 : 2;
  for (;;) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
    n++;
  }
}

/** A pole and everything under it, parents before children, siblings in plan order. */
function branch(poles: readonly Pole[], poleKey: string): Pole[] {
  const start = poles.find((p) => p.key === poleKey);
  if (!start) return [];
  // Breadth first, so a parent is always reached before its children and its new key is known by
  // the time a child needs it.
  const out: Pole[] = [start];
  for (let at = 0; at < out.length; at++) {
    for (const child of poles) {
      if (child.parentKey === out[at]!.key && !out.includes(child)) out.push(child);
    }
  }
  return out;
}

export interface PoleCopy {
  /** The name the copy will carry, so the button can say it before it is clicked. */
  name: string;
  /** The pole itself plus its sub-poles. */
  poles: number;
  /** Créneaux copied with them, all of them empty. */
  shifts: number;
}

/** What duplicating this pole would create. Nothing here is destroyed, so there is no cost. */
export function poleCopyPreview(plan: Plan, poleKey: string): PoleCopy | null {
  const source = plan.poles.find((p) => p.key === poleKey);
  if (!source) return null;

  const copied = branch(plan.poles, poleKey);
  const keys = new Set(copied.map((p) => p.key));
  const siblingNames = new Set(
    plan.poles.filter((p) => p.parentKey === source.parentKey).map((p) => p.name),
  );

  return {
    name: nextFreeName(siblingNames, source.name),
    poles: copied.length,
    shifts: plan.shifts.filter((s) => keys.has(s.poleKey)).length,
  };
}

/**
 * Copies a pole, its sub-poles and the shape of their créneaux, right next to the original.
 *
 * Purely additive: nothing existing moves, nothing is deleted, and **nobody is copied**. The new
 * créneaux are empty on purpose, because a volunteer cannot stand in two places at once and
 * copying the affectations would put every one of them in two. What is worth copying is the
 * skeleton, the hours and the effectifs and the pole's defaults, which is the tedious half of
 * adding a second station that works like the first.
 *
 * The copy is neither locked nor given the original's own colour. `locked` says "I have balanced
 * this by hand" and an empty pole has nothing balanced yet; the colour belongs to the root pole,
 * which the copy of a sub-pole already shares.
 */
export function duplicatePole(plan: Plan, poleKey: string): Plan {
  const source = plan.poles.find((p) => p.key === poleKey);
  if (!source) return plan;

  const copied = branch(plan.poles, poleKey);
  const takenKeys = new Set(plan.poles.map((p) => p.key));
  const siblingNames = new Set(
    plan.poles.filter((p) => p.parentKey === source.parentKey).map((p) => p.name),
  );

  const newKeyOf = new Map<string, string>();
  const poles: Pole[] = [];
  for (const pole of copied) {
    const isSource = pole.key === source.key;
    const name = isSource ? nextFreeName(siblingNames, source.name) : pole.name;
    const parentKey = isSource
      ? source.parentKey
      : (pole.parentKey ? newKeyOf.get(pole.parentKey) ?? null : null);
    const key = freeKey(takenKeys, parentKey ? `${parentKey}--${slug(name)}` : slug(name));
    takenKeys.add(key);
    newKeyOf.set(pole.key, key);

    const { colour: _colour, locked: _locked, ...rest } = pole;
    poles.push({ ...rest, key, name, parentKey, path: '' });
  }

  const takenShiftKeys = new Set(plan.shifts.map((s) => s.key));
  const shifts: Shift[] = [];
  for (const [oldKey, newKey] of newKeyOf) {
    let index = 0;
    for (const shift of plan.shifts.filter((s) => s.poleKey === oldKey)) {
      const key = freeKey(takenShiftKeys, `${newKey}@${index++}`);
      takenShiftKeys.add(key);
      shifts.push({ ...shift, key, poleKey: newKey });
    }
  }

  // Straight after the original and its sub-poles, so the copy reads as a copy instead of as a
  // new pole at the bottom of the list.
  const after = Math.max(...copied.map((p) => plan.poles.indexOf(p))) + 1;

  return {
    ...plan,
    poles: withPaths([...plan.poles.slice(0, after), ...poles, ...plan.poles.slice(after)]),
    shifts: [...plan.shifts, ...shifts],
  };
}

/** Whether there is a sibling that way, so the screen greys the button out rather than lying. */
export function canMovePole(plan: Plan, poleKey: string, direction: -1 | 1): boolean {
  const pole = plan.poles.find((p) => p.key === poleKey);
  if (!pole) return false;
  const siblings = plan.poles.filter((p) => p.parentKey === pole.parentKey);
  const to = siblings.indexOf(pole) + direction;
  return to >= 0 && to < siblings.length;
}

/**
 * Swaps a pole with the sibling before or after it, carrying its sub-poles along.
 *
 * The order of `plan.poles` is the order every screen draws: the lanes of the grid, the printed
 * schedules, Réglages itself. It survives the round trip through the database as `sort_order`.
 * Nothing else reads it, so this moves the order and nothing else: keys, créneaux, affectations
 * and the answers of the volunteers are all untouched. A pole only ever moves among its own
 * siblings, since moving one out of its parent would be a different edit entirely.
 */
export function movePole(plan: Plan, poleKey: string, direction: -1 | 1): Plan {
  const pole = plan.poles.find((p) => p.key === poleKey);
  if (!pole) return plan;

  const siblings = plan.poles.filter((p) => p.parentKey === pole.parentKey);
  const at = siblings.indexOf(pole);
  const to = at + direction;
  if (to < 0 || to >= siblings.length) return plan;

  const ordered = [...siblings];
  ordered[at] = siblings[to]!;
  ordered[to] = pole;

  // Rebuilt as a walk of the tree rather than as a swap of two array slots, so every pole still
  // lands after its parent whatever the depth of the thing that moved.
  const children = new Map<string | null, Pole[]>();
  for (const p of plan.poles) children.set(p.parentKey, [...(children.get(p.parentKey) ?? []), p]);
  children.set(pole.parentKey, ordered);

  const out: Pole[] = [];
  const seen = new Set<string>();
  const walk = (key: string | null): void => {
    for (const child of children.get(key) ?? []) {
      if (seen.has(child.key)) continue;
      seen.add(child.key);
      out.push(child);
      walk(child.key);
    }
  };
  walk(null);

  // A pole whose parent has gone missing is never reached by the walk. Putting it at the end is
  // wrong in every way but the one that counts: it is still there.
  for (const p of plan.poles) if (!seen.has(p.key)) out.push(p);

  return { ...plan, poles: out };
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

/**
 * Adds a shift, taking its length and its headcount from the pole when not told otherwise.
 *
 * Both defaults are copied here, once, and never read again: that is the whole doctrine of a
 * default in this tool. Changing a pole's default length tomorrow must leave every shift created
 * today exactly as it is.
 */
export function addShift(plan: Plan, poleKey: string, start: number, end?: number): Plan {
  const pole = plan.poles.find((p) => p.key === poleKey);
  if (!pole) return plan;
  const finish = end ?? start + defaultShiftHours(pole);
  if (!(finish > start)) return plan;

  const taken = new Set(plan.shifts.map((s) => s.key));
  const created: Shift = {
    key: freeKey(taken, `${poleKey}@${plan.shifts.filter((s) => s.poleKey === poleKey).length}`),
    poleKey,
    start,
    end: finish,
    headcount: pole.defaultHeadcount,
  };
  return { ...plan, shifts: [...plan.shifts, created] };
}

/** Deleting a shift removes the people standing in it. Nobody is moved elsewhere. */
export function deleteShift(plan: Plan, shiftKey: string): Plan {
  return {
    ...plan,
    shifts: plan.shifts.filter((s) => s.key !== shiftKey),
    assignments: plan.assignments.filter((a) => a.shiftKey !== shiftKey),
  };
}

/**
 * Moves a shift's hours, keeping everybody on it.
 *
 * The people stay because the shift is the same job at a different hour, and because the tool
 * shows what an edit did rather than pre-emptively undoing it: somebody who can no longer work
 * those hours turns red, which is the signal to act on.
 */
export function setShiftWindow(plan: Plan, shiftKey: string, start: number, end: number): Plan {
  if (!(end > start)) return plan;
  return {
    ...plan,
    shifts: plan.shifts.map((s) => (s.key === shiftKey ? { ...s, start, end } : s)),
  };
}

export interface ShiftPlanSpec {
  from: number;
  to: number;
  /** Length of each shift, in hours. The last one is trimmed rather than overrunning. */
  block: number;
}

/**
 * Replaces a pole's shifts with a regular series, and says what it costs.
 *
 * This is the lever for the thing the anti-fragmentation weights cannot reach. The solver can
 * keep somebody in one place for four hours, but it cannot make four hours contiguous when the
 * pole is cut into two-hour pieces and the neighbouring piece is full. Shift length is what
 * decides that, it is a property of the pole, and it belongs here.
 *
 * It is destructive: every existing shift of the pole goes, and with it every assignment on
 * them. `regenerateCost` gives the number to show first.
 */
export function regenerateCost(plan: Plan, poleKey: string): { shifts: number; assignments: number } {
  const shiftKeys = new Set(plan.shifts.filter((s) => s.poleKey === poleKey).map((s) => s.key));
  return {
    shifts: shiftKeys.size,
    assignments: plan.assignments.filter((a) => shiftKeys.has(a.shiftKey)).length,
  };
}

export function regenerateShifts(plan: Plan, poleKey: string, spec: ShiftPlanSpec): Plan {
  const pole = plan.poles.find((p) => p.key === poleKey);
  if (!pole || !(spec.to > spec.from) || !(spec.block > 0)) return plan;

  const shiftKeys = new Set(plan.shifts.filter((s) => s.poleKey === poleKey).map((s) => s.key));
  const created: Shift[] = [];
  let index = 0;
  for (let start = spec.from; start < spec.to - 1e-9; start += spec.block) {
    created.push({
      key: `${poleKey}@r${index++}`,
      poleKey,
      start,
      end: Math.min(start + spec.block, spec.to),
      headcount: pole.defaultHeadcount,
    });
  }

  return {
    ...plan,
    shifts: [...plan.shifts.filter((s) => s.poleKey !== poleKey), ...created],
    assignments: plan.assignments.filter((a) => !shiftKeys.has(a.shiftKey)),
  };
}

// ---------------------------------------------------------------------------
// Pole organisers
// ---------------------------------------------------------------------------

/**
 * A person, with no pole yet.
 *
 * The name arrives as one string because that is how the régisseur types it into Réglages, and
 * it is split on the FIRST space: "Marie" plus "Dupont Martin". French given names are far more
 * often one word than surnames are, so this is the guess that is right most often, and either
 * half stays editable next to the other. The organisers' form supplies both fields properly and
 * never comes through here.
 */
export function addOrganiser(plan: Plan, fullName: string): { plan: Plan; organiserKey: string } {
  const trimmed = fullName.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return { plan, organiserKey: '' };
  const cut = trimmed.indexOf(' ');
  const created: Organiser = {
    key: freeKey(new Set(plan.organisers.map((l) => l.key)), `resp-${slug(trimmed)}`),
    firstName: cut === -1 ? '' : trimmed.slice(0, cut),
    lastName: cut === -1 ? trimmed : trimmed.slice(cut + 1),
    email: '',
    phone: '',
    // A credential is never invented as a side effect of typing a name. See `giveOrganiserCode`.
    accessCode: '',
    // Nor is a presence: somebody typed into Réglages has said nothing about the montage.
    montageFrom: null,
    demontageUntil: null,
    montagePoleKeys: [],
    demontagePoleKeys: [],
    diet: '',
    allergies: '',
    note: '',
  };
  return { plan: { ...plan, organisers: [...plan.organisers, created] }, organiserKey: created.key };
}

/** A person and, in the same breath, the first pole they run. What the Réglages button does. */
export function addLeaderOnPole(plan: Plan, poleKey: string, fullName: string): Plan {
  const { plan: withPerson, organiserKey } = addOrganiser(plan, fullName);
  if (organiserKey === '') return plan;
  return assignOrganiserToPole(withPerson, organiserKey, poleKey);
}

export function updateOrganiser(plan: Plan, organiserKey: string, over: Partial<Organiser>): Plan {
  return {
    ...plan,
    organisers: plan.organisers.map((l) => (l.key === organiserKey ? { ...l, ...over, key: l.key } : l)),
  };
}

/**
 * Removes a person and every pole they ran.
 *
 * The roles go with them, because a role pointing at nobody is not a record of anything. This is
 * the one place that is allowed to cut them: `deletePole` cuts roles and keeps the people, since
 * losing a pole is not losing the person who ran it.
 */
export function deleteOrganiser(plan: Plan, organiserKey: string): Plan {
  return {
    ...plan,
    organisers: plan.organisers.filter((l) => l.key !== organiserKey),
    leaderRoles: plan.leaderRoles.filter((r) => r.organiserKey !== organiserKey),
  };
}

/**
 * Puts somebody in charge of a pole, with no hours yet.
 *
 * Adds a second role on a pole they already run rather than refusing: that is how a organiser
 * present from 14h to 18h and again from 22h to 02h is written down, and there is no other way
 * to say it. Nothing here is checked against anything, on purpose. See `LeaderRole`.
 */
export function assignOrganiserToPole(plan: Plan, organiserKey: string, poleKey: string): Plan {
  if (!plan.organisers.some((l) => l.key === organiserKey)) return plan;
  const created: LeaderRole = {
    key: freeKey(new Set(plan.leaderRoles.map((r) => r.key)), `${poleKey}--${organiserKey}`),
    organiserKey,
    poleKey,
    // No hours until somebody sets them. Guessing a window would put a band on the grid that
    // nobody agreed to.
    start: null,
    end: null,
  };
  return { ...plan, leaderRoles: [...plan.leaderRoles, created] };
}

/**
 * The same thing, with the hours already set: what dropping an orga on a pole's frise does.
 *
 * A WINDOW IS GUESSED HERE, and nowhere else, on purpose. `assignOrganiserToPole` deliberately
 * leaves both ends null, because Réglages is a list of names and inventing a band on the grid out
 * of one would be putting hours in somebody's mouth. A drop on the frise is the opposite gesture:
 * the régisseur pointed at a moment, so the moment is what they meant, and the length is the
 * two hours the régisseur asked for on 2026-09-12. Both ends are then dragged on the band itself.
 *
 * Nothing is checked, as everywhere else a role is written: two roles may overlap, on the same
 * pole or on two, and a second role on a pole somebody already runs is how "de 14h à 18h, puis de
 * 22h à 02h" is written down. See `LeaderRole`.
 */
export function assignOrganiserToPoleAt(
  plan: Plan,
  organiserKey: string,
  poleKey: string,
  start: number,
  end: number,
): Plan {
  if (!plan.organisers.some((l) => l.key === organiserKey)) return plan;
  const created: LeaderRole = {
    key: freeKey(new Set(plan.leaderRoles.map((r) => r.key)), `${poleKey}--${organiserKey}`),
    organiserKey,
    poleKey,
    start,
    end,
  };
  return { ...plan, leaderRoles: [...plan.leaderRoles, created] };
}

/** Takes one pole off somebody, leaving the person and their other poles alone. */
export function removeLeaderRole(plan: Plan, roleKey: string): Plan {
  return { ...plan, leaderRoles: plan.leaderRoles.filter((r) => r.key !== roleKey) };
}

/**
 * Issues this person a code, or replaces the one they have.
 *
 * ALWAYS A DELIBERATE ACT, never a side effect. Neither creating a organiser, nor importing the
 * form, nor converting an old plan gives anybody a code: this function is the only thing in the
 * tool that does, and it is behind a button the régisseur presses per person.
 *
 * A organiser's code opens the whole planning, contact details of all 120 volunteers included, so
 * it is drawn from the same alphabet as a volunteer's and is nearly twice as long: about 69 bits
 * against 40. See `ORGANISER_CODE_LENGTH`.
 *
 * Regenerating REVOKES the previous code, immediately and for everybody holding it. That is the
 * point, and it is the answer to a code forwarded to the wrong person. The screen says so before
 * the second click, because a organiser whose code changed without warning is a organiser locked out on
 * the night.
 */
export function giveOrganiserCode(plan: Plan, organiserKey: string): Plan {
  const taken = new Set(
    plan.organisers.filter((l) => l.key !== organiserKey).map((l) => l.accessCode).filter((c) => c !== ''),
  );
  // Volunteers' codes are shorter and drawn from the same alphabet, so a collision across the
  // two is impossible by length alone. Included anyway: the lengths are constants, and a
  // constant that changes should not silently make two credentials the same string.
  for (const v of plan.volunteers) if (v.accessCode !== '') taken.add(v.accessCode);

  const code = newAccessCode(taken, ORGANISER_CODE_LENGTH);
  return {
    ...plan,
    organisers: plan.organisers.map((l) => (l.key === organiserKey ? { ...l, accessCode: code } : l)),
  };
}

/**
 * Takes somebody's code away without touching anything else about them.
 *
 * The person stays, their poles stay, their coordinates stay. An empty code authenticates
 * nothing: `get_organiser_planning` refuses `access_code = ''` explicitly rather than matching it,
 * which is what stops an empty string opening the planning of every organiser who never had one.
 */
export function clearOrganiserCode(plan: Plan, organiserKey: string): Plan {
  return {
    ...plan,
    organisers: plan.organisers.map((l) => (l.key === organiserKey ? { ...l, accessCode: '' } : l)),
  };
}

/**
 * The hours a organiser is on site, or null for both to clear them.
 *
 * Not an assignment and not checked against anything: a organiser can overlap their own poles, work
 * eighteen hours or none at all, and no scheduling rule has an opinion. The window exists so the
 * grid can show who is in charge when, which is the question asked at 3 in the morning.
 */
export function setOrganiserWindow(
  plan: Plan,
  roleKey: string,
  start: number | null,
  end: number | null,
): Plan {
  // Stores exactly what it is given, including half a window.
  //
  // The first version refused anything where the two ends did not make a coherent interval, and
  // since a new organiser starts with neither, typing the first of the two numbers hit
  // `end === null` and was thrown away. The field looked broken because it was: you could never
  // enter the first half of a pair that had to be entered one half at a time.
  //
  // Whether a window makes sense is a question for whoever draws it. The grid already refuses to
  // draw a band unless both ends are set and the end is after the start, and Réglages says so in
  // words, which is far more use than a value that silently vanishes.
  const clean = (value: number | null): number | null =>
    value !== null && Number.isFinite(value) ? value : null;

  return {
    ...plan,
    leaderRoles: plan.leaderRoles.map((r) =>
      r.key === roleKey ? { ...r, start: clean(start), end: clean(end) } : r,
    ),
  };
}

/**
 * Locks or unlocks a pole against the solver.
 *
 * Not the same decision as locking a box, and it never touches one. A locked box is pinned
 * against everybody; a locked pole says "I have balanced this by hand, a re-solve must leave it
 * alone" while the régisseur stays free to keep adjusting it. Unlocking gives the solver the
 * pole back exactly as it was, with every box's own flag untouched.
 */
export function setPoleLocked(plan: Plan, poleKey: string, locked: boolean): Plan {
  return {
    ...plan,
    poles: plan.poles.map((pole) => {
      if (pole.key !== poleKey) return pole;
      if (locked) return { ...pole, locked: true };
      // The key is removed rather than set to undefined, so unlocking gives back a pole equal to
      // the one before it was locked. An `undefined` left behind is a real own property: it
      // survives serialisation as `"locked": null` in some shapes and makes two identical poles
      // compare unequal, which is exactly the kind of difference that goes unnoticed for months.
      const { locked: _dropped, ...rest } = pole;
      return rest;
    }),
  };
}

// ---------------------------------------------------------------------------
// The event itself
// ---------------------------------------------------------------------------

export function setEventName(plan: Plan, name: string): Plan {
  const trimmed = name.trim();
  return trimmed === '' ? plan : { ...plan, name: trimmed };
}

/** Where the event happens. Free text, kept as typed: an address is not ours to tidy. */
/**
 * Whether the pole choices are an order of preference or a set of equals, for the whole event.
 * Nobody's list is reordered or trimmed: only how the solver and the screens read it changes.
 */
export function setVolumeSettings(plan: Plan, patch: Partial<VolumeSettings>): Plan {
  const merged = { ...plan.volume, ...patch };
  const options = [...new Set(merged.options.filter((h) => Number.isFinite(h) && h > 0))].sort((a, b) => a - b);
  return {
    ...plan,
    volume: {
      scope: merged.scope === 'day' ? 'day' : 'event',
      dayStartHour: Number.isFinite(merged.dayStartHour) ? ((merged.dayStartHour % 24) + 24) % 24 : plan.volume.dayStartHour,
      // An emptied list keeps what it had: a picker with no volume in it would offer nothing to
      // correct a fiche with.
      options: options.length > 0 ? options : plan.volume.options,
    },
  };
}

/**
 * How many créneaux of the exploit a day boundary at this hour would cut in two. Shown under the
 * boundary field: a créneau belongs whole to the day it starts in, so a boundary through the
 * middle of the busiest hours counts a 4 h stint on the day it began.
 */
export function shiftsCutByBoundary(plan: Plan, dayStartHour: number): number {
  const start = new Date(plan.startISO);
  const clock = start.getHours() + start.getMinutes() / 60;
  const first = (((dayStartHour - clock) % 24) + 24) % 24;
  return plan.shifts.filter((s) => {
    for (let b = first; b < s.end; b += 24) if (b > s.start + 1e-9 && b < s.end - 1e-9) return true;
    return false;
  }).length;
}

export function setPoleChoicesRanked(plan: Plan, ranked: boolean): Plan {
  return plan.poleChoicesRanked === ranked ? plan : { ...plan, poleChoicesRanked: ranked };
}

export function setEventAddress(plan: Plan, address: string): Plan {
  return { ...plan, address };
}

/**
 * When the event starts, as a real timestamp.
 *
 * Everything else in the tool counts decimal hours from this moment, so moving it slides the
 * whole plan rather than rescheduling anything: a shift at hour 2 is still at hour 2, it just
 * falls at a different wall-clock time. That is the point of the decimal-hours model, and the
 * reason this is a one-line edit instead of a migration.
 *
 * The two phases follow, since 2026-09-13: the montage ends where the event starts, so its
 * length changes with this, and the démontage starts where the event ends, so it slides.
 */
export function setEventStart(plan: Plan, startISO: string): Plan {
  const when = new Date(startISO);
  return Number.isNaN(when.getTime())
    ? plan
    : alignPhases({ ...plan, startISO: when.toISOString() });
}

/**
 * How long the event runs.
 *
 * Shortening it does not delete the shifts or the sets that now fall outside: they stay, and the
 * grid still draws far enough to show them, because silently hiding work somebody planned would
 * be the worst possible reading of "the event is shorter than I thought".
 */
export function setEventLength(plan: Plan, hours: number): Plan {
  return Number.isFinite(hours) && hours > 0
    ? alignPhases({ ...plan, lengthHours: Math.min(hours, MAX_EVENT_HOURS) })
    : plan;
}

/** A week. The cap was 48 h until 2026-09-13, and a festival is longer than that. */
export const MAX_EVENT_HOURS = 168;

export function addArtist(plan: Plan, name: string): Plan {
  const trimmed = name.trim();
  if (trimmed === '') return plan;
  const taken = new Set(plan.artists.map((a) => a.key));
  // After the last set, unless the last one already runs to the end of the event: parking a new
  // set at the closing hour would create one of zero length, which is not a set at all. Then it
  // goes to the start and the régisseur moves it, which is at least a set they can grab.
  const last = [...plan.artists].sort((a, b) => a.end - b.end).pop();
  const start = last && last.end < plan.lengthHours ? last.end : 0;
  return {
    ...plan,
    artists: [
      ...plan.artists,
      makeArtist({
        key: freeKey(taken, slug(trimmed)),
        name: trimmed,
        start,
        end: Math.min(start + 1.5, plan.lengthHours),
      }),
    ],
  };
}

/**
 * The set, and since 2026-09-13 any other field of the fiche, changed on one act.
 *
 * A number that is not a number is left as it was, so a half-typed field never writes NaN into
 * the plan; the members and the trajets have their own functions in `artistEdits.ts` and are
 * not reachable from here, on purpose: a row of a list is edited by key, never by replacing the
 * list.
 */
export function setArtist(
  plan: Plan,
  artistKey: string,
  over: Partial<Omit<Artist, 'key' | 'members' | 'carTrips'>>,
): Plan {
  return {
    ...plan,
    artists: plan.artists.map((a) => {
      if (a.key !== artistKey) return a;
      const next: Artist = { ...a };
      for (const [field, value] of Object.entries(over)) {
        if (value === undefined) continue;
        if (typeof value === 'number' && !Number.isFinite(value)) continue;
        (next as unknown as Record<string, unknown>)[field] = value;
      }
      return next;
    }),
  };
}

/**
 * Removes a set from the line-up.
 *
 * The volunteers who named it keep the reference. Same rule as a deleted pole: what somebody
 * said they did not want to miss is their answer, and rewriting it to tidy the data is not this
 * function's decision. The reference simply stops resolving, and nothing depends on it beyond
 * the artist clash cost, which quietly becomes zero.
 */
export function deleteArtist(plan: Plan, artistKey: string): Plan {
  return { ...plan, artists: plan.artists.filter((a) => a.key !== artistKey) };
}

// ---------------------------------------------------------------------------
// Time slots: the form's own questions
// ---------------------------------------------------------------------------

/**
 * The slots are the wording of a question the volunteers answered, so editing them is editing
 * the vocabulary their answers are written in.
 *
 * Renaming a label is free: `refusedSlot` stores the id, not the label. Changing an id is not,
 * and the screen says so, because every answer naming the old id stops matching. Removing a slot
 * is the same thing: the volunteers keep the answer they gave, and it quietly stops applying,
 * which is better than rewriting what somebody said.
 */
export function setSlot(
  plan: Plan,
  slotId: string,
  over: { label?: string; start?: number; end?: number },
): Plan {
  return {
    ...plan,
    slots: plan.slots.map((slot) =>
      slot.id === slotId
        ? {
            ...slot,
            label: over.label !== undefined ? over.label : slot.label,
            start: Number.isFinite(over.start) ? over.start! : slot.start,
            end: Number.isFinite(over.end) ? over.end! : slot.end,
          }
        : slot,
    ),
  };
}

export function addSlot(plan: Plan, label: string): Plan {
  const trimmed = label.trim();
  if (trimmed === '') return plan;
  const taken = new Set(plan.slots.map((s) => s.id));
  const last = [...plan.slots].sort((a, b) => a.end - b.end).pop();
  const start = last && last.end < plan.lengthHours ? last.end : 0;
  return {
    ...plan,
    slots: [
      ...plan.slots,
      {
        id: freeKey(taken, slug(trimmed)),
        label: trimmed,
        start,
        end: Math.min(start + 6, plan.lengthHours),
      },
    ],
  };
}

/** How many volunteers answered that they cannot do this slot. The cost of removing it. */
export function slotRefusalCount(plan: Plan, slotId: string): number {
  return plan.volunteers.filter((v) => v.refusedSlotIds.includes(slotId)).length;
}

/**
 * Removes a slot from the form's vocabulary.
 *
 * The volunteers who refused it keep that answer exactly as they gave it. It stops matching any
 * slot, so it stops constraining anything, and the panel shows the stale id rather than pretending
 * they answered nothing. Rewriting somebody's answer to tidy the data is the one thing this tool
 * must not do.
 */
export function deleteSlot(plan: Plan, slotId: string): Plan {
  return { ...plan, slots: plan.slots.filter((s) => s.id !== slotId) };
}

// ---------------------------------------------------------------------------
// The preference tranches: the answers to "Qu'est ce que tu préfères ?"
//
// Same doctrine as the refusable slots above, and a separate list for the reason `PreferenceSlot`
// gives: these may overlap and need not cover the event. The label is the form's wording; the
// id is what every volunteer's `preferredSlotId` points at; a removed tranche leaves the answers
// that named it exactly as they were given.
// ---------------------------------------------------------------------------

export function setPreferenceSlot(
  plan: Plan,
  slotId: string,
  over: { label?: string; start?: number; end?: number; overflowHours?: number },
): Plan {
  return {
    ...plan,
    preferenceSlots: plan.preferenceSlots.map((slot) =>
      slot.id === slotId
        ? {
            ...slot,
            label: over.label !== undefined ? over.label : slot.label,
            start: Number.isFinite(over.start) ? over.start! : slot.start,
            end: Number.isFinite(over.end) ? over.end! : slot.end,
            overflowHours: Number.isFinite(over.overflowHours)
              ? Math.max(0, over.overflowHours!)
              : slot.overflowHours,
          }
        : slot,
    ),
  };
}

/** A new tranche after the last one, with no tolerated overflow until the régisseur gives it one. */
export function addPreferenceSlot(plan: Plan, label: string): Plan {
  const trimmed = label.trim();
  if (trimmed === '') return plan;
  const taken = new Set(plan.preferenceSlots.map((s) => s.id));
  const last = [...plan.preferenceSlots].sort((a, b) => a.end - b.end).pop();
  const start = last && last.end < plan.lengthHours ? last.end : 0;
  return {
    ...plan,
    preferenceSlots: [
      ...plan.preferenceSlots,
      {
        id: freeKey(taken, slug(trimmed)),
        label: trimmed,
        start,
        end: Math.min(start + 6, plan.lengthHours),
        overflowHours: 0,
      },
    ],
  };
}

/** How many volunteers answered that they would rather work this tranche. */
export function preferenceSlotCount(plan: Plan, slotId: string): number {
  return plan.volunteers.filter((v) => v.preferredSlotId === slotId).length;
}

export function deletePreferenceSlot(plan: Plan, slotId: string): Plan {
  return { ...plan, preferenceSlots: plan.preferenceSlots.filter((s) => s.id !== slotId) };
}
