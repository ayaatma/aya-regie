/**
 * For the micro-plans of the test files only: a volunteer written with two named choices.
 *
 * The tests were written when a volunteer had exactly `choice1*` and `choice2*`, and hundreds of
 * hand-built plans read far better that way ("choix 1 alpha, choix 2 beta") than as a list
 * literal each time. Since 2026-09-14 the model holds `choices: PoleChoice[]`; this turns the
 * old shorthand into it, so the tests say what they always said and exercise the new model.
 */

import type { PoleChoice, SkillLevel, Volunteer } from './model.js';

export interface TwoChoices {
  choice1PoleKey?: string;
  choice1Level?: SkillLevel;
  choice2PoleKey?: string;
  choice2Level?: SkillLevel;
}

export type TestVolunteer = Omit<Volunteer, 'choices'> & TwoChoices & { choices?: PoleChoice[] };

/** Builds `choices` from the shorthand, dropping an empty key; an explicit `choices` wins. */
export function withChoices(v: TestVolunteer): Volunteer {
  const { choice1PoleKey, choice1Level, choice2PoleKey, choice2Level, choices, ...rest } = v;
  const built: PoleChoice[] = [];
  if (choice1PoleKey) built.push({ poleKey: choice1PoleKey, raw: '', level: choice1Level ?? 'debutant' });
  if (choice2PoleKey) built.push({ poleKey: choice2PoleKey, raw: '', level: choice2Level ?? 'debutant' });
  return { ...rest, choices: choices ?? built };
}
