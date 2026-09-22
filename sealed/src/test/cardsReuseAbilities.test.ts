import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * Borrowing another card's "When Played" abilities.
 *
 * Both cards here put an ability printed on ONE card on to ANOTHER unit: the borrowed ability resolves
 * with the borrower as its source, so "this unit" in the borrowed text means the borrower. Vernestra
 * Rwoh names her cards as an additional cost to play her, in the discard pile; Fives names one unit in
 * play as he arrives.
 */

const POOL = poolFor(['HMW', 'ASH', 'TS26'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const F: Record<string, EngineCard> = {
  ...CARDS,
  HMW_048: real('HMW_048'), // Vernestra Rwoh
  TS26_34: real('TS26_34'), // Fives
  ASH_251: real('ASH_251'), // Zealous Soldier, cost 2: When Played, give an Advantage token to this unit
  ASH_218: real('ASH_218'), // Ferry Droid, cost 3: When Played, give 4 Advantage tokens to this unit
  ASH_178: real('ASH_178'), // Knobby White Ice Spider, cost 7: too dear for Vernestra's cost
  ASH_067: real('ASH_067'), // Get Lost, cost 4: an EVENT, so never one of her picks
}

const choice = (s: GameState): PendingChoice => {
  const c = s.pendingChoices?.[0]
  if (!c) throw new Error('no pending choice')
  return c
}
const noChoice = (s: GameState): boolean => (s.pendingChoices?.length ?? 0) === 0
const answers = (s: GameState) => legalMoves(s).filter(m => m.type === 'acceptChoice' || m.type === 'skipTrigger') as Action[]
const options = (s: GameState): number[] => answers(s).flatMap(m => (m.type === 'acceptChoice' && m.optionIndex !== undefined ? [m.optionIndex] : []))
const targets = (s: GameState): string[] => answers(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : []))
const canFinish = (s: GameState) => answers(s).some(m => m.type === 'skipTrigger')
const take = (s: GameState, optionIndex: number) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, optionIndex })
const takeUnit = (s: GameState, targetInstanceId: string) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, targetInstanceId })
const done = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const inPlay = (s: GameState, cardId: string) => s.players.player.units.find(u => u.cardId === cardId)
const advantage = (s: GameState, cardId: string) => inPlay(s, cardId)?.upgrades.filter(u => u.cardId === TOKEN_ADVANTAGE).length ?? 0

// ── HMW_048 Vernestra Rwoh ──────────────────────────────────────────────────

/**
 * "As an additional cost to play this unit, put up to 2 units that each cost 5 or less from your
 * discard pile on the bottom of your deck. This unit gains those units' 'When Played' abilities for
 * this phase."
 */
const vernestra = (discard: string[], units: string[] = []): GameState => state({
  cards: F,
  players: {
    player: player({ resources: ready(12), hand: ['HMW_048'], deck: ['TST_U1'], discard, units: units.map((c, i) => unit(`f${i}`, c)) }),
    opponent: player({ resources: ready(5), deck: [], units: [unit('e0', 'TST_U1')] }),
  },
})

describe('Vernestra Rwoh: the additional cost', () => {
  it('asks for the discard picks before anything is paid', () => {
    const s = resolve(vernestra(['ASH_251', 'ASH_218']), { type: 'playUnit', handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'exploit', controller: 'player', cardId: 'HMW_048', fromDiscard: true, limit: 2, discount: 0, picks: [] })
    // Nothing has happened yet: she is still in hand, every resource is ready, the discard is intact.
    expect(s.players.player.hand).toEqual(['HMW_048'])
    expect(s.players.player.resources.every(r => !r.exhausted)).toBe(true)
    expect(s.players.player.discard).toEqual(['ASH_251', 'ASH_218'])
    // "up to 2": the step may be finished with nothing picked.
    expect(canFinish(s)).toBe(true)
  })

  it('offers only unit cards that cost 5 or less, by their place in the discard pile', () => {
    const s = resolve(vernestra(['ASH_251', 'ASH_178', 'ASH_067', 'ASH_218']), { type: 'playUnit', handIndex: 0 })
    expect(options(s)).toEqual([0, 3]) // the cost-7 unit and the event are not hers to take
  })

  it('caps the step at 2 even with more to choose from, and does not re-offer a pick', () => {
    let s = resolve(vernestra(['ASH_251', 'ASH_218', 'ASH_251']), { type: 'playUnit', handIndex: 0 })
    expect(choice(s)).toMatchObject({ limit: 2 })
    expect(options(s)).toEqual([0, 1, 2])
    s = take(s, 0)
    expect(options(s)).toEqual([1, 2])
  })

  it('raises no step at all when the discard holds nothing she may take', () => {
    const s = resolve(vernestra(['ASH_178', 'ASH_067']), { type: 'playUnit', handIndex: 0 })
    expect(noChoice(s)).toBe(true)
    expect(inPlay(s, 'HMW_048')).toBeDefined()
  })
})

