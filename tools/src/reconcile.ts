/**
 * Bringing a plan up to date with a fresh export of the form.
 *
 * The form is not filled in once. It collects answers for months, people correct what they said,
 * the régisseur deletes a duplicate row, somebody withdraws. So the CSV is re-imported many
 * times, and each time the question is the same: who is new, what changed, and who is gone.
 *
 * THE CSV IS THE SOURCE OF TRUTH FOR ANSWERS, AND ONLY FOR ANSWERS. What somebody said they
 * want comes from the form and is overwritten by it. Where they have been placed comes from the
 * régisseur and is never touched here: an update keeps every assignment the person holds, and if
 * their new answers make one of those assignments illegal, it turns red on the grid like any
 * other manual edit. Reconciling must never quietly reshuffle a plan.
 *
 * REMOVALS ARE THE DANGEROUS HALF, so they are listed one by one with what each one costs, and
 * any of them can be refused. A row missing from the export usually means somebody withdrew, but
 * it can also mean a filtered view was exported by mistake, and the difference between those two
 * is a person losing their evening.
 *
 * Identity comes from `volunteerIdentity`: the email when there is one, the name otherwise.
 * Never the row number, which is what it used to be and which changes the moment a row above is
 * deleted.
 */

import { fmtHours, type Plan } from './plan.js';
import { EDITABLE_FIELDS, ENERGY_LABEL, choicePoleLabel, type EditableField, type Volunteer } from './model.js';
import { parseSubmittedAt, type ImportIssue, type ImportResult } from './import.js';
import { organiserIdentity } from './import-organisers.js';

/** One answer that differs between the plan and the new export. */
export interface FieldChange {
  /** French, addressed to the régisseur. */
  label: string;
  before: string;
  after: string;
}

export interface VolunteerUpdate {
  key: string;
  name: string;
  before: Volunteer;
  after: Volunteer;
  changes: FieldChange[];
}

export interface VolunteerRemoval {
  volunteer: Volunteer;
  name: string;
  /** Shifts they hold and would lose. The number that makes this decision serious. */
  assignments: number;
  hours: number;
  onReserve: boolean;
}

export interface Reconciliation {
  added: Volunteer[];
  /**
   * Rows of the export naming somebody the plan holds as an ORGA, since 2026-09-15. Not added:
   * one person is one row of the tool, and the usual way here is a bénévole the régisseur turned
   * into an orga on the Personnes tab while their form answer stays in the sheet. Listed, so the
   * import says what it left out, never dropped in silence.
   */
  alreadyOrga: Volunteer[];
  updated: VolunteerUpdate[];
  removed: VolunteerRemoval[];
  /** People present in both, with every answer identical. */
  unchanged: number;
  /** Everything the import itself had to say about the file. */
  issues: ImportIssue[];
}

const name = (v: Volunteer): string => `${v.firstName} ${v.lastName}`.trim();



/**
 * Which fields of a volunteer are answers to compare, and which are not.
 *
 * EXHAUSTIVE ON PURPOSE, and this is the point of the type rather than a formality. Adding a
 * field to `Volunteer` without listing it here is a compile error, in the same spirit as
 * `normalise.ts` being written out field by field.
 *
 * The reason is a workflow that is planned rather than hypothetical: when a new piece of
 * information is added later (a dietary requirement, say), the way it reaches the hundred and
 * twenty people already in the plan is a re-import of the same export. `applyReconciliation`
 * takes each imported volunteer whole, so the value lands correctly whether or not it is listed
 * here. What would NOT happen is anybody being told: the review screen would announce "aucune
 * modification" over a re-import that changes every single row, and the régisseur would
 * reasonably conclude the import was pointless and skip it.
 *
 * `key` and `accessCode` are the two deliberate exclusions. Neither is an answer: the first is
 * an identity computed from the others, the second is something this tool generated and possibly
 * already sent to somebody's inbox, so it is preserved rather than compared.
 */
type ComparedFields = {
  [K in keyof Volunteer]: { label: string; show(value: Volunteer[K], v: Volunteer): string } | null;
};

/**
 * Every answer worth telling the régisseur about, in the words the form used.
 */
