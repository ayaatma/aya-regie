/**
 * RÉGLAGES AVANCÉS: which rule of the planning blocks, which one costs, and how much.
 *
 * WHY THIS EXISTS, in the régisseur's words of 2026-09-13: "généraliser assez l'outil pour être
 * utilisable sur n'importe quel événement", with "décider par événement si tel ou tel spécificité
 * doit être prise comme un poids ou un caractère bloquant". Until then the answer was written in
 * the code: nine rules were tier 1 in `validate.ts` and seventeen weights were constants in
 * `solver.ts`, all of them chosen for one festival. Another event may accept a volunteer working
 * past the volume they asked for when the bar is short, or refuse outright anybody outside their
 * two pole choices, or not care how many times somebody comes back. Those are decisions about an
 * event, and a régisseur must be able to take them without a developer.
 *
 * THREE MODES, and each criterion declares which of them make sense for it:
 *
 *   block   the placement is illegal. `isLegal` refuses it, so the solver never proposes it and
 *           the grid greys the drop target; a box put there by hand is tier 1, red.
 *   weight  the placement is allowed and costs `weight` in the solver's score. When the rule used
 *           to be tier 1 (a refused pole, the volume, the rhythm of the day) a breach is still
 *           reported, as a tier 2 signalement, so allowing it never hides it.
 *   off     neither a cost nor a signalement.
 *
 * Some criteria cannot block, because a block is a question about ONE placement and they are
 * about a whole day or a whole créneau: a floor of hours ("finish at 4 h at least"), a buddy, an
 * unfilled place. Blocking any of them would make an empty plan illegal, which breaks the one
 * promise the solver makes (it never answers "infeasible"). And two rules are not criteria at
 * all, because no event can want them otherwise: being on two créneaux at the same hour, and a
 * créneau holding more people than it has places. See `ALWAYS_BLOCKING`.
 *
 * ONLY THE RÉGISSEUR'S DISAGREEMENTS ARE STORED, the catering's doctrine. `Plan.constraints`
 * holds an override per criterion that was changed, never the full table, so a default improved
 * by measurement later reaches every event that never touched it. `resolveConstraints` is the
 * one place a default and an override meet.
 *
 * A WEIGHT IS A PRICE ON ONE SCALE. The absolute numbers mean nothing; the ratios are the
 * decisions. The reference the card shows is `staffing`: an hour of a place left empty. A breach
 * weighted above it will leave places empty rather than happen; one weighted below it will happen
 * whenever that fills a place. The measurements behind every default are in `solver.ts`, over
 * `DEFAULT_WEIGHTS`, and `DEFAULT_WEIGHTS` is derived from this table so the two cannot drift.
 */

export type ConstraintMode = 'block' | 'weight' | 'off';

export type CriterionId =
  | 'availability'
  | 'refusedPole'
  | 'preference'
  | 'preferenceOverflow'
  | 'artist'
  | 'volumeOver'
  | 'volumeUnder'
  | 'floor'
  | 'reserve'
  | 'maxConsecutive'
  | 'maxBlocks'
  | 'minBreak'
  | 'poleFragmentation'
  | 'blockSplit'
  | 'notChoice1'
  | 'outsideChoices'
  | 'buddy'
  | 'staffing'
  | 'allDebutants'
  | 'minExperienced'
  | 'debutantStacking'
  | 'stability';

/** What a régisseur changed on one criterion. Either field absent means "the default". */
export interface CriterionOverride {
  mode?: ConstraintMode;
  weight?: number;
}

/**
 * What an event stores. Sparse on purpose, see the header.
 *
 * `longDayHours` and `veryLongDayHours` are not rules: they are where the grid starts drawing 💪
 * and 💪💪 on somebody's box. They sit here because they were the same kind of constant (6 h and
 * 8 h, the answers the Loto Tekno form offered) and belong to the same card.
 */
export interface ConstraintSettings {
  criteria: Partial<Record<CriterionId, CriterionOverride>>;
  longDayHours: number;
  veryLongDayHours: number;
}

export const DEFAULT_CONSTRAINTS: ConstraintSettings = {
  criteria: {},
  longDayHours: 6,
  veryLongDayHours: 8,
};

export type CriterionGroup = 'horaires' | 'volume' | 'rythme' | 'poles' | 'creneaux' | 'recalcul';

