/**
 * Every way the régisseur can change a plan, as pure functions.
 *
 * Two rules hold everywhere in this file, and they come straight from the brief:
 *
 *   - Nothing is silently dropped or reassigned. A move removes one named assignment and adds
 *     one named assignment, and nothing else in the plan is touched.
 *   - No SCHEDULING rule is checked here. An edit that breaks one is applied and then shown in
 *     red by `validate`. The tool must show the régisseur what they just did, never refuse the
 *     edit.
 *
 * A hand-made assignment is `source: 'manual'`, which is how a later re-solve can tell it apart
 * from its own work.
 *
 * THE LOCK IS THE ONE THING THESE FUNCTIONS REFUSE, and it is not a scheduling rule: it is the
 * régisseur's own earlier decision, recorded. "A locked box never moves, not by the solver and
 * not by the régisseur" has been the invariant since the grid was designed, but until now only
 * the solver honoured it: a locked box could still be dragged, swapped, binned, or wiped by
 * putting its owner on the reserve. It is enforced here rather than in the screens so no future
 * screen can get it wrong, and the way to move a locked place is to unlock it first, which is
 * one click and an explicit change of mind.
 */

import { EDITABLE_FIELDS, type Assignment, type EditableField, type FormMapping, type Plan, type Volunteer } from '../engine.ts';

const sameAssignment = (a: Assignment, volunteerKey: string, shiftKey: string): boolean =>
  a.volunteerKey === volunteerKey && a.shiftKey === shiftKey;

/** True when this exact box is pinned. Every refusal below is this question. */
export const isLockedBox = (plan: Plan, volunteerKey: string, shiftKey: string): boolean =>
  plan.assignments.some((a) => sameAssignment(a, volunteerKey, shiftKey) && a.locked);

/** True when the person holds any pinned box, so wiping their day would break one. */
export const holdsLockedBox = (plan: Plan, volunteerKey: string): boolean =>
  plan.assignments.some((a) => a.volunteerKey === volunteerKey && a.locked);

/** Adds a box. Off the reserve too: being placed and being held back are exclusive. */
export function assign(plan: Plan, volunteerKey: string, shiftKey: string): Plan {
  if (plan.assignments.some((a) => sameAssignment(a, volunteerKey, shiftKey))) return plan;
  const added: Assignment = { volunteerKey, shiftKey, locked: false, source: 'manual' };
  return {
    ...plan,
    assignments: [...plan.assignments, added],
    reserve: plan.reserve.filter((key) => key !== volunteerKey),
  };
}

/** Takes a box away. Refused on a locked one: unlock it first. */
export function unassign(plan: Plan, volunteerKey: string, shiftKey: string): Plan {
  if (isLockedBox(plan, volunteerKey, shiftKey)) return plan;
  return {
    ...plan,
    assignments: plan.assignments.filter((a) => !sameAssignment(a, volunteerKey, shiftKey)),
  };
}

/**
 * Moves one person from one shift to another.
 *
 * Refused when the box is locked. An earlier version carried the lock along with the person, on
 * the reasoning that dragging a pinned box was the régisseur changing their own mind. It is not:
 * the point of pinning a place is that nothing moves it by accident, and a drag across a dense
 * grid is exactly the accident it guards against. Unlocking is one click and says so out loud.
 */
export function move(plan: Plan, volunteerKey: string, fromShiftKey: string, toShiftKey: string): Plan {
  if (fromShiftKey === toShiftKey) return plan;
  if (isLockedBox(plan, volunteerKey, fromShiftKey)) return plan;
  const source = plan.assignments.find((a) => sameAssignment(a, volunteerKey, fromShiftKey));
  if (!source) return assign(plan, volunteerKey, toShiftKey);
  if (plan.assignments.some((a) => sameAssignment(a, volunteerKey, toShiftKey))) {
    return unassign(plan, volunteerKey, fromShiftKey);
  }
  return {
    ...plan,
    assignments: plan.assignments.map((a) =>
      sameAssignment(a, volunteerKey, fromShiftKey)
        ? { ...a, shiftKey: toShiftKey, source: 'manual' as const }
        : a,
    ),
    reserve: plan.reserve.filter((key) => key !== volunteerKey),
  };
}