function changesBetween(
  before: Volunteer,
  after: Volunteer,
  poleName: (key: string) => string,
  artistName: (key: string) => string,
): FieldChange[] {
  const compared: ComparedFields = {
    key: null,
    accessCode: null,
    firstName: { label: 'Prénom', show: (v) => v },
    lastName: { label: 'Nom', show: (v) => v },
    nickname: { label: 'Surnom', show: (v) => (v.trim() === '' ? 'aucun' : v) },
    email: { label: 'Adresse e-mail', show: (v) => v },
    phone: { label: 'Téléphone', show: (v) => v },
    // The two the comment above this table used as its example, added for real on 2026-09-12.
    diet: { label: 'Régime alimentaire', show: (v) => (v.trim() === '' ? 'aucun' : v.trim()) },
    allergies: { label: 'Allergies', show: (v) => (v.trim() === '' ? 'aucune' : v.trim()) },
    requestedHours: { label: 'Volume demandé', show: (v) => `${v} h` },
    preferredSlotId: { label: 'Préférence', show: (v) => v ?? 'sans préférence' },
    refusedSlotIds: {
      label: 'Tranches refusées',
      show: (v) => (v.length > 0 ? v.join(', ') : 'aucune'),
    },
    skills: {
      label: 'Compétences',
      show: (v) => ((v ?? []).length > 0 ? [...(v ?? [])].sort().join(', ') : 'aucune'),
    },
    // The sentence the tags are read from, compared like the time constraint.
    skillsNote: {
      label: 'Compétences (réponse)',
      show: (v) => ((v ?? '').trim() === '' ? 'aucune' : (v ?? '').trim()),
    },
    emergencyContact: { label: "Contact d'urgence", show: (v) => ((v ?? '').trim() === '' ? 'aucun' : (v ?? '').trim()) },
    healthNote: { label: 'Santé, besoins', show: (v) => ((v ?? '').trim() === '' ? 'rien' : (v ?? '').trim()) },
    minor: { label: 'Mineur·e', show: (v) => (v === true ? 'oui' : v === false ? 'non' : 'non renseigné') },
    imposedPoleKey: { label: 'Pôle imposé', show: (v) => (v ? poleName(v) : 'aucun') },
    equipmentNote: {
      label: 'Matériel proposé',
      show: (v) => ((v ?? '').trim() === '' ? 'rien' : (v ?? '').trim()),
    },
    sideActivityKeys: {
      label: 'Activités annexes',
      show: (v) => ((v ?? []).length > 0 ? [...(v ?? [])].sort().join(', ') : 'aucune'),
    },
    nicknameMatters: { label: 'Surnom important', show: (v) => (v === true ? 'oui' : v === false ? 'non' : 'non renseigné') },
    unavailable: {
      label: 'Indisponible',
      show: (v) => ((v ?? []).length > 0 ? (v ?? []).map((w) => `${w.start} h → ${w.end} h`).join(', ') : 'jamais'),
    },
    avoidedSlotIds: {
      label: 'Tranches à éviter',
      show: (v) => ((v ?? []).length > 0 ? (v ?? []).join(', ') : 'aucune'),
    },
    availabilityNote: {
      label: 'Contrainte horaire (réponse)',
      show: (v) => (v.trim() === '' ? 'aucune' : v.trim()),
    },
    refusedPoleKeys: {
      label: 'Pôles refusés',
      show: (v) => (v.length > 0 ? v.map(poleName).join(', ') : 'aucun'),
    },
    // The whole list in one line, in order: which pole each resolved to, the level, and the
    // answer as typed when it resolved to nothing. Order is part of the answer on a ranked event.
    choices: {
      label: 'Choix de pôles',
      show: (v) =>
        v.length === 0
          ? 'aucun'
          : v
              .map((c, i) => `${i + 1}. ${choicePoleLabel(c, poleName)} (${c.level})`)
              .join(', '),
    },
    artistKeys: { label: 'Artistes à ne pas manquer', show: (v) => (v.length > 0 ? v.map(artistName).join(', ') : 'aucun') },
    buddyRawNames: { label: 'Binômes demandés', show: (v) => v.join(', ') },
    // The two phase answers, shown as the régisseur reads them: whether the person comes, and
    // the sentence they wrote. The hours themselves are not compared, because a re-import
    // never carries any: they are the régisseur's own reading, made on the fiche.
    montage: {
      label: 'Montage',
      show: (v) => (v.present ? (v.note.trim() === '' ? 'oui' : `oui (${v.note.trim()})`) : 'non'),
    },
    demontage: {
      label: 'Démontage',
      show: (v) => (v.present ? (v.note.trim() === '' ? 'oui' : `oui (${v.note.trim()})`) : 'non'),
    },
    // Not answers, so not compared. `manualFields` and `reviewReasons` are the tool's own
    // bookkeeping about this fiche, and listing them would fill the review screen with rows
    // about itself. `needsReview` IS compared, because a fiche going back into the queue is
    // something the régisseur has to know before accepting the import.
    manualFields: null,
    reviewReasons: null,
    // The raw answers themselves: their readings above are what the régisseur is told about.
    formAnswers: null,
    // Bookkeeping too, and it only ever goes from true to false: the person filled the form in.
    enteredByHand: null,
    // The régisseur's own tracking, never an answer: kept across every import by `mergeWithManual`,
    // so never a change to announce. The registration date is the earliest answer's and only moves
    // when the export starts carrying a timestamp.
    status: null,
    teamKey: null,
    statusSteps: null,
    regieNote: null,
    registeredAt: null,
    backup: { label: 'Réserve (renfort)', show: (v) => (v === true ? 'oui' : 'non') },
    energy: { label: "Profil d'énergie", show: (v) => (v ? ENERGY_LABEL[v] : 'non renseigné') },
    needsReview: {
      label: 'Relecture',
      show: (v) => (v ? 'à relire' : 'validée'),
    },
  };

  const changes: FieldChange[] = [];
  for (const [field, spec] of Object.entries(compared) as Array<
    [keyof Volunteer, ComparedFields[keyof Volunteer]]
  >) {
    if (!spec) continue;
    const show = spec.show as (value: unknown, v: Volunteer) => string;
    const from = show(before[field], before);
    const to = show(after[field], after);
    if (from !== to) changes.push({ label: spec.label, before: from, after: to });
  }
  return changes;
}

