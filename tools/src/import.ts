/**
 * CSV import: the Google Form export becomes domain objects, plus a list of everything the
 * régisseur has to look at by hand.
 *
 * Two deliberate choices here.
 *
 * Columns are bound by keyword, not by exact header text. The real form does not exist yet, and
 * even once it does, a reworded question must not break the import. If a required column cannot
 * be bound, the import says so instead of silently producing empty answers.
 *
 * Nothing is ever dropped. A row with contradictory answers is imported and flagged, because the
 * régisseur's process is to phone the person, not to lose them.
 */

import {
  DEFAULT_PREFERENCE_SLOTS,
  DEFAULT_RULES,
  DEFAULT_SLOTS,
  type Artist,
  type EventSlot,
  type PoleChoice,
  type PreferenceSlot,
  type SchedulingRules,
  type Pole,
  type SkillLevel,
  type SlotId,
  type Volunteer,
} from './model.js';
import {
  maxAchievableHours,
  refusedWindows,
  usableWindows,
} from './availability.js';
import { parseAvailabilityNote, parsePhaseAnswer, parsePoleAnswer, type AnswerReading } from './answers.js';
import { resolveConstraints, type ConstraintSettings } from './constraints.js';
import { DEFAULT_VOLUME, eventDays, type VolumeSettings } from './days.js';
import {
  EMPTY_FORM_MAPPING,
  type AnswerKind,
  type AnswerMaps,
  type FormMapping,
  type MappedField,
} from './form-mapping.js';
import { NICKNAMES } from './names.js';
import { matchPerson, normalise, type MatchCandidate } from './text.js';

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/** RFC 4180 with the usual tolerances: BOM, CRLF or LF, quotes doubled inside quotes. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// ---------------------------------------------------------------------------
// Column binding
// ---------------------------------------------------------------------------

const FIELDS = [
  'submittedAt', 'firstName', 'lastName', 'nickname', 'email', 'phone', 'halfPreference',
  'refusedSlotChoice',
  'availabilityNote',
  'volume', 'choice1Pole', 'choice1Level', 'choice2Pole', 'choice2Level', 'refusedPoles',
  'artist', 'buddies',
  // What the caterer reads. Both optional: the questions have been in the form since the first
  // export and were thrown away until 2026-09-12, and a form that stops asking them must keep
  // importing.
  'diet', 'allergies',
  // The montage and the démontage. `phaseHelp` is the question the real form already asks,
  // which covers both at once; the two others exist for the day it asks them separately.
  // All three optional: an export without any of them must keep importing.
  'phaseHelp', 'montage', 'demontage',
] as const;

export type FormField = (typeof FIELDS)[number];

/**
 * REWRITTEN 2026-09-08 AGAINST THE REAL EXPORT'S 40 HEADERS. The previous set was written
 * against headers this tool had invented, and against the real file it found none of the six
 * scheduling columns and bound two of them to the wrong question entirely: the volume matcher
 * /combien|heures/ landed on "Combien faut-il de personnes pour déplacer un fût de 30 litres de
 * bière ?", and the pole matcher then took the volume question. A wrong binding is worse than a
 * missing one, because a missing column stops the import and a wrong one quietly reads a bar
 * quiz answer as somebody's hours. Hence `unreadableColumn` below, which refuses a column that
 * never once parses.
 *
 * Every test here is anchored on wording the form actually uses, and several are anchored
 * tightly on purpose:
 *   - "ce que tu preferes" and not "prefere", which also appears in "Surnom (si tu préfères
 *     qu'on t'appelle par celui-ci)" seven columns earlier. That column stopped being a decoy on
 *     2026-09-09 and is now read into `nickname`, so it is taken before the preference matcher
 *     ever looks at it; the tight anchor stays, because the day the form rewords the surname
 *     question is not the day to discover the preference matcher was relying on it.
 *   - "demandons a chaque benevole" for the volume, which is the only phrase separating the
 *     real question from the fût of beer.
 *   - the two choices carry no digit in this form: they are "choix principal" and "deuxième
 *     choix", and their two level questions repeat those words, so the level tests run first.
 *
 * Ordered on purpose. Anything narrow runs before anything general, so a broad matcher can only
 * ever take a column its narrower neighbours have already refused.
 */
const MATCHERS: Array<{ field: FormField; test: (h: string) => boolean; required: boolean }> = [
  { field: 'submittedAt', test: (h) => /horodat|timestamp/.test(h), required: false },
  { field: 'lastName',    test: (h) => /^nom$/.test(h), required: true },
  { field: 'firstName',   test: (h) => /^prenom$/.test(h), required: true },
  { field: 'nickname',    test: (h) => /^surnom/.test(h), required: false },
  { field: 'email',       test: (h) => /^adresse e mail$|^e mail$|^mail$/.test(h), required: false },
  { field: 'phone',       test: (h) => /^numero de telephone/.test(h), required: false },
  { field: 'choice1Level', test: (h) => /niveau/.test(h) && /choix principal|choix 1/.test(h), required: true },
  { field: 'choice2Level', test: (h) => /niveau/.test(h) && /deuxieme choix|choix 2/.test(h), required: true },
  { field: 'choice1Pole',  test: (h) => /choix principal|choix 1/.test(h), required: true },
  { field: 'choice2Pole',  test: (h) => /deuxieme choix|choix 2/.test(h), required: true },
  { field: 'refusedPoles', test: (h) => /poste|pole/.test(h) && /pas faire|pas travailler sur/.test(h), required: true },
  /*
   * TWO TIME QUESTIONS SINCE 2026-09-10, AND THE FORM KEPT BOTH. Column 25 is still the old
   * closed one, word for word; column 42 is new and asks for a sentence. They are bound
   * separately and read separately, and the refusals of each are merged: answering either is
   * an answer, and answering both is a person saying the same thing twice.
   *
   * Anchored on the phrase that belongs to each and to nothing else in the forty-four. The
   * broad matcher these replace would have taken column 25 for both and never read 42.
   */
  { field: 'refusedSlotChoice', test: (h) => /ne veux peux absolument pas travailler/.test(h), required: false },
  { field: 'availabilityNote', test: (h) => /imperatif horaire/.test(h), required: false },
  { field: 'halfPreference', test: (h) => /ce que tu preferes|prefereriez vous/.test(h), required: true },
  { field: 'volume',      test: (h) => /demandons a chaque benevole|heures de benevolat souhaitez/.test(h), required: true },
  /*
   * THE REAL FORM ASKS THIS ONCE, FOR BOTH PHASES, at column 43: "Serais-tu prêt à faire du
   * montage / démontage les jours avant / après l'événement ?". So the question naming both is
   * matched first and answers for both; the two narrow matchers under it are what reads a form
   * that has since split the question in two, and take nothing at all today.
   *
   * This column used to be a decoy, and a dangerous one: the broad time matcher that preceded
   * `availabilityNote` would have taken it and read "oui, je peux aider au montage" as a
   * refusal of a créneau. It is bound on purpose now, and never by a time matcher.
   */
  { field: 'phaseHelp',   test: (h) => /montage/.test(h) && /demontage/.test(h), required: false },
  { field: 'demontage',   test: (h) => /demontage/.test(h), required: false },
  { field: 'montage',     test: (h) => /montage/.test(h), required: false },
  /*
   * THE ALLERGY BEFORE THE DIET, and that order is the whole of the care needed here. It is the
   * same pair of matchers the orgas' form uses, for the same reason, written down in
   * `import-organisers.ts`: a form asking about both in one sentence is asking about allergies,
   * and the diet matcher is the broader of the two. Binding them the wrong way round puts an
   * allergy in the column a caterer reads as a preference, which is the kind of mistake that
   * ends in somebody at a hospital rather than at a table.
   */
  { field: 'allergies',   test: (h) => /allerg|intoleran/.test(h), required: false },
  { field: 'diet',        test: (h) => /regime|alimentaire|vegetarien|vegan/.test(h), required: false },
  { field: 'artist',      test: (h) => /artiste/.test(h), required: false },
  { field: 'buddies',     test: (h) => /avec un e ami|avec qui|ensemble|binome/.test(h), required: false },
];

