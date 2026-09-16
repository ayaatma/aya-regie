/**
 * The button in the grid's top-left corner that puts the grid in « mode édition », since 2026-09-16.
 *
 * THE SAME BUTTON ON THE THREE GRIDS. 🖍️ to go in, 👀 to come back to reading, framed so it reads
 * as a switch rather than as a decoration of the corner. The mode itself belongs to each grid's
 * own state, which is what makes changing tab or moment leave it: the grid unmounts, the mode
 * goes with it. Échap leaves it too, wired by each grid next to its other keys.
 */

/** What a créneau, or an événement, can be trimmed down to: a quarter of an hour. */
export const MIN_WINDOW_HOURS = 0.25;

export function EditModeButton({ editing, onToggle }: { editing: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className="btn-emoji is-framed"
      aria-pressed={editing}
      aria-label={editing ? 'Quitter le mode édition' : 'Mode édition'}
      title={
        editing
          ? 'Quitter le mode édition (Échap)'
          : 'Mode édition: étirer les créneaux, ajouter une place, créer un créneau dans le vide'
      }
      onClick={(event) => {
        // The grid's background deselects on click; this button is not the background.
        event.stopPropagation();
        onToggle();
      }}
    >
      {editing ? '👀' : '🖍️'}
    </button>
  );
}

/**
 * Where a new window would go if the pointer at `hour` were clicked: from the whole hour under it,
 * never before the end of the window just before, for `length` hours, and never over the next one.
 *
 * Null when the pointer is on a window already, or when the gap is shorter than a quarter of an
 * hour. `from` and `to` are the bounds the new window must stay inside (the event, or one day).
 */
export function ghostWindow(
  windows: ReadonlyArray<{ start: number; end: number }>,
  hour: number,
  length: number,
  from: number,
  to: number,
): { start: number; end: number } | null {
  const eps = 1e-6;
  if (hour < from || hour > to) return null;
  if (windows.some((w) => w.start - eps <= hour && hour < w.end - eps)) return null;
  const before = windows.filter((w) => w.end <= hour + eps).reduce((max, w) => Math.max(max, w.end), from);
  const after = windows.filter((w) => w.start > hour).reduce((min, w) => Math.min(min, w.start), to);
  const start = Math.max(before, Math.floor(hour + eps));
  const end = Math.min(start + length, after, to);
  return end - start >= MIN_WINDOW_HOURS - eps ? { start, end } : null;
}

/**
 * The limits one edge of a window may be pulled between, and the neighbour that follows it.
 *
 * A NEIGHBOUR THAT TOUCHES IS GLUED: pulling the end of the first créneau moves the start of the
 * second with it, both ways, and each keeps at least a quarter of an hour. A neighbour with a gap
 * is a wall: the edge stops where it starts. `from` and `to` bound the whole pull (the event, or
 * the day the window is drawn on).
 */
export function edgeLimits<W extends { key: string; start: number; end: number }>(
  window: W,
  others: readonly W[],
  edge: 'start' | 'end',
  from: number,
  to: number,
): { min: number; max: number; glued: W | null } {
  const eps = 1e-6;
  const rest = others.filter((o) => o.key !== window.key);
  if (edge === 'end') {
    const after = rest.filter((o) => o.start >= window.end - eps).sort((a, b) => a.start - b.start)[0];
    const glued = after && Math.abs(after.start - window.end) < eps ? after : null;
    const min = window.start + MIN_WINDOW_HOURS;
    const max = glued ? glued.end - MIN_WINDOW_HOURS : Math.min(after ? after.start : to, to);
    return { min, max: Math.max(min, max), glued };
  }
  const before = rest.filter((o) => o.end <= window.start + eps).sort((a, b) => b.end - a.end)[0];
  const glued = before && Math.abs(before.end - window.start) < eps ? before : null;
  const max = window.end - MIN_WINDOW_HOURS;
  const min = glued ? glued.start + MIN_WINDOW_HOURS : Math.max(before ? before.end : from, from);
  return { min: Math.min(min, max), max, glued };
}
