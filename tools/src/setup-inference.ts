/**
 * Préparer un événement depuis son formulaire, 2026-09-16.
 *
 * WHY. Setting an event up by hand before its first import means typing the pole names the form
 * uses, the event's dates, the montage days, the night tranche, the competences and the side
 * activities, each spelled exactly as the form spells them or the import stops recognising the
 * answers. The régisseur asked for the first import to propose all of it, validated before
 * anything is written, then corrected in Réglages if needed.
 *
 * WHAT IT READS, all from the export itself and nothing assumed about any event:
 *
 *   dates            the arrival and departure questions (« arriver vendredi 18 Septembre ? »),
 *                    at the earliest arrival hour and the latest departure hour anybody wrote
 *   montage          the days ticked in « Quels jours es-tu dispo sur le montage ? »
 *   démontage        the same for the démontage
 *   pôles            the distinct answers of the choice columns, with how many chose each
 *   nuits            « shifts de nuit ? (entre 3h et 7h) » becomes day and night tranches tiling
 *                    the event, one night tranche per night, all sharing the word the question uses
 *   compétences      the yes / no competence question's subject, and well-known certificates
 *                    (permis B, CACES, PSC1...) that several people wrote
 *   activités        yes / no columns no field reads that ask about a pré-montage or a weekend
 *   étapes           the tags of a status column the orga keeps left of the timestamp
 *                    (« Email de confirmation envoyé, Présence reconfirmée »)
 *
 * PURE AND NEVER APPLIED HERE. It returns a proposal; the app shows it with a box per item and
 * applies only what is ticked, as one undoable edit (`app/src/store/setupFromForm.ts`).
 */

import type { EventSlot, Pole } from './model.js';
import { alignPhases, type Plan } from './plan.js';
import { bindForm, fromHeaderRow, parseCsv, parseSubmittedAt, sideActivityColumns, yesNo } from './import.js';
import type { FormMapping } from './form-mapping.js';
import { datesIn } from './presence-days.js';
import { normalise } from './text.js';