export type ColumnMap = Partial<Record<FormField, number>>;

export function bindColumns(headers: readonly string[]): { map: ColumnMap; missing: FormField[] } {
  const normalised = headers.map(normalise);
  const map: ColumnMap = {};
  const used = new Set<number>();
  const missing: FormField[] = [];

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

/** The columns actually used for one import: the mapping's, then the automatic detection's. */
export interface FormBinding {
  map: ColumnMap;
  /** The pole choice columns, in rank order, each with its level column when there is one. */
  choices: Array<{ pole: number; level: number | null }>;
  /** Headers the mapping remembers and this file does not have. Detected automatically instead. */
  stale: string[];
}

/** The fields a mapping names one column for: every form field but the two automatic choices. */
const SINGLE_FIELDS = FIELDS.filter(
  (f): f is Exclude<FormField, 'choice1Pole' | 'choice1Level' | 'choice2Pole' | 'choice2Level'> =>
    !/^choice[12]/.test(f),
);

/**
 * Binds the columns of a file, the régisseur's decisions first (`FormMapping`), the automatic
 * detection for everything they left alone.
 *
 * A column the mapping takes is never also given to another field by the detection: saying "the
 * volume is THIS column" must not leave the matcher free to bind the same column to the artists.
 */
export function bindForm(headers: readonly string[], mapping: FormMapping = EMPTY_FORM_MAPPING): FormBinding {
  const normalised = headers.map(normalise);
  const find = (header: string): number => normalised.indexOf(normalise(header));
  const auto = bindColumns(headers).map;
  const map: ColumnMap = {};
  const used = new Set<number>();
  const stale: string[] = [];
  const decided = new Set<FormField>();

  for (const field of SINGLE_FIELDS) {
    const remembered = mapping.columns[field as MappedField];
    if (remembered === undefined) continue;
    decided.add(field);
    if (remembered === '') continue;
    const at = find(remembered);
    if (at >= 0) {
      map[field] = at;
      used.add(at);
    } else {
      stale.push(remembered);
      decided.delete(field);
    }
  }

  const choices: FormBinding['choices'] = [];
  if (mapping.choices !== undefined) {
    for (const choice of mapping.choices) {
      const pole = find(choice.pole);
      if (pole < 0) {
        stale.push(choice.pole);
        continue;
      }
      const level = choice.level === null ? -1 : find(choice.level);
      if (choice.level !== null && level < 0) stale.push(choice.level);
      choices.push({ pole, level: level < 0 ? null : level });
      used.add(pole);
      if (level >= 0) used.add(level);
    }
  }

  for (const field of SINGLE_FIELDS) {
    if (decided.has(field) || map[field] !== undefined) continue;
    const at = auto[field];
    if (at !== undefined && !used.has(at)) {
      map[field] = at;
      used.add(at);
    }
  }

  if (mapping.choices === undefined) {
    for (const [pole, level] of [['choice1Pole', 'choice1Level'], ['choice2Pole', 'choice2Level']] as const) {
      const p = auto[pole];
      if (p === undefined || used.has(p)) continue;
      const l = auto[level];
      choices.push({ pole: p, level: l === undefined || used.has(l) ? null : l });
      used.add(p);
      if (l !== undefined) used.add(l);
    }
  }

  return { map, choices, stale };
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export type IssueSeverity = 'error' | 'warning';

export interface ImportIssue {
  severity: IssueSeverity;
  code: string;
  /** 1-based data row in the CSV, so the régisseur can find it in the spreadsheet. */
  row: number | null;
  person: string;
  message: string;
  suggestions?: string[];
}

export interface ResolvedBuddy {
  fromKey: string;
  rawName: string;
  toKey: string | null;
  via: string;
  candidates: string[];
}

export interface ImportResult {
  volunteers: Volunteer[];
  buddies: ResolvedBuddy[];
  issues: ImportIssue[];
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

/**
 * "Qu'est ce que tu préfères ?", read against the event's own slots since 2026-09-13.
 *
 * Three outcomes, like `parseSlotChoice` below: null is "peu importe" (the form spells it
 * "Peux importe", matched as written), a slot id is the slot the answer names, and `inconnu` is text
 * that names none of them. The words "loto" and "concerts" are not in this file any more: they
 * are the labels of two rows in Réglages, and "Travailler pendant le loto" contains "loto".
 */
function parsePreferredSlot(
  value: string,
  slots: readonly PreferenceSlot[],
): SlotId | 'inconnu' | null {
  const v = normalise(value);
  if (v === '' || v.includes('peu importe') || v.includes('peux importe') || v.includes('les deux')) {
    return null;
  }
  return matchSlot(v, slots)?.id ?? 'inconnu';
}


/**
 * The volume answer, which is a sentence and not a number.
 *
 * NOT ONE OF THE FORM'S THREE ANSWERS STATES ITS OWN TOTAL. They are worded as a base of four
 * hours plus an optional extra: "2 h de plus" is six and "4 h de plus" is eight. Reading the
 * first digit, which is what this did until 2026-09-08, made the six-hour answer unreadable and
 * the eight-hour answer indistinguishable from the four-hour one.
 *
 * 'a-confirmer' is the fourth answer, "J'ai quelques questions avant de me décider": a real
 * person with no volume attached. They are imported at the floor with a signalement, because
 * rejecting the row would make somebody who registered simply disappear.
 */
function parseVolume(value: string, base = 4): number | 'a-confirmer' | null {
  const v = normalise(value);
  if (v === '') return null;
  if (/quelques questions|avant de me decider|je les preciserai/.test(v)) return 'a-confirmer';

  // "2 h de plus" is on top of the floor the question states, which is the event's own floor.
  const plus = v.match(/(\d+(?:[.,]\d+)?)\s*h de plus/);
  if (plus) return base + Number(plus[1]!.replace(',', '.'));
  if (/un seul creneau/.test(v)) {
    const own = v.match(/(\d+(?:[.,]\d+)?)\s*h/);
    return own ? Number(own[1]!.replace(',', '.')) : base;
  }

  const digits = v.match(/\d+(?:[.,]\d+)?/);
  const n = digits ? Number(digits[0].replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 24 * 7 ? n : null;
}

/**
 * Which configured slot a closed answer names.
 *
 * Matched against the slot's own id and label rather than against three hard-coded strings, so
 * rewording the question in Réglages is a change to configuration and not to this file.
 *
 * Three outcomes, not two: null is "no refusal" (empty, or "aucune"), a slot id is the answer,
 * and `inconnu` is text that matches no slot at all. That last one is what makes this survive
 * the question becoming free text: the caller sends it to the sentence parser instead.
 */
function parseSlotChoice(value: string, slots: readonly EventSlot[]): SlotId | 'inconnu' | null {
  const v = normalise(value);
  if (v === '' || v.startsWith('aucun') || v.startsWith('tout me va')) return null;
  return matchSlot(v, slots)?.id ?? 'inconnu';
}

/** The slot an already-normalised answer names, by id or by label, either way round. */
function matchSlot<T extends { id: SlotId; label: string }>(v: string, slots: readonly T[]): T | undefined {
  return slots.find(
    (s) =>
      v.includes(normalise(s.id)) ||
      normalise(s.label).includes(v) ||
      v.includes(normalise(s.label)),
  );
}

function parseLevel(value: string): SkillLevel | null {
  const v = normalise(value);
  if (v.startsWith('debut')) return 'debutant';
  if (v.startsWith('inter')) return 'intermediaire';
  if (v.startsWith('habitue') || v.startsWith('expert')) return 'expert';
  return null;
}

/** Matches a pole by full path first, then by leaf name when that name is unambiguous. */
function findPole(value: string, poles: readonly Pole[]): Pole | null {
  const v = normalise(value);
  if (v === '' || v === 'tout me va' || v === 'aucun') return null;

  const byPath = poles.find((p) => normalise(p.path) === v);
  if (byPath) return byPath;

  const byName = poles.filter((p) => normalise(p.name) === v);
  return byName.length === 1 ? byName[0]! : null;
}

/**
 * Splits a checkbox answer back into the options that were ticked.
 *
 * Deliberately NOT `splitList`, which also breaks on the word "et". None of the nine current
 * pole labels contains one, but the régisseur rewords them freely, and a pole called "Accueil
 * et billetterie" would be torn in half and then matched against nothing. Google Forms joins
 * ticked options with ", ", and no option in this form contains a comma.
 */
const splitAnswers = (value: string): string[] =>
  value
    .split(/[,;]|\n/)
    .map((s) => s.trim())
    .filter((s) => s !== '' && !/^aucun|^tout me va/.test(normalise(s)));

const splitList = (value: string): string[] =>
  value.split(/[,;]|\bet\b|\n/).map((s) => s.trim()).filter((s) => s !== '');

// ---------------------------------------------------------------------------
// The buddy answer
//
// THE FORM ASKS FOR FOUR THINGS IN ONE BOX: "son nom, prénom, mail et numéro de téléphone". So
// the answer is a sentence about one person, not a list of people, and `splitList` was exactly
// the wrong tool for it: "Marie Dupont, marie@x.fr, 06 12 34 56 78" came out as three names, of
// which two could never match anybody. That is two spurious "binôme non résolu" warnings per
// request, over a hundred volunteers, drowning the handful that are real.
//
// Worse, it threw away the one field that resolves perfectly. The mail address is the strongest
// identity in the whole import: `volunteerIdentity` builds the volunteer's own key from it. A
// buddy request carrying one needs no name matching at all, and no amount of fuzzy matching on
// "Marie Dupont" is as safe as the address she typed.
// ---------------------------------------------------------------------------

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Nine digits or more, however they are spaced. Short enough to catch 0612345678, long enough
 *  to leave a year or a house number alone. */
const PHONE = /(?:\+?\d[\s.\-()]*){9,}/g;

/** One person named in a buddy answer, with whatever identifies them that came along. */
export interface BuddyMention {
  /** What the régisseur sees: the name if there is one, else the address, else the number. */
  label: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Reading one buddy answer.
 *
 * The address and the number are lifted out first, which is both how they get used and how the
 * name is left clean. What remains is treated as ONE person unless it is separated the way
 * somebody naming two friends separates them: a semicolon, a new line, "et", "&". A comma is
 * not on that list, because the question itself asks for comma-separated details about one
 * person; when the whole of it fails to resolve, `resolveBuddies` falls back to the comma
 * fragments rather than guessing here.
 */
export function parseBuddyAnswer(value: string): BuddyMention[] {
  const emails: string[] = [];
  const phones: string[] = [];

  const withoutEmails = value.replace(EMAIL, (found) => {
    emails.push(found.toLowerCase());
    return ' ';
  });
  const withoutPhones = withoutEmails.replace(PHONE, (found) => {
    phones.push(found);
    return ' ';
  });

  const names = withoutPhones
    .split(/[;\n&]|\bet\b/i)
    .map((part) =>
      part
        .replace(/\s+/g, ' ')
        // The commas that separated the details from the name are still here, now with nothing
        // between them. They collapse; a comma between two actual names survives, and
        // resolveBuddies is what decides whether it separates two people.
        .replace(/(?:\s*,\s*)+/g, ', ')
        .replace(/^[\s,.;]+|[\s,.;]+$/g, ''),
    )
    // A leftover "M." or a stray letter is punctuation, not somebody's name.
    .filter((part) => part.length > 1);

  // One name, or several; failing that, the details on their own still identify somebody.
  const count = Math.max(names.length, emails.length, phones.length);
  const mentions: BuddyMention[] = [];
  for (let i = 0; i < count; i++) {
    const name = names[i] ?? null;
    const email = emails[i] ?? null;
    const phone = phones[i] ?? null;
    const label = name ?? email ?? phone;
    if (label === null) continue;
    mentions.push({ label, name, email, phone });
  }
  return mentions;
}

/** French numbers compare on their last nine digits: 06 12 34 56 78 and +33 6 12 34 56 78 are
 *  the same person, and the country code is the only part that moves. */
const phoneKey = (value: string): string | null => {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
};

/**
 * A key that survives the form being exported again.
 *
 * The form is exported and re-imported many times over the months before the event: rows are
 * corrected, added and deleted. A key built from the row number, which is what this used to be,
 * survives none of that: delete one row and everybody below shifts up, so every assignment in
 * the plan silently points at the wrong person. The identity has to come from the answer, not
 * from where it sits in the file.
 *
 * The email is the identity when there is one, because that is what the form collects to reach
 * somebody and what they are least likely to change. Failing that, the name. Two answers landing
 * on the same identity get a suffix and an issue, rather than being merged: real homonyms
 * without an email address exist, and guessing which of them holds a shift is not a guess this
 * tool is allowed to make.
 */
export function volunteerIdentity(firstName: string, lastName: string, email: string): string {
  // Case and surrounding space only. `normalise` strips punctuation, which is right for matching
  // a name somebody typed from memory and wrong for an address: it turns j.dupont@example.org
  // into "j dupont example org", so two genuinely different addresses could collide into one
  // person. An address is compared as an address.
  const mail = email.trim().toLowerCase();
  if (mail !== '') return `mail:${mail}`;

  const slug = (value: string) =>
    normalise(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `nom:${slug(firstName)}-${slug(lastName)}`;
}

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * An unbiased draw below `bound`, from the Web Crypto API.
 *
 * Web Crypto rather than `node:crypto` because this module also runs in the browser, where the
 * import screen lives. The rejection loop is not decoration: taking a uint32 modulo 31 would
 * favour the first letters of the alphabet, and this code is what authenticates a volunteer, so
 * it has to be uniform and unguessable.
 */
function randomBelow(bound: number): number {
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  const buffer = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buffer);
    const value = buffer[0]!;
    if (value < limit) return value % bound;
  }
}

/**
 * How long each kind of credential is, and why they differ.
 *
 * A volunteer's code opens one person's own shifts: eight characters of this alphabet is about
 * 40 bits, which is far beyond anything worth guessing for what it protects.
 *
 * A ORGANISER'S CODE OPENS THE WHOLE PLANNING, including every volunteer's contact details, so it
 * protects the same data a régisseur's password does and is sized accordingly: fourteen
 * characters, about 69 bits. It is typed once and remembered by the browser afterwards, so the
 * extra length costs one longer paste and nothing else. See `feature_leader_access.md` for the
 * decision that put all 120 volunteers behind this one string.
 */
export const VOLUNTEER_CODE_LENGTH = 8;
export const ORGANISER_CODE_LENGTH = 14;

/** A code nothing in `taken` already uses. Adds it to `taken`, so a batch cannot collide. */
export function newAccessCode(taken: Set<string>, length = VOLUNTEER_CODE_LENGTH): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomBelow(CODE_ALPHABET.length)];
    if (!taken.has(code)) { taken.add(code); return code; }
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportOptions {
  poles: readonly Pole[];
  artists: readonly Artist[];
  /**
   * The slots the form offers, matched against the CSV answers by label.
   *
   * Reword the question in the form and reword these to match: that is the whole point of them
   * being configuration. Defaults to the three this event started with.
   */
  slots?: readonly EventSlot[];
  /** The tranches the preference question offers, matched the same way. */
  preferenceSlots?: readonly PreferenceSlot[];
  rules?: SchedulingRules;
  /** How long the event runs, for the span arithmetic below. */
  lengthHours?: number;
  /**
   * When the event starts, in ISO. The free-text time constraint is written on the clock
   * ("pas avant 18h") and everything else here is in hours from the start, so reading one into
   * the other needs the real start rather than an assumed midday.
   *
   * Required, and deliberately not defaulted: an importer that quietly assumes a start hour
   * reads every "pas avant 18h" against the wrong night the day the event moves.
   */
  startISO: string;
  /** Reuse existing codes so a re-import does not invalidate the ones already sent out. */
  existingCodes?: ReadonlyMap<string, string>;
  /** The régisseur's column and answer decisions for this event. See `form-mapping.ts`. */
  mapping?: FormMapping;
  /** The event's volume settings: per day or not, and the options. Defaults to the Loto Tekno's. */
  volume?: VolumeSettings;
  /** Which rhythm rules block, for the volume ceiling. Defaults to all of them. */
  constraints?: ConstraintSettings;
}

export function importVolunteers(csvText: string, options: ImportOptions): ImportResult {
  const { poles, artists } = options;
  const slots = options.slots ?? DEFAULT_SLOTS;
  const preferenceSlots = options.preferenceSlots ?? DEFAULT_PREFERENCE_SLOTS;
  const rules = options.rules ?? DEFAULT_RULES;
  const lengthHours = options.lengthHours ?? 18;
  const startISO = options.startISO;
  const rows = parseCsv(csvText);
  const issues: ImportIssue[] = [];

  if (rows.length === 0) {
    issues.push({ severity: 'error', code: 'fichier-vide', row: null, person: '', message: 'Le fichier ne contient aucune ligne.' });
    return { volunteers: [], buddies: [], issues };
  }

  const mapping = options.mapping ?? EMPTY_FORM_MAPPING;
  const volumeSettings = options.volume ?? DEFAULT_VOLUME;
  const binding = bindForm(rows[0]!, mapping);
  const { map } = binding;
  for (const header of binding.stale) {
    issues.push({
      severity: 'warning',
      code: 'colonne-memorisee-absente',
      row: null,
      person: '',
      message:
        `La colonne "${header.trim()}" retenue lors d'un import précédent n'existe plus dans ce fichier. ` +
        "La détection automatique l'a remplacée: vérifier la correspondance des colonnes.",
    });
  }
  /*
   * ONLY THE NAME IS REQUIRED since 2026-09-14. The other fields were required against the Loto
   * Tekno form; another form may not ask for a volume, a level or a refusal at all. What stays
   * true is that a column nobody found is worth saying, so each of the fields that plans are
   * built from is a warning when it is neither bound nor deliberately left out.
   */
  const missing: FormField[] = (['lastName', 'firstName'] as const).filter((f) => map[f] === undefined);
  const expected: Array<[MappedField | 'choices', string]> = [
    ['volume', 'le volume horaire'],
    ['refusedPoles', 'les pôles refusés'],
    ['halfPreference', 'la tranche préférée'],
    ['choices', 'les choix de pôles'],
  ];
  for (const [field, words] of expected) {
    const bound = field === 'choices' ? binding.choices.length > 0 : map[field] !== undefined;
    const leftOut = field === 'choices' ? mapping.choices?.length === 0 : mapping.columns[field] === '';
    if (bound || leftOut) continue;
    issues.push({
      severity: 'warning',
      code: 'colonne-non-reliee',
      row: null,
      person: '',
      message: `Aucune colonne pour ${words}. Si le formulaire la pose, la relier dans la correspondance des colonnes.`,
    });
  }
  /*
   * Neither time question is `required`, because either one may be reworded away, and both
   * are optional to answer. Losing BOTH is a different matter: nothing in the file would then
   * say when somebody cannot come, and the import would look like it worked.
   */
  // A warning since 2026-09-14: another event's form may simply not ask. Left out on purpose
  // (both fields set to no column in the correspondence), it says nothing at all.
  if (
    map.refusedSlotChoice === undefined && map.availabilityNote === undefined &&
    !(mapping.columns.refusedSlotChoice === '' && mapping.columns.availabilityNote === '')
  ) {
    issues.push({
      severity: 'warning',
      code: 'colonne-manquante',
      row: null,
      person: '',
      message:
        'Aucune colonne de disponibilité: ni la question fermée sur les horaires, ni le champ ' +
        "d'impératif horaire. Vérifier les intitulés du formulaire.",
    });
  }

  for (const field of missing) {
    issues.push({
      severity: 'error',
      code: 'colonne-manquante',
      row: null,
      person: '',
      message: `Aucune colonne ne correspond au champ "${field}". Vérifier les intitulés du formulaire.`,
    });
  }

  const cell = (row: readonly string[], field: FormField): string => {
    const index = map[field];
    return index === undefined ? '' : (row[index] ?? '').trim();
  };
  const at = (row: readonly string[], index: number | null): string =>
    index === null ? '' : (row[index] ?? '').trim();

  /** The régisseur's reading of an answer, when there is one. `undefined` means none: read it. */
  const answers: AnswerMaps = mapping.answers;
  const decidedAnswer = <K extends AnswerKind>(kind: K, raw: string): NonNullable<AnswerMaps[K]>[string] | undefined =>
    (answers[kind] as Record<string, NonNullable<AnswerMaps[K]>[string]> | undefined)?.[normalise(raw)];

  const readPole = (raw: string): AnswerReading<string> => {
    const decided = decidedAnswer('pole', raw);
    return decided !== undefined ? { value: decided, confident: true, reason: null } : parsePoleAnswer(raw, poles);
  };
  const constraints = resolveConstraints(options.constraints);
  const blocking = {
    maxConsecutive: constraints.maxConsecutive.mode === 'block',
    maxBlocks: constraints.maxBlocks.mode === 'block',
    minBreak: constraints.minBreak.mode === 'block',
  };
  const days = eventDays(startISO, lengthHours, volumeSettings.dayStartHour);

  /**
   * A COLUMN THAT NEVER ONCE PARSES IS BOUND TO THE WRONG QUESTION, and saying so is the whole
   * point of this. Against the real export the old matchers bound `volume` to "Combien faut-il
   * de personnes pour déplacer un fût de 30 litres de bière ?" and read the answer as somebody's
   * hours. Every row failed, every row raised "réponse illisible", and nothing anywhere said the
   * column itself was wrong: the régisseur would have gone looking at a hundred volunteers.
   *
   * One row parsing is enough to clear a column, because a single unreadable answer is a bad
   * answer and that is already reported per row. Zero out of many is a binding fault.
   */
  const parsedOnce = new Map<FormField, boolean>();
  const readable = {
    saw(field: FormField, ok: boolean): void {
      parsedOnce.set(field, (parsedOnce.get(field) ?? false) || ok);
    },
  };

  const codes = new Set<string>(options.existingCodes?.values() ?? []);
  const volunteers: Volunteer[] = [];
  const rawBuddies: Array<{
    fromKey: string;
    mentions: BuddyMention[];
    row: number;
    person: string;
  }> = [];
  /** Which CSV line each volunteer came from. Only ever used to talk to the régisseur. */
  const rowOf = new Map<string, number>();
  const identities = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNumber = i;
    const firstName = cell(row, 'firstName');
    const lastName = cell(row, 'lastName');
    const person = `${firstName} ${lastName}`.trim();

    if (firstName === '' || lastName === '') {
      issues.push({ severity: 'error', code: 'identite-incomplete', row: rowNumber, person, message: 'Prénom ou nom manquant.' });
      continue;
    }

    const preferenceCell = cell(row, 'halfPreference');
    const decidedPreference = decidedAnswer('preferredSlot', preferenceCell);
    const preferred = decidedPreference !== undefined ? decidedPreference : parsePreferredSlot(preferenceCell, preferenceSlots);
    const volumeCell = cell(row, 'volume');
    const decidedVolume = decidedAnswer('volume', volumeCell);
    const volume = map.volume === undefined
      ? null
      : decidedVolume !== undefined ? decidedVolume : parseVolume(volumeCell, rules.minHoursPerPerson);
    // The two prose answers. Each reading carries its own doubt, and every doubt collected here
    // ends up on the fiche as a line the régisseur has to clear by hand. See `answers.ts`.
    const reviewReasons: string[] = [];

    /*
     * The closed question first, because an answer picked from a list needs no interpreting
     * and raises no doubt. Anything in that column that is NOT one of the slots is treated as
     * prose, so the day the régisseur turns that question into a text field, the import keeps
     * working and starts flagging instead of silently reading nothing.
     */
    const choiceCell = cell(row, 'refusedSlotChoice');
    const decidedSlots = decidedAnswer('refusedSlots', choiceCell);
    const parsedSlot = decidedSlots !== undefined ? null : parseSlotChoice(choiceCell, slots);
    const chosenIds: SlotId[] = decidedSlots ?? (parsedSlot === null || parsedSlot === 'inconnu' ? [] : [parsedSlot]);
    const chosenIsProse = decidedSlots === undefined && choiceCell.trim() !== '' && parsedSlot === 'inconnu';

    const noteCell = cell(row, 'availabilityNote');
    // What the person wrote in their own words, both columns together when both carry prose.
    const availabilityNote = [chosenIsProse ? choiceCell.trim() : '', noteCell.trim()]
      .filter((part) => part !== '')
      .join('\n');
    const availability = parseAvailabilityNote(availabilityNote, slots, startISO, lengthHours);
    if (availability.reason) reviewReasons.push(availability.reason);

    // Merged, and deduplicated: naming the same tranche in both columns is one refusal.
    const refusedSlotIds = [
      ...new Set([...chosenIds, ...availability.value]),
    ];
    readable.saw('refusedSlotChoice', choiceCell.trim() === '' || !chosenIsProse);
    readable.saw('availabilityNote', noteCell.trim() === '' || availability.confident);
    readable.saw('halfPreference', preferred !== 'inconnu');
    readable.saw('volume', map.volume === undefined || volume !== null);

    if (preferred === 'inconnu') {
      issues.push({ severity: 'error', code: 'reponse-illisible', row: rowNumber, person, message: `Préférence horaire illisible, aucune tranche de Réglages ne s'appelle ainsi: "${cell(row, 'halfPreference')}".` });
    }
    if (map.volume !== undefined && volume === null) {
      issues.push({ severity: 'error', code: 'reponse-illisible', row: rowNumber, person, message: `Volume horaire illisible: "${volumeCell}". La relier à un volume dans la correspondance des réponses.` });
    }
    // The fourth volume answer carries no volume. The person exists and has to be called back,
    // so they are imported at the floor rather than dropped, and the signalement says why.
    if (volume === 'a-confirmer') {
      issues.push({
        severity: 'warning',
        code: 'volume-a-confirmer',
        row: rowNumber,
        person,
        message:
          'A répondu avoir des questions avant de se décider: aucun volume horaire dans sa ' +
          `réponse. Importation au plus petit volume proposé, à rappeler pour fixer le volume réel.`,
      });
    }

    /*
     * The two phase answers. A yes with no hours is the whole opening the régisseur gave the
     * bénévoles, which is why nothing here invents a window: see `parsePhaseAnswer`.
     */
    const bothCell = cell(row, 'phaseHelp');
    const montageCell = cell(row, 'montage') || bothCell;
    const demontageCell = cell(row, 'demontage') || bothCell;
    const montageReading = parsePhaseAnswer(montageCell, 'montage');
    const demontageReading = parsePhaseAnswer(demontageCell, 'demontage');
    // One doubt, not two, when one answer covers both phases: the régisseur reads the same
    // sentence twice otherwise, on every fiche that carries a doubt at all.
    if (montageReading.reason) reviewReasons.push(montageReading.reason);
    if (demontageReading.reason && demontageCell !== montageCell) {
      reviewReasons.push(demontageReading.reason);
    }
    readable.saw('phaseHelp', bothCell.trim() === '' || parsePhaseAnswer(bothCell, 'montage').confident);
    readable.saw('montage', cell(row, 'montage').trim() === '' || montageReading.confident);
    readable.saw('demontage', cell(row, 'demontage').trim() === '' || demontageReading.confident);
    const phasePresence = {
      montage: { present: montageReading.value, note: montageCell.trim(), windows: [] },
      demontage: { present: demontageReading.value, note: demontageCell.trim(), windows: [] },
    };

    /*
     * THE POLE CHOICES, one column after another in rank order. A column may hold several ticked
     * answers (a checkbox question): when the whole cell names no pole but each of its
     * comma-separated parts does, each part is a choice of its own, in the order ticked. Prose in
     * an "Autre" box usually has commas too, and then the parts do not all resolve and the cell
     * stays one answer to review.
     */
    const choiceEntries: Array<{ raw: string; pole: Pole | null; level: SkillLevel }> = [];
    for (const columns of binding.choices) {
      const raw = at(row, columns.pole);
      if (raw === '') continue;
      const levelCell = at(row, columns.level);
      const decidedLevel = levelCell === '' ? undefined : decidedAnswer('level', levelCell);
      const level = decidedLevel ?? parseLevel(levelCell) ?? 'debutant';
      const whole = readPole(raw);
      const parts = splitAnswers(raw);
      const partReadings = parts.map(readPole);
      const several = parts.length > 1 && whole.value === '' && partReadings.every((r) => r.value !== '' && r.confident);
      const readings = several ? parts.map((part, i) => ({ raw: part, reading: partReadings[i]! })) : [{ raw, reading: whole }];
      for (const { raw: text, reading } of readings) {
        if (reading.reason) reviewReasons.push(reading.reason);
        choiceEntries.push({ raw: text, pole: poles.find((p) => p.key === reading.value) ?? null, level });
      }
    }

    // A CHECKBOX QUESTION, so this is a list. Reading only the first answer, which is what the
    // model held until 2026-09-08, left the other refusals off the plan entirely: a hard rule
    // silently dropped, and somebody standing in a pole they wrote down that they would not do.
    const refusedRaw = splitAnswers(cell(row, 'refusedPoles'));
    const refusedPoles: Pole[] = [];
    for (const raw of refusedRaw) {
      const decided = decidedAnswer('pole', raw);
      if (decided === '') continue;
      const found = decided !== undefined ? poles.find((p) => p.key === decided) ?? null : findPole(raw, poles);
      if (found) refusedPoles.push(found);
      else {
        issues.push({
          severity: 'warning',
          code: 'pole-inconnu',
          row: rowNumber,
          person,
          message:
            `Pôle refusé introuvable: "${raw}". Ce refus ne sera pas appliqué. ` +
            "Vérifier l'intitulé du pôle dans Réglages.",
        });
      }
    }
    readable.saw('refusedPoles', refusedRaw.length === 0 || refusedPoles.length > 0);

    // A choice that resolved to nothing is a signalement AND a fiche to review: the person
    // asked for something, so the answer is not missing, it is unread. Downgraded from error to
    // warning on 2026-09-10, because "Autre" makes an unmatched answer an ordinary event rather
    // than a broken file, and an error would stop an import over one person's wording.
    for (const [i, entry] of choiceEntries.entries()) {
      const label = `choix ${i + 1}`;
      const { raw, pole: found } = entry;
      if (raw.trim() !== '' && !found) {
        issues.push({
          severity: 'warning',
          code: 'pole-inconnu',
          row: rowNumber,
          person,
          message: `Pôle du ${label} non reconnu: "${raw}". À trancher sur la fiche.`,
        });
      }
    }

    const preferredSlotId = preferred === 'inconnu' ? null : preferred;
    const effectiveVolume = typeof volume === 'number' ? volume : (volumeSettings.options[0] ?? rules.minHoursPerPerson);

    // The span arithmetic. This is the check the form's conditional sections should make
    // impossible, and the one that catches it when they do not. Only the rhythm rules that block
    // on this event narrow it, and on an event counted per day it is the best day that counts.
    const usable = usableWindows(refusedWindows(slots, refusedSlotIds), lengthHours);
    const ceiling = volumeSettings.scope === 'day'
      ? Math.max(0, ...days.map((day) => maxAchievableHours(
          usable
            .map((w) => ({ start: Math.max(w.start, day.start), end: Math.min(w.end, day.end) }))
            .filter((w) => w.end > w.start),
          rules,
          blocking,
        )))
      : maxAchievableHours(usable, rules, blocking);
    if (effectiveVolume > ceiling + 1e-9) {
      issues.push({
        severity: 'error',
        code: 'volume-impossible',
        row: rowNumber,
        person,
        message: `Demande ${effectiveVolume}h${volumeSettings.scope === 'day' ? ' par jour' : ''} mais ses réponses de disponibilité ne laissent que ${ceiling}h ` +
                 `avec les règles de rythme de l'événement. À rappeler.`,
      });
    }

    const isUnder = (pole: Pole | null, root: Pole | null): boolean => {
      if (!pole || !root) return false;
      let current: Pole | undefined = pole;
      while (current) {
        if (current.key === root.key) return true;
        current = current.parentKey ? poles.find((p) => p.key === current!.parentKey) : undefined;
      }
      return false;
    };

    for (const [i, { pole: choice }] of choiceEntries.entries()) {
      const label = `Choix ${i + 1}`;
      const clash = refusedPoles.find((root) => isUnder(choice, root));
      if (clash) {
        issues.push({
          severity: 'error',
          code: 'choix-contradictoire',
          row: rowNumber,
          person,
          message: `${label} "${choice!.path}" appartient au pôle refusé "${clash.path}".`,
        });
      }
    }

    const seenChoices = new Set<string>();
    for (const { pole } of choiceEntries) {
      if (!pole) continue;
      if (seenChoices.has(pole.key)) {
        issues.push({ severity: 'warning', code: 'choix-identique', row: rowNumber, person, message: `Le même pôle est choisi deux fois ("${pole.path}").` });
      }
      seenChoices.add(pole.key);
    }

    const artistKeys: string[] = [];
    for (const raw of splitList(cell(row, 'artist'))) {
      const artist = artists.find((a) => normalise(a.name) === normalise(raw));
      if (artist) artistKeys.push(artist.key);
      else issues.push({ severity: 'warning', code: 'artiste-inconnu', row: rowNumber, person, message: `Artiste introuvable dans la programmation: "${raw}".` });
    }

    const buddyMentions = parseBuddyAnswer(cell(row, 'buddies'));

    const identity = volunteerIdentity(firstName, lastName, cell(row, 'email'));
    let key = identity;
    for (let n = 2; identities.has(key); n++) key = `${identity}#${n}`;
    if (key !== identity) {
      issues.push({
        severity: 'warning',
        code: 'identite-ambigue',
        row: rowNumber,
        person,
        message:
          'Deux réponses portent la même identité. Une adresse e-mail les distinguerait; sans ' +
          'cela, un ré-import peut les intervertir.',
      });
    }
    identities.add(key);
    rowOf.set(key, rowNumber);
    const existing = options.existingCodes?.get(normalise(person));
    volunteers.push({
      key,
      firstName,
      lastName,
      // Taken as typed, and never used to decide who somebody is: two people may well go by the
      // same nickname, and the identity above is the registered name or the address.
      nickname: cell(row, 'nickname'),
      email: cell(row, 'email'),
      phone: cell(row, 'phone'),
      accessCode: existing ?? newAccessCode(codes),
      // As typed, never interpreted. "Végé", "pas de viande" and "végétarien" are one plate and
      // the régisseur is the one who can say so, on the fiche; the importer's job is to stop
      // throwing the answer away.
      diet: cell(row, 'diet'),
      allergies: cell(row, 'allergies'),
      requestedHours: effectiveVolume,
      preferredSlotId,
      refusedSlotIds,
      // Kept word for word beside the reading of it. This is the answer; the slots above are
      // only what the tool made of it.
      availabilityNote,
      refusedPoleKeys: refusedPoles.map((pole) => pole.key),
      choices: choiceEntries.map((c): PoleChoice => ({ poleKey: c.pole?.key ?? '', raw: c.raw, level: c.level })),
      artistKeys,
      // What was asked for, as a person rather than as the fragments of a sentence. The address
      // and the number stay on the mention for the matching and are not repeated here: this is
      // what the review screen and the re-import diff show.
      buddyRawNames: buddyMentions.map((mention) => mention.label),
      // A fresh import has corrected nothing yet. `applyReconciliation` is what carries a
      // régisseur's corrections across a re-import; see `reconcile.ts`.
      manualFields: [],
      needsReview: reviewReasons.length > 0,
      reviewReasons,
      montage: phasePresence.montage,
      demontage: phasePresence.demontage,
    });

    rawBuddies.push({ fromKey: key, mentions: buddyMentions, row: rowNumber, person });
  }

  for (const [field, everParsed] of parsedOnce) {
    if (everParsed) continue;
    const index = map[field];
    if (index === undefined) continue;
    issues.push({
      severity: 'error',
      code: 'colonne-mal-associee',
      row: null,
      person: '',
      message:
        `La colonne "${rows[0]![index]}" a été associée au champ "${field}", mais aucune des ` +
        `${rows.length - 1} réponses n'y est interprétable. C'est presque sûrement la mauvaise ` +
        "colonne: vérifier l'intitulé de la question dans le formulaire.",
    });
  }

  // Homonyms matter here and nowhere else: they are what makes a first name unresolvable.
  const byName = new Map<string, Volunteer[]>();
  for (const v of volunteers) {
    const k = normalise(`${v.firstName} ${v.lastName}`);
    byName.set(k, [...(byName.get(k) ?? []), v]);
  }
  for (const [, group] of byName) {
    if (group.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'homonyme',
        row: null,
        person: `${group[0]!.firstName} ${group[0]!.lastName}`,
        message: `${group.length} bénévoles portent ce nom. Toute demande de binôme les citant devra être tranchée à la main.`,
      });
    }
  }

  const buddies = resolveBuddies(rawBuddies, volunteers, rowOf, issues);
  return { volunteers, buddies, issues };
}

