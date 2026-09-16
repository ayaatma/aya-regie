/**
 * A synthetic export of the orgas' form, for testing the montage and the démontage.
 *
 *   npm run orgas                       (in tools/)  écrit out/orgas.csv
 *   npm run orgas -- --count=30 --seed=7
 *
 * WHY A CSV AND NOT ROWS IN THE DATABASE. The point of a test set is to exercise the path the
 * real answers take, and that path is the import screen: bind the columns, read the answers,
 * resolve who is already there, keep the codes that have already been sent. Writing people
 * straight into the plan would test none of it and would leave the one thing that actually
 * breaks, the column binding, unexercised.
 *
 * The file is imported from Réglages, "Importer le formulaire des orgas". Re-importing it is
 * safe on purpose: identity is the mail address, so the same file twice updates the same twenty
 * people rather than creating forty.
 *
 * WHAT IT DELIBERATELY VARIES. A third of them are there for the montage only, a fifth for the
 * démontage only, a third for both and the rest for neither; some name a pole, some do not; some
 * carry a diet or an allergy, most do not. The arrival is written as a date and an hour, because
 * that is what the importer reads into the day somebody actually arrives.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Rng } from './rng.js';
import { FIRST_NAMES, LAST_NAMES, makeEmail, makePhone } from './names.js';
import { toCsv } from './csv.js';

/**
 * The orga form's headers.
 *
 * WRITTEN BEFORE THE REAL ONE EXISTS, like the matchers they are read by. Each is anchored on
 * the word `bindOrganiserColumns` looks for, so the day the real form arrives the two can be
 * compared side by side and the matchers adjusted once.
 */
const ORGA_COLUMNS = [
  'Horodateur',
  'Nom',
  'Prénom',
  'Adresse e-mail',
  'Numéro de téléphone',
  'Ton régime alimentaire',
  'As-tu une allergie dont il serait préférable que nous soyons informés ?',
  "À partir de quand es-tu là pour le montage ? (date et heure, laisse vide si tu n'y es pas)",
  "Jusqu'à quand restes-tu pour le démontage ? (date et heure, laisse vide si tu n'y es pas)",
  'Sur quel pôle travailles-tu pendant le montage et le démontage ?',
  'Remarques',
] as const;

/** The phase poles a test montage is likely to have. Free text in the form, as it will be. */
const POLES = ['Général', 'Technique Son', 'Scène', 'Bar', 'Décoration', 'Logistique'];

const DIETS = ['Sans restriction', 'Végétarien', 'Végétalien', 'Sans porc'];
const ALLERGIES = ['Non', 'Non', 'Non', 'Fruits à coque', 'Gluten'];

/**
 * The days a montage and a démontage fall on for the 13 March 2027 event.
 *
 * Written as the form would collect them, day by day, so that importing this file lands people
 * on real hours rather than on a note somebody has to read. They are the defaults the phases get
 * in Réglages; a régisseur who moved the dates re-reads the arrivals on the fiches, which is one
 * click each and exactly what the fiche is for.
 */
const MONTAGE_DAYS = ['10/03/2027', '11/03/2027', '12/03/2027'];
const DEMONTAGE_DAYS = ['14/03/2027', '15/03/2027'];

interface Options {
  count: number;
  seed: number;
  out: string;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { count: 20, seed: 3, out: 'out' };
  for (const arg of argv) {
    const [name, value] = arg.replace(/^--/, '').split('=');
    if (name === 'count' && value) options.count = Math.max(1, Number(value));
    if (name === 'seed' && value) options.seed = Number(value);
    if (name === 'out' && value) options.out = value;
  }
  return options;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const rng = new Rng(options.seed);
  const rows: string[][] = [];
  const taken = new Set<string>();

  for (let i = 0; i < options.count; i++) {
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    // Two people may share a name; the mail address carries the index, so identity holds.
    const email = makeEmail(firstName, lastName, i);
    if (taken.has(email)) continue;
    taken.add(email);

    const roll = rng.next();
    const onMontage = roll < 0.65;
    const onDemontage = roll > 0.35;

    const montage = onMontage
      ? `${rng.pick(MONTAGE_DAYS)} ${rng.chance(0.6) ? '08:00' : '14:00'}`
      : '';
    const demontage = onDemontage
      ? `${rng.pick(DEMONTAGE_DAYS)} ${rng.chance(0.5) ? '18:00' : '23:00'}`
      : '';

    rows.push([
      `${rng.int(10, 25)}/09/2026 ${rng.int(9, 18)}:${String(rng.int(0, 59)).padStart(2, '0')}:00`,
      lastName,
      firstName,
      email,
      makePhone(rng),
      rng.pick(DIETS),
      rng.pick(ALLERGIES),
      montage,
      demontage,
      // A third of them work wherever they are needed, which is what Général is for.
      rng.chance(0.66) ? rng.pick(POLES) : '',
      rng.chance(0.2) ? 'Dispo au téléphone toute la semaine' : '',
    ]);
  }

  mkdirSync(options.out, { recursive: true });
  const path = join(options.out, 'orgas.csv');
  writeFileSync(path, toCsv(ORGA_COLUMNS, rows), 'utf8');

  const montage = rows.filter((r) => r[7] !== '').length;
  const demontage = rows.filter((r) => r[8] !== '').length;
  console.log(`${rows.length} orgas écrits dans ${path}`);
  console.log(`  ${montage} au montage, ${demontage} au démontage`);
  console.log("  à importer depuis l'onglet Import, formulaire des orgas");
  console.log("");
  // The arrivals are dates, and a date only becomes an hour if the phase covers it. Saying so
  // here is cheaper than a régisseur wondering why twenty fiches say "pas là".
  console.log("Pour que les arrivées soient lues, réglez les phases sur ces dates:");
  console.log(`  Montage   du ${MONTAGE_DAYS[0]} 08:00 au ${MONTAGE_DAYS[MONTAGE_DAYS.length - 1]} minuit`);
  console.log(`  Démontage du ${DEMONTAGE_DAYS[0]} 08:00 au ${DEMONTAGE_DAYS[DEMONTAGE_DAYS.length - 1]} minuit`);
  console.log("Sinon la réponse est gardée dans les remarques et la date se choisit sur la fiche.");
}

main();
