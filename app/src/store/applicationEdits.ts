/**
 * Le suivi des candidatures, 2026-09-15: where an application stands, the steps ticked, the
 * régisseur's note, and the one heavy action that goes with a cancellation.
 *
 * NONE OF THESE IS AN ANSWER, so none marks `manualFields`: an import never writes them in the
 * first place (`mergeWithManual` carries them over whole). The Réserve and the stamina ARE answers
 * and go through `correctVolunteer` like any other correction.
 *
 * CANCELLING REMOVES NOTHING. Setting « Annulée » turns every place the person still holds red
 * (`candidature-annulee`), and a re-solve proposes their removal; `releasePlaces` is the explicit
 * button the fiche offers for doing it at once. Two steps on purpose: a status picked by mistake
 * in a select must not cost somebody their placements.
 */

import type { ApplicationStatus, ApplicationStep, Plan, Volunteer } from '../engine.ts';

const withVolunteer = (plan: Plan, key: string, change: (v: Volunteer) => Volunteer): Plan => ({
  ...plan,
  volunteers: plan.volunteers.map((v) => (v.key === key ? change(v) : v)),
});

export function setApplicationStatus(plan: Plan, volunteerKey: string, status: ApplicationStatus): Plan {
  return withVolunteer(plan, volunteerKey, (v) => ({ ...v, status }));
}

/** Ticks or unticks one step, keeping the ticked keys in the event's own step order. */
export function setApplicationStep(plan: Plan, volunteerKey: string, stepKey: string, done: boolean): Plan {
  const order = plan.applicationSteps.map((s) => s.key);
  return withVolunteer(plan, volunteerKey, (v) => {
    const ticked = new Set(v.statusSteps ?? []);
    if (done) ticked.add(stepKey);
    else ticked.delete(stepKey);
    // A key the event no longer has stays ticked: removing a step from Réglages says nothing
    // about what was sent to whom. It sorts after the known ones.
    const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
    return { ...v, statusSteps: [...ticked].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)) };
  });
}

export function setRegieNote(plan: Plan, volunteerKey: string, note: string): Plan {
  return withVolunteer(plan, volunteerKey, (v) => ({ ...v, regieNote: note }));
}

/** What `releasePlaces` would take, so the button can say it before anybody presses it. */
export function placesHeld(plan: Plan, volunteerKey: string): { shifts: number; locked: number; phaseBoxes: number } {
  const mine = plan.assignments.filter((a) => a.volunteerKey === volunteerKey);
  const phaseBoxes = [plan.montage, plan.demontage].reduce(
    (total, phase) =>
      total + phase.assignments.filter((a) => a.personKind === 'benevole' && a.personKey === volunteerKey).length,
    0,
  );
  return { shifts: mine.length, locked: mine.filter((a) => a.locked).length, phaseBoxes };
}

/**
 * Frees every place a person holds: exploit créneaux (locked ones included, since pressing this
 * IS the régisseur's decision), montage and démontage boxes, and the waiting list. One edit, one
 * Ctrl+Z.
 */
export function releasePlaces(plan: Plan, volunteerKey: string): Plan {
  const notMine = (a: { personKind: string; personKey: string }) =>
    !(a.personKind === 'benevole' && a.personKey === volunteerKey);
  return {
    ...plan,
    assignments: plan.assignments.filter((a) => a.volunteerKey !== volunteerKey),
    reserve: plan.reserve.filter((key) => key !== volunteerKey),
    montage: { ...plan.montage, assignments: plan.montage.assignments.filter(notMine) },
    demontage: { ...plan.demontage, assignments: plan.demontage.assignments.filter(notMine) },
  };
}

// ---------------------------------------------------------------------------
// The event's steps, in Réglages
// ---------------------------------------------------------------------------

/** A key nobody has: derived from the label, suffixed until free. */
function stepKey(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'etape';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return key;
}

export function addApplicationStep(plan: Plan, label: string): Plan {
  const trimmed = label.trim();
  if (trimmed === '') return plan;
  const key = stepKey(trimmed, new Set(plan.applicationSteps.map((s) => s.key)));
  return { ...plan, applicationSteps: [...plan.applicationSteps, { key, label: trimmed }] };
}

/** Renames a step. The key stays, so nobody's tick moves. */
export function renameApplicationStep(plan: Plan, key: string, label: string): Plan {
  return {
    ...plan,
    applicationSteps: plan.applicationSteps.map((s): ApplicationStep => (s.key === key ? { ...s, label } : s)),
  };
}

/**
 * Removes a step from the event. The ticks stay on the fiches (see `setApplicationStep`) and come
 * back if a step with the same key is added again; they are simply not shown.
 */
export function removeApplicationStep(plan: Plan, key: string): Plan {
  return { ...plan, applicationSteps: plan.applicationSteps.filter((s) => s.key !== key) };
}

export function moveApplicationStep(plan: Plan, key: string, direction: -1 | 1): Plan {
  const steps = [...plan.applicationSteps];
  const at = steps.findIndex((s) => s.key === key);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= steps.length) return plan;
  [steps[at], steps[to]] = [steps[to]!, steps[at]!];
  return { ...plan, applicationSteps: steps };
}
