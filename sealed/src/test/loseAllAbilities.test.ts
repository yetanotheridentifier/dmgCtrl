import { describe, it, expect, afterEach } from 'vitest'
import { registerCard, unregisterAbility, unitActionAbilities } from '../engine/abilities'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { effectivePower } from '../engine/stats'
import { unitHasKeyword, unitCannotAttackBases, unitHasTrait } from '../engine/keywords'
import { defeatUnit } from '../engine/combat'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { addLastingEffect } from '../engine/types'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PendingChoice, PlayerId, UnitState } from '../engine/types'

/**
 * "Loses all abilities" (CR 8.14.2): "the card ceases to have any abilities, including abilities
 * given to it by other cards, for the duration of the 'lose' effect. The card cannot gain abilities
 * for the duration of the effect." Keywords are abilities (CR 7.1.2 lists keyword abilities among the
 * five types), so printed keywords go too. What stays: printed power and HP, modifiers (an upgrade's
 * +X/+Y, a "+2/+0 for this phase"), and an upgrade's own ability that affects its host without the
 * word "gains" (CR 3.6.10: Entrenched still applies to a unit Force Lightning has blanked).
 *
 * The first block pins the gate at each read it covers, driven by a lasting effect; the rest are the
 * cards that use it.
 */

const POOL = poolFor(['SOR', 'SHD', 'TWI', 'JTL', 'LOF', 'SEC', 'LAW'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the fixtures`)
  return normaliseCard(row)
}
const SHIPPED = ['SOR_138', 'SOR_089', 'SHD_072', 'TWI_255', 'JTL_244', 'LOF_202', 'SEC_038', 'SEC_046', 'SEC_054', 'SEC_157', 'LAW_117', 'LAW_132']

const SENTRY = 'TST_SENTRY' // a ground unit with printed Sentinel and a printed On Attack
const AURA = 'TST_AURA' // "other friendly units get +1/+0 and gain Raid 1"
const GRANTS = 'TST_GRANTS' // hands every other friendly unit an Action
const GRANTED = 'TST_GRANTED' // the Action it hands out
const DOOMED = 'TST_DOOMED' // cost 2, "When Defeated: its controller draws a card"
const DRAW_EVENT = 'TST_DRAW_EVENT' // "Draw a card."
const LEADER = 'TST_LEADER_BI' // a leader with an Action and a Sentinel unit side

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 5, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries([...SHIPPED, 'SOR_057', 'SOR_072'].map(id => [id, real(id)])),
  [SENTRY]: src(SENTRY, { name: 'Sentry', keywords: [{ name: 'Sentinel' }] }),
  [AURA]: src(AURA),
  [GRANTS]: src(GRANTS),
  [DOOMED]: src(DOOMED, { name: 'Doomed' }),
  [DRAW_EVENT]: card({ id: DRAW_EVENT, name: 'Draw Event', type: 'event', cost: 0 }),
  [LEADER]: card({ id: LEADER, type: 'leader', cost: 3, power: 3, hp: 5, keywords: [{ name: 'Sentinel' }] }),
  PLAIN: src('PLAIN'),
  BIG: src('BIG', { cost: 5, hp: 10 }),
  JEDI: src('JEDI', { traits: ['Force'] }),
  RAIDER: src('RAIDER', { power: 3, keywords: [{ name: 'Raid', value: 2 }] }),
  P2: src('P2', { power: 2 }),
  P3: src('P3', { power: 3 }),
  VIGVIL: card({ id: 'VIGVIL', type: 'event', cost: 1, aspects: ['Vigilance', 'Villainy'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string): UnitState => {
  const found = all(s).find(x => x.instanceId === id)
  if (!found) throw new Error(`no unit ${id}`)
  return found
}
type Side = Parameters<typeof player>[0]
const rich = (over: Side = {}) => player({ resources: ready(10), deck: ['PLAIN', 'PLAIN', 'PLAIN'], ...over })
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })
const blank = (s: GameState, id: string, over: { untilEndOfAttack?: boolean; untilRoundEnd?: boolean } = {}) =>
  addLastingEffect(s, { targetInstanceId: id, losesAllAbilities: true, ...over })

const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; cardName?: string }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const toRegroup = (s: GameState) => resolve(resolve(s, { type: 'pass' }), { type: 'pass' })
const toNextRound = (s: GameState) => resolve(resolve(s, { type: 'skipResource' }), { type: 'skipResource' })
const attackBase = (s: GameState, attackerId: string, who: PlayerId = 'player') =>
  resolve({ ...s, activePlayer: who }, { type: 'attack', attackerId, target: { kind: 'base' } })
const baseDamage = (s: GameState, who: PlayerId) => s.players[who].base.damage

const pingOpponentBase = (amount: number) => (s: GameState, ctx: { owner: PlayerId }) => {
  const enemy = ctx.owner === 'player' ? 'opponent' : 'player'
  const p = s.players[enemy]
  return { ...s, players: { ...s.players, [enemy]: { ...p, base: { ...p.base, damage: p.base.damage + amount } } } }
}
const drawOne = (s: GameState, ctx: { owner: PlayerId }) => {
  const p = s.players[ctx.owner]
  return p.deck.length ? { ...s, players: { ...s.players, [ctx.owner]: { ...p, hand: [...p.hand, p.deck[0]], deck: p.deck.slice(1) } } } : s
}

afterEach(() => {
  for (const id of [SENTRY, AURA, GRANTS, GRANTED, DOOMED, DRAW_EVENT, LEADER]) unregisterAbility(id)
})
const registerFixtures = () => {
  registerCard(SENTRY, { abilities: [{ trigger: 'onAttack', description: 'Deal 1 damage to the defending player\'s base.', effect: pingOpponentBase(1) }] })
  registerCard(AURA, { aura: (_s, source, target, friendly) => (friendly && target.instanceId !== source.instanceId ? { power: 1, keywords: [{ name: 'Raid', value: 1 }] } : undefined) })
  registerCard(GRANTED, { actionAbilities: [{ description: 'noop', effect: s => s }] })
  registerCard(GRANTS, { grantsAbilities: (_s, source, target, friendly) => (friendly && target.instanceId !== source.instanceId ? [GRANTED] : []) })
  registerCard(DOOMED, { abilities: [{ trigger: 'whenDefeated', description: 'Draw a card.', effect: drawOne }] })
  registerCard(DRAW_EVENT, { abilities: [{ trigger: 'whenPlayed', description: 'Draw a card.', effect: drawOne }] })
  registerCard(LEADER, { leaderAbilities: { actions: [{ description: 'noop', effect: s => s }] } })
}

describe('the gate: a unit that has lost all abilities', () => {
  it('loses its printed keywords', () => {
    registerFixtures()
    const s = board({ units: [unit('a', SENTRY)] })
    expect(unitHasKeyword(s, U(s, 'a'), 'Sentinel')).toBe(true)
    expect(unitHasKeyword(blank(s, 'a'), U(s, 'a'), 'Sentinel')).toBe(false)
  })

  it('loses its printed triggered abilities', () => {
    registerFixtures()
    const s = board({ units: [unit('a', SENTRY)] })
    expect(baseDamage(attackBase(s, 'a'), 'opponent')).toBe(3) // 2 combat + the On Attack's 1
    expect(baseDamage(attackBase(blank(s, 'a'), 'a'), 'opponent')).toBe(2)
  })

  it('loses its When Defeated', () => {
    registerFixtures()
    const s = board({}, { units: [unit('d', DOOMED)], hand: [] })
    expect(defeatUnit(s, 'd').players.opponent.hand).toHaveLength(1)
    expect(defeatUnit(blank(s, 'd'), 'd').players.opponent.hand).toHaveLength(0)
  })

  it('stops projecting its constant abilities onto other units', () => {
    registerFixtures()
    const s = board({ units: [unit('a', AURA), unit('o', 'PLAIN')] })
    expect(effectivePower(s, U(s, 'o'))).toBe(3)
    expect(unitHasKeyword(s, U(s, 'o'), 'Raid')).toBe(true)
    const blanked = blank(s, 'a')
    expect(effectivePower(blanked, U(s, 'o'))).toBe(2)
    expect(unitHasKeyword(blanked, U(s, 'o'), 'Raid')).toBe(false)
  })

  it("can't gain a keyword from another unit's aura, but keeps the aura's +1/+0 (a modifier, not an ability)", () => {
    registerFixtures()
    const s = blank(board({ units: [unit('a', AURA), unit('o', 'PLAIN')] }), 'o')
    expect(unitHasKeyword(s, U(s, 'o'), 'Raid')).toBe(false)
    expect(effectivePower(s, U(s, 'o'))).toBe(3)
  })

  it("can't gain a keyword for the phase, but keeps a +2/+0 for the phase", () => {
    const s = addLastingEffect(blank(board({ units: [unit('o', 'PLAIN')] }), 'o'), { targetInstanceId: 'o', power: 2, keywords: [{ name: 'Sentinel' }] })
    expect(unitHasKeyword(s, U(s, 'o'), 'Sentinel')).toBe(false)
    expect(effectivePower(s, U(s, 'o'))).toBe(4)
  })

  it("can't gain an ability from an upgrade that says \"gains\" (Protector), but keeps the upgrade's +1/+1", () => {
    const s = board({ units: [unit('o', 'PLAIN', { upgrades: [{ cardId: 'SOR_057', owner: 'player' }] })] })
    expect(unitHasKeyword(s, U(s, 'o'), 'Sentinel')).toBe(true)
    const blanked = blank(s, 'o')
    expect(unitHasKeyword(blanked, U(s, 'o'), 'Sentinel')).toBe(false)
    expect(effectivePower(blanked, U(s, 'o'))).toBe(3)
  })

  it("is still bound by an upgrade's own ability that affects it without \"gains\" (Entrenched, CR 3.6.10)", () => {
    const s = blank(board({ units: [unit('o', 'PLAIN', { upgrades: [{ cardId: 'SOR_072', owner: 'player' }] })] }), 'o')
    expect(unitCannotAttackBases(s, U(s, 'o'))).toBe(true)
  })

  it("can't gain an Action from an aura (grantsAbilities)", () => {
    registerFixtures()
    const s = board({ units: [unit('g', GRANTS), unit('o', 'PLAIN')] })
    expect(unitActionAbilities(s, U(s, 'o'))).toHaveLength(1)
    const blanked = blank(s, 'o')
    expect(unitActionAbilities(blanked, U(s, 'o'))).toHaveLength(0)
    expect(legalMoves(blanked).filter(m => m.type === 'useAbility')).toEqual([])
  })

  it('gets its abilities back when a phase-long loss ends', () => {
    registerFixtures()
    const s = blank(board({ units: [unit('a', SENTRY)] }), 'a')
    const regroup = toRegroup(s)
    expect(unitHasKeyword(regroup, U(regroup, 'a'), 'Sentinel')).toBe(true)
  })
})

describe('the cards', () => {
  it('SOR_138 Force Lightning: a unit loses all abilities for this phase; without a Force unit nothing is paid', () => {
    registerFixtures()
    const s = board({ hand: ['SOR_138'] }, { units: [unit('e', SENTRY)] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(choice(played)).toMatchObject({ kind: 'selectUnitThen', targets: ['e'] })
    const done = accept(played, { targetInstanceId: 'e' })
    expect(done.pendingChoices ?? []).toHaveLength(0)
    expect(unitHasKeyword(done, U(done, 'e'), 'Sentinel')).toBe(false)
    expect(U(done, 'e').damage).toBe(0)
  })

  it('SOR_138 Force Lightning: with a Force unit, pay any number of resources for 2 damage each', () => {
    registerFixtures()
    const s = board({ hand: ['SOR_138'], units: [unit('j', 'JEDI')] }, { units: [unit('e', 'BIG')] })
    const picked = accept(resolve(s, { type: 'playEvent', handIndex: 0 }), { targetInstanceId: 'e' })
    expect(choice(picked)).toMatchObject({ kind: 'chooseNumber' })
    const readyBefore = picked.players.player.resources.filter(r => !r.exhausted).length
    const paid = accept(picked, { optionIndex: 2 })
    expect(U(paid, 'e').damage).toBe(4)
    expect(paid.players.player.resources.filter(r => !r.exhausted).length).toBe(readyBefore - 2)
  })

  it('JTL_244 There Is No Escape: up to 3 units lose all abilities and can\'t gain them for this round', () => {
    registerFixtures()
    const s = board({ hand: ['JTL_244'] }, { units: [unit('e1', SENTRY), unit('e2', SENTRY), unit('e3', SENTRY), unit('e4', SENTRY)] })
    let next = resolve(s, { type: 'playEvent', handIndex: 0 })
    next = accept(next, { targetInstanceId: 'e1' })
    next = accept(next, { targetInstanceId: 'e2' })
    next = skip(next) // stop at two
    expect(unitHasKeyword(next, U(next, 'e1'), 'Sentinel')).toBe(false)
    expect(unitHasKeyword(next, U(next, 'e2'), 'Sentinel')).toBe(false)
    expect(unitHasKeyword(next, U(next, 'e3'), 'Sentinel')).toBe(true)
    // "This round": it lasts through the regroup phase, and is gone as the next round starts.
    const regroup = toRegroup(next)
    expect(unitHasKeyword(regroup, U(regroup, 'e1'), 'Sentinel')).toBe(false)
    const nextRound = toNextRound(regroup)
    expect(unitHasKeyword(nextRound, U(nextRound, 'e1'), 'Sentinel')).toBe(true)
  })

  it('JTL_244 There Is No Escape: offers no more than 3', () => {
    const s = board({ hand: ['JTL_244'] }, { units: ['e1', 'e2', 'e3', 'e4'].map(id => unit(id, 'PLAIN')) })
    let next = resolve(s, { type: 'playEvent', handIndex: 0 })
    for (const id of ['e1', 'e2', 'e3']) next = accept(next, { targetInstanceId: id })
    expect(next.pendingChoices ?? []).toHaveLength(0)
  })

  it('LOF_202 Mind Trick: exhausts units with combined power 4 or less; without a Force unit they keep their abilities', () => {
    registerFixtures()
    const s = board({ hand: ['LOF_202'] }, { units: [unit('e1', SENTRY), unit('e2', 'P2'), unit('e3', 'P3')] })
    let next = resolve(s, { type: 'playEvent', handIndex: 0 })
    next = accept(next, { targetInstanceId: 'e1' })
    expect(choice(next)).toMatchObject({ kind: 'selectUnitThen', targets: ['e2'] }) // 2 power left: P3 no longer fits
    next = accept(next, { targetInstanceId: 'e2' })
    expect(next.pendingChoices ?? []).toHaveLength(0)
    expect(U(next, 'e1').exhausted && U(next, 'e2').exhausted && !U(next, 'e3').exhausted).toBe(true)
    expect(unitHasKeyword(next, U(next, 'e1'), 'Sentinel')).toBe(true)
  })

  it('LOF_202 Mind Trick: with a Force unit, those units also lose all abilities for this phase', () => {
    registerFixtures()
    const s = board({ hand: ['LOF_202'], units: [unit('j', 'JEDI')] }, { units: [unit('e1', SENTRY)] })
    let next = resolve(s, { type: 'playEvent', handIndex: 0 })
    next = accept(next, { targetInstanceId: 'e1' })
    next = next.pendingChoices?.length ? skip(next) : next
    expect(U(next, 'e1').exhausted).toBe(true)
    expect(unitHasKeyword(next, U(next, 'e1'), 'Sentinel')).toBe(false)
  })

  it('LAW_132 The Tree Remembers: a cheap enemy unit loses its abilities and is defeated, so its When Defeated does not fire', () => {
    registerFixtures()
    const s = board({ hand: ['LAW_132'] }, { units: [unit('d', DOOMED)], hand: [] })
    const done = accept(resolve(s, { type: 'playEvent', handIndex: 0 }), { targetInstanceId: 'd' })
    expect(done.players.opponent.units).toHaveLength(0)
    expect(done.players.opponent.hand).toHaveLength(0)
  })

  it('LAW_132 The Tree Remembers: a unit costing more than 3 only loses its abilities', () => {
    const s = board({ hand: ['LAW_132'] }, { units: [unit('b', 'BIG')] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(choice(played)).toMatchObject({ targets: ['b'] }) // enemy units only
    const done = accept(played, { targetInstanceId: 'b' })
    expect(done.players.opponent.units).toHaveLength(1)
    expect(done.lastingEffects).toContainEqual(expect.objectContaining({ targetInstanceId: 'b', losesAllAbilities: true }))
  })

  it('SEC_157 One Way Out: +1/+0 and Overwhelm, and the defender loses all abilities for this attack', () => {
    registerFixtures()
    // The defender's printed Sentinel would otherwise force the attack; here its On Defense stands in
    // for "its abilities": a defender that deals 5 to the attacker's base when attacked.
    registerCard(DOOMED, { abilities: [{ trigger: 'onDefense', description: 'Deal 5 damage to the attacking player\'s base.', effect: pingOpponentBase(5) }] })
    const s = board({ hand: ['SEC_157'], units: [unit('a', 'P3')] }, { units: [unit('d', DOOMED, { damage: 3 })] })
    let next = resolve(s, { type: 'playEvent', handIndex: 0 })
    const offer = choice(next)
    next = resolve(next, { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'd' }, choiceId: offer.id })
    expect(baseDamage(next, 'player')).toBe(0) // the On Defense did not fire
    expect(next.players.opponent.units).toHaveLength(0)
    expect(baseDamage(next, 'opponent')).toBe(2) // 4 power into 2 remaining HP, Overwhelm
    expect(next.lastingEffects ?? []).not.toContainEqual(expect.objectContaining({ losesAllAbilities: true }))
  })

  it('SHD_072 Imprisoned: the attached unit loses its abilities and can\'t gain them; not on a leader unit', () => {
    registerFixtures()
    const s = board({ hand: ['SHD_072'] }, { units: [unit('e', SENTRY), unit('l', LEADER, { isLeader: true })] })
    const targets = legalMoves(s).filter(m => m.type === 'playUpgrade').map(m => (m.type === 'playUpgrade' ? m.targetInstanceId : ''))
    expect(targets).toContain('e')
    expect(targets).not.toContain('l')
    const played = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'e' })
    expect(unitHasKeyword(played, U(played, 'e'), 'Sentinel')).toBe(false)
    const granted = addLastingEffect(played, { targetInstanceId: 'e', keywords: [{ name: 'Overwhelm' }] })
    expect(unitHasKeyword(granted, U(granted, 'e'), 'Overwhelm')).toBe(false)
  })

  it('SEC_054 Exiled from the Force: loses the Force trait and all abilities except Grit', () => {
    registerFixtures()
    const s = board({}, { units: [unit('e', SENTRY, { upgrades: [{ cardId: 'SEC_054', owner: 'player' }] }), unit('j', 'JEDI', { upgrades: [{ cardId: 'SEC_054', owner: 'player' }] })] })
    expect(unitHasKeyword(s, U(s, 'e'), 'Sentinel')).toBe(false)
    expect(unitHasKeyword(s, U(s, 'e'), 'Grit')).toBe(true)
    expect(unitHasTrait(s, U(s, 'j'), 'Force')).toBe(false)
  })

  it('SEC_038 Condemn: while attacking, the host loses its other abilities and the defending player may disclose for -6/-0', () => {
    registerCard('RAIDER', { abilities: [{ trigger: 'onAttack', description: 'Deal 1 damage to the defending player\'s base.', effect: pingOpponentBase(1) }] })
    try {
      const s = board({ units: [unit('a', 'RAIDER', { upgrades: [{ cardId: 'SEC_038', owner: 'opponent' }] })] }, { hand: [] })
      // Not attacking: Raid 2 is there.
      expect(unitHasKeyword(s, U(s, 'a'), 'Raid')).toBe(true)
      // Attacking with nothing to disclose: no Raid, no printed On Attack, so just its printed 3.
      const declined = attackBase(s, 'a')
      const settled = declined.pendingChoices?.length ? skip(declined) : declined
      expect(baseDamage(settled, 'opponent')).toBe(3)
      expect(unitHasKeyword(settled, U(settled, 'a'), 'Raid')).toBe(true) // back once the attack is over
      // The defending player discloses Vigilance Villainy: -6/-0 for this attack.
      const withCard = board({ units: [unit('a', 'RAIDER', { upgrades: [{ cardId: 'SEC_038', owner: 'opponent' }] })] }, { hand: ['VIGVIL'] })
      const attacked = attackBase(withCard, 'a')
      expect(choice(attacked)).toMatchObject({ kind: 'disclose', controller: 'opponent', need: ['Vigilance', 'Villainy'] })
      const picked = accept(attacked, { handIndex: 0 })
      const disclosed = accept(picked) // done revealing
      expect(baseDamage(disclosed, 'opponent')).toBe(0)
    } finally {
      unregisterAbility('RAIDER')
    }
  })

  it('TWI_255 Brain Invaders: each leader loses its abilities except epic actions', () => {
    registerFixtures()
    const leaderSide = { leader: { cardId: LEADER, deployed: false, epicActionUsed: false, exhausted: false } }
    const s = board(leaderSide, { units: [unit('b', 'TWI_255')] })
    const moves = legalMoves(s)
    expect(moves.some(m => m.type === 'useLeaderAbility')).toBe(false)
    expect(moves.some(m => m.type === 'deployLeader')).toBe(true) // the epic action stays
    const without = board(leaderSide)
    expect(legalMoves(without).some(m => m.type === 'useLeaderAbility')).toBe(true)
    // A deployed leader unit is a leader too: it loses its Sentinel.
    const deployed = board({ units: [unit('l', LEADER, { isLeader: true })] }, { units: [unit('b', 'TWI_255')] })
    expect(unitHasKeyword(deployed, U(deployed, 'l'), 'Sentinel')).toBe(false)
  })

  it('SOR_089 Relentless: the first event each opponent plays each round loses all abilities', () => {
    registerFixtures()
    const s = board({ units: [unit('r', 'SOR_089')] }, { hand: [DRAW_EVENT, DRAW_EVENT], deck: ['PLAIN', 'PLAIN'] }, { activePlayer: 'opponent' })
    const first = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(first.players.opponent.hand).toEqual([DRAW_EVENT]) // played, drew nothing
    expect(first.players.opponent.discard).toContain(DRAW_EVENT)
    const second = resolve({ ...first, activePlayer: 'opponent' }, { type: 'playEvent', handIndex: 0 })
    expect(second.players.opponent.hand).toEqual(['PLAIN'])
  })

  it("SOR_089 Relentless: its controller's own events are unaffected", () => {
    registerFixtures()
    const s = board({ units: [unit('r', 'SOR_089')], hand: [DRAW_EVENT], deck: ['PLAIN'] })
    expect(resolve(s, { type: 'playEvent', handIndex: 0 }).players.player.hand).toEqual(['PLAIN'])
  })

  it('SEC_046 Galen Erso: each card an opponent owns with the named name loses all abilities while he is in play', () => {
    registerFixtures()
    const s = board({ hand: ['SEC_046'], units: [unit('mine', SENTRY)] }, { units: [unit('e', SENTRY)], hand: [DRAW_EVENT], deck: ['PLAIN'] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(choice(played)).toMatchObject({ kind: 'nameCard' })
    const named = accept(played, { cardName: 'Sentry' })
    expect(unitHasKeyword(named, U(named, 'e'), 'Sentinel')).toBe(false)
    expect(unitHasKeyword(named, U(named, 'mine'), 'Sentinel')).toBe(true) // his controller's own copy is untouched
    // Gone with him.
    const galen = named.players.player.units.find(u => u.cardId === 'SEC_046')!
    const gone = defeatUnit(named, galen.instanceId)
    expect(unitHasKeyword(gone, U(gone, 'e'), 'Sentinel')).toBe(true)
  })

  it('SEC_046 Galen Erso: an event with the named name does nothing', () => {
    registerFixtures()
    const s = board({ hand: ['SEC_046'] }, { hand: [DRAW_EVENT], deck: ['PLAIN'] })
    const named = accept(resolve(s, { type: 'playUnit', handIndex: 0 }), { cardName: 'Draw Event' })
    const played = resolve({ ...named, activePlayer: 'opponent' }, { type: 'playEvent', handIndex: 0 })
    expect(played.players.opponent.hand).toEqual([])
  })

  it("LAW_117 Conveyex Security Captain: enemy Credit tokens lose their ability, so they can't pay", () => {
    const s = board({ hand: ['PLAIN'], creditTokens: 2 }, {})
    expect(choice(resolve(s, { type: 'playUnit', handIndex: 0 }))).toMatchObject({ kind: 'exploit', credit: true })
    const guarded = board({ hand: ['PLAIN'], creditTokens: 2 }, { units: [unit('c', 'LAW_117')] })
    const played = resolve(guarded, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices ?? []).toHaveLength(0)
    expect(played.players.player.units.some(u => u.cardId === 'PLAIN')).toBe(true)
    // Its controller's own Credit tokens still work.
    const own = board({ hand: ['PLAIN'], creditTokens: 2, units: [unit('c', 'LAW_117')] }, {})
    expect(choice(resolve(own, { type: 'playUnit', handIndex: 0 }))).toMatchObject({ kind: 'exploit', credit: true })
  })
})
