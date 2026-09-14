/**
 * A colour per pole, so the grid reads as places rather than as rows.
 *
 * The palette is deliberately kept away from red and from orange, which are spoken for: red
 * means illegal and the two oranges mean a long day, both come from `validate()`, and a pole
 * that happened to be red would make the grid lie. What is left is blues, greens, purples,
 * teals and a couple of warm browns, chosen to stay apart from each other at the size of a
 * shift block and to hold up in both themes.
 *
 * The colour is stored on the pole, so it travels with the plan and the régisseur can change
 * it. This module only supplies the default when a pole carries none.
 */

import type { Pole } from '../engine.ts';

/**
 * Sixteen hues, ordered so that poles next to each other on the grid get colours far apart.
 * Beyond sixteen poles it wraps, which is fine: the event has about fifteen.
 */
export const POLE_PALETTE: readonly string[] = [
  '#3b7dd8', // bleu
  '#2f9e6f', // vert
  '#8b5cf6', // violet
  '#0e9aa7', // turquoise
  '#c2557f', // framboise
  '#6b8e23', // olive
  '#4f6bed', // indigo
  '#12897b', // sapin
  '#a4629b', // mauve
  '#3f8ea8', // bleu ardoise
  '#7a6a4f', // taupe
  '#5b8c3a', // pousse
  '#9b6bd8', // lilas
  '#2d7f9d', // pétrole
  '#b06a52', // terre cuite
  '#4a7c59', // sauge
];

/** The root a pole belongs to. A sub-pole is part of its parent, and looks like it. */
export function rootOf(poles: readonly Pole[], poleKey: string): Pole | undefined {
  const byKey = new Map(poles.map((p) => [p.key, p]));
  let current = byKey.get(poleKey);
  while (current?.parentKey) current = byKey.get(current.parentKey);
  return current;
}

/**
 * One lookup for the whole plan, so every screen agrees on which pole is which colour.
 *
 * **The colour belongs to the root pole**, and every sub-pole under it gets the same one. Bar,
 * Bar / Service and Bar / Plonge are one place with three stations, and giving them three
 * unrelated colours breaks up the one grouping the grid is trying to show. The palette index
 * counts roots in plan order, so a pole keeps its colour across edits until somebody changes it.
 *
 * A colour set on a sub-pole is ignored on purpose: the setup screen only ever offers the
 * picker on the root, so there is nothing to reconcile.
 */
export function poleColours(poles: readonly Pole[]): Map<string, string> {
  const byKey = new Map(poles.map((p) => [p.key, p]));
  const roots = poles.filter((p) => p.parentKey === null);

  const byRoot = new Map<string, string>();
  roots.forEach((root, index) => {
    byRoot.set(root.key, root.colour ?? POLE_PALETTE[index % POLE_PALETTE.length]!);
  });

  const colours = new Map<string, string>();
  for (const pole of poles) {
    let current: Pole | undefined = pole;
    while (current?.parentKey) current = byKey.get(current.parentKey);
    colours.set(pole.key, (current && byRoot.get(current.key)) ?? POLE_PALETTE[0]!);
  }
  return colours;
}

/** True for a `#rrggbb` string, which is all `<input type="color">` ever produces. */
export const isColour = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value);
