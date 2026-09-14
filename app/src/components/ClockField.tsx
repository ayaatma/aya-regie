/**
 * The one control in Réglages that sets an hour.
 *
 * Everything here answers the same complaint: the old fields were number spinners holding an
 * offset from the start of the event, which meant reading "9,5" for half past nine and typing
 * the subtraction yourself, and the one browser-native control on the page followed the
 * operating system's locale into 12 h AM/PM on a French event.
 *
 * So: a text field on a 24 h base, that takes what a poster says. Typing wins, because it is
 * the fastest way to enter an hour you already know: "21h30", "2130", "21:30" and "21" all
 * land. Arrow keys nudge by a quarter of an hour and shift-arrow by a full one, which is how a
 * créneau actually gets adjusted once it exists. The same two nudges sit in the field as a
 * stepper for the pointer, because arrow keys are invisible to somebody who never tries them.
 *
 * Two rules the rest of the tool also follows. Nothing is committed while the text is still
 * half-typed: "2" is not two in the morning, it is somebody on their way to 21h30, so a typed
 * value lands on blur or on Enter. And nothing typed is ever silently reinterpreted: an hour
 * that does not parse turns the field red and reverts, rather than becoming the nearest thing
 * that happens to parse.
 */

import { useState } from 'react';

import { clockOf, dayShift, fmtClock, hoursOf, parseClock, type ClockTime } from './clock.ts';

interface TextProps {
  /** What the field shows when it is not being typed into. */
  display: string;
  /** Returns false when the text is not a time, which reverts the field. */
  onCommit(raw: string): boolean;
  /** `steps` is signed; `big` is the shift-key hour, otherwise a quarter of an hour. */
  onStep(steps: number, big: boolean): void;
  ariaLabel: string;
  name?: string;
  placeholder?: string;
  title?: string;
  /** "+1" when the hour falls after midnight, so 02h reads as tomorrow. */
  day?: number;
  narrow?: boolean;
}

function ClockText({
  display,
  onCommit,
  onStep,
  ariaLabel,
  name,
  placeholder,
  title,
  day = 0,
  narrow = false,
}: TextProps) {
  // Null means "not being edited": the field shows the stored value. A string is a draft, and a
  // draft survives the parent re-rendering under it.
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  const text = draft ?? display;

  const commit = (raw: string): boolean => {
    const ok = onCommit(raw);
    setDraft(null);
    setBad(false);
    return ok;
  };

  return (
    <span className={`clock-field${bad ? ' is-bad' : ''}${narrow ? ' is-narrow' : ''}`}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={6}
        className="clock-input"
        name={name}
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        title={title}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          setBad(raw.trim() !== '' && parseClock(raw) === null);
        }}
        onFocus={(event) => event.target.select()}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (commit(event.currentTarget.value)) event.currentTarget.select();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(null);
            setBad(false);
            return;
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            setDraft(null);
            setBad(false);
            onStep(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
          }
        }}
      />

      {day > 0 && (
        <span className="clock-day" title="Le lendemain">
          +{day}
        </span>
      )}

      {/*
        Out of the tab order on purpose: it is the pointer's copy of the arrow keys, not a third
        thing to tab through on a page that already holds a lot of fields. Shift-click gives the
        hour, like shift-arrow.
      */}
      <span className="clock-steps" aria-hidden="true">
        <button
          type="button"
          tabIndex={-1}
          className="clock-step"
          title="Plus tard (flèche haut, maj pour une heure)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => onStep(1, event.shiftKey)}
        >
          ▴
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="clock-step"
          title="Plus tôt (flèche bas, maj pour une heure)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => onStep(-1, event.shiftKey)}
        >
          ▾
        </button>
      </span>
    </span>
  );
}

/** A quarter of an hour, or the whole hour with shift held. */
const stepHours = (big: boolean): number => (big ? 1 : 0.25);

/** Nudging snaps to the grid first, so up from 21h07 gives 21h15 rather than 21h22. */
function nudge(value: number, steps: number, big: boolean): number {
  const size = stepHours(big);
  return Math.round(value / size) * size + steps * size;
}

