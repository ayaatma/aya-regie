/**
 * A form export written from a plan you already have, so an import can be tried on real people.
 *
 *   npm run form-csv -- --plan=planning-2026-09-10.json      (in tools/)
 *   npm run form-csv -- --plan=... --phases=0                # sans réponse montage
 *
 * WHY IT EXISTS. `npm run generate` writes a form export for people it invents, which is
 * exactly wrong for testing an import against a plan that is already full: not one of those
 * hundred and twenty names matches, so the import offers to create a hundred and twenty more.
 * This writes the same export for the people the plan ALREADY holds, every answer as it stands
 * today, so re-importing it changes nothing at all except what this tool deliberately changes.
 *
 * WHAT IT DELIBERATELY CHANGES: the montage / démontage answer, for about a third of them,
 * chosen from the name so that running it twice gives the same file. That is the point: the
 * reconciliation screen then shows those fiches and nothing else, which is a test of the whole
 * chain rather than of a parser.
 *
 * The plan comes out of the tool itself: Import, "Télécharger le plan". Nothing here talks to a
 * database, and nothing here writes into one.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { FORM_COLUMNS, toCsv, volunteerToFormRow } from './csv.js';
import type { Plan } from './plan.js';
import type { Volunteer } from './model.js';

interface Options {
  plan: string;
  out: string;
  /** Whether to write a montage / démontage answer at all. */
  phases: boolean;
  /** Roughly what share of people answer something to it. */
  share: number;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { plan: '', out: 'out/formulaire.csv', phases: true, share: 0.34 };
  for (const arg of argv) {
    const [name, value] = arg.replace(/^--/, '').split('=');
    if (name === 'plan' && value) options.plan = value;
    if (name === 'out' && value) options.out = value;
    if (name === 'phases' && value) options.phases = value !== '0' && value !== 'non';
    if (name === 'share' && value) options.share = Math.min(1, Math.max(0, Number(value)));
  }
  if (options.plan === '') {
    throw new Error(
      'Il manque --plan=<fichier.json>. Le fichier se télécharge depuis l\'onglet Import, ' +
        'bouton « Télécharger le plan ».',
    );
  }
  return options;
}

/**
 * A stable bit drawn from the name itself.
 *
 * The same person answers the same thing every time this runs, which is what makes a second run
 * a no-op rather than a new set of changes to read through.
 */
function coin(seed: string, probability: number): boolean {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000 < probability;
}

/** What somebody answers to "montage / démontage ?", in the wordings the importer must survive. */
function phaseAnswer(seed: string, share: number): string {
  if (!coin(`phase${seed}`, share)) return 'Non';
  if (coin(`both${seed}`, 0.3)) return 'Oui';
  if (coin(`which${seed}`, 0.55)) {
    return coin(`word${seed}`, 0.5)
      ? 'Oui, pour le montage'
      : 'Je peux venir aider au montage, pas au démontage';
  }
  return coin(`word${seed}`, 0.5) ? 'Oui, pour le démontage' : 'Dispo pour le démontage le lendemain';
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const plan = JSON.parse(readFileSync(options.plan, 'utf8')) as Plan;
  const volunteers: Volunteer[] = [...(plan.volunteers ?? [])];

  if (volunteers.length === 0) {
    throw new Error(`${options.plan} ne contient aucun bénévole.`);
  }

  const polePathByKey = new Map(plan.poles.map((pole) => [pole.key, pole.path]));
  const artistNameByKey = new Map(plan.artists.map((artist) => [artist.key, artist.name]));
  const contactByName = new Map(
    volunteers.map((v) => [
      `${v.firstName} ${v.lastName}`,
      { email: v.email, phone: v.phone },
    ]),
  );

  const phaseColumn = FORM_COLUMNS.length - 1;
  const rows = volunteers.map((volunteer) => {
    const row = volunteerToFormRow(volunteer, {
      polePathByKey,
      artistNameByKey,
      // One timestamp for the lot: the export is a snapshot, and the real column is only ever
      // read to order the rows.
      submittedAt: '01/10/2026 12:00:00',
      contactByName,
    });
    if (options.phases) {
      row[phaseColumn] = phaseAnswer(`${volunteer.firstName} ${volunteer.lastName}`, options.share);
    }
    return row;
  });

  writeFileSync(options.out, toCsv(FORM_COLUMNS, rows), 'utf8');

  const answered = rows.filter((row) => row[phaseColumn] !== 'Non').length;
  console.log(`${rows.length} bénévoles écrits dans ${options.out}`);
  if (options.phases) {
    console.log(`  ${answered} répondent quelque chose au montage ou au démontage`);
  }
  console.log('  à réimporter depuis l\'onglet Import: ce sont les mêmes personnes,');
  console.log('  donc rien ne se crée et seules ces réponses-là changent.');
}

main();
