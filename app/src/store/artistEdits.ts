/**
 * The edits the Artistes tab makes below the act itself: its members and its trajets.
 *
 * The act's own fields go through `setArtist` in `setupEdits.ts`, which is where adding and
 * removing an act have lived since the line-up was a card in Réglages. What is here is the two
 * lists hanging off an act, edited BY KEY and one row at a time: a member is never replaced by
 * rewriting the whole list, because a meal choice points at a member by key and a rewritten
 * list is how a key silently changes under it.
 *
 * Nothing here is refused. A member with no name is a member the régisseur has not typed yet,
 * and a trajet with no address is a trajet they know exists; both are legitimate states of a
 * fiche being filled in over weeks.
 */

import { makeArtistMember, makeCarTrip } from '../engine.ts';
import type { Artist, ArtistMember, CarTrip, Guest, PersonKind, Plan } from '../engine.ts';

const withArtist = (plan: Plan, artistKey: string, change: (a: Artist) => Artist): Plan => ({
  ...plan,
  artists: plan.artists.map((a) => (a.key === artistKey ? change(a) : a)),
});

/**
 * A key unique across EVERY act, not only this one. A meal choice names a member by key alone
 * (`MealChoice.personKey`), so two acts each with a `m1` would share every ticked plate.
 */
function freeMemberKey(plan: Plan, artist: Artist): string {
  const taken = new Set(plan.artists.flatMap((a) => a.members.map((m) => m.key)));
  for (let n = artist.members.length + 1; ; n++) {
    const candidate = `${artist.key}-m${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function freeTripKey(artist: Artist): string {
  const taken = new Set(artist.carTrips.map((t) => t.key));
  for (let n = artist.carTrips.length + 1; ; n++) {
    const candidate = `${artist.key}-t${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * One more person in the act, unnamed. The fiche is where the name is typed.
 *
 * Naming more people than the act was said to have RAISES its size: the sixth name in a group
 * of five means the group is six, and "6 nommées sur 5 prévues" would be the tool arguing with
 * the régisseur about their own list. The reverse never happens: removing a name leaves the
 * size alone, because a member struck off the list is still a plate to count until the
 * régisseur says otherwise.
 */
export function addArtistMember(plan: Plan, artistKey: string): Plan {
  const artist = plan.artists.find((a) => a.key === artistKey);
  if (!artist) return plan;
  const member = makeArtistMember({ key: freeMemberKey(plan, artist) });
  return withArtist(plan, artistKey, (a) => ({
    ...a,
    members: [...a.members, member],
    size: Math.max(a.size, a.members.length + 1),
  }));
}

export function setArtistMember(
  plan: Plan,
  artistKey: string,
  memberKey: string,
  over: Partial<Omit<ArtistMember, 'key'>>,
): Plan {
  return withArtist(plan, artistKey, (a) => ({
    ...a,
    members: a.members.map((m) => {
      if (m.key !== memberKey) return m;
      const next: ArtistMember = { ...m };
      for (const [field, value] of Object.entries(over)) {
        if (value === undefined) continue;
        if (typeof value === 'number' && !Number.isFinite(value)) continue;
        (next as unknown as Record<string, unknown>)[field] = value;
      }
      return next;
    }),
  }));
}

/**
 * Says who a member also is: a bénévole, an orga, or nobody again.
 *
 * THE NAME, THE DIET AND THE ALLERGIES ARE COPIED ONCE, and only into fields still empty: the
 * person is already known and typing them twice is how two spellings are born. They are copies
 * and not references, on purpose: the caterer's row is the person's own (see `cateringReport`),
 * so what the member carries is only what the fiche shows, and unlinking leaves it as typed.
 */
export function linkArtistMember(
  plan: Plan,
  artistKey: string,
  memberKey: string,
  kind: PersonKind | null,
  personKey: string,
): Plan {
  if (kind === null || personKey === '') {
    return setArtistMember(plan, artistKey, memberKey, { linkedKind: null, linkedKey: '' });
  }
  const person =
    kind === 'orga'
      ? plan.organisers.find((o) => o.key === personKey)
      : plan.volunteers.find((v) => v.key === personKey);
  if (!person) return plan;
  const member = plan.artists.find((a) => a.key === artistKey)?.members.find((m) => m.key === memberKey);
  if (!member) return plan;
  return setArtistMember(plan, artistKey, memberKey, {
    linkedKind: kind,
    linkedKey: personKey,
    firstName: member.firstName === '' ? person.firstName : member.firstName,
    lastName: member.lastName === '' ? person.lastName : member.lastName,
    diet: member.diet === '' ? person.diet : member.diet,
    allergies: member.allergies === '' ? person.allergies : member.allergies,
  });
}

/**
 * Removes a person from the act, and the plates the régisseur had ticked for them with them.
 *
 * The meal choices go too, and on purpose: they name this key and nothing else will ever carry
 * it again, so leaving them would be rows the catering screen can neither show nor clear.
 */
export function deleteArtistMember(plan: Plan, artistKey: string, memberKey: string): Plan {
  const member = plan.artists.find((a) => a.key === artistKey)?.members.find((m) => m.key === memberKey);
  const gone = new Set(member?.guests.map((g) => g.key) ?? []);
  const next = withArtist(plan, artistKey, (a) => ({
    ...a,
    members: a.members.filter((m) => m.key !== memberKey),
  }));
  return {
    ...next,
    catering: {
      ...next.catering,
      choices: next.catering.choices.filter(
        (c) => !(c.personKind === 'artiste' && c.personKey === memberKey),
      ),
    },
    ticketing: {
      ...next.ticketing,
      choices: next.ticketing.choices.filter(
        (c) =>
          !(c.personKind === 'artiste' && c.personKey === memberKey) &&
          !(c.personKind === 'invite' && gone.has(c.personKey)),
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// The guests: a member's, or the act's own
// ---------------------------------------------------------------------------

/**
 * A key unique across every guest of every act, like a member's: a ticket or a bracelet on the
 * billetterie points at it alone.
 */
function freeGuestKey(plan: Plan, base: string): string {
  const taken = new Set(
    plan.artists.flatMap((a) => [
      ...a.extraGuests.map((g) => g.key),
      ...a.members.flatMap((m) => m.guests.map((g) => g.key)),
    ]),
  );
  for (let n = 1; ; n++) {
    const candidate = `${base}-g${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * One more named invitation: a member's when `memberKey` names one, the act's own otherwise.
 * Never refused past the event's figure per artist: the billetterie reports the excess.
 */
export function addGuest(plan: Plan, artistKey: string, memberKey: string | null): Plan {
  const artist = plan.artists.find((a) => a.key === artistKey);
  if (!artist) return plan;
  const guest: Guest = {
    key: freeGuestKey(plan, memberKey ?? artist.key),
    firstName: '',
    lastName: '',
  };
  return withArtist(plan, artistKey, (a) =>
    memberKey === null
      ? { ...a, extraGuests: [...a.extraGuests, guest] }
      : {
          ...a,
          members: a.members.map((m) =>
            m.key === memberKey ? { ...m, guests: [...m.guests, guest] } : m,
          ),
        },
  );
}

export function setGuest(
  plan: Plan,
  artistKey: string,
  guestKey: string,
  over: Partial<Omit<Guest, 'key'>>,
): Plan {
  const fix = (g: Guest): Guest => (g.key === guestKey ? { ...g, ...over } : g);
  return withArtist(plan, artistKey, (a) => ({
    ...a,
    extraGuests: a.extraGuests.map(fix),
    members: a.members.map((m) => ({ ...m, guests: m.guests.map(fix) })),
  }));
}

/** Removes the guest, and the ticket or bracelet chosen for them on the billetterie. */
export function deleteGuest(plan: Plan, artistKey: string, guestKey: string): Plan {
  const next = withArtist(plan, artistKey, (a) => ({
    ...a,
    extraGuests: a.extraGuests.filter((g) => g.key !== guestKey),
    members: a.members.map((m) => ({ ...m, guests: m.guests.filter((g) => g.key !== guestKey) })),
  }));
  return {
    ...next,
    ticketing: {
      ...next.ticketing,
      choices: next.ticketing.choices.filter(
        (c) => !(c.personKind === 'invite' && c.personKey === guestKey),
      ),
    },
  };
}

/** One more journey, from nowhere in particular to the venue. */
export function addCarTrip(plan: Plan, artistKey: string): Plan {
  const artist = plan.artists.find((a) => a.key === artistKey);
  if (!artist) return plan;
  const trip = makeCarTrip({ key: freeTripKey(artist) });
  return withArtist(plan, artistKey, (a) => ({ ...a, carTrips: [...a.carTrips, trip] }));
}

export function setCarTrip(
  plan: Plan,
  artistKey: string,
  tripKey: string,
  over: Partial<Omit<CarTrip, 'key'>>,
): Plan {
  return withArtist(plan, artistKey, (a) => ({
    ...a,
    carTrips: a.carTrips.map((t) => {
      if (t.key !== tripKey) return t;
      const next: CarTrip = { ...t };
      for (const [field, value] of Object.entries(over)) {
        if (value === undefined) continue;
        if (typeof value === 'number' && !Number.isFinite(value)) continue;
        (next as unknown as Record<string, unknown>)[field] = value;
      }
      return next;
    }),
  }));
}

export function deleteCarTrip(plan: Plan, artistKey: string, tripKey: string): Plan {
  return withArtist(plan, artistKey, (a) => ({
    ...a,
    carTrips: a.carTrips.filter((t) => t.key !== tripKey),
  }));
}

/**
 * Removing an act takes its members' ticked plates with it, for the reason written over
 * `deleteArtistMember`. `deleteArtist` in `setupEdits.ts` predates the members and leaves the
 * catering alone; this is the one the tab calls.
 */
export function removeArtist(plan: Plan, artistKey: string): Plan {
  const artist = plan.artists.find((a) => a.key === artistKey);
  if (!artist) return plan;
  const gone = new Set(artist.members.map((m) => m.key));
  const guests = new Set([
    ...artist.extraGuests.map((g) => g.key),
    ...artist.members.flatMap((m) => m.guests.map((g) => g.key)),
  ]);
  return {
    ...plan,
    artists: plan.artists.filter((a) => a.key !== artistKey),
    catering: {
      ...plan.catering,
      choices: plan.catering.choices.filter(
        (c) => !(c.personKind === 'artiste' && gone.has(c.personKey)),
      ),
    },
    ticketing: {
      ...plan.ticketing,
      choices: plan.ticketing.choices.filter(
        (c) =>
          !(c.personKind === 'artiste' && gone.has(c.personKey)) &&
          !(c.personKind === 'invite' && guests.has(c.personKey)),
      ),
    },
  };
}
