/**
 * Who is still to place, as one row type whichever of the three moments is asking.
 *
 * WHY THE COMPUTATION LEFT THE COMPONENT. The exploit's pool and the phases' pool asked the same
 * question of two different models, and each answered it inside its own JSX: one read
 * `ValidationResult`, the other walked `phasePeople` against `phase.assignments`. The two then
 * drifted, in the only way that matters, over what "disponible" means. Here both produce a
 * `PoolRow`, one panel draws them, and the difference between the two is a function you can read
 * in one screen and a test can call without rendering anything.
 *
 * "DISPONIBLE" MEANS THE SAME THING IN BOTH: somebody who has hours they offered and that nobody
 * has used yet. On the exploit that is the volume they asked for, minus what they are down for.
 * On a phase it is the presence they declared for the day being looked at, minus the boxes that
 * already cover it. `zero` is the sharper version of the same fact, "nothing at all yet", and it
 * is a MARK on a row rather than a list of its own: a tab called "À zéro" was a second copy of
 * this list filtered down, and the régisseur had to check both to be sure they had seen everybody.
 */

import {
  phaseDays,
  phasePeople,
  subtractWindows,
  windowHours,
  type PersonKind,
  type Phase,
  type PhaseId,
  type Plan,
  type PlanIndex,
  type ValidationResult,
  type Volunteer,
} from '../engine.ts';
import { organiserName } from './labels.ts';
import { volumeText } from './layout.ts';
import type { Selection } from './selection.ts';

/** One line of a pool, ready to draw. */
export interface PoolRow {
  /** Unique inside its list, and what React keys on. */
  id: string;
  kind: PersonKind;
  /** The person's own key in their own file. `id` is not it: two files may share a key. */
  personKey: string;
  /** What clicking it puts in the info pane. */
  selection: Selection;
  name: string;
  /** The right-hand figure: "3 h libres", "4 h à placer". */
  meta: string;
  /** Nothing placed at all yet. Drawn as a mark, since "À zéro" is no longer a tab. */
  zero: boolean;
  /** The importer was not sure about this fiche. */
  review: boolean;
  /** The hover text, which is where the detail that does not fit on one line goes. */
  title: string;
}

/**
 * Everybody with hours left to give on the exploit, most first, then the orgas.
 *
 * THE ORGAS ARE IN THIS LIST SINCE 2026-09-12, and they are the reason it has two halves. A
 * bénévole is "disponible" against a figure they gave, the volume they asked for, so the list
 * orders them by what is left of it. An orga gave no volume and is under no hour rule at all, so
 * there is nothing to be short of and no figure to sort on: they are always available, and they
 * come after, by name, with what they already hold written beside them. Mixing the two on an
 * invented number would have ordered the orgas by an answer none of them ever gave.
 *
 * The panel's "Qui" filter is what separates them when the régisseur wants one kind only.
 */
