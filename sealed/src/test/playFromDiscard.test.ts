import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolve } from '../engine/resolve'
import { legalMoves, zoneCards } from '../engine/legalMoves'
import '../engine/cardDefinitions'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import { cardsPlayedThisPhase } from '../engine/types'
import type { GameState, PendingChoice, PlayerId } from '../engine/types'

/**
 * Playing a card out of a discard pile (#471).
 *
 * A discard pile is another zone, so **this is #468's `playCardFrom` with more zones on it**, not a
 * second way to play a card. The door still pays at CR 6.2.f step 4 and puts the card into play at
 * step 5, still fires the card's When Played, still records the play. What the discard pile adds is
 * ownership: a pile belongs to a player, and a card played out of somebody else's pile is still
 * **their** card, so it goes back to their discard when it leaves play (CR 1.5.2). That is what
 * `cardOwner` threads through the three type doors.
 *
 * One shape does not fit that door at all. "For this phase, you may play that card from your discard
 * pile" is a standing permission on the **Play a Card action**, not a pending choice: the player
 * takes it later, on their own turn, among their normal moves. It gets `discardPlayGrants`, phase
 * state alongside `bannedNames`, and its own action, but it **resolves through `playFromZone`**, so
 * pay/remove/hand-to-the-type-door is still stated exactly once.
 */

/** Push a choice straight onto a state: these tests exercise the door, not the cards that open it. */
const withChoice = (s: GameState, choice: PendingChoice): GameState => ({ ...s, pendingChoices: [choice] })
const answer = (s: GameState, extra: Record<string, unknown> = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, ...extra } as never)

const cards = {
  ...CARDS,
  // A 3-cost unit and a 2-cost upgrade, each with one unprovided aspect icon (the test leader
  // provides Command + Heroism, its base Vigilance) so an aspect penalty is visible in the price.
  DU: card({ id: 'DU', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2, aspects: ['Aggression'] }),
  DG: card({ id: 'DG', type: 'upgrade', cost: 2, power: 2, hp: 2, aspects: ['Aggression'] }),
  DE: card({ id: 'DE', type: 'event', cost: 2, aspects: ['Aggression'] }),
}

describe('zoneCards: a discard pile is a zone like any other', () => {
  const s = state({
    cards,
    players: {
      player: player({ discard: ['DU', 'DG'], hand: ['DE'] }),
      opponent: player({ discard: ['TST_U1'] }),
    },
  })

  it('reads the controller\'s own discard pile', () => {
    expect(zoneCards(s, 'player', 'discard')).toEqual(['DU', 'DG'])
  })

  it('reads an opponent\'s discard pile', () => {
    expect(zoneCards(s, 'player', 'opponentDiscard')).toEqual(['TST_U1'])
  })

  it('reads both piles as one zone, own pile first, for "any player\'s discard pile"', () => {
    // A Fine Addition. Own first and the opponent's after it, so an index past the controller's
    // own pile names one of theirs — the same convention `handOrResources` uses.
    expect(zoneCards(s, 'player', 'anyDiscard')).toEqual(['DU', 'DG', 'TST_U1'])
  })

  it('reads the hand and the discard pile as one zone, hand first', () => {
    // Gideon's Light Cruiser: "from your hand or discard pile".
    expect(zoneCards(s, 'player', 'handOrDiscard')).toEqual(['DE', 'DU', 'DG'])
  })
})

