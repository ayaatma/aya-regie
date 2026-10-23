/**
 * Les repères des timelines, since 2026-10-23: « Pause entre le loto et les concerts ».
 *
 * Informative only, so nothing here checks anything against a créneau or a person: a repère
 * changes what the grid shows above it and nothing else. See `TimelineMarker`.
 */

import type { MarkerMoment, Plan, TimelineMarker } from '../engine.ts';

const slug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** A key derived from the name and never equal to another one. Permanent: labels change. */
function freeKey(taken: ReadonlySet<string>, base: string): string {
  const root = base === '' ? 'repere' : base;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const markersOf = (plan: Plan): readonly TimelineMarker[] => plan.markers ?? [];

/** A new repère, an instant at the start of its moment until its hours are typed. */
export function addMarker(plan: Plan, label: string, moment: MarkerMoment): Plan {
  const trimmed = label.trim();
  if (trimmed === '') return plan;
  const taken = new Set(markersOf(plan).map((m) => m.key));
  const marker: TimelineMarker = { key: freeKey(taken, slug(trimmed)), label: trimmed, moment, start: 0, end: null };
  return { ...plan, markers: [...markersOf(plan), marker] };
}

/** Changes a repère. An end at or before its start makes it an instant. */
export function setMarker(plan: Plan, key: string, over: Partial<Omit<TimelineMarker, 'key'>>): Plan {
  return {
    ...plan,
    markers: markersOf(plan).map((m) => {
      if (m.key !== key) return m;
      const next = { ...m, ...over };
      return next.end !== null && next.end <= next.start ? { ...next, end: null } : next;
    }),
  };
}

export function deleteMarker(plan: Plan, key: string): Plan {
  return { ...plan, markers: markersOf(plan).filter((m) => m.key !== key) };
}

/** The repères of one moment, in clock order. */
export function markersIn(plan: Plan, moment: MarkerMoment): TimelineMarker[] {
  return markersOf(plan)
    .filter((m) => m.moment === moment)
    .sort((a, b) => a.start - b.start || a.label.localeCompare(b.label, 'fr'));
}