export interface SetupProposal {
  /** The event's dates, or null when the form names no arrival or departure day. */
  event: { startISO: string; lengthHours: number; from: string; to: string } | null;
  /** The first day bénévoles tick for the montage, at 8h, or null. The end is the event's start. */
  montage: { startISO: string; days: number } | null;
  /** How long the démontage runs after the event, to the end of the last day ticked, or null. */
  demontage: { lengthHours: number; days: number } | null;
  /**
   * The pole names the choice columns use, most chosen first, each with every answer it covers as
   * typed. `suggested` is false for a name only one person wrote (prose in an « Autre » box).
   */
  poles: Array<{ name: string; answers: string[]; count: number; suggested: boolean }>;
  /** Day and night tranches tiling the event, or null when the form asks no night question. */
  slots: EventSlot[] | null;
  skills: string[];
  sideActivities: string[];
  applicationSteps: string[];
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** The local instant of a calendar day and hour, in the year that follows the first answers. */
function instant(year: number, month: number, day: number, hour: number): Date {
  return new Date(year, month - 1, day, Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
}

const clockHours = (text: string): number[] =>
  [...normalise(text).matchAll(/(\d{1,2})\s*h\s*(\d{2})?/g)]
    .map((m) => Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0))
    .filter((h) => h <= 24);

const WEEKDAY = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const dayName = (d: Date): string => `${WEEKDAY[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Certificates and trades that are worth a tag when several people write them, as written. */
const KNOWN_SKILLS = ['Permis B', 'Permis C', 'Permis BE', 'CACES', 'Nacelle', 'Cariste', 'BAFA', 'PSC1', 'PSE1', 'SST', 'Électricien', 'Électricienne', 'Menuisier', 'Soudure', 'Plombier', 'Ingé son', 'Régisseur', 'Cuisinier', 'Barman', 'Infirmier', 'Infirmière'];

export function inferSetup(csvText: string, mapping?: FormMapping): SetupProposal {
  const rows = fromHeaderRow(parseCsv(csvText));
  const headers = rows[0] ?? [];
  const body = rows.slice(1);
  const binding = bindForm(headers, mapping);
  const column = (index: number | undefined | null): string[] =>
    index === undefined || index === null ? [] : body.map((r) => (r[index] ?? '').trim()).filter((v) => v !== '');

  // The year: the first submission's, moved on a year when the named day is already past then.
  const firstSubmission = Math.min(
    ...column(binding.map.submittedAt).map((v) => parseSubmittedAt(v)).filter((t): t is number => t !== null),
  );
  const reference = Number.isFinite(firstSubmission) ? new Date(firstSubmission) : new Date();
  const yearFor = (month: number, day: number): number => {
    const y = reference.getUTCFullYear();
    return instant(y, month, day, 23.99).getTime() < reference.getTime() ? y + 1 : y;
  };

  // --- Dates -----------------------------------------------------------------------------
  const header = (index: number | undefined): string => (index === undefined ? '' : headers[index] ?? '');
  const arrivalDay = datesIn(header(binding.map.arrival))[0];
  const departureDay = datesIn(header(binding.map.departure))[0];
  let event: SetupProposal['event'] = null;
  if (arrivalDay && departureDay) {
    const arrivals = column(binding.map.arrival).flatMap(clockHours);
    const departures = column(binding.map.departure).flatMap(clockHours);
    const startHour = arrivals.length > 0 ? Math.min(...arrivals) : 12;
    const endHour = departures.length > 0 ? Math.max(...departures) : 20;
    const start = instant(yearFor(arrivalDay.month, arrivalDay.day), arrivalDay.month, arrivalDay.day, startHour);
    const end = instant(yearFor(departureDay.month, departureDay.day), departureDay.month, departureDay.day, endHour);
    const lengthHours = Math.round(((end.getTime() - start.getTime()) / 3600_000) * 4) / 4;
    if (lengthHours > 0 && lengthHours <= 168) {
      event = { startISO: start.toISOString(), lengthHours, from: `${dayName(start)} ${pad(start.getHours())}h`, to: `${dayName(end)} ${pad(end.getHours())}h` };
    }
  }

  // --- Montage and démontage ---------------------------------------------------------------
  const daysOf = (index: number | undefined): Date[] => {
    const seen = new Map<string, Date>();
    for (const answer of column(index)) {
      for (const d of datesIn(answer)) seen.set(`${d.month}-${d.day}`, instant(yearFor(d.month, d.day), d.month, d.day, 0));
    }
    return [...seen.values()].sort((a, b) => a.getTime() - b.getTime());
  };
  const montageDays = daysOf(binding.map.montage);
  const montage = montageDays.length > 0
    ? { startISO: new Date(montageDays[0]!.getTime() + 8 * 3600_000).toISOString(), days: montageDays.length }
    : null;
  const demontageDays = daysOf(binding.map.demontage);
  let demontage: SetupProposal['demontage'] = null;
  if (event && demontageDays.length > 0) {
    const eventEnd = new Date(event.startISO).getTime() + event.lengthHours * 3600_000;
    const lastDayEnd = demontageDays[demontageDays.length - 1]!.getTime() + 24 * 3600_000;
    const lengthHours = Math.round((lastDayEnd - eventEnd) / 3600_000);
    if (lengthHours > 0) demontage = { lengthHours, days: demontageDays.length };
  }

  // --- Poles -------------------------------------------------------------------------------
  const byKey = new Map<string, { spellings: Map<string, number>; count: number }>();
  for (const c of binding.choices) {
    for (const answer of column(c.pole)) {
      const key = normalise(answer);
      if (key === '' || /^(aucun|tout me va|rien|non|autre)\b/.test(key)) continue;
      const entry = byKey.get(key) ?? { spellings: new Map(), count: 0 };
      entry.count++;
      entry.spellings.set(answer, (entry.spellings.get(answer) ?? 0) + 1);
      byKey.set(key, entry);
    }
  }
  /*
   * One answer that starts another, word for word (« Maraude » and « Maraude (Réduction des
   * risques) », « Bar » and « Bar ambulant »), is the same pole: the less chosen joins the more
   * chosen, and its spelling becomes one more answer the pole reads.
   */
  const groups = [...byKey.entries()]
    .map(([key, e]) => ({ key, spellings: e.spellings, count: e.count }))
    .sort((a, b) => b.count - a.count);
  const merged: typeof groups = [];
  for (const g of groups) {
    const host = merged.find((m) => m.key.startsWith(`${g.key} `) || g.key.startsWith(`${m.key} `));
    if (host) {
      host.count += g.count;
      for (const [s, n] of g.spellings) host.spellings.set(s, (host.spellings.get(s) ?? 0) + n);
    } else {
      merged.push({ ...g, spellings: new Map(g.spellings) });
    }
  }
  const poles = merged
    .map((g) => {
      const spellings = [...g.spellings.entries()].sort((a, b) => b[1] - a[1]);
      // The name without its explanation: « Brigade verte (nettoyage site...) » is « Brigade verte ».
      const shortest = spellings.map(([s]) => s).sort((a, b) => a.length - b.length)[0]!;
      const bare = spellings[0]![0].replace(/\s*\(.*\)\s*$/, '').replace(/\s+/g, ' ').trim();
      const name = bare.length >= 3 ? bare : shortest.trim();
      return { name, answers: spellings.map(([s]) => s), count: g.count, suggested: g.count >= 2 };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));

  // --- Night tranches ----------------------------------------------------------------------
  let slots: SetupProposal['slots'] = null;
  const nightHeader = normalise(header(binding.map.slotComfort));
  const nightHours = /entre (\d{1,2}) ?h\w* et (\d{1,2}) ?h/.exec(nightHeader);
  if (event && nightHours) {
    const [from, to] = [Number(nightHours[1]), Number(nightHours[2])];
    const start = new Date(event.startISO);
    const offset = (d: Date): number => (d.getTime() - start.getTime()) / 3600_000;
    const tranches: EventSlot[] = [];
    let cursor = 0;
    for (let day = 0; day <= Math.ceil(event.lengthHours / 24) + 1; day++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day);
      const nightStart = offset(instant(date.getFullYear(), date.getMonth() + 1, date.getDate(), from));
      const nightEnd = offset(instant(date.getFullYear(), date.getMonth() + 1, date.getDate(), to));
      if (nightEnd <= 0 || nightStart >= event.lengthHours) continue;
      const eve = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
      if (nightStart > cursor) {
        tranches.push({ id: `jour-${tranches.length + 1}`, label: `Journée ${dayName(eve.getTime() + 24 * 3600_000 >= start.getTime() && nightStart - cursor > 12 ? new Date(start.getTime() + cursor * 3600_000) : eve)}`, start: cursor, end: nightStart });
      }
      const s = Math.max(0, nightStart);
      const e = Math.min(event.lengthHours, nightEnd);
      tranches.push({ id: `nuit-${tranches.length + 1}`, label: `Nuit ${dayName(eve)} (${from}h-${to}h)`, start: s, end: e });
      cursor = e;
    }
    if (cursor < event.lengthHours) {
      tranches.push({ id: `jour-${tranches.length + 1}`, label: `Journée ${dayName(new Date(start.getTime() + cursor * 3600_000))}`, start: cursor, end: event.lengthHours });
    }
    if (tranches.some((t) => t.id.startsWith('nuit'))) slots = tranches;
  }

  // --- Competences -------------------------------------------------------------------------
  const skills: string[] = [];
  const checkHeader = header(binding.map.skillCheck);
  const subject = /competences? en ([a-z ]+?)\s*$/.exec(normalise(checkHeader));
  if (subject) {
    // The subject as the header writes it, accents kept: the words after « en ».
    const raw = checkHeader.replace(/\s*\?\s*$/, '').split(/\ben\b/i).pop()!.trim();
    skills.push(capitalise(raw || subject[1]!));
  }
  const skillAnswers = column(binding.map.skills).map((a) => ` ${normalise(a)} `);
  for (const known of KNOWN_SKILLS) {
    const token = ` ${normalise(known)} `;
    if (skillAnswers.filter((a) => a.includes(token)).length >= 2) skills.push(known);
  }

  // --- Side activities ---------------------------------------------------------------------
  const used = new Set<number>([
    ...Object.values(binding.map).filter((i): i is number => typeof i === 'number'),
    ...binding.choices.flatMap((c) => [c.pole, ...(c.level === null ? [] : [c.level])]),
  ]);
  const firstAnswer = Math.max(0, headers.findIndex((h) => /horodat|timestamp/.test(normalise(h))));
  const sideActivities: string[] = [];
  headers.forEach((h, i) => {
    if (i < firstAnswer || used.has(i)) return;
    const answers = column(i);
    if (answers.length === 0 || answers.filter((a) => yesNo(a) !== null).length < answers.length * 0.8) return;
    const n = normalise(h);
    if (/pre ?montage/.test(n)) sideActivities.push('Pré-montage');
    else {
      // From the header as written, accents kept: « week-end déco », « week-end préparation du site ».
      const weekend = /week[-\s]?ends?\s+([\p{L}']+(?:\s+(?:du|de la|des)\s+[\p{L}']+)?)/iu.exec(h);
      if (weekend) sideActivities.push(`Week-end ${weekend[1]}`);
    }
  });
  // Only what the import would then actually read: a label no column holds reads nobody.
  const readable = sideActivityColumns(headers, binding, sideActivities.map((label) => ({ key: label, label }))).map((c) => c.key);

  // --- Application steps -------------------------------------------------------------------
  const steps = new Map<string, number>();
  headers.forEach((h, i) => {
    if (i >= firstAnswer || !/statut/.test(normalise(h))) return;
    for (const cell of column(i)) {
      for (const tag of cell.split(',').map((t) => t.trim()).filter(Boolean)) {
        if (/^(valide|annule|liste d attente)/.test(normalise(tag))) continue;
        steps.set(tag, (steps.get(tag) ?? 0) + 1);
      }
    }
  });
  const applicationSteps = [...steps.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([t]) => t);

  return { event, montage, demontage, poles, slots, skills: [...new Set(skills)], sideActivities: readable, applicationSteps };
}

/** What the régisseur ticked: a flag per section, and the pole names kept (renamed or not). */
export interface SetupChoice {
  event: boolean;
  montage: boolean;
  demontage: boolean;
  /** The poles to create, by their index in `proposal.poles`, with the name to give them. */
  poles: Array<{ index: number; name: string }>;
  slots: boolean;
  skills: string[];
  sideActivities: string[];
  applicationSteps: boolean;
}

const slugOf = (label: string): string =>
  label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const freeKey = (base: string, taken: Set<string>): string => {
  const root = base === '' ? 'item' : base;
  let key = root;
  for (let n = 2; taken.has(key); n++) key = `${root}-${n}`;
  taken.add(key);
  return key;
};

/**
 * The plan with what was ticked written in, as one change. Adds, never removes: a pole already
 * there with the same name is reused, and every answer a created or reused pole covers is written
 * into the form correspondence (`formMapping.answers.pole`), so renaming the pole later in Réglages
 * never loses the match. The event and both phases go through `alignPhases`.
 */
export function applySetup(plan: Plan, proposal: SetupProposal, choice: SetupChoice): Plan {
  let next: Plan = { ...plan };

  if (choice.event && proposal.event) {
    next = { ...next, startISO: proposal.event.startISO, lengthHours: proposal.event.lengthHours };
  }
  next = alignPhases(next);
  if (choice.montage && proposal.montage) {
    next = alignPhases({
      ...next,
      montage: { ...next.montage, enabled: true, startISO: proposal.montage.startISO, volunteersAllowed: true, volunteersFrom: 0 },
    });
  }
  if (choice.demontage && proposal.demontage) {
    const lengthHours = proposal.demontage.lengthHours;
    next = alignPhases({
      ...next,
      demontage: { ...next.demontage, enabled: true, lengthHours, volunteersAllowed: true, volunteersFrom: 0, volunteersUntil: lengthHours },
    });
  }

  if (choice.poles.length > 0) {
    const taken = new Set(next.poles.map((p) => p.key));
    const poles: Pole[] = [...next.poles];
    const answers: Record<string, string> = { ...(next.formMapping.answers.pole ?? {}) };
    for (const { index, name } of choice.poles) {
      const proposed = proposal.poles[index];
      const trimmed = name.trim();
      if (!proposed || trimmed === '') continue;
      let pole = poles.find((p) => p.parentKey === null && normalise(p.name) === normalise(trimmed));
      if (!pole) {
        pole = {
          key: freeKey(slugOf(trimmed), taken),
          name: trimmed,
          parentKey: null,
          path: trimmed,
          allowAllDebutants: false,
          minExperienced: 0,
          defaultHeadcount: 2,
        };
        poles.push(pole);
      }
      for (const answer of proposed.answers) answers[normalise(answer)] = pole.key;
    }
    next = { ...next, poles, formMapping: { ...next.formMapping, answers: { ...next.formMapping.answers, pole: answers } } };
  }

  if (choice.slots && proposal.slots) next = { ...next, slots: proposal.slots };

  const addLabels = <T extends { key: string; label: string }>(list: readonly T[], labels: string[], make: (key: string, label: string) => T): T[] => {
    const taken = new Set(list.map((x) => x.key));
    const out = [...list];
    for (const label of labels) {
      if (out.some((x) => normalise(x.label) === normalise(label))) continue;
      out.push(make(freeKey(slugOf(label), taken), label));
    }
    return out;
  };
  if (choice.skills.length > 0) next = { ...next, skills: addLabels(next.skills, choice.skills, (key, label) => ({ key, label })) };
  if (choice.sideActivities.length > 0) {
    next = { ...next, sideActivities: addLabels(next.sideActivities, choice.sideActivities, (key, label) => ({ key, label, when: '' })) };
  }
  if (choice.applicationSteps && proposal.applicationSteps.length > 0) {
    next = { ...next, applicationSteps: addLabels(next.applicationSteps, proposal.applicationSteps, (key, label) => ({ key, label })) };
  }
  return next;
}
