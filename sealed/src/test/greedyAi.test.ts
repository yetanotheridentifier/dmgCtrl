import { describe, it, expect } from 'vitest'
import { greedyAi, beamReplyAi } from '../ai/greedyAi'
import '../engine/cardDefinitions' // side-effect: registers every implemented card
import { legalMoves } from '../engine/legalMoves'
import { state, player, unit, card, CARDS, ready } from './helpers/engineFixtures'
import { loadReport, replay, REPORT_CARDS } from './helpers/replayReport'
import type { Action } from '../engine/actions'

/**
 * The greedy driver (#391): for each legal move, apply it, score the resulting board, take the best,
 * ties broken from the seed. It needs no per-card rules because `resolve` and `legalMoves` already
 * know everything. One ply, so it evaluates AFTER our move but before the reply: it avoids an
 * immediately-bad trade (combat resolves in-move) but cannot see the opponent's next turn (#392).
 */
describe('greedyAi', () => {
  it('is deterministic: the same state yields the same move', () => {
    const s = state({ players: { player: player({ hand: ['TST_U1'], resources: ready(2) }), opponent: player() } })
    expect(greedyAi(s)).toEqual(greedyAi(s))
  })

  it('takes a lethal attack rather than passing', () => {
    const s = state({
      players: {
        player: player({ units: [unit('u1', 'TST_U3')] }), // power 5, ready
        opponent: player({ base: { cardId: 'TST_B', damage: 26 } }), // 26 + 5 >= 30
      },
    })
    const move = greedyAi(s) as Action
    expect(move.type).toBe('attack')
    expect(move.type === 'attack' && move.target.kind).toBe('base')
  })

  it('does not throw itself into a losing trade', () => {
    const s = state({
      cards: {
        ...CARDS,
        WEAK: card({ id: 'WEAK', type: 'unit', arena: 'ground', power: 1, hp: 1 }),
        TANK: card({ id: 'TANK', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
      },
      players: {
        player: player({ units: [unit('u1', 'WEAK')] }),
        opponent: player({ units: [unit('e1', 'TANK')] }),
      },
    })
    const move = greedyAi(s) as Action
    // Attacking the 5-HP tank with a 1/1 loses the unit for nothing; greedy must not pick that.
    const suicidal = move.type === 'attack' && move.target.kind === 'unit' && move.target.instanceId === 'e1'
    expect(suicidal).toBe(false)
  })

  it('develops a unit rather than passing when it can', () => {
    const s = state({ players: { player: player({ hand: ['TST_U1'], resources: ready(2) }), opponent: player() } })
    const move = greedyAi(s) as Action
    expect(move.type).toBe('playUnit')
  })
})

/**
 * A LAW sweep game the bench dropped as stuck: the opponent used Hondo Ohnaka's action, "Play the top
 * card of your deck (paying its cost)", which offers that one card and cannot be declined. The engine
 * has the move; a bot deciding on what its seat can see must find it too.
 */
describe('the top card of the deck, offered to play', () => {
  const report = loadReport('hondoDeckTopGreedy')
  const offered = replay(report, REPORT_CARDS.hondoDeckTopGreedy)

  it('is the position the sweep dropped: one legal move, playing the offered card', () => {
    expect(offered.pendingChoices?.[0]).toMatchObject({ kind: 'playCardFrom', zone: 'deckTop', controller: 'opponent' })
    expect(legalMoves(offered)).toEqual([{ type: 'acceptChoice', choiceId: offered.pendingChoices?.[0].id, optionIndex: 0 }])
  })

  it.each([['greedy', greedyAi], ['beam-reply', beamReplyAi]])('%s plays it', (_, ai) => {
    expect(ai(offered)).toEqual(legalMoves(offered)[0])
  })
})
