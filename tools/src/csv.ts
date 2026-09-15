/**
 * CSV writing, and the Google Form column mapping.
 *
 * THIS FILE IS THE ADJUSTMENT POINT. When the real Google Form exists, its export headers land
 * here and nowhere else. Everything downstream works on the domain types in model.ts, so a
 * reworded question is a one-line change in FORM_COLUMNS plus its value labels below.
 */

import type { Artist, Pole, Shift, SkillLevel, Volunteer } from './model.js';
import {
  DEFAULT_SLOTS, statusOf, toLabel } from './model.js';
import type { Plan } from './plan.js';

function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeField).join(','));
  // A BOM, because the régisseur will open these in Excel and expects the accents to survive.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Value labels, exactly as the form will present them
// ---------------------------------------------------------------------------

/**
 * The wording of "Qu'est ce que tu préfères ?", which is a preference and not a window.
 *
 * The real form's three answers, keyed by the id of the slot each one names in DEFAULT_SLOTS.
 * A preference for a slot the form has no sentence for is written as the slot's own label, the
 * way a refusal is, and the importer reads it back the same way.
 */
const PREFERENCE_ANSWER = new Map<string, string>([
  ['loto', 'Travailler pendant le loto'],
  ['concerts', 'Travailler pendant les concerts'],
]);
const NO_PREFERENCE = 'Peux importe';

/** The form's own three words. It never says "expert"; the third level is "Habitué". */
const LEVEL_LABEL: Record<SkillLevel, string> = {
  debutant: 'Débutant',
  intermediaire: 'Intermédiaire',
  expert: 'Habitué',
};

/**
 * The volume answers, word for word, because not one of them is a number.
 *
 * "2 h de plus" means six hours and "4 h de plus" means eight, so a parser reaching for the
 * first digit reads the first as two and the second as four: one unreadable, one silently
 * wrong. Generating the real sentences is what keeps the importer's parser honest.
 */
const VOLUME_LABEL: Record<number, string> = {
  4: 'Je préfère rester sur un seul créneau de 4 h. 😊',
  6: 'Je veux bien donner un coup de main 2 h de plus, ça ne me fait pas peur ! 💪',
  8: 'Je suis partant·e pour 4 h de plus, j\'ai l\'habitude ! 💪💪',
};

/** The slots as the closed question offers them: by label, which is what the form shows. */
const SLOT_LABEL = new Map(DEFAULT_SLOTS.map((slot) => [slot.id, slot.label]));

const NO_SLOT_REFUSED = 'Aucune, tout me va !';
const NO_POLE_REFUSED = 'Tout me va';

/**
 * THE REAL FORM'S HEADERS, copied from the export on 2026-09-08, in the order it writes them.
 *
 * They used to be invented, which was the whole problem: `bindColumns` was measured against
 * these, passed, and then bound two columns wrongly against the actual export, one of them
 * reading a bar quiz answer as somebody's hours. A fixture written in the tool's own imagined
 * words tests nothing about the file the régisseur will really drop in.
 *
 * ALL FORTY ARE GENERATED, including the twenty-five this tool has no use for. It held the
 * useful fifteen until 2026-09-08, and that was not enough: three of the twenty-five are the
 * decoys that each stole a real column the first time the binder met the actual file, so a
 * rehearsal on generated data exercised none of the matchers that were tightened because of
 * them. `import.test.ts` keeps its own verbatim transcription and asserts the two are identical,
 * so neither copy can drift while they stay independent.
 */
export const FORM_COLUMNS = [
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
] as const;

export interface FormRowContext {
  polePathByKey: Map<string, string>;
  artistNameByKey: Map<string, string>;
  /** Submission timestamp, already formatted the way Google Forms exports it. */
  submittedAt: string;
  /**
   * Contact details by "Prénom Nom", for the buddy question.
   *
   * The form asks for "son nom, prénom, mail et numéro de téléphone" in one box, so a realistic
   * answer carries all four, and the importer resolves it by the mail address before it ever
   * looks at the name. Generating name-only answers would have left that path untested by
   * everything except a unit test.
   */
  contactByName: Map<string, { email: string; phone: string }>;
}

/**
 * A stable pseudo-random bit, derived from the text itself.
 *
 * Real answers are uneven: some people paste all four details, some write a first name. This
 * varies the shape without a generator seed, so the same volunteer always produces the same row
 * and a regenerated fixture stays comparable to the last one.
 */
function coin(text: string, ratio: number): boolean {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return (hash % 100) / 100 < ratio;
}

