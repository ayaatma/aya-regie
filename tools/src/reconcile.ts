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
import { ENERGY_LABEL, type EditableField, type Volunteer } from './model.js';
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
function changesBetween(before: Volunteer, after: Volunteer, poleName: (key: string) => string): FieldChange[] {
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
              .map((c, i) => `${i + 1}. ${c.poleKey !== '' ? poleName(c.poleKey) : `« ${c.raw.trim()} »`} (${c.level})`)
              .join(', '),
    },
    artistKeys: { label: 'Artistes à ne pas manquer', show: (v) => v.join(', ') },
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
    // Bookkeeping too, and it only ever goes from true to false: the person filled the form in.
    enteredByHand: null,
    // The régisseur's own tracking, never an answer: kept across every import by `mergeWithManual`,
    // so never a change to announce. The registration date is the earliest answer's and only moves
    // when the export starts carrying a timestamp.
    status: null,
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
 *      undo a human reading of a sentence that a parser could only guess at.
 *   3. when the export contradicts a correction, or when the sentence behind it changed, the
 *      fiche goes back into the review queue with the reason, and the correction is kept. The
 *      tool never chooses between a person’s new answer and a human’s old correction on its
 *      own; it keeps both and says so.
 *
 * The access code is preserved for a different reason: it is not an answer, it is ours, and it
 * may already be in somebody's inbox.
 */
export function mergeWithManual(before: Volunteer, imported: Volunteer): Volunteer {
  const merged: Volunteer = {
    ...imported,
    accessCode: before.accessCode,
    manualFields: [...before.manualFields],
    // The régisseur's tracking of the application is not in any export. An import that let a
    // fresh row reset it would put a cancelled person back among the candidatures in silence.
    status: before.status,
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
   * So the doubt is only new when the ANSWER is new. If the sentences are word for word what
   * this plan already holds, the fiche keeps the state a human left it in.
   */
  const sameAnswers = RAW_ANSWERS.every((read) => same(read(before), read(imported)));
  const reasons = sameAnswers ? [...before.reviewReasons] : [...imported.reviewReasons];
  let needsReview = sameAnswers ? before.needsReview : imported.needsReview;

  for (const field of before.manualFields) {
    const corrected = before[field];
    const fromExport = imported[field];
    carry(merged, before, field);

    const backing = BACKED_BY[field];
    if (backing) {
      /*
       * An interpreted field. The export always "disagrees" with the correction, because the
       * parser reads the same sentence the same way every time and the correction is precisely
       * a human overruling that reading. Saying so on every import would flag the fiche forever.
       *
       * What is worth saying is that the SENTENCE changed: the correction was then made against
       * something this person no longer says, and only they know which of the two is right now.
       */
      if (!same(backing(before), backing(imported))) {
        needsReview = true;
        reasons.push(
          `La réponse derrière "${FIELD_LABEL[field]}" a changé depuis votre correction. ` +
            `Avant: "${backing(before)}". Maintenant: "${backing(imported)}".`,
        );
      }
      continue;
    }

    /*
     * An ordinary answer, corrected by hand: a phone number retyped from a voicemail, say.
     * Here the export changing IS news, because the person themselves changed their answer.
     */
    if (!same(corrected, fromExport)) {
      needsReview = true;
      reasons.push(
        `L’export propose une autre valeur pour "${FIELD_LABEL[field]}": ` +
          `"${String(fromExport)}". Votre correction a été conservée.`,
      );
    }
  }

  return { ...merged, needsReview, reviewReasons: reasons };
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
    const after = mergeWithManual(before, fresh);
    const changes = changesBetween(before, after, poleName);
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
    volunteers.push(before ? mergeWithManual(before, volunteer) : volunteer);
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
    parts.push(`${r.alreadyOrga.length} déjà orga${r.alreadyOrga.length > 1 ? 's' : ''}, non ajouté${r.alreadyOrga.length > 1 ? 's' : ''}`);
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