/**
 * Which raw answer each corrected field is an interpretation of.
 *
 * Correcting "tranches refusées" is correcting a reading of `availabilityNote`. When that
 * sentence changes in a later export, the correction was made against something the person no
 * longer says, which is exactly when a human has to look again.
 */
/**
 * The answers that are kept as typed, and that every doubt is a doubt about.
 *
 * A re-import re-reads them and raises the same doubts it raised last time, so these are what
 * decides whether a doubt is new. See `mergeWithManual`.
 */
const RAW_ANSWERS: ReadonlyArray<(v: Volunteer) => unknown> = [
  (v) => v.availabilityNote,
  // The pole answers as typed, in order. Since 2026-09-14 they live inside `choices`.
  (v) => v.choices.map((c) => c.raw),
];

/**
 * The fields whose raw answer can raise a doubt, compared to decide whether one is new. The
 * contact fields are left out: a new phone number is a change to show, not a reason to read the
 * whole fiche again.
 */
const DOUBTFUL_FIELDS: readonly EditableField[] = EDITABLE_FIELDS.filter(
  (field) => !['firstName', 'lastName', 'nickname', 'email', 'phone', 'diet', 'allergies', 'emergencyContact'].includes(field),
);

/** A raw answer as `Volunteer.formAnswers` joins it, shown without its empty cells. */
const shownAnswer = (raw: string): string =>
  raw.split(' | ').filter((cell) => cell !== '').join(' / ') || '(vide)';

/** The raw answer each interpreted field is a reading of, as the text the doubt quotes. */
const BACKED_BY: Partial<Record<EditableField, (v: Volunteer) => string>> = {
  refusedSlotIds: (v) => v.availabilityNote,
  unavailable: (v) => v.availabilityNote,
  skills: (v) => v.skillsNote ?? '',
  choices: (v) => v.choices.map((c) => c.raw.trim()).filter((raw) => raw !== '').join(' / '),
};

