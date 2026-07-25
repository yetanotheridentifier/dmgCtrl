import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import '../engine/cardDefinitions'
import { state, player, card, CARDS, unit, ready } from './helpers/engineFixtures'
import { TOKEN_ADVANTAGE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { upgradeDefeatedThisPhase } from '../engine/types'
import type { GameState, PendingChoice } from '../engine/types'

/**
 * "Return an upgrade to its owner's hand" (#401).
 *
 * A token upgrade has no card to put in a hand, so it is DEFEATED instead. That was excluded
 * entirely: Full of Surprises and Jabba both filtered candidates to `type === 'upgrade'`, so an
 * enemy Shield could never be targeted. The reporter saw this as "only offering friendly upgrades",
 * because in that game the opponent's only upgrades were Shield tokens.
 *
 * The second half matters just as much: returning a token must go through the DEFEAT path so
 * "when a friendly upgrade is defeated" fires for the token's owner. `returnUpgradeToHand` used to
 * delete tokens silently.
 */
const C = {
  ...CARDS,
  ASH_232: card({ id: 'ASH_232', name: 'Full of Surprises', type: 'event', cost: 0 }),
  ASH_042: card({ id: 'ASH_042', name: 'Jabba the Hutt', type: 'unit', arena: 'ground', cost: 0, power: 2, hp: 3 }),
  BODY: card({ id: 'BODY', name: 'Body', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
  CHEAP_UP: card({ id: 'CHEAP_UP', name: 'Cheap Upgrade', type: 'upgrade', cost: 1 }),
  BIG_UP: card({ id: 'BIG_UP', name: 'Costly Upgrade', type: 'upgrade', cost: 3 }),
}

const returnChoice = (s: GameState) =>
  s.pendingChoices?.find((c): c is Extract<PendingChoice, { kind: 'selectUpgradeToReturn' }> => c.kind === 'selectUpgradeToReturn')

/** Player holds `handCardId`; the opponent's unit carries a Shield token and a cheap card upgrade. */
function board(handCardId: string, enemyUpgrades = [{ cardId: TOKEN_SHIELD, owner: 'opponent' as const }, { cardId: 'CHEAP_UP', owner: 'opponent' as const }]) {
  return state({
    phase: 'action',
    activePlayer: 'player',
    cards: C,
    players: {
      player: player({ hand: [handCardId], resources: ready(5), units: [unit('mine', 'BODY', { arena: 'ground' })] }),
      opponent: player({ units: [unit('theirs', 'BODY', { arena: 'ground', upgrades: enemyUpgrades })] }),
    },
  })
}

describe('Full of Surprises can target token upgrades (#401)', () => {
  it('offers an enemy Shield token alongside the enemy card upgrade', () => {
    const played = resolve(board('ASH_232'), { type: 'playEvent', handIndex: 0 })
    const choice = returnChoice(played)!
    expect(choice.candidates.map(c => c.cardId).sort()).toEqual([TOKEN_SHIELD, 'CHEAP_UP'].sort())
  })

  it('still respects "costs 2 or less": a 3-cost upgrade is excluded, a 0-cost token is not', () => {
    const played = resolve(
      board('ASH_232', [{ cardId: 'BIG_UP', owner: 'opponent' }, { cardId: TOKEN_ADVANTAGE, owner: 'opponent' }]),
      { type: 'playEvent', handIndex: 0 },
    )
    expect(returnChoice(played)!.candidates.map(c => c.cardId)).toEqual([TOKEN_ADVANTAGE])
  })

  it('defeats the token rather than returning it: no card reaches any hand', () => {
    const played = resolve(board('ASH_232'), { type: 'playEvent', handIndex: 0 })
    const choice = returnChoice(played)!
    const tokenIndex = choice.candidates.findIndex(c => c.cardId === TOKEN_SHIELD)
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice.id, optionIndex: tokenIndex })

    expect(done.players.opponent.units.find(u => u.instanceId === 'theirs')!.upgrades.map(u => u.cardId)).toEqual(['CHEAP_UP'])
    expect(done.players.opponent.hand).not.toContain(TOKEN_SHIELD)
    expect(done.players.player.hand).not.toContain(TOKEN_SHIELD)
  })

  it('fires "a friendly upgrade was defeated" for the token owner', () => {
    const played = resolve(board('ASH_232'), { type: 'playEvent', handIndex: 0 })
    const choice = returnChoice(played)!
    const tokenIndex = choice.candidates.findIndex(c => c.cardId === TOKEN_SHIELD)
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice.id, optionIndex: tokenIndex })
    expect(upgradeDefeatedThisPhase(done, 'opponent')).toBe(true)
  })

  it('still raises its "give a Shield token" follow-up after a token pick', () => {
    const played = resolve(board('ASH_232'), { type: 'playEvent', handIndex: 0 })
    const choice = returnChoice(played)!
    const tokenIndex = choice.candidates.findIndex(c => c.cardId === TOKEN_SHIELD)
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice.id, optionIndex: tokenIndex })
    expect(done.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_SHIELD })
  })
})

describe('Jabba the Hutt can target token upgrades too (#401)', () => {
  it('offers an enemy Shield token', () => {
    const played = resolve(board('ASH_042'), { type: 'playUnit', handIndex: 0 })
    expect(returnChoice(played)!.candidates.map(c => c.cardId)).toContain(TOKEN_SHIELD)
  })

  it('a card upgrade still goes to its OWNER’s hand', () => {
    const played = resolve(board('ASH_042'), { type: 'playUnit', handIndex: 0 })
    const choice = returnChoice(played)!
    const cardIndex = choice.candidates.findIndex(c => c.cardId === 'CHEAP_UP')
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice.id, optionIndex: cardIndex })
    expect(done.players.opponent.hand).toContain('CHEAP_UP')
  })

  /**
   * The trap: Jabba offers a free replay when the upgrade came back to YOUR hand. A token never
   * reaches a hand, so that offer must not appear, or the player is invited to replay a card that
   * exists nowhere.
   */
  it('never offers to replay a defeated token for free', () => {
    const own = state({
      phase: 'action',
      activePlayer: 'player',
      cards: C,
      players: {
        player: player({ hand: ['ASH_042'], resources: ready(5), units: [unit('mine', 'BODY', { arena: 'ground', upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })] }),
        opponent: player(),
      },
    })
    const played = resolve(own, { type: 'playUnit', handIndex: 0 })
    const choice = returnChoice(played)!
    const tokenIndex = choice.candidates.findIndex(c => c.cardId === TOKEN_SHIELD)
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice.id, optionIndex: tokenIndex })
    expect(done.pendingChoices?.some(c => c.kind === 'mayPlayUpgradeFree')).toBeFalsy()
  })
})
