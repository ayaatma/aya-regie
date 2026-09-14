/**
 * Text normalisation and approximate matching.
 *
 * This exists for one job: turning what a volunteer typed in "avec qui souhaiteriez-vous être"
 * into a real person. That field is free text, so it arrives as a first name alone, a nickname,
 * an inverted "Nom Prénom", a missing accent, or a typo. Anything this file cannot resolve with
 * confidence becomes a line in the régisseur's manual pass rather than a silent guess.
 */

/** Lowercase, accent-free, punctuation-free, single-spaced. */
export function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Levenshtein distance, capped: returns cap + 1 as soon as it is certain to exceed it. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > cap) return cap + 1;
    previous = current;
  }
  return previous[b.length]!;
}

export interface MatchCandidate<T> {
  item: T;
  /** 0 is an exact match. Higher is worse. */
  distance: number;
  /** How the candidate was reached, for the régisseur's review screen. */
  via: string;
}

export interface MatchResult<T> {
  /** Set only when the match is safe enough to apply without asking. */
  matched: T | null;
  via: string;
  /** Ranked alternatives, best first. Populated whenever `matched` is null. */
  candidates: Array<MatchCandidate<T>>;
}

export interface MatchablePerson {
  firstName: string;
  lastName: string;
}

/**
 * Resolves a typed name against a roster.
 *
 * Auto-resolves only when the answer is unambiguous. A first name shared by two volunteers is
 * never auto-resolved, however obvious it looks, because getting it wrong silently puts two
 * friends on different shifts and nobody finds out until the day itself.
 */
export function matchPerson<T extends MatchablePerson>(
  typed: string,
  roster: readonly T[],
  nicknames: Readonly<Record<string, string>> = {},
): MatchResult<T> {
  const needle = normalise(typed);
  if (needle === '') return { matched: null, via: 'vide', candidates: [] };

  const full = (p: T) => normalise(`${p.firstName} ${p.lastName}`);
  const reversed = (p: T) => normalise(`${p.lastName} ${p.firstName}`);
  const first = (p: T) => normalise(p.firstName);
  const initialled = (p: T) => normalise(`${p.firstName} ${p.lastName[0] ?? ''}`);

  const unique = (matches: T[], via: string): MatchResult<T> | null => {
    if (matches.length === 1) return { matched: matches[0]!, via, candidates: [] };
    if (matches.length > 1) {
      return {
        matched: null,
        via: `${via}, ambigu`,
        candidates: matches.map((item) => ({ item, distance: 0, via })),
      };
    }
    return null;
  };

  // Exact forms, in decreasing order of confidence.
  for (const [via, key] of [
    ['nom complet', full],
    ['nom inversé', reversed],
    ['prénom + initiale', initialled],
    ['prénom seul', first],
  ] as const) {
    const hit = unique(roster.filter((p) => key(p) === needle), via);
    if (hit) return hit;
  }

  // A nickname the volunteer used instead of the registered first name.
  const expanded = Object.entries(nicknames)
    .filter(([, nick]) => normalise(nick) === needle)
    .map(([name]) => normalise(name));
  if (expanded.length > 0) {
    const hit = unique(
      roster.filter((p) => expanded.includes(first(p))),
      'surnom',
    );
    if (hit) return hit;
  }

  // Typos. Close on the full name is trustworthy; close on a first name alone is not.
  const scored = roster
    .map((item) => ({
      item,
      distance: Math.min(editDistance(needle, full(item)), editDistance(needle, reversed(item))),
      via: 'orthographe proche',
    }))
    .filter((c) => c.distance <= 3)
    .sort((a, b) => a.distance - b.distance);

  const best = scored[0];
  if (best) {
    const runnerUp = scored[1];
    const margin = runnerUp ? runnerUp.distance - best.distance : Number.POSITIVE_INFINITY;
    // A typo is only trustworthy when the next best candidate is clearly further away. Two
    // similar names in the roster ("Marion Moreau" and "Marion Morel") collapse the margin and
    // send the request to the manual pass, which is the safe outcome.
    if ((best.distance <= 1 && margin >= 1) || (best.distance <= 2 && margin >= 2)) {
      return { matched: best.item, via: 'orthographe proche', candidates: [] };
    }
  }

  return { matched: null, via: 'non résolu', candidates: scored.slice(0, 3) };
}
