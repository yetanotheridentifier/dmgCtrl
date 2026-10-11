import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { registerCard, unregisterAbility } from '../engine/abilities'
import { drawCards } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PlayerState, ResourceState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * The paying step on every door that pays a cost.
 *
 * Two things pay besides ready resources: a Credit token ("While paying resources, you may defeat
 * this token. If you do, pay 1 less.") and a unit that pays as a resource (Vuutun Palaa's Droids,
 * each exhausted to pay 1). Wherever a cost is paid, the player who holds either is asked first, in
 * one step, how many tokens to defeat and which units to exhaust: when resources fall short and when
 * they would cover the cost alike. A player who holds neither is never asked.
 *
 * Every door below is taken through the same cases, once paying with Credit tokens and once with
 * Droids, so a door that is left on the old path fails by name.
 */

const F: Record<string, EngineCard> = {
  ...CARDS,
  SOR_016: card({ id: 'SOR_016', name: 'Grand Admiral Thrawn', type: 'leader', cost: 6, power: 3, hp: 7 }),
  SEC_122: card({ id: 'SEC_122', name: 'Vuutun Palaa', arena: 'space', cost: 7, power: 6, hp: 10 }),
  DROID: card({ id: 'DROID', name: 'Battle Droid', arena: 'ground', cost: 1, traits: ['Droid'] }),
  HOST: card({ id: 'HOST', name: 'Host', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  SMUG: card({ id: 'SMUG', name: 'Smuggled Unit', arena: 'ground', cost: 9, power: 2, hp: 2, smuggle: { cost: 4, aspects: [] } }),
  PILED: card({ id: 'PILED', name: 'Piled Unit', arena: 'ground', cost: 3, power: 2, hp: 2 }),
  GEAR: card({ id: 'GEAR', name: 'Gear', type: 'upgrade', cost: 3, power: 1, hp: 1 }),
  TST_ACT: card({ id: 'TST_ACT', name: 'Actor', arena: 'ground', cost: 2, power: 1, hp: 5 }),
  TST_PAY: card({ id: 'TST_PAY', name: 'Payer', arena: 'ground', cost: 2, power: 1, hp: 5 }),
}

beforeAll(() => {
  registerCard('TST_ACT', { actionAbilities: [{ description: 'Action [C=2]: Draw a card.', cost: 2, effect: (s, ctx) => drawCards(s, ctx.owner, 1) }] })
  registerCard('TST_PAY', { ifYouDo: (s, ctx) => drawCards(s, ctx.owner, 1) })
})
afterAll(() => { for (const id of ['TST_ACT', 'TST_PAY']) unregisterAbility(id) })

type Means = 'credits' | 'droids'
interface Holding { resources: number; means?: Means; count?: number }

/** One door: what it costs, the board it needs, the move that takes it, and what shows it happened. */
interface Door {
  name: string
  cost: number
  /** The player's side of the board, given the ready resources the case allows. */
  side: (resources: ResourceState[]) => Partial<PlayerState>
  extra?: Partial<GameState>
  /** A move that leads to the door without paying anything, taken while setting the board up when it is offered. */
  lead?: (m: Action) => boolean
  move: (m: Action) => boolean
  happened: (s: GameState) => boolean
}

const has = (s: GameState, cardId: string) => s.players.player.units.some(u => u.cardId === cardId)

const DOORS: Door[] = [
  {
    name: 'a Smuggle play', cost: 4,
    // The smuggled card is a ready resource itself and counts towards its own cost (CR 14.e).
    side: resources => ({ resources: resources.length > 0 ? [{ cardId: 'SMUG', exhausted: false }, ...resources.slice(1)] : [{ cardId: 'SMUG', exhausted: true }] }),
    move: m => m.type === 'smuggle',
    happened: s => has(s, 'SMUG'),
  },
  {
    name: 'a play from a discard pile', cost: 3,
    side: resources => ({ resources, discard: ['PILED'] }),
    extra: { discardPlayGrants: [{ player: 'player', owner: 'player', cardId: 'PILED' }] },
    move: m => m.type === 'playFromDiscard',
    happened: s => has(s, 'PILED'),
  },
  {
    name: 'an upgrade attached through attachPlayedCard', cost: 3,
    side: resources => ({ resources, discard: ['GEAR'] }),
    // The upgrade is picked from the pile first, which pays nothing: the host it is priced against comes next.
    extra: { pendingChoices: [{ kind: 'playCardFrom', id: 'from', controller: 'player', zone: 'discard', candidates: [{ index: 0, cardId: 'GEAR' }] }] },
    lead: m => m.type === 'acceptChoice' && m.choiceId === 'from',
    move: m => m.type === 'acceptChoice' && m.choiceId === 'from-attach' && m.targetInstanceId === 'host',
    happened: s => s.players.player.units.some(u => u.upgrades.some(up => up.cardId === 'GEAR')),
  },
  {
    name: 'a unit action with a cost', cost: 2,
    side: resources => ({ resources }),
    move: m => m.type === 'useAbility' && m.cardId === 'TST_ACT',
    happened: s => s.players.player.hand.length === 1,
  },
  {
    name: 'a leader action with a cost (Grand Admiral Thrawn)', cost: 1,
    side: resources => ({ resources }),
    move: m => m.type === 'useLeaderAbility',
    happened: s => s.players.player.leader.exhausted,
  },
  {
    name: 'a mayPayThen', cost: 2,
    side: resources => ({ resources }),
    extra: { pendingChoices: [{ kind: 'mayPayThen', id: 'pay', controller: 'player', cost: 2, text: 'draw a card', then: { cardId: 'TST_PAY', owner: 'player' } }] },
    move: m => m.type === 'acceptChoice' && m.choiceId === 'pay',
    happened: s => s.players.player.hand.length === 1,
  },
]

/** The board for `door`, with the player holding what the case says. */
function board(door: Door, holding: Holding): GameState {
  const count = holding.count ?? 2
  const payers = holding.means === 'droids'
    ? [unit('ship', 'SEC_122', { arena: 'space' }), ...Array.from({ length: count }, (_, i) => unit(`droid${i}`, 'DROID'))]
    : []
  const s = state({
    cards: F,
    players: {
      player: player({
        leader: { cardId: 'SOR_016', deployed: false, epicActionUsed: false, exhausted: false },
        deck: ['TST_U1', 'TST_U1', 'TST_U1'],
        units: [unit('host', 'HOST'), unit('actor', 'TST_ACT'), ...payers],
        ...(holding.means === 'credits' ? { creditTokens: count } : {}),
        ...door.side(ready(holding.resources)),
      }),
      opponent: player({ deck: ['TST_U1', 'TST_U1'] }),
    },
    ...door.extra,
  })
  const lead = door.lead ? legalMoves(s).find(door.lead) : undefined
  return lead ? resolve(s, lead) : s
}

const offered = (s: GameState, door: Door): Action | undefined => legalMoves(s).find(door.move)
const take = (s: GameState, door: Door): GameState => {
  const move = offered(s, door)
  if (!move) throw new Error(`${door.name}: the move is not offered`)
  return resolve(s, move)
}
const step = (s: GameState): Extract<PendingChoice, { kind: 'payWith' }> | undefined =>
  s.pendingChoices?.find((c): c is Extract<PendingChoice, { kind: 'payWith' }> => c.kind === 'payWith')
const stepMoves = (s: GameState) => legalMoves(s).filter(m => (m.type === 'acceptChoice' || m.type === 'skipTrigger') && m.choiceId === step(s)?.id)
const doneMove = (s: GameState) => stepMoves(s).find(m => m.type === 'skipTrigger')
const pickMove = (s: GameState) => stepMoves(s).find(m => m.type === 'acceptChoice')
const pick = (s: GameState): GameState => {
  const move = pickMove(s)
  if (!move) throw new Error('nothing to pay with is on offer')
  return resolve(s, move)
}
const done = (s: GameState): GameState => {
  const move = doneMove(s)
  if (!move) throw new Error('Done is not on offer')
  return resolve(s, move)
}
const readyLeft = (s: GameState) => s.players.player.resources.filter(r => !r.exhausted).length
const credits = (s: GameState) => s.players.player.creditTokens ?? 0
const droidsExhausted = (s: GameState) => s.players.player.units.filter(u => u.cardId === 'DROID' && u.exhausted).length
const spent = (s: GameState, means: Means) => (means === 'credits' ? 2 - credits(s) : droidsExhausted(s))

for (const means of ['credits', 'droids'] as const) {
  describe(`paying with ${means}`, () => {
    for (const door of DOORS) {
      describe(door.name, () => {
        it('is offered when resources fall one short and the rest can be covered, and pays the rest that way', () => {
          const s = board(door, { resources: door.cost - 1, means })
          expect(offered(s, door)).toBeDefined()
          const asked = take(s, door)
          expect(step(asked)).toMatchObject({ controller: 'player', cost: door.cost })
          // Resources alone do not cover it, so the step cannot finish before something is picked.
          expect(doneMove(asked)).toBeUndefined()
          const picked = pick(asked)
          const end = step(picked) ? done(picked) : picked
          expect(step(end)).toBeUndefined()
          expect(door.happened(end)).toBe(true)
          expect(spent(end, means)).toBe(1)
          expect(readyLeft(end)).toBe(0)
        })

        it('asks before anything is paid, marked used or handed over, so backing out leaves nothing done', () => {
          const s = board(door, { resources: door.cost - 1, means })
          const asked = take(s, door)
          expect(step(asked)).toBeDefined()
          expect(asked.players).toEqual(s.players)
          expect(asked.activePlayer).toBe(s.activePlayer)
          expect(asked.discardPlayGrants).toEqual(s.discardPlayGrants)
          expect(door.happened(asked)).toBe(false)
          // The step is the only thing answerable while it stands.
          expect(legalMoves(asked)).toEqual(stepMoves(asked))
        })

        it('asks when ready resources alone would cover the cost, and Done pays with resources only', () => {
          const s = board(door, { resources: door.cost + 1, means })
          const asked = take(s, door)
          expect(step(asked)).toBeDefined()
          expect(doneMove(asked)).toBeDefined()
          const end = done(asked)
          expect(door.happened(end)).toBe(true)
          expect(spent(end, means)).toBe(0)
          expect(readyLeft(end)).toBe(1)
        })

        it('lets a token or a unit pay in place of a resource that was ready', () => {
          const s = board(door, { resources: door.cost + 1, means })
          const picked = pick(take(s, door))
          const end = step(picked) ? done(picked) : picked
          expect(door.happened(end)).toBe(true)
          expect(spent(end, means)).toBe(1)
          expect(readyLeft(end)).toBe(2)
        })

        it('is not offered when resources and everything that could pay still fall short', () => {
          const s = board(door, { resources: 0, means, count: door.cost - 1 })
          expect(offered(s, door)).toBeUndefined()
        })
      })
    }
  })
}

describe('a player with nothing to pay with but resources', () => {
  for (const door of DOORS) {
    it(`is never asked on ${door.name}`, () => {
      const s = board(door, { resources: door.cost })
      const end = take(s, door)
      expect(step(end)).toBeUndefined()
      expect(door.happened(end)).toBe(true)
      expect(readyLeft(end)).toBe(0)
    })

    it(`is not offered ${door.name} one resource short`, () => {
      expect(offered(board(door, { resources: door.cost - 1 }), door)).toBeUndefined()
    })
  }
})

describe("Grand Admiral Thrawn's action, paid with a Credit token", () => {
  it('is usable with no ready resource and one Credit token, and resolves once the token is defeated', () => {
    const thrawn = DOORS.find(d => d.name.includes('Thrawn'))!
    const s = board(thrawn, { resources: 0, means: 'credits', count: 1 })
    expect(legalMoves(s)).toContainEqual({ type: 'useLeaderAbility', index: 0 })
    const asked = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(step(asked)).toMatchObject({ cost: 1 })
    expect(asked.players.player.leader.exhausted).toBe(false)
    // The one token covers the whole cost, so picking it finishes the step.
    const end = pick(asked)
    expect(credits(end)).toBe(0)
    expect(end.players.player.leader.exhausted).toBe(true)
    expect(end.pendingChoices?.[0]).toMatchObject({ kind: 'choosePlayerThen', controller: 'player' })
  })
})

describe('the paying step itself', () => {
  const smuggle = DOORS[0]

  it('offers Credit tokens and paying units together, capped at the cost', () => {
    const base = board(smuggle, { resources: 1, means: 'droids' })
    const s = { ...base, players: { ...base.players, player: { ...base.players.player, creditTokens: 5 } } }
    const asked = take(s, smuggle)
    const picks = stepMoves(asked).filter(m => m.type === 'acceptChoice')
    expect(picks.filter(m => m.type === 'acceptChoice' && m.targetInstanceId !== undefined)).toHaveLength(2)
    expect(picks.filter(m => m.type === 'acceptChoice' && m.optionIndex !== undefined)).toHaveLength(1)
    // One Droid and then Credit tokens: the step finishes by itself once the whole cost is covered.
    let next = resolve(asked, { type: 'acceptChoice', choiceId: step(asked)!.id, targetInstanceId: 'droid0' })
    for (let i = 0; i < 3; i++) {
      expect(step(next)).toBeDefined()
      next = resolve(next, stepMoves(next).find(m => m.type === 'acceptChoice' && m.optionIndex !== undefined)!)
    }
    expect(step(next)).toBeUndefined()
    expect(has(next, 'SMUG')).toBe(true)
    expect(credits(next)).toBe(2)
    expect(droidsExhausted(next)).toBe(1)
    // The Smuggled card left the zone and its replacement came in exhausted: nothing was paid with resources.
    expect(next.players.player.resources.filter(r => r.exhausted)).toHaveLength(1)
  })

  it('keeps the Credit tokens until the step finishes', () => {
    const asked = pick(take(board(smuggle, { resources: 4, means: 'credits' }), smuggle))
    expect(step(asked)).toMatchObject({ credits: 1 })
    expect(credits(asked)).toBe(2)
    expect(credits(done(asked))).toBe(1)
  })

  it('does not let a unit pay for its own action', () => {
    registerCard('DROID', { actionAbilities: [{ description: 'Action [C=1, Exhaust]: Draw a card.', cost: 1, exhaustCost: true, effect: (s, ctx) => drawCards(s, ctx.owner, 1) }] })
    try {
      const own = (m: Action) => m.type === 'useAbility' && m.instanceId === 'droid0'
      const alone = board(smuggle, { resources: 0, means: 'droids', count: 1 })
      expect(legalMoves(alone).find(own)).toBeUndefined()
      const two = board(smuggle, { resources: 0, means: 'droids', count: 2 })
      const asked = resolve(two, legalMoves(two).find(own)!)
      expect(stepMoves(asked)).toEqual([{ type: 'acceptChoice', choiceId: step(asked)!.id, targetInstanceId: 'droid1' }])
    } finally {
      unregisterAbility('DROID')
    }
  })

  it('leaves a state that survives serialisation, with nothing transient in it', () => {
    const asked = take(board(smuggle, { resources: 3, means: 'credits' }), smuggle)
    expect(JSON.parse(JSON.stringify(asked))).toEqual(asked)
    expect(step(asked)!.resume).toEqual({ type: 'smuggle', resourceIndex: 0 })
    const end = pick(asked)
    expect('paying' in asked).toBe(false)
    expect('paying' in end).toBe(false)
    expect('paying' in done(end)).toBe(false)
  })

  it("does not offer an opponent's suppressed Credit tokens", () => {
    // "Enemy Credit tokens lose all abilities" (Conveyex Security Captain): they cannot pay anywhere.
    const base = board(smuggle, { resources: 4, means: 'credits' })
    const captain = card({ id: 'LAW_117', name: 'Conveyex Security Captain', arena: 'ground', cost: 3 })
    const s: GameState = {
      ...base, cards: { ...F, LAW_117: captain },
      players: { ...base.players, opponent: { ...base.players.opponent, units: [unit('captain', 'LAW_117')] } },
    }
    const end = take(s, smuggle)
    expect(step(end)).toBeUndefined()
    expect(has(end, 'SMUG')).toBe(true)
    expect(credits(end)).toBe(2)
    // And they do not make a play affordable.
    const short = { ...s, players: { ...s.players, player: { ...s.players.player, ...smuggle.side(ready(3)) } } }
    expect(offered(short, smuggle)).toBeUndefined()
  })
})
