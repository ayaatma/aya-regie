/**
 * The montage grid, and the démontage grid: the same shape as the exploit's, over several days.
 *
 * POLES DOWN THE SIDE, HOURS ACROSS THE TOP, exactly like the grid this tool is built around.
 * What differs is what a bar means. On the exploit a créneau is a box that holds N volunteers,
 * because the pole needs N people between 22h and minuit. On a phase there is no such thing: a
 * pole simply has people in it, each for their own hours. So a bar is ONE PERSON, positioned and
 * sized by their own window, and one person keeps one row however many windows they hold.
 *
 * A DECLARATION IS A PLACEMENT, since 2026-09-11. Somebody who filled in the form saying they
 * are there from Thursday is placed from Thursday, one box per worked day, in the pole they named
 * or in Général, and the régisseur trims and moves those boxes like any others. There is no
 * second, fainter kind of box any more: the grid draws the plan, and only the plan.
 *
 * WHAT THE DECLARATION IS STILL FOR IS THE RED. A box outside what somebody declared, or in a
 * pole other than the one they named, is drawn in red with the reason in its tooltip. Nothing is
 * ever refused or moved: a phase has no rules, it has answers people gave, and a placement that
 * contradicts one is worth saying out loud. See `phaseIssues`.
 *
 * THE ÉVÉNEMENTS ARE THE EXCEPTION, and they are exactly a créneau: a title, a precise window
 * and a number of people to find, taken from any pole. They share one lane at the top, drawn as
 * blocks with their name on the lid and one place per person needed, "à pourvoir" included.
 *
 * The nights are not drawn. `phaseAxis.ts` lays the worked stretches of each day end to end with
 * a gap between them, so an hour is the same width everywhere and the night is a separation
 * rather than two thirds of an empty screen.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  GENERAL_POLE_KEY,
  MOMENT_WORD,
  allPlacements,
  artistMomentsIn,
  eventFills,
  fmtHours,
  phaseDays,
  phaseIssues,
  phasePeople,
  toClock,
  toLabel,
  type PersonKind,
  type Phase,
  type PhaseId,
  type PhaseIssue,
  type PhasePlacement,
} from '../engine.ts';
import {
  assignWindow,
  declaredToPlace,
  removePhaseAssignment,
  placeDeclared,
  setPhaseAssignment,
} from '../store/phaseEdits.ts';
import { useLoadedPlan } from '../store/store.tsx';
import { organiserName } from '../components/labels.ts';
import { InfoPanel } from '../components/InfoPanel.tsx';
import { PersonMark } from '../components/PersonMark.tsx';
import { PoolPanel, type PanelTab } from '../components/PoolPanel.tsx';
import { DRAG_MIME } from '../components/drag.ts';
import { stepBox, type NavBox, type NavRows } from '../components/phaseNav.ts';
import { LABEL_W, PHASE_ZOOM, fitZoom } from '../components/layout.ts';
import { TrashTarget } from '../components/TrashTarget.tsx';
import { ZoomSlider } from '../components/ZoomSlider.tsx';
import { useWheelZoom } from '../components/useWheelZoom.ts';
import { ARTIST_ROW_H } from '../components/TimeRuler.tsx';
import { selectedPerson, type Selection } from '../components/selection.ts';
import {
  anchorAt,
  axisSpan,
  buildPhaseAxis,
  hourOn,
  packRows,
  piecesOf,
  segmentAt,
  trimTo,
  xOfAnchor,
  type PhaseAxis,
  type PhaseSegment,
} from '../components/phaseAxis.ts';

/** Pixels left over when the grid is fitted to the screen, so no scrollbar appears on the nose. */
const FIT_SLACK = 4;

const ROW_H = 22;
const ROW_GAP = 2;
const LANE_PAD = 6;

/*
 * The three numbers an événement block is built out of, and they MIRROR THE STYLESHEET.
 *
 * The block is positioned absolutely, so its height is computed here while everything inside it
 * is laid out by `.phase-event-title` and `.phase-event-slots`. The two have to agree to the
 * pixel: they were three pixels apart until 2026-09-12, `overflow: hidden` swallowed the
 * difference, and the last place of every événement was drawn with its bottom sliced off.
 *
 * Every box on this page is `border-box`, so the block's own 1 px border on each side comes out
 * of the height it is given and has to be added back.
 */
/** `.phase-event-title { height }`: the lid, where the name and the count are written. */
const EVENT_TITLE_H = 17;
/** `.phase-event-slots { padding }`, top and bottom. */
const EVENT_SLOT_PAD = 2;
/** `.phase-event-block { border }`, top and bottom. */
const EVENT_BORDER = 2;

/**
 * The five figures of `styles.css` this file copies, named so a test can check they still agree.
 *
 * THE ONE THING THAT KEEPS DRIFTING. A block is positioned absolutely, so its height is computed
 * here while its contents are laid out by the stylesheet, and the two have disagreed twice: once
 * by three pixels over the lid, and once by two pixels PER PLACE, because `.box.is-mini` declared
 * `height: 22px` and never overrode the `flex: 0 0 24px` it inherits, which is what a column flex
 * box actually reads. Both times `overflow: hidden` swallowed the difference and the last place
 * of every événement was drawn with its bottom sliced off, with every test still green.
 *
 * `phaseGeometry.test.tsx` reads the stylesheet and compares it to this. A number changed on one
 * side and not the other is a failing test now, rather than a bug reported weeks later.
 */
export const EVENT_GEOMETRY = {
  /** `.phase-event-title { height: 17px }` */
  titleH: EVENT_TITLE_H,
  /** `.phase-event-slots { padding: 2px }` */
  slotPad: EVENT_SLOT_PAD,
  /** `.phase-event-block { border: 1px }`, counted twice. */
  border: EVENT_BORDER,
  /** `.box.is-mini { flex: 0 0 22px }`, which is the height inside a column. */
  rowH: ROW_H,
  /** `.phase-event-slots { gap: 2px }` */
  rowGap: ROW_GAP,
} as const;

/** How tall a block holding `rows` places has to be for the last of them to be drawn whole. */
export const eventBlockHeight = (rows: number): number =>
  EVENT_BORDER +
  EVENT_TITLE_H +
  2 * EVENT_SLOT_PAD +
  rows * ROW_H +
  Math.max(0, rows - 1) * ROW_GAP;
