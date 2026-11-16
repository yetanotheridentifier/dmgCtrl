import { describe, it, expect } from 'vitest'
import { parseArgs } from '../bench/main'

/**
 * The command line for collected games: backing the D1 store up and restoring into it, saying what it
 * holds, reading it as training rows, and removing the games that no longer replay. Refusals are
 * parse-level, so a command that would remove games without a backup says so before it reaches the
 * network.
 */

describe('the collected-game commands', () => {
  it.each(['--pull', '--migrate', '--archive'])('have no %s: the D1 store is the only store', flag => {
    expect(() => parseArgs([flag])).toThrow(`Unknown flag: ${flag}`)
  })
})

describe('--backup and --restore', () => {
  it('take a folder and a file', () => {
    expect(parseArgs(['--backup', '/mnt/drive/games'])).toMatchObject({ backup: '/mnt/drive/games' })
    expect(parseArgs(['--restore', '/mnt/drive/games/collected-games-2026-10-13.jsonl.gz'])).toMatchObject({
      restore: '/mnt/drive/games/collected-games-2026-10-13.jsonl.gz',
    })
  })

  it('need their value', () => {
    expect(() => parseArgs(['--backup'])).toThrow('--backup needs a folder')
    expect(() => parseArgs(['--backup', '--collected'])).toThrow('--backup needs a folder')
    expect(() => parseArgs(['--restore'])).toThrow('--restore needs a snapshot file')
  })

  it('do not combine: a restore is its own run', () => {
    expect(() => parseArgs(['--restore', 'a.jsonl.gz', '--collected'])).toThrow('--restore runs on its own')
    expect(() => parseArgs(['--restore', 'a.jsonl.gz', '--backup', '/x'])).toThrow('--restore runs on its own')
  })
})

describe('--collected', () => {
  it('on its own asks what the store holds', () => {
    expect(parseArgs(['--collected'])).toMatchObject({ collected: true, rows: false })
  })

  it('with --rows makes the store a source, with or without files', () => {
    const args = parseArgs(['--rows', '--collected', '--out', 'rows.jsonl'])
    expect(args).toMatchObject({ rows: true, collected: true, files: [] })
    expect(parseArgs(['--rows', 'one.json', '--collected', '--out', 'rows.jsonl']).files).toEqual(['one.json'])
  })

  it('leaves --rows needing a source when it is absent', () => {
    expect(() => parseArgs(['--rows', '--out', 'rows.jsonl'])).toThrow('--rows needs at least one export file')
  })
})

describe('the collected-game modes and the rest of the bench', () => {
  it.each([['--backup', '/x'], ['--restore', 'a.jsonl.gz'], ['--collected']])('%s keeps no bench records', (...mode) => {
    expect(() => parseArgs([...mode, '--record'])).toThrow('--record applies to the head-to-head, --generalise and --matchups')
  })

  it.each([['--backup', '/x'], ['--restore', 'a.jsonl.gz'], ['--collected']])('%s takes no AI names or files', (...mode) => {
    expect(() => parseArgs([...mode, 'beam-reply'])).toThrow('takes no names or files')
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

  it('is the only command --delete applies to, and --dry-run applies to --delete only', () => {
    expect(() => parseArgs(['--delete', '--backup', '/x'])).toThrow('--delete applies to --refused only')
    expect(() => parseArgs(['--refused', '--dry-run'])).toThrow('--dry-run applies to --delete only')
  })

  it('takes the flagged games someone has looked at, by key', () => {
    const a = '0123456789abcdef'
    const b = 'fedcba9876543210'
    expect(parseArgs(['--refused', '--delete', '--dry-run', '--looked-at', `${a},${b}`]).lookedAt).toEqual([a, b])
    expect(() => parseArgs(['--refused', '--looked-at', 'nope'])).toThrow('--looked-at takes game keys')
    expect(() => parseArgs(['--refused', '--looked-at', a])).toThrow('--looked-at applies to --refused --delete only')
  })

  it('runs on its own', () => {
    expect(() => parseArgs(['--refused', '--rows', '--out', 'r.jsonl', '--collected'])).toThrow('--refused runs on its own')
    expect(() => parseArgs(['--refused', '--restore', 'a.jsonl.gz'])).toThrow('--refused runs on its own')
    expect(() => parseArgs(['--refused', 'beam-reply'])).toThrow('takes no names or files')
  })
})
