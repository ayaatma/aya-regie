/**
 * The grid's geometry, in one place.
 *
 * The time axis is drawn from decimal hours straight to pixels, never from a column count. The
 * engine allows a shift of any length, and the line-up already uses half hours, so anything
 * built on fixed columns would be wrong the first time somebody creates a 90-minute shift.
 */

import type { Shift, SkillLevel } from '../engine.ts';

/** One box, one volunteer needed. Matches `.box` in the stylesheet. */
export const BOX_H = 24;
export const BOX_GAP = 2;
/** `.shift` padding plus its top and bottom offset inside the lane. */
export const SHIFT_CHROME = 2 * 2 + 2 * 3;

/**
 * The zoom, in pixels per hour, as a CONTINUOUS value since 2026-09-12.
 *
 * It was five fixed steps behind a − and a + button, and two things were wrong with that. The top
 * step was 140 px/h on the exploit and 46 px/h on a phase, and a single montage day filtered down
 * to sixteen hours still did not fill a wide screen at the top step: "le zoom maximal reste trop
 * petit". And five steps mean the right size is usually between two of them. A slider says the
 * same thing in one control, with every value in between.
 *
 * The bounds differ per grid because the spans do: the exploit is eighteen hours and a montage
 * can be a hundred and twenty worked hours, which has to fit on one screen at its widest.
 */
export const EXPLOIT_ZOOM = { min: 12, max: 240, fallback: 76 } as const;
export const PHASE_ZOOM = { min: 3, max: 240, fallback: 20 } as const;

/**
 * The width of the label column, which `--label-w` also states in the stylesheet.
 *
 * Duplicated on purpose and kept in step by hand, as `BOX_H` and `SHIFT_CHROME` already are:
 * fitting the axis to the screen is arithmetic done before the browser has laid anything out, so
 * it cannot read the value back off an element that does not exist yet.
 */
export const LABEL_W = 190;

/**
 * What pixels per hour makes a span of `hours` fill `available`, within the bounds.
 *
 * `gaps` is the room the nights take on a phase's axis, which belongs to no hour. Zero on the
 * exploit, which runs straight through.
 */
export function fitZoom(
  hours: number,
  available: number,
  bounds: { min: number; max: number; fallback: number },
  gaps = 0,
): number {
  if (hours <= 0 || available <= 0) return bounds.fallback;
  return Math.min(bounds.max, Math.max(bounds.min, (available - gaps) / hours));
}

export const LANE_MIN_H = 40;

/**
 * The 6 h and 8 h marks, which are emoji and no longer a coloured stripe.
 *
 * COLOUR WAS THE WRONG CHANNEL FOR THIS, and the régisseur said so: "le orange clair et plus
 * sombre ... est pas assez clair. Au lieu d'avoir une couleur, qui peut être confuse avec les
 * autres couleurs, il pourrait y avoir un émoticone". The grid already spends red on "illegal"
 * and blue on "selected"; two more oranges, three pixels wide down the left edge of a box, asked
 * the eye to tell four colour codes apart on a surface that is mostly colour already. A long day
 * is not an alarm, it is a fact about a person, and a fact reads better as a glyph.
 *
 * ONE ARM FOR SIX HOURS, TWO FOR EIGHT. The régisseur first proposed 💪🏼 and 💪, which differ
 * only in skin tone: at eleven pixels inside a box that is a difference of colour again, which is
 * the thing this change exists to stop. Counting the glyphs reads at a glance and at any size.
 * The hours stay written in words on the mark's own tooltip and on the fiche's chip.
 */
export const volumeMark = (band: string): string =>
  band === 'orange-fonce' ? '💪💪' : band === 'orange-clair' ? '💪' : '';

export const volumeLabel = (band: string): string =>
  band === 'orange-fonce' ? 'Journée très longue' : band === 'orange-clair' ? 'Journée longue' : '';

/** How tall a lane must be to hold its fullest shift, boxes and chrome included. */
export function laneHeight(shifts: readonly Shift[], assignedCount: (key: string) => number): number {
  let boxes = 0;
  for (const shift of shifts) {
    // A shift over its headcount still draws every person in it: hiding somebody to respect a
    // figure is exactly the silent drop this tool must never do.
    boxes = Math.max(boxes, Math.max(shift.headcount, assignedCount(shift.key)));
  }
  const inner = boxes * BOX_H + Math.max(0, boxes - 1) * BOX_GAP;
  return Math.max(LANE_MIN_H, inner + SHIFT_CHROME);
}

/** Stars for the level declared in this pole. No declaration means no evidence, so no star. */
export function starsFor(level: SkillLevel | null): string {
  switch (level) {
    case 'expert':
      return '★★★';
    case 'intermediaire':
      return '★★';
    case 'debutant':
      return '★';
    default:
      return '';
  }
}

export function levelLabel(level: SkillLevel | null): string {
  switch (level) {
    case 'expert':
      return 'expert';
    case 'intermediaire':
      return 'intermédiaire';
    case 'debutant':
      return 'débutant';
    default:
      return 'niveau non déclaré pour ce pôle';
  }
}

/*
 * `shortName` used to live here, cutting "Perrin Marie" down to "Perrin M." from the string
 * alone. It moved into the engine on 2026-09-09 and became `ShiftReport.stars[].short`, because
 * how much of a surname a box has to show is a question about the whole roster: one letter when
 * nobody else shares the given name, three when two people do. A function handed one string
 * cannot answer it, and this one confidently answered it wrong. See `display.ts`.
 */

/** A volume as the régisseur reads it: « 4 h », or « 4 h par jour » on an event counted per day. */
export const volumeText = (hours: number, perDay: boolean): string =>
  `${Number.isInteger(hours) ? hours : hours.toFixed(1).replace('.', ',')} h${perDay ? ' par jour' : ''}`;

/** A rank of pole choice as a label: « 1er choix », « 2e choix », or « Dans ses choix » unranked. */
export const choiceRankLabel = (rank: number, ranked: boolean): string =>
  !ranked ? 'Dans ses choix' : rank === 0 ? '1er choix' : `${rank + 1}e choix`;
