import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { discardCards, discardFromHand } from '../engine/effects'
import { discardedThisPhase, recordUnitDefeated } from '../engine/types'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PendingChoice, UnitState } from '../engine/types'

/**
 * Cards leaving a hand or a deck for the discard pile, and what reads that: the phase record of every
 * such discard, the trigger points it announces, and the "Action:" a few cards have while they sit in
 * the pile.
 */
const F: Record<string, EngineCard> = {
  ...CARDS,
  LAW_200: card({ id: 'LAW_200', name: 'Salvaged Blaster', type: 'upgrade', cost: 2, power: 2, hp: 0, traits: ['Item', 'Weapon'] }),
  SHD_038: card({ id: 'SHD_038', name: 'Brutal Traditions', type: 'upgrade', cost: 2, power: 2, hp: 0, traits: ['Learned'] }),
  SHD_135: card({ id: 'SHD_135', name: "Kylo's TIE Silencer", arena: 'space', cost: 2, power: 3, hp: 2, traits: ['First Order', 'Vehicle', 'Fighter'], unique: true }),
  LAW_076: card({ id: 'LAW_076', name: "Vult Skerris's Defender", arena: 'space', cost: 3, power: 3, hp: 3, traits: ['Imperial', 'Vehicle', 'Fighter'], unique: true }),
  LAW_179: card({ id: 'LAW_179', name: 'Fear and Dead Men', type: 'event', cost: 7, traits: ['Tactic'] }),
  LAW_206: card({ id: 'LAW_206', name: "That's a Rock", type: 'event', cost: 1, traits: ['Gambit'] }),
  LAW_176: card({ id: 'LAW_176', name: "Sebulba's Podracer", arena: 'ground', cost: 3, power: 3, hp: 3, traits: ['Vehicle', 'Speeder'], unique: true }),
  SHD_163: card({ id: 'SHD_163', name: 'Migs Mayfeld', arena: 'ground', cost: 2, power: 2, hp: 2, traits: ['Underworld'], unique: true }),
  ASH_123: card({ id: 'ASH_123', name: 'Lang', arena: 'ground', cost: 3, power: 3, hp: 3 }),
  LAW_192: card({ id: 'LAW_192', name: 'Bracca Shipbreaker', arena: 'ground', cost: 2, power: 2, hp: 3 }),
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  SPC: card({ id: 'SPC', arena: 'space', cost: 2, power: 2, hp: 6 }),
  VEH: card({ id: 'VEH', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['Vehicle'] }),
  EV: card({ id: 'EV', type: 'event', cost: 1 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}): GameState => state({
  cards: F,
  players: {
    player: player({ resources: ready(10), deck: [], ...mine }),
    opponent: player({ resources: ready(10), deck: [], ...theirs }),
  },
})
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? [], 'no choice is raised').toHaveLength(0)
const accept = (s: GameState, extra: { targetInstanceId?: string; baseTarget?: 'player' | 'opponent' } = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const discardMoves = (s: GameState) => legalMoves(s).filter((m): m is Extract<Action, { type: 'useDiscardAction' }> => m.type === 'useDiscardAction')
const spent = (s: GameState) => s.players.player.resources.filter(r => r.exhausted).length
/** Discard the player's whole hand, as an effect would. */
const discardHand = (s: GameState) => discardCards(s, 'player', 'hand', s.players.player.hand.map((_, i) => i))

describe('the discard record', () => {
  it('records a card discarded from a hand, and from a deck, with where it came from', () => {
    let s = board({ hand: ['EV', 'GRD'], deck: ['SPC', 'GRD'] })
    s = discardFromHand(s, 'player', 1)
    s = discardCards(s, 'player', 'deck', [0])
    expect(s.players.player.hand).toEqual(['EV'])
    expect(s.players.player.deck).toEqual(['GRD'])
    expect(s.players.player.discard).toEqual(['GRD', 'SPC'])
    expect(discardedThisPhase(s, 'player')).toEqual([{ cardId: 'GRD', from: 'hand' }, { cardId: 'SPC', from: 'deck' }])
    expect(discardedThisPhase(s, 'opponent')).toEqual([])
  })

  it('records a card a card ability mills off a deck (Bracca Shipbreaker)', () => {
    const s = resolve(board({ units: [unit('me', 'LAW_192')], deck: ['EV', 'GRD'] }), { type: 'attack', attackerId: 'me', target: { kind: 'base' } })
    expect(discardedThisPhase(s, 'player')).toEqual([{ cardId: 'EV', from: 'deck' }])
  })

  it('does not count a defeated unit, which reaches the pile without being discarded', () => {
    const s = recordUnitDefeated(board({ discard: ['SHD_135'] }), 'player', 'SHD_135')
    expect(discardedThisPhase(s, 'player')).toEqual([])
  })
})

describe('an "Action:" on a card in a discard pile', () => {
  it('offers nothing for a card whose action ability is not declared active from the pile (Lang)', () => {
    const s = discardHand(board({ hand: ['ASH_123'] }, { units: [unit('e', 'GRD')] }))
    expect(s.players.player.discard).toEqual(['ASH_123'])
    expect(legalMoves(s).filter(m => m.type === 'useAbility' || m.type === 'useDiscardAction')).toEqual([])
  })

  describe("Kylo's TIE Silencer (SHD_135)", () => {
    it('is offered only once discarded from hand or deck this phase', () => {
      expect(discardMoves(board({ discard: ['SHD_135'] })), 'defeated or there from an earlier phase').toEqual([])
      expect(discardMoves(discardHand(board({ hand: ['SHD_135'] })))).toEqual([{ type: 'useDiscardAction', discardIndex: 0 }])
      expect(discardMoves(discardCards(board({ deck: ['SHD_135'] }), 'player', 'deck', [0]))).toHaveLength(1)
    })

    it('is not offered to the opponent, nor while its cost cannot be paid', () => {
      const s = discardHand(board({ hand: ['SHD_135'] }))
      expect(discardMoves({ ...s, activePlayer: 'opponent' })).toEqual([])
      expect(discardMoves({ ...s, players: { ...s.players, player: { ...s.players.player, resources: ready(1) } } })).toEqual([])
    })

    it('plays it out of the pile, paying its cost, as the action for the turn', () => {
      const s = discardHand(board({ hand: ['SHD_135'] }))
      const after = resolve(s, { type: 'useDiscardAction', discardIndex: 0 })
      expect(after.players.player.discard).toEqual([])
      expect(after.players.player.units.map(u => u.cardId)).toEqual(['SHD_135'])
      expect(spent(after)).toBe(2)
      expect(after.activePlayer).toBe('opponent')
    })
  })

  describe('Salvaged Blaster (LAW_200)', () => {
    it('is offered once discarded this phase, one move per non-Vehicle unit it can attach to', () => {
      const base = board({ hand: ['LAW_200'], units: [unit('g', 'GRD'), unit('v', 'VEH')] }, { units: [unit('e', 'GRD')] })
      expect(discardMoves(board({ discard: ['LAW_200'], units: [unit('g', 'GRD')] }))).toEqual([])
      const moves = discardMoves(discardHand(base))
      expect(moves.map(m => m.targetInstanceId).sort()).toEqual(['e', 'g'])
    })

    it('attaches out of the pile, paying its cost', () => {
      const s = discardCards(board({ deck: ['LAW_200'], units: [unit('g', 'GRD')] }), 'player', 'deck', [0])
      const after = resolve(s, { type: 'useDiscardAction', discardIndex: 0, targetInstanceId: 'g' })
      expect(U(after, 'g')!.upgrades.map(a => a.cardId)).toEqual(['LAW_200'])
      expect(after.players.player.discard).toEqual([])
      expect(spent(after)).toBe(2)
    })
  })

  describe('Brutal Traditions (SHD_038)', () => {
    it('is offered only once an ENEMY unit was defeated this phase', () => {
      const s = board({ discard: ['SHD_038'], units: [unit('g', 'GRD')] })
      expect(discardMoves(s)).toEqual([])
      expect(discardMoves(recordUnitDefeated(s, 'player', 'GRD')), 'a friendly defeat').toEqual([])
      expect(discardMoves(recordUnitDefeated(s, 'opponent', 'GRD'))).toEqual([{ type: 'useDiscardAction', discardIndex: 0, targetInstanceId: 'g' }])
    })

    it('attaches out of the pile, paying its cost', () => {
      const s = recordUnitDefeated(board({ discard: ['GRD', 'SHD_038'], units: [unit('g', 'GRD')] }), 'opponent', 'GRD')
      const after = resolve(s, { type: 'useDiscardAction', discardIndex: 1, targetInstanceId: 'g' })
      expect(U(after, 'g')!.upgrades.map(a => a.cardId)).toEqual(['SHD_038'])
      expect(after.players.player.discard).toEqual(['GRD'])
      expect(spent(after)).toBe(2)
    })
  })
})

describe('cards that read the discard record', () => {
  it("Vult Skerris's Defender (LAW_076) gets a Shield on play only if you discarded a card this phase", () => {
    const play = (s: GameState) => resolve(s, { type: 'playUnit', handIndex: s.players.player.hand.indexOf('LAW_076') })
    const plain = play(board({ hand: ['LAW_076'] }))
    expect(plain.players.player.units[0].upgrades).toEqual([])
    const after = play(discardCards(board({ hand: ['LAW_076'], deck: ['EV'] }), 'player', 'deck', [0]))
    expect(after.players.player.units[0].upgrades.map(a => a.cardId)).toEqual([TOKEN_SHIELD])
  })

  it("Vult Skerris's Defender (LAW_076) may deal 1 damage to a space unit and exhaust it on attack", () => {
    const s = resolve(board({ units: [unit('me', 'LAW_076')] }, { units: [unit('sp', 'SPC'), unit('g', 'GRD')] }), { type: 'attack', attackerId: 'me', target: { kind: 'base' } })
    const after = accept(s, { targetInstanceId: 'sp' })
    expect([U(after, 'sp')!.damage, U(after, 'sp')!.exhausted]).toEqual([1, true])
    expect(U(after, 'g')!.damage).toBe(0)
  })

  it('Fear and Dead Men (LAW_179) costs 1 less for each card discarded from your hand this phase, not your deck', () => {
    const s = board({ hand: ['LAW_179', 'EV', 'EV'], deck: ['EV'] })
    const cost = (st: GameState) => effectiveCost(st, 'player', F.LAW_179)
    expect(cost(s)).toBe(7)
    const fromHand = discardCards(s, 'player', 'hand', [1, 2])
    expect(cost(fromHand)).toBe(5)
    expect(cost(discardCards(fromHand, 'player', 'deck', [0]))).toBe(5)
  })

  it('Fear and Dead Men (LAW_179) deals 4 damage to each enemy ground unit', () => {
    const s = resolve(board({ hand: ['LAW_179'], units: [unit('mine', 'GRD')] }, { units: [unit('e', 'GRD'), unit('sp', 'SPC')] }), { type: 'playEvent', handIndex: 0 })
    expect([U(s, 'e')!.damage, U(s, 'sp')!.damage, U(s, 'mine')!.damage]).toEqual([4, 0, 0])
  })
})

describe('discard trigger points', () => {
  it("That's a Rock (LAW_206) deals 1 damage to a unit when played", () => {
    const s = resolve(board({ hand: ['LAW_206'] }, { units: [unit('e', 'GRD')] }), { type: 'playEvent', handIndex: 0 })
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
  })

  it("That's a Rock (LAW_206) may deal 1 damage to a unit when discarded from your hand or deck, but not when played", () => {
    for (const s of [discardHand(board({ hand: ['LAW_206'] }, { units: [unit('e', 'GRD')] })), discardCards(board({ deck: ['LAW_206'] }, { units: [unit('e', 'GRD')] }), 'player', 'deck', [0])]) {
      const c = choice(s)
      expect('optional' in c && c.optional).toBe(true)
      expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
    }
    const played = resolve(board({ hand: ['LAW_206'] }, { units: [unit('e', 'GRD')] }), { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices).toHaveLength(1) // the play's own damage, nothing from reaching the pile
  })

  it("Sebulba's Podracer (LAW_176) may ready when you discard from your deck, once each round, and not from your hand", () => {
    const s = board({ units: [unit('pod', 'LAW_176', { exhausted: true })], hand: ['EV'], deck: ['EV', 'EV'] })
    noChoice(discardHand(s))
    const first = accept(discardCards(s, 'player', 'deck', [0]))
    expect(U(first, 'pod')!.exhausted).toBe(false)
    const exhaustedAgain = { ...first, players: { ...first.players, player: { ...first.players.player, units: first.players.player.units.map(u => ({ ...u, exhausted: true })) } } }
    noChoice(discardCards(exhaustedAgain, 'player', 'deck', [0]))
    noChoice(discardCards(board({ deck: ['EV'] }, { units: [unit('pod', 'LAW_176', { exhausted: true })] }), 'player', 'deck', [0]))
  })

  it('Migs Mayfeld (SHD_163) may deal 2 damage to a unit or base when either player discards from hand, once each round', () => {
    const s = board({ units: [unit('migs', 'SHD_163')], deck: ['EV'] }, { hand: ['EV', 'EV'], units: [unit('e', 'GRD')] })
    noChoice(discardCards(s, 'player', 'deck', [0]))
    const asked = discardCards(s, 'opponent', 'hand', [0])
    const dealt = accept(accept(asked), { targetInstanceId: 'e' })
    expect(U(dealt, 'e')!.damage).toBe(2)
    noChoice(discardCards(dealt, 'opponent', 'hand', [0]))
    const declined = resolve(asked, { type: 'skipTrigger', choiceId: choice(asked).id })
    expect(accept(discardCards(declined, 'opponent', 'hand', [0])).pendingChoices?.[0]?.kind, 'a declined use is not spent').toBe('selectDamageTarget')
  })
})
