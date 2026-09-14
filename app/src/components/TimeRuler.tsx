/**
 * The time axis: hours across the top, the three slots marked, the line-up underneath.
 *
 * The line-up is on the ruler rather than in a screen of its own because the artist window is
 * where the hardest conflicts live. A volunteer who asked not to miss a set and is placed
 * during it is a tier 2 issue, and the régisseur needs to see the set and the shift on the same
 * horizontal line to fix it.
 *
 * `LaneRuler` is the same axis, thin, repeated above every pole. Reading the hour of a shift on
 * the eleventh row by tracking back up to a heading twelve rows away does not work, and naming
 * every block with its own hours cost more room than it bought. Repeating the axis costs
 * fifteen pixels a pole and answers the question where the question is asked.
 *
 * THE LINE-UP IS FOUR KINDS OF BAND, since 2026-09-13: the set, the changement de plateau on
 * either side of it, and the balances, each in its own colour and each packed on its own row
 * when two overlap. They are the engine's `artistMomentsInExploit`, clipped to the event, and
 * the ruler grows a row at a time to hold them: a line-up with no changeover and no balances is
 * exactly the one row it always was.
 *
 * THE DAY IS WRITTEN ON THE AXIS, since 2026-09-13. An event running from midday to six the
 * next morning crosses midnight, and one running a week crosses it seven times; "2h" alone does
 * not say which night. The head ruler names the day above the first hour and above every
 * midnight, and both rulers draw the midnight tick doubled so the change of day reads at a
 * glance down the whole grid.
 */

import { memo, useRef, useState } from 'react';

import {
  MOMENT_WORD,
  artistMomentsInExploit,
  toClock,
  type Artist,
  type EventSlot,
  type LeaderOnPole,
} from '../engine.ts';
import { organiserName } from './labels.ts';
import { packRows } from './phaseAxis.ts';

export interface TimeRulerProps {
  /** When the event really starts. Every hour label on this axis is read off it. */
  startISO: string;
  /** The slots the form asks about. Their boundaries are marked on the axis. */
  slots: readonly EventSlot[];
  /** Length of the event in decimal hours from its start. */
  hours: number;
  pxPerHour: number;
  artists: readonly Artist[];
  /** Sets the selected volunteer asked not to miss. Drawn in bold. */
  namedArtistKeys: ReadonlySet<string>;
}

/** Where a slot begins, drawn as a stronger tick. Read off the plan, not off a constant. */
const startsOf = (slots: readonly EventSlot[]): ReadonlySet<number> =>
  new Set(slots.map((s) => s.start));

/** `.ruler` without its line-up rows: the day row and the hours. Mirrors the stylesheet. */
export const RULER_HEAD_H = 43;
/** One row of line-up bands, in pixels. `.artist-band` is sized from this, not from the CSS. */
export const ARTIST_ROW_H = 19;

/** Below about 56 px an hour the labels collide, so only every other one is drawn. */
const labelStep = (pxPerHour: number): number => (pxPerHour >= 56 ? 1 : 2);

const DAY_LABEL = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
});
const DAY_SHORT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });

const atHour = (startISO: string, hours: number): Date =>
  new Date(new Date(startISO).getTime() + hours * 3600_000);

/** True when this whole hour of the event falls on the stroke of midnight, local time. */
const isMidnight = (startISO: string, hours: number): boolean => {
  const when = atHour(startISO, hours);
  return when.getHours() === 0 && when.getMinutes() === 0;
};

/**
 * The days named on the axis: the first hour, and every midnight. Exported for the test, which
 * checks the day boundaries rather than the pixels.
 */
export function dayMarks(
  startISO: string,
  hours: number,
): Array<{ hour: number; label: string; short: string }> {
  const marks: Array<{ hour: number; label: string; short: string }> = [];
  for (let hour = 0; hour < hours; hour++) {
    if (hour === 0 || isMidnight(startISO, hour)) {
      const when = atHour(startISO, hour);
      marks.push({ hour, label: DAY_LABEL.format(when), short: DAY_SHORT.format(when) });
    }
  }
  return marks;
}

