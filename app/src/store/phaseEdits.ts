/**
 * The edits the montage and the démontage take: their settings, their poles, their événements
 * and the placements the régisseur makes by hand.
 *
 * A SEPARATE FILE FROM `setupEdits.ts` AND `edits.ts`, on purpose. Those two are the exploit's:
 * they know about headcounts, locks, the reserve and the solver's proposals, and every one of
 * those is meaningless here. A phase has no rule to break, nothing is proposed and nothing is
 * solved, so an edit is exactly what it says and never produces a suggestion to validate.
 *
 * What it keeps from them is the promise of the whole project: nothing is silently dropped or
 * reassigned. Deleting a pole of a phase says how many placements go with it before it does it,
 * and no function here ever moves somebody to tidy the grid up.
 *
 * A DECLARATION WRITES BOXES, since 2026-09-11. Somebody who filled in the form saying they are
 * there from Thursday is placed from Thursday, one box per worked day, in the pole they named or
 * in Général. It used to be drawn without being written, as a dashed "presence" beside the solid
 * decisions, and that distinction answered a question nobody was asking. What the declaration is
 * still the reference for is `phaseIssues`: a box outside it turns red.
 *
 * The two functions that write from a declaration are deliberately different. `syncPerson`
 * REPLACES one person's boxes and is called when that person's own answer changes, which is the
 * only moment their old boxes are known to be stale. `placeDeclared` only ADDS what is missing
 * and never touches an existing box, which is what an import and the toolbar button use: they
 * run over everybody, and everybody includes people the régisseur has already arranged by hand.
 */

import { GENERAL_POLE_KEY, alignPhases, declaredPlacements, phasePeople } from '../engine.ts';
import type {
  Organiser,
  PersonKind,
  Phase,
  PhaseAssignment,
  PhaseEvent,
  PhaseId,
  PhasePole,
  PhasePresence,
  Plan,
  Volunteer,
} from '../engine.ts';

