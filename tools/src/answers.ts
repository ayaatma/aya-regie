/**
 * Reading the two answers the form asks in prose, and saying how sure the reading is.
 *
 * WHY THIS FILE EXISTS. Until 2026-09-10 both questions were closed: the time constraint was a
 * radio button naming one slot, the pole choice was a list. They are open now. The volunteer
 * writes "je ne peux pas avant 18h, je bosse", or picks "Autre" and types "la buvette du fond".
 * A closed answer is read; an open one is interpreted, and an interpretation can be wrong.
 *
 * SO NOTHING HERE EVER RETURNS A BARE VALUE. Every function returns what it read AND whether it
 * would stand behind it, and the importer turns "no" into `needsReview` on the fiche. The rule
 * the whole feature rests on: the tool may guess, but a guess is never allowed to look like an
 * answer. The sentence the volunteer typed is kept beside the guess, so the régisseur can always
 * see what was actually said.
 *
 * THE READING IS SLOT-GRANULAR because the plan is. A constraint that cuts a slot in half, "pas
 * après 22h" over a slot running 18h to minuit, cannot be stored as anything finer, so it is
 * read as a refusal of the whole slot and flagged: refusing too much is a lost pair of hands the
 * régisseur can give back in one click, while refusing too little is somebody placed at an hour
 * they told us they could not come. The first is a nuisance, the second is the promise this tool
 * makes to the people who registered.
 */

import type { EventSlot, Pole, SlotId } from './model.js';
import { editDistance, normalise } from './text.js';

/** What a parser read, and whether a human needs to check it. */
export interface AnswerReading<T> {
  value: T;
  /** True when the reading is safe to apply without anybody looking at it. */
  confident: boolean;
  /** French, addressed to the régisseur. Null when confident. */
  reason: string | null;
}

const sure = <T>(value: T): AnswerReading<T> => ({ value, confident: true, reason: null });
const unsure = <T>(value: T, reason: string): AnswerReading<T> => ({
  value,
  confident: false,
  reason,
});

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * The offset, in decimal hours from the event start, of an hour on the clock.
 *
 * The event runs midday to six in the morning, so "2h" is fourteen hours in and "12h" is zero.
 * Derived from the event's own start rather than from an assumed midday, for the same reason
 * `toClock` is: an event starting at another hour would otherwise be wrong everywhere at once.
 *
 * Returns null for an hour the event never reaches, which is what makes "je pars à 9h" read as
 * "not a constraint on this night" rather than as a refusal of everything.
 */
export function clockOffset(
  startISO: string,
  lengthHours: number,
  hour: number,
  minute = 0,
): number | null {
  const start = new Date(startISO);
  const startClock = start.getHours() + start.getMinutes() / 60;
  let offset = hour + minute / 60 - startClock;
  while (offset < -1e-9) offset += 24;
  return offset <= lengthHours + 1e-9 ? offset : null;
}