/** The safety quiz, whose answers matter only because one of them looks like a volume. */
const QUIZ = [
  'Je préviens un responsable et je ne le déplace pas.',
  "J'alerte le responsable sécurité et je m'écarte.",
  'Je propose un coup de main sans juger.',
  'Je préviens immédiatement un responsable ou la sécurité.',
  "Je propose de dépanner si je peux, sinon je le signale.",
];

/**
 * One row of the real export, all forty columns.
 *
 * THE TWENTY-FIVE COLUMNS THIS TOOL IGNORES ARE GENERATED TOO, and that is the point. Three of
 * them are decoys that each stole a real column the first time `bindColumns` met the actual
 * export: a surname question that also says "préfères", a bar quiz that also says "combien", an
 * emergency contact that also asks for a phone number. A fixture without them exercises none of
 * the matchers that were tightened because of them, so a rehearsal on generated data would prove
 * something weaker than the real thing.
 */
/**
 * What somebody answered about the montage and the démontage, in their own words.
 *
 * Five shapes on purpose, because the importer has to survive all of them: a bare yes (both
 * phases), each phase named on its own, a sentence that names one while refusing the other, and
 * the plain no that most people give.
 */
function phaseAnswer(seed: string): string {
  if (!coin(`phase${seed}`, 0.34)) return 'Non';
  if (coin(`phaseBoth${seed}`, 0.3)) return 'Oui';
  if (coin(`phaseMontage${seed}`, 0.55)) {
    return coin(`phaseWord${seed}`, 0.5)
      ? 'Oui, pour le montage'
      : 'Je peux venir aider au montage, pas au démontage';
  }
  return coin(`phaseWord${seed}`, 0.5)
    ? 'Oui, pour le démontage'
    : 'Dispo pour le démontage le lendemain';
}

