/**
 * Les compétences, 2026-09-15: the event's list, who holds which, and which poles ask for them.
 *
 * A bénévole's competences go through `correctVolunteer` (they are an answer, read from the form);
 * an orga's are set here, since no import reads them. Removing a competence from the event takes it
 * off every person and every pole in the same edit: a requirement nobody can see or tick would
 * keep turning boxes red with no way to answer it.
 */

import type { Plan, SkillTag } from '../engine.ts';

function freeKey(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'competence';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
  return key;
}

export function addSkill(plan: Plan, label: string): Plan {
  const trimmed = label.trim();
  if (trimmed === '') return plan;
  const key = freeKey(trimmed, new Set(plan.skills.map((s) => s.key)));
  return { ...plan, skills: [...plan.skills, { key, label: trimmed }] };
}

export function renameSkill(plan: Plan, key: string, label: string): Plan {
  return { ...plan, skills: plan.skills.map((s): SkillTag => (s.key === key ? { ...s, label } : s)) };
}

/** Who holds it and what asks for it: what removing it would undo, said before it is done. */
export function skillUsage(plan: Plan, key: string): { people: number; poles: number } {
  const people =
    plan.volunteers.filter((v) => (v.skills ?? []).includes(key)).length +
    plan.organisers.filter((o) => (o.skills ?? []).includes(key)).length;
  const poles =
    plan.poles.filter((p) => (p.requiredSkills ?? []).includes(key)).length +
    [plan.montage, plan.demontage].reduce((n, ph) => n + ph.poles.filter((p) => (p.requiredSkills ?? []).includes(key)).length, 0);
  return { people, poles };
}

export function removeSkill(plan: Plan, key: string): Plan {
  const without = (list: readonly string[] | undefined) => (list ?? []).filter((k) => k !== key);
  return {
    ...plan,
    skills: plan.skills.filter((s) => s.key !== key),
    volunteers: plan.volunteers.map((v) => ((v.skills ?? []).includes(key) ? { ...v, skills: without(v.skills) } : v)),
    organisers: plan.organisers.map((o) => ((o.skills ?? []).includes(key) ? { ...o, skills: without(o.skills) } : o)),
    poles: plan.poles.map((p) => ((p.requiredSkills ?? []).includes(key) ? { ...p, requiredSkills: without(p.requiredSkills) } : p)),
    montage: { ...plan.montage, poles: plan.montage.poles.map((p) => ({ ...p, requiredSkills: without(p.requiredSkills) })) },
    demontage: { ...plan.demontage, poles: plan.demontage.poles.map((p) => ({ ...p, requiredSkills: without(p.requiredSkills) })) },
  };
}

export function moveSkill(plan: Plan, key: string, direction: -1 | 1): Plan {
  const skills = [...plan.skills];
  const at = skills.findIndex((s) => s.key === key);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= skills.length) return plan;
  [skills[at], skills[to]] = [skills[to]!, skills[at]!];
  return { ...plan, skills };
}

export function setPoleSkills(plan: Plan, poleKey: string, requiredSkills: string[]): Plan {
  return { ...plan, poles: plan.poles.map((p) => (p.key === poleKey ? { ...p, requiredSkills } : p)) };
}

export function setOrganiserSkills(plan: Plan, organiserKey: string, skills: string[]): Plan {
  return { ...plan, organisers: plan.organisers.map((o) => (o.key === organiserKey ? { ...o, skills } : o)) };
}
