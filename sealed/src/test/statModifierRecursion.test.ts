import { describe, it, expect } from 'vitest'
import '../engine/cardDefinitions' // side-effect: registers ASH_206 (Kelleran Beq)
import { effectivePower } from '../engine/stats'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'

/**
 * A stat modifier that reads other units' effective power must not recurse forever when two such
 * units reference each other. Kelleran Beq (ASH_206) gets "+1/+0 for each other unit with 0 power",
 * computed via `effectivePower`; with two Beqs in play, Beq1's power asked for Beq2's, which asked
 * for Beq1's, blowing the stack. Found by the coverage sweep (#408). The stat computation now guards
 * re-entry: while a unit's modifier is being evaluated, a nested request for the same unit's
 * conditional modifier contributes 0, breaking the cycle without changing non-cyclic results.
 */
describe('stat modifier recursion guard', () => {
  const twoBeqs = () => state({
    cards: { ...CARDS, ASH_206: card({ id: 'ASH_206', type: 'unit', power: 3, hp: 5 }) },
    players: {
      player: player({ units: [unit('b1', 'ASH_206'), unit('b2', 'ASH_206')] }),
      opponent: player(),
    },
  })

  it('does not overflow the stack with two mutually-dependent units', () => {
    const s = twoBeqs()
    expect(() => effectivePower(s, s.players.player.units[0])).not.toThrow()
  })

  it('gives the correct power: two 3-power Beqs do not buff each other (neither is 0 power)', () => {
    const s = twoBeqs()
    expect(effectivePower(s, s.players.player.units[0])).toBe(3)
  })

  it('still counts a genuine 0-power unit', () => {
    const s = state({
      cards: { ...CARDS, ASH_206: card({ id: 'ASH_206', type: 'unit', power: 3, hp: 5 }), ZERO: card({ id: 'ZERO', type: 'unit', power: 0, hp: 4 }) },
      players: {
        player: player({ units: [unit('b1', 'ASH_206'), unit('b2', 'ASH_206'), unit('z', 'ZERO')] }),
        opponent: player(),
      },
    })
    // Each Beq sees one 0-power unit (the ZERO), so +1: 3 -> 4. The other Beq (3 power) is not counted.
    expect(effectivePower(s, s.players.player.units[0])).toBe(4)
  })
})