/** "Déchargement camion" becomes "dechargement-camion". Same rule as the poles' keys. */
const slug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function freeKey(taken: ReadonlySet<string>, base: string): string {
  const root = base === '' ? 'element' : base;
  if (!taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const phaseOf = (plan: Plan, id: PhaseId): Phase =>
  id === 'montage' ? plan.montage : plan.demontage;

/** Puts a rebuilt phase back on the plan. The one place that knows which field holds which. */
export function withPhase(plan: Plan, id: PhaseId, phase: Phase): Plan {
  return id === 'montage' ? { ...plan, montage: phase } : { ...plan, demontage: phase };
}

const edit = (plan: Plan, id: PhaseId, change: (phase: Phase) => Phase): Plan =>
  withPhase(plan, id, change(phaseOf(plan, id)));

// ---------------------------------------------------------------------------
// The phase's own settings
// ---------------------------------------------------------------------------

/**
 * The dates, the nights, the half-day split and the window opened to the bénévoles.
 *
 * SHORTENING A PHASE DOES NOT DELETE ANYTHING. A placement that now falls past the end stays
 * exactly where it is and is drawn off the grid's right edge as an out-of-range box, which the
 * screen reports. Cutting somebody's day in half because a date was mistyped, and having no way
 * back, is precisely the silent loss this project refuses.
 *
 * THE START IS ALWAYS STORED AS A FULL INSTANT, and the hour of this project's worst bug so far
 * was lost for want of that. Réglages builds the field's value as `2027-03-10T08:00`, a wall
 * clock with no zone, which `new Date()` reads in the régisseur's own time zone: correct on
 * screen. That same string then travelled to Postgres, where `::timestamptz` reads a naked
 * wall clock in the SESSION's zone, and a Supabase session is UTC. So 08:00 Paris was saved as
 * 08:00 UTC and came back as 09:00 Paris: the phase moved an hour forward under boxes that did
 * not move with it, every one of them ended up an hour past the end of its worked day, and the
 * whole montage turned red with "jusqu'à 1h". `toISOString` here is what makes the offset
 * explicit, so the string means one moment to both sides. `setEventStart` has always done it,
 * which is why the exploit never had the bug.
 *
 * ONE EDGE IS NOT THE RÉGISSEUR'S, since 2026-09-13: the montage ends where the event starts and
 * the démontage starts where it ends. Whatever this is handed, `alignPhases` has the last word
 * on that edge, so a montage's `lengthHours` or a démontage's `startISO` passed here is simply
 * overruled by the event.
 */
export function setPhase(plan: Plan, id: PhaseId, over: Partial<Phase>): Plan {
  const fixed: Partial<Phase> =
    over.startISO === undefined ? over : { ...over, startISO: asInstant(over.startISO) };
  return alignPhases(edit(plan, id, (phase) => ({ ...phase, ...fixed, id: phase.id })));
}

/** A date the user typed, as an instant. An unreadable one is left alone rather than zeroed. */
const asInstant = (value: string): string => {
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? value : when.toISOString();
};

/** Turns a phase on or off. Off hides it everywhere and keeps every row it holds. */
export function setPhaseEnabled(plan: Plan, id: PhaseId, enabled: boolean): Plan {
  return setPhase(plan, id, { enabled });
}

// ---------------------------------------------------------------------------
// Poles
// ---------------------------------------------------------------------------

export function addPhasePole(plan: Plan, id: PhaseId, name: string): Plan {
  const trimmed = name.trim();
  if (trimmed === '') return plan;
  return edit(plan, id, (phase) => {
    const key = freeKey(new Set(phase.poles.map((p) => p.key)), slug(trimmed));
    return { ...phase, poles: [...phase.poles, { key, name: trimmed }] };
  });
}

export function setPhasePole(
  plan: Plan,
  id: PhaseId,
  poleKey: string,
  over: Partial<PhasePole>,
): Plan {
  return edit(plan, id, (phase) => ({
    ...phase,
    poles: phase.poles.map((p) => (p.key === poleKey ? { ...p, ...over, key: p.key } : p)),
  }));
}

/** What deleting this pole would cost: the placements standing in it. Général never goes. */
export function phasePoleRemoval(
  plan: Plan,
  id: PhaseId,
  poleKey: string,
): { placements: number; deletable: boolean } {
  const phase = phaseOf(plan, id);
  return {
    placements: phase.assignments.filter((a) => a.poleKey === poleKey).length,
    deletable: poleKey !== GENERAL_POLE_KEY,
  };
}

/**
 * Deletes a pole of the phase and every placement in it.
 *
 * The people themselves are untouched: an orga whose pole disappears is drawn in Général the
 * next moment, because their presence is a fact about them and not about the pole. Their
 * declared pole key is cleared too, so nothing keeps pointing at something that is gone.
 */
export function deletePhasePole(plan: Plan, id: PhaseId, poleKey: string): Plan {
  if (poleKey === GENERAL_POLE_KEY) return plan;
  const field = id === 'montage' ? 'montagePoleKeys' : 'demontagePoleKeys';
  const withoutPole = edit(plan, id, (phase) => ({
    ...phase,
    poles: phase.poles.filter((p) => p.key !== poleKey),
    assignments: phase.assignments.filter((a) => a.poleKey !== poleKey),
  }));
  return {
    ...withoutPole,
    organisers: withoutPole.organisers.map((o) =>
      o[field].includes(poleKey) ? { ...o, [field]: o[field].filter((k) => k !== poleKey) } : o,
    ),
  };
}

export function movePhasePole(plan: Plan, id: PhaseId, poleKey: string, direction: -1 | 1): Plan {
  return edit(plan, id, (phase) => {
    const poles = [...phase.poles];
    const from = poles.findIndex((p) => p.key === poleKey);
    const to = from + direction;
    // Général holds the first row and stays there: it is where the grid puts everybody who has
    // not been placed, so a régisseur reading the grid always finds it in the same place.
    if (from < 1 || to < 1 || to >= poles.length) return phase;
    [poles[from], poles[to]] = [poles[to]!, poles[from]!];
    return { ...phase, poles };
  });
}

/**
 * Copies the montage's poles onto the démontage, keeping what is already there.
 *
 * The régisseur asked for the two lists to be separate and for one button to save typing the
 * same six teams twice. A pole whose key already exists is left alone rather than overwritten:
 * this adds, it never rewrites what the démontage has already been given.
 */
export function copyMontagePoles(plan: Plan): Plan {
  const known = new Set(plan.demontage.poles.map((p) => p.key));
  const added = plan.montage.poles.filter((p) => !known.has(p.key));
  if (added.length === 0) return plan;
  return { ...plan, demontage: { ...plan.demontage, poles: [...plan.demontage.poles, ...added] } };
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

export function addPhaseEvent(
  plan: Plan,
  id: PhaseId,
  label: string,
  start: number,
  end: number,
  headcount: number,
): Plan {
  const trimmed = label.trim();
  if (trimmed === '' || end <= start) return plan;
  return edit(plan, id, (phase) => ({
    ...phase,
    events: [
      ...phase.events,
      {
        key: freeKey(new Set(phase.events.map((e) => e.key)), slug(trimmed)),
        label: trimmed,
        start,
        end,
        headcount: Math.max(0, Math.round(headcount)),
      },
    ],
  }));
}

export function setPhaseEvent(
  plan: Plan,
  id: PhaseId,
  eventKey: string,
  over: Partial<PhaseEvent>,
): Plan {
  return edit(plan, id, (phase) => ({
    ...phase,
    events: phase.events.map((e) => (e.key === eventKey ? { ...e, ...over, key: e.key } : e)),
  }));
}

/** Deletes an événement and the placements in it. The count is `phaseEventRemoval`. */
export function deletePhaseEvent(plan: Plan, id: PhaseId, eventKey: string): Plan {
  return edit(plan, id, (phase) => ({
    ...phase,
    events: phase.events.filter((e) => e.key !== eventKey),
    assignments: phase.assignments.filter((a) => a.eventKey !== eventKey),
  }));
}

export function phaseEventRemoval(plan: Plan, id: PhaseId, eventKey: string): number {
  return phaseOf(plan, id).assignments.filter((a) => a.eventKey === eventKey).length;
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

/** Where a placement puts somebody: a pole of the phase, or one of its événements. */
export type PhaseTarget = { kind: 'pole'; poleKey: string } | { kind: 'event'; eventKey: string };

/**
 * Puts somebody in a pole or an événement for a window.
 *
 * TOUCHING WINDOWS IN THE SAME PLACE MERGE. Clicking Thursday morning and then Thursday
 * afternoon in the same pole is one box from 8h to minuit, not two abutting ones: the régisseur
 * drew one intention, and two rows would then have to be dragged, shortened and deleted twice.
 * Overlapping windows in DIFFERENT places do not merge and are reported as a clash instead,
 * because that is a question only a human can answer.
 */
export function placePerson(
  plan: Plan,
  id: PhaseId,
  person: { kind: PersonKind; key: string },
  target: PhaseTarget,
  start: number,
  end: number,
): Plan {
  if (end <= start) return plan;
  const poleKey = target.kind === 'pole' ? target.poleKey : '';
  const eventKey = target.kind === 'event' ? target.eventKey : '';

  return edit(plan, id, (phase) => {
    const mine = (a: PhaseAssignment): boolean =>
      a.personKey === person.key &&
      a.personKind === person.kind &&
      a.poleKey === poleKey &&
      a.eventKey === eventKey;

    const touching = phase.assignments.filter(
      (a) => mine(a) && a.start <= end && start <= a.end,
    );
    const merged = {
      start: Math.min(start, ...touching.map((a) => a.start)),
      end: Math.max(end, ...touching.map((a) => a.end)),
    };
    const gone = new Set(touching.map((a) => a.key));

    return {
      ...phase,
      assignments: [
        ...phase.assignments.filter((a) => !gone.has(a.key)),
        {
          key: freeKey(
            new Set(phase.assignments.map((a) => a.key)),
            `${person.key}-${poleKey || eventKey}`,
          ),
          personKind: person.kind,
          personKey: person.key,
          poleKey,
          eventKey,
          start: merged.start,
          end: merged.end,
        },
      ],
    };
  });
}

/**
 * Takes a window out of every decision already made about this person, whatever it said.
 *
 * The piece that makes a drag mean what a régisseur expects. Dropping somebody on Friday
 * afternoon in Scène has to take Friday afternoon away from wherever they were, or the grid
 * would show them in two places and report a clash the régisseur never made. A decision that
 * straddles the window is CUT rather than deleted: moving somebody for one afternoon leaves
 * their morning and their evening exactly where they were.
 */
function cutWindow(
  phase: Phase,
  person: { kind: PersonKind; key: string },
  start: number,
  end: number,
): PhaseAssignment[] {
  const kept: PhaseAssignment[] = [];

  for (const a of phase.assignments) {
    const mine = a.personKey === person.key && a.personKind === person.kind;
    if (!mine || a.end <= start || a.start >= end) {
      kept.push(a);
      continue;
    }
    if (a.start < start) kept.push({ ...a, key: `${a.key}-av`, end: start });
    if (a.end > end) kept.push({ ...a, key: `${a.key}-ap`, start: end });
  }

  return kept;
}

/**
 * Puts somebody in one place for one window, and nowhere else during it.
 *
 * What a click on a half-day and a drag between two cells both do. Empty target: the window goes
 * back to being drawn from the person's own declared presence, which is the pole they said they
 * work in, or Général.
 */
export function assignWindow(
  plan: Plan,
  id: PhaseId,
  person: { kind: PersonKind; key: string },
  target: PhaseTarget | null,
  start: number,
  end: number,
): Plan {
  if (end <= start) return plan;
  const cut = withPhase(plan, id, {
    ...phaseOf(plan, id),
    assignments: cutWindow(phaseOf(plan, id), person, start, end),
  });
  return target === null ? cut : placePerson(cut, id, person, target, start, end);
}

/**
 * Writes the boxes a declaration asks for, for everybody, without touching a single existing one.
 *
 * ADDITIVE ON PURPOSE. It runs over the whole phase, after an import or on the régisseur's
 * button, and most of the people it walks past have already been arranged by hand. A day where
 * somebody already has a box, whatever that box says, is a day this function leaves alone.
 */
export function placeDeclared(plan: Plan, id: PhaseId): Plan {
  const phase = phaseOf(plan, id);
  const added: PhaseAssignment[] = [];
  const taken = new Set(phase.assignments.map((a) => a.key));

  for (const person of phasePeople(phase, plan.organisers, plan.volunteers)) {
    const mine = phase.assignments.filter(
      (a) => a.personKey === person.key && a.personKind === person.kind,
    );
    for (const want of declaredPlacements(person)) {
      const covered = mine.some((a) => a.start < want.end && want.start < a.end);
      if (covered) continue;
      const key = freeKey(taken, `${person.key}-${want.poleKey}`);
      taken.add(key);
      added.push({
        key,
        personKind: person.kind,
        personKey: person.key,
        poleKey: want.poleKey,
        eventKey: '',
        start: want.start,
        end: want.end,
      });
    }
  }

  if (added.length === 0) return plan;
  return withPhase(plan, id, { ...phase, assignments: [...phase.assignments, ...added] });
}

/** How many boxes `placeDeclared` would write. Zero means everybody is already placed. */
export function declaredToPlace(plan: Plan, id: PhaseId): number {
  const before = phaseOf(plan, id).assignments.length;
  return phaseOf(placeDeclared(plan, id), id).assignments.length - before;
}

/**
 * Replaces one person's boxes with the ones their declaration now asks for.
 *
 * CALLED WHEN THAT PERSON'S ANSWER CHANGES, and only then: their arrival moved, so the boxes
 * that came from the old arrival are about a day they are no longer there for. Leaving them
 * would leave red boxes for the régisseur to clear one by one, which is work the tool created.
 *
 * THEIR ÉVÉNEMENTS ARE KEPT. Being asked to unload the truck is not something a declaration has
 * an opinion about, and dropping it here would lose a decision somebody took on purpose.
 */
export function syncPerson(
  plan: Plan,
  id: PhaseId,
  person: { kind: PersonKind; key: string },
): Plan {
  const phase = phaseOf(plan, id);
  const mine = (a: PhaseAssignment): boolean =>
    a.personKey === person.key && a.personKind === person.kind;

  const kept = phase.assignments.filter((a) => !mine(a) || a.eventKey !== '');
  const taken = new Set(kept.map((a) => a.key));
  const found = phasePeople(phase, plan.organisers, plan.volunteers).find(
    (p) => p.kind === person.kind && p.key === person.key,
  );

  const written: PhaseAssignment[] = (found ? declaredPlacements(found) : []).map((want) => {
    const key = freeKey(taken, `${person.key}-${want.poleKey}`);
    taken.add(key);
    return {
      key,
      personKind: person.kind,
      personKey: person.key,
      poleKey: want.poleKey,
      eventKey: '',
      start: want.start,
      end: want.end,
    };
  });

  return withPhase(plan, id, { ...phase, assignments: [...kept, ...written] });
}

/** Moves or resizes one placement. Nothing else on the grid moves with it. */
export function setPhaseAssignment(
  plan: Plan,
  id: PhaseId,
  key: string,
  over: Partial<PhaseAssignment>,
): Plan {
  return edit(plan, id, (phase) => ({
    ...phase,
    assignments: phase.assignments.map((a) =>
      a.key === key ? { ...a, ...over, key: a.key } : a,
    ),
  }));
}

/**
 * Takes one decision back.
 *
 * The person does not leave the grid: they go back to being drawn wherever their own declared
 * presence puts them, which is the pole they said they work in, or Général. Removing a box is
 * undoing a decision, never removing somebody from the montage.
 */
export function removePhaseAssignment(plan: Plan, id: PhaseId, key: string): Plan {
  return edit(plan, id, (phase) => ({
    ...phase,
    assignments: phase.assignments.filter((a) => a.key !== key),
  }));
}

// ---------------------------------------------------------------------------
// What each person declared
// ---------------------------------------------------------------------------

/** An orga's arrival, departure and poles for one phase. */
export function setOrganiserPhase(
  plan: Plan,
  organiserKey: string,
  id: PhaseId,
  over: { at?: number | null; poleKeys?: string[] },
): Plan {
  const when = id === 'montage' ? 'montageFrom' : 'demontageUntil';
  const poles = id === 'montage' ? 'montagePoleKeys' : 'demontagePoleKeys';
  const declared = {
    ...plan,
    organisers: plan.organisers.map((o) => {
      if (o.key !== organiserKey) return o;
      const next: Organiser = { ...o };
      if (over.at !== undefined) next[when] = over.at;
      if (over.poleKeys !== undefined) next[poles] = [...over.poleKeys];
      return next;
    }),
  };
  /*
   * ONLY A CHANGE OF DATE REWRITES THE BOXES. An arrival that moves makes yesterday's boxes
   * about days this person is no longer there for, so they are rebuilt. A change of POLE does
   * not: the boxes already on the grid may have been put where they are on purpose, pole by pole
   * and day by day, and throwing that away to follow a form answer would undo somebody's work.
   * The declared pole still shows up, as the reason a box that disagrees with it is drawn in red.
   */
  if (over.at === undefined) return declared;
  return syncPerson(declared, id, { kind: 'orga', key: organiserKey });
}

/**
 * A bénévole's answer about one phase, as corrected by the régisseur.
 *
 * MARKED AS A CORRECTION, so a re-import of the same export never puts the old reading back.
 * The sentence the person wrote is not touched by this: it is evidence, and the correction is a
 * reading of it. Same doctrine as every other correctable answer.
 *
 * IT WRITES NO BOX, since 2026-09-12, and that is the whole difference with `setOrganiserPhase`
 * beside it. A bénévole's answer is a willingness and not a presence, so nothing is drawn from
 * it: see `declaredPlacements`. It follows that this must not CLEAR their boxes either, which
 * `syncPerson` would have done. Somebody the régisseur dragged onto Thursday stays on Thursday
 * when their answer is corrected; if the correction now contradicts that box, the box turns red
 * and says so, which is the tool's job here rather than deciding for anybody.
 */
export function setVolunteerPhase(
  plan: Plan,
  volunteerKey: string,
  id: PhaseId,
  presence: Partial<PhasePresence>,
): Plan {
  const declared = {
    ...plan,
    volunteers: plan.volunteers.map((v) => {
      if (v.key !== volunteerKey) return v;
      const before = id === 'montage' ? v.montage : v.demontage;
      const after: PhasePresence = { ...before, ...presence, note: before.note };
      const marked: Volunteer = {
        ...v,
        [id]: after,
        manualFields: v.manualFields.includes(id) ? v.manualFields : [...v.manualFields, id],
      };
      return marked;
    }),
  };
  return declared;
}
