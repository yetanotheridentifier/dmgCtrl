import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { describeChoiceParts } from '../utils/describeChoice'
import { describeAction, partsText } from '../utils/describeAction'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { loadReport, replayUpTo } from './helpers/replayReport'
import type { GameState } from '../engine/types'

/**
 * Grassroots Resistance (ASH_258) reads "Deal 3 damage to a unit. Heal 3 damage from your base." Both
 * sentences resolve, and the engine has done so since #551: the heal rides on the damage choice as
 * `thenHealBase` so the target is picked first.
 *
 * Neither string said so. The prompt asked only for a damage target and the log recorded only
 * "Deal 3 to <unit>", so a player whose base was hit again on the opponent's next action saw a base
 * back where it started and a log that never mentioned a heal. #575 was filed as the heal not firing.
 */

const F = {
  ...CARDS,
  ASH_258: card({ id: 'ASH_258', name: 'Grassroots Resistance', type: 'event', cost: 4 }),
  GRD: card({ id: 'GRD', name: 'Clan Wren Loyalist', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 5 }),
}

const choice = (s: GameState) => s.pendingChoices![0]

/** Grassroots in hand, a damaged base of your own, and one enemy unit to aim at. */
const played = () => resolve(state({
  cards: F,
  players: {
    player: player({ resources: ready(10), hand: ['ASH_258'], base: { cardId: 'TST_B', damage: 7 } }),
    opponent: player({ units: [unit('e', 'GRD')] }),
  },
}), { type: 'playEvent', handIndex: 0 })

describe('Grassroots Resistance (ASH_258) — the heal is stated, not just applied', () => {
  it('says the base heals in the prompt for the damage target', () => {
    const s = played()
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 3, thenHealBase: 3 })
    const text = partsText(describeChoiceParts(s, choice(s)))
    expect(text).toMatch(/3 damage/i)
    expect(text, 'the second sentence of the card').toMatch(/heal 3 .*your base/i)
  })

  it('says the base heals in the log entry for the answer', () => {
    const s = played()
    const label = describeAction(s, 'player', { type: 'acceptChoice', choiceId: choice(s).id, targetInstanceId: 'e' })
    expect(label).toContain('Deal 3 to Clan Wren Loyalist')
    expect(label, 'the log was the only record the player had').toMatch(/heal 3 .*your base/i)
  })

  /** A plain damage choice must not grow a heal clause it does not have. */
  it('leaves a damage choice with no heal tail alone', () => {
    const s = state({
      cards: F,
      players: { player: player({ units: [unit('u1', 'GRD')] }), opponent: player({ units: [unit('e', 'GRD')] }) },
      pendingChoices: [{ kind: 'selectDamageTarget', id: 'c', controller: 'player', amount: 2, unitTargets: ['e'], baseTargets: [] }],
    })
    expect(partsText(describeChoiceParts(s, choice(s)))).not.toMatch(/heal/i)
    expect(describeAction(s, 'player', { type: 'acceptChoice', choiceId: 'c', targetInstanceId: 'e' })).toBe('Deal 2 to Clan Wren Loyalist')
  })
})

/**
 * The board the ticket was filed from, kept because the report is the evidence that the engine was
 * always right here: move 46 plays the event, move 47 answers it, and the player's base goes 9 → 6.
 * The opponent's Clan Wren Loyalist then puts it straight back to 9, which is what the reporter saw.
 */
describe('#575: the reported game', () => {
  const report = loadReport('grassrootsHeal')

  it('heals the reporter\'s base by 3 when the damage target is chosen', () => {
    expect(replayUpTo(report, 47).players.player.base.damage, 'the event is played, the choice outstanding').toBe(9)
    expect(replayUpTo(report, 48).players.player.base.damage, 'damage dealt and base healed').toBe(6)
  })

  it('and the opponent takes it straight back, which is why the heal looked absent', () => {
    expect(replayUpTo(report, 51).players.player.base.damage).toBe(9)
  })
})
