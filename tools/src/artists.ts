/**
 * The line-up as the régisseur, the caterer and the grids read it: the moments an act occupies,
 * where each of them falls, and what a member of it is owed.
 *
 * WHAT THIS FILE IS NOT. No rule lives here. The validator reads an act's `start` and `end` on
 * its own (a bénévole placed across a set they asked not to miss), and nothing below is ever
 * consulted by it or by the solver. Everything here is drawn, counted or printed.
 *
 * FOUR MOMENTS, ONE AXIS. An act is on the venue for its set, for the changement de plateau on
 * each side of it, and for its balances, which may fall the afternoon before the doors open.
 * All four are stated in hours from the EVENT's start, and only the balances may go negative.
 * A grid that lives on another axis (the montage's, the démontage's) asks `artistMomentsIn` for
 * the same moments translated and clipped, and never reads the raw hours itself: the exploit's
 * ruler and the montage's événement lane draw the same balances from the same two numbers.
 *
 * See `.claude/memory/feature_artists.md` for the brief this comes from.
 */

import {
  type Artist,
  type ArtistMember,
  type CateringRules,
  type Guest,
  type Organiser,
  type PersonKind,
  type Volunteer,
  type Window,
} from './model.js';
import type { Phase } from './phase.js';

/** What an act is doing at a given moment. The set is the one the validator knows about. */
export type ArtistMomentKind = 'set' | 'changeover' | 'soundcheck';

export interface ArtistMoment extends Window {
  kind: ArtistMomentKind;
  artistKey: string;
  /** "Nashkø", "Nashkø · plateau", "Nashkø · balances". */
  label: string;
}

export const MOMENT_WORD: Record<ArtistMomentKind, string> = {
  set: 'set',
  changeover: 'changement de plateau',
  soundcheck: 'balances',
};

/**
 * Every moment this act occupies, in hours from the event's start, in clock order.
 *
 * A changeover of zero hours is no changeover and is not produced: "défaut pas de changement de
 * plateau" is the régisseur's own default. Balances that are not needed, or whose end is not
 * after their start, produce nothing either, so a half-typed fiche never draws a zero-width
 * band anywhere.
 */
