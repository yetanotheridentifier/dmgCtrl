import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit, dealDamageToUnit } from '../engine/combat'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { getCardDefinition } from '../engine/abilities'
import { recordCardPlayed } from '../engine/types'
import { IMPLEMENTED_LEADERS } from '../data/implementedCards'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword, unitKeywordValue } from '../engine/keywords'
import { TOKEN_CLONE_TROOPER } from '../engine/tokenUnits'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, LeaderState, PlayerId, UnitState } from '../engine/types'

/**
 * Coordinate: "Gain this ability while you control 3 or more units." A live, continuously
 * checked board-state condition (`hasCoordinate`/`unitHasCoordinate` in cardDefinitions.ts) — the
 * same treatment as every other conditional keyword/stat grant (`conditionalKeywords`/
 * `statModifier`/`aura`): it can turn on and off mid-round as units enter or leave play, and every
 * read settles it fresh rather than caching it. A triggered Coordinate ability (On Attack, "when an
 * opponent plays") is gated where the event happens (`hears`), so a unit without it never triggers.
 *
 * Every TWI card carrying the keyword is covered here, the two leaders on both sides.
 */

const POOL = poolFor(['TWI'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the TWI fixture`)
  return normaliseCard(row)
}
const SHIPPED = [
  'TWI_240', 'TWI_045', 'TWI_114', 'TWI_205', 'TWI_158', 'TWI_106', 'TWI_090', 'TWI_164', 'TWI_061',
  'TWI_050', 'TWI_095', 'TWI_196', 'TWI_162', 'TWI_243', 'TWI_213',
  'TWI_096', 'TWI_064', 'TWI_011', 'TWI_008', 'TWI_147', 'TWI_165', 'TWI_192', 'TWI_051',
]
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  FILLER: card({ id: 'FILLER', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  FILLER_SP: card({ id: 'FILLER_SP', arena: 'space', cost: 1, power: 1, hp: 5 }),
  ENEMY: card({ id: 'ENEMY', arena: 'ground', cost: 3, power: 3, hp: 3 }),
  ENEMY_SP: card({ id: 'ENEMY_SP', arena: 'space', cost: 3, power: 3, hp: 6 }),
  ENEMY_CHEAP: card({ id: 'ENEMY_CHEAP', arena: 'space', cost: 2, power: 2, hp: 2 }),
  ENEMY_PRICEY: card({ id: 'ENEMY_PRICEY', arena: 'space', cost: 5, power: 4, hp: 6 }),
  ENEMY_BIG: card({ id: 'ENEMY_BIG', arena: 'ground', cost: 5, power: 4, hp: 20 }),
  REPUBLIC: card({ id: 'REPUBLIC', arena: 'ground', cost: 1, power: 1, hp: 1, traits: ['REPUBLIC'] }),
  REP_EV: card({ id: 'REP_EV', type: 'event', cost: 1, traits: ['REPUBLIC'] }),
  EV: card({ id: 'EV', type: 'event', cost: 1 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), deck: [], ...over })
const board = (mine: Parameters<typeof player>[0] = {}, theirs: Parameters<typeof player>[0] = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const choice = (s: GameState) => { expect(s.pendingChoices?.length ?? 0).toBeGreaterThan(0); return s.pendingChoices![0] }
type Extra = { targetInstanceId?: string; optionIndex?: number; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })

describe('Coordinate stat buffs (statModifier)', () => {
  it.each([
    ['TWI_240', 1, 1],
    ['TWI_045', 0, 3],
    ['TWI_158', 2, 0],
    ['TWI_090', 2, 2],
  ] as const)('%s: +%i/+%i while you control 3 or more units, printed otherwise', (id, dp, dh) => {
    const printed = F[id]
    const below = board({ units: [unit('c', id), unit('f1', 'FILLER')] }) // 2 units total
    expect(effectivePower(below, U(below, 'c')!)).toBe(printed.power)
    expect(effectiveHp(below, U(below, 'c')!)).toBe(printed.hp)

    const at3 = board({ units: [unit('c', id), unit('f1', 'FILLER'), unit('f2', 'FILLER')] }) // 3 units
    expect(effectivePower(at3, U(at3, 'c')!)).toBe(printed.power! + dp)
    expect(effectiveHp(at3, U(at3, 'c')!)).toBe(printed.hp! + dh)
  })

  it('turns off immediately when a unit is defeated mid-round, not just at the next phase change', () => {
    let s = board({ units: [unit('c', 'TWI_240'), unit('f1', 'FILLER'), unit('f2', 'FILLER')] })
    expect(effectivePower(s, U(s, 'c')!)).toBe(F.TWI_240.power! + 1)
    s = defeatUnit(s, 'f1')
    expect(effectivePower(s, U(s, 'c')!)).toBe(F.TWI_240.power) // back to 2 units: printed value
  })
})

describe('Coordinate self-keyword grants (conditionalKeywords)', () => {
  it.each([
    ['TWI_106', 'Ambush'],
    ['TWI_061', 'Sentinel'],
    ['TWI_243', 'Saboteur'],
  ] as const)('%s: gains %s only at 3+ units; the printed Keywords[] carries it as conditional, not real', (id, kw) => {
    const below = board({ units: [unit('c', id), unit('f1', 'FILLER')] })
    expect(unitHasKeyword(below, U(below, 'c')!, kw)).toBe(false)
    const at3 = board({ units: [unit('c', id), unit('f1', 'FILLER'), unit('f2', 'FILLER')] })
    expect(unitHasKeyword(at3, U(at3, 'c')!, kw)).toBe(true)
  })
})

describe('TWI_164 Hevy — Coordinate: Raid 2; When Defeated: 1 damage to each enemy ground unit (unconditional)', () => {
  it('Raid only applies at 3+ units', () => {
    const below = board({ units: [unit('c', 'TWI_164'), unit('f1', 'FILLER')] })
    expect(unitKeywordValue(below, U(below, 'c')!, 'Raid')).toBe(0)
    const at3 = board({ units: [unit('c', 'TWI_164'), unit('f1', 'FILLER'), unit('f2', 'FILLER')] })
    expect(unitKeywordValue(at3, U(at3, 'c')!, 'Raid')).toBe(2)
  })

  it('When Defeated fires regardless of Coordinate, hitting only enemy ground units', () => {
    const s = board({ units: [unit('c', 'TWI_164')] }, { units: [unit('eg', 'ENEMY'), unit('es', 'ENEMY_SP')] })
    const after = defeatUnit(s, 'c')
    expect(U(after, 'eg')?.damage).toBe(1)
    expect(U(after, 'es')?.damage).toBe(0)
  })
})

describe('TWI_050 Luminara Unduli — Coordinate: Grit; When Played: heal 1 per unit you control (unconditional)', () => {
  it('Grit only applies at 3+ units', () => {
    const below = board({ units: [unit('c', 'TWI_050', { damage: 3 }), unit('f1', 'FILLER')] })
    expect(unitHasKeyword(below, U(below, 'c')!, 'Grit')).toBe(false)
    const at3 = board({ units: [unit('c', 'TWI_050', { damage: 3 }), unit('f1', 'FILLER'), unit('f2', 'FILLER')] })
    expect(unitHasKeyword(at3, U(at3, 'c')!, 'Grit')).toBe(true)
  })

  it('When Played heals the chosen base 1 per unit controlled, regardless of Coordinate', () => {
    const s = board({ hand: ['TWI_050'], units: [unit('f1', 'FILLER')], base: { cardId: 'TST_B', damage: 5 } })
    // 1 filler + itself = 2 units, below the Coordinate threshold, but the heal is unconditional.
    let played = resolve(s, { type: 'playUnit', handIndex: 0 })
    played = accept(played, { baseTarget: 'player' })
    expect(played.players.player.base.damage).toBe(3) // 5 - 2
  })
})

describe('TWI_196 Plo Koon — Ambush (unconditional) + Coordinate: Raid 3', () => {
  it('has Ambush regardless of Coordinate', () => {
    const below = board({ units: [unit('c', 'TWI_196'), unit('f1', 'FILLER')] })
    expect(unitHasKeyword(below, U(below, 'c')!, 'Ambush')).toBe(true)
  })

  it('Raid only applies at 3+ units', () => {
    const below = board({ units: [unit('c', 'TWI_196'), unit('f1', 'FILLER')] })
    expect(unitKeywordValue(below, U(below, 'c')!, 'Raid')).toBe(0)
    const at3 = board({ units: [unit('c', 'TWI_196'), unit('f1', 'FILLER'), unit('f2', 'FILLER')] })
    expect(unitKeywordValue(at3, U(at3, 'c')!, 'Raid')).toBe(3)
  })
})

describe('TWI_114 Clone Commander Cody — Overwhelm (own, unconditional) + Coordinate: other friendly units +1/+1 and Overwhelm', () => {
  it('keeps its own Overwhelm regardless of Coordinate', () => {
    const below = board({ units: [unit('cody', 'TWI_114'), unit('ally', 'FILLER')] })
    expect(unitHasKeyword(below, U(below, 'cody')!, 'Overwhelm')).toBe(true)
  })

  it('grants +1/+1 and Overwhelm to OTHER friendly units only at 3+, never to itself', () => {
    const below = board({ units: [unit('cody', 'TWI_114'), unit('ally', 'FILLER')] }) // 2 units
    expect(effectivePower(below, U(below, 'ally')!)).toBe(F.FILLER.power)
    expect(unitHasKeyword(below, U(below, 'ally')!, 'Overwhelm')).toBe(false)

    const at3 = board({ units: [unit('cody', 'TWI_114'), unit('ally', 'FILLER'), unit('f3', 'FILLER')] })
    expect(effectivePower(at3, U(at3, 'ally')!)).toBe(F.FILLER.power! + 1)
    expect(effectiveHp(at3, U(at3, 'ally')!)).toBe(F.FILLER.hp! + 1)
    expect(unitHasKeyword(at3, U(at3, 'ally')!, 'Overwhelm')).toBe(true)
    // Cody's own aura excludes himself.
    expect(effectivePower(at3, U(at3, 'cody')!)).toBe(F.TWI_114.power)
  })
})

describe('TWI_205 Clone Dive Trooper — Coordinate: while attacking, the defender gets -2/-0', () => {
  it('reduces the defender’s power only at 3+ units, only in combat, and only against this attacker', () => {
    const below = board({ units: [unit('dt', 'TWI_205'), unit('f1', 'FILLER')] }, { units: [unit('def', 'ENEMY')] })
    const combat = { attackerInstanceId: 'dt', defenderInstanceId: 'def' }
    expect(effectivePower(below, U(below, 'def')!, { defending: true, combat })).toBe(F.ENEMY.power)

    const at3 = board({ units: [unit('dt', 'TWI_205'), unit('f1', 'FILLER'), unit('f2', 'FILLER')] }, { units: [unit('def', 'ENEMY')] })
    expect(effectivePower(at3, U(at3, 'def')!, { defending: true, combat })).toBe(F.ENEMY.power! - 2)
    // Outside combat, the aura does not apply.
    expect(effectivePower(at3, U(at3, 'def')!)).toBe(F.ENEMY.power)
  })
})

describe('TWI_095 Pelta Supply Frigate — Coordinate: When Played, create a Clone Trooper token', () => {
  it('creates the token only at 3+ units (including itself)', () => {
    const below = board({ hand: ['TWI_095'], units: [unit('f1', 'FILLER')] }) // 1 + itself = 2
    const playedBelow = resolve(below, { type: 'playUnit', handIndex: 0 })
    expect(playedBelow.players.player.units.some(u => u.cardId === TOKEN_CLONE_TROOPER)).toBe(false)

    const at3 = board({ hand: ['TWI_095'], units: [unit('f1', 'FILLER'), unit('f2', 'FILLER')] }) // 2 + itself = 3
    const playedAt3 = resolve(at3, { type: 'playUnit', handIndex: 0 })
    expect(playedAt3.players.player.units.some(u => u.cardId === TOKEN_CLONE_TROOPER)).toBe(true)
  })
})

describe('TWI_162 Reckless Torrent — Coordinate: When Played, you may deal 2 damage to a friendly unit and 2 to an enemy unit in the same arena', () => {
  it('offers no choice below 3 units', () => {
    const below = board({ hand: ['TWI_162'], units: [unit('f1', 'FILLER_SP')] }, { units: [unit('e', 'ENEMY_SP')] })
    const played = resolve(below, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.length ?? 0).toBe(0)
  })

  it('deals 2 to a chosen friendly and 2 to a chosen enemy in the same arena at 3+ units', () => {
    const at3 = board({ hand: ['TWI_162'], units: [unit('f1', 'FILLER_SP'), unit('f2', 'FILLER_SP')] }, { units: [unit('e', 'ENEMY_SP')] })
    let played = resolve(at3, { type: 'playUnit', handIndex: 0 })
    played = accept(played, { targetInstanceId: 'f1' })
    played = accept(played, { targetInstanceId: 'e' })
    expect(U(played, 'f1')?.damage).toBe(2)
    expect(U(played, 'e')?.damage).toBe(2)
  })

  it('may be declined entirely', () => {
    const at3 = board({ hand: ['TWI_162'], units: [unit('f1', 'FILLER_SP'), unit('f2', 'FILLER_SP')] }, { units: [unit('e', 'ENEMY_SP')] })
    let played = resolve(at3, { type: 'playUnit', handIndex: 0 })
    played = skip(played)
    expect(U(played, 'f1')?.damage).toBe(0)
    expect(U(played, 'e')?.damage).toBe(0)
  })
})

describe("TWI_213 Sanctioner's Shuttle — Coordinate: When Played, captures an enemy non-leader unit costing 3 or less", () => {
  it('offers no capture below 3 units', () => {
    const below = board({ hand: ['TWI_213'], units: [unit('f1', 'FILLER_SP')] }, { units: [unit('e', 'ENEMY_CHEAP')] })
    const played = resolve(below, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.length ?? 0).toBe(0)
  })

  it('captures a chosen enemy costing 3 or less at 3+ units, filtering out a pricier one', () => {
    const at3 = board({ hand: ['TWI_213'], units: [unit('f1', 'FILLER_SP'), unit('f2', 'FILLER_SP')] },
      { units: [unit('cheap', 'ENEMY_CHEAP'), unit('pricey', 'ENEMY_PRICEY')] })
    let played = resolve(at3, { type: 'playUnit', handIndex: 0 })
    const targets = (choice(played) as unknown as { targets: string[] }).targets
    expect(targets).toEqual(['cheap'])
    played = accept(played, { targetInstanceId: 'cheap' })
    expect(U(played, 'cheap')).toBeUndefined()
  })
})

// ── Coordinate On Attack abilities ───────────────────────────────────────────────────────────────

/** Units alongside the card under test: one other makes 2 units, two others make 3. */
const oneOther = () => [unit('f1', 'FILLER')]
const twoOthers = () => [unit('f1', 'FILLER'), unit('f2', 'FILLER')]
/** Three units of the player's own, for an undeployed leader (which is not a unit). */
const threeUnits = () => [...twoOthers(), unit('f3', 'FILLER')]
const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)

describe('TWI_096 Aayla Secura — Coordinate - On Attack: prevent all combat damage that would be dealt to this unit for this attack', () => {
  it('takes no combat damage from the defender at 3+ units, and still deals her own', () => {
    const s = board({ units: [unit('a', 'TWI_096'), ...twoOthers()] }, { units: [unit('e', 'ENEMY_BIG')] })
    const after = attack(s, 'a', 'e')
    expect(U(after, 'a')?.damage).toBe(0)
    expect(U(after, 'e')?.damage).toBe(F.TWI_096.power)
  })

  it('takes the combat damage below 3 units', () => {
    const s = board({ units: [unit('a', 'TWI_096'), ...oneOther()] }, { units: [unit('e', 'ENEMY_BIG')] })
    expect(U(attack(s, 'a', 'e'), 'a')?.damage).toBe(F.ENEMY_BIG.power)
  })

  it('lasts for that attack only: damage after it lands as usual', () => {
    const s = board({ units: [unit('a', 'TWI_096'), ...twoOthers()] }, { units: [unit('e', 'ENEMY_BIG')] })
    const after = dealDamageToUnit(attack(s, 'a', 'e'), 'a', 2)
    expect(U(after, 'a')?.damage).toBe(2)
  })
})

describe('TWI_147 Anakin Skywalker — Coordinate - On Attack: draw a card', () => {
  it('draws at 3+ units and not below', () => {
    const at3 = board({ deck: ['FILLER', 'FILLER'], units: [unit('a', 'TWI_147'), ...twoOthers()] })
    expect(attack(at3, 'a').players.player.hand).toHaveLength(1)
    const below = board({ deck: ['FILLER', 'FILLER'], units: [unit('a', 'TWI_147'), ...oneOther()] })
    expect(attack(below, 'a').players.player.hand).toHaveLength(0)
  })
})

describe('TWI_165 Kit Fisto — Saboteur + Coordinate - On Attack: you may deal 3 damage to a ground unit', () => {
  it('keeps Saboteur regardless of Coordinate', () => {
    const below = board({ units: [unit('k', 'TWI_165'), ...oneOther()] })
    expect(unitHasKeyword(below, U(below, 'k')!, 'Saboteur')).toBe(true)
  })

  it('offers 3 damage to any ground unit at 3+ units, optionally', () => {
    const s = board({ units: [unit('k', 'TWI_165'), ...twoOthers()] }, { units: [unit('eg', 'ENEMY'), unit('es', 'ENEMY_SP')] })
    const a = attack(s, 'k')
    const c = choice(a) as unknown as { kind: string; amount: number; unitTargets: string[] }
    expect(c.kind).toBe('selectDamageTarget')
    expect(c.amount).toBe(3)
    expect([...c.unitTargets].sort()).toEqual(['eg', 'f1', 'f2', 'k'])
    expect(U(accept(a, { targetInstanceId: 'eg' }), 'eg')).toBeUndefined() // 3 damage defeats a 3-HP unit
    expect(U(skip(a), 'eg')?.damage).toBe(0)
  })

  it('offers nothing below 3 units', () => {
    const s = board({ units: [unit('k', 'TWI_165'), ...oneOther()] }, { units: [unit('eg', 'ENEMY')] })
    noChoice(attack(s, 'k'))
  })
})

describe('TWI_192 Padmé Amidala — Coordinate - On Attack: give an enemy unit -3/-0 for this phase', () => {
  it('gives a chosen enemy unit -3/-0 at 3+ units, and only enemies are offered', () => {
    const s = board({ units: [unit('p', 'TWI_192'), ...twoOthers()] }, { units: [unit('e', 'ENEMY_BIG'), unit('es', 'ENEMY_SP')] })
    const a = attack(s, 'p')
    const c = choice(a) as unknown as { kind: string; targets: string[] }
    expect(c.kind).toBe('mayLastingBuff')
    expect([...c.targets].sort()).toEqual(['e', 'es'])
    const after = accept(a, { targetInstanceId: 'e' })
    expect(effectivePower(after, U(after, 'e')!)).toBe(F.ENEMY_BIG.power! - 3)
  })

  it('offers nothing below 3 units', () => {
    const s = board({ units: [unit('p', 'TWI_192'), ...oneOther()] }, { units: [unit('e', 'ENEMY_BIG')] })
    noChoice(attack(s, 'p'))
  })
})

// ── Ki-Adi-Mundi: "When an opponent plays their second card each phase" ──────────────────────────

describe('TWI_064 Ki-Adi-Mundi — Coordinate - When an opponent plays their second card each phase: you may draw 2 cards', () => {
  /** The opponent to act, having played `already` cards this phase, with an event in hand. */
  const opponentTurn = (units: UnitState[], already: number) => {
    let s = board({ deck: ['FILLER', 'FILLER', 'FILLER'], units }, { hand: ['EV'] }, { activePlayer: 'opponent' })
    for (let i = 0; i < already; i++) s = recordCardPlayed(s, 'opponent', 'EV')
    return resolve(s, { type: 'playEvent', handIndex: 0 })
  }

  it('offers the draw on their second card at 3+ units, and draws 2 when taken', () => {
    const played = opponentTurn([unit('k', 'TWI_064'), ...twoOthers()], 1)
    expect(choice(played)).toMatchObject({ kind: 'mayPayThen', controller: 'player' })
    expect(accept(played).players.player.hand).toHaveLength(2)
    expect(skip(played).players.player.hand).toHaveLength(0)
  })

  it('does not fire on their first or third card', () => {
    noChoice(opponentTurn([unit('k', 'TWI_064'), ...twoOthers()], 0))
    noChoice(opponentTurn([unit('k', 'TWI_064'), ...twoOthers()], 2))
  })

  it('does not fire below 3 units', () => {
    noChoice(opponentTurn([unit('k', 'TWI_064'), ...oneOther()], 1))
  })

  it('does not fire on your own second card', () => {
    let s = board({ hand: ['EV'], deck: ['FILLER', 'FILLER'], units: [unit('k', 'TWI_064'), ...twoOthers()] })
    s = recordCardPlayed(s, 'player', 'EV')
    noChoice(resolve(s, { type: 'playEvent', handIndex: 0 }))
  })
})

// ── The leaders ──────────────────────────────────────────────────────────────────────────────────

const undeployed = (cardId: string): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })
const deployed = (cardId: string): LeaderState => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })
const leaderUsable = (s: GameState) => legalMoves(s).some(m => m.type === 'useLeaderAbility')
const useLeader = (s: GameState) => {
  expect(leaderUsable(s), 'the leader action is offered').toBe(true)
  return resolve(s, { type: 'useLeaderAbility', index: 0 })
}

describe('the Coordinate leaders are built on both sides', () => {
  it.each(['TWI_011', 'TWI_008'])('%s', id => {
    expect(getCardDefinition(id)?.leaderAbilities?.actions).toHaveLength(1)
    expect(IMPLEMENTED_LEADERS.find(l => l.id === id)).toMatchObject({ front: true, back: true })
  })
})

describe('TWI_011 Ahsoka Tano — front: Coordinate - Action [Exhaust]: attack with a unit, +1/+0 for this attack; back: Coordinate - +2/+0', () => {
  it('front: offered only at 3+ units', () => {
    expect(leaderUsable(board({ leader: undeployed('TWI_011'), units: twoOthers() }))).toBe(false)
    expect(leaderUsable(board({ leader: undeployed('TWI_011'), units: threeUnits() }))).toBe(true)
  })

  it('front: exhausts her and attacks with a unit that gets +1/+0 for the attack', () => {
    const s = board({ leader: undeployed('TWI_011'), units: [unit('f1', 'FILLER'), unit('f2', 'FILLER'), unit('f3', 'FILLER')] }, { units: [unit('e', 'ENEMY_BIG')] })
    let after = useLeader(s)
    expect(after.players.player.leader.exhausted).toBe(true)
    after = attack(after, 'f1', 'e')
    expect(U(after, 'e')?.damage).toBe(F.FILLER.power! + 1)
  })

  it('back: +2/+0 at 3+ units, printed otherwise', () => {
    const at3 = board({ leader: deployed('TWI_011'), units: [unit('L', 'TWI_011', { isLeader: true }), ...twoOthers()] })
    expect(effectivePower(at3, U(at3, 'L')!)).toBe(F.TWI_011.power! + 2)
    const below = board({ leader: deployed('TWI_011'), units: [unit('L', 'TWI_011', { isLeader: true }), ...oneOther()] })
    expect(effectivePower(below, U(below, 'L')!)).toBe(F.TWI_011.power)
  })
})

describe('TWI_008 Padmé Amidala (leader) — front: Coordinate - Action [C=1, Exhaust]; back: Restore 1, Coordinate - On Attack: search the top 3 for a Republic card', () => {
  const deck = ['REP_EV', 'EV', 'REPUBLIC', 'FILLER']

  it('front: offered only at 3+ units, costs 1, and searches the top 3 for a Republic card', () => {
    expect(leaderUsable(board({ deck, leader: undeployed('TWI_008'), units: twoOthers() }))).toBe(false)
    const s = board({ deck, leader: undeployed('TWI_008'), units: threeUnits() })
    const used = useLeader(s)
    expect(used.players.player.leader.exhausted).toBe(true)
    expect(used.players.player.resources.filter(r => !r.exhausted)).toHaveLength(19)
    expect(choice(used)).toMatchObject({ kind: 'searchDraw', revealed: ['REP_EV', 'EV', 'REPUBLIC'], eligibleIndices: [0, 2] })
  })

  it('back: Restore 1 regardless of Coordinate', () => {
    const below = board({ leader: deployed('TWI_008'), units: [unit('L', 'TWI_008', { isLeader: true })] })
    expect(unitKeywordValue(below, U(below, 'L')!, 'Restore')).toBe(1)
  })

  it('back: On Attack searches at 3+ units and not below', () => {
    const at3 = board({ deck, leader: deployed('TWI_008'), units: [unit('L', 'TWI_008', { isLeader: true }), ...twoOthers()] })
    expect(choice(attack(at3, 'L'))).toMatchObject({ kind: 'searchDraw', eligibleIndices: [0, 2] })
    const below = board({ deck, leader: deployed('TWI_008'), units: [unit('L', 'TWI_008', { isLeader: true }), unit('f1', 'FILLER')] })
    noChoice(attack(below, 'L'))
  })
})

// ── For The Republic: an upgrade that grants "Coordinate - Restore 2" ───────────────────────────

describe('TWI_051 For The Republic — costs 2 less with 3+ Republic units; attached unit gains "Coordinate - Restore 2"', () => {
  const upgraded = (units: UnitState[]) =>
    board({ units: units.map((u, i) => (i === 0 ? { ...u, upgrades: [{ cardId: 'TWI_051', owner: 'player' as PlayerId }] } : u)) })

  it('gives its host Restore 2 only at 3+ units, never unconditionally', () => {
    const below = upgraded([unit('h', 'FILLER'), unit('f2', 'FILLER')])
    expect(unitKeywordValue(below, U(below, 'h')!, 'Restore')).toBe(0)
    const at3 = upgraded([unit('h', 'FILLER'), unit('f2', 'FILLER'), unit('f3', 'FILLER')])
    expect(unitKeywordValue(at3, U(at3, 'h')!, 'Restore')).toBe(2)
  })

  it('costs 2 less with 3 or more Republic units, not with 3 units of which 2 are Republic', () => {
    const rep = board({ units: [unit('r1', 'REPUBLIC'), unit('r2', 'REPUBLIC'), unit('r3', 'REPUBLIC')] })
    expect(effectiveCost(rep, 'player', F.TWI_051)).toBe(F.TWI_051.cost - 2)
    const mixed = board({ units: [unit('r1', 'REPUBLIC'), unit('r2', 'REPUBLIC'), unit('f1', 'FILLER')] })
    expect(effectiveCost(mixed, 'player', F.TWI_051)).toBe(F.TWI_051.cost)
  })
})
