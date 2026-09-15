/**
 * Les équipes, 2026-09-15: whether the event works in teams, the teams, and who is in which.
 *
 * Nothing here moves a placement. Putting somebody in a team, or switching the mode on, only
 * changes what the next re-solve prefers and what the grid rings; the proposals the régisseur
 * validates are where anybody actually moves.
 */

import type { Plan, Team } from '../engine.ts';

export function setTeamsEnabled(plan: Plan, teamsEnabled: boolean): Plan {
  return { ...plan, teamsEnabled };
}

/** « Équipe A », « Équipe B »... : the first free letter name, or the name typed. */
export function addTeam(plan: Plan, name = ''): Plan {
  const taken = new Set(plan.teams.map((t) => t.key));
  let n = plan.teams.length;
  let key = `equipe-${n + 1}`;
  while (taken.has(key)) key = `equipe-${++n + 1}`;
  const letter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : `${letter(Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`);
  const label = name.trim() !== '' ? name.trim() : `Équipe ${letter(plan.teams.length)}`;
  return { ...plan, teams: [...plan.teams, { key, name: label, poleKey: null }] };
}

export function setTeam(plan: Plan, key: string, over: Partial<Omit<Team, 'key'>>): Plan {
  return { ...plan, teams: plan.teams.map((t) => (t.key === key ? { ...t, ...over } : t)) };
}

/** Removes a team. Its members are in no team afterwards; nobody is placed or unplaced. */
export function removeTeam(plan: Plan, key: string): Plan {
  return {
    ...plan,
    teams: plan.teams.filter((t) => t.key !== key),
    volunteers: plan.volunteers.map((v) => (v.teamKey === key ? { ...v, teamKey: null } : v)),
  };
}

export function setVolunteerTeam(plan: Plan, volunteerKey: string, teamKey: string | null): Plan {
  return { ...plan, volunteers: plan.volunteers.map((v) => (v.key === volunteerKey ? { ...v, teamKey } : v)) };
}
