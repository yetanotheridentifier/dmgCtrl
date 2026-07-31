import { describe, it, expect } from 'vitest'
import { replayUpTo, loadReport } from './helpers/replayReport'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions'
import { state, player, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * An exhausted leader still TRIGGERS (#421, reported as a bug, ruled correct).
 *
 * The report was "shouldn't be able to pay 1 to draw a card as leader already exhausted", filed
 * after exhausting the leader for a +2/+0 buff and then claiming the initiative. The engine offered
 * The Mandalorian's draw anyway, which is right: his front side reads
 *
 *   "When you take the initiative: You may pay 1. If you do, draw a card."
 *
 * The cost is ONE RESOURCE, not exhausting the leader. Exhaustion only blocks abilities that spend
 * it, which is why the cards that DO cost it check `leader.exhausted` themselves (Greef Karga's
 * Advantage token, and the very buff that exhausted the leader in the reported game).
 *
 * Pinned here rather than left implicit, because "leader is exhausted, so nothing should fire" is an
 * intuitive and wrong reading that could easily be "fixed" into the engine later.
 */
const M = {
  ...CARDS,
  ASH_014: card({ id: 'ASH_014', name: 'The Mandalorian', type: 'leader', cost: 6, power: 4, hp: 6, aspects: ['Aggression', 'Heroism'] }),
  ASH_017: card({ id: 'ASH_017', name: 'Greef Karga', type: 'leader', cost: 6, power: 3, hp: 6, aspects: ['Command'] }),
  BODY: card({ id: 'BODY', name: 'Body', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 3, aspects: ['Command'] }),
}

/** `exhausted` is the leader's state; the player always holds resources to pay the 1. */
function board(leaderCardId: string, exhausted: boolean): GameState {
  return state({
    phase: 'action',
    activePlayer: 'player',
    cards: M,
    initiative: 'opponent',
    initiativeTakenBy: null,
    players: {
      player: player({
        leader: { cardId: leaderCardId, deployed: false, epicActionUsed: false, exhausted },
        resources: ready(5),
      }),
      opponent: player({ resources: ready(5) }),
    },
  })
}

describe('a leader that costs no exhaustion still triggers while exhausted (#421)', () => {
  it('offers The Mandalorian’s pay-1-draw on taking the initiative, exhausted or not', () => {
    for (const exhausted of [false, true]) {
      const taken = resolve(board('ASH_014', exhausted), { type: 'takeInitiative' })
      expect(taken.pendingChoices?.map(c => c.kind), `exhausted=${String(exhausted)}`).toContain('mayPayToDraw')
    }
  })

  it('and the draw actually resolves for the exhausted leader', () => {
    const taken = resolve(board('ASH_014', true), { type: 'takeInitiative' })
    const choice = taken.pendingChoices!.find(c => c.kind === 'mayPayToDraw')!
    const drawn = resolve(taken, { type: 'acceptChoice', choiceId: choice.id })
    expect(drawn.players.player.hand.length).toBe(1)
    expect(drawn.players.player.resources.filter(r => r.exhausted).length, 'the cost is a resource').toBe(1)
  })

  /**
   * The other half of the rule, and the reason the first half is not simply an oversight: an ability
   * whose COST is exhausting the leader really is unavailable once it is exhausted.
   */
  it('but an ability that costs exhausting the leader is not offered when it already is', () => {
    const play = (exhausted: boolean): GameState => {
      const s = board('ASH_017', exhausted)
      return resolve({ ...s, players: { ...s.players, player: { ...s.players.player, hand: ['BODY'] } } }, { type: 'playUnit', handIndex: 0 })
    }
    expect(play(false).pendingChoices?.map(c => c.kind)).toContain('mayExhaustLeaderForAdvantage')
    expect(play(true).pendingChoices?.map(c => c.kind) ?? []).not.toContain('mayExhaustLeaderForAdvantage')
  })

  /** The reported game itself, replayed to the moment the draw was offered. */
  it('replays the filed report: the leader is exhausted and the draw is still legal', () => {
    // Move 18 is "You Take the initiative"; 17 moves replayed lands just before it.
    const beforeInitiative = replayUpTo(loadReport('exhaustedLeaderDraw'), 16)
    expect(beforeInitiative.players.player.leader.exhausted, 'the +2/+0 buff exhausted it').toBe(true)

    const taken = resolve(beforeInitiative, { type: 'takeInitiative' })
    expect(taken.pendingChoices?.map(c => c.kind)).toContain('mayPayToDraw')
    expect(legalMoves(taken).map(m => m.type)).toContain('acceptChoice')
  })
})