export function TimeRuler({
  startISO,
  slots,
  hours,
  pxPerHour,
  artists,
  namedArtistKeys,
}: TimeRulerProps) {
  const slotStarts = startsOf(slots);
  const every = labelStep(pxPerHour);
  const ticks = Array.from({ length: Math.floor(hours) + 1 }, (_, i) => i);
  const days = dayMarks(startISO, hours);
  const moments = artistMomentsInExploit(hours, artists);
  // No key: a set and its own changeover touch without overlapping and share a row, while two
  // acts whose balances and set collide each get a row of their own.
  const rows = packRows(moments);
  const lines = moments.length === 0 ? 1 : Math.max(...rows.values()) + 1;

  return (
    <div
      className="ruler"
      style={{ width: hours * pxPerHour, height: RULER_HEAD_H + lines * ARTIST_ROW_H }}
    >
      {days.map((day) => (
        <div key={day.hour} className="ruler-day" style={{ left: day.hour * pxPerHour }}>
          {day.label}
        </div>
      ))}
      {ticks.map((hour) => {
        const isSlot = slotStarts.has(hour) || hour === hours;
        const midnight = hour > 0 && isMidnight(startISO, hour);
        return (
          <div
            key={hour}
            className={`ruler-hour ${isSlot ? 'is-slot' : ''} ${midnight ? 'is-midnight' : ''}`}
            style={{ left: hour * pxPerHour }}
          >
            {isSlot || midnight || hour % every === 0 ? toClock(startISO, hour) : ''}
          </div>
        );
      })}

      <div className="ruler-artists" style={{ height: lines * ARTIST_ROW_H }}>
        {moments.map((moment, i) => {
          const named = moment.kind === 'set' && namedArtistKeys.has(moment.artistKey);
          const width = Math.max(4, (moment.end - moment.start) * pxPerHour - 2);
          // A fifteen-minute changeover is a sliver: a truncated "K…" on it says less than the
          // hatching does, and the name is in the tooltip. Sets keep their name whatever the zoom.
          const labelled = moment.kind === 'set' || width >= 48;
          return (
            <div
              key={`${moment.artistKey}-${moment.kind}-${i}`}
              className={`artist-band is-${moment.kind}${named ? ' is-named' : ''}`}
              style={{
                left: moment.start * pxPerHour,
                width,
                top: (rows.get(moment) ?? 0) * ARTIST_ROW_H,
                height: ARTIST_ROW_H,
              }}
              title={
                `${moment.label}\n${MOMENT_WORD[moment.kind]}, ` +
                `${toClock(startISO, moment.start)} à ${toClock(startISO, moment.end)}`
              }
            >
              {labelled ? moment.label : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The thin repeat, drawn above each pole's lane. Hours only, no line-up. */
function LaneRulerImpl({
  startISO,
  slots,
  hours,
  pxPerHour,
}: {
  startISO: string;
  slots: readonly EventSlot[];
  hours: number;
  pxPerHour: number;
}) {
  const slotStarts = startsOf(slots);
  const every = labelStep(pxPerHour);
  const ticks = Array.from({ length: Math.floor(hours) + 1 }, (_, i) => i);
  const days = new Map(dayMarks(startISO, hours).map((day) => [day.hour, day.short]));

  return (
    <div className="lane-ruler" style={{ width: hours * pxPerHour }}>
      {ticks.map((hour) => {
        const isSlot = slotStarts.has(hour) || hour === hours;
        const midnight = hour > 0 && isMidnight(startISO, hour);
        // The day beside the hour where the day changes, so a pole far down the grid still
        // says which night its 2h is.
        const day = days.get(hour);
        return (
          <div
            key={hour}
            className={`lane-ruler-hour ${isSlot ? 'is-slot' : ''} ${midnight ? 'is-midnight' : ''}`}
            style={{ left: hour * pxPerHour }}
          >
            {isSlot || midnight || hour % every === 0 ? toClock(startISO, hour) : ''}
            {day !== undefined && <span className="lane-ruler-day"> {day}</span>}
          </div>
        );
      })}
    </div>
  );
}

export const LaneRuler = memo(LaneRulerImpl);

/**
 * Who is in charge of this pole, and when, drawn on the pole's own hour axis.
 *
 * The question this answers is the 3 a.m. one: the bar has nobody running it between 02h and
 * 04h, and that is visible as a gap in the band rather than worked out from a list. A organiser with
 * no hours set draws nothing, because an invented window would be worse than an empty axis.
 *
 * Not an assignment, not validated, not scheduled. No rule has an opinion about a organiser.
 *
 * THE EDGES ARE PULLED HERE SINCE 2026-09-12, the way a montage box's are, and for the same
 * reason: a responsable's hours are adjusted constantly and going through Réglages for every
 * quarter of an hour is the wrong shape for that gesture. The drag mechanics are the ones
 * `PhaseGrid`'s `Bars` paid for on 2026-09-11 and are copied deliberately: listeners on the
 * WINDOW rather than a pointer capture on the grip, because the grip is redrawn at every quarter
 * of an hour as the band changes shape and an element being replaced loses its capture; and the
 * window that was last computed is HANDED to the commit rather than read out of state, because
 * the listener that calls it was created before that state existed.
 */
export const OrganiserBand = memo(function OrganiserBand({
  startISO,
  organisers,
  hours,
  pxPerHour,
  readOnly = false,
  snap = 0.25,
  onResize,
  onSelect,
}: {
  startISO: string;
  organisers: readonly LeaderOnPole[];
  hours: number;
  pxPerHour: number;
  readOnly?: boolean;
  /** What an edge snaps to, and the shortest a band may be pulled down to. */
  snap?: number;
  /** An edge let go. Absent means the band is drawn without grips. */
  onResize?(roleKey: string, start: number, end: number): void;
  /** A click on the band: it selects the person, it never changes anything. */
  onSelect?(organiserKey: string): void;
}) {
  const placed = organisers.filter(
    ({ role }) => role.start !== null && role.end !== null && role.end > role.start,
  );
  if (placed.length === 0) return null;

  /*
   * TWO RESPONSABLES AT THE SAME HOUR GET A LINE EACH, since 2026-09-13, and the régisseur asked
   * for it in so many words: "au lieu de superposer les cases, ajouter de l'espace vertical et les
   * afficher l'une au-dessus de l'autre". They used to be drawn on top of one another, which hid
   * whichever came second entirely and made a perfectly legitimate arrangement look like one
   * person.
   *
   * `packRows` is the phase grid's own packer, keyed on the PERSON: somebody who runs the bar from
   * 14h to 18h and again from 22h to 02h keeps one line for both windows, exactly as they do on a
   * montage lane, and only a real overlap costs a second line. Nothing is merged and nothing is
   * refused: two people running one pole at one hour is an answer, not a mistake.
   */
  const windows = placed.map((entry) => ({
    ...entry,
    start: entry.role.start!,
    end: entry.role.end!,
  }));
  const rows = packRows(windows, (entry) => entry.organiser.key);
  const lines = Math.max(...rows.values()) + 1;

  return (
    <div
      className="organiser-band"
      style={{ width: hours * pxPerHour, height: lines * BAND_ROW_H }}
    >
      {windows.map((entry) => (
        // Keyed on the role, not the person: one organiser can hold two windows on the same pole.
        <BandItem
          key={entry.role.key}
          startISO={startISO}
          organiser={entry.organiser}
          role={entry.role}
          row={rows.get(entry) ?? 0}
          hours={hours}
          pxPerHour={pxPerHour}
          readOnly={readOnly}
          snap={snap}
          onResize={onResize}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
});

/** One line of the band, in pixels. Mirrors nothing in the stylesheet: the band is sized here. */
const BAND_ROW_H = 18;

/**
 * One responsable's window on one pole: draggable whole, and with an edge to pull at each end.
 *
 * THE WHOLE BAND IS THE HANDLE, and that is the correction of 2026-09-12. The first version gave
 * it two 6 px grips and nothing else, and the régisseur reported "je n'arrive pas à tirer le
 * créneau en tant que responsable": grabbing a band means grabbing the band, not finding the
 * three pixels at its edge. Dragging the body now SLIDES the window, keeping its length, which is
 * the montage's own rule for a start (see `feature_admin_ui.md`, 2026-09-09); dragging an edge
 * changes that end alone.
 *
 * A DRAG AND A CLICK ARE TOLD APART BY DISTANCE, not by which element was hit. Under three pixels
 * of travel the gesture was a click and it selects the person, because a click still has to open
 * their fiche. That is why there is no `onClick`: one handler, one decision, and no chance of a
 * click firing at the end of a drag that has already committed.
 */
function BandItem({
  startISO,
  organiser,
  role,
  row,
  hours,
  pxPerHour,
  readOnly,
  snap,
  onResize,
  onSelect,
}: {
  startISO: string;
  organiser: LeaderOnPole['organiser'];
  role: LeaderOnPole['role'];
  /** Which line of the band this window sits on. Zero unless somebody overlaps it. */
  row: number;
  hours: number;
  pxPerHour: number;
  readOnly: boolean;
  snap: number;
  onResize?(roleKey: string, start: number, end: number): void;
  onSelect?(organiserKey: string): void;
}) {
  /** What the band would become if the pointer were let go now. Null when nothing is in flight. */
  const [shown, setShown] = useState<{ start: number; end: number } | null>(null);
  const element = useRef<HTMLDivElement>(null);

  const window_ = shown ?? { start: role.start!, end: role.end! };
  const name = organiserName(organiser);
  const length = role.end! - role.start!;

  /**
   * One gesture, whichever part of the band was pressed.
   *
   * Followed with listeners on the window rather than a pointer capture on the element, because
   * the element is repositioned at every quarter of an hour and React may replace it: a capture
   * dies with the node it was taken on, which is the bug the montage's bars paid for on
   * 2026-09-11. The last window computed is handed to the commit rather than read back out of
   * state, for the same reason it is there: this closure predates that state.
   */
  const begin = (edge: 'start' | 'end' | 'move') => (down: React.PointerEvent<HTMLElement>) => {
    if (readOnly || !onResize) return;
    // Left button only: a right-click is a context menu, not a drag.
    if (down.button !== 0) return;
    down.preventDefault();
    down.stopPropagation();
    const band = element.current?.parentElement;
    if (!band) return;
    const left = band.getBoundingClientRect().left;
    const grabbedAt = down.clientX;

    let last: { start: number; end: number } | null = null;
    let travelled = 0;

    const move = (event: PointerEvent) => {
      travelled = Math.max(travelled, Math.abs(event.clientX - grabbedAt));
      if (travelled < 3) return;

      if (edge === 'move') {
        const shift = Math.round((event.clientX - grabbedAt) / pxPerHour / snap) * snap;
        const start = Math.min(Math.max(role.start! + shift, 0), Math.max(0, hours - length));
        last = { start, end: start + length };
      } else {
        const raw = (event.clientX - left) / pxPerHour;
        const at = Math.min(Math.max(Math.round(raw / snap) * snap, 0), hours);
        last =
          edge === 'start'
            ? { start: Math.min(at, role.end! - snap), end: role.end! }
            : { start: role.start!, end: Math.max(at, role.start! + snap) };
      }
      setShown(last);
    };

    const up = () => {
      globalThis.removeEventListener('pointermove', move);
      globalThis.removeEventListener('pointerup', up);
      globalThis.removeEventListener('pointercancel', up);
      setShown(null);
      // A press that went nowhere is a click, and a click opens the fiche.
      if (travelled < 3) {
        onSelect?.(organiser.key);
        return;
      }
      if (last && (last.start !== role.start || last.end !== role.end)) {
        onResize(role.key, last.start, last.end);
      }
    };

    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', up);
    globalThis.addEventListener('pointercancel', up);
  };

  return (
    <div
      ref={element}
      className={'organiser-band-item' + (shown ? ' is-moving' : '')}
      style={{
        left: window_.start * pxPerHour,
        width: Math.max(10, (window_.end - window_.start) * pxPerHour - 2),
        top: row * BAND_ROW_H + 1,
        height: BAND_ROW_H - 2,
      }}
      title={
        `${name}, responsable de pôle\n` +
        `${toClock(startISO, window_.start)} à ${toClock(startISO, window_.end)}` +
        (organiser.phone ? `\n${organiser.phone}` : '') +
        (organiser.email ? `\n${organiser.email}` : '') +
        (readOnly
          ? ''
          : "\nGlisser le bandeau le déplace, glisser un bord change cette heure-là, cliquer ouvre la fiche")
      }
      onPointerDown={readOnly || !onResize ? undefined : begin('move')}
      // With no way to drag, a click still has to select: that is the reader's only gesture.
      onClick={readOnly || !onResize ? () => onSelect?.(organiser.key) : undefined}
    >
      {name}
      {!readOnly && onResize && (
        <>
          <span
            className="organiser-band-grip is-start"
            title="Tirer pour changer le début"
            onPointerDown={begin('start')}
          />
          <span
            className="organiser-band-grip is-end"
            title="Tirer pour changer la fin"
            onPointerDown={begin('end')}
          />
        </>
      )}
    </div>
  );
}
