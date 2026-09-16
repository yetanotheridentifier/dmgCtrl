import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { unitHasKeyword, unitCannotAttack } from '../engine/keywords'
import { effectivePower } from '../engine/stats'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { normaliseCard } from '../engine/cardDb'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PendingChoice, UnitState } from '../engine/types'

/**
 * The attack events: "attack with a unit" plus something the plain rider path cannot carry. A
 * restricted attacker (a trait, an arena, damaged, non-leader, unique), an attacker that may be
 * exhausted, a modifier on the defender, several attacks one at a time, or an effect that depends on
 * how the attack went.
 *
 * Each test asserts WHO may attack as well as what the attack does, since a filter that lets every
 * unit through would still pass a test that only attacks with the right one.
 */

const ev = (id: string, cost = 1) => card({ id, type: 'event', cost })
const F = {
  ...CARDS,
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  GRD2: card({ id: 'GRD2', arena: 'ground', cost: 2, power: 3, hp: 6 }),
  SPACE: card({ id: 'SPACE', arena: 'space', cost: 3, power: 2, hp: 6 }),
  TOUGH: card({ id: 'TOUGH', arena: 'ground', cost: 4, power: 4, hp: 20 }),
  TOUGHSP: card({ id: 'TOUGHSP', arena: 'space', cost: 4, power: 4, hp: 20 }),
  FRAIL: card({ id: 'FRAIL', arena: 'ground', cost: 1, power: 1, hp: 1 }),
  VEH: card({ id: 'VEH', arena: 'ground', cost: 5, power: 3, hp: 9, traits: ['VEHICLE'] }),
  FIGHTER: card({ id: 'FIGHTER', arena: 'space', cost: 3, power: 2, hp: 9, traits: ['VEHICLE', 'FIGHTER'] }),
  CREATURE: card({ id: 'CREATURE', arena: 'ground', cost: 2, power: 1, hp: 6, traits: ['CREATURE'] }),
  FORCE: card({ id: 'FORCE', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['FORCE', 'JEDI'] }),
  REBEL: card({ id: 'REBEL', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['REBEL'] }),
  BH: card({ id: 'BH', arena: 'ground', cost: 2, power: 2, hp: 6, traits: ['UNDERWORLD', 'BOUNTY HUNTER'] }),
  UNIQ: card({ id: 'UNIQ', arena: 'ground', cost: 3, power: 2, hp: 6, unique: true }),
  UNIQ2: card({ id: 'UNIQ2', arena: 'ground', cost: 3, power: 3, hp: 6, unique: true }),
  COST1: card({ id: 'COST1', arena: 'ground', cost: 1 }),
  COST4: card({ id: 'COST4', arena: 'ground', cost: 4 }),
  // Grand Admiral Thrawn's deployed side carries one registered On Attack ability.
  ASH_004: card({ id: 'ASH_004', arena: 'ground', cost: 6, power: 4, hp: 8 }),

  LAW_202: ev('LAW_202'), LAW_205: ev('LAW_205'), SEC_228: ev('SEC_228'), SEC_179: ev('SEC_179', 3),
  SEC_229: ev('SEC_229', 2), LOF_124: ev('LOF_124'), LOF_224: ev('LOF_224', 2), JTL_261: ev('JTL_261'),
  JTL_228: ev('JTL_228'), JTL_123: ev('JTL_123'), JTL_174: ev('JTL_174'), JTL_193: ev('JTL_193'),
  JTL_231: ev('JTL_231'), JTL_177: ev('JTL_177', 2), JTL_124: ev('JTL_124'), JTL_156: ev('JTL_156'),
  TWI_139: ev('TWI_139'), TWI_172: ev('TWI_172', 2), TWI_123: ev('TWI_123'), SHD_179: ev('SHD_179'),
  SHD_145: ev('SHD_145', 2), SHD_128: ev('SHD_128'), SHD_230: ev('SHD_230'), SOR_150: ev('SOR_150'),
  SOR_103: ev('SOR_103'), TS26_59: ev('TS26_59', 3), TS26_31: ev('TS26_31'),
  SOR_215: card({ id: 'SOR_215', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: (F as Record<string, EngineCard>)[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const play = (s: GameState) => resolve(s, { type: 'playEvent', handIndex: 0 })
const choice = (s: GameState): PendingChoice => s.pendingChoices![0]
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
const accept = (s: GameState, extra: { targetInstanceId?: string } = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const skippable = (s: GameState) => legalMoves(s).some(m => m.type === 'skipTrigger')

type AttackMove = Extract<Action, { type: 'attack' }>
const attackMoves = (s: GameState) => legalMoves(s).filter((m): m is AttackMove => m.type === 'attack')
/** The units offered as attackers, sorted. */
const attackers = (s: GameState) => [...new Set(attackMoves(s).map(m => m.attackerId))].sort()
const baseOffered = (s: GameState, attackerId: string) => attackMoves(s).some(m => m.attackerId === attackerId && m.target.kind === 'base')
const unitTargets = (s: GameState, attackerId: string) =>
  attackMoves(s).filter(m => m.attackerId === attackerId && m.target.kind === 'unit').map(m => (m.target as { instanceId: string }).instanceId).sort()
const hitBase = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
const hitUnit = (s: GameState, attackerId: string, instanceId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'unit', instanceId } })

const board = (eventId: string, mine: UnitState[], theirs: UnitState[], over: { mine?: Parameters<typeof player>[0]; theirs?: Parameters<typeof player>[0] } = {}) =>
  state({ cards: F, players: { player: rich({ hand: [eventId], units: mine, ...over.mine }), opponent: player({ units: theirs, ...over.theirs }) } })

// ── A restricted attacker ───────────────────────────────────────────────────────────────────────

describe('attack events with a restricted attacker', () => {
  it('Pounce (LOF_224) attacks with a Creature, which gets +4/+0', () => {
    const played = play(board('LOF_224', [unit('c', 'CREATURE'), unit('g', 'GRD')], []))
    expect(attackers(played)).toEqual(['c'])
    expect(skippable(played)).toBe(false)
    expect(hitBase(played, 'c').players.opponent.base.damage).toBe(5)
  })

  it('Punch It (JTL_231) attacks with a Vehicle, which gets +2/+0', () => {
    const played = play(board('JTL_231', [unit('v', 'VEH'), unit('g', 'GRD')], []))
    expect(attackers(played)).toEqual(['v'])
    expect(hitBase(played, 'v').players.opponent.base.damage).toBe(5)
  })

  it('Desperate Attack (SHD_179) attacks with a damaged unit, which gets +2/+0', () => {
    const played = play(board('SHD_179', [unit('d', 'GRD', { damage: 1 }), unit('g', 'GRD')], []))
    expect(attackers(played)).toEqual(['d'])
    expect(hitBase(played, 'd').players.opponent.base.damage).toBe(4)
  })

  it('Grim Resolve (TWI_172) attacks with a non-leader unit, which gains Grit', () => {
    const leader = unit('L', 'TST_L', { isLeader: true })
    const played = play(board('TWI_172', [unit('d', 'GRD', { damage: 3 }), leader], []))
    expect(attackers(played)).toEqual(['d'])
    const done = hitBase(played, 'd')
    expect(done.players.opponent.base.damage).toBe(2 + 3)
    expect(unitHasKeyword(done, U(done, 'd')!, 'Grit')).toBe(false) // only for the attack
  })

  it('does nothing when no unit matches', () => {
    noChoice(play(board('JTL_231', [unit('g', 'GRD')], [])))
  })

  it('Rebel Assault (SOR_103) attacks with a Rebel, then another Rebel, each +1/+0', () => {
    const played = play(board('SOR_103', [unit('r1', 'REBEL'), unit('r2', 'REBEL'), unit('g', 'GRD')], []))
    expect(attackers(played)).toEqual(['r1', 'r2'])
    const first = hitBase(played, 'r1')
    expect(first.players.opponent.base.damage).toBe(3)
    expect(attackers(first)).toEqual(['r2'])
    const done = hitBase(first, 'r2')
    expect(done.players.opponent.base.damage).toBe(6)
    noChoice(done)
    expect(done.activePlayer).toBe('opponent')
  })
})

describe('attack events whose attacker may be exhausted', () => {
  it('Niman Strike (LOF_124) attacks with a Force unit even if exhausted, +1/+0, and never a base', () => {
    const mine = [unit('f', 'FORCE', { exhausted: true }), unit('g', 'GRD')]
    const played = play(board('LOF_124', mine, [unit('e', 'TOUGH')]))
    expect(attackers(played)).toEqual(['f'])
    expect(baseOffered(played, 'f')).toBe(false)
    const done = hitUnit(played, 'f', 'e')
    expect(U(done, 'e')!.damage).toBe(3)
  })

  it('Niman Strike does nothing when the only target would be a base', () => {
    noChoice(play(board('LOF_124', [unit('f', 'FORCE', { exhausted: true })], [])))
  })

  it('Dogfight (JTL_123) attacks with any unit even if exhausted, and never a base', () => {
    const played = play(board('JTL_123', [unit('x', 'GRD', { exhausted: true })], [unit('e', 'TOUGH')]))
    expect(attackers(played)).toEqual(['x'])
    expect(baseOffered(played, 'x')).toBe(false)
    expect(U(hitUnit(played, 'x', 'e'), 'e')!.damage).toBe(2)
  })
})

// ── A modifier on the defender ──────────────────────────────────────────────────────────────────

describe('attack events that change the defender', () => {
  it('Catch Unawares (SEC_229) gives the defender -4/-0 for the attack only', () => {
    const played = play(board('SEC_229', [unit('a', 'GRD')], [unit('e', 'TOUGH')]))
    const done = hitUnit(played, 'a', 'e')
    expect(U(done, 'a')!.damage).toBe(0)
    expect(effectivePower(done, U(done, 'e')!)).toBe(4)
  })

  it('Swoop Down (SHD_230) lets a space unit hit the ground with Saboteur, +2/+0 and the defender -2/-0', () => {
    const shielded = unit('e', 'TOUGH', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })
    const played = play(board('SHD_230', [unit('s', 'SPACE'), unit('g', 'GRD')], [shielded, unit('es', 'TOUGHSP')]))
    expect(attackers(played)).toEqual(['s'])
    expect(unitTargets(played, 's')).toEqual(['e', 'es'])
    const done = hitUnit(played, 's', 'e')
    expect(U(done, 'e')!.damage).toBe(4) // Saboteur took the shield, 2 + 2 landed
    expect(U(done, 's')!.damage).toBe(2) // 4 - 2
  })

  it('Swoop Down gives no bonus against a space unit', () => {
    const played = play(board('SHD_230', [unit('s', 'SPACE')], [unit('es', 'TOUGHSP')]))
    const done = hitUnit(played, 's', 'es')
    expect(U(done, 'es')!.damage).toBe(2)
    expect(U(done, 's')!.damage).toBe(4)
  })
})

// ── Several attacks one at a time ───────────────────────────────────────────────────────────────

describe('attack events with several attacks', () => {
  it.each(['TWI_123', 'SHD_128'])('Outflank (%s) attacks with two units, one at a time', id => {
    const played = play(board(id, [unit('a', 'GRD'), unit('b', 'GRD')], []))
    const first = hitBase(played, 'a')
    expect(attackers(first)).toEqual(['b'])
    const done = hitBase(first, 'b')
    expect(done.players.opponent.base.damage).toBe(4)
    noChoice(done)
  })

  it('Outflank stops quietly when no second unit can attack', () => {
    const played = play(board('TWI_123', [unit('a', 'GRD')], []))
    const done = hitBase(played, 'a')
    noChoice(done)
    expect(done.activePlayer).toBe('opponent')
  })

  it('Attack Run (JTL_261) attacks with two space units', () => {
    const played = play(board('JTL_261', [unit('s1', 'SPACE'), unit('s2', 'SPACE'), unit('g', 'GRD')], []))
    expect(attackers(played)).toEqual(['s1', 's2'])
    const done = hitBase(hitBase(played, 's1'), 's2')
    expect(done.players.opponent.base.damage).toBe(4)
  })

  it('Headhunting (SHD_145) attacks with up to 3 units, never bases, Bounty Hunters +2/+0', () => {
    const mine = [unit('b', 'BH'), unit('g', 'GRD'), unit('h', 'GRD2')]
    const played = play(board('SHD_145', mine, [unit('e', 'TOUGH')]))
    expect(skippable(played)).toBe(true)
    expect(baseOffered(played, 'b')).toBe(false)
    const first = hitUnit(played, 'b', 'e')
    expect(U(first, 'e')!.damage).toBe(4)
    expect(attackers(first)).toEqual(['g', 'h'])
    const second = hitUnit(first, 'g', 'e')
    expect(U(second, 'e')!.damage).toBe(6)
    expect(attackers(second)).toEqual(['h'])
    const done = skip(second)
    noChoice(done)
  })

  it('Tandem Assault (JTL_124) attacks with a space unit, then a ground unit at +2/+0', () => {
    const played = play(board('JTL_124', [unit('s', 'SPACE'), unit('g', 'GRD')], []))
    expect(attackers(played)).toEqual(['s'])
    const first = hitBase(played, 's')
    expect(attackers(first)).toEqual(['g'])
    expect(hitBase(first, 'g').players.opponent.base.damage).toBe(2 + 4)
  })

  it('Tandem Assault needs the space attack first', () => {
    noChoice(play(board('JTL_124', [unit('g', 'GRD')], [])))
  })

  it('Brothers (TS26_59) attacks with up to 2 unique units, and neither takes combat damage', () => {
    const played = play(board('TS26_59', [unit('u1', 'UNIQ'), unit('u2', 'UNIQ2'), unit('g', 'GRD')], [unit('e', 'TOUGH')]))
    expect(attackers(played)).toEqual(['u1', 'u2'])
    expect(skippable(played)).toBe(true)
    const first = hitUnit(played, 'u1', 'e')
    expect(U(first, 'u1')!.damage).toBe(0)
    expect(attackers(first)).toEqual(['u2'])
    const done = hitUnit(first, 'u2', 'e')
    expect(U(done, 'u2')!.damage).toBe(0)
    expect(U(done, 'e')!.damage).toBe(5)
  })

  it('Accelerate Our Plans (SEC_228) exhausts a friendly unit, then attacks with another at +3/+0', () => {
    const played = play(board('SEC_228', [unit('a', 'GRD'), unit('b', 'GRD')], []))
    expect(choice(played).kind).toBe('mayExhaustUnit')
    expect(skippable(played)).toBe(false)
    const exhausted = accept(played, { targetInstanceId: 'a' })
    expect(U(exhausted, 'a')!.exhausted).toBe(true)
    expect(attackers(exhausted)).toEqual(['b'])
    expect(hitBase(exhausted, 'b').players.opponent.base.damage).toBe(5)
  })
})

// ── Riders that depend on the board or on how the attack went ───────────────────────────────────

describe('attack events whose rider depends on the board or the attack', () => {
  it('Commence the Festivities (LAW_202) gives Saboteur, and +2/+0 while you have fewer resources', () => {
    const shielded = unit('e', 'TOUGH', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })
    const behind = board('LAW_202', [unit('a', 'GRD')], [shielded], { mine: { resources: ready(3) }, theirs: { resources: ready(5) } })
    expect(U(hitUnit(play(behind), 'a', 'e'), 'e')!.damage).toBe(4)
    const ahead = board('LAW_202', [unit('a', 'GRD')], [shielded], { theirs: { resources: ready(5) } })
    expect(U(hitUnit(play(ahead), 'a', 'e'), 'e')!.damage).toBe(2)
  })

  it('Flash the Vents (LAW_205) gives +2/+0 and Overwhelm, and defeats the unit if it damaged a base', () => {
    const played = play(board('LAW_205', [unit('a', 'GRD')], [unit('e', 'FRAIL')]))
    const done = hitUnit(played, 'a', 'e')
    expect(done.players.opponent.base.damage).toBe(3)
    expect(U(done, 'a')).toBeUndefined()
    const safe = hitUnit(play(board('LAW_205', [unit('a', 'GRD')], [unit('e', 'TOUGH')])), 'a', 'e')
    expect(U(safe, 'a')).toBeDefined()
  })

  it('Aggressive Negotiations (SEC_179) gives +1/+0 per card in your hand', () => {
    const played = play(board('SEC_179', [unit('a', 'GRD')], [], { mine: { hand: ['SEC_179', 'GRD', 'GRD', 'GRD'] } }))
    expect(hitBase(played, 'a').players.opponent.base.damage).toBe(2 + 3)
  })

  it('Corner the Prey (TWI_139) gives +1/+0 per damage on the defender at the start of the attack', () => {
    const played = play(board('TWI_139', [unit('a', 'GRD')], [unit('e', 'TOUGH', { damage: 3 })]))
    expect(U(hitUnit(played, 'a', 'e'), 'e')!.damage).toBe(3 + 5)
  })

  it('Barrel Roll (JTL_228) attacks with a space unit, then may exhaust a space unit', () => {
    const played = play(board('JTL_228', [unit('s', 'SPACE'), unit('g', 'GRD')], [unit('es', 'TOUGHSP'), unit('eg', 'TOUGH')]))
    expect(attackers(played)).toEqual(['s'])
    const attacked = hitBase(played, 's')
    expect(choice(attacked)).toMatchObject({ kind: 'mayExhaustUnit', optional: true })
    // Ready space units only: the attacker is already exhausted, and exhausting it again does nothing.
    expect([...(choice(attacked) as { targets: string[] }).targets].sort()).toEqual(['es'])
    expect(U(accept(attacked, { targetInstanceId: 'es' }), 'es')!.exhausted).toBe(true)
  })

  it('I Have You Now (JTL_193) attacks with a Vehicle and prevents all damage to it', () => {
    const played = play(board('JTL_193', [unit('v', 'VEH'), unit('g', 'GRD')], [unit('e', 'TOUGH')]))
    expect(attackers(played)).toEqual(['v'])
    const done = hitUnit(played, 'v', 'e')
    expect(U(done, 'v')!.damage).toBe(0)
    expect(U(done, 'e')!.damage).toBe(3)
  })

  it('Stay on Target (JTL_177) gives a Vehicle +2/+0 and draws when it damages a base', () => {
    const played = play(board('JTL_177', [unit('v', 'VEH')], []))
    const done = hitBase(played, 'v')
    expect(done.players.opponent.base.damage).toBe(5)
    expect(done.players.player.hand).toHaveLength(1)
    const onUnit = hitUnit(play(board('JTL_177', [unit('v', 'VEH')], [unit('e', 'TOUGH')])), 'v', 'e')
    expect(onUnit.players.player.hand).toHaveLength(0)
  })

  it('Trench Run (JTL_156) gives a Fighter +4/+0, mills 2 and deals the cost difference to it, through a Shield', () => {
    const shielded = unit('f', 'FIGHTER', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })
    const played = play(board('JTL_156', [shielded, unit('s', 'SPACE')], [], { theirs: { deck: ['COST1', 'COST4', 'GRD'] } }))
    expect(attackers(played)).toEqual(['f'])
    const done = hitBase(played, 'f')
    expect(done.players.opponent.discard).toEqual(['COST1', 'COST4'])
    expect(done.players.opponent.deck).toEqual(['GRD'])
    expect(U(done, 'f')!.damage).toBe(3)
    expect(done.players.opponent.base.damage).toBe(6)
  })

  it('Heroic Sacrifice (SOR_150) draws, then attacks at +2/+0, and the unit is defeated once it deals combat damage', () => {
    const played = play(board('SOR_150', [unit('a', 'GRD')], []))
    expect(played.players.player.hand).toHaveLength(1)
    const done = hitBase(played, 'a')
    expect(done.players.opponent.base.damage).toBe(4)
    expect(U(done, 'a')).toBeUndefined()
  })

  it('Heroic Sacrifice leaves the unit alone when a Shield soaks its damage', () => {
    const shielded = unit('e', 'TOUGH', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })
    const done = hitUnit(play(board('SOR_150', [unit('a', 'GRD')], [shielded])), 'a', 'e')
    expect(U(done, 'a')).toBeDefined()
  })

  it('Hotshot Maneuver (JTL_174) deals 2 to a different enemy unit per On Attack ability, then attacks with the unit', () => {
    const played = play(board('JTL_174', [unit('t', 'ASH_004'), unit('g', 'GRD')], [unit('e1', 'TOUGH'), unit('e2', 'TOUGH')]))
    expect(choice(played).kind).toBe('selectFriendlyUnit')
    const chosen = accept(played, { targetInstanceId: 't' })
    expect(choice(chosen)).toMatchObject({ kind: 'multiPick' })
    const dealt = accept(chosen, { targetInstanceId: 'e1' })
    expect(U(dealt, 'e1')!.damage).toBe(2)
    expect(attackers(dealt)).toEqual(['t'])
    expect(skippable(dealt)).toBe(false)
  })

  it('Hotshot Maneuver goes straight to the attack for a unit with no On Attack ability', () => {
    const played = play(board('JTL_174', [unit('g', 'GRD'), unit('h', 'GRD2')], [unit('e1', 'TOUGH')]))
    const chosen = accept(played, { targetInstanceId: 'g' })
    expect(attackers(chosen)).toEqual(['g'])
  })
})