/** Two answers, compared the same way whether they are strings, numbers or lists. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const carry = <K extends EditableField>(to: Volunteer, from: Volunteer, key: K): void => {
  to[key] = from[key];
};

/** The name of each correctable field, in the words the régisseur reads. */
export const FIELD_LABEL: Record<EditableField, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  nickname: 'Surnom',
  email: 'Adresse e-mail',
  phone: 'Téléphone',
  diet: 'Régime alimentaire',
  allergies: 'Allergies',
  requestedHours: 'Volume demandé',
  preferredSlotId: 'Préférence',
  refusedSlotIds: 'Tranches refusées',
  avoidedSlotIds: 'Tranches à éviter',
  unavailable: 'Disponibilités par jour',
  skills: 'Compétences',
  refusedPoleKeys: 'Pôles refusés',
  emergencyContact: "Contact d'urgence",
  healthNote: 'Santé, besoins',
  minor: 'Mineur·e',
  nicknameMatters: 'Surnom important',
  imposedPoleKey: 'Pôle imposé',
  sideActivityKeys: 'Activités annexes',
  choices: 'Choix de pôles',
  montage: 'Montage',
  demontage: 'Démontage',
  artistKeys: 'Artistes à ne pas manquer',
  buddyRawNames: 'Binômes demandés',
  backup: 'Réserve (renfort)',
  energy: "Profil d'énergie",
};

/**
 * The imported answers, with the régisseur's own corrections kept on top.
 *
 * THE FUNCTION THE WHOLE MANUAL-CORRECTION FEATURE RESTS ON, and the reason it is exported:
 * the review screen has to show exactly what accepting the import does, so
 * `reconcileVolunteers` diffs against this and `applyReconciliation` writes this. Two
 * implementations of "what will happen" would eventually disagree, and the day they did, the
 * régisseur would be reading a screen about a plan that never existed.
 *
 * Three rules, in this order:
 *
 *   1. every answer comes from the export, as before. A re-import is still how somebody’s new
 *      phone number reaches the plan.
 *   2. a field the régisseur corrected keeps the corrected value. An export does not get to
 *      undo a human reading of a sentence that a parser could only guess at. A field corrected
 *      during this very import's review (`imported.manualFields`, which a fresh read never
 *      sets) is the newest human word and wins over an older correction.
 *   3. when the person's ANSWER behind a correction changed, the fiche goes back into the review
 *      queue with the reason, and the correction is kept. The tool never chooses between a
 *      person’s new answer and a human’s old correction on its own; it keeps both and says so.
 *      Since 2026-10-23 the answer is `formAnswers`, the raw cells: a correction never matches
 *      the form's reading, so comparing readings flagged every corrected fiche on every import.
 *
 * `validated`: the régisseur read this fiche during this import's review (« La lecture est
 * bonne », or a correction saved). The fiche then leaves the queue whatever it held before.
 *
 * The access code is preserved for a different reason: it is not an answer, it is ours, and it
 * may already be in somebody's inbox.
 */
