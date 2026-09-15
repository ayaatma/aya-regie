/**
 * Turning a bénévole into an orga, or an orga into a bénévole, since 2026-09-15.
 *
 * WHY THIS IS NOT A FIELD. The two kinds of person are two files with different questions: a
 * bénévole carries a volume, pole choices, refusals, a preference, binômes, an eight-character
 * code, and is placed under every rule the solver knows; an orga carries an arrival and a
 * departure, phase poles, poles they run, a fourteen-character code, and no rule applies to them.
 * Everything that places or feeds somebody names them by kind AND key. So changing somebody's
 * kind is moving a person between two lists and rewriting every reference to them, and it is done
 * here, once, as one pure function.
 *
 * NEVER A SILENT MUTATION. "This tool runs against a real event with real people": the screen
 * shows `carried` and `lost` before the régisseur confirms, and the whole conversion is one edit,
 * undone by one Ctrl+Z. The rules below were chosen so that `lost` stays short and honest:
 *
 * - PLACEMENTS ARE CARRIED, never dropped. A bénévole's créneaux of the exploit become places an
 *   orga holds (`OrganiserShift`); an orga's places become assignments, LOCKED, so the solver
 *   treats them as the régisseur's decision they were. Montage and démontage boxes keep their
 *   hours and are renamed to the new kind. A placement the new rules dislike turns red, like any
 *   hand-made one; nothing is refused.
 * - WHAT FEEDS AND ADMITS THE PERSON IS CARRIED: meals ticked by hand, the door's choices, the
 *   links from an act's member.
 * - WHAT THE OTHER KIND CANNOT HOLD IS DROPPED AND LISTED: binômes and the reserve (a bénévole's),
 *   the poles run (an orga's), the old access code (a credential, which is never moved between
 *   two kinds of access). The form answers of a bénévole are kept, as text, in the orga's note.
 * - A NEW BÉNÉVOLE GOES TO « À RELIRE », because their volume, availability and choices are the
 *   tool's placeholder and not anybody's answer; and is marked `enteredByHand`, so an import of
 *   the form does not offer them for removal.
 */

import { newAccessCode, volunteerIdentity, VOLUNTEER_CODE_LENGTH } from './import.js';
import { organiserIdentity } from './import-organisers.js';
import { absentFromPhase, type Organiser, type PersonKind, type Volunteer } from './model.js';
import { PlanIndex, type Assignment, type Plan } from './plan.js';
import { cateringReport } from './catering.js';
import type { PhaseAssignment } from './phase.js';
import { normalise } from './text.js';

export interface Conversion {
  /** The kind the person becomes. */
  toKind: PersonKind;
  /** Their key in the new list, which is what every rewritten reference now names. */
  newKey: string;
  name: string;
  /** What moves with the person, one French sentence each. */
  carried: string[];
  /** What is dropped or needs doing by hand afterwards, one French sentence each. */
  lost: string[];
  /** Set when the conversion must not be offered at all, with why. `plan` is then unchanged. */
  blocked: string | null;
  plan: Plan;
}

const fullName = (p: { firstName: string; lastName: string }): string =>
  `${p.firstName} ${p.lastName}`.trim();

const plural = (n: number, one: string, many: string): string => (n > 1 ? many : one);

function freeKey(taken: ReadonlySet<string>, base: string, separator: string): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${separator}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Every access code in the plan, both kinds: two credentials must never be the same string. */
const takenCodes = (plan: Plan): Set<string> =>
  new Set([...plan.volunteers, ...plan.organisers].map((p) => p.accessCode).filter((c) => c !== ''));