/** An interval of the night the volunteer said they cannot work. */
interface Unavailable {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// The time constraint, in the volunteer's own words
// ---------------------------------------------------------------------------

/**
 * Sentences that mean "no constraint". Checked before anything else, because several of them
 * carry an hour ("je suis dispo de 12h a 6h") and would otherwise be read as a refusal of
 * everything outside it: the same answer reached by luck rather than by reading.
 */
const NOTHING =
  /^(non|aucune?|rien|r a s|ras|pas de contrainte|aucune contrainte|tout me va|je suis dispo|dispo toute la (nuit|soiree|journee)|no)\b/;

/** Words that turn an hour into a refusal rather than into an availability. */
const NEGATIVE =
  /\b(pas|impossible|indisponible|indispo|jamais|sauf|ne peux|peux pas|ne pourrai|pourrai pas|contrainte|oblige|dois)\b/;

/**
 * One hour written the way people write it: "18h", "18 h", "18h30", "18:30".
 *
 * The "h" is required, and that is what separates an hour from a volume, a phone number or a
 * house number. A bare "18" in a sentence about an evening is more often something else.
 */
const HOUR = /(\d{1,2})\s*[h:]\s*(\d{2})?/g;

/**
 * The two hours people write as words.
 *
 * "de 18h à minuit" is the most natural way to say the evening slot, and without this the
 * sentence loses its end and reads as "from 18h to the end of the night", which refuses one
 * tranche too many and does it confidently. Rewritten before anything else looks at the text.
 */
const inWords = (text: string): string =>
  text.replace(/\bminuit\b/g, '0h').replace(/\bmidi\b/g, '12h');

interface Mention {
  hour: number;
  minute: number;
  /** Where it sits in the normalised sentence, so the words in front of it can be read. */
  at: number;
}

function hoursIn(text: string): Mention[] {
  const found: Mention[] = [];
  for (const match of text.matchAll(HOUR)) {
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    if (hour > 24 || minute > 59) continue;
    found.push({ hour: hour === 24 ? 0 : hour, minute, at: match.index ?? 0 });
  }
  return found;
}

/** Everything from this hour to the end of the night. */
const LEAVES =
  /\b(jusqu a|jusque|je pars|dois partir|part a|termine|fini|finis|libre jusqu)\b[^0-9]{0,20}$/;
/** Any wording that puts the problem after the hour rather than before it. */
const AFTER =
  /\b(apres|a partir de|des|jusqu a|jusque|je pars|dois partir|part a|termine|fini|finis|libre jusqu)\b[^0-9]{0,20}$/;
/** "de 12h a 18h", "entre 18h et 0h": a named stretch of the night. */
const INTERVAL =
  /\b(de|entre)\b[^0-9]{0,12}(\d{1,2})\s*[h:]\s*(\d{2})?[^0-9]{0,10}\b(a|et|jusqu a)\b[^0-9]{0,12}(\d{1,2})\s*[h:]\s*(\d{2})?/g;

/** Any wording that puts the problem before the hour. */
const BEFORE =
  /\b(avant|des|a partir de|j arrive|arrive|arriverai|dispo a|disponible a|commence|libre a)\b[^0-9]{0,20}$/;

/**
 * Reading a free-text time constraint into the slots it rules out.
 *
 * The shapes it knows, each anchored on words rather than on punctuation, because these answers
 * arrive without any:
 *
 *   "de 12h a 18h" / "entre 12h et 18h"    an interval, refused when the sentence is negative
 *   "avant 18h" / "pas avant 18h"          everything up to that hour
 *   "apres 22h" / "a partir de 22h"        everything from that hour on
 *   "jusqu'a 22h" / "je pars a 22h"        everything from that hour on, said the other way
 *   "j'arrive a 18h"                       everything before that hour
 *
 * A sentence with no hour in it is neither a refusal nor nothing: it is something somebody wrote
 * about their evening, and it goes to review word for word.
 */
export function parseAvailabilityNote(
  note: string,
  slots: readonly EventSlot[],
  startISO: string,
  lengthHours: number,
): AnswerReading<SlotId[]> {
  const text = inWords(normalise(note));
  if (text === '') return sure([]);
  if (NOTHING.test(text)) return sure([]);

  const mentions = hoursIn(text);
  if (mentions.length === 0) {
    return unsure([], `Contrainte horaire non comprise: "${note.trim()}"`);
  }

  const negative = NEGATIVE.test(text);
  const cuts: Unavailable[] = [];

  // "de X a Y", "entre X et Y", as many times as the sentence says it: "pas de 12h a 18h et
  // pas de 0h a 6h" is two refusals, and reading only the first would drop one of them.
  //
  // An interval is a refusal only when the sentence is negative; the same interval in a
  // positive sentence is when they CAN come, so it cuts both ends instead.
  for (const interval of text.matchAll(INTERVAL)) {
    const from = clockOffset(startISO, lengthHours, Number(interval[2]), Number(interval[3] ?? 0));
    const to = clockOffset(startISO, lengthHours, Number(interval[5]), Number(interval[6] ?? 0));
    if (from === null || to === null || to <= from) continue;
    if (negative) cuts.push({ start: from, end: to });
    else cuts.push({ start: 0, end: from }, { start: to, end: lengthHours });
  }

  if (cuts.length === 0) {
    for (const mention of mentions) {
      const at = clockOffset(startISO, lengthHours, mention.hour, mention.minute);
      if (at === null) continue;
      const before = text.slice(Math.max(0, mention.at - 40), mention.at);

      if (AFTER.test(before)) {
        // "je pars a 2h" is a constraint even in a sentence with no negative word in it.
        if (LEAVES.test(before) || negative) cuts.push({ start: at, end: lengthHours });
        continue;
      }
      if (BEFORE.test(before)) {
        cuts.push({ start: 0, end: at });
        continue;
      }
      // An hour with nothing around it to say which side of it is the problem.
      if (negative) cuts.push({ start: at, end: lengthHours });
    }
  }

  const usable = cuts.filter((cut) => cut.end > cut.start + 1e-9);
  if (usable.length === 0) {
    return unsure([], `Contrainte horaire non comprise: "${note.trim()}"`);
  }

  const refused: SlotId[] = [];
  const partial: string[] = [];
  for (const slot of slots) {
    const covered = usable.reduce(
      (total, cut) =>
        total + Math.max(0, Math.min(cut.end, slot.end) - Math.max(cut.start, slot.start)),
      0,
    );
    if (covered <= 1e-9) continue;
    refused.push(slot.id);
    if (covered < slot.end - slot.start - 1e-9) partial.push(slot.label);
  }

  if (refused.length === 0) {
    return unsure([], `Contrainte horaire lue, mais elle ne touche aucune tranche: "${note.trim()}"`);
  }
  if (partial.length > 0) {
    return unsure(
      refused,
      `Contrainte horaire à trancher: "${note.trim()}" ne couvre qu'une partie de ` +
        `${partial.join(' et ')}. La tranche entière a été refusée.`,
    );
  }
  return sure(refused);
}

// ---------------------------------------------------------------------------
// A pole choice, with an "Autre" box beside the list
// ---------------------------------------------------------------------------

/** An answer that names no pole, and is not meant to. */
const NO_POLE =
  /^(aucun|aucune|tout me va|peu importe|n importe|indifferent|pas de preference|non)\b/;

/**
 * Reading a pole answer that may or may not be one of the form's own options.
 *
 * An answer typed into "Autre" arrives in this very column, so this has to cope with anything
 * from an exact label to a sentence. Four passes, widening, and the last three never come back
 * confident:
 *
 *   1. the full path, or a leaf name that is unambiguous. This is the closed answer, unchanged.
 *   2. a pole's name appearing as a word inside the sentence, when exactly one does.
 *   3. a near miss on spelling, within two edits and unambiguous.
 *   4. nothing at all. The answer stays as prose and the fiche goes to review.
 *
 * A sentence naming two poles is deliberately not resolved to the first one: "plutot bar ou
 * accueil" is somebody expressing a preference between two, and choosing for them in silence is
 * exactly the class of mistake this file exists to avoid.
 */
export function parsePoleAnswer(raw: string, poles: readonly Pole[]): AnswerReading<string> {
  const value = normalise(raw);
  if (value === '') return sure('');
  if (NO_POLE.test(value)) return sure('');

  const byPath = poles.find((pole) => normalise(pole.path) === value);
  if (byPath) return sure(byPath.key);

  const byName = poles.filter((pole) => normalise(pole.name) === value);
  if (byName.length === 1) return sure(byName[0]!.key);
  if (byName.length > 1) {
    return unsure('', `Pôle ambigu: "${raw.trim()}" désigne ${byName.length} pôles.`);
  }

  const words = new Set(value.split(' '));
  const named = poles.filter((pole) => {
    const name = normalise(pole.name);
    if (name === '') return false;
    if (words.has(name)) return true;
    return (
      value.includes(` ${name} `) || value.startsWith(`${name} `) || value.endsWith(` ${name}`)
    );
  });
  if (named.length === 1) {
    return unsure(
      named[0]!.key,
      `Choix de pôle interprété: "${raw.trim()}" lu comme ${named[0]!.path}.`,
    );
  }
  if (named.length > 1) {
    return unsure(
      '',
      `Choix de pôle ambigu: "${raw.trim()}" nomme ${named.map((pole) => pole.path).join(' et ')}.`,
    );
  }

  const near = poles
    .map((pole) => ({ pole, distance: editDistance(value, normalise(pole.name), 2) }))
    .filter((candidate) => candidate.distance <= 2)
    .sort((a, b) => a.distance - b.distance);
  if (near.length === 1 || (near.length > 1 && near[0]!.distance < near[1]!.distance)) {
    return unsure(
      near[0]!.pole.key,
      `Choix de pôle interprété: "${raw.trim()}" lu comme ${near[0]!.pole.path}.`,
    );
  }

  return unsure('', `Choix de pôle inconnu: "${raw.trim()}" ne correspond à aucun pôle.`);
}

// ---------------------------------------------------------------------------
// The two phase questions, added 2026-09-10
// ---------------------------------------------------------------------------

/** Answers that mean "no" outright, in the wordings a form offers and people type. */
const NOT_COMING = /^(non|non merci|pas dispo\w*|pas disponible|aucun|aucune|rien|je ne peux pas|indisponible|-)$/;

/** Answers that mean "yes, and nothing more". Anything else is a sentence somebody wrote. */
const PLAIN_YES = /^(oui|oui bien sur|ok|d accord|dispo|disponible|je viens|present\w*|yes|x|1)$/;

/**
 * Which of the two phases a sentence names, if it names one at all.
 *
 * THE WORD BOUNDARY IS THE WHOLE TRICK. "démontage" normalises to "demontage", which contains
 * "montage" as a substring, so a naive test reads "je peux aider au démontage" as a yes for the
 * montage as well: somebody down for one evening of tidying up, put on three days of setup.
 * \b refuses that, since the letter before "montage" there is a letter.
 */
const NAMES_MONTAGE = /\bmontage\b/;
const NAMES_DEMONTAGE = /\bdemontage\b/;

/**
 * Reading "es-tu là pour le montage ?", and how far the answer goes past yes or no.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: turn "je peux venir vendredi après-midi et samedi" into
 * hours. It could only do that by knowing which day of the montage a Friday is, and a montage
 * whose dates move by a day, which is normal three months out, would then leave every volunteer
 * placed on the wrong day with nothing saying so. What it does instead is what the rest of this
 * file does with prose: read the yes or the no, keep the sentence, and hand the régisseur the
 * doubt. `Phase.volunteersFrom` to `Phase.volunteersUntil` is the placement a plain yes gets,
 * and the régisseur narrows it on the fiche when the sentence says something narrower.
 *
 * A blank answer is a no, and a confident one: the question was asked and not answered.
 */
export function parsePhaseAnswer(
  raw: string,
  which: 'montage' | 'demontage' = 'montage',
): AnswerReading<boolean> {
  const value = normalise(raw);
  if (value === '') return sure(false);
  if (NOT_COMING.test(value)) return sure(false);
  if (PLAIN_YES.test(value)) return sure(true);
  /*
   * « Oui sur l'intégralité du montage ET du démontage » and « Oui mais pas l'intégralité... »,
   * a festival's two yeses, since 2026-09-16. The second says « pas » and was read as a refusal:
   * a yes that is only partial is still a yes, and the days ticked in the next question say which.
   */
  if (/^oui\b/.test(value) && /integralite|pas tout|en partie|quelques jours/.test(value)) return sure(true);

  /*
   * ONE QUESTION, TWO PHASES. The real form asks "serais-tu prêt à faire du montage /
   * démontage ?", so the same sentence is read once per phase, and an answer that names only
   * one of them is an answer about that one and a "no" about the other. That is a reading with
   * no doubt in it: "oui, pour le démontage" says exactly what it says.
   */
  const montage = NAMES_MONTAGE.test(value);
  const demontage = NAMES_DEMONTAGE.test(value);

  /*
   * BOTH NAMED, ONE REFUSED: "je peux venir aider au montage, pas au démontage". The refusal
   * word cuts the sentence in two, and each phase is read on the side it appears: what comes
   * before is what the person offers, what comes after is what they rule out. A phase named on
   * both sides of the cut says nothing clear and falls through to the doubt below.
   */
  if (montage && demontage) {
    const cut = value.search(/\b(pas|sauf|jamais)\b/);
    if (cut > 0) {
      const before = value.slice(0, cut);
      const after = value.slice(cut);
      const named = which === 'montage' ? NAMES_MONTAGE : NAMES_DEMONTAGE;
      if (named.test(before) && !named.test(after)) return sure(true);
      if (named.test(after) && !named.test(before)) return sure(false);
    }
  }

  if (montage !== demontage) {
    const named = montage ? 'montage' : 'demontage';
    const yes = !/\b(pas|jamais|impossible)\b/.test(value);
    return sure(which === named ? yes : false);
  }

  /*
   * A NEGATION INSIDE A SENTENCE IS STILL A NO, and it is read as one rather than as a yes with
   * a doubt attached. "je ne peux pas venir au montage" placed on three days of setup is the
   * kind of mistake that has somebody's name on it.
   */
  if (/\b(pas|jamais|impossible|aucun)\b/.test(value) && !/\bpas (avant|apres|le matin|toute)\b/.test(value)) {
    return unsure(
      false,
      `Montage / démontage lu comme un refus: "${raw.trim()}". À vérifier sur la fiche.`,
    );
  }

  return unsure(
    true,
    `Montage / démontage: présence retenue, horaires à préciser d'après "${raw.trim()}".`,
  );
}