/**
 * Exchanges two people between two shifts, in one step.
 *
 * Done as two separate moves this would pass through a state where one shift is over its
 * headcount, which would flash red for no reason and pollute the undo stack with a state the
 * régisseur never asked for. One edit in, one edit out.
 */
export function swap(
  plan: Plan,
  first: { volunteerKey: string; shiftKey: string },
  second: { volunteerKey: string; shiftKey: string },
): Plan {
  if (first.shiftKey === second.shiftKey) return plan;
  // An exchange moves both boxes, so either one being pinned refuses the whole gesture. Half an
  // exchange would be worse than none: it would leave one shift over its headcount.
  if (
    isLockedBox(plan, first.volunteerKey, first.shiftKey) ||
    isLockedBox(plan, second.volunteerKey, second.shiftKey)
  ) {
    return plan;
  }

  // Either of them may already hold the shift they are being sent to: a volunteer working two
  // shifts can have one box dragged onto somebody standing in the other. Moving them there
  // anyway would put the same person on the same shift twice, which is the `doublon` rule. The
  // honest reading of the gesture is that they give up the box they were dragged from and stay
  // where they already are, so the assignment is dropped rather than duplicated.
  const holds = (volunteerKey: string, shiftKey: string): boolean =>
    plan.assignments.some((a) => sameAssignment(a, volunteerKey, shiftKey));

  const firstWouldDuplicate = holds(first.volunteerKey, second.shiftKey);
  const secondWouldDuplicate = holds(second.volunteerKey, first.shiftKey);

  const assignments: Assignment[] = [];
  for (const a of plan.assignments) {
    if (sameAssignment(a, first.volunteerKey, first.shiftKey)) {
      if (!firstWouldDuplicate) {
        assignments.push({ ...a, shiftKey: second.shiftKey, source: 'manual' });
      }
      continue;
    }
    if (sameAssignment(a, second.volunteerKey, second.shiftKey)) {
      if (!secondWouldDuplicate) {
        assignments.push({ ...a, shiftKey: first.shiftKey, source: 'manual' });
      }
      continue;
    }
    assignments.push(a);
  }

  return { ...plan, assignments };
}

export function setLocked(plan: Plan, volunteerKey: string, shiftKey: string, locked: boolean): Plan {
  return {
    ...plan,
    assignments: plan.assignments.map((a) =>
      sameAssignment(a, volunteerKey, shiftKey) ? { ...a, locked } : a,
    ),
  };
}

/**
 * Puts someone on the reserve, or takes them off it.
 *
 * Reserve means zero hours on purpose, so joining it removes every assignment the person had.
 * That is the point: the reserve exists so "we did not need you in the end" is a sentence
 * somebody can actually say, and a reserve volunteer holding two shifts would make it a lie.
 * The removed assignments are visible in the undo stack, never silent.
 */
export function setReserve(plan: Plan, volunteerKey: string, reserve: boolean): Plan {
  if (reserve) {
    // Joining the reserve gives up every shift, pinned ones included, so it is refused outright
    // rather than half-applied. Unlock the place first, or leave them where they are.
    if (holdsLockedBox(plan, volunteerKey)) return plan;
    return {
      ...plan,
      assignments: plan.assignments.filter((a) => a.volunteerKey !== volunteerKey),
      reserve: plan.reserve.includes(volunteerKey) ? plan.reserve : [...plan.reserve, volunteerKey],
    };
  }
  return { ...plan, reserve: plan.reserve.filter((key) => key !== volunteerKey) };
}

/**
 * Changes how many boxes a shift draws.
 *
 * Lowering it below the number of people already there is allowed, and shows up as `sureffectif`
 * in red. Removing somebody to make the figures agree is the régisseur's decision, not this
 * function's.
 */
export function setHeadcount(plan: Plan, shiftKey: string, headcount: number): Plan {
  const clamped = Math.max(0, Math.round(headcount));
  return {
    ...plan,
    shifts: plan.shifts.map((s) => (s.key === shiftKey ? { ...s, headcount: clamped } : s)),
  };
}

