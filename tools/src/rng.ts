/**
 * Seeded random number generator.
 *
 * Every generated dataset comes from a fixed seed, so a bug found on one dataset is
 * reproducible byte for byte later on. Never use Math.random anywhere in the generator.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // mulberry32 needs a non-zero 32-bit state.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() on an empty array');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Picks one item, each item's odds proportional to its weight. Weights must be >= 0. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    if (items.length === 0) throw new Error('weighted() on an empty array');
    const weights = items.map(weightOf);
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  }

  shuffled<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }

  /** n distinct items, or fewer if the pool is too small. */
  sample<T>(items: readonly T[], n: number): T[] {
    return this.shuffled(items).slice(0, Math.min(n, items.length));
  }
}
