import { describe, it, expect } from 'vitest'
import { buildReportMarkdown, reportTitle, issueUrl, REPLAY_NOTE } from '../utils/bugReport'
import { state, player, card, CARDS, unit } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'

const initialState = state({
  cards: { ...CARDS, BIG: card({ id: 'BIG', name: 'Big Unit', type: 'unit' }) },
  players: { player: player({ units: [unit('u1', 'BIG')] }), opponent: player() },
})
const moves: { by: 'player' | 'opponent'; action: Action }[] = [
  { by: 'player', action: { type: 'pass' } },
  { by: 'opponent', action: { type: 'pass' } },
]
const log = [
  { by: 'player' as const, text: 'Play Big Unit (2)' },
  { by: 'opponent' as const, text: 'Pass' },
]

const report = (over: Partial<Parameters<typeof buildReportMarkdown>[0]> = {}) =>
  buildReportMarkdown({ description: 'It hung after I took the initiative.', buildTag: 'b324', isDev: false, log, initialState, moves, ...over })

describe('reportTitle', () => {
  it('prefixes "bug: " so reports sort with the rest', () => {
    expect(reportTitle('Game hung')).toBe('bug: Game hung')
  })

  it('does not double the prefix if the user typed it', () => {
    expect(reportTitle('bug: Game hung')).toBe('bug: Game hung')
    expect(reportTitle('Bug: Game hung')).toBe('Bug: Game hung')
  })

  it('trims surrounding whitespace', () => {
    expect(reportTitle('  Game hung  ')).toBe('bug: Game hung')
  })
})

/**
 * The report is filed by opening GitHub's new-issue page prefilled, so the reporter is whoever is
 * signed in there and no token ever exists in the app. The replay payload is ~17KB against a ~8KB
 * URL ceiling, so it travels by clipboard and the URL carries only the title and a paste prompt.
 */
describe('issueUrl', () => {
  it('points at the repo, labels it a bug, and applies the title prefix', () => {
    const url = new URL(issueUrl('Game hung'))
    expect(url.origin + url.pathname).toBe('https://github.com/yetanotheridentifier/dmgCtrl/issues/new')
    expect(url.searchParams.get('labels')).toBe('bug')
    expect(url.searchParams.get('title')).toBe('bug: Game hung')
  })

  /**
   * The body is left empty so the pasted report lands clean. Prefilled instructions were being
   * pasted *around* rather than replaced, so every issue opened with a stray "paste here" line
   * (see #378).
   */
  it('prefills no body, so the paste is not appended to boilerplate', () => {
    const url = new URL(issueUrl('Game hung'))
    expect(url.searchParams.get('body')).toBeNull()
    expect(url.toString()).not.toMatch(/paste/i)
  })

  it('encodes characters that would otherwise break the query string', () => {
    const url = new URL(issueUrl('Crash on "attack" & pass?'))
    expect(url.searchParams.get('title')).toBe('bug: Crash on "attack" & pass?')
  })

  it('stays well inside the URL ceiling even with a long title', () => {
    expect(issueUrl('x'.repeat(300)).length).toBeLessThan(2000)
  })
})

describe('buildReportMarkdown', () => {
  it('leads with the description', () => {
    expect(report()).toContain('It hung after I took the initiative.')
  })

  it('records the build tag and which environment it came from', () => {
    expect(report()).toMatch(/b324/)
    expect(report()).toMatch(/prod/i)
    expect(report({ isDev: true })).toMatch(/dev/i)
  })

  it('includes the readable log', () => {
    const md = report()
    expect(md).toContain('Play Big Unit (2)')
    expect(md).toContain('Pass')
  })

  /**
   * The replay data is the point of the report: `initialState` + `moves` re-resolve to the exact
   * final state (see deterministicReplay.test.ts), so a report is a runnable fixture rather than a
   * description of one.
   */
  it('embeds the replay data as JSON, with the moves in order', () => {
    const md = report()
    const json = md.slice(md.indexOf('{"initialState"'))
    const parsed = JSON.parse(json.slice(0, json.lastIndexOf('}') + 1))
    expect(parsed.moves).toHaveLength(2)
    expect(parsed.moves[0]).toEqual({ by: 'player', action: { type: 'pass' } })
    expect(parsed.initialState.round).toBe(initialState.round)
  })

  /**
   * The card database is ~12KB of the ~13KB initial state and rebuilds from the deck lists, so it
   * is stripped. Without this a long game's report would not be worth pasting.
   */
  it('strips the card database, and says so', () => {
    const md = report()
    const json = md.slice(md.indexOf('{"initialState"'))
    const parsed = JSON.parse(json.slice(0, json.lastIndexOf('}') + 1))
    expect(parsed.initialState.cards).toBeUndefined()
    expect(md).toContain(REPLAY_NOTE)
    expect(md).not.toContain('Big Unit"') // no card-db entry leaked into the payload
  })

  it('keeps the replay data collapsed so the report reads as prose', () => {
    expect(report()).toContain('<details>')
  })

  it('copes with an empty description and an empty game', () => {
    const md = buildReportMarkdown({ description: '', buildTag: 'b1', isDev: true, log: [], initialState: null, moves: [] })
    expect(md).toContain('b1')
    expect(md).toMatch(/no game in progress/i)
  })
})