export const CRITERION_GROUP_LABEL: Record<CriterionGroup, string> = {
  horaires: 'Disponibilités et horaires',
  volume: 'Volume horaire',
  rythme: 'Rythme de la journée',
  poles: 'Pôles et binômes',
  creneaux: 'Composition des créneaux',
  recalcul: 'Recalcul',
};

/** The scheduling rule a criterion's threshold is, when it has one. Edited on the same row. */
export type CriterionParameter =
  | 'maxConsecutiveHours'
  | 'maxBlocks'
  | 'minBreakHours'
  | 'minHoursPerPerson';

export interface CriterionDefinition {
  id: CriterionId;
  group: CriterionGroup;
  /** French, what the row says. Worded as the situation being judged, never as a verdict. */
  label: string;
  /** French, one or two sentences on what the criterion measures and what each mode does to it. */
  hint: string;
  /** The modes this criterion may take, in the order the card offers them. */
  modes: readonly ConstraintMode[];
  defaultMode: ConstraintMode;
  defaultWeight: number;
  /** French, what one unit of the weight is paid for. */
  unit: string;
  parameter?: CriterionParameter;
}

const BWO = ['block', 'weight', 'off'] as const;
const WO = ['weight', 'off'] as const;

/**
 * The criteria, in the order the card draws them.
 *
 * The default weights are `DEFAULT_WEIGHTS` of 2026-09-13 exactly, so an event that never opens
 * the card solves as it did the day before. Two need a word:
 *
 * - `notChoice1` and `outsideChoices` are CUMULATIVE, because the régisseur wrote them that way:
 *   "pas sur le premier choix" covers every later choice and everything outside them, "hors de
 *   tous les choix" adds to it for the latter. Since 2026-09-14 a volunteer has N choices, so the
 *   first is priced PER RANK: choice k costs `notChoice1 × (k − 1)` an hour, and a placement
 *   outside all of them costs as one rank past the last real step, `notChoice1 × max(1, N − 1)`,
 *   plus `outsideChoices`. With two choices that is 100 for the second and 100 + 700 = 800
 *   outside, the figures measured in 2026-09. On an unranked event every choice is rank 0 and
 *   only `outsideChoices` is paid.
 * - The criteria that were tier 1 until this date (`availability`, `refusedPole`, `volumeOver` and
 *   the three rhythm rules) had no weight at all. The defaults given to them are what a régisseur
 *   who switches them to "weight" most plausibly means, and they are stated relative to
 *   `staffing` (3000 an hour): a refused pole or a refused hour at twice it, so an empty place is
 *   still preferred to either (reaching somebody's floor can still pay for it, the floor being
 *   the dearest term there is); the volume and the rhythm at it, so they bend exactly when a
 *   place would otherwise stay empty.
 */