/** The references to one person that simply change name, whatever the direction. */
function rekey(plan: Plan, from: PersonKind, fromKey: string, to: PersonKind, toKey: string): Plan {
  const phase = (p: Plan['montage']) => ({
    ...p,
    assignments: p.assignments.map(
      (a): PhaseAssignment =>
        a.personKind === from && a.personKey === fromKey ? { ...a, personKind: to, personKey: toKey } : a,
    ),
  });
  return {
    ...plan,
    montage: phase(plan.montage),
    demontage: phase(plan.demontage),
    catering: {
      ...plan.catering,
      choices: plan.catering.choices.map((c) =>
        c.personKind === from && c.personKey === fromKey ? { ...c, personKind: to, personKey: toKey } : c,
      ),
    },
    ticketing: {
      ...plan.ticketing,
      choices: plan.ticketing.choices.map((c) =>
        c.personKind === from && c.personKey === fromKey ? { ...c, personKind: to, personKey: toKey } : c,
      ),
    },
    artists: plan.artists.map((a) => ({
      ...a,
      members: a.members.map((m) =>
        m.linkedKind === from && m.linkedKey === fromKey ? { ...m, linkedKind: to, linkedKey: toKey } : m,
      ),
    })),
  };
}

/** What the phase boxes and hand-ticked meals amount to, for the two lists shown before confirming. */
function commonCarried(plan: Plan, kind: PersonKind, key: string): string[] {
  const boxes = [plan.montage, plan.demontage].reduce(
    (n, p) => n + p.assignments.filter((a) => a.personKind === kind && a.personKey === key).length,
    0,
  );
  const meals = plan.catering.choices.filter((c) => c.personKind === kind && c.personKey === key).length;
  const door = plan.ticketing.choices.some((c) => c.personKind === kind && c.personKey === key);
  const acts = plan.artists.filter((a) => a.members.some((m) => m.linkedKind === kind && m.linkedKey === key));
  const out: string[] = [];
  if (boxes > 0) out.push(`${boxes} ${plural(boxes, 'case', 'cases')} de montage ou de démontage, aux mêmes heures.`);
  if (meals > 0) out.push(`${meals} ${plural(meals, 'repas choisi', 'repas choisis')} à la main au catering.`);
  if (door) out.push("Le ticket, le bracelet, les tickets boisson et la remarque choisis pour l'entrée.");
  if (acts.length > 0) out.push(`Son lien avec ${acts.map((a) => a.name).join(', ')}.`);
  return out;
}

/**
 * What the catering hands the person before and after, said when it changes.
 *
 * The two kinds are fed by different rules (a bénévole by the hours worked, an orga by a floor
 * that lifts), so a conversion can take somebody from two meals to none without a single box
 * moving. Asked of the catering itself rather than predicted here, so the sentence is the figure
 * the caterer will read. Silent when the catering is off: there is nothing to hand anybody.
 */
function feedingChange(before: Plan, kind: PersonKind, key: string, after: Plan, newKind: PersonKind, newKey: string): string[] {
  if (!before.catering.rules.enabled) return [];
  const find = (plan: Plan, k: PersonKind, personKey: string) =>
    cateringReport(plan, new PlanIndex(plan)).people.find((p) => p.kind === k && p.key === personKey);
  const was = find(before, kind, key);
  const will = find(after, newKind, newKey);
  const meals = [was?.serviceKeys.length ?? 0, will?.serviceKeys.length ?? 0] as const;
  const drinks = [was?.drinks ?? 0, will?.drinks ?? 0] as const;
  if (meals[0] === meals[1] && drinks[0] === drinks[1]) return [];
  return [
    `Selon les règles du catering pour ${newKind === 'orga' ? 'les orgas' : 'les bénévoles'}: repas ${meals[0]} → ${meals[1]}, tickets boisson ${drinks[0]} → ${drinks[1]}.`,
  ];
}

/**
 * The conversion of one person to the other kind, with the plan it would produce.
 *
 * Pure: the screen calls it once to show the two lists, and applies `plan` only on confirmation.
 * An unknown person, or somebody who already exists in the other list under the same identity,
 * comes back `blocked` with the plan untouched.
 */
export function convertPerson(plan: Plan, kind: PersonKind, key: string): Conversion {
  return kind === 'benevole' ? volunteerToOrganiser(plan, key) : organiserToVolunteer(plan, key);
}

