/**
 * The trombinoscope, 2026-10-24: who is who, in the order the régie reads an event.
 *
 * THE ORDER, as the developer asked it: every Responsable first, then the Staff pole by pole,
 * then the bénévoles pole by pole. Or one pole at a time, its Responsables at the top, then its
 * Staff, then its bénévoles, which is the sheet a pole leader keeps.
 *
 * WHAT « A POLE » IS HERE. An exploit pole at the root of the tree (a sous-pôle's people count
 * for its root, as on the printed sheets), and every pole of the montage and of the démontage,
 * which are separate trees. The developer chose both for the Staff on 2026-10-24, and the
 * bénévoles follow the same rule so a phase pole's page is complete.
 *
 * WHO IS ON A POLE:
 *   - a Responsable: a `LeaderRole` on the pole (exploit), or a box on it (phases);
 *   - a Staff: an `OrganiserShift` on one of its créneaux (exploit), or a box on it (phases);
 *   - a bénévole: an `Assignment` on one of its créneaux (exploit), or a box on it (phases).
 * Somebody on several poles appears on each, so every pole's page holds its whole team.
 *
 * PURE: no photo here. A photo is a file in Storage, keyed by the person's key; the screen
 * draws it from `TrombiPerson.key` and `kind`.
 */

import { organiserRoleOf, type Organiser, type PersonKind, type Volunteer } from './model.js';
import type { Plan } from './plan.js';

export interface TrombiPerson {
  kind: PersonKind;
  key: string;
  name: string;
  /** One line under the name: the poles a Responsable holds, a bénévole's nickname. */
  caption: string;
}

export interface TrombiGroup {
  /** `exploit:<root key>`, `montage:<key>` or `demontage:<key>`; the screen's selector uses it. */
  id: string;
  title: string;
  people: TrombiPerson[];
}

export interface TrombiSection {
  title: string;
  groups: TrombiGroup[];
}

export type TrombiDocument =
  | { kind: 'all' }
  | { kind: 'responsables' }
  | { kind: 'staff' }
  | { kind: 'benevoles' }
  /** Every pole, each on its own page. */
  | { kind: 'byPole' }
  | { kind: 'pole'; poleId: string };

interface PoleTeam {
  id: string;
  title: string;
  responsables: Set<string>;
  staff: Set<string>;
  benevoles: Set<string>;
}

const PHASE_TITLE = { montage: 'Montage', demontage: 'Démontage' } as const;

const fullName = (p: { firstName: string; lastName: string }): string => `${p.firstName} ${p.lastName}`.trim() || 'Sans nom';

const byName = (a: TrombiPerson, b: TrombiPerson): number => a.name.localeCompare(b.name, 'fr');

/** Every pole with its three teams, exploit roots first in the plan's order, then each phase's. */
export function poleTeams(plan: Plan): PoleTeam[] {
  const poleByKey = new Map(plan.poles.map((p) => [p.key, p]));
  const rootOf = (poleKey: string): string | null => {
    let current = poleByKey.get(poleKey);
    for (let guard = 0; current && current.parentKey !== null && guard < 50; guard++) current = poleByKey.get(current.parentKey);
    return current?.key ?? null;
  };
  const roleOf = new Map(plan.organisers.map((o) => [o.key, organiserRoleOf(o)]));
  const poleOfShift = new Map(plan.shifts.map((s) => [s.key, s.poleKey]));

  const teams = new Map<string, PoleTeam>();
  const team = (id: string, title: string): PoleTeam => {
    let found = teams.get(id);
    if (!found) {
      found = { id, title, responsables: new Set(), staff: new Set(), benevoles: new Set() };
      teams.set(id, found);
    }
    return found;
  };
  for (const pole of plan.poles) if (pole.parentKey === null) team(`exploit:${pole.key}`, pole.name);

  const exploitTeam = (poleKey: string | undefined): PoleTeam | null => {
    const root = poleKey === undefined ? null : rootOf(poleKey);
    return root === null ? null : teams.get(`exploit:${root}`) ?? null;
  };
  const placeOrganiser = (t: PoleTeam | null, key: string): void => {
    if (!t || !roleOf.has(key)) return;
    (roleOf.get(key) === 'staff' ? t.staff : t.responsables).add(key);
  };

  for (const role of plan.leaderRoles) placeOrganiser(exploitTeam(role.poleKey), role.organiserKey);
  for (const held of plan.organiserShifts) placeOrganiser(exploitTeam(poleOfShift.get(held.shiftKey)), held.organiserKey);
  const volunteerKeys = new Set(plan.volunteers.map((v) => v.key));
  for (const a of plan.assignments) {
    if (volunteerKeys.has(a.volunteerKey)) exploitTeam(poleOfShift.get(a.shiftKey))?.benevoles.add(a.volunteerKey);
  }

  for (const phase of [plan.montage, plan.demontage]) {
    if (!phase.enabled) continue;
    for (const pole of phase.poles) team(`${phase.id}:${pole.key}`, `${PHASE_TITLE[phase.id]} · ${pole.name}`);
    for (const a of phase.assignments) {
      if (a.poleKey === '') continue;
      const t = teams.get(`${phase.id}:${a.poleKey}`) ?? null;
      if (a.personKind === 'orga') placeOrganiser(t, a.personKey);
      else if (t && volunteerKeys.has(a.personKey)) t.benevoles.add(a.personKey);
    }
  }
  return [...teams.values()];
}