// ── The upgrade, and the prohibition ────────────────────────────────────────────────────────────

describe('Snapshot Reflexes and Chaotic Diversion', () => {
  it('Snapshot Reflexes (SOR_215) is an upgrade, +1/+1, whatever the source data says', () => {
    const c = normaliseCard({ Set: 'SOR', Number: '215', Name: 'Snapshot Reflexes', Type: 'Event', Cost: '1' } as Parameters<typeof normaliseCard>[0])
    expect(c).toMatchObject({ type: 'upgrade', power: 1, hp: 1 })
  })

  it('Snapshot Reflexes lets the attached unit attack', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['SOR_215'], units: [unit('a', 'GRD'), unit('b', 'GRD')] }), opponent: player() } })
    const played = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'a' })
    expect(attackers(played)).toEqual(['a'])
    expect(skippable(played)).toBe(true)
    expect(hitBase(played, 'a').players.opponent.base.damage).toBe(3)
  })

  it('Chaotic Diversion (TS26_31) readies an enemy unit that then cannot attack this phase, and shields a friendly unit', () => {
    const played = play(board('TS26_31', [unit('a', 'GRD')], [unit('e', 'GRD', { exhausted: true }), unit('r', 'GRD')]))
    const ready = choice(played)
    expect(ready.kind).toBe('selectUnitToReady')
    expect((ready as { targets: string[] }).targets).toEqual(['e'])
    const readied = accept(played, { targetInstanceId: 'e' })
    expect(U(readied, 'e')!.exhausted).toBe(false)
    expect(unitCannotAttack(readied, U(readied, 'e')!)).toBe(true)
    expect(unitCannotAttack(readied, U(readied, 'r')!)).toBe(false)
    expect(choice(readied)).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_SHIELD })
    const done = accept(readied, { targetInstanceId: 'a' })
    expect(U(done, 'a')!.upgrades.map(x => x.cardId)).toEqual([TOKEN_SHIELD])
  })

  it('Chaotic Diversion still shields when no enemy unit is exhausted', () => {
    const played = play(board('TS26_31', [unit('a', 'GRD')], [unit('r', 'GRD')]))
    expect(choice(played)).toMatchObject({ kind: 'mayGiveTokens' })
  })
})
