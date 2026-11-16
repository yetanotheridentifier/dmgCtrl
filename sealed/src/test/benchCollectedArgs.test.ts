import { describe, it, expect } from 'vitest'
import { parseArgs } from '../bench/main'
import { DEFAULT_ARCHIVE_PATH } from '../bench/recordArchive'

/**
 * The command line for collected games: pulling them out of staging, removing them from it, backing
 * the archive up and restoring it, and reading it as training rows. Refusals are parse-level, so a
 * command that would remove games without a backup says so before it reaches the network.
 */

describe('--pull', () => {
  it('is off unless asked for, and read-only when asked', () => {
    expect(parseArgs(['beam-reply']).pull).toBe(false)
    const args = parseArgs(['--pull'])
    expect(args).toMatchObject({ pull: true, delete: false, dryRun: false, backup: undefined, archive: undefined })
  })

  it('takes the archive from --archive, and a folder to snapshot to from --backup', () => {
    expect(parseArgs(['--pull', '--archive', '/data/games.db', '--backup', '/mnt/drive/games'])).toMatchObject({
      pull: true, archive: '/data/games.db', backup: '/mnt/drive/games',
    })
  })

  it('keeps its archive beside the bench results, which git ignores', () => {
    expect(DEFAULT_ARCHIVE_PATH).toBe('bench-results/collected-games.db')
  })
})

describe('--delete', () => {
  it('is taken with a pull and a folder to snapshot to', () => {
    expect(parseArgs(['--pull', '--delete', '--backup', '/mnt/drive/games'])).toMatchObject({ pull: true, delete: true, backup: '/mnt/drive/games' })
  })

  it('is refused without --backup, since the archive is then the only copy', () => {
    expect(() => parseArgs(['--pull', '--delete'])).toThrow('--delete needs --backup DIR')
  })

  it('needs no folder as a dry run, which removes nothing', () => {
    expect(parseArgs(['--pull', '--delete', '--dry-run'])).toMatchObject({ pull: true, delete: true, dryRun: true })
  })

  it('is refused without --pull or --refused, and so is --dry-run without --delete', () => {
    expect(() => parseArgs(['--delete', '--backup', '/x'])).toThrow('--delete applies to --pull and --refused only')
    expect(() => parseArgs(['--pull', '--dry-run'])).toThrow('--dry-run applies to --delete only')
    expect(() => parseArgs(['--refused', '--dry-run'])).toThrow('--dry-run applies to --delete only')
  })
})

describe('--backup and --restore', () => {
  it('take a folder and a file, with or without a pull', () => {
    expect(parseArgs(['--backup', '/mnt/drive/games'])).toMatchObject({ backup: '/mnt/drive/games', pull: false })
    expect(parseArgs(['--restore', '/mnt/drive/games/collected-games-2026-10-13.jsonl.gz'])).toMatchObject({
      restore: '/mnt/drive/games/collected-games-2026-10-13.jsonl.gz',
    })
  })

  it('need their value', () => {
    expect(() => parseArgs(['--backup'])).toThrow('--backup needs a folder')
    expect(() => parseArgs(['--backup', '--pull'])).toThrow('--backup needs a folder')
    expect(() => parseArgs(['--restore'])).toThrow('--restore needs a snapshot file')
    expect(() => parseArgs(['--archive'])).toThrow('--archive needs a file')
  })

  it('do not combine: a restore is its own run', () => {
    expect(() => parseArgs(['--restore', 'a.jsonl.gz', '--pull'])).toThrow('--restore runs on its own')
    expect(() => parseArgs(['--restore', 'a.jsonl.gz', '--backup', '/x'])).toThrow('--restore runs on its own')
  })
})

describe('the store the collected-game commands use', () => {
  it('is the D1 store unless --archive names a local file', () => {
    for (const mode of [['--collected'], ['--backup', '/x'], ['--restore', 'a.jsonl.gz'], ['--rows', '--collected', '--out', 'r.jsonl']]) {
      expect(parseArgs(mode).archive).toBeUndefined()
      expect(parseArgs([...mode, '--archive', '/data/games.db']).archive).toBe('/data/games.db')
    }
  })
})

