import { describe, it, expect } from 'vitest'
import { parseArgs } from '../bench/main'
import { missingRecords, recordsPath } from '../bench/records'
import { seedJobs, shardRunKey, type ShardConfig } from '../bench/shard'

/**
 * `--record` keeps a game run's completed games as records. It is a choice on the head-to-head run
 * (sharded or not), `--generalise` and `--matchups`, and on nothing else: parse-level, so a run that
 * cannot record says so before it plays anything.
 */

const config = (over: Partial<ShardConfig> = {}): ShardConfig =>
  ({ shards: 3, games: 80, baseSeed: 100, aiA: 'beam-reply', aiB: 'greedy', ...over })

describe('--record', () => {
  it('is off unless asked for', () => {
    expect(parseArgs(['beam-reply', 'greedy']).record).toBe(false)
    expect(parseArgs(['--shard', '4', 'beam-reply', 'greedy']).record).toBe(false)
  })

  it('is taken on the head-to-head run, sharded or not, and leaves the AI names alone', () => {
    const args = parseArgs(['--record', '--games', '40', 'beam-reply', 'greedy'])
    expect(args.record).toBe(true)
    expect([args.aiA, args.aiB]).toEqual(['beam-reply', 'greedy'])
    expect(parseArgs(['--shard', '4', '--record', '--control', 'beam-reply', 'greedy']).record).toBe(true)
  })

  it.each(['--generalise', '--matchups'])('is taken on %s, a game run over a population', mode => {
    expect(parseArgs([mode, '--record', 'greedy', 'random']).record).toBe(true)
  })

  it.each(['--sweep', '--matrix', '--decisions', '--terms', '--cost', '--budget', '--lethal', '--status', '--history'])(
    'is refused with %s, which keeps no records',
    mode => {
      expect(() => parseArgs([mode, '--record', 'greedy'])).toThrow('--record applies to the head-to-head, --generalise and --matchups')
    },
  )

  it('is refused with --rows, which reads records and plays nothing', () => {
    expect(() => parseArgs(['--rows', 'one.json', '--out', 'rows.jsonl', '--record'])).toThrow('--record applies to the head-to-head, --generalise and --matchups')
  })
})

describe('a sharded run that records', () => {
  it('tells each child to record, ahead of the AI names', () => {
    const [job] = seedJobs(config({ record: true }), [100], 'dir')
    expect(job.args).toContain('--record')
    expect(job.args.slice(-2)).toEqual(['beam-reply', 'greedy'])
  })

  it('tells no child to record otherwise, so its argv is what it always was', () => {
    const [job] = seedJobs(config(), [100], 'dir')
    expect(job.args).not.toContain('--record')
    expect(job.args).toEqual(['src/bench/main.ts', '--games', '80', '--seed', '100', '--out', 'dir/seed-100.out', 'beam-reply', 'greedy'])
  })

  /** Recording is not part of what a run measured, so it resumes the run it would have been without. */
  it('is the same run, in the same directory, as one that does not', () => {
    expect(shardRunKey(config({ record: true }))).toBe(shardRunKey(config()))
  })

  /**
   * A shard banked by an earlier attempt is not played again, so it writes nothing now. Its file is
   * there only if that attempt recorded too, and the run has to say which are not.
   */
  it('knows which of its shards have no records file', () => {
    const paths = [100, 101, 102].map(seed => recordsPath({ games: 80, seed, aiA: 'beam-reply', aiB: 'greedy' }, 'records'))
    const onDisk = new Set([paths[0], paths[2]])

    expect(missingRecords(config(), 'records', path => onDisk.has(path))).toEqual([{ seed: 101, path: paths[1] }])
    expect(missingRecords(config(), 'records', () => true)).toEqual([])
  })
})
