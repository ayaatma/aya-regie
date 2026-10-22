/**
 * « Ne peut pas travailler » as exact stretches, for an event in « plages libres »
 * (`Plan.availabilityMode`, 2026-10-22): one row per stretch, a day, a start and an end, as many
 * rows as the person needs. Edits `Volunteer.unavailable`, the windows every rule and the solver
 * already subtract.
 *
 * Presentational: the fiche writes each change at once, « Corriger la lecture » keeps a draft.
 * The rows are not merged while being edited, so a row never vanishes under the cursor; two that
 * overlap mean the same as one, which is all the engine ever reads.
 */

import type { PlanIndex, Window } from '../engine.ts';
import { clockAt, fmtClockOf, offsetIn } from './AvailabilityDays.tsx';
import { PlainClockField } from './ClockField.tsx';

export interface UnavailableRangesProps {
  index: PlanIndex;
  windows: readonly Window[];
  onChange(windows: Window[]): void;
  /** Distinguishes the inputs when two editors are drawn on one page. */
  namePrefix: string;
  readOnly?: boolean;
}

/** The event day a window starts in, or the last one for a window past every day. */
function dayOf(days: readonly Window[], w: Window): number {
  const at = days.findIndex((d) => w.start >= d.start - 1e-9 && w.start < d.end - 1e-9);
  return at < 0 ? Math.max(0, days.length - 1) : at;
}

export function UnavailableRanges({ index, windows, onChange, namePrefix, readOnly = false }: UnavailableRangesProps) {
  const { days } = index;
  const startISO = index.plan.startISO;
  if (days.length === 0) return null;

  const replace = (at: number, next: Window | null): void =>
    onChange(windows.flatMap((w, i) => (i !== at ? [w] : next ? [next] : [])));

  if (readOnly) {
    return windows.length === 0 ? (
      <p className="people-meta">Aucune plage.</p>
    ) : (
      <>
        {windows.map((w, i) => (
          <p key={i} className="people-meta">
            {index.dayLabel(dayOf(days, w))}: {fmtClockOf(startISO, w.start)} à {fmtClockOf(startISO, w.end)}
          </p>
        ))}
      </>
    );
  }

  return (
    <>
      {windows.map((w, i) => {
        const day = dayOf(days, w);
        const span = days[day]!;
        const label = index.dayLabel(day);
        const rebuild = (target: Window, fromClock: number, toClock: number): Window | null => {
          const start = offsetIn(startISO, target, fromClock, false);
          const end = offsetIn(startISO, target, toClock, true);
          return end > start + 1e-9 ? { start, end } : null;
        };
        return (
          <p key={i} className="people-meta availability-day">
            <select
              className="select is-inline"
              name={`${namePrefix}-range-${i}-day`}
              aria-label={`Jour de la plage ${i + 1}`}
              value={day}
              onChange={(event) => {
                const target = days[Number(event.target.value)]!;
                replace(i, rebuild(target, clockAt(startISO, w.start), clockAt(startISO, w.end)) ?? { start: target.start, end: target.end });
              }}
            >
              {days.map((_, d) => (
                <option key={d} value={d}>
                  {index.dayLabel(d)}
                </option>
              ))}
            </select>
            {' de '}
            <PlainClockField
              narrow
              value={clockAt(startISO, w.start)}
              ariaLabel={`Début de la plage le ${label}`}
              name={`${namePrefix}-range-${i}-from`}
              onChange={(clock) => {
                const next = rebuild(span, clock, clockAt(startISO, w.end));
                if (next) replace(i, next);
              }}
            />
            {' à '}
            <PlainClockField
              narrow
              value={clockAt(startISO, w.end)}
              ariaLabel={`Fin de la plage le ${label}`}
              name={`${namePrefix}-range-${i}-to`}
              onChange={(clock) => {
                const next = rebuild(span, clockAt(startISO, w.start), clock);
                if (next) replace(i, next);
              }}
            />
            <button type="button" className="btn is-icon" title="Retirer cette plage" onClick={() => replace(i, null)}>
              ✕
            </button>
          </p>
        );
      })}
      <button
        type="button"
        className="btn"
        onClick={() => {
          // Two hours at the start of the first day, to be moved where they belong.
          const first = days[0]!;
          onChange([...windows, { start: first.start, end: Math.min(first.end, first.start + 2) }]);
        }}
      >
        Ajouter une plage
      </button>
    </>
  );
}