/** What an edge snaps to while it is dragged, and the shortest a box may be trimmed to. */
const SNAP = 0.25;

/** The day picker's "no filter" value. A select cannot carry null. */
const ALL_DAYS = 'tous';

/** Below these widths an hour label has no room, so only every other or every fourth is drawn. */
const labelStep = (pxPerHour: number): number =>
  pxPerHour >= 30 ? 1 : pxPerHour >= 16 ? 2 : 4;

/** What is being dragged: one person, and where they came from. */
export interface PhaseDrag {
  kind: PersonKind;
  key: string;
  name: string;
  /** The window they were taken from, or null when they come from the list on the right. */
  from: { start: number; end: number } | null;
  /**
   * The box they were taken from, or null when they come from the list.
   *
   * Carried since 2026-09-12 so the box can be REMOVED, which is what dropping it on the empty
   * part of the grid, on the pane, or on the bin does. `from` is not enough: a person may hold
   * two boxes with the same hours in two poles, and the window alone cannot say which was grabbed.
   */
  assignmentKey: string | null;
}

/** What a box would become if the edge being pulled were let go now. */
interface Edges {
  start: number;
  end: number;
}

/** An edge being pulled, and the window it is currently proposing. */
interface Resize extends Edges {
  assignmentKey: string;
}

