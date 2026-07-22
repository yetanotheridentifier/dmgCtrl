/**
 * A benchmark win rate is an estimate, not a fact: over few games it is mostly noise, over many it
 * is signal. `wilsonInterval` reports the +/- band around a win rate so a difference between two AIs
 * can be judged real (the bands do not overlap) rather than assumed. The Wilson form is used because
 * it stays sensible near 0 and 1, where the naive (Wald) interval can run outside [0,1].
 */
export interface Interval {
  /** Observed win rate, wins / n. */
  rate: number
  /** Half-width of the confidence band: the +/- you can quote around the rate. */
  halfWidth: number
}

/** z = 1.96 gives a 95% interval. */
export function wilsonInterval(wins: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { rate: 0, halfWidth: 0 }
  const p = wins / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const halfWidth = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { rate: p, halfWidth }
}