function refused(plan: Plan, toKind: PersonKind, name: string, why: string): Conversion {
  return { toKind, newKey: '', name, carried: [], lost: [], blocked: why, plan };
}

function volunteerToOrganiser(plan: Plan, key: string): Conversion {
  const v = plan.volunteers.find((x) => x.key === key);
  if (!v) return refused(plan, 'orga', '', "Ce bénévole n'est plus dans le plan.");
  const name = fullName(v) || 'Sans nom';

  const identity = organiserIdentity(v.firstName, v.lastName, v.email);
  const twin = plan.organisers.find((o) => organiserIdentity(o.firstName, o.lastName, o.email) === identity);
  if (twin) {
    return refused(
      plan,
      'orga',
      name,
      `${fullName(twin)} est déjà orga avec ${v.email.trim() !== '' ? 'la même adresse' : 'le même nom'}: il y aurait deux fiches pour une personne. Retirer l'une des deux d'abord.`,
    );
  }

  const slug = normalise(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'orga';
  const newKey = freeKey(new Set(plan.organisers.map((o) => o.key)), `resp-${slug}`, '-');
  const polePath = (poleKey: string): string => plan.poles.find((p) => p.key === poleKey)?.path ?? poleKey;

  // The form's answers, kept as the text an orga's note already is: nothing the person said is
  // thrown away by a change of file.
  const answers = [
    v.nickname.trim() !== '' ? `Surnom: ${v.nickname.trim()}` : '',
    v.availabilityNote.trim() !== '' ? `Contrainte horaire: ${v.availabilityNote.trim()}` : '',
    v.choices.length > 0
      ? `Pôles demandés: ${v.choices.map((c) => (c.poleKey !== '' ? polePath(c.poleKey) : c.raw.trim())).join(', ')}`
      : '',
    v.montage.note.trim() !== '' ? `Montage: ${v.montage.note.trim()}` : '',
    v.demontage.note.trim() !== '' ? `Démontage: ${v.demontage.note.trim()}` : '',
  ].filter((part) => part !== '');

  // A presence "without hours" is the whole window opened to the bénévoles, as the phases read it.
  const montageFrom = v.montage.present
    ? Math.min(...(v.montage.windows.length > 0 ? v.montage.windows.map((w) => w.start) : [plan.montage.volunteersFrom]))
    : null;
  const demontageUntil = v.demontage.present
    ? Math.max(...(v.demontage.windows.length > 0 ? v.demontage.windows.map((w) => w.end) : [plan.demontage.volunteersUntil]))
    : null;

  const organiser: Organiser = {
    key: newKey,
    firstName: v.firstName,
    lastName: v.lastName,
    email: v.email,
    phone: v.phone,
    // A credential is never moved between two kinds of access. See `giveOrganiserCode`.
    accessCode: '',
    diet: v.diet,
    allergies: v.allergies,
    note: answers.join(' · '),
    montageFrom,
    demontageUntil,
    montagePoleKeys: [],
    demontagePoleKeys: [],
  };

  const mine = plan.assignments.filter((a) => a.volunteerKey === key);
  const orgaShifts = [...plan.organiserShifts];
  const takenShiftKeys = new Set(orgaShifts.map((s) => s.key));
  for (const a of mine) {
    if (orgaShifts.some((s) => s.organiserKey === newKey && s.shiftKey === a.shiftKey)) continue;
    const shiftKey = freeKey(takenShiftKeys, `${newKey}-${a.shiftKey}`, '-');
    takenShiftKeys.add(shiftKey);
    orgaShifts.push({ key: shiftKey, organiserKey: newKey, shiftKey: a.shiftKey });
  }

  const pairs = [...plan.buddies, ...plan.dismissedBuddies].filter((b) => b.fromKey === key || b.toKey === key);
  const buddyNames = [
    ...new Set(
      plan.buddies
        .filter((b) => b.fromKey === key || b.toKey === key)
        .map((b) => (b.fromKey === key ? b.toKey : b.fromKey))
        .map((other) => fullName(plan.volunteers.find((x) => x.key === other) ?? { firstName: other, lastName: '' })),
    ),
  ];

  const carried = [
    'Nom, adresse e-mail, téléphone, régime et allergies.',
    ...(answers.length > 0 ? ['Ses réponses au formulaire, recopiées dans les remarques de l\'orga.'] : []),
    ...(mine.length > 0
      ? [`${mine.length} ${plural(mine.length, "créneau de l'exploit, gardé", "créneaux de l'exploit, gardés")} comme ${plural(mine.length, 'place', 'places')} d'orga.`]
      : []),
    ...(montageFrom !== null || demontageUntil !== null
      ? ['Sa présence au montage et au démontage, en arrivée et en départ.']
      : []),
    ...commonCarried(plan, 'benevole', key),
  ];
  const lost = [
    "Son code d'accès bénévole ne fonctionnera plus. Un code orga se donne depuis la carte Orgas des Réglages.",
    'Aucune règle d\'heures ne s\'applique plus: volume, préférence, refus et choix de pôles ne comptent plus.',
    ...(buddyNames.length > 0 ? [`${plural(buddyNames.length, 'Binôme retiré', 'Binômes retirés')}: ${buddyNames.join(', ')}.`] : []),
    ...(plan.reserve.includes(key) ? ["N'est plus en liste d'attente."] : []),
  ];

  const moved = rekey(plan, 'benevole', key, 'orga', newKey);
  const next: Plan = {
    ...moved,
    volunteers: moved.volunteers.filter((x) => x.key !== key),
    organisers: [...moved.organisers, organiser],
    assignments: moved.assignments.filter((a) => a.volunteerKey !== key),
    organiserShifts: orgaShifts,
    buddies: moved.buddies.filter((b) => !pairs.includes(b)),
    dismissedBuddies: moved.dismissedBuddies.filter((b) => !pairs.includes(b)),
    reserve: moved.reserve.filter((k) => k !== key),
  };
  lost.push(...feedingChange(plan, 'benevole', key, next, 'orga', newKey));

  return { toKind: 'orga', newKey, name, carried, lost, blocked: null, plan: next };
}

function organiserToVolunteer(plan: Plan, key: string): Conversion {
  const o = plan.organisers.find((x) => x.key === key);
  if (!o) return refused(plan, 'benevole', '', "Cet orga n'est plus dans le plan.");
  const name = fullName(o) || 'Sans nom';

  const identity = volunteerIdentity(o.firstName, o.lastName, o.email);
  const twin = plan.volunteers.find((v) => volunteerIdentity(v.firstName, v.lastName, v.email) === identity);
  if (twin) {
    return refused(
      plan,
      'benevole',
      name,
      `${fullName(twin)} est déjà bénévole avec ${o.email.trim() !== '' ? 'la même adresse' : 'le même nom'}: il y aurait deux fiches pour une personne. Retirer l'une des deux d'abord.`,
    );
  }

  // The identity the form import would give this person, so that the day they fill the form in,
  // the import recognises them instead of adding a second bénévole.
  const newKey = freeKey(new Set(plan.volunteers.map((v) => v.key)), identity, '#');

  const places = plan.organiserShifts.filter((s) => s.organiserKey === key);
  const shiftHours = new Map(plan.shifts.map((s) => [s.key, s.end - s.start]));
  const placedHours = places.reduce((total, s) => total + (shiftHours.get(s.shiftKey) ?? 0), 0);
  // A placeholder the fiche says is one: the smallest option the event offers that covers what
  // they already hold, or the largest when none does. Never zero, which the base refuses.
  const options = [...plan.volume.options].filter((h) => h > 0).sort((a, b) => a - b);
  const requestedHours = options.find((h) => h >= placedHours) ?? options[options.length - 1] ?? Math.max(4, placedHours);

  const roles = plan.leaderRoles.filter((r) => r.organiserKey === key);
  const roleNames = [...new Set(roles.map((r) => plan.poles.find((p) => p.key === r.poleKey)?.path ?? r.poleKey))];

  const montage =
    o.montageFrom === null
      ? absentFromPhase()
      : { present: true, note: '', windows: [{ start: o.montageFrom, end: plan.montage.lengthHours }] };
  const demontage =
    o.demontageUntil === null
      ? absentFromPhase()
      : { present: true, note: '', windows: [{ start: 0, end: o.demontageUntil }] };
  const closedPhases = [
    montage.present && plan.montage.enabled && !plan.montage.volunteersAllowed ? plan.montage.label || 'Montage' : '',
    demontage.present && plan.demontage.enabled && !plan.demontage.volunteersAllowed ? plan.demontage.label || 'Démontage' : '',
  ].filter((label) => label !== '');

  const volunteer: Volunteer = {
    key: newKey,
    firstName: o.firstName,
    lastName: o.lastName,
    nickname: '',
    email: o.email,
    phone: o.phone,
    accessCode: newAccessCode(takenCodes(plan), VOLUNTEER_CODE_LENGTH),
    diet: o.diet,
    allergies: o.allergies,
    requestedHours,
    preferredSlotId: null,
    refusedSlotIds: [],
    availabilityNote: '',
    refusedPoleKeys: [],
    choices: [],
    artistKeys: [],
    buddyRawNames: [],
    manualFields: [],
    needsReview: true,
    reviewReasons: [
      `Passé·e d'orga à bénévole à la main: le volume (${requestedHours} h), les tranches refusées et les choix de pôles sont à renseigner.`,
    ],
    montage,
    demontage,
    enteredByHand: true,
    // An orga was already part of the event: turning them into a bénévole does not put them back
    // among the undecided candidatures.
    status: 'valide',
  };

  const assignments: Assignment[] = [
    ...plan.assignments,
    ...places
      .filter((s, at) => places.findIndex((other) => other.shiftKey === s.shiftKey) === at)
      .map((s): Assignment => ({ volunteerKey: newKey, shiftKey: s.shiftKey, locked: true, source: 'manual' })),
  ];

  const carried = [
    'Nom, adresse e-mail, téléphone, régime et allergies.',
    ...(places.length > 0
      ? [`${places.length} ${plural(places.length, "place sur un créneau de l'exploit, gardée et verrouillée", "places sur des créneaux de l'exploit, gardées et verrouillées")}: le solveur ne ${plural(places.length, 'la', 'les')} déplacera pas.`]
      : []),
    ...(montage.present || demontage.present ? ['Sa présence au montage et au démontage.'] : []),
    ...commonCarried(plan, 'orga', key),
  ];
  const lost = [
    "Son code d'accès orga ne fonctionnera plus. Un code bénévole est créé: à lui envoyer.",
    `Les règles des bénévoles s'appliquent désormais. La fiche part « À relire »: volume fixé à ${requestedHours} h, tranches refusées et choix de pôles à renseigner.`,
    ...(roleNames.length > 0 ? [`N'est plus ${plural(roleNames.length, 'responsable du pôle', 'responsable des pôles')}: ${roleNames.join(', ')}.`] : []),
    ...(o.note.trim() !== '' ? [`Ses remarques d'orga ne sont pas reprises: « ${o.note.trim()} ».`] : []),
    ...(closedPhases.length > 0
      ? [`${closedPhases.join(' et ')} ${plural(closedPhases.length, "n'est pas ouvert", "ne sont pas ouverts")} aux bénévoles: ses cases y seront signalées.`]
      : []),
  ];

  const moved = rekey(plan, 'orga', key, 'benevole', newKey);
  const next: Plan = {
    ...moved,
    organisers: moved.organisers.filter((x) => x.key !== key),
    volunteers: [...moved.volunteers, volunteer],
    leaderRoles: moved.leaderRoles.filter((r) => r.organiserKey !== key),
    organiserShifts: moved.organiserShifts.filter((s) => s.organiserKey !== key),
    assignments,
  };
  lost.push(...feedingChange(plan, 'orga', key, next, 'benevole', newKey));

  return { toKind: 'benevole', newKey, name, carried, lost, blocked: null, plan: next };
}