/** Every unlocked assignment goes; the locked ones stay exactly where the régisseur put them. */
export function clearUnlocked(plan: Plan): Plan {
  return { ...plan, assignments: plan.assignments.filter((a) => a.locked) };
}

/**
 * Sets the colour a pole is drawn in, or clears it back to the default palette.
 *
 * Presentation, and stored on the pole so it travels with the plan rather than living in one
 * régisseur's browser. Nothing in the engine reads it.
 */
export function setPoleColour(plan: Plan, poleKey: string, colour: string | null): Plan {
  return {
    ...plan,
    poles: plan.poles.map((p) =>
      p.key === poleKey ? { ...p, colour: colour ?? undefined } : p,
    ),
  };
}

/**
 * Correcting an answer on somebody’s fiche, by hand.
 *
 * WHY A RÉGISSEUR EDITS AN ANSWER AT ALL. Two questions on the form are free text since
 * 2026-09-10: the time constraint, and the "Autre" box beside each pole choice. The importer
 * reads them and can be wrong, so every reading it is unsure of lands on the fiche as a doubt
 * and somebody settles it here. What is stored is a correction of the tool’s reading, never a
 * rewriting of what the person said: the sentence they typed is kept untouched beside it.
 *
 * EVERY FIELD TOUCHED IS RECORDED IN `manualFields`, and that list is what a re-import reads
 * before overwriting anything. Without it, the next export would quietly undo the correction
 * and nobody would be told. See `mergeWithManual` in the engine.
 *
 * No scheduling rule is checked here, like everywhere else in this file. Marking somebody
 * unavailable on a slot they are already placed in is allowed, and turns their box red.
 */
export function correctVolunteer(
  plan: Plan,
  volunteerKey: string,
  patch: Partial<Pick<Volunteer, EditableField>>,
): Plan {
  const fields = (Object.keys(patch) as EditableField[]).filter((field) =>
    (EDITABLE_FIELDS as readonly string[]).includes(field),
  );
  if (fields.length === 0) return plan;

  return {
    ...plan,
    volunteers: plan.volunteers.map((volunteer) => {
      if (volunteer.key !== volunteerKey) return volunteer;
      const marked = new Set<EditableField>(volunteer.manualFields);
      for (const field of fields) marked.add(field);
      return {
        ...volunteer,
        ...patch,
        // Kept in the order the type declares them, so two fiches corrected in a different
        // order still compare equal and a save does not look like a change.
        manualFields: EDITABLE_FIELDS.filter((field) => marked.has(field)),
      };
    }),
  };
}

/**
 * "J’ai relu cette fiche": the tag goes, the corrections stay.
 *
 * The only way `needsReview` is ever cleared, and it is deliberately a human action rather
 * than a consequence of editing: a régisseur may open a flagged fiche, read the sentence, and
 * conclude the parser had it right all along. That is a review with no correction in it, and
 * it has to be expressible or the queue never empties.
 *
 * The reasons go with the tag. They describe a doubt that has now been settled, and keeping
 * them would make the fiche look unresolved forever.
 */
export function markReviewed(plan: Plan, volunteerKey: string): Plan {
  return {
    ...plan,
    volunteers: plan.volunteers.map((volunteer) =>
      volunteer.key === volunteerKey
        ? { ...volunteer, needsReview: false, reviewReasons: [] }
        : volunteer,
    ),
  };
}

/** Sends a fiche back to the queue by hand, for a doubt the tool did not raise. */
export function markToReview(plan: Plan, volunteerKey: string, reason: string): Plan {
  return {
    ...plan,
    volunteers: plan.volunteers.map((volunteer) =>
      volunteer.key === volunteerKey
        ? {
            ...volunteer,
            needsReview: true,
            reviewReasons: [...volunteer.reviewReasons, reason],
          }
        : volunteer,
    ),
  };
}

/**
 * Remembers which Google Sheet the answers come from.
 *
 * Written when an import from a sheet succeeds, and only then: a link that fetched nothing is
 * not a source worth offering to refresh. A file import never touches it, because a CSV
 * somebody downloaded once is not somewhere the tool can go back to on its own.
 */