describe('Vernestra Rwoh: what the picks do', () => {
  it('puts the chosen cards on the bottom of the deck and gains their When Played abilities', () => {
    let s = resolve(vernestra(['ASH_251', 'ASH_218']), { type: 'playUnit', handIndex: 0 })
    s = take(s, 0)
    s = take(s, 1) // the second pick reaches the limit, so the play finishes by itself
    expect(s.players.player.discard).toEqual([])
    // Bottom of the deck, in the order they were picked; the deck's own card stays on top.
    expect(s.players.player.deck).toEqual(['TST_U1', 'ASH_251', 'ASH_218'])
    // Both abilities triggered off the same event (her arrival), so she is asked which goes first.
    expect(choice(s)).toMatchObject({ kind: 'chooseNextTrigger' })
    const order = choice(s) as Extract<PendingChoice, { kind: 'chooseNextTrigger' }>
    expect(order.candidates.map(c => c.cardId).sort()).toEqual(['ASH_218', 'ASH_251'])
    // Each is sourced at Vernestra, so "this unit" means her.
    expect(order.candidates.every(c => c.sourceInstanceId === inPlay(s, 'HMW_048')?.instanceId)).toBe(true)
    s = take(s, 0)
    // Both resolved as hers: 1 + 4 Advantage tokens on Vernestra, none anywhere else.
    expect(advantage(s, 'HMW_048')).toBe(5)
    expect(noChoice(s)).toBe(true)
  })

  it('takes fewer than 2 when the player stops early', () => {
    let s = resolve(vernestra(['ASH_251', 'ASH_218']), { type: 'playUnit', handIndex: 0 })
    s = take(s, 0)
    s = done(s)
    expect(s.players.player.discard).toEqual(['ASH_218'])
    expect(s.players.player.deck).toEqual(['TST_U1', 'ASH_251'])
    expect(advantage(s, 'HMW_048')).toBe(1)
  })

  it('takes none, and gains nothing, when the step is finished straight away', () => {
    let s = resolve(vernestra(['ASH_251', 'ASH_218']), { type: 'playUnit', handIndex: 0 })
    s = done(s)
    expect(s.players.player.discard).toEqual(['ASH_251', 'ASH_218'])
    expect(s.players.player.deck).toEqual(['TST_U1'])
    expect(inPlay(s, 'HMW_048')).toBeDefined()
    expect(advantage(s, 'HMW_048')).toBe(0)
  })

  it('charges the same with picks as without: they are a cost, not a discount', () => {
    const spent = (s: GameState) => 12 - s.players.player.resources.filter(r => !r.exhausted).length
    let took = resolve(vernestra(['ASH_251', 'ASH_218']), { type: 'playUnit', handIndex: 0 })
    took = take(take(took, 0), 1)
    let none = resolve(vernestra(['ASH_251', 'ASH_218']), { type: 'playUnit', handIndex: 0 })
    none = done(none)
    expect(spent(took)).toBe(spent(none))
    // Her cost 6 plus the fixture's 2 for the Cunning aspect she does not match.
    expect(spent(none)).toBe(8)
  })
})

// ── TS26_34 Fives ───────────────────────────────────────────────────────────

/** "You may have this unit enter play with the 'When Played' abilities of another unit in play." */
const fives = (friendly: string[], enemy: string[] = []): GameState => state({
  cards: F,
  players: {
    player: player({ resources: ready(12), hand: ['TS26_34'], deck: ['TST_U1'], units: friendly.map((c, i) => unit(`f${i}`, c)) }),
    opponent: player({ resources: ready(5), deck: [], units: enemy.map((c, i) => unit(`e${i}`, c)) }),
  },
})

describe('Fives: borrowing a unit in play', () => {
  it('offers every other unit in play that has a When Played ability, on either side', () => {
    const s = resolve(fives(['ASH_251', 'TST_U1'], ['ASH_218']), { type: 'playUnit', handIndex: 0 })
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', controller: 'player' })
    expect(targets(s).sort()).toEqual(['e0', 'f0']) // not TST_U1 (no ability) and not Fives himself
  })

  it('resolves the borrowed ability as his own', () => {
    let s = resolve(fives(['ASH_218']), { type: 'playUnit', handIndex: 0 })
    s = takeUnit(s, 'f0')
    expect(advantage(s, 'TS26_34')).toBe(4)
    // The unit it was borrowed from is untouched: the ability ran with Fives as its source.
    expect(s.players.player.units.find(u => u.instanceId === 'f0')?.upgrades ?? []).toEqual([])
  })

  it('is optional', () => {
    let s = resolve(fives(['ASH_218']), { type: 'playUnit', handIndex: 0 })
    expect(canFinish(s)).toBe(true)
    s = done(s)
    expect(inPlay(s, 'TS26_34')).toBeDefined()
    expect(advantage(s, 'TS26_34')).toBe(0)
  })

  it('asks nothing when no other unit in play has a When Played ability', () => {
    const s = resolve(fives(['TST_U1']), { type: 'playUnit', handIndex: 0 })
    expect(noChoice(s)).toBe(true)
    expect(inPlay(s, 'TS26_34')).toBeDefined()
  })
})