export function mergeWithManual(before: Volunteer, imported: Volunteer, options: { validated?: boolean } = {}): Volunteer {
  const corrected = new Set<EditableField>([...before.manualFields, ...imported.manualFields]);
  const merged: Volunteer = {
    ...imported,
    accessCode: before.accessCode,
    manualFields: EDITABLE_FIELDS.filter((field) => corrected.has(field)),
    ...(imported.formAnswers ?? before.formAnswers ? { formAnswers: imported.formAnswers ?? before.formAnswers } : {}),
    // The régisseur's tracking of the application is not in any export. An import that let a
    // fresh row reset it would put a cancelled person back among the candidatures in silence.
    status: before.status,
    teamKey: before.teamKey,
    statusSteps: before.statusSteps,
    regieNote: before.regieNote,
    registeredAt: earliestRegistration(before.registeredAt, imported.registeredAt),
  };

  /*
   * A DOUBT ALREADY SETTLED IS NOT RAISED AGAIN, and this is what makes the queue empty.
   *
   * The parser is unsure of "je ne peux pas avant 15h" every single time it reads it. The
   * form is exported every few days, so taking the fresh import’s `needsReview` at face value
   * would put every fiche a human has validated straight back into the queue on the next
   * import, forever, and a queue that refills itself is a queue nobody works through.
   *
   * So the doubt is only new when the ANSWER is new. If the answers are word for word what
   * this plan already holds, the fiche keeps the state a human left it in. Since 2026-10-23 every
   * answer a doubt can come from is compared when both sides kept them, not only the sentences.
   */
  const sameAnswers =
    RAW_ANSWERS.every((read) => same(read(before), read(imported))) &&
    (!before.formAnswers ||
      !imported.formAnswers ||
      DOUBTFUL_FIELDS.every((field) => (before.formAnswers![field] ?? '') === (imported.formAnswers![field] ?? '')));
  const reasons = sameAnswers ? [...before.reviewReasons] : [...imported.reviewReasons];
  let needsReview = sameAnswers ? before.needsReview : imported.needsReview;

  for (const field of before.manualFields) {
    if (imported.manualFields.includes(field)) continue;
    carry(merged, before, field);

    const was = before.formAnswers?.[field];
    const now = imported.formAnswers?.[field];
    if (was !== undefined && now !== undefined) {
      if (was !== now) {
        needsReview = true;
        reasons.push(
          `La réponse au formulaire derrière "${FIELD_LABEL[field]}" a changé depuis votre correction. ` +
            `Avant: "${shownAnswer(was)}". Maintenant: "${shownAnswer(now)}". Votre correction a été conservée.`,
        );
      }
      continue;
    }

    /*
     * A fiche corrected before 2026-10-23 kept no raw answer. The sentences it did keep still
     * say whether the person changed their answer; any other field is taken as unchanged, which
     * is what the régisseur asked for, rather than flagged on every import as it used to be.
     */
    const backing = BACKED_BY[field];
    if (backing && !same(backing(before), backing(imported))) {
      needsReview = true;
      reasons.push(
        `La réponse derrière "${FIELD_LABEL[field]}" a changé depuis votre correction. ` +
          `Avant: "${backing(before)}". Maintenant: "${backing(imported)}".`,
      );
    }
  }

  if (options.validated) return { ...merged, needsReview: false, reviewReasons: [] };
  return { ...merged, needsReview, reviewReasons: reasons };
}

/**
 * What the plan will hold for every person of an import once it is applied: the merge with the
 * fiche already there, or the fresh fiche. The import screen's review lists read this, so a fiche
 * a human settled on an earlier import does not come back to be read again.
 */
export function plannedVolunteers(plan: Plan, imported: ImportResult): Volunteer[] {
  const current = new Map(plan.volunteers.map((v) => [v.key, v]));
  const validated = new Set(imported.validated ?? []);
  return imported.volunteers.map((fresh) => {
    const before = current.get(fresh.key);
    return before ? mergeWithManual(before, fresh, { validated: validated.has(fresh.key) }) : fresh;
  });
}

/** The earlier of two form timestamps, either of which may be missing or unreadable. */
function earliestRegistration(a: string | undefined, b: string | undefined): string | undefined {
  const ta = a ? parseSubmittedAt(a) : null;
  const tb = b ? parseSubmittedAt(b) : null;
  if (ta === null) return b || a;
  if (tb === null) return a;
  return ta <= tb ? a : b;
}

/**
 * What a fresh export would change, without changing anything.
 *
 * Pure, like everything else the régisseur reviews before accepting. `applyReconciliation` is
 * the only function here that produces a new plan.
 */
