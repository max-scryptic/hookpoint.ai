// A small deterministic random source for the demo-data synthesiser.
//
// Seeding matters here for two reasons. A demo library has to look like one
// channel rather than a pile of unrelated noise, which means the same video
// index must keep drawing the same title, the same curve shape and the same
// packaging read every time it is generated. And when something renders oddly
// on the demo data, the person looking at it needs to be able to reproduce
// exactly what they saw, which a Math.random() library cannot give them.

// Mulberry32: tiny, fast, and good enough for shaping fake numbers. Nothing
// here is security sensitive, so a 32-bit state PRNG is the right size of tool.
export function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A stable 32-bit hash of a string, so a seed can be derived from something
// meaningful (a user id, a video slug) rather than from a magic number.
export function hashSeed(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export class Rng {
  private readonly next: () => number

  constructor(seed: number | string) {
    this.next = createRandom(
      typeof seed === "number" ? seed : hashSeed(seed),
    )
  }

  // A float in [min, max).
  float(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  // An integer in [min, max], inclusive at both ends.
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1))
  }

  // A float in [min, max) rounded to `decimals` places, for the many payload
  // fields that carry a fixed precision (0..1 confidences, 0-10 ordinals).
  round(min: number, max: number, decimals: number): number {
    const factor = 10 ** decimals
    return Math.round(this.float(min, max) * factor) / factor
  }

  bool(trueProbability = 0.5): boolean {
    return this.next() < trueProbability
  }

  pick<T>(values: readonly T[]): T {
    return values[this.int(0, values.length - 1)]
  }

  // `count` distinct members of `values`, or all of them when count is larger
  // than the pool. Order is shuffled, so a list of devices or topics does not
  // always come out in vocabulary order.
  sample<T>(values: readonly T[], count: number): T[] {
    const pool = [...values]
    const taken: T[] = []
    const wanted = Math.min(count, pool.length)
    for (let index = 0; index < wanted; index += 1) {
      taken.push(pool.splice(this.int(0, pool.length - 1), 1)[0])
    }
    return taken
  }
}
