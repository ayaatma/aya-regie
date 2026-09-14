/**
 * Name pools, and the deliberate mangling of buddy names.
 *
 * The mangling is the point of this file. In a real Google Form export, "avec qui souhaitez-vous
 * être" comes back as free text: first name only, a nickname, a missing accent, a typo. The
 * import has to surface those for the régisseur's manual pass, so the test data has to contain
 * them.
 */

import type { Rng } from './rng.js';

export const FIRST_NAMES = [
  'Alexandre', 'Amandine', 'Antoine', 'Aurélie', 'Baptiste', 'Camille', 'Céline', 'Charlotte',
  'Clément', 'Élodie', 'Émilie', 'Fabien', 'Florian', 'Gaëlle', 'Guillaume', 'Hugo', 'Inès',
  'Jérémy', 'Jonathan', 'Julie', 'Julien', 'Kevin', 'Laure', 'Léa', 'Lucas', 'Ludovic',
  'Manon', 'Marion', 'Mathieu', 'Maxime', 'Mélanie', 'Nicolas', 'Noémie', 'Olivier', 'Pauline',
  'Quentin', 'Raphaël', 'Rémi', 'Romain', 'Sarah', 'Sébastien', 'Sophie', 'Stéphane', 'Sylvain',
  'Thibault', 'Thomas', 'Valentin', 'Vincent', 'Yann', 'Zoé',
] as const;

export const LAST_NAMES = [
  'Bernard', 'Blanc', 'Bonnet', 'Boyer', 'Brun', 'Chevalier', 'Clément', 'David', 'Dubois',
  'Dufour', 'Dumas', 'Dupont', 'Durand', 'Fabre', 'Faure', 'Fontaine', 'Fournier', 'Garcia',
  'Garnier', 'Gauthier', 'Girard', 'Guerin', 'Henry', 'Jean', 'Lambert', 'Laurent', 'Lefebvre',
  'Legrand', 'Lemaire', 'Leroy', 'Marchand', 'Martin', 'Masson', 'Mercier', 'Michel', 'Moreau',
  'Morel', 'Muller', 'Nicolas', 'Noel', 'Perrin', 'Petit', 'Philippe', 'Renard', 'Richard',
  'Robert', 'Robin', 'Rousseau', 'Roux', 'Simon', 'Thomas', 'Vidal', 'Vincent',
] as const;

/** Nicknames people actually type instead of the name on the registration form. */
export const NICKNAMES: Record<string, string> = {
  Alexandre: 'Alex',
  Antoine: 'Tonio',
  Baptiste: 'Bapt',
  Camille: 'Cam',
  Clément: 'Clem',
  Guillaume: 'Guigui',
  Jérémy: 'Jey',
  Jonathan: 'Jo',
  Julien: 'Juju',
  Ludovic: 'Ludo',
  Maxime: 'Max',
  Mathieu: 'Mat',
  Nicolas: 'Nico',
  Raphaël: 'Raph',
  Rémi: 'Mimi',
  Romain: 'Rom',
  Sébastien: 'Seb',
  Stéphane: 'Steph',
  Thibault: 'Thib',
  Valentin: 'Valou',
  Vincent: 'Vince',
};

const stripAccents = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '');

function swapTwoLetters(s: string, rng: Rng): string {
  if (s.length < 4) return s;
  const i = rng.int(1, s.length - 2);
  return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
}

/**
 * Turns a real "Prénom Nom" into what someone might plausibly have typed about that person.
 * Returns the clean form most of the time; the caller decides how often to ask for mangling.
 */
export function typedName(
  firstName: string,
  lastName: string,
  rng: Rng,
  mangleProbability: number,
): string {
  const clean = `${firstName} ${lastName}`;
  if (!rng.chance(mangleProbability)) return clean;

  const variants: Array<() => string> = [
    // First name only. By far the most common in practice, and ambiguous when two people share it.
    () => firstName,
    () => stripAccents(clean),
    () => clean.toLowerCase(),
    () => swapTwoLetters(clean, rng),
    () => `${lastName} ${firstName}`,
    () => NICKNAMES[firstName] ?? firstName,
    () => `${firstName} ${lastName[0]}.`,
    () => `  ${clean}  `,
  ];

  return rng.pick(variants)();
}

/** Access code alphabet with no 0/O, no 1/I/L, so it survives being read out on the phone. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function makeAccessCode(rng: Rng, taken: Set<string>): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < 8; i++) code += CODE_ALPHABET[rng.int(0, CODE_ALPHABET.length - 1)];
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
  throw new Error('Could not find a free access code');
}

export function makeEmail(firstName: string, lastName: string, index: number): string {
  const part = (s: string) => stripAccents(s).toLowerCase().replace(/[^a-z]/g, '');
  return `${part(firstName)}.${part(lastName)}${index}@example.org`;
}

export function makePhone(rng: Rng): string {
  let digits = '';
  for (let i = 0; i < 8; i++) digits += rng.int(0, 9);
  return `06${digits}`.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}
