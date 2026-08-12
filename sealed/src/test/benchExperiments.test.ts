import { describe, it, expect } from 'vitest'
import { openDb, saveExperiment, listExperiments, experimentsFor } from '../bench/store'
import { pairedDifference } from '../bench/paired'
import type { ShardResult } from '../bench/shard'

/**
 * Storing the comparison, not just the runs (#492, phase 1).
 *
 * **The store held runs and had no concept of an experiment**, which is the actual unit of evidence
 * here. Of the search tie-break work: the pooled 51.1% over 2,040 games was in no row at all (each
 * shard is its own `runs` row and the pool was computed and printed), the 48.7% control was twelve
 * rows nothing marked as a control, and **the +2.35 paired difference that settled it existed nowhere
 * outside a ticket comment**.
 *
 * A store that logged runs more diligently would have preserved the number that misled and lost the
 * one that mattered. So the comparison is the row.
 */

const shard = (seed: number, winRateA: number): ShardResult =>
  ({ seed, winRateA, completed: 170, dropped: 0, exitCode: 0, commitId: 'abc' })

const armRates = [0.476, 0.512, 0.524, 0.500, 0.506, 0.494, 0.535, 0.547, 0.541, 0.518, 0.447, 0.529]
const ctlRates = [0.453, 0.494, 0.471, 0.465, 0.494, 0.482, 0.518, 0.535, 0.518, 0.476, 0.453, 0.488]
const arm = armRates.map((r, i) => shard(9001 + i, r))
const control = ctlRates.map((r, i) => shard(9001 + i, r))

const save = (db: ReturnType<typeof openDb>, over: Record<string, unknown> = {}): string =>
  saveExperiment(db, {
    armSpec: 'beam-reply/tie=reply:null',
    controlSpec: 'beam-reply',
    decks: 'coverage',
    baseSeed: 9001,
    shards: 12,
    gamesPerShard: 170,
    arm,
    control,
    paired: pairedDifference(arm, control),
    ...over,
  })

describe('experiments', () => {
  it('stores the comparison, its verdict and both raw rates', () => {
    const db = openDb(':memory:')
    const id = save(db)
    const [row] = listExperiments(db).filter(r => r.experimentId === id)
    expect(row.armSpec).toBe('beam-reply/tie=reply:null')
    expect(row.controlSpec).toBe('beam-reply')
    // The paired difference is the point of the row.
    expect(row.pairedMean * 100).toBeCloseTo(2.35, 1)
    expect(row.pairedT).toBeCloseTo(4.94, 1)
    expect(row.significant).toBe(true)
    // And both raw pooled rates, because the difference is only readable beside them.
    expect(row.armGames).toBe(2040)
    expect(row.controlGames).toBe(2040)
    expect(row.armWins / row.armGames).toBeCloseTo(0.511, 2)
    expect(row.controlWins / row.controlGames).toBeCloseTo(0.487, 2)
  })

  /**
   * **`decks` is not decoration.** A term whose cards are absent from the mirror deck reports neutral
   * there and fires on the coverage decks, so two experiments on different populations must never be
   * read as comparable. The `runs` table has gone without this column, which is a correctness hole
   * rather than a missing nicety.
   */
  it('records the deck population, so two populations never read as one', () => {
    const db = openDb(':memory:')
    save(db, { decks: 'coverage' })
    save(db, { decks: 'mirror', baseSeed: 500 })
    expect(new Set(listExperiments(db).map(r => r.decks))).toEqual(new Set(['coverage', 'mirror']))
  })

  /** The per-shard rows are what make a stored experiment re-analysable without re-running it. Every
   *  conclusion this project revised today was revised on the same games. */
  it('keeps the per-shard pairs so it can be re-analysed later', () => {
    const db = openDb(':memory:')
    const id = save(db)
    const [row] = listExperiments(db).filter(r => r.experimentId === id)
    expect(row.shardCount).toBe(12)
    const pairs = experimentsFor(db, id)
    expect(pairs).toHaveLength(12)
    expect(pairs[0].seed).toBe(9001)
    expect(pairs[0].armRate).toBeCloseTo(0.476, 6)
    expect(pairs[0].controlRate).toBeCloseTo(0.453, 6)
    expect(pairs.filter(p => p.diff > 0)).toHaveLength(11)
  })

  /** Stamped with the build, for the same reason shard results are: a comparison describes the code
   *  that produced it, and pooling two builds is not a longer run. */
  it('stamps the build', () => {
    const db = openDb(':memory:')
    const id = save(db)
    const [row] = listExperiments(db).filter(r => r.experimentId === id)
    expect(row.buildTag).toBeTruthy()
  })

  /** Newest first, so the history reads as a history. */
  it('lists newest first', () => {
    const db = openDb(':memory:')
    save(db, { armSpec: 'first' })
    save(db, { armSpec: 'second', baseSeed: 77 })
    expect(listExperiments(db).map(r => r.armSpec)).toEqual(['second', 'first'])
  })

  /**
   * The query that justifies the table. **A store nobody queries is worse than none**, because it
   * implies a coverage it does not deliver, so at least one real question has to be answerable:
   * every comparison a given arm has ever been in.
   */
  it('answers what an arm has ever measured', () => {
    const db = openDb(':memory:')
    save(db)
    save(db, { armSpec: 'beam-reply+initiativeHorizon=3', baseSeed: 7717 })
    const found = listExperiments(db).filter(r => r.armSpec.includes('tie=reply:null'))
    expect(found).toHaveLength(1)
    expect(found[0].pairedMean * 100).toBeCloseTo(2.35, 1)
  })
})
