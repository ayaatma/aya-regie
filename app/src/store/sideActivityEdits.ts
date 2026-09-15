/**
 * Les activités annexes, 2026-09-15: the event's list and who is keen on each. A bénévole's ticks
 * are an answer and go through `correctVolunteer`; an orga's are set here.
 */

import type { Plan, SideActivity } from '../engine.ts';

export function addSideActivity(plan: Plan, label: string): Plan {
  const trimmed = label.trim();
  if (trimmed === '') return plan;
  const base =
    trimmed.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) ||
    'activite';
  const taken = new Set(plan.sideActivities.map((a) => a.key));
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return { ...plan, sideActivities: [...plan.sideActivities, { key, label: trimmed, when: '' }] };
}

export function setSideActivity(plan: Plan, key: string, over: Partial<Omit<SideActivity, 'key'>>): Plan {
  return { ...plan, sideActivities: plan.sideActivities.map((a) => (a.key === key ? { ...a, ...over } : a)) };
}

/** Removes an activity and every tick on it: a list nobody can see must not keep anybody on it. */
export function removeSideActivity(plan: Plan, key: string): Plan {
  const without = (list: readonly string[] | undefined) => (list ?? []).filter((k) => k !== key);
  return {
    ...plan,
    sideActivities: plan.sideActivities.filter((a) => a.key !== key),
    volunteers: plan.volunteers.map((v) => ((v.sideActivityKeys ?? []).includes(key) ? { ...v, sideActivityKeys: without(v.sideActivityKeys) } : v)),
    organisers: plan.organisers.map((o) => ((o.sideActivityKeys ?? []).includes(key) ? { ...o, sideActivityKeys: without(o.sideActivityKeys) } : o)),
  };
}

export function setOrganiserSideActivities(plan: Plan, organiserKey: string, sideActivityKeys: string[]): Plan {
  return { ...plan, organisers: plan.organisers.map((o) => (o.key === organiserKey ? { ...o, sideActivityKeys } : o)) };
}

/** Everybody keen on one activity, orgas first, each file in its own order. Cancelled bénévoles left out. */
export function sideActivityPeople(
  plan: Plan,
  key: string,
): Array<{ kind: 'orga' | 'benevole'; key: string; firstName: string; lastName: string; phone: string; email: string }> {
  return [
    ...plan.organisers
      .filter((o) => (o.sideActivityKeys ?? []).includes(key))
      .map((o) => ({ kind: 'orga' as const, key: o.key, firstName: o.firstName, lastName: o.lastName, phone: o.phone, email: o.email })),
    ...plan.volunteers
      .filter((v) => (v.sideActivityKeys ?? []).includes(key) && v.status !== 'annule')
      .map((v) => ({ kind: 'benevole' as const, key: v.key, firstName: v.firstName, lastName: v.lastName, phone: v.phone, email: v.email })),
  ];
}
