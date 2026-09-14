/**
 * The zoom, as one slider and a button that makes the grid fill the screen.
 *
 * WHY A SLIDER REPLACED − AND +. Five fixed steps meant the size you want is usually between two
 * of them, and the top step was not big enough: a montage day filtered down to sixteen hours
 * still left half the screen empty at maximum zoom. The régisseur asked for "un slider pour avoir
 * un zoom continu", and for the view to take all the room there is.
 *
 * LOGARITHMIC, NOT LINEAR. The useful range runs from 3 px an hour (a five-day montage on one
 * screen) to 240 (a two-hour créneau half a metre wide), which is eighty to one. On a linear
 * track the whole readable half of that range would sit in the last centimetre and the first
 * three quarters of the travel would be a smear. On a log track every millimetre is the same
 * proportional change, which is what zooming means.
 *
 * "Ajuster" is the other half of the answer: the grid fits itself when a filter changes, and this
 * is how you ask for it again after moving the slider by hand.
 */

/** Where on the track a value sits, and back. `POSITIONS` is only the slider's own resolution. */
const POSITIONS = 1000;

export const toPosition = (value: number, min: number, max: number): number =>
  Math.round((POSITIONS * Math.log(clamp(value, min, max) / min)) / Math.log(max / min));

export const fromPosition = (position: number, min: number, max: number): number =>
  min * Math.pow(max / min, position / POSITIONS);

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function ZoomSlider({
  value,
  bounds,
  onChange,
  onFit,
}: {
  value: number;
  bounds: { min: number; max: number };
  onChange(pxPerHour: number): void;
  /** Sets the zoom that makes what is on screen exactly fill the width available. */
  onFit(): void;
}) {
  return (
    <span className="zoom">
      <span className="zoom-label" aria-hidden="true">
        Zoom
      </span>
      <input
        className="zoom-range"
        type="range"
        min={0}
        max={POSITIONS}
        step={1}
        value={toPosition(value, bounds.min, bounds.max)}
        aria-label="Zoom de la grille"
        title={`${Math.round(value)} px par heure`}
        onChange={(event) => onChange(fromPosition(Number(event.target.value), bounds.min, bounds.max))}
      />
      <button
        className="btn is-small"
        onClick={onFit}
        title="Régler le zoom pour que ce qui est affiché tienne exactement dans la largeur"
      >
        Ajuster
      </button>
    </span>
  );
}