export function PhaseGrid({
  id,
  switcher,
  readOnly = false,
}: {
  id: PhaseId;
  switcher?: React.ReactNode;
  readOnly?: boolean;
}) {
  const { plan, index, edit } = useLoadedPlan();
  const phase: Phase = id === 'montage' ? plan.montage : plan.demontage;

  /**
   * Pixels per hour, continuous, and fitted to the screen whenever the day filter changes.
   *
   * Five fixed steps before 2026-09-12, the widest of them 46 px/h, which left a sixteen-hour
   * montage day filling two thirds of a wide screen at maximum zoom. See `ZoomSlider`.
   */
  const [pxPerHour, setPxPerHour] = useState<number>(PHASE_ZOOM.fallback);
  /** The scrolling viewport, measured so the grid can be made to fill it exactly. */
  const scroll = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<PhaseDrag | null>(null);
  /** The pointer is over the empty part of the grid, where letting go takes the box away. */
  /**
   * What the last key press did, said out loud in the toolbar.
   *
   * A key that removes something without a word is indistinguishable from a key that is not
   * wired up, and worse, from one that removed something else. Same reason the exploit grid
   * carries one.
   */
  const [keyNote, setKeyNote] = useState<string | null>(null);
  /** What the panes on the right are describing. The same type on all three grids. */
  const [selection, setSelection] = useState<Selection | null>(null);
  const [tab, setTab] = useState<PanelTab>('disponibles');
  const [resize, setResize] = useState<Resize | null>(null);
  /**
   * Which day is on screen, or the whole phase.
   *
   * ONE PICKER FOR THE GRID AND FOR THE LIST, which is why it lives here rather than inside the
   * panel where the phases' day filter used to be. A montage of four days is several screens wide
   * at any zoom that lets an hour be read, and the régisseur asked to see one day at a time; when
   * they are working on Thursday, "Disponibles" showing Friday's people alongside would be the
   * same question answered two ways on one screen. `PoolPanel` takes the day as a prop now.
   */
  const [day, setDay] = useState<number | null>(null);

  const days = useMemo(() => phaseDays(phase), [phase]);
  const axis = useMemo(() => buildPhaseAxis(phase, pxPerHour, day), [phase, pxPerHour, day]);

  /**
   * Make what is on screen fill the width there is.
   *
   * THIS IS WHY THE DAY FILTER IS WORTH HAVING. Narrowing four days to one and leaving the zoom
   * where it was gives a grid three quarters empty, which is the report: "il faudrait que la vue
   * se cale pour automatiquement prendre toute la place disponible quand on change de filtre".
   * So the fit runs on every change of day, and on the way in.
   *
   * `axisSpan` is the same arithmetic `buildPhaseAxis` lays out, so the two cannot disagree about
   * what is on screen. The nights are a fixed cost whatever the zoom, so the hours get what is
   * left after them.
   */
  const fit = useCallback(() => {
    const width = scroll.current?.clientWidth ?? 0;
    if (width <= 0) return;
    const span = axisSpan(phase, day);
    setPxPerHour(fitZoom(span.hours, width - LABEL_W - FIT_SLACK, PHASE_ZOOM, span.gaps));
  }, [phase, day]);

  // Nights taken out, so the anchor is a segment and not an hour. See `AxisAnchor`.
  useWheelZoom(scroll, pxPerHour, setPxPerHour, PHASE_ZOOM, {
    anchorAt: (x) => anchorAt(axis, x),
    xOf: (anchor, zoom) => xOfAnchor(buildPhaseAxis(phase, zoom, day), anchor),
  });

  useLayoutEffect(() => {
    fit();
    // On the day, and on the way in. Not on `fit` itself, which is re-created with the plan: a
    // zoom the régisseur chose must survive the next edit. "Ajuster" asks for it again by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const people = useMemo(
    () => phasePeople(phase, plan.organisers, plan.volunteers),
    [phase, plan.organisers, plan.volunteers],
  );
  /*
   * What the axis actually has room for. With no day filter this is everything; with one it is
   * that day's own boxes and événements, so a lane is as tall as the day shown rather than as
   * tall as the whole phase, and "3 case(s)" counts what is under it.
   */
  const boxes = useMemo(
    () => allPlacements(phase).filter((box) => piecesOf(axis, box).length > 0),
    [phase, axis],
  );
  const fills = useMemo(
    () => eventFills(phase).filter((fill) => piecesOf(axis, fill.event).length > 0),
    [phase, axis],
  );
  /*
   * THE ACTS' MOMENTS THAT FALL IN THIS PHASE, since 2026-09-13: balances the afternoon before
   * the doors open, mostly. Read from the line-up in the phase's own hours (`artistMomentsIn`
   * does the translation), drawn on a lane of their own under the événements, and never stored
   * here: they are the act's, edited on the Artistes tab, and nobody is placed on them. Same
   * bands and same colours as under the exploit's ruler, so a balance reads the same on both.
   */
  const artistMoments = useMemo(
    () =>
      artistMomentsIn(plan.startISO, phase, plan.artists).filter(
        (moment) => piecesOf(axis, moment).length > 0,
      ),
    [plan.startISO, plan.artists, phase, axis],
  );
  const artistRows = useMemo(() => packRows(artistMoments), [artistMoments]);

  const issues = useMemo(
    () => phaseIssues(phase, plan.organisers, plan.volunteers, plan.skills),
    [phase, plan.organisers, plan.volunteers, plan.skills],
  );
  const issuesByBox = useMemo(() => {
    const map = new Map<string, PhaseIssue[]>();
    for (const issue of issues) {
      map.set(issue.assignmentKey, [...(map.get(issue.assignmentKey) ?? []), issue]);
    }
    return map;
  }, [issues]);

  /**
   * Which row each box of each pole sits on, computed ONCE and shared.
   *
   * The lanes below draw from this and the arrow keys walk it, so the two cannot disagree about
   * where a box is. It used to be computed inside the render of each lane, which was fine while
   * nothing else needed to know.
   */
  const rowsByPole = useMemo(() => {
    const perPole = new Map<string, Map<PhasePlacement, number>>();
    for (const pole of phase.poles) {
      const mine = boxes.filter((b) => b.poleKey === pole.key);
      perPole.set(pole.key, packRows(mine, (b) => `${b.personKind}|${b.personKey}`));
    }
    return perPole;
  }, [phase.poles, boxes]);

  /**
   * The grid as rows, top to bottom, for the arrow keys. See `phaseNav.ts`.
   *
   * The événements come first because their lane is drawn first, and a row of that lane is one
   * SLOT INDEX across every block: the places inside a block are stacked vertically, so the
   * second place of one truck and the second place of the next are on the same line of the
   * screen. Then one entry per pole row, in the order the poles are drawn.
   */
  const navRows = useMemo<NavRows>(() => {
    const asNav = (box: PhasePlacement): NavBox => ({
      key: box.assignmentKey,
      start: box.start,
      end: box.end,
    });
    const byStart = (a: NavBox, b: NavBox) => a.start - b.start;

    const eventRows: NavBox[][] = [];
    for (const { event } of fills) {
      boxes
        .filter((b) => b.eventKey === event.key)
        .forEach((b, slot) => {
          (eventRows[slot] ??= []).push(asNav(b));
        });
    }

    const poleRows: NavBox[][] = [];
    for (const pole of phase.poles) {
      const rows = rowsByPole.get(pole.key);
      if (!rows) continue;
      const highest = rows.size === 0 ? -1 : Math.max(...rows.values());
      const lane: NavBox[][] = Array.from({ length: highest + 1 }, () => []);
      for (const [box, row] of rows) lane[row]!.push(asNav(box));
      // A lane with nobody in it still takes a line of the grid, so it takes one here too.
      poleRows.push(...(lane.length === 0 ? [[]] : lane));
    }

    return [...eventRows, ...poleRows].map((row) => [...row].sort(byStart));
  }, [fills, boxes, phase.poles, rowsByPole]);

  /**
   * The keyboard cursor IS the selection, rather than a second thing beside it.
   *
   * Two pieces of state would be two answers to "which box is it", and they would drift the first
   * time a click set one and not the other. It also means the picked box already draws itself:
   * the same doctrine as the exploit, where `.box.is-cursor` deliberately has no style because
   * the box it lands on is the selected one. See `styles.css`.
   */
  const cursorKey = selection?.kind === 'case' ? selection.assignmentKey : null;

  const moveCursor = useCallback(
    (dx: number, dy: number) => {
      const next = stepBox(navRows, cursorKey, dx, dy);
      if (!next) return;
      setKeyNote(null);
      setSelection({ kind: 'case', phaseId: id, assignmentKey: next });
    },
    [cursorKey, navRows, id],
  );

  /** Suppr takes the box under the cursor off the grid. It never touches the person's answer. */
  const deleteAtCursor = useCallback(() => {
    if (readOnly || cursorKey === null) return;
    const box = phase.assignments.find((a) => a.key === cursorKey);
    if (!box) return;
    const who = nameOf(box.personKind, box.personKey);
    // Where the cursor goes next, decided BEFORE the box is gone: after the deletion there is
    // nothing left to step from, and leaving the selection on a box that no longer exists would
    // empty the panel with no way back to the grid but the mouse.
    const after = stepBox(navRows, cursorKey, 1, 0) ?? stepBox(navRows, cursorKey, -1, 0);
    edit((p) => removePhaseAssignment(p, id, cursorKey), `case de ${who} retirée`);
    setSelection(after === null ? null : { kind: 'case', phaseId: id, assignmentKey: after });
    setKeyNote(`${who} retiré de cette case. Ctrl+Z annule.`);
  }, [cursorKey, edit, id, navRows, phase.assignments, readOnly]);

  /*
   * Bound on the window, like the exploit's and like the undo shortcut, and stepped around every
   * field the régisseur might be typing in: the day picker and the search box sit in the same
   * toolbar, and an arrow key inside one of those belongs to it.
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
          if (cursorKey === null) return;
          event.preventDefault();
          deleteAtCursor();
          return;
        case 'Escape':
          setSelection(null);
          return;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursorKey, deleteAtCursor, moveCursor]);

  /* The cursor may land on a box three screens along, so the grid follows it. */
  useEffect(() => {
    if (cursorKey === null) return;
    document.querySelector('.phase-bar.is-picked, .box.is-mini.is-picked')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }, [cursorKey]);

  const toPlace = useMemo(() => (readOnly ? 0 : declaredToPlace(plan, id)), [plan, id, readOnly]);

  /**
   * Whose boxes are ringed: every box this person holds on this phase, not only the one clicked.
   *
   * The exploit has done this from the start and the phases did not, which the régisseur asked
   * for on 2026-09-12. Reading "elle est déjà à la scène jeudi matin" off the grid is the whole
   * point of a grid; hunting for the same name a lane lower is not. Selecting somebody in the
   * list on the right rings their boxes too, exactly as it does on the exploit.
   */
  const kin = useMemo(
    () => selectedPerson(selection, phase.assignments),
    [selection, phase.assignments],
  );

  const nameOf = (kind: PersonKind, key: string): string => {
    if (kind === 'orga') {
      const found = plan.organisers.find((o) => o.key === key);
      return found ? organiserName(found) : key;
    }
    return index.volunteerShortName(key);
  };

  const place = (
    person: { kind: PersonKind; key: string },
    target: { kind: 'pole'; poleKey: string } | { kind: 'event'; eventKey: string } | null,
    start: number,
    end: number,
  ) => {
    if (readOnly) return;
    const who = nameOf(person.kind, person.key);
    const where =
      target === null
        ? 'sa présence déclarée'
        : target.kind === 'pole'
          ? (phase.poles.find((p) => p.key === target.poleKey)?.name ?? target.poleKey)
          : (phase.events.find((e) => e.key === target.eventKey)?.label ?? target.eventKey);
    edit(
      (p) => assignWindow(p, id, person, target, start, end),
      `${who} sur ${where}, ${toLabel(phase.startISO, start)}`,
    );
  };

  /**
   * Dropping a box where there is nothing: it leaves the grid.
   *
   * The three places that mean this, all asked for on 2026-09-12 and all the exploit's already:
   * under the last pole, past the end of the axis, and the pane on the right. The person stays on
   * the phase and stays in the plan; one box goes, and Ctrl+Z brings it back.
   */
  const takeAway = () => {
    const session = drag;
    setDrag(null);
    if (readOnly || !session?.assignmentKey) return;
    edit(
      (p) => removePhaseAssignment(p, id, session.assignmentKey!),
      `case de ${session.name} retirée`,
    );
  };

  /** Whether letting go on the empty part of the grid would take a box away. */
  const canDropVoid = (event: React.DragEvent): boolean =>
    !readOnly && event.dataTransfer.types.includes(DRAG_MIME) && drag?.assignmentKey != null;

  /** A person dropped on a pole lane, from the list on the right or from another lane. */
  const dropOn = (poleKey: string, x: number) => {
    if (!drag || readOnly) return;
    const person = { kind: drag.kind, key: drag.key };

    if (drag.from) {
      // Moving a box keeps its hours: a pole change is not a reason to reshape somebody's day.
      place(person, { kind: 'pole', poleKey }, drag.from.start, drag.from.end);
      setDrag(null);
      return;
    }

    /*
     * From the list: the window is what this person DECLARED for the day that was dropped on,
     * never the whole day. Somebody who wrote "vendredi après-midi" lands on Friday afternoon.
     */
    const segment = segmentAt(axis, x);
    const found = people.find((p) => p.kind === drag.kind && p.key === drag.key);
    if (!segment || !found) return;
    const window = found.presence
      .map((w) => ({ start: Math.max(w.start, segment.start), end: Math.min(w.end, segment.end) }))
      .find((w) => w.end > w.start);
    if (window) place(person, { kind: 'pole', poleKey }, window.start, window.end);
    setDrag(null);
  };

  /**
   * An edge let go: the box takes the hours the drag ended on.
   *
   * THE WINDOW IS HANDED IN RATHER THAN READ FROM STATE, and that is not a style choice. The drag
   * is followed with listeners on the window, registered once when the grip is pressed, so the
   * function they call is the one that existed at that moment and the `resize` state it could see
   * was still null. Passing the last window the move handler computed is what makes letting go
   * commit what is on screen instead of nothing at all.
   */
  const commitResize = (assignmentKey: string, next: Edges | null) => {
    setResize(null);
    if (!next || readOnly) return;
    const row = phase.assignments.find((a) => a.key === assignmentKey);
    if (!row || (row.start === next.start && row.end === next.end)) return;
    edit(
      (p) => setPhaseAssignment(p, id, assignmentKey, { start: next.start, end: next.end }),
      `horaires de ${nameOf(row.personKind, row.personKey)}`,
    );
  };

  if (!phase.enabled) {
    return (
      <div className="screen">
        <div className="screen-main">
          <div className="toolbar">{switcher}</div>
          <p className="panel-sub" style={{ padding: 16 }}>
            Cette phase n'est pas activée. Elle s'active dans Réglages, avec ses dates, ses pôles
            et ses événements.
          </p>
        </div>
      </div>
    );
  }

  /** The événements lane: one row of blocks, as tall as the fullest of them. */
  const eventRows = Math.max(
    1,
    ...fills.map((fill) => Math.max(fill.event.headcount, fill.taken)),
  );
  const eventBlockH = eventBlockHeight(eventRows);
  const eventLaneHeight = eventBlockH + LANE_PAD;

  return (
    <div className="screen has-info">
      <div className="screen-main">
        <div className="toolbar">
          {switcher}
          <div className="toolbar-sep" />

          {/*
            One day at a time, or the whole phase.

            FIRST IN THE TOOLBAR AND CARRYING ITS OWN WORD. It was an unlabelled select between the
            zoom buttons and the head count on 2026-09-12, and the régisseur simply did not find
            it: "je ne vois pas le sélecteur". A control nobody sees is a control that does not
            exist, and a bare select reading "Tous les jours" says nothing about what it filters.

            It narrows the AXIS, so the grid, the drops, the trimming and the list on the right all
            see the same days. See `buildPhaseAxis`.
          */}
          <label className="toolbar-field">
            <span>Jour</span>
            <select
              className="select"
              value={day === null ? ALL_DAYS : String(day)}
              aria-label="N'afficher qu'un jour"
              title="N'afficher qu'un jour de la phase"
              onChange={(event) =>
                setDay(event.target.value === ALL_DAYS ? null : Number(event.target.value))
              }
            >
              <option value={ALL_DAYS}>Tous les jours</option>
              {days.map((d) => (
                <option key={d.index} value={String(d.index)}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <div className="toolbar-sep" />
          <ZoomSlider value={pxPerHour} bounds={PHASE_ZOOM} onChange={setPxPerHour} onFit={fit} />
          <div className="toolbar-sep" />
          <strong>
            {people.length} personne{people.length > 1 ? 's' : ''} sur place
          </strong>

          {toPlace > 0 && (
            <button
              className="btn is-primary"
              title="Écrit les cases que les réponses au formulaire demandent, sans toucher à celles qui existent"
              onClick={() =>
                edit((p) => placeDeclared(p, id), `${toPlace} présence(s) déclarée(s) placée(s)`)
              }
            >
              Placer {toPlace} présence{toPlace > 1 ? 's' : ''} déclarée{toPlace > 1 ? 's' : ''}
            </button>
          )}

          <span className="toolbar-note">
            {keyNote ??
              (issues.length > 0
                ? `${issues.length} case(s) en rouge: contredisent une réponse`
                : 'Flèches pour circuler, Suppr pour retirer. Tirer un bord allonge une case.')}
          </span>
        </div>

        {people.length === 0 && (
          <p className="panel-sub" style={{ padding: '8px 16px' }}>
            Personne n'a déclaré être là sur cette phase. Un orga apparaît dès que sa date
            d'arrivée est renseignée sur sa fiche, un bénévole dès que la phase lui est ouverte et
            qu'il a répondu oui.
          </p>
        )}

        {/*
          The empty part of the grid is a bin, exactly as the exploit's is: under the last pole and
          past the end of the axis there is nothing to land on, and letting go there used to do
          nothing at all. Every real target calls `stopPropagation` on its own drop, so anything
          reaching this handler genuinely landed on the background.
        */}
        <div
          ref={scroll}
          className="grid-scroll"
          /*
           * IT ACCEPTS THE DROP AND SAYS NOTHING, since 2026-09-13, exactly as the exploit does
           * and for the reason written there: every other dashed-blue surface in this tool means
           * "let go here and the person lands here", and this one means the opposite. The bin in
           * the right-hand pane is what announces a removal.
           */
          onDragOver={(event) => {
            if (!canDropVoid(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            if (!canDropVoid(event)) return;
            event.preventDefault();
            takeAway();
          }}
        >
          <div className="grid-inner" style={{ width: `calc(var(--label-w) + ${axis.width}px)` }}>
            <div className="grid-head">
              <div className="grid-corner">
                <span>{phase.label || (id === 'montage' ? 'Montage' : 'Démontage')}</span>
                <span>{fmtHours(phase.lengthHours)} au total</span>
              </div>
              <PhaseRuler axis={axis} phase={phase} />
            </div>

            {fills.length > 0 && (
              <div className="lane is-events">
                <div className="lane-label">
                  <span className="lane-label-name">Événements</span>
                  <span className="lane-label-parent">{fills.length} au total</span>
                  <span
                    className={`lane-label-stat ${fills.some((f) => f.missing > 0) ? 'is-gap' : ''}`}
                  >
                    {fills.reduce((total, f) => total + f.missing, 0) === 0
                      ? 'complet'
                      : `${fills.reduce((total, f) => total + f.missing, 0)} à pourvoir`}
                  </span>
                </div>
                <div
                  className="lane-track is-phase"
                  style={
                    {
                      width: axis.width,
                      height: eventLaneHeight,
                      '--hour-w': `${axis.pxPerHour}px`,
                    } as React.CSSProperties
                  }
                >
                  {axis.segments.map((segment) => (
                    <div
                      key={`${segment.dayIndex}-${segment.start}`}
                      className="phase-column"
                      style={{ left: segment.x, width: segment.width }}
                    />
                  ))}

                  {fills.map(({ event, taken, missing }) => {
                    const inside = boxes.filter((b) => b.eventKey === event.key);
                    /*
                     * TOO MANY IS AS WRONG AS TOO FEW, since 2026-09-13. An événement asking for
                     * six people and holding eight is not a happy surprise: it is two people
                     * standing where they are not needed, and missing from wherever they should
                     * have been. A headcount of zero means "as many as turn up" and is never
                     * reported either way, which is what it is for.
                     */
                    const over = event.headcount > 0 && taken > event.headcount;
                    return piecesOf(axis, event).map((piece, i) => (
                      <div
                        key={`${event.key}-${piece.x}`}
                        className={`phase-event-block${missing > 0 || over ? ' is-short' : ''}`}
                        style={{
                          left: piece.x,
                          width: Math.max(56, piece.width - 2),
                          height: eventBlockH,
                          top: LANE_PAD / 2,
                        }}
                        onDragOver={(e) => {
                          if (drag && !readOnly) e.preventDefault();
                        }}
                        onDrop={() => {
                          if (!drag || readOnly) return;
                          place(
                            { kind: drag.kind, key: drag.key },
                            { kind: 'event', eventKey: event.key },
                            event.start,
                            event.end,
                          );
                          setDrag(null);
                        }}
                        title={
                          `${event.label}\n` +
                          `${toClock(phase.startISO, event.start)} à ${toClock(phase.startISO, event.end)}\n` +
                          `${taken} sur ${event.headcount}` +
                          (over ? ` (${taken - event.headcount} de trop)` : '') +
                          '\nCliquer pour les détails'
                        }
                        onClick={() =>
                          setSelection({
                            kind: 'evenement',
                            phaseId: id,
                            eventKey: event.key,
                            fill: false,
                          })
                        }
                      >
                        <div className="phase-event-title">
                          <span className="phase-event-name">{event.label}</span>
                          <span className="phase-event-count">
                            {event.headcount === 0 ? taken : `${taken}/${event.headcount}`}
                          </span>
                        </div>

                        {/* The people, then the places still to fill, on the first piece only:
                            an événement cut by a night is one job, not two crews. */}
                        {i === 0 && (
                          <div className="phase-event-slots">
                            {/*
                              CLICKING SELECTS, IT DOES NOT REMOVE. This click used to take the
                              person out of the événement on the spot, which is the gesture a
                              régisseur makes to find out who somebody is: "j'ai cliqué sur une
                              case et ça a supprimé une personne". Removing is a named button in
                              the panel that opens. Same doctrine as a bar on a pole lane.
                            */}
                            {inside.map((box) => {
                              /*
                               * AN ÉVÉNEMENT TURNS RED LIKE ANY OTHER BOX, since 2026-09-12. It
                               * did not, and it is the one place on a phase where somebody is
                               * most likely to be written down for a day they said they were
                               * away: an événement is filled from whoever is around, so the
                               * question "was this person even there" is asked of nobody. Same
                               * issues, same red, same tooltip as a bar on a pole lane.
                               */
                              const wrong = issuesByBox.get(box.assignmentKey) ?? [];
                              return (
                              <span
                                key={box.assignmentKey}
                                className={
                                  `box is-mini${box.personKind === 'orga' ? ' is-orga-box' : ''}` +
                                  (wrong.length > 0 ? ' is-illegal' : '') +
                                  // An événement is where the same person is most easily missed,
                                  // so the ring counts here too.
                                  (kin?.kind === box.personKind && kin.key === box.personKey
                                    ? ' is-kin'
                                    : '') +
                                  (selection?.kind === 'case' &&
                                  selection.assignmentKey === box.assignmentKey
                                    ? ' is-picked'
                                    : '')
                                }
                                role="button"
                                /*
                                 * A DRAG SOURCE LIKE EVERY OTHER BOX, since 2026-09-13: "glisser
                                 * déposer une case d'un événement vers le volet de droite ne
                                 * marche pas". It did not, because a place inside an événement was
                                 * the one kind of box on a phase that was never made draggable, so
                                 * taking somebody out of one meant opening their panel and finding
                                 * the button while every other box came out on the bin.
                                 */
                                draggable={!readOnly}
                                onDragStart={(dragged) => {
                                  dragged.stopPropagation();
                                  dragged.dataTransfer.effectAllowed = 'move';
                                  // Firefox refuses to open a drag with nothing set at all.
                                  dragged.dataTransfer.setData('text/plain', box.personKey);
                                  dragged.dataTransfer.setData(DRAG_MIME, box.personKey);
                                  setDrag({
                                    kind: box.personKind,
                                    key: box.personKey,
                                    name: nameOf(box.personKind, box.personKey),
                                    from: { start: box.start, end: box.end },
                                    assignmentKey: box.assignmentKey,
                                  });
                                }}
                                onDragEnd={() => setDrag(null)}
                                title={
                                  `${nameOf(box.personKind, box.personKey)}` +
                                  wrong.map((issue) => `\n${issue.message}`).join('') +
                                  (readOnly
                                    ? '\nCliquer pour voir sa fiche'
                                    : '\nGlisser pour retirer, cliquer pour voir sa fiche')
                                }
                                onClick={(clicked) => {
                                  clicked.stopPropagation();
                                  setSelection({
                                    kind: 'case',
                                    phaseId: id,
                                    assignmentKey: box.assignmentKey,
                                  });
                                }}
                              >
                                <PersonMark kind={box.personKind} />
                                {nameOf(box.personKind, box.personKey)}
                              </span>
                              );
                            })}
                            {Array.from({ length: missing }, (_, slot) => (
                              <span
                                key={`vide-${slot}`}
                                className="box is-empty is-mini"
                                role={readOnly ? undefined : 'button'}
                                title={readOnly ? undefined : 'À pourvoir. Cliquer pour choisir qui.'}
                                onClick={
                                  readOnly
                                    ? undefined
                                    : (clicked) => {
                                        clicked.stopPropagation();
                                        setSelection({
                                          kind: 'evenement',
                                          phaseId: id,
                                          eventKey: event.key,
                                          fill: true,
                                        });
                                      }
                                }
                              >
                                Vide
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ));
                  })}
                </div>
              </div>
            )}

            {artistMoments.length > 0 && (
              <div className="lane is-artists">
                <div className="lane-label">
                  <span className="lane-label-name">Artistes</span>
                  <span className="lane-label-parent">
                    {artistMoments.length} moment{artistMoments.length > 1 ? 's' : ''}
                  </span>
                  <span className="lane-label-stat">balances, plateau</span>
                </div>
                <div
                  className="lane-track is-phase"
                  style={
                    {
                      width: axis.width,
                      height: (Math.max(...artistRows.values()) + 1) * ARTIST_ROW_H + LANE_PAD,
                      '--hour-w': `${axis.pxPerHour}px`,
                    } as React.CSSProperties
                  }
                >
                  {axis.segments.map((segment) => (
                    <div
                      key={`${segment.dayIndex}-${segment.start}`}
                      className="phase-column"
                      style={{ left: segment.x, width: segment.width }}
                    />
                  ))}
                  {artistMoments.map((moment, i) =>
                    piecesOf(axis, moment).map((piece) => (
                      <div
                        key={`${moment.artistKey}-${moment.kind}-${i}-${piece.x}`}
                        className={`artist-band is-${moment.kind}`}
                        style={{
                          left: piece.x,
                          width: Math.max(4, piece.width - 2),
                          top: LANE_PAD / 2 + (artistRows.get(moment) ?? 0) * ARTIST_ROW_H,
                          height: ARTIST_ROW_H,
                        }}
                        title={
                          `${moment.label}\n${MOMENT_WORD[moment.kind]}, ` +
                          `${toClock(phase.startISO, moment.start)} à ${toClock(phase.startISO, moment.end)}` +
                          "\nSe modifie dans l'onglet Artistes"
                        }
                      >
                        {moment.label}
                      </div>
                    )),
                  )}
                </div>
              </div>
            )}

            {phase.poles.map((pole) => {
              const mine = boxes.filter((b) => b.poleKey === pole.key);
              // One row per person, so somebody with two windows in this pole, and above all two
              // that follow one another, reads as one person and not as two. Computed once for
              // the whole grid, so the arrow keys walk exactly what is drawn.
              const rows = rowsByPole.get(pole.key) ?? new Map<PhasePlacement, number>();
              const height =
                Math.max(1, mine.length === 0 ? 1 : Math.max(...rows.values()) + 1) *
                  (ROW_H + ROW_GAP) +
                LANE_PAD;

              return (
                <div
                  key={pole.key}
                  className="lane"
                  style={{ '--pole': pole.colour ?? '#8a8a8a' } as React.CSSProperties}
                >
                  <div className="lane-label">
                    <span className="lane-label-name">{pole.name}</span>
                    {pole.key === GENERAL_POLE_KEY && (
                      <span className="lane-label-parent">tout le monde par défaut</span>
                    )}
                    <span className="lane-label-stat">
                      {mine.length === 0 ? 'personne' : `${mine.length} case(s)`}
                    </span>
                  </div>

                  <PoleTrack
                    axis={axis}
                    height={height}
                    readOnly={readOnly}
                    dragging={drag !== null}
                    onDropPerson={(x) => dropOn(pole.key, x)}
                  >
                    {mine.map((box) => (
                      <Bars
                        key={box.assignmentKey}
                        axis={axis}
                        box={box}
                        row={rows.get(box) ?? 0}
                        label={nameOf(box.personKind, box.personKey)}
                        issues={issuesByBox.get(box.assignmentKey) ?? []}
                        picked={
                          selection?.kind === 'case' &&
                          selection.assignmentKey === box.assignmentKey
                        }
                        kin={kin?.kind === box.personKind && kin.key === box.personKey}
                        readOnly={readOnly}
                        phase={phase}
                        resize={resize?.assignmentKey === box.assignmentKey ? resize : null}
                        onDragStart={(payload) => setDrag(payload)}
                        onDragEnd={() => setDrag(null)}
                        onPick={() =>
                          setSelection({
                            kind: 'case',
                            phaseId: id,
                            assignmentKey: box.assignmentKey,
                          })
                        }
                        onResize={(next) => setResize(next)}
                        onResizeEnd={commitResize}
                      />
                    ))}
                  </PoleTrack>
                </div>
              );
            })}
          </div>
        </div>

        {issues.length > 0 && (
          <div className="panel-sub" style={{ padding: '8px 16px' }}>
            <strong>Ce qui contredit une réponse ({issues.length})</strong>
            <ul>
              {issues.map((issue, i) => (
                <li key={`${issue.assignmentKey}-${i}`}>
                  {nameOf(issue.personKind, issue.personKey)}: {issue.message} Rien n'a été retiré.
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/*
        The two panes on the right, the same two the exploit carries, in the same order: who is
        still to place, then what is selected. Until 2026-09-11 a phase had one unstyled aside per
        thing it could show, they fought over the same column, and the third one landed under the
        grid. See `PoolPanel` and `InfoPanel`.
      */}
      <PoolPanel
        moment={id}
        tab={tab}
        onTabChange={setTab}
        day={day}
        selection={selection}
        onSelect={setSelection}
        onDragStartPhase={(row) =>
          setDrag({
            kind: row.kind,
            key: row.personKey,
            name: row.name,
            from: null,
            assignmentKey: null,
          })
        }
        onDragEndPool={() => setDrag(null)}
        onDropUnassign={takeAway}
        readOnly={readOnly}
      />

      <InfoPanel selection={selection} onSelect={setSelection} readOnly={readOnly} />

      {/* The same bin the exploit has, for the same reason: the pane is a narrow strip on the far
          right and finding it while holding a box across a wide grid is work. */}
      {drag?.assignmentKey && <TrashTarget label="Retirer cette case" onDrop={takeAway} />}
    </div>
  );
}

/** The hours across the top, one block per day, and the days named above them. */
function PhaseRuler({ axis, phase }: { axis: PhaseAxis; phase: Phase }) {
  const every = labelStep(axis.pxPerHour);

  return (
    <div className="phase-ruler" style={{ width: axis.width }}>
      {axis.days.map((day) => (
        <div key={day.index} className="phase-ruler-day" style={{ left: day.x, width: day.width }}>
          {day.label}
        </div>
      ))}

      {axis.segments.map((segment) => {
        const first = Math.ceil(segment.start);
        const ticks: number[] = [];
        for (let hour = first; hour < segment.end; hour += 1) ticks.push(hour);
        return ticks.map((hour) => (
          <div
            key={`${segment.dayIndex}-${hour}`}
            className={`phase-ruler-hour ${hour === segment.start ? 'is-day' : ''}`}
            style={{ left: segment.x + (hour - segment.start) * axis.pxPerHour }}
          >
            {(hour - first) % every === 0 ? toClock(phase.startISO, hour) : ''}
          </div>
        ));
      })}
    </div>
  );
}

/** A pole's track: the day columns, and a drop from the list or from another lane. */
function PoleTrack({
  axis,
  height,
  readOnly,
  dragging,
  onDropPerson,
  children,
}: {
  axis: PhaseAxis;
  height: number;
  readOnly: boolean;
  dragging: boolean;
  onDropPerson(x: number): void;
  children: React.ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={track}
      className="lane-track is-phase"
      style={
        { width: axis.width, height, '--hour-w': `${axis.pxPerHour}px` } as React.CSSProperties
      }
      onDragOver={(event) => {
        if (dragging && !readOnly) event.preventDefault();
      }}
      onDrop={(event) => {
        if (readOnly || !track.current) return;
        // A real target: the grid's background must not also read this as a drop on nothing and
        // take the box away. See `canDropVoid` in `PhaseGrid`.
        event.stopPropagation();
        event.preventDefault();
        onDropPerson(event.clientX - track.current.getBoundingClientRect().left);
      }}
    >
      {/* One tinted column per worked stretch, so a night reads as a gap and not as a border. */}
      {axis.segments.map((segment) => (
        <div
          key={`${segment.dayIndex}-${segment.start}`}
          className="phase-column"
          style={{ left: segment.x, width: segment.width }}
        />
      ))}
      {children}
    </div>
  );
}

/**
 * One person's window, as the one or more bars the nights cut it into, with an edge to pull.
 *
 * THE EDGES ARE WHERE THE HOURS ARE SET. A phase is trimmed constantly, day by day, and going
 * through a panel for every quarter of an hour was the wrong shape for that: the gesture is
 * "this one finishes earlier", and it is a drag. The pull is clamped to the day the bar is on,
 * because a box that crossed a night would be drawn in two places with one set of hours.
 *
 * THREE THINGS MADE THE DRAG BARELY WORK UNTIL 2026-09-11, and each is worth naming because each
 * one would come back on its own:
 *
 *   THE ELEMENT HOLDING THE POINTER WAS BEING DESTROYED UNDER IT. The drag was followed with
 *   `setPointerCapture` on the grip, and the bars were keyed on their own left edge. Moving the
 *   start edge changes that edge, so React saw a new key, unmounted the grip mid-drag and threw
 *   the capture away with it: the box moved exactly one quarter of an hour and then froze, which
 *   is precisely what the régisseur reported. The keys are now the piece's rank, which does not
 *   move, and the drag is followed with listeners on the window, which no remount can interrupt.
 *
 *   LETTING GO COMMITTED NOTHING. `onPointerUp` called a function that read the proposed window
 *   out of React state; the listener had been created before that state existed, so it read null.
 *   The last window the move handler computed is handed to the commit instead.
 *
 *   DRAGGING PAST THE EDGE OF A DAY COLLAPSED THE BOX. The position was turned into an hour by
 *   `hoursAt`, which answers null in the gap between two days, on purpose, and the fallback was
 *   the START of the day. So pulling the end of a box into the night set its end to the morning,
 *   and the minimum length then left a fifteen-minute box: "ça change l'horaire du début de la
 *   case". The position is clamped to the day's own bounds now, so pulling past the end of a day
 *   means the end of that day.
 *
 * WHAT IS LEFT OF THE LIMITS is the day the box is on, and a quarter of an hour of it. The drag is
 * otherwise free: any quarter of that day, in either direction, however far the pointer travels.
 */
function Bars({
  axis,
  box,
  row,
  label,
  issues,
  picked,
  kin,
  readOnly,
  phase,
  resize,
  onDragStart,
  onDragEnd,
  onPick,
  onResize,
  onResizeEnd,
}: {
  axis: PhaseAxis;
  box: PhasePlacement;
  row: number;
  label: string;
  issues: readonly PhaseIssue[];
  picked: boolean;
  /** Another box of the same person, ringed so a whole phase reads as one person at a glance. */
  kin: boolean;
  readOnly: boolean;
  phase: Phase;
  resize: Resize | null;
  onDragStart(payload: PhaseDrag): void;
  onDragEnd(): void;
  onPick(): void;
  onResize(next: Resize): void;
  onResizeEnd(assignmentKey: string, next: Edges | null): void;
}) {
  const shown = resize ? { start: resize.start, end: resize.end } : box;
  const pieces = piecesOf(axis, shown);
  const title =
    `${label}\n${toClock(phase.startISO, shown.start)} → ${toClock(phase.startISO, shown.end)}, ` +
    `${fmtHours(shown.end - shown.start)}` +
    issues.map((issue) => `\n${issue.message}`).join('');

  /**
   * Pressing a grip: follow the pointer on the window until it is let go.
   *
   * On the window and not on the grip, because the grip is redrawn at every quarter of an hour as
   * the box changes shape, and an element being replaced loses every listener and every capture
   * it held. The window outlives the whole gesture.
   */
  const beginResize =
    (edge: 'start' | 'end', segment: PhaseSegment) =>
    (down: React.PointerEvent<HTMLSpanElement>) => {
      down.preventDefault();
      down.stopPropagation();
      const track = down.currentTarget.closest('.lane-track');
      if (!track) return;
      const left = track.getBoundingClientRect().left;

      let last: Edges | null = null;
      const move = (event: PointerEvent) => {
        const hour = hourOn(axis, segment, event.clientX - left, SNAP);
        last = trimTo(box, segment, edge, hour, SNAP);
        onResize({ assignmentKey: box.assignmentKey, start: last.start, end: last.end });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        onResizeEnd(box.assignmentKey, last);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };

  return (
    <>
      {pieces.map((piece, i) => (
        <div
          // The piece's RANK, never its position: a key that moves with the box is a key that
          // remounts it in the middle of a drag. See the header.
          key={i}
          className={
            'phase-bar' +
            (box.personKind === 'orga' ? ' is-orga' : '') +
            (issues.length > 0 ? ' is-illegal' : '') +
            // The ring goes on every box of the selected person; the fill only on the one clicked.
            (kin ? ' is-kin' : '') +
            (picked ? ' is-picked' : '') +
            (resize ? ' is-resizing' : '')
          }
          style={{
            left: piece.x,
            width: Math.max(6, piece.width - 2),
            top: row * (ROW_H + ROW_GAP) + LANE_PAD / 2,
            height: ROW_H,
          }}
          draggable={!readOnly}
          title={title}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            // Something has to be set or Firefox refuses to start the drag at all.
            event.dataTransfer.setData('text/plain', box.personKey);
            /*
             * The app's own type as well, since 2026-09-12, so that the pane on the right, the
             * bin and the empty part of the grid can all recognise a box in flight DURING a
             * dragover, when `getData` answers nothing. What is being dragged still travels in
             * React state, because a phase drop depends on where it lands.
             */
            event.dataTransfer.setData(DRAG_MIME, box.personKey);
            onDragStart({
              kind: box.personKind,
              key: box.personKey,
              name: label,
              from: { start: box.start, end: box.end },
              assignmentKey: box.assignmentKey,
            });
          }}
          onDragEnd={onDragEnd}
          onClick={(event) => {
            event.stopPropagation();
            onPick();
          }}
        >
          {i === 0 && (
            <span className="phase-bar-name">
              <PersonMark kind={box.personKind} />
              {label}
            </span>
          )}

          {/*
            A grip goes on the piece that CARRIES that edge of the box, never simply on the first
            and last piece drawn. Without a day filter the two say the same thing; with one they do
            not, and the difference matters: a box running over Wednesday and Thursday, looked at
            on Thursday alone, would otherwise offer a "début" grip whose every position moves the
            start into Thursday and quietly drops the Wednesday half nobody can see. An edge that
            is not on screen has no grip, which is the honest answer.
          */}
          {!readOnly && (
            <>
              {Math.abs(piece.start - shown.start) < 1e-6 && (
                <span
                  className="phase-bar-grip is-start"
                  title="Tirer pour changer le début"
                  onPointerDown={beginResize('start', piece.segment)}
                />
              )}
              {Math.abs(piece.end - shown.end) < 1e-6 && (
                <span
                  className="phase-bar-grip is-end"
                  title="Tirer pour changer la fin"
                  onPointerDown={beginResize('end', piece.segment)}
                />
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
}