describe('--migrate', () => {
  it('is off unless asked for, and takes the local archive from --archive', () => {
    expect(parseArgs(['--collected']).migrate).toBe(false)
    expect(parseArgs(['--migrate'])).toMatchObject({ migrate: true, archive: undefined })
    expect(parseArgs(['--migrate', '--archive', '/data/games.db'])).toMatchObject({ migrate: true, archive: '/data/games.db' })
  })

  it.each([['--pull'], ['--backup', '/x'], ['--restore', 'a.jsonl.gz'], ['--collected'], ['--rows', '--out', 'r.jsonl']])('runs on its own, not with %s', (...other) => {
    expect(() => parseArgs(['--migrate', ...other])).toThrow('--migrate runs on its own')
  })

  it('takes no AI names or files', () => {
    expect(() => parseArgs(['--migrate', 'beam-reply'])).toThrow('takes no names or files')
  })
})

describe('--collected', () => {
  it('on its own asks what the archive holds', () => {
    expect(parseArgs(['--collected'])).toMatchObject({ collected: true, rows: false })
  })

  it('with --rows makes the archive a source, with or without files', () => {
    const args = parseArgs(['--rows', '--collected', '--out', 'rows.jsonl'])
    expect(args).toMatchObject({ rows: true, collected: true, files: [] })
    expect(parseArgs(['--rows', 'one.json', '--collected', '--out', 'rows.jsonl']).files).toEqual(['one.json'])
  })

  it('leaves --rows needing a source when it is absent', () => {
    expect(() => parseArgs(['--rows', '--out', 'rows.jsonl'])).toThrow('--rows needs at least one export file')
  })
})

describe('the collected-game modes and the rest of the bench', () => {
  it.each([['--pull'], ['--backup', '/x'], ['--restore', 'a.jsonl.gz'], ['--collected']])('%s keeps no bench records', (...mode) => {
    expect(() => parseArgs([...mode, '--record'])).toThrow('--record applies to the head-to-head, --generalise and --matchups')
  })

  it.each([['--pull'], ['--backup', '/x'], ['--restore', 'a.jsonl.gz'], ['--collected']])('%s takes no AI names or files', (...mode) => {
    expect(() => parseArgs([...mode, 'beam-reply'])).toThrow('takes no names or files')
  })

  it('--pull is not a source for --rows: the rows are made from the archive afterwards', () => {
    expect(() => parseArgs(['--rows', '--pull', '--out', 'rows.jsonl'])).toThrow('--pull runs on its own')
  })
})

describe('--refused', () => {
  it('is off unless asked for, and on its own lists the refused games', () => {
    expect(parseArgs(['beam-reply']).refused).toBe(false)
    expect(parseArgs(['--refused'])).toMatchObject({ refused: true, delete: false, dryRun: false, lookedAt: [] })
  })

  it('deletes with a folder to back the store up to first, and needs none as a dry run', () => {
    expect(parseArgs(['--refused', '--delete', '--backup', '/mnt/drive/games'])).toMatchObject({ refused: true, delete: true, backup: '/mnt/drive/games' })
    expect(parseArgs(['--refused', '--delete', '--dry-run'])).toMatchObject({ refused: true, delete: true, dryRun: true })
    expect(() => parseArgs(['--refused', '--delete'])).toThrow('--delete needs --backup DIR')
  })

  it('takes the flagged games someone has looked at, by key', () => {
    const a = '0123456789abcdef'
    const b = 'fedcba9876543210'
    expect(parseArgs(['--refused', '--delete', '--dry-run', '--looked-at', `${a},${b}`]).lookedAt).toEqual([a, b])
    expect(() => parseArgs(['--refused', '--looked-at', 'nope'])).toThrow('--looked-at takes game keys')
    expect(() => parseArgs(['--refused', '--looked-at', a])).toThrow('--looked-at applies to --refused --delete only')
  })

  it('works on the D1 store only, and on its own', () => {
    expect(() => parseArgs(['--refused', '--archive', 'games.db'])).toThrow('--refused works on the D1 store')
    expect(() => parseArgs(['--refused', '--rows', '--out', 'r.jsonl', '--collected'])).toThrow('--refused runs on its own')
    expect(() => parseArgs(['--refused', '--pull'])).toThrow('--refused runs on its own')
    expect(() => parseArgs(['--refused', 'beam-reply'])).toThrow('takes no names or files')
  })
})
