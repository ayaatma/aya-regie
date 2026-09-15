/**
 * The grid. The heart of the tool.
 *
 * Poles down the side, the eighteen hours of the event across the top and repeated above every
 * pole, and inside every shift one box per volunteer needed. Everything the régisseur decides
 * happens here: dragging a person from one box to another, exchanging two people, locking a
 * place so nothing can ever move it again, taking somebody off the plan. The reserve is a button
 * on the fiche and a list in Personnes, no longer a drop target here.
 *
 * Not one scheduling rule is written in this file. Legality is `isLegal`, the reason a target is
 * greyed is `blockersFor`, and which box is red is attributed by `validate` to the box itself.
 * An illegal drop is still accepted and then shown in red: the tool shows the régisseur what
 * they just did, it never refuses the edit.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  PlanIndex,
  blockersFor,
  costsFor,
  fmtHours,
  isLegal,
  type Pole,
  type Shift,
} from '../engine.ts';
import {
  addOrganiserToShift,
  assign,
  moveOrganiserToShift,
  removeOrganiserFromShift,
  move,
  setLocked,
  swap,
  unassign,
} from '../store/edits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { ShiftBlock, type VolumeBand } from '../components/ShiftBlock.tsx';
import { LaneRuler, OrganiserBand, TimeRuler } from '../components/TimeRuler.tsx';
import { PoolPanel, type PanelTab } from '../components/PoolPanel.tsx';
import { InfoPanel } from '../components/InfoPanel.tsx';
import { selectedVolunteerKey, type Selection } from '../components/selection.ts';
import { organiserName } from '../components/labels.ts';
import { DRAG_MIME, DRAG_MIME_ORGA, type DragPayload } from '../components/drag.ts';
import {
  EXPLOIT_ZOOM,
  LABEL_W,
  fitZoom,
  laneHeight,
  volumeLabel,
  volumeMark,
} from '../components/layout.ts';
import { ZoomSlider } from '../components/ZoomSlider.tsx';
import { TrashTarget } from '../components/TrashTarget.tsx';
import { poleColours } from '../components/poleColours.ts';
import { laneRows } from '../components/laneRows.ts';
import { buddiesOf, teammatesOf } from '../components/relations.ts';
import { stepCursor, type NavLanes } from '../components/gridNav.ts';
import {
  assignOrganiserToPoleAt,
  setOrganiserWindow,
  setPoleLocked,
} from '../store/setupEdits.ts';
import type { SolveMode } from '../solver/solver.worker.ts';

interface DragSession {
  payload: DragPayload;
  /** Shifts this person may legally take once their current box is out of the way. */
  legalShifts: ReadonlySet<string>;
}

/** One row of the grid: a leaf pole, under the name of its parent when it has one. */
interface Lane {
  pole: Pole;
  parentName: string | null;
  shifts: Shift[];
}

/**
 * A root pole and its lanes.
 *
 * The group is the unit of the grid's rhythm, not the lane. It carries the heading, the pole
 * colour, its own copy of the hour axis and the space that separates it from the next pole. A
 * sub-pole is a row inside its parent, not a place of its own: it borrows the colour, and it
 * does not get another ruler four rows after the last one.
 */
interface LaneGroup {
  key: string;
  title: string;
  colour: string;
  /** The solver leaves this pole alone. Says nothing about any individual box. */
  locked: boolean;
  lanes: Lane[];
}

/** "Tous les pôles", a root and its subtree, or one leaf on its own. */
const ALL_POLES = '*';

/** How long a responsable's band is when it is created by dropping an orga on a pole's frise. */
const RESPONSABLE_HOURS = 2;
/** What that drop, and both edges of the band afterwards, snap to. */
const RESPONSABLE_SNAP = 0.25;

/** Pixels left over when the grid is fitted to the screen, so no scrollbar appears on the nose. */
const FIT_SLACK = 4;

export interface GridScreenProps {
  onSolve(mode: SolveMode): void;
  solving: boolean;
  /** Which kind of run is in flight, so only that button shows a spinner. */
  solveMode: SolveMode | null;
  /**
   * Draws the grid with nothing that changes anything: no drag, no bin, no lock, no solve.
   *
   * This is ERGONOMICS, NOT SECURITY, and the distinction matters. What actually stops a pole
   * organiser writing is that they have no account: every write in the schema requires
   * `authenticated`, and the one function their code reaches is `get_organiser_planning`, which is
   * `stable`. On top of that the context they render inside has no-op `apply` and `edit`. This
   * flag exists so the screen does not OFFER what would then silently fail, which is worse than
   * not offering it. See `feature_leader_access.md`.
   */
  readOnly?: boolean;
  /** Which pole the filter starts on. A organiser opens on their own. */
  initialPoleFilter?: string;
  /**
   * The montage / exploit / démontage selector, drawn at the head of the toolbar.
   *
   * Passed in rather than built here: which moment is on screen is the question `PlanningScreen`
   * answers, and this grid is the exploit's and knows nothing about the other two. Absent on the
   * phone view and anywhere else that shows one moment only.
   */
  switcher?: React.ReactNode;
}

