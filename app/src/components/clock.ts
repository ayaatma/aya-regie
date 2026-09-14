/**
 * Wall-clock time on a 24 h base, over the decimal hours the model actually stores.
 *
 * Nobody thinks in offsets. A set is "21h30", a créneau ends "02h00", and the model counts
 * "9.5" and "14" from the start of the event. Réglages used to put that subtraction on the
 * régisseur: a number spinner to type into, and the real hour written next to it as a read-only
 * echo. Reading was easy, writing meant doing the conversion in your head. These helpers move
 * the conversion into the field, so what is typed and what is read are the same thing.
 *
 * 24 h only, deliberately. The event runs from midday to six in the morning; "6h" with no AM/PM
 * is unambiguous, and a 12 h control asks a question nobody wants to answer at two in the
 * morning. It is also what the browser's own date-time control refuses to guarantee: it follows
 * the operating system's locale, which is how an English-language Windows put "12:00 PM" on a
 * French event.
 *
 * Every conversion goes through a real Date rather than modular arithmetic on 24, so a summer
 * time change inside the event window stays honest: "03h00" is whatever offset that wall clock
 * really lands on, not the offset it would land on if every day had 24 hours.
 */

export interface ClockTime {
  hour: number;
  minute: number;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** "21h30", always padded: a fixed-width field is far easier to scan down a column. */
export function fmtClock(clock: ClockTime): string {
  return `${pad(clock.hour)}h${pad(clock.minute)}`;
}

/** The wall clock an offset lands on. */
export function clockOf(startISO: string, hours: number): ClockTime {
  const when = new Date(new Date(startISO).getTime() + hours * 3600_000);
  return { hour: when.getHours(), minute: when.getMinutes() };
}

/** The same, ready to print: `fmtClock(clockOf(...))`. */
export function fmtOffset(startISO: string, hours: number): string {
  return fmtClock(clockOf(startISO, hours));
}

/**
 * How many calendar days past the start date an offset falls on.
 *
 * An event that starts at midday and ends at six in the morning writes "02h" for something that
 * happens tomorrow. The field marks those with a discreet +1 rather than leaving the reader to
 * work out which side of midnight they are on.
 */
export function dayShift(startISO: string, hours: number): number {
  const start = new Date(startISO);
  const at = new Date(start.getTime() + hours * 3600_000);
  const midnightOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnightOf(at) - midnightOf(start)) / 86_400_000);
}

/**
 * Where the end of a window goes when its start is moved: with it, at the same distance.
 *
 * Nobody retypes the start hour of a set, of a tranche or of a créneau in order to make it
 * longer. They type it because the thing happens later, or earlier, and the natural reading of
 * "ce créneau commence à 14h finalement" is that the whole créneau moved. Changing the length is
 * the other field's job: moving the END moves only the end, which is how a duration is set.
 *
 * Nothing is clamped and nothing is refused. A window slid past the end of the event stays where
 * it was put, and the screens that care say so in red rather than quietly disagreeing.
 */
export function slideEnd(start: number, end: number, nextStart: number): number {
  return nextStart + (end - start);
}

const SEPARATED = /^(\d{1,2})h(\d{1,2})?$/;
const DIGITS = /^(\d{1,4})$/;

/**
 * What the régisseur is allowed to type: "21h30", "21:30", "21.30", "21h", "21", "2130", "930".
 *
 * Generous about the separator because four people will type this on four keyboards, strict
 * about the numbers: 61 minutes or 25 hours is a typo, not a time, and comes back as null so
 * the field can say so instead of quietly inventing something. "24h" is accepted and means
 * midnight, because that is how an end time gets written on a poster.
 */
export function parseClock(text: string): ClockTime | null {
  const clean = text.trim().toLowerCase().replace(/\s/g, '').replace(/[:.,]/g, 'h');
  if (clean === '') return null;

  const separated = SEPARATED.exec(clean);
  if (separated) {
    return check(Number(separated[1]), separated[2] === undefined ? 0 : Number(separated[2]));
  }

  const digits = DIGITS.exec(clean);
  if (!digits) return null;
  const raw = digits[1] ?? '';
  return raw.length <= 2
    ? check(Number(raw), 0)
    : check(Number(raw.slice(0, raw.length - 2)), Number(raw.slice(-2)));
}

function check(hour: number, minute: number): ClockTime | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;
  if (hour === 24) return minute === 0 ? { hour: 0, minute: 0 } : null;
  return hour > 23 ? null : { hour, minute };
}

/**
 * The offset a wall clock means, for this event.
 *
 * A clock time is ambiguous on its own: "02h" is the second hour of the night on an event that
 * starts at midday, and nothing at all on one that ends before midnight. The candidates are the
 * same clock on the start day, the next day and the day after; the one inside the event wins,
 * and the one nearest what the field already held breaks a tie. That last rule is what makes
 * correcting a typo behave: retyping "13h" on a créneau at 13h05 moves it five minutes, not a
 * day.
 *
 * Nothing is refused for being outside the event. A set that runs past the end is a real thing
 * the régisseur may be describing, and this tool never rewrites what somebody entered.
 */
export function hoursOf(
  startISO: string,
  clock: ClockTime,
  opts: { near?: number; maxHours?: number } = {},
): number | null {
  const start = new Date(startISO);
  if (Number.isNaN(start.getTime())) return null;

  const candidates: number[] = [];
  for (let day = 0; day <= 2; day++) {
    const at = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + day,
      clock.hour,
      clock.minute,
      0,
      0,
    );
    const hours = (at.getTime() - start.getTime()) / 3600_000;
    if (hours >= -1e-9) candidates.push(Math.max(0, hours));
  }
  if (candidates.length === 0) return null;

  const limit = opts.maxHours ?? Infinity;
  const inside = candidates.filter((h) => h <= limit + 1e-9);
  const pool = inside.length > 0 ? inside : candidates;
  const near = opts.near;
  if (near === undefined) return pool[0] ?? null;
  return pool.reduce((best, h) => (Math.abs(h - near) < Math.abs(best - near) ? h : best));
}

/**
 * The local calendar day an offset falls on, as a `<input type="date">` value.
 *
 * For the one field in the tool that takes a date AND an hour before or after the event: an
 * act's balances, which may be the afternoon before the doors open. Everything else on the
 * exploit is an hour of a known day and `ClockField` is enough.
 */
export function localDateOf(startISO: string, hours: number): string {
  const when = new Date(new Date(startISO).getTime() + hours * 3600_000);
  if (Number.isNaN(when.getTime())) return '';
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

/**
 * The offset a local day and a wall clock mean, for this event. Null when either cannot be
 * read. Negative before the event starts, which is the whole reason this exists.
 */
export function hoursAtLocal(startISO: string, date: string, clock: ClockTime): number | null {
  const start = new Date(startISO).getTime();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (Number.isNaN(start) || !match) return null;
  const when = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    clock.hour,
    clock.minute,
    0,
    0,
  );
  if (Number.isNaN(when.getTime())) return null;
  return (when.getTime() - start) / 3600_000;
}
