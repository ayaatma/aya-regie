/**
 * The short name a person is shown under, wherever the whole name does not fit.
 *
 * A grid box is about eleven characters wide, so the grid, the volunteer's own schedule and the
 * public planning have always written "Marie D." rather than "Marie Dubois". That abbreviation
 * has two problems and this file is the answer to both.
 *
 * FIRST, "Marie D." is not a name when there are two of them. Two Marie whose surnames both
 * start with a D read as one person on the grid, and a régisseur reassigning "Marie D." at two
 * in the morning has no way to tell which one they just moved. So the surname is cut at the
 * shortest prefix that tells this person apart from everybody else who shares their given name:
 * one letter when nothing collides, two or three when something does. Only the people who
 * actually collide grow, and they grow only as far as they must.
 *
 * SECOND, a fair number of people go by something other than the name on their registration.
 * The form asks for it, "Surnom (si tu préfères qu'on t'appelle par celui-ci)", and the answer
 * is what their team will call them on the night. When it is filled in it replaces the first
 * name here, and only here: the legal name still goes on the welcome desk's list, the exports
 * and everything the association has to be able to check a person against.
 *
 * THE COLLISION UNIVERSE IS EVERY PERSON THE TOOL KNOWS, volunteers and pole organisers together,
 * because both are named on the same screens and the whole point is that one label means one
 * human. Somebody recorded twice, a organiser who also signed up as a volunteer, is folded into one
 * person first by the identity rule, or they would push their own surname longer for no reason.
 */

/** Everything this file needs about a person, satisfied by both `Volunteer` and `Organiser`. */
export interface DisplayPerson {
  firstName: string;
  lastName: string;
  /** The form's "Surnom". Absent on organisers, whose own form does not ask. */
  nickname?: string;
  email?: string;
}

/**
 * Case and accents removed, character positions kept.
 *
 * Deliberately not `normalise` from `text.ts`, which also collapses punctuation and spaces: that
 * one is for matching a typed name, and its output no longer lines up index by index with what
 * it was given. Here the fold decides where to cut a surname that is then displayed as typed, so
 * "Étienne" must fold to seven characters and not to six.
 */
const fold = (value: string): string =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** What replaces the first name when it is answered. */
const given = (person: DisplayPerson): string => {
  const nickname = (person.nickname ?? '').trim();
  return nickname !== '' ? nickname : person.firstName.trim();
};

/**
 * Two records are the same person when they share an e-mail address, and otherwise when they
 * share a name. Same rule as `volunteerIdentity` and `organiserIdentity`, on the registered name
 * rather than on the nickname: a surname does not stop being somebody's because they go by Titi.
 */
const identity = (person: DisplayPerson): string => {
  const email = (person.email ?? '').trim();
  if (email !== '') return `mail:${fold(email)}`;
  return `nom:${fold(person.firstName.trim())} ${fold(person.lastName.trim())}`;
};

/**
 * One short label per person, in the order they were given.
 *
 * Two people the tool cannot tell apart, the same given name and the same surname, both come
 * back under their whole name. Nothing is invented to separate them: an index number on a grid
 * box would say something about a person that is not true, and the régisseur reading two
 * identical labels can at least see that there are two.
 */
export function shortNames(people: readonly DisplayPerson[]): string[] {
  interface Entry {
    given: string;
    family: string;
    /** Folded surname, for the comparisons. */
    key: string;
  }

  const byIdentity = new Map<string, Entry>();
  const identities = people.map((person) => {
    const id = identity(person);
    if (!byIdentity.has(id)) {
      const family = person.lastName.trim();
      byIdentity.set(id, { given: given(person), family, key: fold(family) });
    }
    return id;
  });

  // Everyone sharing a given name, since that is the only group a surname has to separate.
  const rivals = new Map<string, Entry[]>();
  for (const entry of byIdentity.values()) {
    const group = fold(entry.given);
    rivals.set(group, [...(rivals.get(group) ?? []), entry]);
  }

  const labelled = new Map<string, string>();
  for (const [id, entry] of byIdentity) {
    if (entry.family === '') {
      labelled.set(id, entry.given);
      continue;
    }
    const others = (rivals.get(fold(entry.given)) ?? []).filter((other) => other !== entry);

    /*
     * The shortest cut that separates this surname from every other one in the group. Growing
     * each person only as far as their own rivals require is what keeps a lone "Marie D." short
     * when a third Marie turns up with a surname nothing like theirs.
     *
     * Two people whose cuts come out different lengths still read as different labels: a cut of
     * one only survives when nobody else in the group starts with that letter at all.
     */
    let cut = entry.key.length;
    for (let n = 1; n <= entry.key.length; n++) {
      const mine = entry.key.slice(0, n);
      if (others.every((other) => other.key.slice(0, n) !== mine)) {
        cut = n;
        break;
      }
    }

    labelled.set(
      id,
      cut >= entry.family.length
        ? `${entry.given} ${entry.family}`
        : `${entry.given} ${entry.family.slice(0, cut)}.`,
    );
  }

  return identities.map((id) => labelled.get(id) ?? '');
}
