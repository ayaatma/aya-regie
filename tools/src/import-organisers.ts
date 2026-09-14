/**
 * The pole organisers' own form, imported.
 *
 * A separate form from the volunteers', and a much smaller one: who somebody is and how to reach
 * them. No availability, no volume, no choices, no buddy. A organiser is recorded, never scheduled,
 * so nothing here feeds a rule and nothing here can make a plan illegal.
 *
 * THE FORM DOES NOT SAY WHICH POLES SOMEBODY RUNS, on purpose. That is the régisseur's decision,
 * taken in Réglages against the shape of the event, and it changes after the form closes far
 * more often than a phone number does. Importing a pole from a text answer would also mean
 * matching free text against pole names, which is exactly the guess `feature_form_import.md`
 * says this tool must not make silently. So an import brings people in; the poles are attached
 * by hand afterwards.
 *
 * Same two rules as the volunteers' import, for the same reasons. Columns are bound by keyword
 * rather than by exact header, because the real form does not exist yet and a reworded question
 * must not break the import. And nothing is ever dropped: a row missing an address is imported
 * and flagged, because the régisseur's process is to phone the person.
 */

import type { Organiser } from './model.js';
import { parsePhaseMoment, type Phase } from './phase.js';
import {
  ORGANISER_CODE_LENGTH,
  newAccessCode,
  parseCsv,
  type ImportIssue,
} from './import.js';
import { normalise } from './text.js';

// ---------------------------------------------------------------------------
// Column binding
// ---------------------------------------------------------------------------

const FIELDS = [
  'submittedAt', 'firstName', 'lastName', 'email', 'phone', 'diet', 'allergies', 'note',
  // What they answered about the two phases and about where they work, added 2026-09-10.
  'montage', 'demontage', 'poles',
] as const;

export type OrganiserFormField = (typeof FIELDS)[number];

/**
 * WRITTEN BEFORE THE REAL FORM EXISTS, 2026-09-09, and that is safe here in a way it was not for
 * the volunteers'. The volunteers' first matcher set was written against invented headers and
 * bound `volume` to a question about a beer keg, because that form has forty columns and several
 * of them share vocabulary. This form has eight, they name distinct things, and the two required
 * ones are anchored on `^nom$` and `^prenom$`, which is exactly what the real volunteers' form
 * turned out to use.
 *
 * What to do when the real form arrives: run it through and read the issues. A missing required
 * column stops the import and names itself, so the failure is loud. Adjust a `test` below and
 * nothing else changes.
 *
 * Ordered narrow before general, like the volunteers' set, so a broad matcher can only take a
 * column its narrower neighbours already refused. `allergies` runs before `diet` because a form
 * that asks about both in one sentence is asking about allergies, and because the diet matcher
 * is the broader of the two.
 */
const MATCHERS: Array<{ field: OrganiserFormField; test: (h: string) => boolean; required: boolean }> = [
  { field: 'submittedAt', test: (h) => /horodat|timestamp/.test(h), required: false },
  { field: 'lastName',    test: (h) => /^nom$|^nom de famille$/.test(h), required: true },
  { field: 'firstName',   test: (h) => /^prenom$/.test(h), required: true },
  { field: 'email',       test: (h) => /adresse e mail|^e mail$|^mail$|courriel/.test(h), required: false },
  { field: 'phone',       test: (h) => /telephone|portable|^tel$/.test(h), required: false },
  { field: 'allergies',   test: (h) => /allerg|intoleran/.test(h), required: false },
  { field: 'diet',        test: (h) => /regime|alimentaire|vegetarien|vegan/.test(h), required: false },
  // Démontage before montage: the second word contains the first, so a montage matcher put
  // first would take both columns.
  { field: 'demontage',   test: (h) => /demontage/.test(h), required: false },
  { field: 'montage',     test: (h) => /montage/.test(h), required: false },
  { field: 'poles',       test: (h) => /pole|poste|equipe/.test(h), required: false },
  { field: 'note',        test: (h) => /remarque|commentaire|precision|autre chose/.test(h), required: false },
];

export type OrganiserColumnMap = Partial<Record<OrganiserFormField, number>>;