export function exploitPoolRows(index: PlanIndex, report: ValidationResult): PoolRow[] {
  const plan = index.plan;

  const orgas = [...plan.organisers]
    .map((orga): PoolRow => {
      const mine = plan.organiserShifts.filter((s) => s.organiserKey === orga.key);
      const hours = mine.reduce((total, held) => {
        const shift = index.shiftByKey.get(held.shiftKey);
        return total + (shift ? shift.end - shift.start : 0);
      }, 0);
      const roles = index.polesLedBy(orga.key);
      const name = organiserName(orga);
      return {
        id: `orga-${orga.key}`,
        personKey: orga.key,
        kind: 'orga',
        selection: { kind: 'orga', organiserKey: orga.key },
        name,
        meta: mine.length === 0 ? 'aucun créneau' : `${fmt(hours)} placées`,
        zero: mine.length === 0 && roles.length === 0,
        review: false,
        title:
          `${name}\nOrga: aucune règle d'heures, jamais placé·e par le solveur.\n` +
          `${mine.length} créneau(x), responsable de ${roles.length} pôle(s)\n` +
          "Glisser sur un créneau pour y tenir une place, ou sur la frise d'un pôle pour en être responsable 2 h",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const benevoles = report.volunteers
    .filter((v) => !v.reserve && (v.assignedHours < v.requestedTotalHours || v.assignedHours === 0))
    .sort(
      (a, b) =>
        b.requestedTotalHours - b.assignedHours - (a.requestedTotalHours - a.assignedHours) ||
        a.name.localeCompare(b.name, 'fr'),
    )
    .map((entry) => {
      const volunteer = index.volunteerByKey.get(entry.key);
      const left = Math.max(0, entry.requestedTotalHours - entry.assignedHours);
      return {
        id: entry.key,
        personKey: entry.key,
        kind: 'benevole' as PersonKind,
        selection: { kind: 'benevole', volunteerKey: entry.key } as Selection,
        name: entry.name,
        meta: `${fmt(left)} libres`,
        zero: entry.assignedHours === 0,
        review: volunteer?.needsReview === true,
        title: volunteer
          ? `${entry.name}\n${volumeText(volunteer.requestedHours, index.dayMode)} demandées, ${fmt(entry.assignedHours)} placées\n` +
            choicesText(index, volunteer) +
            `Glisser sur un créneau`
          : entry.name,
      };
    });

  return [...benevoles, ...orgas];
}

/**
 * Everybody on site for a phase with presence nobody has placed yet.
 *
 * `dayIndex` null is the whole phase. The day filter also decides what "to place" means:
 * somebody placed all Thursday is gone from Thursday's list and still in Friday's.
 */
export function phasePoolRows(
  plan: Plan,
  index: PlanIndex,
  id: PhaseId,
  dayIndex: number | null,
): PoolRow[] {
  const phase: Phase = id === 'montage' ? plan.montage : plan.demontage;
  const bounds =
    dayIndex === null
      ? null
      : (phaseDays(phase).find((day) => day.index === dayIndex)?.segments ?? null);

  return phasePeople(phase, plan.organisers, plan.volunteers)
    .map((person): PoolRow & { free: number } => {
      const declared = bounds === null ? person.presence : clip(person.presence, bounds);
      const mine = phase.assignments.filter(
        (a) => a.personKey === person.key && a.personKind === person.kind,
      );
      const left = subtractWindows(declared, mine);
      const free = windowHours(left);
      const placed = windowHours(declared) - free;

      const volunteer = person.kind === 'benevole' ? index.volunteerByKey.get(person.key) : undefined;
      const name =
        person.kind === 'orga'
          ? (() => {
              const found = plan.organisers.find((o) => o.key === person.key);
              return found ? organiserName(found) : person.key;
            })()
          : index.volunteerShortName(person.key);

      return {
        id: `${person.kind}-${person.key}`,
        personKey: person.key,
        kind: person.kind,
        selection:
          person.kind === 'orga'
            ? { kind: 'orga', organiserKey: person.key }
            : { kind: 'benevole', volunteerKey: person.key },
        name,
        meta: `${fmt(free)} à placer`,
        zero: placed < 0.01,
        review: volunteer?.needsReview === true,
        title:
          `${name}\n${fmt(free)} à placer sur ${fmt(windowHours(declared))} déclarée(s)\n` +
          'Glisser sur un pôle',
        free,
      };
    })
    .filter((row) => row.free > 0.01)
    .sort((a, b) => b.free - a.free || a.name.localeCompare(b.name, 'fr'));
}

const clip = (
  windows: readonly { start: number; end: number }[],
  bounds: readonly { start: number; end: number }[],
): Array<{ start: number; end: number }> =>
  windows.flatMap((w) =>
    bounds
      .map((b) => ({ start: Math.max(w.start, b.start), end: Math.min(w.end, b.end) }))
      .filter((piece) => piece.end > piece.start),
  );

/** "4 h", "2 h 30". Local, because the engine's own formatter is about the exploit's hours. */
const fmt = (hours: number): string => {
  const whole = Math.floor(hours + 1e-9);
  const minutes = Math.round((hours - whole) * 60);
  return minutes === 0 ? `${whole} h` : `${whole} h ${minutes}`;
};

/** One line per choice, for a tooltip: numbered on a ranked event, bulleted on an unranked one. */
export function choicesText(index: PlanIndex, volunteer: Volunteer): string {
  if (volunteer.choices.length === 0) return 'Aucun choix de pôle\n';
  const ranked = index.plan.poleChoicesRanked !== false;
  return volunteer.choices
    .map((c, i) => `${ranked ? `Choix ${i + 1}` : 'Choix'}: ${c.poleKey !== '' ? index.polePath(c.poleKey) : `« ${c.raw.trim()} »`}\n`)
    .join('');
}

/**
 * Why a person passes the pool's « Pôle demandé » filter. Drawn as a chip on the row: the
 * position of the choice that matches (0 is the first), or « responsable ».
 */
export type PoleMatch = number | 'responsable';

/**
 * How a person relates to a pole of the exploit, or null when they do not.
 *
 * A choice on "Bar" covers "Bar / Réassort" and the other way round, so a régisseur picking either
 * finds the same people. A bénévole answers through their choices, in order; an orga has no
 * choice and answers through the poles they are responsable of.
 */
export function poleMatchOf(
  index: PlanIndex,
  kind: PersonKind,
  personKey: string,
  poleKey: string,
): PoleMatch | null {
  const related = (other: string): boolean =>
    other !== '' && (index.isUnder(poleKey, other) || index.isUnder(other, poleKey));
  if (kind === 'benevole') {
    const volunteer = index.volunteerByKey.get(personKey);
    if (!volunteer) return null;
    const at = volunteer.choices.findIndex((c) => related(c.poleKey));
    return at < 0 ? null : at;
  }
  return index.polesLedBy(personKey).some((role) => related(role.poleKey)) ? 'responsable' : null;
}
