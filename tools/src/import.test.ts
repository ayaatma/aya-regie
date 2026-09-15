/**
 * The importer, tested against the real form rather than against one this tool imagined.
 *
 * Everything here exists because of one afternoon in September 2026. `bindColumns` had been
 * written and measured against invented headers, passed, and then met the actual export: it
 * found none of the six scheduling columns, and bound two of them to the wrong question
 * entirely, one of them reading a bar quiz answer as somebody's volunteering hours.
 *
 * So the headers below are copied verbatim from the export, all forty of them, including the
 * twenty-five this tool has no use for. They are the ones that make binding hard: the surname
 * question that also says "préfères", the quiz question that also says "combien", the emergency
 * contact that also asks for a phone number. A fixture without them proves nothing.
 */

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { EVENT_START_ISO, buildArtists, buildPoles } from './event-config.js';
import { bindColumns, bindForm, importVolunteers, surveyForm } from './import.js';
import { FORM_COLUMNS, brevoContactsCsv } from './csv.js';
import { emptyPlan } from './plan.js';
import type { Plan } from './plan.js';
import { DEFAULT_RULES ,
  absentFromPhase,
} from './model.js';
import type { Volunteer } from './model.js';

const { poles } = buildPoles();
const artists = buildArtists();

/** A plan holding only what the contact file reads: who, and how many shifts they hold. */
function planWith(
  volunteers: ReadonlyArray<Partial<Volunteer> & { key: string }>,
  assignments: ReadonlyArray<{ volunteerKey: string; shiftKey: string }> = [],
): Plan {
  return {
    ...emptyPlan({
      name: 'Essai',
      startISO: '2027-03-13T11:00:00.000Z',
      lengthHours: 18,
      address: '',
      sheetUrl: '',
      slots: [],
      preferenceSlots: [],
      rules: DEFAULT_RULES,
      poles: [],
      shifts: [],
      artists: [],
      volunteers: [],
    }),
    volunteers: volunteers.map((v) => ({
      key: v.key,
      firstName: v.firstName ?? '',
      lastName: v.lastName ?? '',
      nickname: v.nickname ?? '',
      email: v.email ?? '',
      phone: '',
      accessCode: v.accessCode ?? '',
      diet: v.diet ?? '',
      allergies: v.allergies ?? '',
      requestedHours: 4,
      preferredSlotId: null,
      refusedSlotIds: [],
      availabilityNote: '',
      refusedPoleKeys: [],
      choices: [],
      artistKeys: [],
      buddyRawNames: [],
      manualFields: [],
      needsReview: false,
      reviewReasons: [],
      montage: absentFromPhase(),
      demontage: absentFromPhase(),
    })),
    assignments: assignments.map((a) => ({ ...a, source: 'manual' as const, locked: false })),
  };
}