export function volunteerToFormRow(v: Volunteer, ctx: FormRowContext): string[] {
  const pole = (key: string | null): string => (key ? ctx.polePathByKey.get(key) ?? key : '');
  const seed = `${v.firstName} ${v.lastName}`;

  /** The buddy answer, in the shape the question asks for: name, mail, phone in one box. */
  const buddyAnswer = (typed: string): string => {
    const contact = ctx.contactByName.get(typed);
    // No contact means the name was mistyped, which is exactly when somebody would not have had
    // the address to hand either.
    if (!contact || !coin(typed, 0.7)) return typed;
    return `${typed}, ${contact.email}, ${contact.phone}`;
  };

  const row = new Array<string>(FORM_COLUMNS.length).fill('');
  const set = (index: number, value: string): void => {
    row[index] = value;
  };

  set(0, ctx.submittedAt);
  set(1, v.email);
  set(2, v.lastName);
  set(3, v.firstName);
  // "Surnom (si tu préfères qu'on t'appelle par celui-ci)". It says "préfères" and it used to
  // swallow the preference question, which is why that matcher is anchored the way it is. Read
  // for real since 2026-09-09, so what goes out here is what the generator put on the person.
  set(4, v.nickname);
  set(5, coin(seed, 0.5) ? '12/04/1996' : '03/11/2001');
  set(6, '12 rue des Lilas, 44000 Nantes');
  set(7, v.phone);
  set(8, coin(`handicap${seed}`, 0.05) ? 'Rien de particulier' : 'Non');
  set(9, 'Non');
  // DECOY: the emergency contact also asks for a phone number, and it used to swallow the real
  // one. Its answer looks exactly like a phone answer.
  set(10, `Dupont Claude, 06 ${coin(seed, 0.5) ? '11 22 33 44' : '55 66 77 88'}`);
  // Two columns that stopped being decoys on 2026-09-12: the importer reads them into
  // `Volunteer.diet` and `Volunteer.allergies`, so a generated export has to carry the answer
  // the person actually has rather than a fresh coin toss, or a round trip through this file
  // would change somebody's plate every time it ran.
  set(11, v.diet);
  set(12, v.allergies);
  set(13, 'Oui');
  set(14, 'Oui');
  set(15, '');
  set(16, 'Oui');
  set(17, coin(`deja${seed}`, 0.4) ? 'Oui' : 'Non');
  set(18, '');
  set(19, VOLUME_LABEL[v.requestedHours] ?? `${v.requestedHours}h`);
  // The Loto Tekno form asks for exactly two choices; a volunteer with more is written with its
  // first two, and one with fewer leaves the column empty, the way a skipped question exports.
  const choice = (i: number) => v.choices[i];
  set(20, choice(0) ? (choice(0)!.raw !== '' ? choice(0)!.raw : pole(choice(0)!.poleKey)) : '');
  set(21, choice(0) ? LEVEL_LABEL[choice(0)!.level] : '');
  set(22, choice(1) ? (choice(1)!.raw !== '' ? choice(1)!.raw : pole(choice(1)!.poleKey)) : '');
  set(23, choice(1) ? LEVEL_LABEL[choice(1)!.level] : '');
  // A checkbox question, so several answers come back separated by commas. Not one of the
  // nine pole labels contains a comma, which is what makes that separator safe to split on.
  set(24, v.refusedPoleKeys.length > 0 ? v.refusedPoleKeys.map(pole).join(', ') : NO_POLE_REFUSED);
  /*
   * THE TWO TIME QUESTIONS, and the real form has both since 2026-09-10.
   *
   * 25 is the old closed one, still there, still offering the slots as labels. 42 is the new
   * "impératif horaire", which is a sentence. Somebody who wrote a sentence generally did not
   * also tick the list, and the other way round, so this writes one or the other: a fixture
   * where every row answers both would never exercise either path on its own.
   */
  const slotLabels = v.refusedSlotIds.map((id) => SLOT_LABEL.get(id) ?? id).join(', ');
  set(25, v.availabilityNote.trim() === '' && slotLabels !== '' ? slotLabels : NO_SLOT_REFUSED);
  set(26, v.preferredSlotId === null
    ? NO_PREFERENCE
    : (PREFERENCE_ANSWER.get(v.preferredSlotId) ?? SLOT_LABEL.get(v.preferredSlotId) ?? v.preferredSlotId));
  set(27, v.artistKeys.map((k) => ctx.artistNameByKey.get(k) ?? k).join(', '));
  set(28, "J'ai lu et j'accepte");
  // Each mention can itself contain commas, so several friends are separated by "et", which is
  // both what somebody would write and a separator the importer treats as one.
  set(29, v.buddyRawNames.map(buddyAnswer).join(' et '));
  // 42: "Si tu as un impératif horaire stricte pendant l'exploitation, précise le ici".
  set(42, v.availabilityNote);
  set(30, '');
  set(31, coin(`taille${seed}`, 0.5) ? 'M' : 'L');
  // DECOY: "Combien faut-il de personnes pour déplacer un fût de 30 litres de bière ?" It says
  // "combien" and its answers carry a digit, and it used to be read as somebody's hours.
  set(32, coin(`fut${seed}`, 0.6) ? '2 personnes' : '1 personne suffit');
  for (let i = 0; i < QUIZ.length; i++) set(33 + i, QUIZ[i]!);
  set(38, 'Je le dis à mon responsable de pôle.');
  set(39, `${v.firstName} ${v.lastName}`);
  /*
   * 43: "Serais tu prêt à faire du montage / démontage ?"
   *
   * ONE QUESTION FOR BOTH PHASES, which is how the real form asks it, so the answers name the
   * phase they mean and the importer reads each one for its own phase. Roughly a third say yes
   * to something, which is about what a setup crew actually gets.
   *
   * DRAWN FROM THE NAME AND NOT FROM `rng`, like the surname and the shirt size above it.
   * Taking a number from the generator here would shift every later draw and rewrite every
   * scenario the fixtures and the measurements rest on.
   */
  set(43, phaseAnswer(seed));

  return row;
}

// ---------------------------------------------------------------------------
// The régisseur's own tables, which the tool imports rather than the form
// ---------------------------------------------------------------------------

export const POLE_COLUMNS = [
  'Pôle', 'Sous-pôle', 'Autoriser un créneau 100% débutants', 'Minimum de non-débutants',
] as const;

export function polesToCsv(poles: readonly Pole[]): string {
  const rows = poles.map((p) => [
    p.parentKey ? (poles.find((q) => q.key === p.parentKey)?.name ?? '') : p.name,
    p.parentKey ? p.name : '',
    p.allowAllDebutants ? 'oui' : 'non',
    String(p.minExperienced),
  ]);
  return toCsv(POLE_COLUMNS, rows);
}

export const SHIFT_COLUMNS = [
  'Pôle', 'Début', 'Fin', 'Durée (h)', 'Bénévoles nécessaires',
] as const;

