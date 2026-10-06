import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { poolFor } from '../bench/setPools'
import { loadReport, replayUpTo } from './helpers/replayReport'
import type { GameState, PendingChoice } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * A coverage-sweep game (`--sweep --set SHD --games 20`) dropped as `stuck` on Palpatine's Return:
 * "Play a unit from your discard pile. It costs 6 less. If it's a Force unit, it costs 8 less instead."
 *
 * Move 95 plays the event with Maul (SHD_090, a Force unit) and other units in the pile; move 96 is
 * the player's pick of a non-Force unit. The card plays ONE unit, so that pick must end the event.
 */
const report = loadReport('palpatinesReturnTwoPlays')
const SHD = poolFor(['SHD'])
const AFTER_PLAYING_IT = 96
const palpatine = (s: GameState): PendingChoice[] =>
  (s.pendingChoices ?? []).filter(c => c.kind === 'playCardFrom' && c.id.startsWith('SHD_094'))

describe('Palpatine\'s Return, from the dropped sweep game', () => {
  it('offers one play over the whole pile, the Force unit among the rest', () => {
    const played = replayUpTo(report, AFTER_PLAYING_IT, SHD)
    const raised = palpatine(played)
    expect(raised).toHaveLength(1)
    const ids = raised[0].kind === 'playCardFrom' ? raised[0].candidates.map(c => c.cardId) : []
    expect(ids).toContain('SHD_090')
    expect(ids.some(id => id !== 'SHD_090'), 'a non-Force unit is offered too').toBe(true)
  })

  it('picking a non-Force unit plays that one unit and leaves the player a move', () => {
    const played = replayUpTo(report, AFTER_PLAYING_IT, SHD)
    const [c] = palpatine(played)
    if (c?.kind !== 'playCardFrom') throw new Error('no Palpatine\'s Return choice')
    const optionIndex = c.candidates.findIndex(r => r.cardId !== 'SHD_090')
    const unitsBefore = played.players.player.units.length
    const done = resolve(played, { type: 'acceptChoice', choiceId: c.id, optionIndex } as never)
    expect(palpatine(done)).toHaveLength(0)
    expect(done.players.player.units.length - unitsBefore).toBe(1)
    expect(done.players.player.discard).toContain('SHD_090')
    expect(legalMoves(done).length).toBeGreaterThan(0)
  })
})