/** The 40 headers of "Formulaire d'inscription Bénévole Loto Tekno© #6", read on 2026-09-08. */
const REAL_HEADERS: readonly string[] = [
  'Horodateur',
  'Adresse e-mail',
  'Nom',
  'Prénom',
  'Surnom (si tu préfères qu’on t’appelle par celui-ci) ',
  'Date de naissance',
  'Adresse, code postal et ville\n',
  'Numéro de téléphone, sans espace ni point stp.\n',
  'Tu as quelque chose à nous faire part concernant un handicap ou une contrainte physique ? ',
  "Prends-tu un traitement qui suscite qu'il soit préférable que nous soyons au courant pour pourvoir agir vite en cas de problème ?",
  "Tu veux qu'on appelle qui en cas d'urgence : nom, prénom, numéro de téléphone",
  'Ton régime alimentaire ',
  'As-tu une allergie dont il serait préférable que nous soyons informés ? ',
  'Nous donnes-tu loto-risation d’utiliser ton adresse mail pour te contacter lors de nos futurs recrutements bénévoles pour les autres événements d’Aya Atma ?',
  '📩  Veux-tu recevoir par e-mail les informations importantes sur le Loto Tekno, ainsi que les actualités et prochaines soirées (secrètes  👀) organisées par Aya Atma ?  ',
  'Qui est ton parrain ou ta marraine ? (Qui t’a conseillé·e de venir ?) ',
  "Est-ce que tu as l'application WhatsApp sur ton téléphone ? Nous l'utilisons pour améliorer la  communication au sein des différentes équipes pendant l'événement. ",
  "As-tu déjà participé bénévolement à l'un de nos événements ? ",
  'À quels événements Aya Atma as-tu déjà participé en tant que bénévole ou salarié·e ? ',
  'Nous demandons à chaque bénévole un minimum de 4 h de bénévolat. 😊\nSi tu le souhaites, tu peux aussi donner un petit coup de pouce supplémentaire à l’équipe du Loto Tekno en ajoutant 2 h ou 4 h de bénévolat*. \nAprès 4 h de bénévolat, tu auras au minimum 2 h de pause pour souffler, profiter de l’événement et revenir en forme ! ✨\n*Si tu as des questions tu peux les poser en fin de formulaire.  ',
  "Quel est ton choix principal ?\n(Si on a vu ensemble un pôle en particulier qui n'est pas dans la liste, écris le dans \"Autre\")",
  'Quel est ton niveau de compétence pour ton choix principal ? ',
  'Ton deuxième choix',
  'Quel est ton niveau de compétence pour ton deuxième choix ? ',
  'Y a-t-il un poste en particulier que tu ne veux absolument pas faire ?',
  "Il y a t'il des horaire ou tu ne veux/peux absolument pas travailler ?",
  "Qu'est ce que tu préfères ?",
  "Il y a t'il un artiste/groupe que tu ne veux absolument pas louper ? (Ne pas divulguer le line up. Merci de ta compréhension)",
  'En cochant cette case, tu confirmes ton adhésion gratuite à l’association Aya Atma, valable un an. ',
  'Souhaites-tu être bénévole avec un·e ami·e en particulier ?\nSi oui, indique son nom, prénom, mail et numéro de téléphone (séparés par des virgules, si plusieurs mettre les autres à la suite), on fera notre possible pour vous mettre ensemble s’il ou elle est sélectionné·e.    ',
  'Colonne 30',
  'Quelle est ta taille de t-shirt ? ',
  'Combien faut-il de personnes pour déplacer un fût de 30 litres de bière ?',
  'Que faire si je trouve une personne inconsciente ?',
  "S'il y a un départ de feu :",
  "Si je vois quelqu'un qui galère dans une tâche difficile.",
  "Je remarque qu'une personne profite de la vulnérabilité d'une personne en état d'ébriété et semble mal intentionné.",
  'Il manque des bénévoles sur un roulement ',
  'Pendant ton shift, on compte sur ton engagement et ton énergie, sans jamais juger ton efficacité. 🌈\nMais comment réagis-tu face à la fatigue ?',
  'Signatures',
  'Tu veux ajouter quelque chose, une précision ? Une dédicace, une déclaration, ou un message d’amour à faire circuler ? 💖 ',
  'Colonne 41',
  "Si tu as un impératif horaire stricte pendant l'exploitation, précise le ici (avec la raison si ce n'est pas indiscret)",
  "Serais tu prêt à faire du montage / démontage les jours avant / après l'événement en plus de tes créneaux le jour J ?",
];

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

test('every column binds against the real export, and none is missing', () => {
  const { map, missing } = bindColumns(REAL_HEADERS);
  deepStrictEqual(missing, [], 'aucune colonne obligatoire ne doit manquer');

  const expected: Record<string, number> = {
    submittedAt: 0, email: 1, lastName: 2, firstName: 3, nickname: 4, phone: 7,
    volume: 19, choice1Pole: 20, choice1Level: 21, choice2Pole: 22, choice2Level: 23,
    // Two time questions since 2026-09-10: the old closed one is still column 25, and the new
    // free-text "impératif horaire" is column 42, at the far end past two more decoys.
    refusedPoles: 24, refusedSlotChoice: 25, halfPreference: 26, artist: 27, buddies: 29,
    availabilityNote: 42,
  };
  for (const [field, index] of Object.entries(expected)) {
    strictEqual(map[field as keyof typeof map], index, `${field} -> colonne ${index}`);
  }
});