export function bindOrganiserColumns(headers: readonly string[]): {
  map: OrganiserColumnMap;
  missing: OrganiserFormField[];
} {
  const normalised = headers.map(normalise);
  const map: OrganiserColumnMap = {};
  const used = new Set<number>();
  const missing: OrganiserFormField[] = [];

  for (const matcher of MATCHERS) {
    const index = normalised.findIndex((h, i) => !used.has(i) && matcher.test(h));
    if (index >= 0) {
      map[matcher.field] = index;
      used.add(index);
    } else if (matcher.required) {
      missing.push(matcher.field);
    }
  }

  return { map, missing };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * What makes two rows the same person: an address, or failing that a name.
 *
 * Deliberately the same rule, spelled the same way, as `volunteerIdentity` in `import.ts` and as
 * `splitLegacyOrganisers` in the app's `normalise.ts`. Three places decide when two organiser records
 * are one human, and they must agree or a re-import will duplicate somebody the conversion had
 * merged. **Change one, change all three.**
 *
 * The address is compared as an address, not through `normalise`, which strips punctuation and
 * would turn `c.dubois@x.fr` into `c dubois x fr`, colliding two genuinely different addresses.
 */
export function organiserIdentity(firstName: string, lastName: string, email: string): string {
  const mail = email.trim().toLowerCase();
  if (mail !== '') return `mail:${mail}`;
  const slug = (value: string) =>
    normalise(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `nom:${slug(firstName)}-${slug(lastName)}`;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface OrganiserImportOptions {
  /**
   * The two phases, when the plan has them, so "10/03/2027 08:00" can become an hour.
   *
   * Optional, and absent is a normal case: a plan whose phases are not configured yet has no
   * origin to count from. The answer is then kept in the note and the régisseur sets the arrival
   * on the fiche, which is one click from a list of that phase's own half-days.
   */
  phases?: { montage: Phase; demontage: Phase };
  /**
   * Who the plan already holds.
   *
   * A RE-IMPORT MUST NOT INVALIDATE A CODE ALREADY SENT OUT, and must not orphan the poles
   * somebody was already put in charge of. So a row matching an existing person keeps that
   * person's key and access code, and only their answers are refreshed. Their roles are never
   * touched here: this module knows nothing about poles.
   */
  existing?: readonly Organiser[];
}

export interface OrganiserImportResult {
  /**
   * Everyone the file describes, existing people included, ready to replace `Plan.organisers`.
   *
   * Somebody in the plan who is NOT in the file is kept as they were rather than removed. A
   * organiser who did not fill the form in again is not a organiser who resigned, and dropping them
   * would silently cut every pole they run. Removing somebody stays a deliberate click in
   * Réglages.
   */
  organisers: Organiser[];
  /** How many of them the file actually named, as opposed to carried over untouched. */
  imported: number;
  updated: number;
  created: number;
  issues: ImportIssue[];
}

export function importOrganisers(
  csvText: string,
  options: OrganiserImportOptions = {},
): OrganiserImportResult {
  const existing = options.existing ?? [];
  const issues: ImportIssue[] = [];
  const empty = (): OrganiserImportResult => ({
    organisers: [...existing],
    imported: 0,
    updated: 0,
    created: 0,
    issues,
  });

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    issues.push({
      severity: 'error',
      code: 'fichier-vide',
      row: null,
      person: '',
      message: 'Le fichier ne contient aucune ligne.',
    });
    return empty();
  }

  const { map, missing } = bindOrganiserColumns(rows[0]!);
  for (const field of missing) {
    issues.push({
      severity: 'error',
      code: 'colonne-manquante',
      row: null,
      person: '',
      message: `Aucune colonne ne correspond au champ "${field}". Vérifier les intitulés du formulaire.`,
    });
  }
  // A file with no name column describes nobody, and guessing which column holds a name is how
  // the volunteers' import once read a bar quiz as somebody's hours. Stop, and say so.
  if (missing.length > 0) return empty();

  const cell = (row: readonly string[], field: OrganiserFormField): string => {
    const index = map[field];
    return index === undefined ? '' : (row[index] ?? '').trim();
  };

  const byIdentity = new Map<string, Organiser>();
  for (const person of existing) {
    byIdentity.set(organiserIdentity(person.firstName, person.lastName, person.email), person);
  }

  // Every code in play, so a new one can collide with neither an existing organiser's nor one
  // drawn a moment ago in this same file.
  const takenCodes = new Set(existing.map((l) => l.accessCode).filter((c) => c !== ''));
  const takenKeys = new Set(existing.map((l) => l.key));

  const result = new Map<string, Organiser>(byIdentity);
  const seenInFile = new Set<string>();
  let created = 0;
  let updated = 0;

  rows.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 1;
    const firstName = cell(row, 'firstName');
    const lastName = cell(row, 'lastName');
    const email = cell(row, 'email');
    const person = `${firstName} ${lastName}`.trim();

    if (person === '') {
      issues.push({
        severity: 'warning',
        code: 'ligne-sans-nom',
        row: rowNumber,
        person: '',
        message: 'Cette ligne ne porte aucun nom et a été ignorée.',
      });
      return;
    }

    const identity = organiserIdentity(firstName, lastName, email);

    if (email === '') {
      issues.push({
        severity: 'warning',
        code: 'sans-adresse',
        row: rowNumber,
        person,
        // Said plainly because the consequence lands months later: without an address this
        // person is matched on their name alone, so a re-import after a marriage or a typo
        // creates a second record rather than updating the first.
        message:
          "Aucune adresse e-mail. Cette personne sera reconnue par son nom seul lors d'un nouvel import, et ne recevra pas son code par mail.",
      });
    }

    const twice = seenInFile.has(identity);
    if (twice) {
      issues.push({
        severity: 'warning',
        code: 'doublon-fichier',
        row: rowNumber,
        person,
        message: 'Cette personne apparaît plusieurs fois dans le fichier. La dernière ligne fait foi.',
      });
    }
    seenInFile.add(identity);

    /*
     * WHAT THE PHASE ANSWERS BECOME, and why they do not become hours.
     *
     * An orga writes "je serai là mercredi midi". Turning that into a number needs the montage's
     * own dates, which move for months before they settle, and a wrong number here would put
     * somebody on the grid on the wrong day with nothing on the fiche saying it was a guess. So
     * the sentence is kept, verbatim, in the note the régisseur reads, and the arrival itself is
     * set on the fiche in Réglages, in one click, from a list of the phase's own half-days.
     *
     * The same for the poles: the phase's pole list is the régisseur's, it does not exist yet
     * when this form is answered, and matching prose against it would be guessing twice.
     */
    const phaseNote = [
      cell(row, 'montage').trim() === '' ? '' : `Montage: ${cell(row, 'montage').trim()}`,
      cell(row, 'demontage').trim() === '' ? '' : `Démontage: ${cell(row, 'demontage').trim()}`,
      cell(row, 'poles').trim() === '' ? '' : `Pôles: ${cell(row, 'poles').trim()}`,
    ]
      .filter((part) => part !== '')
      .join(' · ');
    const noteWithPhases = [cell(row, 'note').trim(), phaseNote]
      .filter((part) => part !== '')
      .join(' · ');

    /*
     * The arrival and the departure, as hours of their own phase, when the phase exists and the
     * answer names a moment inside it. Null in every other case, including "je verrai": an
     * arrival this tool invented would put somebody on a grid with nothing saying it was a guess.
     */
    const montageFrom = options.phases
      ? parsePhaseMoment(cell(row, 'montage'), options.phases.montage)
      : null;
    const demontageUntil = options.phases
      ? parsePhaseMoment(cell(row, 'demontage'), options.phases.demontage)
      : null;
    if (options.phases && cell(row, 'montage').trim() !== '' && montageFrom === null) {
      issues.push({
        severity: 'warning',
        code: 'montage-illisible',
        row: rowNumber,
        person,
        message:
          `Arrivée au montage non comprise: "${cell(row, 'montage').trim()}". ` +
          'La réponse est gardée dans les remarques, la date est à choisir sur la fiche.',
      });
    }

    const before = result.get(identity);
    if (before) {
      // The key and the code are the two things a re-import must never change: one is what the
      // roles point at, the other is what has already been sent to somebody.
      result.set(identity, {
        ...before,
        firstName,
        lastName,
        email,
        phone: cell(row, 'phone') || before.phone,
        diet: cell(row, 'diet') || before.diet,
        allergies: cell(row, 'allergies') || before.allergies,
        note: noteWithPhases || before.note,
        // A re-import that says nothing about the phases leaves what the régisseur decided
        // alone: the fiche is where an arrival is corrected, and a correction outlives an export.
        montageFrom: montageFrom ?? before.montageFrom,
        demontageUntil: demontageUntil ?? before.demontageUntil,
      });
      // Counted once per person, not once per row: somebody listed twice in the file was
      // already counted, and somebody created a moment ago by an earlier row is a creation.
      if (byIdentity.has(identity) && !twice) updated += 1;
    } else {
      const key = freeKey(takenKeys, `resp-${slugOf(person)}`);
      result.set(identity, {
        key,
        firstName,
        lastName,
        email,
        phone: cell(row, 'phone'),
        accessCode: newAccessCode(takenCodes, ORGANISER_CODE_LENGTH),
        // Nothing is invented: an orga who has not said when they arrive is not on site, and
        // being drawn on a montage is always something somebody said.
        montageFrom,
        demontageUntil,
        montagePoleKeys: [],
        demontagePoleKeys: [],
        diet: cell(row, 'diet'),
        allergies: cell(row, 'allergies'),
        note: noteWithPhases,
      });
      created += 1;
    }
  });

  return {
    organisers: [...result.values()],
    imported: created + updated,
    created,
    updated,
    issues,
  };
}

const slugOf = (value: string): string =>
  normalise(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'responsable';

/** A key nothing already uses. Adds it to `taken`, so a batch cannot collide with itself. */
function freeKey(taken: Set<string>, base: string): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
