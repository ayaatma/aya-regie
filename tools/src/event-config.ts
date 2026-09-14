/**
 * The synthetic event: poles, shifts and line-up.
 *
 * These numbers are deliberately editable. They exist to produce roughly 600 person-hours of
 * demand spread realistically across an 18h event, not to describe the real Loto Tekno. Change
 * them freely as the real pole structure firms up; the generator prints the resulting total.
 *
 * Hours are decimal offsets from the event start, so 0 is 12:00 and 18 is 06:00 the next day.
 */

import { makeArtist, type Pole, type Shift, type Artist } from './model.js';

export const EVENT_NAME = 'Loto Tekno 2027';
export const EVENT_START_ISO = '2027-03-13T12:00:00+01:00';
export const EVENT_LENGTH_HOURS = 18;

interface PolePlan {
  /** Root pole name, or the parent of a sub-pole. */
  parent?: string;
  name: string;
  /** Activity window, decimal hours from the event start. */
  window: [number, number];
  /** Length of each shift in this pole. Variable across poles, on purpose. */
  block: number;
  /** Default number of volunteers per shift in this pole. Copied into each shift at creation. */
  headcount: number;
  /**
   * Shifts that need a different number of people from the pole's default.
   *
   * This is what a rush hour looks like in the data: doors opening, the bar at 1am, the clean-up
   * at the very end. A shift starting inside one of these windows takes that headcount instead.
   */
  headcountOverrides?: Array<{ window: [number, number]; headcount: number }>;
  /** Relative odds of being picked as a choice 1 or 2. Below 1 means an unpopular pole. */
  popularity?: number;
  minExperienced?: number;
  allowAllDebutants?: boolean;
}

/**
 * The afternoon-only poles (Loto) exist because a special part of the event runs 12h to 18h.
 * They are what makes the afternoon pool necessary at all.
 */
const POLE_PLANS: PolePlan[] = [
  { parent: 'Entrée', name: 'Billetterie',   window: [0, 14],  block: 2, headcount: 3, popularity: 1.2,
    headcountOverrides: [{ window: [4, 8], headcount: 5 }, { window: [12, 14], headcount: 1 }] },
  { parent: 'Entrée', name: 'Bracelets',     window: [0, 14],  block: 2, headcount: 2, popularity: 1.0 },
  { parent: 'Bar',    name: 'Service',       window: [2, 18],  block: 2, headcount: 5, popularity: 2.0,
    headcountOverrides: [{ window: [8, 14], headcount: 7 }, { window: [2, 6], headcount: 3 }] },
  { parent: 'Bar',    name: 'Plonge',        window: [4, 18],  block: 2, headcount: 2, popularity: 0.3 },
  { parent: 'Bar',    name: 'Réassort',      window: [2, 18],  block: 4, headcount: 2, popularity: 0.6 },
  { parent: 'Sécu',   name: 'Rondes',        window: [0, 18],  block: 3, headcount: 4, popularity: 0.8 },
  { parent: 'Sécu',   name: 'Scène',         window: [6, 18],  block: 3, headcount: 4, popularity: 1.2, minExperienced: 1 },
  { parent: 'Loto',   name: 'Animation',     window: [0, 6],   block: 3, headcount: 3, popularity: 1.8 },
  { parent: 'Loto',   name: 'Lots',          window: [0, 6],   block: 2, headcount: 4, popularity: 1.0 },
  { parent: 'Loto',   name: 'Buvette',       window: [0, 6],   block: 2, headcount: 3, popularity: 1.0 },
  { name: 'Volante',           window: [0, 18],  block: 2, headcount: 3, popularity: 1.1 },
  { name: 'Accueil artistes',  window: [4, 16],  block: 4, headcount: 2, popularity: 2.2 },
  { name: 'Technique',         window: [0, 18],  block: 3, headcount: 2, popularity: 1.4, minExperienced: 1 },
  { name: 'Propreté',          window: [2, 18],  block: 2, headcount: 3, popularity: 0.2, allowAllDebutants: true,
    headcountOverrides: [{ window: [2, 10], headcount: 2 }] },
  { name: 'Cantine bénévoles', window: [0, 14],  block: 2, headcount: 2, popularity: 1.0, allowAllDebutants: true },
  { name: 'Parking',           window: [0, 14],  block: 2, headcount: 1, popularity: 0.4 },
];