test('the decoys that caused the wrong bindings are not taken', () => {
  // Each of these matched a matcher that was too generous, and each cost a real column.
  const { map } = bindColumns(REAL_HEADERS);
  const taken = new Set(Object.values(map));
  // Column 4 stopped being a decoy on 2026-09-09 and is now read as the nickname. What still
  // has to hold is that it is not the preference question, which is what it used to swallow.
  strictEqual(map.nickname, 4, '"Surnom (si tu préfères...)" est lu comme le surnom');
  strictEqual(map.halfPreference, 26, 'et la préférence garde sa propre colonne');
  ok(!taken.has(32), '"Combien faut-il de personnes pour déplacer un fût" ne prend pas le volume');
  ok(!taken.has(10), '"qui appeler en cas d\'urgence" ne prend pas le téléphone');

  // Three columns arrived with the 2026-09-10 form, and two of them are decoys for the two
  // time matchers: 40 says "une précision", 43 says "créneaux". Either would have been taken
  // by the broad matcher that first read the free-text question, and taking 43 would have read
  // "yes I can help set up" as an availability constraint.
  ok(!taken.has(40), '"Tu veux ajouter quelque chose, une précision" ne prend aucune colonne horaire');
  // Column 43 stopped being a decoy on 2026-09-10: it is the montage / démontage question and
  // is read as such. What still has to hold is that no TIME matcher takes it, which is what it
  // used to swallow.
  strictEqual(map.phaseHelp, 43, '"montage / démontage" est lu comme la question des phases');
  ok(map.availabilityNote !== 43 && map.refusedSlotChoice !== 43,
     'et jamais comme une contrainte horaire');
  strictEqual(map.refusedSlotChoice, 25, 'la question fermée reste lue');
  strictEqual(map.availabilityNote, 42, "et l'impératif horaire est lu en plus, pas à sa place");

  // Columns 11 and 12 stopped being decoys on 2026-09-12, when the catering needed them. The
  // order between them is the part that matters: an allergy landing in the column a caterer
  // reads as a preference is the kind of mistake that ends at a hospital rather than at a table.
  strictEqual(map.diet, 11, '"Ton régime alimentaire" est lu comme le régime');
  strictEqual(map.allergies, 12, "et l'allergie garde sa propre colonne");
});

test('the diet and the allergy are imported exactly as they were written', () => {
  const person = importOne({ 11: 'Végétarien, pas de poisson non plus', 12: 'Fruits à coque' })
    .volunteers[0]!;
  strictEqual(person.diet, 'Végétarien, pas de poisson non plus');
  strictEqual(person.allergies, 'Fruits à coque');
});