describe('playCardFrom out of a discard pile', () => {
  const board = (overrides: { discard?: string[]; resources?: number; oppDiscard?: string[] } = {}) => state({
    cards,
    players: {
      player: player({ discard: overrides.discard ?? ['DU'], resources: ready(overrides.resources ?? 10) }),
      opponent: player({ discard: overrides.oppDiscard ?? [] }),
    },
  })
  const playChoice = (extra: Record<string, unknown> = {}): PendingChoice => ({
    kind: 'playCardFrom', id: 'c', controller: 'player', zone: 'discard',
    candidates: [{ index: 0, cardId: 'DU' }], ...extra,
  } as PendingChoice)

  it('takes the card out of the discard pile and puts it into play', () => {
    const after = answer(withChoice(board(), playChoice()), { optionIndex: 0 })
    expect(after.players.player.discard).toEqual([])
    expect(after.players.player.units.map(u => u.cardId)).toEqual(['DU'])
  })

  it('charges the full effective cost, aspect penalty included, when the play is not free', () => {
    // DU costs 3 and shows one unprovided Aggression icon, so 3 + 2 = 5.
    const after = answer(withChoice(board(), playChoice()), { optionIndex: 0 })
    expect(after.players.player.resources.filter(r => r.exhausted)).toHaveLength(5)
  })

  it('applies a cost delta and floors the total at 0', () => {
    // Palpatine's Return reads "costs 6 less" against a 5-resource price.
    const after = answer(withChoice(board(), playChoice({ costDelta: -6 })), { optionIndex: 0 })
    expect(after.players.player.resources.filter(r => r.exhausted)).toHaveLength(0)
    expect(after.players.player.units).toHaveLength(1)
  })

  it('a free play bypasses the aspect penalty as well as the cost (CR 8.5)', () => {
    const after = answer(withChoice(board(), playChoice({ free: true })), { optionIndex: 0 })
    expect(after.players.player.resources.filter(r => r.exhausted)).toHaveLength(0)
  })

  it('is not offered when the cost cannot be met', () => {
    const s = withChoice(board({ resources: 4 }), playChoice())
    expect(legalMoves(s).filter(m => m.type === 'acceptChoice')).toHaveLength(0)
  })

  it('records the play, so "the first card you play this phase" counts it', () => {
    const after = answer(withChoice(board(), playChoice({ free: true })), { optionIndex: 0 })
    expect(cardsPlayedThisPhase(after, 'player')).toContain('DU')
  })
})

describe('a card played out of another player\'s discard pile keeps its owner', () => {
  // CR 1.5.2: a card is always owned by the player whose deck it started in, and returns to that
  // player's discard pile when it leaves play. Playing it does not transfer ownership.
  const board = () => state({
    cards,
    players: {
      player: player({ resources: ready(10) }),
      opponent: player({ discard: ['DU', 'DG'] }),
    },
  })

  it('a unit enters play under the player who played it, but owned by the pile\'s owner', () => {
    const after = answer(withChoice(board(), {
      kind: 'playCardFrom', id: 'c', controller: 'player', zone: 'opponentDiscard',
      candidates: [{ index: 0, cardId: 'DU' }], free: true,
    } as PendingChoice), { optionIndex: 0 })
    expect(after.players.opponent.discard).toEqual(['DG'])
    expect(after.players.player.units).toHaveLength(1)
    expect(after.players.player.units[0].owner).toBe('opponent')
  })

  it('that unit is defeated into its owner\'s discard pile, not its controller\'s', () => {
    const played = answer(withChoice(board(), {
      kind: 'playCardFrom', id: 'c', controller: 'player', zone: 'opponentDiscard',
      candidates: [{ index: 0, cardId: 'DU' }], free: true,
    } as PendingChoice), { optionIndex: 0 })
    const id = played.players.player.units[0].instanceId
    const dead = resolve({ ...played, pendingChoices: [{ kind: 'selectUnitToDefeat', id: 'd', controller: 'player', targets: [id] } as PendingChoice] },
      { type: 'acceptChoice', choiceId: 'd', targetInstanceId: id } as never)
    expect(dead.players.opponent.discard).toContain('DU')
    expect(dead.players.player.discard).not.toContain('DU')
  })

  it('an upgrade played from an opponent\'s pile attaches with that opponent as its owner', () => {
    const s = board()
    const withUnit = { ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('u1', 'TST_U1')] } } }
    const after = answer(withChoice(withUnit, {
      kind: 'attachPlayedCard', id: 'c', controller: 'player', zone: 'opponentDiscard',
      index: 1, cardId: 'DG', targets: ['u1'], free: true,
    } as PendingChoice), { targetInstanceId: 'u1' })
    expect(after.players.player.units[0].upgrades).toEqual([{ cardId: 'DG', owner: 'opponent' }])
  })

  it('an event played from an opponent\'s pile resolves and goes back to their discard', () => {
    const s = state({
      cards,
      players: { player: player({ resources: ready(10) }), opponent: player({ discard: ['DE'] }) },
    })
    const after = answer(withChoice(s, {
      kind: 'playCardFrom', id: 'c', controller: 'player', zone: 'opponentDiscard',
      candidates: [{ index: 0, cardId: 'DE' }], free: true,
    } as PendingChoice), { optionIndex: 0 })
    expect(after.players.opponent.discard).toEqual(['DE'])
    expect(after.players.player.discard).toEqual([])
  })
})