export function artistMoments(artist: Artist): ArtistMoment[] {
  const moments: ArtistMoment[] = [];
  const push = (kind: ArtistMomentKind, start: number, end: number): void => {
    if (!(Number.isFinite(start) && Number.isFinite(end) && end > start)) return;
    moments.push({
      kind,
      artistKey: artist.key,
      label: kind === 'set' ? artist.name : `${artist.name} · ${kind === 'changeover' ? 'plateau' : 'balances'}`,
      start,
      end,
    });
  };

  if (artist.soundcheckNeeded) push('soundcheck', artist.soundcheckStart, artist.soundcheckEnd);
  if (artist.changeoverBefore > 0) {
    push('changeover', artist.start - artist.changeoverBefore, artist.start);
  }
  push('set', artist.start, artist.end);
  if (artist.changeoverAfter > 0) push('changeover', artist.end, artist.end + artist.changeoverAfter);

  return moments.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * From the first moment to the last: when the act is on the venue, as one window.
 *
 * ONE WINDOW AND NOT THE LIST, on purpose. An act whose balances are at 15h and whose set is at
 * 23h does not leave the venue in between, and the caterer feeds them at 19h. The régisseur
 * unticks the plate if they know otherwise, which is the same doctrine as every other default.
 */
export function artistPresence(artist: Artist): Window | null {
  const moments = artistMoments(artist);
  if (moments.length === 0) return null;
  return {
    start: Math.min(...moments.map((m) => m.start)),
    end: Math.max(...moments.map((m) => m.end)),
  };
}

const HOUR_MS = 3600_000;

/**
 * How many hours of the event's axis a phase's own zero is at. Negative for a montage, which
 * starts before the event; positive for a démontage.
 */
export function phaseOffset(eventStartISO: string, phase: Phase): number | null {
  const event = new Date(eventStartISO).getTime();
  const own = new Date(phase.startISO).getTime();
  if (Number.isNaN(event) || Number.isNaN(own)) return null;
  return (own - event) / HOUR_MS;
}

/**
 * The moments of every act that fall inside a phase, in THAT PHASE'S hours, clipped to it.
 *
 * This is how balances the day before reach the montage grid: the montage asks for what falls
 * in its own window and gets the same numbers the exploit's ruler draws, translated. A moment
 * that only touches the phase's edge (a changeover ending exactly where the montage ends, which
 * is where the event starts) is clipped to nothing and left out.
 */
export function artistMomentsIn(
  eventStartISO: string,
  phase: Phase,
  artists: readonly Artist[],
): ArtistMoment[] {
  const offset = phaseOffset(eventStartISO, phase);
  if (offset === null) return [];
  const out: ArtistMoment[] = [];
  for (const artist of artists) {
    for (const moment of artistMoments(artist)) {
      const start = Math.max(0, moment.start - offset);
      const end = Math.min(phase.lengthHours, moment.end - offset);
      if (end > start) out.push({ ...moment, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The same clipping for the exploit itself, whose axis the moments already use. */
export function artistMomentsInExploit(
  lengthHours: number,
  artists: readonly Artist[],
): ArtistMoment[] {
  const out: ArtistMoment[] = [];
  for (const artist of artists) {
    for (const moment of artistMoments(artist)) {
      const start = Math.max(0, moment.start);
      const end = Math.min(lengthHours, moment.end);
      if (end > start) out.push({ ...moment, start, end });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** "Prénom Nom", or a placeholder naming the act and the row, for a member nobody has named. */
export function artistMemberName(artist: Artist, member: ArtistMember): string {
  const name = `${member.firstName} ${member.lastName}`.trim();
  if (name !== '') return name;
  const at = artist.members.findIndex((m) => m.key === member.key);
  return `${artist.name} · membre ${at < 0 ? '?' : at + 1}`;
}

/** The drink tickets a member gets: their own figure when one was set, the event's otherwise. */
export function artistMemberDrinks(member: ArtistMember, rules: CateringRules): number {
  const own = member.drinkTickets;
  return Math.max(0, Math.round(own === null ? rules.artistDrinks : own));
}

/** Every invitation the act accounts for: each member's guests plus the act's own, by name. */
export function artistInvitations(artist: Artist): number {
  return artist.members.reduce((n, m) => n + m.guests.length, 0) + artist.extraGuests.length;
}

/** Everybody an act lets in, with who invited them: the act itself, or one of its members. */
export function artistGuests(
  artist: Artist,
): Array<{ guest: Guest; member: ArtistMember | null }> {
  return [
    ...artist.members.flatMap((member) => member.guests.map((guest) => ({ guest, member }))),
    ...artist.extraGuests.map((guest) => ({ guest, member: null })),
  ];
}

/**
 * "2 billets de train à prendre, 1 voiture": the défraiement in one line, or '' when there is
 * none. Written for the folded row of the Artistes tab, where the régisseur scans for what is
 * still to do.
 */
export function artistTravelLine(artist: Artist): string {
  const parts: string[] = [];
  if (artist.trainTickets > 0) {
    parts.push(
      `${artist.trainTickets} billet${artist.trainTickets > 1 ? 's' : ''} de train ${artist.trainDone ? 'pris' : 'à prendre'}`,
    );
  }
  if (artist.planeTickets > 0) {
    parts.push(
      `${artist.planeTickets} billet${artist.planeTickets > 1 ? 's' : ''} d'avion ${artist.planeDone ? 'pris' : 'à prendre'}`,
    );
  }
  if (artist.carTrips.length > 0) {
    parts.push(`${artist.carTrips.length} trajet${artist.carTrips.length > 1 ? 's' : ''} en voiture`);
  }
  return parts.join(', ');
}

/** True when this member's link names somebody the plan actually holds. */
export function memberIsLinked(
  member: ArtistMember,
  organisers: readonly Organiser[],
  volunteers: readonly Volunteer[],
): boolean {
  if (member.linkedKind === null || member.linkedKey === '') return false;
  const people = member.linkedKind === 'orga' ? organisers : volunteers;
  return people.some((p) => p.key === member.linkedKey);
}

/**
 * The acts a bénévole or an orga plays in, through the members that name them. Usually none,
 * sometimes one; two is somebody who plays twice, and both count.
 */
export function actsOfPerson(
  artists: readonly Artist[],
  kind: PersonKind,
  key: string,
): Array<{ artist: Artist; member: ArtistMember }> {
  const out: Array<{ artist: Artist; member: ArtistMember }> = [];
  for (const artist of artists) {
    for (const member of artist.members) {
      if (member.linkedKind === kind && member.linkedKey === key) out.push({ artist, member });
    }
  }
  return out;
}
