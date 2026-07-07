/**
 * Seeded randomness for in-game shuffles (mulligans). The seed lives on
 * GameState (plain number → serialisable), so game records replay
 * deterministically through the pure resolver.
 */

/** mulberry32 — tiny, good-enough PRNG for shuffling. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates with a seeded generator. Pure — input untouched. */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rand = mulberry32(seed)
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Advance the stored seed after consuming randomness (golden-ratio step). */
export function nextSeed(seed: number): number {
  return (seed + 0x9e3779b9) >>> 0
}
