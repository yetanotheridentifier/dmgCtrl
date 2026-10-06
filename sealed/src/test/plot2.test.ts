import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { getCardDefinition } from '../engine/abilities'
import { effectivePower } from '../engine/stats'
import { dealDamageToUnit } from '../engine/combat'
import { unitHasKeyword } from '../engine/keywords'
import { poolFor } from '../bench/setPools'
import { IMPLEMENTED_LEADERS } from '../data/implementedCards'
import '../engine/cardDefinitions'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { EngineCard, GameState, LeaderState, PendingChoice } from '../engine/types'

/**
 * The four SEC Plot cards that each need a piece of engine Plot itself does not touch: Sly Moore's
 * phase-long "-2/-0 while attacking a base" on every enemy unit, Vigil's two constant damage
 * replacements, Fully Armed and Operational's "during their previous action", and Chancellor
 * Palpatine's back ("the next card you play using Plot this phase costs 3 less").
 */

const POOL = poolFor(['SEC'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the SEC fixture`)
  return normaliseCard(row)
}
const undeployed = (cardId: string): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)

describe('Sly Moore (SEC_033): for this phase, each enemy unit gets -2/-0 while it is attacking a base', () => {
  const F = { ...CARDS, SEC_033: real('SEC_033') }
  const played = () => resolve(state({
    cards: F,
    players: {
      player: player({ hand: ['SEC_033'], resources: ready(15), units: [unit('mine', 'TST_U1')] }),
      opponent: player({ units: [unit('e1', 'TST_U1'), unit('e2', 'TST_U3')] }),
    },
  }), { type: 'playUnit', handIndex: 0 })

  it('is registered with Plot printed', () => {
    expect(real('SEC_033').keywords.some(k => k.name === 'Plot')).toBe(true)
    expect(getCardDefinition('SEC_033')).toBeDefined()
  })

  it('gives each enemy unit -2 power while attacking a base, and nothing otherwise', () => {
    const s = played()
    const e1 = U(s, 'e1')!
    expect(effectivePower(s, e1, { attacking: true, attackingBase: true })).toBe(1)
    expect(effectivePower(s, e1, { attacking: true, attackingBase: false })).toBe(3)
    expect(effectivePower(s, e1)).toBe(3)
    expect(effectivePower(s, U(s, 'e2')!, { attacking: true, attackingBase: true })).toBe(3)
  })

  it('leaves friendly units alone', () => {
    const s = played()
    expect(effectivePower(s, U(s, 'mine')!, { attacking: true, attackingBase: true })).toBe(3)
  })

  it('shrinks the damage an enemy attack deals to the base', () => {
    const s = { ...played(), activePlayer: 'opponent' as const }
    const swung = resolve(s, { type: 'attack', attackerId: 'e1', target: { kind: 'base' } })
    expect(swung.players.player.base.damage).toBe(1)
  })

  it('does not reach an enemy unit that enters play afterwards ("each" means the units in play now)', () => {
    const s = played()
    const later = { ...s, players: { ...s.players, opponent: { ...s.players.opponent, units: [...s.players.opponent.units, unit('late', 'TST_U1')] } } }
    expect(effectivePower(later, U(later, 'late')!, { attacking: true, attackingBase: true })).toBe(3)
  })
})

describe('Vigil (SEC_050): prevents 1 of damage to each other friendly unit; takes that much plus 1 from another card', () => {
  const F = { ...CARDS, SEC_050: real('SEC_050') }
  const board = (over: { mine?: ReturnType<typeof unit>[]; theirs?: ReturnType<typeof unit>[] } = {}) => state({
    cards: F,
    players: {
      player: player({ units: [unit('vigil', 'SEC_050', { arena: 'space' }), ...(over.mine ?? [unit('friend', 'TST_U4')])] }),
      opponent: player({ units: over.theirs ?? [unit('foe', 'TST_U4')] }),
    },
  })
  const src = { cardId: 'TST_U1', controller: 'opponent' as const }

  it('is registered with Plot printed', () => {
    expect(real('SEC_050').keywords.some(k => k.name === 'Plot')).toBe(true)
    expect(getCardDefinition('SEC_050')).toBeDefined()
  })

  it('prevents 1 of ability damage to another friendly unit', () => {
    expect(U(dealDamageToUnit(board(), 'friend', 3, src), 'friend')!.damage).toBe(2)
  })

  it('prevents 1 of combat damage to another friendly unit', () => {
    const s = { ...board({ theirs: [unit('foe', 'TST_U1')] }), activePlayer: 'opponent' as const }
    const swung = resolve(s, { type: 'attack', attackerId: 'foe', target: { kind: 'unit', instanceId: 'friend' } })
    expect(U(swung, 'friend')!.damage).toBe(2)
  })

  it('does not protect an enemy unit', () => {
    expect(U(dealDamageToUnit(board(), 'foe', 3, { cardId: 'TST_U1', controller: 'player' }), 'foe')!.damage).toBe(3)
  })

  it('deals that much plus 1 to Vigil itself when another card deals it damage', () => {
    expect(U(dealDamageToUnit(board(), 'vigil', 2, src), 'vigil')!.damage).toBe(3)
  })

  it('adds 1 to combat damage dealt to Vigil', () => {
    const s = { ...board({ theirs: [unit('foe', 'TST_U2')] }), activePlayer: 'opponent' as const }
    const swung = resolve(s, { type: 'attack', attackerId: 'foe', target: { kind: 'unit', instanceId: 'vigil' } })
    expect(U(swung, 'vigil')!.damage).toBe(3)
  })

  it('adds nothing when a Shield prevents the damage', () => {
    const s = board({ mine: [] })
    const shielded = { ...s, players: { ...s.players, player: { ...s.players.player, units: [unit('vigil', 'SEC_050', { arena: 'space', upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })] } } }
    expect(U(dealDamageToUnit(shielded, 'vigil', 2, src), 'vigil')!.damage).toBe(0)
  })
})

describe('Fully Armed and Operational (SEC_194): if an opponent attacked your base during their previous action this phase, play a unit from your hand with Ambush', () => {
  const F = { ...CARDS, SEC_194: real('SEC_194') }
  const board = () => state({
    cards: F,
    activePlayer: 'opponent',
    players: {
      player: player({ hand: ['SEC_194', 'TST_U1', 'TST_U2'], resources: ready(15) }),
      opponent: player({ hand: ['TST_U2'], resources: ready(15), units: [unit('foe', 'TST_U4'), unit('foe2', 'TST_U4')] }),
    },
  })
  const playFaao = (s: GameState) => resolve(s, { type: 'playEvent', handIndex: s.players.player.hand.indexOf('SEC_194') })
  const playChoice = (s: GameState) => s.pendingChoices?.find((c): c is Extract<PendingChoice, { kind: 'playUnitFromHand' }> => c.kind === 'playUnitFromHand')

  it('is registered with Plot printed', () => {
    expect(real('SEC_194').keywords.some(k => k.name === 'Plot')).toBe(true)
    expect(getCardDefinition('SEC_194')).toBeDefined()
  })

  it('plays a unit from hand with Ambush when the opponent\'s previous action attacked your base', () => {
    const attacked = resolve(board(), { type: 'attack', attackerId: 'foe', target: { kind: 'base' } })
    expect(attacked.activePlayer).toBe('player')
    const played = playFaao(attacked)
    const choice = playChoice(played)
    expect(choice).toBeDefined()
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice!.id, handIndex: played.players.player.hand.indexOf('TST_U1') })
    const entered = done.players.player.units.find(u => u.cardId === 'TST_U1')
    expect(entered).toBeDefined()
    expect(unitHasKeyword(done, entered!, 'Ambush')).toBe(true)
  })

  it('does nothing when the opponent attacked your base earlier but took another action since', () => {
    let s = resolve(board(), { type: 'attack', attackerId: 'foe', target: { kind: 'base' } })
    s = resolve(s, { type: 'playUnit', handIndex: s.players.player.hand.indexOf('TST_U2') })
    s = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(s.activePlayer).toBe('player')
    expect(playChoice(playFaao(s))).toBeUndefined()
  })

  it('does nothing when the opponent\'s previous action attacked a unit, not your base', () => {
    const s0 = board()
    const withTarget = { ...s0, players: { ...s0.players, player: { ...s0.players.player, units: [unit('mine', 'TST_U4')] } } }
    const attacked = resolve(withTarget, { type: 'attack', attackerId: 'foe', target: { kind: 'unit', instanceId: 'mine' } })
    expect(playChoice(playFaao(attacked))).toBeUndefined()
  })

  it('does nothing when no base attack happened this phase', () => {
    expect(playChoice(playFaao({ ...board(), activePlayer: 'player' }))).toBeUndefined()
  })
})

describe('Chancellor Palpatine, back (SEC_001): When Deployed, the next card you play using Plot this phase costs 3 less', () => {
  const F = {
    ...CARDS,
    SEC_001: real('SEC_001'),
    BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 9, power: 2, hp: 2, keywords: [{ name: 'Plot' }] }),
    SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 3, power: 1, hp: 1, keywords: [{ name: 'Plot' }] }),
  }
  const plotChoice = (s: GameState) => s.pendingChoices?.find((c): c is Extract<PendingChoice, { kind: 'playCardFrom' }> => c.kind === 'playCardFrom')
  const board = (resources: { cardId: string; exhausted: boolean }[], over: Parameters<typeof player>[0] = {}) => state({
    cards: F,
    players: { player: player({ leader: undeployed('SEC_001'), resources, deck: ['TST_U1', 'TST_U1'], ...over }), opponent: player() },
  })
  const readyLeft = (s: GameState) => s.players.player.resources.filter(r => !r.exhausted).length

  it('is listed as built on both sides', () => {
    expect(getCardDefinition('SEC_001')?.abilities?.some(a => a.trigger === 'whenDeployed')).toBe(true)
    expect(IMPLEMENTED_LEADERS.find(l => l.id === 'SEC_001')).toMatchObject({ front: true, back: true })
  })

  it('offers a Plot card only the discount makes affordable, and charges 3 less', () => {
    // BIG costs 9 (plus aspect penalties none: no aspects); 7 ready resources, BIG among them.
    const s = board([{ cardId: 'BIG', exhausted: false }, ...ready(6)])
    const raised = resolve(s, { type: 'deployLeader' })
    const choice = plotChoice(raised)
    expect(choice?.candidates).toContainEqual({ index: 0, cardId: 'BIG' })
    const done = resolve(raised, { type: 'acceptChoice', choiceId: choice!.id, optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'BIG')).toBe(true)
    // 6 paid out of 7 ready (BIG itself among them), then the replacement arrives exhausted.
    expect(readyLeft(done)).toBe(1)
  })

  it('is spent by the first Plot play: the next one pays full cost', () => {
    const s = board([{ cardId: 'SMALL', exhausted: false }, { cardId: 'SMALL', exhausted: false }, ...ready(8)])
    const raised = resolve(s, { type: 'deployLeader' })
    const first = resolve(raised, { type: 'acceptChoice', choiceId: plotChoice(raised)!.id, optionIndex: 0 })
    expect(readyLeft(first)).toBe(10 - 0 - 1) // SMALL cost 0 after the discount; it left the zone
    const again = plotChoice(first)!
    const second = resolve(first, { type: 'acceptChoice', choiceId: again.id, optionIndex: 0 })
    expect(second.players.player.units.filter(u => u.cardId === 'SMALL')).toHaveLength(2)
    // The second pays its full 3, itself among the resources spent.
    expect(readyLeft(second)).toBe(9 - 3)
  })

  it('does not discount a Plot card played from hand', () => {
    const s = board(ready(10), { hand: ['SMALL'] })
    const deployed = resolve(s, { type: 'deployLeader' })
    const cleared = deployed.pendingChoices?.length ? resolve(deployed, { type: 'skipTrigger', choiceId: deployed.pendingChoices[0].id }) : deployed
    const mine = { ...cleared, activePlayer: 'player' as const }
    const played = resolve(mine, { type: 'playUnit', handIndex: 0 })
    expect(readyLeft(played)).toBe(10 - 3)
  })

  it('is offered when the leader deploys through legal moves', () => {
    const s = board([{ cardId: 'BIG', exhausted: false }, ...ready(6)])
    expect(legalMoves(s).some(m => m.type === 'deployLeader')).toBe(true)
  })
})
