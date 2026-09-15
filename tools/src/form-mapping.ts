/**
 * LA CORRESPONDANCE DU FORMULAIRE, 2026-09-14: which column of the export is which answer, and
 * what each answer of a closed question means.
 *
 * WHY IT EXISTS. The importer was written against one form, the Loto Tekno's: its forty-four
 * headers are matched by keyword in `import.ts`, and its answers are read by rules that know
 * "Je veux bien donner un coup de main 2 h de plus" means six hours and "Habitué" is the third
 * level. Another event has another form. Rather than a developer adding matchers for each, the
 * régisseur says it once on the import screen, and the event remembers it.
 *
 * TWO LEVELS, in the order the screen asks them:
 *
 *   columns   for each field of the tool, the header of the column that answers it, as the file
 *             writes it. The pole choices are a LIST of columns, in rank order, each with the
 *             optional column of the level declared for it: a form asks for one choice, or five,
 *             or ticks boxes in a single column.
 *   answers   for each closed question, what each answer found in the file means: this sentence
 *             is 6 h, "Habitué" is the third level, "🍻 BAR fix" is the pole Bar.
 *
 * ONLY THE RÉGISSEUR'S DECISIONS ARE STORED, the doctrine of every setting in this tool. A field
 * absent from `columns` is found by the automatic detection, an answer absent from `answers` is
 * read by the automatic rules, and both keep improving without an event having to forget
 * anything. An empty string in `columns` is a decision too: "this form does not ask it".
 *
 * KEYED BY TEXT, NOT BY POSITION. A column is remembered by its header and an answer by its
 * normalised text, because the next export may reorder columns (a question added in the middle)
 * and will certainly add rows. A remembered header the file no longer has falls back to the
 * automatic detection and says so.
 */

import type { SkillLevel, SlotId } from './model.js';

/** The fields a column can answer. The names are the importer's own; see `import.ts`. */
export type MappedField =
  | 'submittedAt'
  | 'firstName'
  | 'lastName'
  | 'nickname'
  | 'email'
  | 'phone'
  | 'diet'
  | 'allergies'
  | 'volume'
  | 'halfPreference'
  | 'refusedSlotChoice'
  | 'availabilityNote'
  | 'refusedPoles'
  | 'artist'
  | 'buddies'
  | 'phaseHelp'
  | 'montage'
  | 'demontage'
  | 'backup'
  | 'energy'
  | 'slotComfort'
  | 'arrival'
  | 'departure'
  | 'skills'
  | 'skillCheck'
  | 'emergencyContact'
  | 'healthCheck'
  | 'healthNote'
  | 'birthDate'
  | 'nicknameMatters'
  | 'assignedBy'
  | 'leadsTeam'
  | 'equipmentOffer';

/** One pole choice as columns: the pole answer, and the level answer when the form asks one. */
export interface ChoiceColumns {
  pole: string;
  level: string | null;
}

/** The value an answer of each closed question maps to. */
export interface AnswerMaps {
  /** Hours, or 'a-confirmer' for an answer that carries no volume ("j'ai des questions"). */
  volume?: Record<string, number | 'a-confirmer'>;
  level?: Record<string, SkillLevel>;
  /** A preference tranche id, or null for "peu importe". */
  preferredSlot?: Record<string, SlotId | null>;
  /** The refusable tranches an answer rules out; empty for "aucune". */
  refusedSlots?: Record<string, SlotId[]>;
  /** A pole key, or '' for an answer naming no pole ("tout me va"). Choices and refusals alike. */
  pole?: Record<string, string>;
  /** The tranches one answer refuses and avoids (« shifts de nuit ? »). Since 2026-09-15. */
  slotComfort?: Record<string, { refused: SlotId[]; avoided: SlotId[] }>;
}

export type AnswerKind = keyof AnswerMaps;

export interface FormMapping {
  columns: Partial<Record<MappedField, string>>;
  /** The choice columns in rank order. Absent means found automatically. */
  choices?: ChoiceColumns[];
  answers: AnswerMaps;
}

export const EMPTY_FORM_MAPPING: FormMapping = { columns: {}, answers: {} };

/** How the screen names each field. French, as the régisseur reads the list. */
export const MAPPED_FIELD_LABEL: Record<MappedField, string> = {
  submittedAt: 'Horodatage',
  firstName: 'Prénom',
  lastName: 'Nom',
  nickname: 'Surnom',
  email: 'Adresse e-mail',
  phone: 'Téléphone',
  diet: 'Régime alimentaire',
  allergies: 'Allergies',
  volume: 'Volume horaire',
  halfPreference: 'Tranche préférée',
  refusedSlotChoice: 'Tranches refusées (question fermée)',
  availabilityNote: 'Contrainte horaire (texte libre)',
  refusedPoles: 'Pôles refusés',
  artist: 'Artistes à ne pas manquer',
  buddies: 'Binômes',
  phaseHelp: 'Montage et démontage (une question)',
  montage: 'Montage',
  demontage: 'Démontage',
  backup: 'Renfort (Réserve)',
  energy: "Profil d'énergie",
  slotComfort: 'Tranche refusée ou à éviter (une question)',
  arrival: "Heure d'arrivée",
  departure: 'Heure de départ',
  skills: 'Compétences (texte libre)',
  skillCheck: 'Compétence (question oui / non)',
  emergencyContact: "Contact en cas d'urgence",
  healthCheck: 'Santé ou besoins spécifiques (oui / non)',
  healthNote: 'Santé ou besoins spécifiques (précisions)',
  birthDate: 'Date de naissance (lue pour « mineur », non conservée)',
  nicknameMatters: 'Surnom important (oui / non)',
  assignedBy: 'Déjà affecté·e (envoyé·e par un·e responsable, ou responsable)',
  leadsTeam: 'Équipe tenue en tant que responsable',
  equipmentOffer: 'Matériel proposé (Magasin)',
};

/** The order the screen lists the fields in: who, then what they can do, then the rest. */
export const MAPPED_FIELDS: readonly MappedField[] = [
  'firstName', 'lastName', 'nickname', 'email', 'phone',
  'volume', 'halfPreference', 'refusedSlotChoice', 'availabilityNote', 'refusedPoles',
  'artist', 'buddies', 'diet', 'allergies', 'phaseHelp', 'montage', 'demontage', 'backup', 'energy', 'slotComfort', 'arrival', 'departure', 'skills', 'skillCheck', 'emergencyContact', 'healthCheck', 'healthNote', 'birthDate', 'nicknameMatters', 'assignedBy', 'leadsTeam', 'equipmentOffer', 'submittedAt',
];

/** Which answer map a field's answers go through, for the fields that have one. */
export const ANSWER_KIND_OF: Partial<Record<MappedField, AnswerKind>> = {
  volume: 'volume',
  halfPreference: 'preferredSlot',
  refusedSlotChoice: 'refusedSlots',
  refusedPoles: 'pole',
  slotComfort: 'slotComfort',
};
