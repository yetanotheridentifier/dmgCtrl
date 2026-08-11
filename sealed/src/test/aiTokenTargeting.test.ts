import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { makeQuiescent } from '../ai/search'
import { evaluate } from '../ai/evaluate'
import { opponentAi } from '../config'
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { loadReport, replayUpTo } from './helpers/replayReport'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * Handing a beneficial token to the enemy (#501).
 *
 * Zeb Orrelios reads "When Played: Give 3 Advantage tokens to **another** unit", so every unit but
 * himself is a legal target, enemies included, and the engine is right to offer them. Reported from
 * play: the bot gave all three to the reporter's Razor Crest.
 *
 * Advantage is a **1/0** token, so it is not invisible the way a Shield is: it feeds `power` through
 * `withUpgrades`. The evaluation therefore has everything it needs to see that arming an enemy is
 * bad, which is what makes the reported behaviour worth pinning rather than explaining away.
 */

const cards = {
  ...CARDS,
  MINE: card({ id: 'MINE', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 4 }),
  THEIRS: card({ id: 'THEIRS', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 4 }),
}

/** The bot (`opponent`) owes Zeb's mandatory grant, with one of its own units and one enemy to aim at. */
function grantPending(): GameState {
  return state({
    cards,
    activePlayer: 'opponent',
    players: {
      player: player({ units: [unit('theirs', 'THEIRS', { arena: 'ground' })] }),
      opponent: player({ units: [unit('mine', 'MINE', { arena: 'ground' })] }),
    },
    pendingChoices: [{
      kind: 'mayGiveTokens',
      id: 'zeb',
      controller: 'opponent',
      token: TOKEN_ADVANTAGE,
      count: 3,
      targets: ['mine', 'theirs'],
      optional: false,
    }],
  })
}

const advOn = (s: GameState, id: string): number =>
  [...s.players.player.units, ...s.players.opponent.units]
    .find(u => u.instanceId === id)!.upgrades.filter(u => u.cardId === TOKEN_ADVANTAGE).length

describe('choosing who receives a beneficial token', () => {
  /** Both targets are on offer and the grant is mandatory, so this is a real decision, not a forced move. */
  it('offers both its own unit and the enemy', () => {
    const moves = legalMoves(grantPending())
    expect(moves.map(m => (m as { targetInstanceId?: string }).targetInstanceId).sort())
      .toEqual(['mine', 'theirs'])
  })

  /**
   * **The evaluation can see the difference**, so a wrong pick is a search or plumbing fault rather
   * than a blind spot. Asserted directly: arming our own unit must score above arming theirs.
   */
  it('scores arming its own unit above arming the enemy', () => {
    const s = grantPending()
    const score = makeQuiescent(evaluate)
    const mine = score(resolve(s, { type: 'acceptChoice', choiceId: 'zeb', targetInstanceId: 'mine' }), 'opponent', undefined)
    const theirs = score(resolve(s, { type: 'acceptChoice', choiceId: 'zeb', targetInstanceId: 'theirs' }), 'opponent', undefined)
    expect(mine).toBeGreaterThan(theirs)
  })

  /** And the shipped bot must actually act on that. */
  it('gives the tokens to its own unit, not the enemy', () => {
    const s = grantPending()
    const move = opponentAi(s)
    expect(move).not.toBeNull()
    const after = resolve(s, move!)
    expect(advOn(after, 'theirs'), 'the enemy must not be armed').toBe(0)
    expect(advOn(after, 'mine'), 'our own unit takes them').toBe(3)
  })

  /**
   * **Arming an enemy is sometimes forced, and that is the card working.**
   *
   * The filed report is this position: Zeb was the bot's only unit, "another unit" left nothing but
   * enemies, and the grant carries no "may". There was no legal alternative, so the behaviour is
   * correct and the report is not a defect.
   *
   * Pinned because it looks exactly like a bug from the receiving end, and a future reader could
   * "fix" it by filtering the targets to friendlies, which would break the card.
   */
  it('still answers when every legal target is an enemy', () => {
    const s = replayUpTo(loadReport('advantageToEnemy'), 73)
    const choice = (s.pendingChoices ?? [])[0] as { kind: string; optional?: boolean; targets: string[] }
    expect(choice.kind).toBe('mayGiveTokens')
    expect(choice.optional, 'the card has no "may"').toBe(false)
    expect(s.players.opponent.units, 'Zeb is the bot\'s only unit').toHaveLength(1)
    expect(choice.targets.every(t => s.players.player.units.some(u => u.instanceId === t)),
      'so every target is an enemy').toBe(true)
    expect(legalMoves(s).length, 'and declining is not on offer').toBe(choice.targets.length)
  })

  /**
   * **The real gap: it cannot tell the recipients apart.** `power` is summed across units, so +3
   * lands identically wherever it goes and all three enemies score the same (-46.53 in the filed
   * game). Arming a 1-cost TIE Striker is far cheaper than arming a leader, and nothing in the model
   * says so.
   *
   * Recorded here rather than fixed: Advantage is one-shot, spent on the next attack or defence, and
   * valuing that correctly is what would separate a recipient who can use it from one who cannot.
   */
  it('cannot yet tell one enemy recipient from another', () => {
    const s = replayUpTo(loadReport('advantageToEnemy'), 73)
    const score = makeQuiescent(evaluate)
    const values = legalMoves(s).map(m => score(resolve(s, m), 'opponent', undefined))
    expect(new Set(values.map(v => v.toFixed(4))).size, 'every recipient scores alike').toBe(1)
  })
})