export function reconcileVolunteers(plan: Plan, imported: ImportResult): Reconciliation {
  const poleName = (key: string): string =>
    plan.poles.find((p) => p.key === key)?.path ?? (key === '' ? 'aucun' : key);
  const artistName = (key: string): string => plan.artists.find((a) => a.key === key)?.name ?? key;

  const current = new Map(plan.volunteers.map((v) => [v.key, v]));
  const incoming = new Map(imported.volunteers.map((v) => [v.key, v]));

  const shiftHours = new Map(plan.shifts.map((s) => [s.key, s.end - s.start]));
  const heldBy = new Map<string, { count: number; hours: number }>();
  for (const a of plan.assignments) {
    const held = heldBy.get(a.volunteerKey) ?? { count: 0, hours: 0 };
    held.count++;
    held.hours += shiftHours.get(a.shiftKey) ?? 0;
    heldBy.set(a.volunteerKey, held);
  }
  const reserved = new Set(plan.reserve);

  const added: Volunteer[] = [];
  const alreadyOrga: Volunteer[] = [];
  const updated: VolunteerUpdate[] = [];
  const removed: VolunteerRemoval[] = [];
  let unchanged = 0;
  const orgas = new Set(plan.organisers.map((o) => organiserIdentity(o.firstName, o.lastName, o.email)));

  for (const [key, fresh] of incoming) {
    const before = current.get(key);
    if (!before) {
      if (orgas.has(organiserIdentity(fresh.firstName, fresh.lastName, fresh.email))) alreadyOrga.push(fresh);
      else added.push(fresh);
      continue;
    }
    // Diffed against what accepting the import would really produce, corrections included.
    const after = mergeWithManual(before, fresh, { validated: imported.validated?.includes(key) });
    const changes = changesBetween(before, after, poleName, artistName);
    if (changes.length === 0) unchanged++;
    else updated.push({ key, name: name(after), before, after, changes });
  }

  for (const [key, volunteer] of current) {
    if (incoming.has(key)) continue;
    const held = heldBy.get(key) ?? { count: 0, hours: 0 };
    removed.push({
      volunteer,
      name: name(volunteer),
      assignments: held.count,
      hours: held.hours,
      onReserve: reserved.has(key),
    });
  }

  added.sort((a, b) => name(a).localeCompare(name(b), 'fr'));
  updated.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  // Heaviest losses first: the ones the régisseur most needs to think about.
  removed.sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name, 'fr'));

  alreadyOrga.sort((a, b) => name(a).localeCompare(name(b), 'fr'));

  return { added, alreadyOrga, updated, removed, unchanged, issues: imported.issues };
}

/**
 * The absent people the import keeps unless told otherwise: those entered by hand, who never had
 * a row in the export to lose. Everybody else absent is ticked for removal, as before.
 */
export function keptByDefault(reconciliation: Reconciliation): Set<string> {
  return new Set(
    reconciliation.removed.filter((r) => r.volunteer.enteredByHand === true).map((r) => r.volunteer.key),
  );
}

export interface ApplyOptions {
  /**
   * Keys of people missing from the export that the régisseur chose to keep anyway.
   *
   * Their answers and their placements stay exactly as they are. A filtered view exported by
   * mistake should not cost somebody their evening.
   */
  keep?: ReadonlySet<string>;
  /**
   * Keys of cancelled people who filled the form in again, that the régisseur chose to put back
   * among the inscriptions (`resubmittedCancelled`). Since 2026-10-22. Anybody else cancelled
   * stays cancelled whatever the export says, as before.
   */
  reinstate?: ReadonlySet<string>;
}

/**
 * The cancelled people whose answers changed on this import: they filled the form in again after
 * the régisseur cancelled them. Never put back on their own, only offered (`ApplyOptions.reinstate`):
 * a cancellation is the régisseur's decision, and a second form is a question, not an answer.
 */
export function resubmittedCancelled(reconciliation: Reconciliation): VolunteerUpdate[] {
  return reconciliation.updated.filter((update) => update.before.status === 'annule');
}

/**
 * Applies a reconciliation, and says what a plan does with what it is given.
 *
 * Updates keep the access code and every assignment. Removals take the person, their
 * assignments, their reserve entry and any pairing naming them, and nothing else.
 *
 * Buddy pairs are rebuilt from the export, because that is where they come from: the raw names
 * people typed, resolved against the roster. Pairs involving somebody kept despite being absent
 * from the export are carried over from the plan instead, since the export has nothing to say
 * about them.
 */