describe('what a discard play does beyond a plain one', () => {
  const board = (discard = ['DU']) => state({
    cards,
    players: { player: player({ discard, resources: ready(10) }), opponent: player() },
  })
  const play = (then: Record<string, unknown>) => answer(withChoice(board(), {
    kind: 'playCardFrom', id: 'c', controller: 'player', zone: 'discard',
    candidates: [{ index: 0, cardId: 'DU' }], free: true, then,
  } as PendingChoice), { optionIndex: 0 })

  it('enters the unit ready when the card says so (Nightbrother, Unnatural Life)', () => {
    expect(play({ entersReady: true }).players.player.units[0].exhausted).toBe(false)
  })

  it('leaves it exhausted by default, as any played unit is', () => {
    expect(play({}).players.player.units[0].exhausted).toBe(true)
  })

  it('leaves a delayed effect to defeat it at the next regroup phase', () => {
    const after = play({ entersReady: true, sourceCardId: 'HMW_204', delay: 'regroupStart' })
    expect(after.delayedEffects).toHaveLength(1)
    expect(after.delayedEffects![0]).toMatchObject({ cardId: 'HMW_204', when: 'regroupStart', owner: 'player' })
    expect(after.delayedEffects![0].unitId).toBe(after.players.player.units[0].instanceId)
  })

  it('deals damage to the unit it just played (Salvage)', () => {
    expect(play({ damageIt: 1 }).players.player.units[0].damage).toBe(1)
  })

  it('gives the unit tokens (Mechanize\'s Experience)', () => {
    const after = play({ tokens: ['TOKEN_EXPERIENCE'] })
    expect(after.players.player.units[0].upgrades.map(u => u.cardId)).toEqual(['TOKEN_EXPERIENCE'])
  })
})

