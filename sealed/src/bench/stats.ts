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

/** One side of a win rate split by who moved first, with the games it was measured over. */
export interface SplitSide extends Interval {
  games: number
  wins: number
}

export interface FirstPlayerSplit {
  /** The games this deck (or AI) moved first in. */
  onPlay: SplitSide
  /** The rest. */
  onDraw: SplitSide
  /** `onPlay.rate - onDraw.rate`, or null when a half was never played. */
  gap: number | null
  /** Half-width of the 95% band on the gap, or null when there is no gap. */
  gapCi: number | null
}

/**
 * Split a win rate by who moved first, with a band on each half and on the difference.
 *
 * **Each half is half the sample**, so both bands are wider than the one on the overall rate and the
 * gap's is wider still. Quoting a gap without it is how a result that shrinks as the sample grows
 * gets believed at the small size, which this project has already paid for once.
 *
 * The gap's band is Newcombe's hybrid-score method: square-and-add the two Wilson half-widths. A
 * naive (Wald) difference interval is what it replaces, because a half sitting near 0 or 1 pushes
 * that one outside [0,1] exactly where a lopsided deck would put it.
 *
 * **A half with no games has no rate.** Reporting 0.0% for it would read as a measured result rather
 * than an absent one, so the gap is null instead.
 */
export function firstPlayerSplit(
  winsOnPlay: number,
  gamesOnPlay: number,
  winsOnDraw: number,
  gamesOnDraw: number,
): FirstPlayerSplit {
  const onPlay = { ...wilsonInterval(winsOnPlay, gamesOnPlay), games: gamesOnPlay, wins: winsOnPlay }
  const onDraw = { ...wilsonInterval(winsOnDraw, gamesOnDraw), games: gamesOnDraw, wins: winsOnDraw }
  if (gamesOnPlay <= 0 || gamesOnDraw <= 0) return { onPlay, onDraw, gap: null, gapCi: null }
  return {
    onPlay,
    onDraw,
    gap: onPlay.rate - onDraw.rate,
    gapCi: Math.hypot(onPlay.halfWidth, onDraw.halfWidth),
  }
}