export function applyReconciliation(
  plan: Plan,
  imported: ImportResult,
  reconciliation: Reconciliation,
  options: ApplyOptions = {},
): Plan {
  const keep = options.keep ?? new Set<string>();
  const reinstate = options.reinstate ?? new Set<string>();
  const dropped = new Set(
    reconciliation.removed.filter((r) => !keep.has(r.volunteer.key)).map((r) => r.volunteer.key),
  );

  const byKey = new Map(plan.volunteers.map((v) => [v.key, v]));
  const volunteers: Volunteer[] = [];
  const orgaKeys = new Set(reconciliation.alreadyOrga.map((v) => v.key));

  for (const volunteer of imported.volunteers) {
    if (orgaKeys.has(volunteer.key) && !byKey.has(volunteer.key)) continue;
    const before = byKey.get(volunteer.key);
    // The access code, and every field the régisseur corrected by hand. Both are things a
    // re-import must never undo; `mergeWithManual` is the single place that says so.
    const merged = before ? mergeWithManual(before, volunteer, { validated: imported.validated?.includes(volunteer.key) }) : volunteer;
    volunteers.push(
      before && reinstate.has(volunteer.key) && before.status === 'annule' ? { ...merged, status: 'candidature' } : merged,
    );
  }
  for (const volunteer of plan.volunteers) {
    if (byKeyPresent(imported.volunteers, volunteer.key)) continue;
    if (!dropped.has(volunteer.key)) volunteers.push(volunteer);
  }

  const survivors = new Set(volunteers.map((v) => v.key));
  const shiftExists = new Set(plan.shifts.map((s) => s.key));

  // A pair removed by hand stays removed, whatever the export says; one added by hand stays.
  const pairKey = (b: { fromKey: string; toKey: string }): string => `${b.fromKey}|${b.toKey}`;
  const dismissed = new Set(plan.dismissedBuddies.map(pairKey));
  const fromExport = imported.buddies
    .filter((b) => b.toKey !== null && survivors.has(b.fromKey) && survivors.has(b.toKey))
    .map((b) => ({ fromKey: b.fromKey, toKey: b.toKey! }))
    .filter((b) => !dismissed.has(pairKey(b)));
  const importedKeys = new Set(imported.volunteers.map((v) => v.key));
  const exported = new Set(fromExport.map(pairKey));
  const carried = plan.buddies.filter(
    (b) =>
      survivors.has(b.fromKey) &&
      survivors.has(b.toKey) &&
      !exported.has(pairKey(b)) &&
      (b.manual === true || (!importedKeys.has(b.fromKey) && !importedKeys.has(b.toKey))),
  );

  return {
    ...plan,
    volunteers,
    buddies: [...fromExport, ...carried],
    dismissedBuddies: plan.dismissedBuddies.filter((b) => survivors.has(b.fromKey) && survivors.has(b.toKey)),
    assignments: plan.assignments.filter(
      (a) => survivors.has(a.volunteerKey) && shiftExists.has(a.shiftKey),
    ),
    reserve: plan.reserve.filter((key) => survivors.has(key)),
  };
}

const byKeyPresent = (volunteers: readonly Volunteer[], key: string): boolean =>
  volunteers.some((v) => v.key === key);

/** "12 nouveaux, 3 mis à jour, 1 absent", for the button that applies the whole thing. */
export function summariseReconciliation(r: Reconciliation): string {
  const parts: string[] = [];
  if (r.added.length > 0) parts.push(`${r.added.length} nouveau${r.added.length > 1 ? 'x' : ''}`);
  if (r.updated.length > 0) {
    parts.push(`${r.updated.length} mis à jour`);
  }
  if (r.removed.length > 0) {
    const hours = r.removed.reduce((total, entry) => total + entry.hours, 0);
    parts.push(
      `${r.removed.length} absent${r.removed.length > 1 ? 's' : ''} de l'export` +
        (hours > 0 ? ` (${fmtHours(hours)} affectées)` : ''),
    );
  }
  if (r.alreadyOrga.length > 0) {
    parts.push(`${r.alreadyOrga.length} déjà Staff ou responsable${r.alreadyOrga.length > 1 ? 's' : ''}, non ajouté${r.alreadyOrga.length > 1 ? 's' : ''}`);
  }
  if (parts.length === 0) return 'Rien à changer: le planning correspond déjà à cet export.';
  return parts.join(', ');
}

/**
 * The access codes already in circulation, keyed the way `importVolunteers` wants them.
 *
 * Passing these into a re-import means somebody whose email changed, and who therefore lands on
 * a new identity, still keeps the code they were sent.
 */
export function existingCodes(plan: Plan): Map<string, string> {
  const codes = new Map<string, string>();
  for (const v of plan.volunteers) {
    codes.set(`${v.firstName} ${v.lastName}`.trim().toLowerCase(), v.accessCode);
  }
  return codes;
}