export function shiftsToCsv(
  shifts: readonly Shift[],
  polePathByKey: Map<string, string>,
  startISO: string,
): string {
  const rows = [...shifts]
    .sort((a, b) => a.start - b.start || (polePathByKey.get(a.poleKey) ?? '').localeCompare(polePathByKey.get(b.poleKey) ?? ''))
    .map((s) => [
      polePathByKey.get(s.poleKey) ?? s.poleKey,
      toLabel(startISO, s.start),
      toLabel(startISO, s.end),
      String(s.end - s.start),
      String(s.headcount),
    ]);
  return toCsv(SHIFT_COLUMNS, rows);
}

export const ARTIST_COLUMNS = ['Artiste', 'Début', 'Fin'] as const;

export function artistsToCsv(artists: readonly Artist[], startISO: string): string {
  const rows = artists.map((a) => [
    a.name,
    toLabel(startISO, a.start),
    toLabel(startISO, a.end),
  ]);
  return toCsv(ARTIST_COLUMNS, rows);
}

/**
 * Access codes are generated by the tool, never typed into the form. This file is what the
 * régisseur would mail-merge from, and it is the only place the codes and the identities sit
 * side by side.
 */
export const CODE_COLUMNS = ['Prénom', 'Nom', 'Adresse e-mail', 'Code d\'accès'] as const;

export function codesToCsv(volunteers: readonly Volunteer[]): string {
  const rows = volunteers.map((v) => [v.firstName, v.lastName, v.email, v.accessCode]);
  return toCsv(CODE_COLUMNS, rows);
}

// ---------------------------------------------------------------------------
// The contact file that carries the codes out to the mailing tool
// ---------------------------------------------------------------------------

/**
 * Brevo attribute names, not French labels, and that is the whole difference from CODE_COLUMNS
 * above.
 *
 * A contact import matches its header against the attributes of the contact list, so the header
 * IS the attribute name: uppercase, unaccented, no spaces. "Prénom" would ask Brevo for an
 * attribute nobody has. EMAIL is the identity Brevo deduplicates on, so it comes first and is
 * never empty.
 *
 * CRENEAUX is here for one reason: somebody with no shift must not receive "voici ton planning".
 * A number in the file lets the mailing be split in two without going back to the tool.
 */
export const BREVO_COLUMNS = ['EMAIL', 'PRENOM', 'NOM', 'CODE_ACCES', 'CRENEAUX'] as const;

export interface BrevoExport {
  csv: string;
  /** How many contacts the file carries. */
  sent: number;
  /**
   * People left out because they gave no mail address, by name.
   *
   * NAMED, NEVER JUST COUNTED. Their code exists and is on the printed sheets; what they cannot
   * receive is the mail. Leaving them out silently would mean somebody turns up on the night
   * having never been told anything.
   */
  withoutEmail: string[];
  /**
   * Addresses shared by several people, by address.
   *
   * Brevo keys a contact on its mail address, so two volunteers sharing one become one contact,
   * and the second import row overwrites the first one's code. One of the two would then receive
   * a code that is not theirs and see somebody else's shifts. Rare, real, and silent unless it
   * is said here.
   */
  sharedEmails: string[];
  /** Cancelled bénévoles left out, by name: nobody mails a code to somebody who is not coming. */
  cancelled: string[];
}

/**
 * The contact file for the mailing tool: who, and which code is theirs.
 *
 * The codes are generated by this tool and never typed into the form, so this file is the only
 * bridge between an identity and a code. It carries no shift, no pole and no phone number: what
 * the volunteer needs is the code, and the schedule is behind it, always current, rather than
 * frozen into an email sent three weeks earlier.
 */
export function brevoContactsCsv(plan: Plan): BrevoExport {
  const shifts = new Map<string, number>();
  for (const assignment of plan.assignments) {
    shifts.set(assignment.volunteerKey, (shifts.get(assignment.volunteerKey) ?? 0) + 1);
  }

  const withoutEmail: string[] = [];
  const cancelled: string[] = [];
  const seen = new Map<string, number>();
  const rows: string[][] = [];

  for (const v of plan.volunteers) {
    if (statusOf(v) === 'annule') {
      cancelled.push(`${v.firstName} ${v.lastName}`.trim());
      continue;
    }
    const email = v.email.trim();
    if (email === '') {
      withoutEmail.push(`${v.firstName} ${v.lastName}`.trim());
      continue;
    }
    const key = email.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
    rows.push([
      email,
      v.firstName,
      v.lastName,
      v.accessCode,
      String(shifts.get(v.key) ?? 0),
    ]);
  }

  return {
    csv: toCsv(BREVO_COLUMNS, rows),
    sent: rows.length,
    withoutEmail,
    cancelled,
    sharedEmails: [...seen.entries()].filter(([, count]) => count > 1).map(([email]) => email),
  };
}