/** The poles somebody is on, for a « one pole » pick: id and title, in the document's order. */
export function trombiPoles(plan: Plan): Array<{ id: string; title: string }> {
  return poleTeams(plan)
    .filter((t) => t.responsables.size + t.staff.size + t.benevoles.size > 0)
    .map((t) => ({ id: t.id, title: t.title }));
}

/** The poles a Responsable holds, by name, or « Général » when none. */
function heldPoles(plan: Plan, organiserKey: string): string {
  const names = [
    ...new Set(
      plan.leaderRoles
        .filter((r) => r.organiserKey === organiserKey)
        .map((r) => plan.poles.find((p) => p.key === r.poleKey)?.name ?? '')
        .filter((name) => name !== ''),
    ),
  ];
  return names.length > 0 ? names.join(', ') : 'Général';
}

function organiserPerson(plan: Plan, o: Organiser): TrombiPerson {
  const role = organiserRoleOf(o);
  return { kind: 'orga', key: o.key, name: fullName(o), caption: role === 'responsable' ? heldPoles(plan, o.key) : 'Staff' };
}

const volunteerPerson = (v: Volunteer): TrombiPerson => ({
  kind: 'benevole',
  key: v.key,
  name: fullName(v),
  caption: v.nickname.trim(),
});

/** The sections of one document, empty groups left out. */
export function trombinoscope(plan: Plan, document: TrombiDocument): TrombiSection[] {
  const organiserByKey = new Map(plan.organisers.map((o) => [o.key, o]));
  const volunteerByKey = new Map(plan.volunteers.map((v) => [v.key, v]));
  const teams = poleTeams(plan);

  const organisers = (keys: Iterable<string>): TrombiPerson[] =>
    [...keys].flatMap((k) => {
      const o = organiserByKey.get(k);
      return o ? [organiserPerson(plan, o)] : [];
    }).sort(byName);
  const volunteers = (keys: Iterable<string>): TrombiPerson[] =>
    [...keys].flatMap((k) => {
      const v = volunteerByKey.get(k);
      return v ? [volunteerPerson(v)] : [];
    }).sort(byName);
  const nonEmpty = (groups: TrombiGroup[]): TrombiGroup[] => groups.filter((g) => g.people.length > 0);

  const responsables = (): TrombiSection => ({
    title: 'Responsables',
    groups: nonEmpty([
      { id: 'responsables', title: '', people: organisers(plan.organisers.filter((o) => organiserRoleOf(o) === 'responsable').map((o) => o.key)) },
    ]),
  });
  const staff = (): TrombiSection => {
    const placed = new Set(teams.flatMap((t) => [...t.staff]));
    const loose = plan.organisers.filter((o) => organiserRoleOf(o) === 'staff' && !placed.has(o.key)).map((o) => o.key);
    return {
      title: 'Staff',
      groups: nonEmpty([
        ...teams.map((t) => ({ id: t.id, title: t.title, people: organisers(t.staff) })),
        { id: 'staff:sans-pole', title: 'Sans pôle', people: organisers(loose) },
      ]),
    };
  };
  const benevoles = (): TrombiSection => ({
    title: 'Bénévoles',
    groups: nonEmpty(teams.map((t) => ({ id: t.id, title: t.title, people: volunteers(t.benevoles) }))),
  });
  const pole = (t: PoleTeam): TrombiSection => ({
    title: t.title,
    groups: nonEmpty([
      { id: `${t.id}:responsables`, title: 'Responsables', people: organisers(t.responsables) },
      { id: `${t.id}:staff`, title: 'Staff', people: organisers(t.staff) },
      { id: `${t.id}:benevoles`, title: 'Bénévoles', people: volunteers(t.benevoles) },
    ]),
  });

  const sections = ((): TrombiSection[] => {
    switch (document.kind) {
      case 'all':
        return [responsables(), staff(), benevoles()];
      case 'responsables':
        return [responsables()];
      case 'staff':
        return [staff()];
      case 'benevoles':
        return [benevoles()];
      case 'byPole':
        return teams.map(pole);
      case 'pole': {
        const t = teams.find((x) => x.id === document.poleId);
        return t ? [pole(t)] : [];
      }
    }
  })();
  return sections.filter((s) => s.groups.length > 0);
}