describe('discardPlayGrants: "for this phase, you may play that card from a discard pile"', () => {
  // A standing permission on the Play a Card action. It is not a pending choice: the player takes it
  // later, on a turn of their own, among their normal moves.
  const board = (grants: GameState['discardPlayGrants'], over: { discard?: string[]; oppDiscard?: string[] } = {}) => state({
    cards,
    players: {
      player: player({ discard: over.discard ?? ['DU'], resources: ready(10) }),
      opponent: player({ discard: over.oppDiscard ?? [] }),
    },
    discardPlayGrants: grants,
  })

  it('offers the granted card as a normal action-phase move', () => {
    const s = board([{ player: 'player', owner: 'player', cardId: 'DU', free: true }])
    expect(legalMoves(s).filter(m => m.type === 'playFromDiscard')).toHaveLength(1)
  })

  it('offers nothing without a grant, which is the whole point of the permission', () => {
    expect(legalMoves(board(undefined)).filter(m => m.type === 'playFromDiscard')).toHaveLength(0)
  })

  it('offers nothing for a card that is no longer in the pile', () => {
    const s = board([{ player: 'player', owner: 'player', cardId: 'DU', free: true }], { discard: [] })
    expect(legalMoves(s).filter(m => m.type === 'playFromDiscard')).toHaveLength(0)
  })

  it('plays the card through the same door, so it is a play in every sense', () => {
    const s = board([{ player: 'player', owner: 'player', cardId: 'DU', free: true }])
    const after = resolve(s, { type: 'playFromDiscard', grantIndex: 0 } as never)
    expect(after.players.player.units.map(u => u.cardId)).toEqual(['DU'])
    expect(after.players.player.discard).toEqual([])
    expect(cardsPlayedThisPhase(after, 'player')).toContain('DU')
  })

  it('charges the grant\'s terms rather than the card\'s full price', () => {
    const s = board([{ player: 'player', owner: 'player', cardId: 'DU', costDelta: -1 }])
    // DU is 3 + 2 aspect penalty = 5, less 1 = 4 (Boga's "costs 1 less").
    const after = resolve(s, { type: 'playFromDiscard', grantIndex: 0 } as never)
    expect(after.players.player.resources.filter(r => r.exhausted)).toHaveLength(4)
  })

  it('is not offered while the grant\'s terms are unaffordable', () => {
    const s = state({
      cards,
      players: { player: player({ discard: ['DU'], resources: ready(4) }), opponent: player() },
      discardPlayGrants: [{ player: 'player', owner: 'player', cardId: 'DU' }],
    })
    expect(legalMoves(s).filter(m => m.type === 'playFromDiscard')).toHaveLength(0)
  })

  it('is offered only to the player it was given to', () => {
    // Stolen AT-Hauler hands the permission to an opponent, over a pile that is not theirs.
    const s = board([{ player: 'opponent', owner: 'player', cardId: 'DU', free: true }])
    expect(legalMoves(s).filter(m => m.type === 'playFromDiscard')).toHaveLength(0)
    const theirTurn = { ...s, activePlayer: 'opponent' as PlayerId }
    expect(legalMoves(theirTurn).filter(m => m.type === 'playFromDiscard')).toHaveLength(1)
  })

  it('a card played on someone else\'s permission still belongs to the pile\'s owner', () => {
    const s = { ...board([{ player: 'opponent', owner: 'player', cardId: 'DU', free: true }]), activePlayer: 'opponent' as PlayerId }
    const after = resolve(s, { type: 'playFromDiscard', grantIndex: 0 } as never)
    expect(after.players.opponent.units[0].owner).toBe('player')
  })

  it('gives the played unit the grant\'s tokens (Tireless Magnaguard\'s 2 Weakness)', () => {
    // A Weakness token is −1/−1, so the unit has to be able to take two and live: Tireless
    // Magnaguard is 5/3, and a 2/2 would be defeated by its own arrival.
    const s = board([{ player: 'player', owner: 'player', cardId: 'TST_U4', free: true, tokens: ['TOKEN_WEAKNESS', 'TOKEN_WEAKNESS'] }], { discard: ['TST_U4'] })
    const after = resolve(s, { type: 'playFromDiscard', grantIndex: 0 } as never)
    expect(after.players.player.units[0].upgrades.filter(u => u.cardId === 'TOKEN_WEAKNESS')).toHaveLength(2)
  })

  it('a unit the grant\'s tokens would kill is defeated on arrival, not kept alive by the grant', () => {
    // 2/2 with two −1/−1 tokens is 0/0, and the state-based check defeats it like any other.
    const s = board([{ player: 'player', owner: 'player', cardId: 'DU', free: true, tokens: ['TOKEN_WEAKNESS', 'TOKEN_WEAKNESS'] }])
    const after = resolve(s, { type: 'playFromDiscard', grantIndex: 0 } as never)
    expect(after.players.player.units).toHaveLength(0)
    expect(after.players.player.discard).toContain('DU')
  })

  it('spends the grant, so one permission is not two plays', () => {
    const s = board([{ player: 'player', owner: 'player', cardId: 'DU', free: true }], { discard: ['DU', 'DU'] })
    const after = resolve(s, { type: 'playFromDiscard', grantIndex: 0 } as never)
    expect(after.discardPlayGrants).toBeUndefined()
    expect(legalMoves(after).filter(m => m.type === 'playFromDiscard')).toHaveLength(0)
  })

  it('does not survive into the next phase', () => {
    // "For this phase" — cleared as the regroup phase starts, like `bannedNames`.
    const s = { ...board([{ player: 'player', owner: 'player', cardId: 'DU', free: true }]), consecutivePasses: 1 }
    const regrouped = resolve(s, { type: 'pass' } as never)
    expect(regrouped.phase).toBe('regroup')
    expect(regrouped.discardPlayGrants).toBeUndefined()
  })

  it('an upgrade granted this way needs a host, and is offered once per legal host', () => {
    const s = state({
      cards,
      players: {
        player: player({ discard: ['DG'], resources: ready(10), units: [unit('u1', 'TST_U1'), unit('u2', 'TST_U2')] }),
        opponent: player(),
      },
      discardPlayGrants: [{ player: 'player', owner: 'player', cardId: 'DG', free: true }],
    })
    const moves = legalMoves(s).filter(m => m.type === 'playFromDiscard')
    expect(moves).toHaveLength(2)
    const after = resolve(s, { type: 'playFromDiscard', grantIndex: 0, targetInstanceId: 'u1' } as never)
    expect(after.players.player.units.find(u => u.instanceId === 'u1')!.upgrades.map(u => u.cardId)).toEqual(['DG'])
  })
})

describe('the two play-from-discard doors are one door', () => {
  it('mayPlayUnitFromDiscard is gone: nothing raises it and the engine does not know the kind', () => {
    // It was this ticket's own mechanic written a second time (unit-only, free, own pile), and the
    // cards that raised it (Dathomiri Magicks, One Must Destroy to Create) now raise `playCardFrom`.
    // A source guard rather than a behavioural one: the point is that the second door is not there
    // to drift away from the first, which no amount of asserting on states can show.
    const src = ['types.ts', 'resolve.ts', 'legalMoves.ts', 'cardDefinitions.ts']
      .map(f => readFileSync(join(process.cwd(), 'src/engine', f), 'utf8')).join('\n')
    expect(src).not.toContain('mayPlayUnitFromDiscard')
  })
})