export const CRITERIA: readonly CriterionDefinition[] = [
  // --- Disponibilités et horaires ----------------------------------------------------------
  {
    id: 'availability',
    group: 'horaires',
    label: 'En dehors des horaires disponibles',
    hint: "Une tranche que la personne a refusée dans le formulaire, ou une heure après la fin de l'événement.",
    modes: BWO,
    defaultMode: 'block',
    defaultWeight: 6000,
    unit: 'par heure',
  },
  {
    id: 'preferenceOverflow',
    group: 'horaires',
    label: 'En dehors des horaires préférés, dans le débordement accepté',
    hint: "La marge que chaque tranche préférée tolère (Réglages, tranches horaires). Le coût grandit avec l'éloignement du bord.",
    modes: WO,
    defaultMode: 'weight',
    defaultWeight: 6,
    unit: "par heure × heure d'éloignement",
  },
  {
    id: 'preference',
    group: 'horaires',
    label: 'En dehors des horaires préférés étendus',
    hint: 'Au-delà du débordement accepté: la réponse de la personne n\'est plus respectée.',
    modes: BWO,
    defaultMode: 'weight',
    defaultWeight: 1500,
    unit: 'par heure',
  },
  {
    id: 'artist',
    group: 'horaires',
    label: 'Pendant un moment de la programmation que la personne veut voir',
    hint: "Les artistes cités comme « à ne pas manquer » dans le formulaire.",
    modes: BWO,
    defaultMode: 'weight',
    defaultWeight: 50,
    unit: 'par heure',
  },

  // --- Volume horaire ----------------------------------------------------------------------
  {
    id: 'volumeOver',
    group: 'volume',
    label: 'Au-dessus du volume demandé',
    hint: 'Plus d\'heures que la personne n\'en a proposé.',
    modes: BWO,
    defaultMode: 'block',
    defaultWeight: 3000,
    unit: 'par heure en trop',
  },
  {
    id: 'volumeUnder',
    group: 'volume',
    label: 'Sous le volume demandé',
    hint: "Moins d'heures que la personne n'en a proposé.",
    modes: WO,
    defaultMode: 'weight',
    defaultWeight: 60,
    unit: 'par heure manquante',
  },
  {
    id: 'floor',
    group: 'volume',
    label: 'Sous le plancher par personne',
    hint: 'En dessous, le déplacement ne vaut pas la peine: mieux vaut la réserve, et le dire. Ne peut pas être bloquant, un planning vide le serait.',
    modes: WO,
    defaultMode: 'weight',
    defaultWeight: 30000,
    unit: 'par personne',
    parameter: 'minHoursPerPerson',
  },
  {
    id: 'reserve',
    group: 'volume',
    label: 'Mise en réserve',
    hint: 'Garder quelqu\'un sans créneau, en le lui disant. Doit rester moins cher que le plancher manqué, sinon la réserve ne sert plus.',
    // Weight only: at zero, holding everybody back would be free and the solver would do it.
    modes: ['weight'],
    defaultMode: 'weight',
    defaultWeight: 20000,
    unit: 'par personne',
  },

  // --- Rythme de la journée ----------------------------------------------------------------
  {
    id: 'maxConsecutive',
    group: 'rythme',
    label: "Trop longtemps d'affilée",
    hint: 'Compté à travers les pôles: deux créneaux de 2 h qui se touchent font un bloc de 4 h.',
    modes: BWO,
    defaultMode: 'block',
    defaultWeight: 3000,
    unit: 'par heure au-delà',
    parameter: 'maxConsecutiveHours',
  },
  {
    id: 'maxBlocks',
    group: 'rythme',
    label: 'Trop de blocs de travail',
    hint: 'Combien de fois une personne peut revenir sur l\'événement.',
    modes: BWO,
    defaultMode: 'block',
    defaultWeight: 3000,
    unit: 'par bloc en trop',
    parameter: 'maxBlocks',
  },
  {
    id: 'minBreak',
    group: 'rythme',
    label: 'Pause trop courte entre deux blocs',
    hint: 'Le temps qu\'il faut pour que revenir ait du sens.',
    modes: BWO,
    defaultMode: 'block',
    defaultWeight: 3000,
    unit: 'par heure de pause manquante',
    parameter: 'minBreakHours',
  },
  {
    id: 'poleFragmentation',
    group: 'rythme',
    label: 'Changer de pôle dans la journée',
    hint: 'Deux pôles, c\'est deux briefings et deux équipes pour les mêmes heures.',
    modes: WO,
    defaultMode: 'weight',
    defaultWeight: 2500,
    unit: 'par changement',
  },
  {
    id: 'blockSplit',
    group: 'rythme',
    label: 'Revenir plus souvent que nécessaire',
    hint: "Un bloc de plus que ce que les heures de la personne imposent.",
    modes: WO,
    defaultMode: 'weight',
    defaultWeight: 1200,
    unit: 'par bloc',
  },

  // --- Pôles et binômes --------------------------------------------------------------------
  {
    id: 'refusedPole',
    group: 'poles',
    label: 'Sur un pôle refusé',
    hint: 'Un pôle que la personne a dit ne pas vouloir faire, ou un de ses sous-pôles.',
    modes: BWO,
    defaultMode: 'block',
    defaultWeight: 6000,
    unit: 'par heure',
  },
  {
    id: 'notChoice1',
    group: 'poles',
    label: 'Pas sur le premier choix',
    hint: "Chaque rang plus bas coûte un pas de plus: le choix 3 coûte deux fois le choix 2. Sans effet quand les choix de l'événement sont à égalité. Bloquant: seul le premier choix est permis.",
    modes: BWO,
    defaultMode: 'weight',
    defaultWeight: 100,
    unit: 'par heure × rang',
  },
  {
    id: 'outsideChoices',
    group: 'poles',
    label: 'Hors de tous les choix',
    hint: "S'ajoute au rang du dernier choix. Bloquant: une personne sans choix déclaré ne peut plus être placée.",
    modes: BWO,
    defaultMode: 'weight',
    defaultWeight: 700,
    unit: 'par heure',
  },
  {
    id: 'buddy',
    group: 'poles',
    label: 'Sans le binôme demandé',
    hint: 'Le même créneau que la personne citée. Au-dessus d\'une place vide de 2 h, le solveur laisse des trous pour réunir des amis.',
    modes: WO,
    defaultMode: 'weight',
    defaultWeight: 5000,
    unit: 'par demande',
  },

  // --- Composition des créneaux -----------------------------------------------------------
  {
    id: 'staffing',
    group: 'creneaux',
    label: 'Place non pourvue',
    hint: 'La référence de toute cette page: les autres poids se lisent par rapport à celui-ci.',
    modes: ['weight'],
    defaultMode: 'weight',
    defaultWeight: 3000,
    unit: 'par heure de place vide',
  },
  {
    id: 'allDebutants',
    group: 'creneaux',
    label: 'Créneau complet sans personne expérimentée',
    hint: 'Sauf sur un pôle qui l\'autorise.',
    modes: WO,
    defaultMode: 'weight',
    defaultWeight: 600,
    unit: 'par créneau',
  },
  {
    id: 'minExperienced',
    group: 'creneaux',
    label: 'Moins d\'expérimentés que le pôle n\'en demande',
    hint: 'Le minimum se règle pôle par pôle.',
    modes: WO,
    defaultMode: 'weight',
    defaultWeight: 600,
    unit: 'par personne manquante',
  },
  {
    id: 'debutantStacking',
    group: 'creneaux',
    label: 'Plus de débutants que la moitié du créneau',
    hint: 'Pour répartir les débutants plutôt que de les regrouper.',
    modes: WO,
    defaultMode: 'weight',
    defaultWeight: 8,
    unit: 'par débutant × heure',
  },

  // --- Recalcul ----------------------------------------------------------------------------
  {
    id: 'stability',
    group: 'recalcul',
    label: 'Changer une affectation existante',
    hint: 'Au recalcul d\'un planning déjà en place. Plus haut, moins de propositions et plus de trous gardés.',
    modes: WO,
    defaultMode: 'weight',
    defaultWeight: 200,
    unit: 'par case ajoutée ou retirée',
  },
];