const slug = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface BuiltPoles {
  poles: Pole[];
  /** Leaf poles only. These are what a volunteer picks as choice 1 or 2. */
  leaves: Pole[];
  /** Root poles only. These are what the form offers as the refused pole. */
  roots: Pole[];
  popularity: Map<string, number>;
}

export function buildPoles(): BuiltPoles {
  const poles: Pole[] = [];
  const popularity = new Map<string, number>();
  const rootKeys = new Set<string>();

  for (const plan of POLE_PLANS) {
    let parentKey: string | null = null;
    if (plan.parent) {
      parentKey = slug(plan.parent);
      if (!rootKeys.has(parentKey)) {
        rootKeys.add(parentKey);
        poles.push({
          key: parentKey,
          name: plan.parent,
          parentKey: null,
          path: plan.parent,
          allowAllDebutants: false,
          minExperienced: 0,
          defaultHeadcount: plan.headcount,
        });
      }
    }

    const key = parentKey ? `${parentKey}--${slug(plan.name)}` : slug(plan.name);
    if (!parentKey) rootKeys.add(key);
    poles.push({
      key,
      name: plan.name,
      parentKey,
      path: plan.parent ? `${plan.parent} / ${plan.name}` : plan.name,
      allowAllDebutants: plan.allowAllDebutants ?? false,
      minExperienced: plan.minExperienced ?? 0,
      defaultHeadcount: plan.headcount,
    });
    popularity.set(key, plan.popularity ?? 1);
  }

  const leafKeys = new Set(poles.map((p) => p.key));
  for (const p of poles) if (p.parentKey) leafKeys.delete(p.parentKey);

  return {
    poles,
    leaves: poles.filter((p) => leafKeys.has(p.key)),
    roots: poles.filter((p) => p.parentKey === null),
    popularity,
  };
}

export function buildShifts(poles: readonly Pole[]): Shift[] {
  const byPath = new Map(poles.map((p) => [p.path, p]));
  const shifts: Shift[] = [];

  for (const plan of POLE_PLANS) {
    const path = plan.parent ? `${plan.parent} / ${plan.name}` : plan.name;
    const pole = byPath.get(path);
    if (!pole) throw new Error(`No pole built for plan "${path}"`);

    const [from, to] = plan.window;
    let index = 0;
    for (let start = from; start < to; start += plan.block) {
      const end = Math.min(start + plan.block, to);
      const override = plan.headcountOverrides?.find(
        (o) => start >= o.window[0] && start < o.window[1],
      );
      shifts.push({
        key: `${pole.key}@${index++}`,
        poleKey: pole.key,
        start,
        end,
        headcount: override?.headcount ?? plan.headcount,
      });
    }
  }

  return shifts;
}

/** The night line-up. SYNTH-K at 01:30 is the headliner, which the pile-up scenario leans on. */
const ARTIST_PLANS: Array<{ name: string; start: number; end: number }> = [
  { name: 'Kaïra',     start: 6,    end: 7.5 },
  { name: 'Voltz',     start: 7.5,  end: 9 },
  { name: 'Nashkø',    start: 9,    end: 10.5 },
  { name: 'Mira Dust', start: 10.5, end: 12 },
  { name: 'Bloc 9',    start: 12,   end: 13.5 },
  { name: 'SYNTH-K',   start: 13.5, end: 15 },
  { name: 'Doline',    start: 15,   end: 16.5 },
  { name: 'Ferrite',   start: 16.5, end: 18 },
];

export const HEADLINER_NAME = 'SYNTH-K';

export function buildArtists(): Artist[] {
  return ARTIST_PLANS.map((a) => makeArtist({ key: slug(a.name), ...a }));
}