/**
 * A binôme added by hand, from a fiche: `from` asked to work with `to`. Marked manual so a
 * re-import keeps it, and taken back out of the removed pairs if it had been removed before.
 */
export function addBuddy(plan: Plan, fromKey: string, toKey: string): Plan {
  if (fromKey === toKey) return plan;
  const same = (b: { fromKey: string; toKey: string }) => b.fromKey === fromKey && b.toKey === toKey;
  if (plan.buddies.some(same)) return plan;
  return {
    ...plan,
    buddies: [...plan.buddies, { fromKey, toKey, manual: true }],
    dismissedBuddies: plan.dismissedBuddies.filter((b) => !same(b)),
  };
}

/**
 * A binôme removed by hand. One that came from the form is remembered as removed, so the next
 * import of the same answer does not bring it back; one added by hand simply goes.
 */
export function removeBuddy(plan: Plan, fromKey: string, toKey: string): Plan {
  const same = (b: { fromKey: string; toKey: string }) => b.fromKey === fromKey && b.toKey === toKey;
  const pair = plan.buddies.find(same);
  if (!pair) return plan;
  return {
    ...plan,
    buddies: plan.buddies.filter((b) => !same(b)),
    dismissedBuddies: pair.manual ? plan.dismissedBuddies : [...plan.dismissedBuddies, { fromKey, toKey }],
  };
}

/**
 * The import correspondence the régisseur settled on, remembered on the event so the next export
 * of the same form reads the same way. Saved with the import it was made for, never on its own.
 */
export function setFormMapping(plan: Plan, formMapping: FormMapping): Plan {
  return { ...plan, formMapping };
}

export function rememberSheet(plan: Plan, url: string): Plan {
  const trimmed = url.trim();
  return trimmed === plan.sheetUrl ? plan : { ...plan, sheetUrl: trimmed };
}

// ---------------------------------------------------------------------------
// Orgas in a créneau of the exploit
// ---------------------------------------------------------------------------

/**
 * Puts an orga in a créneau, by hand.
 *
 * The one way an orga ever lands in the exploit: the solver never places one, and the régisseur
 * decided on 2026-09-10 that it would stay that way. What it changes for everybody else is one
 * thing, and the engine handles it on its own: the créneau needs one volunteer fewer. See
 * `PlanIndex.headcountOf`.
 *
 * No rule is checked. An orga already busy elsewhere at that hour is placed and the overlap is
 * reported, exactly as a volunteer's would be.
 */
export function addOrganiserToShift(plan: Plan, organiserKey: string, shiftKey: string): Plan {
  if (plan.organiserShifts.some((r) => r.organiserKey === organiserKey && r.shiftKey === shiftKey)) {
    return plan;
  }
  const taken = new Set(plan.organiserShifts.map((r) => r.key));
  let key = `${organiserKey}-${shiftKey}`;
  for (let n = 2; taken.has(key); n++) key = `${organiserKey}-${shiftKey}-${n}`;
  return {
    ...plan,
    organiserShifts: [...plan.organiserShifts, { key, organiserKey, shiftKey }],
  };
}

/**
 * Moves an orga from one créneau to another, which is what dragging their box does.
 *
 * One function rather than a remove followed by an add at the call site, for the same reason
 * `move` exists beside `unassign` and `assign`: the two halves must land in the undo stack as one
 * entry. Undoing a move that was recorded twice takes the person off the plan and stops, which
 * reads as the tool losing them.
 */
export function moveOrganiserToShift(
  plan: Plan,
  organiserKey: string,
  fromShiftKey: string,
  toShiftKey: string,
): Plan {
  if (fromShiftKey === toShiftKey) return plan;
  return addOrganiserToShift(
    removeOrganiserFromShift(plan, organiserKey, fromShiftKey),
    organiserKey,
    toShiftKey,
  );
}

/** Takes an orga back out of a créneau. The place it held goes back to the volunteers. */
export function removeOrganiserFromShift(plan: Plan, organiserKey: string, shiftKey: string): Plan {
  return {
    ...plan,
    organiserShifts: plan.organiserShifts.filter(
      (r) => !(r.organiserKey === organiserKey && r.shiftKey === shiftKey),
    ),
  };
}