test('an export that asks about both in one sentence gives the column to the allergy', () => {
  const headers = ['Nom', 'Prénom', 'Régime alimentaire ou allergie ?'];
  const { map } = bindColumns(headers);
  strictEqual(map.allergies, 2);
  strictEqual(map.diet, undefined, "aucune colonne ne reste pour le régime, et c'est le bon sens");
});

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** One row of the real export, with only the fifteen useful columns filled in. */
function rowCsv(over: Record<number, string> = {}): string {
  const values = REAL_HEADERS.map(() => '');
  values[0] = '2026-10-01 10:00';
  values[1] = 'alice@example.org';
  values[2] = 'Martin';
  values[3] = 'Alice';
  values[7] = '0600000000';
  values[19] = 'Je préfère rester sur un seul créneau de 4 h. 😊';
  values[20] = 'Bar / Service';
  values[21] = 'Habitué';
  values[22] = 'Propreté';
  values[23] = 'Débutant';
  values[24] = 'Aucun';
  values[25] = 'Aucune, tout me va !';
  values[26] = 'Peux importe';
  for (const [index, value] of Object.entries(over)) values[Number(index)] = value;

  const quote = (v: string) => (/["\n,]/.test(v) ? `"${v.split('"').join('""')}"` : v);
  return [REAL_HEADERS.map(quote).join(','), values.map(quote).join(',')].join('\n');
}

const importOne = (over: Record<number, string> = {}) =>
  importVolunteers(rowCsv(over), { poles, artists, startISO: EVENT_START_ISO });

test('the volume answers are read as totals, not as the digit they happen to contain', () => {
  // "2 h de plus" is six hours and "4 h de plus" is eight. Reading the first digit made the
  // first unreadable and the second identical to the four-hour answer.
  strictEqual(importOne().volunteers[0]!.requestedHours, 4);
  strictEqual(
    importOne({ 19: 'Je veux bien donner un coup de main 2 h de plus, ça ne me fait pas peur ! 💪' })
      .volunteers[0]!.requestedHours,
    6,
  );
  strictEqual(
    importOne({ 19: 'Je suis partant·e pour 4 h de plus, j\'ai l\'habitude ! 💪💪' })
      .volunteers[0]!.requestedHours,
    8,
  );
});

test('the answer that carries no volume imports the person anyway, with a signalement', () => {
  const result = importOne({
    19: 'J\'ai quelques questions avant de me décider, je les préciserai dans « Autre ». 💬',
  });
  strictEqual(result.volunteers.length, 1, 'la personne existe, elle ne disparaît pas');
  strictEqual(result.volunteers[0]!.requestedHours, 4, 'au plancher en attendant');
  ok(result.issues.some((i) => i.code === 'volume-a-confirmer'), 'et il faut la rappeler');
  ok(!result.issues.some((i) => i.severity === 'error'), 'ce n\'est pas une erreur');
});

test('"Habitué" is the form\'s third level, a word the engine never says', () => {
  strictEqual(importOne().volunteers[0]!.choices[0]!.level, 'expert');
});

test('the preference is read against the slots, by label, and "Peux importe" is none', () => {
  strictEqual(importOne().volunteers[0]!.preferredSlotId, null);
  strictEqual(
    importOne({ 26: 'Travailler pendant le loto' }).volunteers[0]!.preferredSlotId,
    'loto',
  );
  strictEqual(
    importOne({ 26: 'Travailler pendant les concerts' }).volunteers[0]!.preferredSlotId,
    'concerts',
  );
});

test('a preference naming no slot of the plan is an error, and imports as none', () => {
  const result = importOne({ 26: 'Travailler pendant la kermesse' });
  strictEqual(result.volunteers[0]!.preferredSlotId, null);
  ok(result.issues.some((i) => i.code === 'reponse-illisible' && /kermesse/.test(i.message)));
});

test('several ticked refusals all survive the import', () => {
  // The question is a checkbox. Keeping one of three left two hard refusals off the plan.
  // Two root poles neither choice depends on, so the only thing under test is the list.
  const result = importOne({ 24: 'Parking, Sécu' });
  deepStrictEqual(result.volunteers[0]!.refusedPoleKeys.length, 2);
  ok(!result.issues.some((i) => i.severity === 'error'), result.issues.map((i) => i.message).join(' | '));
});

test('a column bound to a question nobody can answer is reported as a binding fault', () => {
  // The volume column filled with the bar quiz's answers: every row unreadable, which is the
  // signature of a wrong binding rather than of a hundred confused volunteers.
  const result = importOne({ 19: 'Deux personnes' });
  ok(
    result.issues.some((i) => i.code === 'colonne-mal-associee'),
    'le diagnostic doit porter sur la colonne, pas sur la ligne',
  );
});

// ---------------------------------------------------------------------------
// Binômes
//
// The question asks for four things in one box: "indique son nom, prénom, mail et numéro de
// téléphone". So the answer is a sentence about one person, and reading it as a comma-separated
// list of names produced two unresolvable fragments for every real request, while throwing away
// the mail address, which is the one field that identifies somebody exactly.
// ---------------------------------------------------------------------------

/** Two or three rows of the real export: somebody, the friend they ask for, and a bystander. */
function pairCsv(asks: string, friend: Record<number, string> = {}, third = false): string {
  const base = (over: Record<number, string>) => {
    const values = REAL_HEADERS.map(() => '');
    values[0] = '2026-10-01 10:00';
    values[1] = 'alice@example.org';
    values[2] = 'Martin';
    values[3] = 'Alice';
    values[7] = '0600000000';
    values[19] = 'Je préfère rester sur un seul créneau de 4 h. 😊';
    values[20] = 'Bar / Service';
    values[21] = 'Habitué';
    values[22] = 'Propreté';
    values[23] = 'Débutant';
    values[24] = 'Aucun';
    values[25] = 'Aucune, tout me va !';
    values[26] = 'Peux importe';
    for (const [index, value] of Object.entries(over)) values[Number(index)] = value;
    return values;
  };

  const quote = (v: string) => (/["\n,]/.test(v) ? `"${v.split('"').join('""')}"` : v);
  return [
    REAL_HEADERS.map(quote).join(','),
    base({ 29: asks }).map(quote).join(','),
    base({ 1: 'bob@example.org', 2: 'Durand', 3: 'Bob', 7: '06 11 22 33 44', ...friend })
      .map(quote)
      .join(','),
    ...(third
      ? [
          base({ 1: 'chloe@example.org', 2: 'Petit', 3: 'Chloé', 7: '06 99 88 77 66' })
            .map(quote)
            .join(','),
        ]
      : []),
  ].join('\n');
}

const importPair = (asks: string, friend: Record<number, string> = {}, third = false) =>
  importVolunteers(pairCsv(asks, friend, third), { poles, artists, startISO: EVENT_START_ISO });

test('the answer the form actually asks for is one person, not three', () => {
  // THE BUG THIS EXISTS FOR. Split on commas, this was ["Bob Durand", "bob@example.org",
  // "06 11 22 33 44"]: one request resolved and two warnings about names nobody could match,
  // for every single volunteer who filled the question in.
  const result = importPair('Bob Durand, bob@example.org, 06 11 22 33 44');

  deepStrictEqual(result.volunteers[0]!.buddyRawNames, ['Bob Durand']);
  strictEqual(result.buddies.length, 1);
  strictEqual(result.buddies[0]!.toKey, result.volunteers[1]!.key);
  deepStrictEqual(result.issues.filter((i) => i.code.startsWith('binome')), []);
});

test('the mail address settles it, and it is what the name matching cannot do', () => {
  // The address was copied; the name was remembered. "Bobby Duran" is two edits from "Bob
  // Durand" and would have gone to the manual pass on its own.
  const result = importPair('Bobby Duran, bob@example.org');

  strictEqual(result.buddies.length, 1);
  strictEqual(result.buddies[0]!.toKey, result.volunteers[1]!.key);
  strictEqual(result.buddies[0]!.via, 'adresse e-mail');
});

test('a number alone identifies somebody, whatever spacing either of them used', () => {
  // The friend registered with "06 11 22 33 44" and is named here as "+33 6 11 22 33 44".
  const result = importPair('+33 6 11 22 33 44');

  strictEqual(result.buddies.length, 1);
  strictEqual(result.buddies[0]!.toKey, result.volunteers[1]!.key);
  strictEqual(result.buddies[0]!.via, 'numéro de téléphone');
});

test('a name alone still resolves, since most people will answer with one', () => {
  const result = importPair('Bob Durand');
  strictEqual(result.buddies[0]!.via, 'nom complet');
  strictEqual(result.buddies[0]!.toKey, result.volunteers[1]!.key);
});

test('an address matching nobody says the friend never registered, once', () => {
  const result = importPair('Chloé Petit, chloe@example.org, 06 99 88 77 66');
  const raised = result.issues.filter((i) => i.code.startsWith('binome'));

  strictEqual(raised.length, 1, 'un seul signalement, pas un par fragment');
  strictEqual(raised[0]!.code, 'binome-non-inscrit');
  ok(raised[0]!.message.includes('chloe@example.org'));
  // The request is kept, unresolved: the régisseur may still recognise the person.
  strictEqual(result.buddies.length, 1);
  strictEqual(result.buddies[0]!.toKey, null);
});

test('an unreadable name with nothing else is still an unresolved request', () => {
  const result = importPair('la grande blonde du bar');
  const raised = result.issues.filter((i) => i.code.startsWith('binome'));

  strictEqual(raised.length, 1);
  strictEqual(raised[0]!.code, 'binome-non-resolu');
});

test('two friends named in one box are two requests', () => {
  const result = importPair('Bob Durand et Chloé Petit');
  strictEqual(result.buddies.length, 2);
  strictEqual(result.buddies[0]!.toKey, result.volunteers[1]!.key);
  strictEqual(result.buddies[1]!.toKey, null, 'Chloé ne s\'est pas inscrite');
});

test('a comma splits two names only when both of them are somebody', () => {
  // The comma is ambiguous by construction: it separates the details of one person in the
  // answer the form asks for, and two people in the answer some will give. So the whole string
  // is tried first, the pieces only afterwards, and the pieces are taken all or nothing. Here
  // Chloé never registered, so this stays one request the régisseur reads in full rather than
  // one pairing plus a warning about a name that may not even be a name.
  const result = importPair('Bob Durand, Chloé Petit');

  strictEqual(result.buddies.length, 1);
  strictEqual(result.buddies[0]!.toKey, null);
  strictEqual(result.buddies[0]!.rawName, 'Bob Durand, Chloé Petit');
  strictEqual(result.issues.filter((i) => i.code.startsWith('binome')).length, 1);
});

test('citing oneself is still ignored rather than paired', () => {
  const result = importPair('Alice Martin');
  strictEqual(result.buddies.length, 0);
  ok(result.issues.some((i) => i.code === 'binome-soi-meme'));
});

test('an empty answer asks for nothing', () => {
  const result = importPair('');
  deepStrictEqual(result.volunteers[0]!.buddyRawNames, []);
  strictEqual(result.buddies.length, 0);
});

test('a comma does split two names when both of them registered', () => {
  // The other half of the all-or-nothing rule: Chloé is in the file this time, so the answer is
  // two requests rather than one line for the manual pass.
  const result = importPair('Bob Durand, Chloé Petit', {}, true);
  const asked = result.buddies.filter((b) => b.fromKey === result.volunteers[0]!.key);

  strictEqual(asked.length, 2);
  deepStrictEqual(
    asked.map((b) => b.toKey),
    [result.volunteers[1]!.key, result.volunteers[2]!.key],
  );
  deepStrictEqual(result.issues.filter((i) => i.code.startsWith('binome')), []);
});

test('what the generator writes is the real export, header for header', () => {
  // Two copies on purpose, and this is what keeps them honest. REAL_HEADERS above is a verbatim
  // transcription of the export, kept as evidence; FORM_COLUMNS is what the generator writes so
  // that a rehearsal on generated data meets the same forty columns, decoys included. Neither is
  // derived from the other, so a drift in either shows up here rather than in October.
  deepStrictEqual([...FORM_COLUMNS], [...REAL_HEADERS]);
});

// ---------------------------------------------------------------------------
// Le fichier de contacts qui porte les codes vers l'outil d'envoi
// ---------------------------------------------------------------------------

test('the contact file carries one row per address, with the code that belongs to it', () => {
  const plan = planWith([
    { key: 'a', firstName: 'Marie', lastName: 'Perrin', email: 'marie@example.org', accessCode: 'AB12CD' },
    { key: 'b', firstName: 'Jean', lastName: 'Martin', email: 'jean@example.org', accessCode: 'EF34GH' },
  ], [{ volunteerKey: 'a', shiftKey: 's1' }, { volunteerKey: 'a', shiftKey: 's2' }]);

  const out = brevoContactsCsv(plan);
  const lines = out.csv.trim().split('\r\n');

  // The header IS the attribute name in a contact import, so it is uppercase and unaccented.
  strictEqual(lines[0]?.replace('﻿', ''), 'EMAIL,PRENOM,NOM,CODE_ACCES,CRENEAUX');
  strictEqual(lines[1], 'marie@example.org,Marie,Perrin,AB12CD,2');
  strictEqual(lines[2], 'jean@example.org,Jean,Martin,EF34GH,0');
  strictEqual(out.sent, 2);
});

test('somebody with no address is named, never quietly left out of the mailing', () => {
  const plan = planWith([
    { key: 'a', firstName: 'Marie', lastName: 'Perrin', email: 'marie@example.org', accessCode: 'AB12CD' },
    { key: 'b', firstName: 'Jean', lastName: 'Martin', email: '', accessCode: 'EF34GH' },
  ]);

  const out = brevoContactsCsv(plan);

  strictEqual(out.sent, 1);
  // Their code exists and is on the printed sheet; what they cannot receive is the mail. Said
  // out loud, or somebody turns up on the night having never been told anything.
  deepStrictEqual(out.withoutEmail, ['Jean Martin']);
});

test('two people behind one address is reported, because the tool would send one code twice', () => {
  // A contact import keys on the address, so the second row overwrites the first one's code and
  // one of the two would then open somebody else's schedule.
  const plan = planWith([
    { key: 'a', firstName: 'Marie', lastName: 'Perrin', email: 'famille@example.org', accessCode: 'AB12CD' },
    { key: 'b', firstName: 'Paul', lastName: 'Perrin', email: 'Famille@example.org', accessCode: 'EF34GH' },
  ]);

  const out = brevoContactsCsv(plan);

  strictEqual(out.sent, 2, 'les deux restent dans le fichier');
  deepStrictEqual(out.sharedEmails, ['famille@example.org'], 'la casse ne les sépare pas');
});

test('a name carrying a comma stays one field', () => {
  const plan = planWith([
    { key: 'a', firstName: 'Anne', lastName: 'Dupont, dite Nana', email: 'anne@example.org', accessCode: 'AB12CD' },
  ]);

  ok(brevoContactsCsv(plan).csv.includes('"Dupont, dite Nana"'));
});

// ---------------------------------------------------------------------------
// Another event's form, read through a correspondence (2026-09-14)
// ---------------------------------------------------------------------------

/** A form that is not the Loto Tekno's: other headers, three ranked choices, one checkbox column. */
const OTHER_HEADERS = [
  'Timestamp', 'Mail', 'Nom de famille', 'Prénom usuel', 'Heures par jour',
  'Pôle souhaité n°1', 'Pôle souhaité n°2', 'Pôle souhaité n°3', 'Aisance n°1', 'Pôles possibles',
];

function otherCsv(rows: string[][]): string {
  const quote = (v: string) => (/["\n,]/.test(v) ? `"${v.split('"').join('""')}"` : v);
  return [OTHER_HEADERS, ...rows].map((r) => r.map(quote).join(',')).join('\n');
}

const barPath = poles.find((p) => p.parentKey === null)!.path;
const secondPath = poles.filter((p) => p.parentKey === null)[1]!.path;
const thirdPath = poles.filter((p) => p.parentKey === null)[2]!.path;

test('a remembered correspondence binds columns the detection would never find', () => {
  const mapping = {
    columns: { lastName: 'Nom de famille', firstName: 'Prénom usuel', email: 'Mail', volume: 'Heures par jour' },
    choices: [
      { pole: 'Pôle souhaité n°1', level: 'Aisance n°1' },
      { pole: 'Pôle souhaité n°2', level: null },
      { pole: 'Pôle souhaité n°3', level: null },
    ],
    answers: { volume: { 'tranquille': 3 }, level: { 'a l aise': 'expert' as const } },
  };
  const csv = otherCsv([['1', 'a@b.fr', 'Durand', 'Zoé', 'Tranquille', barPath, secondPath, thirdPath, 'À l’aise', '']]);
  const result = importVolunteers(csv, { poles, artists, startISO: EVENT_START_ISO, mapping });
  const zoe = result.volunteers[0]!;
  strictEqual(zoe.requestedHours, 3);
  deepStrictEqual(zoe.choices.map((c) => c.raw), [barPath, secondPath, thirdPath]);
  strictEqual(zoe.choices[0]!.level, 'expert');
  ok(!result.issues.some((i) => i.severity === 'error'), JSON.stringify(result.issues));
});

test('a checkbox column of poles becomes several choices, in the order ticked', () => {
  const mapping = {
    columns: { lastName: 'Nom de famille', firstName: 'Prénom usuel' },
    choices: [{ pole: 'Pôles possibles', level: null }],
    answers: {},
  };
  const csv = otherCsv([['1', '', 'Durand', 'Zoé', '', '', '', '', '', `${secondPath}, ${barPath}`]]);
  const zoe = importVolunteers(csv, { poles, artists, startISO: EVENT_START_ISO, mapping }).volunteers[0]!;
  strictEqual(zoe.choices.length, 2);
  deepStrictEqual(zoe.choices.map((c) => c.raw), [secondPath, barPath]);
  ok(zoe.choices.every((c) => c.poleKey !== ''));
});

test('an answer mapped to a pole is that pole, emoji and all; a header gone is said, not silent', () => {
  const pole = poles.find((p) => p.parentKey === null)!;
  const mapping = {
    columns: { lastName: 'Nom de famille', firstName: 'Prénom usuel', volume: 'Une question retirée' },
    choices: [{ pole: 'Pôle souhaité n°1', level: null }],
    answers: { pole: { 'bar fix': pole.key } },
  };
  const csv = otherCsv([['1', '', 'Durand', 'Zoé', '', '🍻 BAR fix', '', '', '', '']]);
  const result = importVolunteers(csv, { poles, artists, startISO: EVENT_START_ISO, mapping });
  strictEqual(result.volunteers[0]!.choices[0]!.poleKey, pole.key);
  ok(result.issues.some((i) => i.code === 'colonne-memorisee-absente'));
});

test('the survey lists each distinct closed answer once, with the automatic reading beside it', () => {
  const survey = surveyForm(rowCsv() + rowCsv({ 3: 'Bob' }).slice(rowCsv().lastIndexOf('\n')), { poles, artists, startISO: EVENT_START_ISO });
  strictEqual(survey.rows, 2);
  const level = survey.answers.level.find((a) => a.answer === 'Habitué')!;
  strictEqual(level.count, 2);
  deepStrictEqual(level.auto, { value: 'expert' });
  strictEqual(survey.answers.volume[0]!.auto?.value, 4);
  strictEqual(bindForm(REAL_HEADERS).choices.length, 2, 'le formulaire du Loto Tekno garde ses deux choix');
});

test('the reinforcement and stamina answers of a festival form are read', async () => {
  const { parseBackup, parseEnergy } = await import('./import.js');
  strictEqual(parseBackup(''), undefined);
  strictEqual(parseBackup("Je viens en renfort si mon emploi du temps bénévole me le permet, J'aide le responsable"), true);
  strictEqual(parseBackup("Rien à faire c'est pas mon problème !"), false);
  strictEqual(parseEnergy('Je fonce, je donne tout, et je dormirai demain.'), 'fonce');
  strictEqual(parseEnergy("Je maîtrise mon temps, j'ai plutôt l'habitude."), 'regulier');
  strictEqual(parseEnergy("Je fonce, je donne tout, et je dormirai demain., J'ai parfois du mal à me poser et j'ai tendance à fatiguer vite."), 'fatigable');
  strictEqual(parseEnergy("Je ne sais pas, c'est une première."), 'premiere');
});

test('the night question of a festival form refuses, avoids or accepts one tranche', async () => {
  const { parseSlotComfort } = await import('./import.js');
  const slots = [{ id: 'jour', label: 'Journée', start: 0, end: 12 }, { id: 'nuit', label: 'Nuit', start: 12, end: 18 }];
  const q = 'Peux-tu faire des shifts de nuit ? (entre 3h et 7h)';
  deepStrictEqual(parseSlotComfort(q, 'Oui', slots), { refused: [], avoided: [] });
  deepStrictEqual(parseSlotComfort(q, 'Oui mais je préfère ne pas en faire si possible', slots), { refused: [], avoided: ['nuit'] });
  deepStrictEqual(parseSlotComfort(q, 'Non je ne peux pas', slots), { refused: ['nuit'], avoided: [] });
  strictEqual(parseSlotComfort(q, '', slots), null);
  strictEqual(parseSlotComfort('Peux-tu venir tôt ?', 'Non je ne peux pas', slots), 'inconnu');
});

test('competences are read by whole words, and a yes names the competence of its question', async () => {
  const { parseSkills, parseSkillCheck } = await import('./import.js');
  const tags = [{ key: 'permis-b', label: 'Permis B' }, { key: 'caces', label: 'CACES' }, { key: 'bricolage', label: 'Bricolage' }];
  deepStrictEqual(parseSkills('Permis B, CACES 3 et électricien', tags), ['permis-b', 'caces']);
  deepStrictEqual(parseSkills('permis poids lourd', tags), []);
  deepStrictEqual(parseSkillCheck('Est-ce que tu as des compétences en bricolage ?', 'Oui', tags), ['bricolage']);
  deepStrictEqual(parseSkillCheck('Est-ce que tu as des compétences en bricolage ?', 'Un peu', tags), []);
});