export function GridScreen({
  onSolve,
  solving,
  solveMode,
  readOnly = false,
  initialPoleFilter,
  switcher,
}: GridScreenProps) {
  const { plan, index, report, edit } = useLoadedPlan();

  /**
   * Pixels per hour, a number the slider sets and the fit computes. Five fixed steps before
   * 2026-09-12. See `ZoomSlider` and `fitZoom`.
   */
  const [pxPerHour, setPxPerHour] = useState<number>(EXPLOIT_ZOOM.fallback);
  /** The scrolling viewport, measured so the grid can be made to fill it exactly. */
  const scroll = useRef<HTMLDivElement>(null);
  const [gapsOnly, setGapsOnly] = useState(false);
  // A organiser opens on the pole they run. It is a starting point and not a lock: they can widen
  // it to the whole event, because the question "who is next door at 3 a.m." is one they have
  // too, and hiding the rest would answer it with silence.
  const [poleFilter, setPoleFilter] = useState<string>(initialPoleFilter ?? ALL_POLES);
  /**
   * What the panes on the right are describing: a bénévole, an orga, a créneau.
   *
   * ONE STATE AND NOT FOUR, since 2026-09-11. This used to be a volunteer key, beside a separate
   * "whose orga fiche is open" and a separate "which créneau is waiting for an orga", each with
   * its own floating panel. They could all be set at once, and then fought over the same column.
   * See `Selection`.
   */
  const [selection, setSelection] = useState<Selection | null>(null);
  const selected = selectedVolunteerKey(selection);
  const [panelTab, setPanelTab] = useState<PanelTab>('disponibles');
  const [drag, setDrag] = useState<DragSession | null>(null);
  const [dropShiftKey, setDropShiftKey] = useState<string | null>(null);
  const [dropBoxKey, setDropBoxKey] = useState<string | null>(null);
  /** The pole whose frise the pointer is over while an orga is in flight. */
  const [dropPoleKey, setDropPoleKey] = useState<string | null>(null);
  /** The box the arrow keys are standing on: which shift, and which row inside it. */
  const [cursor, setCursor] = useState<{ shiftKey: string; index: number } | null>(null);
  /** What the last key press did, said out loud for a few seconds. */
  const [keyNote, setKeyNote] = useState<string | null>(null);

  // The event declares its own length, so the grid spans the event rather than the shifts. It
  // still stretches past the end when something was left there, because hiding work somebody
  // planned is the worst possible reading of "the event is shorter than I thought".
  const eventHours = useMemo(
    () =>
      Math.max(
        plan.lengthHours,
        plan.shifts.reduce((max, s) => Math.max(max, s.end), 0),
        plan.artists.reduce((max, a) => Math.max(max, a.end), 0),
      ),
    [plan.lengthHours, plan.shifts, plan.artists],
  );

  /**
   * Make the event fill the width there is.
   *
   * Run once when the screen opens, and again whenever "Ajuster" is pressed. NOT on every window
   * resize, and not on every edit: a zoom the régisseur chose by hand is a decision, and a view
   * that silently undoes it every time the plan changes is a view that fights back.
   */
  const fit = useCallback(() => {
    const width = scroll.current?.clientWidth ?? 0;
    if (width <= 0) return;
    setPxPerHour(fitZoom(eventHours, width - LABEL_W - FIT_SLACK, EXPLOIT_ZOOM));
  }, [eventHours]);

  useLayoutEffect(() => {
    fit();
    // Once, on the way in. `fit` is re-created with `eventHours`, and re-fitting because a
    // créneau was stretched past the old end is exactly the kind of surprise ruled out above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable per plan or per validation, so the memoised shift blocks only re-render when their
  // own data actually moved.
  const lockedKeys = useMemo(
    () =>
      new Set(
        plan.assignments.filter((a) => a.locked).map((a) => `${a.volunteerKey}|${a.shiftKey}`),
      ),
    [plan.assignments],
  );

  const volumeBands = useMemo(() => {
    const map = new Map<string, VolumeBand>();
    for (const v of report.volunteers) map.set(v.key, v.volumeBand);
    return map;
  }, [report.volunteers]);

  const shiftReports = useMemo(() => new Map(report.shifts.map((s) => [s.key, s])), [report.shifts]);

  /**
   * Per créneau, which orgas in it are responsable of a pole that wants them in support.
   *
   * Asked of the plan once rather than per box: `supportOnlyBreaches` walks the roles, and the
   * boxes only need the answer. Nothing here is a refusal, and no rule of the engine reads it.
   * See `Pole.leaderSupportOnly`.
   */
  const supportOnlyByShift = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const breach of index.supportOnlyBreaches()) {
      const held = map.get(breach.shift.key) ?? new Set<string>();
      held.add(breach.organiser.key);
      map.set(breach.shift.key, held);
    }
    return map;
  }, [index]);

  /*
   * The names offered under "Chercher un bénévole", in alphabetical order.
   *
   * `report.volunteers` comes in plan order, which is import order, which is no order at all to
   * a régisseur scrolling the list. Sorted on the name as it is displayed, with French collation
   * so that É sits with E rather than after Z.
   */
  const searchNames = useMemo(
    () => [...report.volunteers].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [report.volunteers],
  );

  /**
   * The orgas, in the same box as the bénévoles.
   *
   * SAME QUESTION, SAME FIELD. On the night the régisseur reads a name on the grid, or somebody
   * says one out loud, and what they want is that person's fiche. Which of the two files the
   * name is in is the tool's business, not theirs. Suffixed so the two lists cannot collide on a
   * shared name, and so that picking one says which fiche is about to open.
   */
  const orgaNames = useMemo(
    () =>
      [...plan.organisers]
        .map((o) => ({ key: o.key, label: `${organiserName(o)} (orga)` }))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    [plan.organisers],
  );
  const colours = useMemo(() => poleColours(plan.poles), [plan.poles]);

  // The lookup moved into `PlanIndex` when organisers were split from their poles on 2026-09-09,
  // because the grid, the night view and the printable sheets all wanted the same join.
  const leadersOn = useCallback((poleKey: string) => index.leadersOn(poleKey), [index]);

  const groups = useMemo<LaneGroup[]>(() => {
    const shiftsByPole = new Map<string, Shift[]>();
    for (const shift of plan.shifts) {
      const list = shiftsByPole.get(shift.poleKey);
      if (list) list.push(shift);
      else shiftsByPole.set(shift.poleKey, [shift]);
    }
    for (const list of shiftsByPole.values()) list.sort((a, b) => a.start - b.start);

    const built: LaneGroup[] = [];
    for (const root of plan.poles.filter((p) => p.parentKey === null)) {
      const leaves = plan.poles.filter((p) => index.isLeaf(p.key) && index.isUnder(p.key, root.key));
      const standalone = leaves.length === 1 && leaves[0]?.key === root.key;
      built.push({
        key: root.key,
        title: root.name,
        colour: colours.get(root.key) ?? 'var(--line-strong)',
        locked: root.locked === true,
        lanes: leaves.map((pole) => ({
          pole,
          // A standalone root already names itself in the heading; repeating it on the row would
          // say the same word twice for no gain.
          parentName: standalone ? null : root.name,
          shifts: shiftsByPole.get(pole.key) ?? [],
        })),
      });
    }
    return built;
  }, [plan.poles, plan.shifts, index, colours]);

  /**
   * The groups actually drawn, filters applied.
   *
   * Pulled out of the render because the keyboard has to walk exactly what the eye walks. A
   * cursor that steps into a lane hidden by "incomplets seulement" would move the selection to
   * somewhere off screen, which reads as the grid losing it.
   */
  const visibleGroups = useMemo<LaneGroup[]>(
    () =>
      groups
        .map((group) => ({
          ...group,
          lanes: group.lanes
            .filter(
              (lane) =>
                poleFilter === ALL_POLES ||
                poleFilter === lane.pole.key ||
                index.isUnder(lane.pole.key, poleFilter),
            )
            .filter(
              (lane) =>
                !gapsOnly || lane.shifts.some((s) => (shiftReports.get(s.key)?.missing ?? 0) > 0),
            ),
        }))
        .filter((group) => group.lanes.length > 0),
    [groups, poleFilter, gapsOnly, index, shiftReports],
  );

  /** The picker: every root, and under it every leaf, so one pole can be looked at alone. */
  const poleOptions = useMemo(
    () =>
      groups.map((group) => ({
        key: group.key,
        title: group.title,
        leaves: group.lanes.map((lane) => lane.pole),
      })),
    [groups],
  );

  /**
   * The people the selected volunteer asked to work with, in both directions.
   *
   * A buddy request is one-way in the data, but the régisseur reading the grid does not care who
   * wrote whose name down: what they need to see is which other boxes are the ones this pairing
   * is about. Green rather than blue, because a buddy is a thing to satisfy and not the person
   * currently selected.
   */
  const buddyKeys = useMemo(() => buddiesOf(plan, selected), [plan, selected]);
  const teammateKeys = useMemo(() => teammatesOf(plan, selected), [plan, selected]);

  const namedArtistKeys = useMemo(() => {
    const volunteer = selected ? index.volunteerByKey.get(selected) : undefined;
    return new Set(volunteer?.artistKeys ?? []);
  }, [selected, index]);

  // ------------------------------------------------------------------------
  // Dragging
  // ------------------------------------------------------------------------

  /**
   * Which shifts this person may take, asked once when the drag starts.
   *
   * The question is asked on the plan with their current box already removed, because that is
   * the plan the drop would produce. Asking on the plan as it stands would report their own
   * shift as an overlap with itself, and would grey out every target that only becomes free
   * once they leave where they are.
   */
  const beginDrag = useCallback(
    (payload: DragPayload, event: React.DragEvent) => {
      /*
       * One gate covering every way a drag can start, rather than one per source. The boxes are
       * already not `draggable` under `readOnly`, but the panel's pools are their own drag
       * sources, and there is no session here to catch a drop that gets through: refusing to
       * open a drag at all is what keeps the bin, the drop highlights and the exchange cursors
       * from ever appearing for somebody who cannot act on them.
       */
      if (readOnly) return;
      event.dataTransfer.setData(DRAG_MIME, payload.personKey);
      event.dataTransfer.effectAllowed = 'move';

      /*
       * An orga is legal everywhere, and that is not a shortcut: no hour rule applies to them at
       * all, so there is no shift `isLegal` could refuse. The second MIME type is what lets a
       * pole's frise recognise them while the pointer is still moving; see `DRAG_MIME_ORGA`.
       *
       * `copyMove` AND NOT `move`, and this is why dropping an orga on a pole's frise did nothing
       * at all between 2026-09-12 and 2026-09-13. The frise answers `dropEffect = 'copy'`, which
       * is the honest word for it: the orga becomes responsable and stays in the list, nothing is
       * moved out of anywhere. But a `dropEffect` the `effectAllowed` does not cover is reset to
       * "none" by the browser, and a drag whose effect is none NEVER FIRES A DROP. The frise still
       * lit up on dragover, so the gesture looked alive right up to the moment of letting go,
       * which is the worst way for it to fail. Allowing both keeps the frise's "copy" and the
       * créneaux' "move" valid at once.
       */
      if (payload.kind === 'orga') {
        event.dataTransfer.setData(DRAG_MIME_ORGA, payload.personKey);
        event.dataTransfer.effectAllowed = 'copyMove';
        setDrag({ payload, legalShifts: new Set(plan.shifts.map((s) => s.key)) });
        return;
      }

      const volunteer = index.volunteerByKey.get(payload.personKey);
      if (!volunteer) return;

      const base = payload.fromShiftKey
        ? {
            ...plan,
            assignments: plan.assignments.filter(
              (a) => !(a.volunteerKey === payload.personKey && a.shiftKey === payload.fromShiftKey),
            ),
          }
        : plan;
      const context = new PlanIndex(base);
      const legal = new Set<string>();
      for (const shift of plan.shifts) {
        if (isLegal(context, volunteer, shift)) legal.add(shift.key);
      }
      setDrag({ payload, legalShifts: legal });
    },
    [index, plan, readOnly],
  );

  const endDrag = useCallback(() => {
    setDrag(null);
    setDropShiftKey(null);
    setDropBoxKey(null);
    setDropPoleKey(null);
  }, []);

  /**
   * Whether letting go on the grid's background would remove somebody from a créneau.
   *
   * Only a box taken FROM a créneau: a name dragged out of "Disponibles" is not placed anywhere
   * yet, so there is nothing to undo and the background must stay inert rather than flash a
   * promise it cannot keep.
   */
  const canDropVoid = (event: React.DragEvent): boolean =>
    !readOnly &&
    event.dataTransfer.types.includes(DRAG_MIME) &&
    drag?.payload.fromShiftKey != null &&
    drag.payload.locked !== true;

  const onDropOnShift = useCallback(
    (shiftKey: string) => {
      const session = drag;
      endDrag();
      if (!session) return;
      const { kind, personKey, personName, fromShiftKey } = session.payload;
      if (fromShiftKey === shiftKey) return;

      // An orga holds a place through `OrganiserShift` rather than through an assignment: the
      // engine knows exactly one thing about them here, that the créneau needs one volunteer
      // fewer. See `PlanIndex.headcountOf` and decision 1 of `feature_montage_demontage.md`.
      if (kind === 'orga') {
        edit(
          (p) =>
            fromShiftKey
              ? moveOrganiserToShift(p, personKey, fromShiftKey, shiftKey)
              : addOrganiserToShift(p, personKey, shiftKey),
          fromShiftKey ? `déplacement de ${personName}` : `${personName} sur un créneau`,
        );
        return;
      }

      if (fromShiftKey) {
        edit((p) => move(p, personKey, fromShiftKey, shiftKey), `déplacement de ${personName}`);
      } else {
        edit((p) => assign(p, personKey, shiftKey), `affectation de ${personName}`);
      }
    },
    [drag, edit, endDrag],
  );

  const onDropOnBox = useCallback(
    (targetKey: string, targetShiftKey: string) => {
      const session = drag;
      endDrag();
      if (!session) return;
      const { kind, personKey, personName, fromShiftKey } = session.payload;

      /*
       * An orga dropped on somebody's box is an ordinary placement on the créneau underneath, not
       * an exchange. An exchange trades two places of the same kind; an orga's place and a
       * bénévole's are not the same thing at all, and sending the volunteer to where the orga
       * came from would take a place away from the créneau they were holding.
       */
      if (kind === 'orga') {
        edit(
          (p) =>
            fromShiftKey
              ? moveOrganiserToShift(p, personKey, fromShiftKey, targetShiftKey)
              : addOrganiserToShift(p, personKey, targetShiftKey),
          fromShiftKey ? `déplacement de ${personName}` : `${personName} sur un créneau`,
        );
        return;
      }

      if (targetKey === personKey) return;
      const targetName = index.volunteerName(targetKey);
      if (!fromShiftKey) {
        // Coming from a pool there is nobody to send back, so this is an ordinary placement.
        edit((p) => assign(p, personKey, targetShiftKey), `affectation de ${personName}`);
        return;
      }
      if (fromShiftKey === targetShiftKey) return;
      edit(
        (p) =>
          swap(
            p,
            { volunteerKey: personKey, shiftKey: fromShiftKey },
            { volunteerKey: targetKey, shiftKey: targetShiftKey },
          ),
        `échange entre ${personName} et ${targetName}`,
      );
    },
    [drag, edit, endDrag, index],
  );

  const onDropUnassign = useCallback(() => {
    const session = drag;
    endDrag();
    if (!session?.payload.fromShiftKey) return;
    const { kind, personKey, personName, fromShiftKey } = session.payload;
    edit(
      (p) =>
        kind === 'orga'
          ? removeOrganiserFromShift(p, personKey, fromShiftKey)
          : unassign(p, personKey, fromShiftKey),
      `retrait de ${personName}`,
    );
  }, [drag, edit, endDrag]);

  /**
   * An orga dropped on a pole's own frise: they become responsable of it, for two hours.
   *
   * THE GESTURE IS THE WHOLE POINT, and the régisseur named it on 2026-09-12: "le glisser déposer
   * sur la timeline au dessus d'un pôle ... déposera un créneau de 2h de responsable pour cet orga
   * automatiquement à cet endroit". Until then being responsable was set in Réglages, one list
   * away from the grid where the hole in the cover is actually seen.
   *
   * The hours are the pointer's, snapped to the quarter and pushed back inside the event when the
   * drop lands in its last two hours, so a band always has its full length and is always drawn.
   * Both edges are dragged afterwards, on the band itself. See `OrganiserBand`.
   */
  const onDropResponsable = useCallback(
    (poleKey: string, x: number) => {
      const session = drag;
      endDrag();
      if (!session || readOnly || session.payload.kind !== 'orga') return;
      const { personKey, personName } = session.payload;

      const raw = Math.round(x / pxPerHour / RESPONSABLE_SNAP) * RESPONSABLE_SNAP;
      const start = Math.min(Math.max(0, raw), Math.max(0, eventHours - RESPONSABLE_HOURS));
      const end = Math.min(eventHours, start + RESPONSABLE_HOURS);
      const pole = plan.poles.find((p) => p.key === poleKey);

      edit(
        (p) => assignOrganiserToPoleAt(p, personKey, poleKey, start, end),
        `${personName} responsable de ${pole?.name ?? poleKey}`,
      );
    },
    [drag, edit, endDrag, eventHours, plan.poles, pxPerHour, readOnly],
  );

  /** An edge of a responsable's band let go. Not an assignment, so no rule is consulted. */
  const onResizeRole = useCallback(
    (roleKey: string, start: number, end: number) => {
      const role = plan.leaderRoles.find((r) => r.key === roleKey);
      const who = role ? plan.organisers.find((o) => o.key === role.organiserKey) : undefined;
      edit(
        (p) => setOrganiserWindow(p, roleKey, start, end),
        `horaires de ${who ? organiserName(who) : 'responsable'}`,
      );
    },
    [edit, plan.leaderRoles, plan.organisers],
  );

  const takeOrgaOut = useCallback(
    (organiserKey: string, shiftKey: string) => {
      const who = plan.organisers.find((o) => o.key === organiserKey);
      edit(
        (p) => removeOrganiserFromShift(p, organiserKey, shiftKey),
        `${who ? organiserName(who) : 'orga'} retiré·e d'un créneau`,
      );
    },
    [edit, plan.organisers],
  );

  const onToggleLock = useCallback(
    (volunteerKey: string, shiftKey: string) => {
      const locked = lockedKeys.has(`${volunteerKey}|${shiftKey}`);
      const name = index.volunteerName(volunteerKey);
      edit(
        (p) => setLocked(p, volunteerKey, shiftKey, !locked),
        `${locked ? 'déverrouillage' : 'verrouillage'} de la place de ${name}`,
      );
    },
    [edit, index, lockedKeys],
  );

  const onEnterShift = useCallback((key: string | null) => {
    setDropShiftKey(key);
    setDropBoxKey(null);
  }, []);

  /**
   * Picking somebody out of a box, a list or the search field.
   *
   * NO TAB IS CHANGED ANY MORE. The fiche has a pane of its own, so selecting somebody out of
   * "Disponibles" leaves that list exactly where it was, which is what the régisseur asked for:
   * they are walking down a list and looking at each person in turn.
   */
  const selectVolunteer = useCallback((key: string | null) => {
    setSelection(key === null ? null : { kind: 'benevole', volunteerKey: key });
  }, []);

  /**
   * Letting go: nobody selected, and no cursor either.
   *
   * Clicking a box no longer toggles it off, so this is the way out, and it is deliberately the
   * same one Échap takes. The cursor goes with the selection because the two are kept in step
   * everywhere else, and a cursor left behind would be invisible now that it wears no ring.
   * The next arrow key starts again from the first box.
   */
  const clearSelection = useCallback(() => {
    setCursor(null);
    selectVolunteer(null);
  }, [selectVolunteer]);

  // ------------------------------------------------------------------------
  // The keyboard
  // ------------------------------------------------------------------------

  /**
   * The grid as the arrow keys see it: rows of shifts, each holding a column of boxes.
   *
   * Left and right are time, up and down are people. The movement itself lives in `gridNav.ts`,
   * with no React around it, because it is geometry and geometry is worth testing.
   */
  const navLanes = useMemo<NavLanes>(
    () =>
      visibleGroups.flatMap((group) =>
        group.lanes.map((lane) =>
          lane.shifts.map((shift) => ({
            key: shift.key,
            start: shift.start,
            end: shift.end,
            count: shiftReports.get(shift.key)?.stars.length ?? 0,
          })),
        ),
      ),
    [visibleGroups, shiftReports],
  );

  const boxAt = useCallback(
    (shiftKey: string, at: number): { volunteerKey: string; name: string } | null => {
      const stars = shiftReports.get(shiftKey)?.stars ?? [];
      const entry = stars[at];
      return entry ? { volunteerKey: entry.volunteerKey, name: entry.name } : null;
    },
    [shiftReports],
  );

  /** Puts the cursor on a box and selects whoever stands in it, so the panel follows the keys. */
  const putCursor = useCallback(
    (shiftKey: string, at: number) => {
      setCursor({ shiftKey, index: at });
      const box = boxAt(shiftKey, at);
      if (box) selectVolunteer(box.volunteerKey);
    },
    [boxAt, selectVolunteer],
  );

  const moveCursor = useCallback(
    (dx: number, dy: number) => {
      const next = stepCursor(navLanes, cursor, dx, dy);
      if (next) putCursor(next.shiftKey, next.index);
    },
    [cursor, navLanes, putCursor],
  );

  /**
   * Suppr takes the person under the cursor off this shift. It never takes them off the plan.
   *
   * A locked box refuses, and says so rather than doing nothing: a key that silently declines is
   * indistinguishable from a key that is not wired up.
   */
  const deleteAtCursor = useCallback(() => {
    if (!cursor) return;
    const box = boxAt(cursor.shiftKey, cursor.index);
    if (!box) return;
    if (lockedKeys.has(`${box.volunteerKey}|${cursor.shiftKey}`)) {
      setKeyNote(`La place de ${box.name} est verrouillée. Déverrouillez-la pour la retirer.`);
      return;
    }
    edit((p) => unassign(p, box.volunteerKey, cursor.shiftKey), `retrait de ${box.name}`);
    setKeyNote(`${box.name} retiré de ce créneau. Ctrl+Z annule.`);
  }, [boxAt, cursor, edit, lockedKeys]);

  /*
   * Bound on the window, like the undo shortcut, and stepped around every field the régisseur
   * might be typing in. The search box sits in the same toolbar, and an arrow key inside it
   * belongs to the text.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          moveCursor(-1, 0);
          return;
        case 'ArrowRight':
          event.preventDefault();
          moveCursor(1, 0);
          return;
        case 'ArrowUp':
          event.preventDefault();
          moveCursor(0, -1);
          return;
        case 'ArrowDown':
          event.preventDefault();
          moveCursor(0, 1);
          return;
        case 'Delete':
        case 'Backspace':
          if (!cursor) return;
          event.preventDefault();
          deleteAtCursor();
          return;
        case 'Escape':
          clearSelection();
          return;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection, cursor, deleteAtCursor, moveCursor]);

  /* The cursor may land on a box three screens down, so the grid follows it. */
  useEffect(() => {
    if (!cursor) return;
    document
      .querySelector('.box.is-cursor')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [cursor]);

  /* The keyboard says what it just did, then stops saying it. */
  useEffect(() => {
    if (keyNote === null) return;
    const timer = window.setTimeout(() => setKeyNote(null), 4000);
    return () => window.clearTimeout(timer);
  }, [keyNote]);

  /* A box that no longer exists cannot hold a cursor. */
  useEffect(() => {
    if (!cursor) return;
    const stars = shiftReports.get(cursor.shiftKey)?.stars ?? [];
    if (stars.length === 0) setCursor(null);
    else if (cursor.index >= stars.length) {
      setCursor({ shiftKey: cursor.shiftKey, index: stars.length - 1 });
    }
  }, [cursor, shiftReports]);

  // ------------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------------

  const trackWidth = eventHours * pxPerHour;
  const summary = report.summary;

  return (
    <div className="screen has-info">
      <div className="screen-main">
        <div className="toolbar">
          {switcher}
          {switcher && <div className="toolbar-sep" />}
          <ZoomSlider value={pxPerHour} bounds={EXPLOIT_ZOOM} onChange={setPxPerHour} onFit={fit} />

          <div className="toolbar-sep" />

          <select
            className="select"
            value={poleFilter}
            onChange={(event) => setPoleFilter(event.target.value)}
            title="N'afficher qu'un pôle"
          >
            <option value={ALL_POLES}>Tous les pôles</option>
            {poleOptions.map((group) =>
              group.title ? (
                <optgroup key={group.key} label={group.title}>
                  <option value={group.key}>{group.title} (tout)</option>
                  {group.leaves.map((leaf) => (
                    <option key={leaf.key} value={leaf.key}>
                      {leaf.name}
                    </option>
                  ))}
                </optgroup>
              ) : (
                group.leaves.map((leaf) => (
                  <option key={leaf.key} value={leaf.key}>
                    {leaf.name}
                  </option>
                ))
              ),
            )}
          </select>

          <label className="checkline">
            <input
              type="checkbox"
              checked={gapsOnly}
              onChange={(event) => setGapsOnly(event.target.checked)}
            />
            Incomplets seulement
          </label>

          <div className="toolbar-sep" />

          <input
            className="select"
            list="benevoles-liste"
            placeholder="Chercher un bénévole ou un orga"
            onChange={(event) => {
              const typed = event.target.value;
              const orga = orgaNames.find((o) => o.label === typed);
              if (orga) {
                setSelection({ kind: 'orga', organiserKey: orga.key });
                return;
              }
              const found = report.volunteers.find((v) => v.name === typed);
              if (found) selectVolunteer(found.key);
            }}
          />
          <datalist id="benevoles-liste">
            {searchNames.map((v) => (
              <option key={v.key} value={v.name} />
            ))}
            {orgaNames.map((o) => (
              <option key={o.key} value={o.label} />
            ))}
          </datalist>

          <div className="toolbar-sep" />

          {!readOnly && (
            <>
              <button className="btn is-primary" onClick={() => onSolve('once')} disabled={solving}>
                {solving && solveMode === 'once' ? <span className="spinner" /> : null} Recalculer
              </button>
              <button
                className="btn"
                onClick={() => onSolve('converge')}
                disabled={solving}
                title={
                  "Enchaîne les tours de calcul jusqu'à ce que le solveur ne propose plus rien. " +
                  'Les places verrouillées ne bougent dans aucun tour.'
                }
              >
                {solving && solveMode === 'converge' ? <span className="spinner" /> : null} Jusqu'à
                stabilité
              </button>
            </>
          )}

          <span className="toolbar-note">
            {keyNote ?? (
              <>
                {summary.gapHours > 0
                  ? `${fmtHours(summary.gapHours)} à pourvoir`
                  : 'Tous les créneaux sont pourvus'}
                {summary.tier1Count > 0 ? ` · ${summary.tier1Count} illégal(s)` : ''}
              </>
            )}
          </span>

          <Legend />
        </div>

        {/*
          The background is what lets go of the current box.

          A click on a box belongs to that box, and a click on a control inside the grid (a
          padlock, a pôle's lock) belongs to that control: neither should quietly deselect the
          person the régisseur is looking at. Everything else in here is background.
        */}
        <div
          ref={scroll}
          className="grid-scroll"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('.box, button, [role="button"]')) return;
            clearSelection();
          }}
          /*
           * THE EMPTY PART OF THE GRID IS A BIN, since 2026-09-12, and the régisseur asked for it
           * on all three grids: "faire glisser déposer une case soit tout en bas ... soit tout à
           * droite ... doit retirer la personne de cette case". Under the last pole and past the
           * end of the axis there is nothing to land on, and letting go there used to do nothing
           * at all, which reads as the drag having failed rather than as having been cancelled.
           *
           * A real target stops the event before it gets here: every créneau, every box and the
           * poles' frises call `stopPropagation` on their own drop. So anything that reaches this
           * handler genuinely landed on the background.
           */
          /*
           * IT ACCEPTS THE DROP AND SAYS NOTHING, since 2026-09-13. It used to light up dashed and
           * blue the moment a box was picked up, and the régisseur was right about it: "l'effet in
           * fine sera d'enlever la case, ce qui est contre-intuitif". Every other dashed-blue
           * surface in this tool means "let go here and the person lands here"; this one means the
           * opposite, and painting the whole grid with the welcoming colour while the answer is
           * removal is the wrong promise on the largest surface of the screen.
           *
           * The bin in the right-hand pane is the place that ANNOUNCES the removal, on purpose:
           * it appears only while a placed box is in flight, it is labelled, and the régisseur
           * already said it reads well. The background stays a quiet fallback for letting go
           * anywhere else.
           */
          onDragOver={(event) => {
            if (!canDropVoid(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            if (!canDropVoid(event)) return;
            event.preventDefault();
            onDropUnassign();
          }}
        >
          <div className="grid-inner" style={{ width: `calc(var(--label-w) + ${trackWidth}px)` }}>
            <div className="grid-head">
              <div className="grid-corner">
                <span>{plan.poles.filter((p) => index.isLeaf(p.key)).length} pôles</span>
                <span>{plan.shifts.length} créneaux</span>
              </div>
              <TimeRuler
                startISO={plan.startISO}
                slots={plan.slots}
                hours={eventHours}
                pxPerHour={pxPerHour}
                artists={plan.artists}
                namedArtistKeys={namedArtistKeys}
              />
            </div>

            {visibleGroups.map((group) => {
              const lanes = group.lanes;

              return (
                <div
                  key={group.key}
                  className="pole-group"
                  style={{ '--pole': group.colour } as React.CSSProperties}
                >
                  <div className="pole-group-head">
                    <div className="pole-group-title">
                      <span className="pole-group-name">{group.title}</span>
                      {/*
                        A lock aimed at the solver, not at the pointer. It says "a recalculation
                        must leave this pole as it is", and it deliberately changes no box: the
                        régisseur keeps dragging inside it, and unlocking gives the pole back
                        with every box exactly as it was.
                      */}
                      {/*
                        For a reader this lock is about the solver, which they do not run, so it
                        would be a button about a machine they cannot start. Only the closed one
                        survives, and only as a fact.
                      */}
                      {readOnly ? (
                        group.locked && (
                          <span className="pole-lock is-locked" title="Pôle verrouillé">
                            🔒
                          </span>
                        )
                      ) : (
                        <button
                          className={`pole-lock ${group.locked ? 'is-locked' : ''}`}
                          title={
                            group.locked
                              ? `Le solveur ne touche pas à ${group.title}. Cliquez pour le lui rendre.`
                              : `Verrouiller ${group.title} contre les recalculs. Les cases gardent leur propre état.`
                          }
                          onClick={() =>
                            edit(
                              (p) => setPoleLocked(p, group.key, !group.locked),
                              `${group.locked ? 'déverrouillage' : 'verrouillage'} du pôle ${group.title}`,
                            )
                          }
                        >
                          {group.locked ? '🔒' : '🔓'}
                        </button>
                      )}
                    </div>
                    {/*
                      The pole's frise, and since 2026-09-12 the place an orga is dropped to become
                      its responsable. The whole strip takes the drop, ruler included, rather than
                      the fifteen-pixel band alone: the band is not even drawn until somebody is on
                      it, so aiming at it would mean aiming at nothing on every pole that has no
                      responsable yet, which is exactly the pole this gesture is for.
                    */}
                    <div
                      className={`pole-group-axis ${dropPoleKey === group.key ? 'is-drop' : ''}`}
                      onDragOver={(event) => {
                        if (readOnly || !event.dataTransfer.types.includes(DRAG_MIME_ORGA)) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'copy';
                        setDropPoleKey(group.key);
                      }}
                      onDragLeave={() => setDropPoleKey(null)}
                      onDrop={(event) => {
                        if (readOnly || !event.dataTransfer.types.includes(DRAG_MIME_ORGA)) return;
                        // A real target: the grid's background must not also read this as a
                        // drop on nothing and unplace the person. See `canDropVoid`.
                        event.stopPropagation();
                        event.preventDefault();
                        setDropPoleKey(null);
                        const box = event.currentTarget.getBoundingClientRect();
                        onDropResponsable(group.key, event.clientX - box.left);
                      }}
                    >
                      <LaneRuler
                        startISO={plan.startISO}
                        slots={plan.slots}
                        hours={eventHours}
                        pxPerHour={pxPerHour}
                      />
                      {/* Who is running this pole, and when. Never an assignment. */}
                      <OrganiserBand
                        startISO={plan.startISO}
                        organisers={leadersOn(group.key)}
                        hours={eventHours}
                        pxPerHour={pxPerHour}
                        readOnly={readOnly}
                        snap={RESPONSABLE_SNAP}
                        onResize={onResizeRole}
                        onSelect={(organiserKey) => setSelection({ kind: 'orga', organiserKey })}
                      />
                    </div>
                  </div>

                  {lanes.map((lane) => {
                    const height = laneHeight(lane.shifts, (key) =>
                      shiftReports.get(key)?.assigned ?? 0,
                    );
                    const gap = lane.shifts.reduce(
                      (total, s) =>
                        total + (shiftReports.get(s.key)?.missing ?? 0) * (s.end - s.start),
                      0,
                    );
                    return (
                      <div className="lane-block" key={lane.pole.key}>
                        <div className="lane" style={{ height }}>
                          <div className="lane-label">
                            {lane.parentName && (
                              <span className="lane-label-parent">{lane.parentName}</span>
                            )}
                            <span className="lane-label-name">{lane.pole.name}</span>
                            <span className={`lane-label-stat ${gap > 0 ? 'is-gap' : ''}`}>
                              {gap > 0 ? `${fmtHours(gap)} à pourvoir` : 'complet'}
                            </span>
                          </div>
                          <div
                            className="lane-track"
                            style={
                              { width: trackWidth, '--hour-w': `${pxPerHour}px` } as React.CSSProperties
                            }
                          >
                            {(() => {
                              /*
                               * One person, one row, across the whole lane. Somebody working two
                               * créneaux in a row is drawn on the same line in both, so four
                               * hours straight read as four hours straight. See `laneRows`.
                               */
                              const layout = laneRows(
                                lane.shifts.map((shift) => ({
                                  key: shift.key,
                                  start: shift.start,
                                  headcount: shift.headcount,
                                  assignees: (shiftReports.get(shift.key)?.stars ?? []).map(
                                    (star) => star.volunteerKey,
                                  ),
                                })),
                              );
                              return lane.shifts.map((shift) => {
                              const shiftReport = shiftReports.get(shift.key);
                              if (!shiftReport) return null;
                              const dropBoxVolunteerKey =
                                dropBoxKey && dropBoxKey.endsWith(`|${shift.key}`)
                                  ? dropBoxKey.slice(0, dropBoxKey.length - shift.key.length - 1)
                                  : null;
                              return (
                                <ShiftBlock
                                  key={shift.key}
                                  shift={shift}
                                  report={shiftReport}
                                  left={shift.start * pxPerHour}
                                  width={(shift.end - shift.start) * pxPerHour - 2}
                                  poleColour={group.colour}
                                  lockedKeys={lockedKeys}
                                  volumeBands={volumeBands}
                                  selectedVolunteerKey={selected}
                                  buddyKeys={buddyKeys}
                                  teammateKeys={teammateKeys}
                                  dragActive={drag !== null}
                                  legalTarget={drag ? drag.legalShifts.has(shift.key) : true}
                                  draggingKey={drag?.payload.kind === 'benevole' ? drag.payload.personKey : null}
                                  isDropShift={dropShiftKey === shift.key}
                                  dropBoxVolunteerKey={dropBoxVolunteerKey}
                                  cursorIndex={cursor?.shiftKey === shift.key ? cursor.index : null}
                                  onSelect={selectVolunteer}
                                  onFocusBox={putCursor}
                                  onToggleLock={onToggleLock}
                                  onDragStartBox={beginDrag}
                                  onDragEndBox={endDrag}
                                  onDropOnShift={onDropOnShift}
                                  onDropOnBox={onDropOnBox}
                                  onEnterShift={onEnterShift}
                                  onEnterBox={setDropBoxKey}
                                  selectedShiftKey={
                                    selection?.kind === 'creneau' ? selection.shiftKey : null
                                  }
                                  onSelectShift={(shiftKey, fill) =>
                                    setSelection({ kind: 'creneau', shiftKey, fill })
                                  }
                                  onSelectOrga={(organiserKey) =>
                                    setSelection({ kind: 'orga', organiserKey })
                                  }
                                  onRemoveOrga={takeOrgaOut}
                                  supportOnlyOrgaKeys={supportOnlyByShift.get(shift.key)}
                                  slots={layout.get(shift.key)}
                                  readOnly={readOnly}
                                />
                              );
                              });
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/*
        The two panes on the right, the same two the montage and the démontage carry: who is still
        to place, then what is selected. They used to be one pane plus two floating asides of their
        own design, and the asides landed wherever the grid's own two columns left room.
      */}
      <PoolPanel
        moment="exploit"
        tab={panelTab}
        onTabChange={setPanelTab}
        selection={selection}
        onSelect={setSelection}
        onDragStartPerson={beginDrag}
        onDragEndPool={endDrag}
        onDropUnassign={onDropUnassign}
        readOnly={readOnly}
      />

      <InfoPanel selection={selection} onSelect={setSelection} readOnly={readOnly} />

      {drag?.payload.fromShiftKey && !drag.payload.locked && (
        <TrashTarget label="Retirer du créneau" onDrop={onDropUnassign} />
      )}
      {drag && <DragReason drag={drag} dropShiftKey={dropShiftKey} dropBoxKey={dropBoxKey} />}
    </div>
  );
}

/**
 * What the colours on a box mean, spelled out.
 *
 * The three codes come from the brief and from `validate()`, but nothing on screen said which
 * was which, and an orange box that turns out to mean "long day" rather than "problem" is worse
 * than no colour at all.
 */
function Legend() {
  return (
    <span className="legend">
      <span className="legend-item">
        <span className="legend-swatch is-illegal" /> contraire aux règles
      </span>
      <span className="legend-item">
        <span className="legend-swatch is-warned" /> à surveiller
      </span>
      {/* Not swatches any more: the two long days are glyphs, so the legend shows the glyph. */}
      <span className="legend-item">
        <span className="legend-mark">{volumeMark('orange-clair')}</span>{' '}
        {volumeLabel('orange-clair').toLowerCase()}
      </span>
      <span className="legend-item">
        <span className="legend-mark">{volumeMark('orange-fonce')}</span>{' '}
        {volumeLabel('orange-fonce').toLowerCase()}
      </span>
      <span className="legend-item">
        <span className="legend-swatch is-buddy" /> binôme demandé
      </span>
      <span className="legend-item">
        <span className="legend-swatch is-empty" /> place à pourvoir
      </span>
    </span>
  );
}

/**
 * The French sentence explaining why the target under the pointer is greyed.
 *
 * Built by `blockersFor`, never written here, so it can never contradict the rule that actually
 * refused the placement. It is computed for one shift at a time, on hover, because building 91
 * sentences on every drag start would be work nobody reads.
 */
function DragReason({
  drag,
  dropShiftKey,
  dropBoxKey,
}: {
  drag: DragSession;
  dropShiftKey: string | null;
  /** `volunteerKey|shiftKey` of the occupied box under the pointer, when there is one. */
  dropBoxKey: string | null;
}) {
  const { plan, index } = useLoadedPlan();

  /**
   * Refused, or allowed at a price. The second since 2026-09-14: a rule the event made a weight
   * (Réglages avancés) no longer greys the target, and letting go there without a word would hide
   * the one thing the régisseur loosened the rule to decide case by case.
   */
  const message = useMemo((): { kind: 'refused' | 'costly'; text: string } | null => {
    if (!dropShiftKey) return null;
    const volunteer = index.volunteerByKey.get(drag.payload.personKey);
    const shift = index.shiftByKey.get(dropShiftKey);
    if (!volunteer || !shift) return null;

    /*
     * AN EXCHANGE IS ITS OWN QUESTION, and asking the wrong one is what put "Placement interdit"
     * under a perfectly good swap: "quand on déplace une case occupée vers une autre case
     * occupée, cela inverse les cases, ce qui est très bien, sauf qu'il ne devrait pas y avoir
     * affiché tout en bas que c'est interdit".
     *
     * `legalShifts` answers "may this person be ADDED here", computed with their own box removed
     * and nobody else's. On a swap the other person leaves at the same instant, and the two
     * travel in opposite directions, so the honest question is asked on the plan the drop would
     * actually produce: both assignments gone, then both rules checked, one per direction.
     */
    const from = drag.payload.fromShiftKey;
    const targetKey =
      dropBoxKey && dropBoxKey.endsWith(`|${dropShiftKey}`)
        ? dropBoxKey.slice(0, dropBoxKey.length - dropShiftKey.length - 1)
        : null;
    const other = targetKey ? index.volunteerByKey.get(targetKey) : undefined;
    const swapping = from !== null && from !== dropShiftKey && other !== undefined;

    if (swapping) {
      const fromShift = index.shiftByKey.get(from!);
      if (!fromShift) return null;
      const base = {
        ...plan,
        assignments: plan.assignments.filter(
          (a) =>
            !(a.volunteerKey === drag.payload.personKey && a.shiftKey === from) &&
            !(a.volunteerKey === targetKey && a.shiftKey === dropShiftKey),
        ),
      };
      const context = new PlanIndex(base);
      const both = [
        ...blockersFor(context, volunteer, shift),
        ...blockersFor(context, other, fromShift),
      ];
      if (both.length > 0) return { kind: 'refused', text: both.map((b) => b.message).join(' ') };
      const costs = [...costsFor(context, volunteer, shift), ...costsFor(context, other, fromShift)];
      return costs.length === 0 ? null : { kind: 'costly', text: costs.map((b) => b.message).join(' ') };
    }

    const baseForCosts = from
      ? { ...plan, assignments: plan.assignments.filter((a) => !(a.volunteerKey === drag.payload.personKey && a.shiftKey === from)) }
      : plan;
    if (drag.legalShifts.has(dropShiftKey)) {
      const costs = costsFor(new PlanIndex(baseForCosts), volunteer, shift);
      return costs.length === 0 ? null : { kind: 'costly', text: costs.map((b) => b.message).join(' ') };
    }

    const base = from
      ? {
          ...plan,
          assignments: plan.assignments.filter(
            (a) => !(a.volunteerKey === drag.payload.personKey && a.shiftKey === from),
          ),
        }
      : plan;
    const blockers = blockersFor(new PlanIndex(base), volunteer, shift);
    return { kind: 'refused', text: blockers.map((b) => b.message).join(' ') };
  }, [drag, dropShiftKey, dropBoxKey, index, plan]);

  if (!message) return null;

  return (
    <div
      className={`banner ${message.kind === 'refused' ? 'is-error' : ''}`}
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20, borderTop: '1px solid' }}
    >
      <strong>{message.kind === 'refused' ? 'Placement interdit.' : 'Placement possible, mais il coûte:'}</strong> {message.text}
    </div>
  );
}