export const CRITERION_BY_ID: ReadonlyMap<CriterionId, CriterionDefinition> = new Map(
  CRITERIA.map((c) => [c.id, c]),
);

/** Rules that are not criteria, for the card to say so. Two, and nothing about an event changes them. */
export const ALWAYS_BLOCKING: readonly string[] = [
  'Être sur deux créneaux à la même heure.',
  'Dépasser le nombre de places d\'un créneau.',
];

export const CONSTRAINT_MODE_LABEL: Record<ConstraintMode, string> = {
  block: 'Bloquant',
  weight: 'Poids',
  off: 'Ignoré',
};

export interface ResolvedCriterion {
  mode: ConstraintMode;
  weight: number;
}

export type ResolvedConstraints = Readonly<Record<CriterionId, ResolvedCriterion>>;

/**
 * Every criterion with its mode and weight for this event: the override when there is a valid
 * one, the default otherwise.
 *
 * A mode the criterion does not accept falls back to the default rather than being honoured, so
 * a hand-edited row asking a floor to block can never make an empty plan illegal.
 */
export function resolveConstraints(settings: ConstraintSettings | undefined): ResolvedConstraints {
  const out = {} as Record<CriterionId, ResolvedCriterion>;
  for (const def of CRITERIA) {
    const override = settings?.criteria[def.id];
    const mode = override?.mode !== undefined && def.modes.includes(override.mode)
      ? override.mode
      : def.defaultMode;
    const weight = typeof override?.weight === 'number' && Number.isFinite(override.weight) && override.weight >= 0
      ? override.weight
      : def.defaultWeight;
    out[def.id] = { mode, weight };
  }
  return out;
}

/** The price the solver pays: the weight while the criterion is weighted, nothing otherwise. */
export const priceOf = (c: ResolvedCriterion): number => (c.mode === 'weight' ? c.weight : 0);

/** The tier a breach is reported at, or null when the criterion is off and nothing is said. */
export const tierOf = (c: ResolvedCriterion): 1 | 2 | null =>
  c.mode === 'block' ? 1 : c.mode === 'weight' ? 2 : null;
