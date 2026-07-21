import { describe, it, expect } from 'vitest'
import { describeAction } from '../utils/describeAction'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import type { PendingChoice } from '../engine/types'

/** The action-menu labels for pending "may…" choices, shown as buttons. */
describe('describeAction — pending choice labels', () => {
  const withChoice = (choice: PendingChoice, extraCards = {}) =>
    state({
      cards: { ...CARDS, ...extraCards },
      players: { player: player({ units: [unit('u1', 'TST_U1')] }), opponent: player() },
      pendingChoices: [choice],
    })

  it('labels pay-or-exhaust accept and decline', () => {
    const s = withChoice({ kind: 'payOrExhaust', id: 'u1', controller: 'player', unitId: 'u1', cost: 3 })
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'u1' })).toBe('Pay 3')
    expect(describeAction(s, 'player', { type: 'skipTrigger', choiceId: 'u1' })).toBe("Don't pay (exhaust)")
  })

  it('labels may-play-top-free for a unit', () => {
    const s = withChoice(
      { kind: 'mayPlayTopFree', id: 'x', controller: 'player', unitId: 'x', cardId: 'TOPU' },
      { TOPU: card({ id: 'TOPU', name: 'Scout', type: 'unit', arena: 'ground', cost: 2 }) },
    )
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x' })).toBe('Play Scout free')
    expect(describeAction(s, 'player', { type: 'skipTrigger', choiceId: 'x' })).toBe("Don't play")
  })

  it('names the target when playing an upgrade free', () => {
    const s = withChoice(
      { kind: 'mayPlayTopFree', id: 'x', controller: 'player', unitId: 'x', cardId: 'TOPUP' },
      { TOPUP: card({ id: 'TOPUP', name: 'Blaster', type: 'upgrade', cost: 1 }) },
    )
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x', targetInstanceId: 'u1' })).toBe('Play Blaster free on TST_U1')
  })

  it('labels the DDC Defender damage-and-exhaust choice', () => {
    const s = withChoice({ kind: 'mayDamageExhaust', id: 'x', controller: 'player', unitId: 'u1', arena: 'ground' })
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x', targetInstanceId: 'u1' })).toBe('Deal 1 & exhaust TST_U1')
    expect(describeAction(s, 'player', { type: 'skipTrigger', choiceId: 'x' })).toBe('Decline')
  })

  /**
   * Kinds with no label rendered as a bare "Accept" and, worse, leaked their internal name as
   * "Skip <kind>" (#379, #380). Two identical Accept buttons for Treacherous Minefield's arena
   * choice read as one button per unit, which is what the report described.
   */
  describe('kinds that had no label', () => {
    it('names each mode of a choose-one (Choose Your Path)', () => {
      const s = withChoice({ kind: 'chooseMode', id: 'x', controller: 'player', modes: ['healBase', 'mandoToken'] })
      expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x', optionIndex: 0 })).toMatch(/heal 5.*base/i)
      expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x', optionIndex: 1 })).toMatch(/mandalorian token/i)
      expect(describeAction(s, 'player', { type: 'skipTrigger', choiceId: 'x' })).toBe('Decline')
    })

    it('names the arena being mined (Treacherous Minefield)', () => {
      const s = withChoice({ kind: 'selectArenaToGrant', id: 'x', controller: 'player', grantCardId: 'GRANT_MINEFIELD' })
      const ground = describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x', optionIndex: 0 })
      const space = describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x', optionIndex: 1 })
      expect(ground).toMatch(/ground/i)
      expect(space).toMatch(/space/i)
      expect(ground).not.toBe(space) // two identical "Accept"s were the whole bug
    })

    it('names the discard-pile unit being played', () => {
      const s = withChoice(
        { kind: 'mayPlayUnitFromDiscard', id: 'x', controller: 'player', candidates: ['DEADU'], remaining: 1 } as unknown as PendingChoice,
        { DEADU: card({ id: 'DEADU', name: 'Fallen Scout', type: 'unit', arena: 'ground', cost: 2 }) },
      )
      expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x', optionIndex: 0 })).toMatch(/fallen scout/i)
      expect(describeAction(s, 'player', { type: 'skipTrigger', choiceId: 'x' })).toBe("Don't play")
    })

    it('states the number chosen (Sense Through the Force)', () => {
      const s = withChoice({ kind: 'chooseNumber', id: 'x', controller: 'player', max: 10, then: 'senseThroughTheForce' })
      expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x', optionIndex: 3 })).toMatch(/\b3\b/)
    })

    it('names the unit being taken (Rehabilitation)', () => {
      const s = withChoice({ kind: 'selectUnitToSteal', id: 'x', controller: 'player', targets: ['u1'], power: -3 })
      expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x', targetInstanceId: 'u1' })).toMatch(/TST_U1/)
    })
  })

  /**
   * The safety net. Rather than relying on every kind being listed, an unrecognised choice must
   * degrade to a plain word: an internal name reaching the player is never acceptable.
   */
  it('never leaks a raw choice kind, even for one it has no case for', () => {
    const s = withChoice({ kind: 'someFutureKind', id: 'x', controller: 'player' } as unknown as PendingChoice)
    expect(describeAction(s, 'player', { type: 'skipTrigger', choiceId: 'x' })).toBe('Decline')
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'x' })).not.toMatch(/someFutureKind/)
  })
})
