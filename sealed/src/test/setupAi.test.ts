import { describe, it, expect } from 'vitest'
import { setupAi } from '../ai/setupAi'
import { card, state, player, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

// Cost-labelled test units. TST_B provides Vigilance; TST_L provides Command +
// Heroism — off-aspect Aggression cards pay +2, which the heuristic must respect.
const EXTRA = {
  TST_C1: card({ id: 'TST_C1', type: 'unit', arena: 'ground', cost: 1, aspects: ['Command'] }),
  TST_C2: card({ id: 'TST_C2', type: 'unit', arena: 'ground', cost: 2, aspects: ['Command'] }),
  TST_C3: card({ id: 'TST_C3', type: 'unit', arena: 'ground', cost: 3, aspects: ['Command'] }),
  TST_C4: card({ id: 'TST_C4', type: 'unit', arena: 'ground', cost: 4, aspects: ['Command'] }),
  TST_C6: card({ id: 'TST_C6', type: 'unit', arena: 'ground', cost: 6, aspects: ['Command'] }),
  TST_OFF2: card({ id: 'TST_OFF2', type: 'unit', arena: 'ground', cost: 2, aspects: ['Aggression'] }), // effective 4
  TST_EV: card({ id: 'TST_EV', type: 'event', cost: 1, aspects: ['Command'] }),
}

function setupState(hand: string[], stage: 'mulligan' | 'resource' = 'mulligan'): GameState {
  return state({
    cards: { ...CARDS, ...EXTRA },
    phase: 'setup',
    setupStage: stage,
    activePlayer: 'opponent',
    players: {
      player: player(),
      opponent: player({ hand, deck: ['TST_C2', 'TST_C2', 'TST_C2'] }),
    },
  })
}

describe('setupAi — mulligan decision', () => {
  it('keeps a hand containing a turn-1 play (unit with effective cost ≤ 2)', () => {
    const s = setupState(['TST_C6', 'TST_C6', 'TST_C2', 'TST_C6', 'TST_C6', 'TST_C6'])
    expect(setupAi(s)).toEqual({ type: 'keepHand' })
  })

  it('mulligans a hand with no turn-1 play', () => {
    const s = setupState(['TST_C3', 'TST_C4', 'TST_C6', 'TST_C6', 'TST_C6', 'TST_C6'])
    expect(setupAi(s)).toEqual({ type: 'mulligan' })
  })

  it('accounts for the aspect penalty — an off-aspect 2-cost is not a turn-1 play', () => {
    const s = setupState(['TST_OFF2', 'TST_C4', 'TST_C6', 'TST_C6', 'TST_C6', 'TST_C6'])
    expect(setupAi(s)).toEqual({ type: 'mulligan' })
  })

  it('events do not count as a turn-1 play (engine cannot play them yet)', () => {
    const s = setupState(['TST_EV', 'TST_C4', 'TST_C6', 'TST_C6', 'TST_C6', 'TST_C6'])
    expect(setupAi(s)).toEqual({ type: 'mulligan' })
  })
})

describe('setupAi — resource choice (two single picks)', () => {
  /** Apply the AI's two sequential picks; return the resourced card ids. */
  function resourcedByAi(hand: string[]): string[] {
    let s = setupState(hand, 'resource')
    for (let pick = 0; pick < 2; pick++) {
      const action = setupAi(s)
      expect(action).toMatchObject({ type: 'setupResource' })
      const { handIndex } = action as { handIndex: number }
      const cardId = s.players.opponent.hand[handIndex]
      const remaining = s.players.opponent.hand.filter((_, i) => i !== handIndex)
      s = {
        ...s,
        players: {
          ...s.players,
          opponent: {
            ...s.players.opponent,
            hand: remaining,
            resources: [...s.players.opponent.resources, { cardId, exhausted: false }],
          },
        },
      }
    }
    return s.players.opponent.resources.map(r => r.cardId)
  }

  it('keeps the curve: never resources away the only turn-1 play', () => {
    const resourced = resourcedByAi(['TST_C2', 'TST_C6', 'TST_C6', 'TST_C6', 'TST_C6', 'TST_C6'])
    expect(resourced).not.toContain('TST_C2')
  })

  it('preserves a 2/3/4 curve when one exists', () => {
    const resourced = resourcedByAi(['TST_C2', 'TST_C3', 'TST_C4', 'TST_C6', 'TST_C6', 'TST_C6'])
    expect(resourced).toEqual(['TST_C6', 'TST_C6'])
  })

  it('with duplicate cheap units, resources the expensive spares', () => {
    const resourced = resourcedByAi(['TST_C1', 'TST_C1', 'TST_C2', 'TST_C2', 'TST_C6', 'TST_C6'])
    expect(resourced).toEqual(['TST_C6', 'TST_C6'])
  })

  it('returns null outside the setup phase', () => {
    expect(setupAi(state())).toBeNull()
  })
})