/** The offset is still worth having, just not worth typing: it goes in the tooltip. */
function offsetNote(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${String(rounded).replace('.', ',')} h après le début`;
}

/**
 * The same field, over a bare hour of the clock rather than an offset into the event.
 *
 * THE ONE PLACE AN HOUR IS NOT AN OFFSET, and it exists because a meal is not scheduled the way
 * a créneau is: "le repas de midi est servi de 12h à 14h" is true of every day of the montage
 * and of the event alike, so anchoring it to the start of one of them would be wrong on all the
 * others. See `MealWindow` in the engine.
 *
 * No +1 marker and no ceiling: there is no event to fall outside of, only a clock that runs from
 * 00h00 to 24h00.
 */
export function PlainClockField({
  value,
  onChange,
  ariaLabel,
  name,
  hint,
  narrow = false,
}: {
  /** An hour of the clock, 0 to 24. */
  value: number;
  onChange(value: number): void;
  ariaLabel: string;
  name?: string;
  hint?: string;
  narrow?: boolean;
}) {
  const whole = Math.floor(value);
  const display = fmtClock({ hour: whole, minute: Math.round((value - whole) * 60) });

  const commit = (raw: string): boolean => {
    const clock = parseClock(raw);
    if (clock === null) return false;
    const hours = clock.hour + clock.minute / 60;
    if (hours > 24) return false;
    if (hours !== value) onChange(hours);
    return true;
  };

  return (
    <ClockText
      display={display}
      onCommit={commit}
      onStep={(steps, big) => onChange(Math.min(24, Math.max(0, nudge(value, steps, big))))}
      ariaLabel={ariaLabel}
      name={name}
      title={hint}
      narrow={narrow}
    />
  );
}

export function ClockField({
  value,
  onChange,
  startISO,
  maxHours,
  ariaLabel,
  name,
  placeholder,
  hint,
  allowEmpty = false,
  narrow = false,
}: {
  /** Hours from the start of the event; null only where the field is allowed to be empty. */
  value: number | null;
  onChange(value: number | null): void;
  startISO: string;
  /** How far the event reaches. Picks between two readings of an hour, never refuses one. */
  maxHours?: number;
  ariaLabel: string;
  name?: string;
  placeholder?: string;
  /** What editing this field does beyond itself, added to the tooltip. See `slideEnd`. */
  hint?: string;
  allowEmpty?: boolean;
  narrow?: boolean;
}) {
  const display = value === null ? '' : fmtClock(clockOf(startISO, value));

  const commit = (raw: string): boolean => {
    if (raw.trim() === '') {
      if (!allowEmpty) return false;
      if (value !== null) onChange(null);
      return true;
    }
    const clock = parseClock(raw);
    if (clock === null) return false;
    const hours = hoursOf(startISO, clock, { near: value ?? undefined, maxHours });
    if (hours === null) return false;
    if (hours !== value) onChange(hours);
    return true;
  };

  const step = (steps: number, big: boolean) => {
    const from = value ?? 0;
    // The ceiling never traps a value already past it, so a créneau left beyond the end after
    // the event was shortened can still be walked back.
    const ceiling = Math.max(maxHours ?? Infinity, from);
    onChange(Math.min(Math.max(0, nudge(from, steps, big)), ceiling));
  };

  return (
    <ClockText
      display={display}
      onCommit={commit}
      onStep={step}
      ariaLabel={ariaLabel}
      name={name}
      placeholder={placeholder}
      title={
        [value === null ? '' : `${display}, ${offsetNote(value)}`, hint ?? '']
          .filter((part) => part !== '')
          .join(' · ') || undefined
      }
      day={value === null ? 0 : dayShift(startISO, value)}
      narrow={narrow}
    />
  );
}

/**
 * The same field for an absolute time of day, which is what the start of the event is.
 *
 * It replaces half of the browser's `datetime-local`, the half that was showing AM/PM. Stepping
 * wraps around midnight instead of stopping at it, because there is no zero here: 00h05 minus
 * ten minutes is 23h55, and the date field next to it says which day.
 */
export function TimeOfDayField({
  value,
  onChange,
  ariaLabel,
  name,
}: {
  value: ClockTime;
  onChange(value: ClockTime): void;
  ariaLabel: string;
  name?: string;
}) {
  const commit = (raw: string): boolean => {
    const clock = parseClock(raw);
    if (clock === null) return false;
    if (clock.hour !== value.hour || clock.minute !== value.minute) onChange(clock);
    return true;
  };

  const step = (steps: number, big: boolean) => {
    const size = stepHours(big) * 60;
    const now = value.hour * 60 + value.minute;
    const next = (((Math.round(now / size) * size + steps * size) % 1440) + 1440) % 1440;
    onChange({ hour: Math.floor(next / 60), minute: next % 60 });
  };

  return (
    <ClockText
      display={fmtClock(value)}
      onCommit={commit}
      onStep={step}
      ariaLabel={ariaLabel}
      name={name}
    />
  );
}
