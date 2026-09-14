/**
 * The test scenario matrix, agreed 2026-09-06.
 *
 * Two axes that combine. The volume axis sets the overall tension, from "half the shifts will
 * stay empty" to "more volunteers than the 4h floor can absorb". The stress axis aims at one
 * mechanism at a time. Any stress can be layered on any volume.
 *
 *   npm run generate                                    every volume scenario, no stress
 *   npm run generate -- --volume=balanced --stress=headliner,debutants
 *   npm run generate -- --seed=7
 */

import type { SkillLevel } from './model.js';
/** The Loto Tekno form's three volumes. Synthetic data only: an event's own are `Plan.volume.options`. */
export type Volume = 4 | 6 | 8;

export interface GenConfig {
  volunteers: number;
  /** Relative odds of each requested volume, before availability trims the options. */
  volumeWeights: Record<Volume, number>;
  /** How the preference answers are drawn, keyed by the id of the DEFAULT_SLOTS slot named, 'any' for none. */
  halfWeights: Record<'loto' | 'concerts' | 'any', number>;
  levelWeights: Record<SkillLevel, number>;
  /** Odds of refusing one time slot. */
  refusedSlotProbability: number;
  /** Odds of refusing one pole rather than answering "tout me va". */
  refusedPoleProbability: number;
  /** Odds of naming an artist, among volunteers who work the evening. */
  artistProbability: number;
  /** Share of those answers that land on the headliner rather than spreading out. */
  headlinerBias: number;
  buddyProbability: number;
  secondBuddyProbability: number;
  buddyMangleProbability: number;
  /** Root pole that a large share of volunteers refuses and almost nobody picks. */
  shunnedRootName?: string;
  shunnedVetoShare?: number;
}

/**
 * A realistic answer mix. The average requested volume lands near 5.5h, which is what a form
 * offering 4h, 6h and 8h actually produces once people default to the lower options.
 */
export const BASE_CONFIG: GenConfig = {
  volunteers: 100,
  volumeWeights: { 4: 0.45, 6: 0.35, 8: 0.20 },
  halfWeights: { loto: 0.25, concerts: 0.45, any: 0.30 },
  levelWeights: { debutant: 0.40, intermediaire: 0.40, expert: 0.20 },
  refusedSlotProbability: 0.25,
  refusedPoleProbability: 0.55,
  artistProbability: 0.35,
  headlinerBias: 0.30,
  buddyProbability: 0.32,
  secondBuddyProbability: 0.25,
  buddyMangleProbability: 0.35,
};

export interface Scenario {
  id: string;
  label: string;
  exercises: string;
  patch: Partial<GenConfig>;
}

export const VOLUME_SCENARIOS: Scenario[] = [
  {
    id: 'shortage-heavy',
    label: 'Pénurie forte',
    exercises: 'Tableau de bord des manques, priorité à la couverture, diagnostic du trou',
    patch: { volunteers: 60 },
  },
  {
    id: 'shortage-moderate',
    label: 'Pénurie modérée',
    exercises: 'État réaliste de mi-campagne, novembre',
    patch: { volunteers: 90 },
  },
  {
    id: 'balanced',
    label: 'Équilibre exact',
    exercises: 'Le cas le plus dur: aucune marge, les préférences s\'affrontent de face',
    patch: { volunteers: 120 },
  },
  {
    id: 'surplus',
    label: 'Surplus confortable',
    exercises: 'Qualité des préférences, stabilité du planning entre deux réoptimisations',
    patch: { volunteers: 138 },
  },
  {
    id: 'over-recruited',
    label: 'Sur-recrutement',
    exercises: 'Le plancher de 4h casse, les alertes rouges de niveau 2 doivent rester lisibles',
    patch: { volunteers: 165 },
  },
];

export const STRESS_SCENARIOS: Scenario[] = [
  {
    id: 'afternoon-heavy',
    label: 'Pool orienté après-midi',
    exercises: 'La nuit est à découvert. Le diagnostic doit dire "personne n\'est disponible", ' +
               'pas "tout le monde a refusé ce pôle"',
    patch: { halfWeights: { loto: 0.70, concerts: 0.18, any: 0.12 } },
  },
  {
    id: 'headliner',
    label: 'Tête d\'affiche',
    exercises: 'Indisponibilité massive au pic de la nuit, l\'alerte de couverture doit se déclencher',
    patch: { artistProbability: 0.75, headlinerBias: 0.80 },
  },
  {
    id: 'debutants',
    label: 'Vague de débutants',
    exercises: 'La règle rouge du créneau 100% débutants et la préférence de répartition',
    patch: { levelWeights: { debutant: 0.70, intermediaire: 0.22, expert: 0.08 } },
  },
  {
    id: 'buddies',
    label: 'Binômes emmêlés',
    exercises: 'Chaînes A veut B veut C, fautes de frappe et surnoms pour le rapprochement ' +
               'approximatif et la passe manuelle du régisseur',
    patch: { buddyProbability: 0.75, secondBuddyProbability: 0.50, buddyMangleProbability: 0.70 },
  },
  {
    id: 'shunned-pole',
    label: 'Pôle boudé',
    exercises: 'Un pôle refusé par une large part et choisi par presque personne',
    patch: { shunnedRootName: 'Bar', shunnedVetoShare: 0.55 },
  },
];

export function resolveConfig(volumeId: string, stressIds: readonly string[]): GenConfig {
  const volume = VOLUME_SCENARIOS.find((s) => s.id === volumeId);
  if (!volume) {
    throw new Error(
      `Unknown volume scenario "${volumeId}". Known: ${VOLUME_SCENARIOS.map((s) => s.id).join(', ')}`,
    );
  }

  let config: GenConfig = { ...BASE_CONFIG, ...volume.patch };
  for (const id of stressIds) {
    const stress = STRESS_SCENARIOS.find((s) => s.id === id);
    if (!stress) {
      throw new Error(
        `Unknown stress scenario "${id}". Known: ${STRESS_SCENARIOS.map((s) => s.id).join(', ')}`,
      );
    }
    config = { ...config, ...stress.patch };
  }
  return config;
}