/**
 * Turning what people typed into pairs, in the order the answers can be trusted.
 *
 * THE ADDRESS FIRST, then the number, and only then the name. The first two are identities the
 * volunteer copied; the third is a name somebody remembered how to spell. An answer carrying a
 * mail address that matches a registration is settled, whatever the name next to it says.
 *
 * A mail address matching nobody is not a failure to read the answer, it is the answer: the
 * friend has not filled in the form. Saying so is worth its own code, because the fix is to go
 * and ask them rather than to look for a spelling in the list.
 */
function resolveBuddies(
  raw: ReadonlyArray<{
    fromKey: string;
    mentions: BuddyMention[];
    row: number;
    person: string;
  }>,
  volunteers: readonly Volunteer[],
  rowOf: ReadonlyMap<string, number>,
  issues: ImportIssue[],
): ResolvedBuddy[] {
  // The row number is what separates two real homonyms on the régisseur's review screen. It is
  // carried alongside now that the key is an identity rather than a position in the file.
  const label = (c: MatchCandidate<Volunteer>) =>
    `${c.item.firstName} ${c.item.lastName} (ligne ${rowOf.get(c.item.key) ?? '?'})`;
  const resolved: ResolvedBuddy[] = [];

  for (const entry of raw) {
    const others = volunteers.filter((v) => v.key !== entry.fromKey);
    const self = volunteers.find((v) => v.key === entry.fromKey)!;

    for (const mention of entry.mentions) {
      const push = (toKey: string | null, via: string, candidates: string[] = []) =>
        resolved.push({ fromKey: entry.fromKey, rawName: mention.label, toKey, via, candidates });

      const byEmail = mention.email
        ? others.find((v) => v.email.trim().toLowerCase() === mention.email)
        : undefined;
      if (byEmail) {
        push(byEmail.key, 'adresse e-mail');
        continue;
      }

      const wantedPhone = mention.phone ? phoneKey(mention.phone) : null;
      const byPhone = wantedPhone
        ? others.find((v) => phoneKey(v.phone) === wantedPhone)
        : undefined;
      if (byPhone) {
        push(byPhone.key, 'numéro de téléphone');
        continue;
      }

      // Someone naming themselves is a data-entry slip, not a request. Checked before the name
      // matching, since a volunteer's own name resolves perfectly against everybody else's.
      const typed = normalise(mention.name ?? '');
      if (
        typed !== '' &&
        (typed === normalise(`${self.firstName} ${self.lastName}`) ||
          typed === normalise(self.firstName))
      ) {
        issues.push({
          severity: 'warning',
          code: 'binome-soi-meme',
          row: entry.row,
          person: entry.person,
          message: `Se cite soi-même ("${mention.label}"). Demande ignorée.`,
        });
        continue;
      }

      // The name as a whole first, which is what nearly every answer is.
      const whole = matchPerson(mention.name ?? '', others, NICKNAMES);
      if (whole.matched) {
        push(whole.matched.key, whole.via);
        continue;
      }

      // Then, and only for an answer still holding a comma, the pieces of it: somebody naming
      // two friends in one box. ALL OR NOTHING, deliberately. A comma means "and" in
      // "Marie Dupont, Jean Martin" and means nothing at all in "Marie Dupont, du bar, dispo le
      // soir", and the two are not distinguishable here. Splitting whenever some pieces happen
      // to resolve would turn the second answer into one pairing plus two warnings about a bar,
      // which is the noise this whole rewrite exists to remove. If every piece is somebody, they
      // are all requests; otherwise the answer goes to the manual pass whole, in one line.
      if (mention.name?.includes(',')) {
        const pieces = splitList(mention.name).map((piece) => ({
          piece,
          match: matchPerson(piece, others, NICKNAMES),
        }));
        if (pieces.length > 1 && pieces.every((p) => p.match.matched)) {
          for (const { piece, match } of pieces) {
            resolved.push({
              fromKey: entry.fromKey,
              rawName: piece,
              toKey: match.matched!.key,
              via: match.via,
              candidates: [],
            });
          }
          continue;
        }
      }

      const match = whole;
      const suggestions = match.candidates.map(label);
      push(null, match.via, suggestions);

      // An address or a number that matched nobody says the friend is not registered, which is
      // a different job for the régisseur than an unreadable name.
      const unregistered = mention.email ?? mention.phone;
      issues.push({
        severity: 'warning',
        code: match.via.includes('ambigu')
          ? 'binome-ambigu'
          : unregistered
            ? 'binome-non-inscrit'
            : 'binome-non-resolu',
        row: entry.row,
        person: entry.person,
        message: unregistered
          ? `Binôme demandé avec "${mention.label}" (${unregistered}): personne ne correspond ` +
            "dans les inscriptions. Cette personne n'a probablement pas rempli le formulaire."
          : `Demande de binôme "${mention.label}" non résolue (${match.via}).`,
        suggestions,
      });
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// The survey behind the correspondence screen (2026-09-14)
// ---------------------------------------------------------------------------

/** One distinct answer of a closed question, how often it occurs, and what the rules read in it. */
export interface SurveyAnswer<V> {
  /** The normalised text, which is the key a decision is stored under. */
  key: string;
  /** The answer as the file writes it, first occurrence. */
  answer: string;
  count: number;
  /** The automatic reading, or null when the rules read nothing in it. */
  auto: { value: V } | null;
}

export interface FormSurvey {
  headers: string[];
  rows: number;
  binding: FormBinding;
  /** Up to three non-empty answers per column, for the preview beside each header. */
  samples: string[][];
  answers: {
    volume: SurveyAnswer<number | 'a-confirmer'>[];
    level: SurveyAnswer<SkillLevel>[];
    preferredSlot: SurveyAnswer<SlotId | null>[];
    refusedSlots: SurveyAnswer<SlotId[]>[];
    pole: SurveyAnswer<string>[];
  };
}

/**
 * Everything the correspondence screen shows about a file, with a mapping applied: which column
 * each field reads, what the columns contain, and every distinct answer of the closed questions
 * with the automatic reading beside it. Pure; nothing is imported.
 */
export function surveyForm(csvText: string, options: ImportOptions): FormSurvey {
  const rows = parseCsv(csvText);
  const headers = rows[0] ?? [];
  const body = rows.slice(1);
  const binding = bindForm(headers, options.mapping ?? EMPTY_FORM_MAPPING);
  const slots = options.slots ?? DEFAULT_SLOTS;
  const preferenceSlots = options.preferenceSlots ?? DEFAULT_PREFERENCE_SLOTS;
  const base = (options.rules ?? DEFAULT_RULES).minHoursPerPerson;

  const samples = headers.map((_, i) => {
    const seen: string[] = [];
    for (const row of body) {
      const value = (row[i] ?? '').trim();
      if (value !== '' && !seen.includes(value)) seen.push(value);
      if (seen.length === 3) break;
    }
    return seen;
  });

  const collect = <V>(cells: string[], read: (raw: string) => { value: V } | null): SurveyAnswer<V>[] => {
    const byKey = new Map<string, SurveyAnswer<V>>();
    for (const raw of cells) {
      const answer = raw.trim();
      if (answer === '') continue;
      const key = normalise(answer);
      const found = byKey.get(key);
      if (found) found.count++;
      else byKey.set(key, { key, answer, count: 1, auto: read(answer) });
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count || a.answer.localeCompare(b.answer, 'fr'));
  };
  const column = (index: number | undefined | null): string[] =>
    index === undefined || index === null ? [] : body.map((row) => row[index] ?? '');

  const poleCells = [
    ...binding.choices.flatMap((c) => column(c.pole)),
    ...column(binding.map.refusedPoles).flatMap(splitAnswers),
  ];

  return {
    headers,
    rows: body.length,
    binding,
    samples,
    answers: {
      volume: collect(column(binding.map.volume), (raw) => {
        const v = parseVolume(raw, base);
        return v === null ? null : { value: v };
      }),
      level: collect(binding.choices.flatMap((c) => column(c.level)), (raw) => {
        const v = parseLevel(raw);
        return v === null ? null : { value: v };
      }),
      preferredSlot: collect(column(binding.map.halfPreference), (raw) => {
        const v = parsePreferredSlot(raw, preferenceSlots);
        return v === 'inconnu' ? null : { value: v };
      }),
      refusedSlots: collect(column(binding.map.refusedSlotChoice), (raw) => {
        const v = parseSlotChoice(raw, slots);
        return v === 'inconnu' ? null : { value: v === null ? [] : [v] };
      }),
      pole: collect(poleCells, (raw) => {
        const reading = parsePoleAnswer(raw, options.poles);
        if (NO_POLE_WORDS.test(normalise(raw))) return { value: '' };
        return reading.value === '' ? null : { value: reading.value };
      }),
    },
  };
}

const NO_POLE_WORDS = /^(aucun|tout me va|rien|non)\b/;
