import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { normaliseCard } from '../engine/cardDb'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { effectiveHp, effectivePower } from '../engine/stats'
import { isLeaderUnit, unitHasKeyword } from '../engine/keywords'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { upgradeSideId } from '../engine/types'
import type { PendingChoice } from '../engine/types'
import { defeatUnit } from '../engine/combat'
import { defeatUpgradeAt, returnUnitToHand, returnUpgradeToHand } from '../engine/effects'
import { newCoverage, observeState } from '../bench/playCoverage'
import { describeAction } from '../utils/describeAction'
import { poolFor } from '../bench/setPools'
import { TOKEN_TIE_FIGHTER } from '../engine/tokenUnits'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, LeaderState, UnitState } from '../engine/types'

/**
 * Leaders whose deployed side is a Pilot: the deploy as an upgrade (the mechanic), then each leader's
 * front, unit side and upgrade side. The front is used the way the game uses it, through
 * `useLeaderAbility` on an undeployed leader.
 */

const POOL = poolFor(['JTL'])
const real = (id: string): EngineCard => {
  const row = POOL.find(c => c.Set === 'JTL' && String(c.Number) === id.split('_')[1])
  if (!row) throw new Error(`${id} is not in the JTL fixture`)
  return normaliseCard(row)
}
const LEADERS = ['JTL_001', 'JTL_003', 'JTL_006', 'JTL_008', 'JTL_009', 'JTL_011', 'JTL_012', 'JTL_013', 'JTL_015', 'JTL_017', 'JTL_018']
const vehicle = (id: string, traits: string[], over: Partial<EngineCard> = {}) =>
  card({ id, arena: 'space', cost: 3, power: 3, hp: 5, traits: ['Vehicle', ...traits], ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries([...LEADERS, 'JTL_108'].map(id => [id, real(id)])),
  FIGHTER: vehicle('FIGHTER', ['Fighter']),
  TRANSPORT: vehicle('TRANSPORT', ['Transport'], { cost: 5 }),
  SPEEDER: vehicle('SPEEDER', ['Speeder'], { arena: 'ground' }),
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 5 }),
  SPC: card({ id: 'SPC', arena: 'space', cost: 2, power: 2, hp: 5 }),
  ODD1: card({ id: 'ODD1', arena: 'ground', cost: 1, power: 1, hp: 3 }),
  ODD3: card({ id: 'ODD3', arena: 'ground', cost: 3, power: 1, hp: 3 }),
  SENT: card({ id: 'SENT', arena: 'space', cost: 2, power: 1, hp: 9, keywords: [{ name: 'Sentinel' }] }),
  EV: card({ id: 'EV', type: 'event', cost: 1 }),
  UPG3: card({ id: 'UPG3', type: 'upgrade', cost: 3, power: 1, hp: 1 }),
  ALL_L: card({ id: 'ALL_L', type: 'leader', cost: 5, power: 4, hp: 7 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const leader = (cardId: string, over: Partial<LeaderState> = {}): LeaderState =>
  ({ cardId, deployed: false, epicActionUsed: false, exhausted: false, ...over })

function board(leaderId: string, mine: UnitState[], theirs: UnitState[] = [], over: { hand?: string[]; deck?: string[]; resources?: number; leader?: Partial<LeaderState> } = {}): GameState {
  return state({
    cards: F,
    players: {
      player: player({ leader: leader(leaderId, over.leader), hand: over.hand ?? [], units: mine, resources: ready(over.resources ?? 10), ...(over.deck ? { deck: over.deck } : {}) }),
      opponent: player({ units: theirs }),
    },
  })
}
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const find = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)!
const deploys = (s: GameState) => legalMoves(s).filter((m): m is Extract<Action, { type: 'deployLeader' }> => m.type === 'deployLeader')
const deployOnto = (s: GameState, hostId: string): GameState => resolve(s, { type: 'deployLeader', targetInstanceId: hostId })
const leaderOnHost = { cardId: 'JTL_006', owner: 'player', unitCard: true }

describe('Deploying a leader as a Pilot upgrade', () => {
  it('is offered onto each friendly Vehicle with room for a Pilot, beside the deploy as a unit', () => {
    const s = board('JTL_006', [unit('v', 'FIGHTER'), unit('p', 'FIGHTER', { upgrades: [{ cardId: 'JTL_108', owner: 'player', unitCard: true }] }), unit('g', 'GRD')], [unit('e', 'FIGHTER')])
    expect(deploys(s)).toEqual([{ type: 'deployLeader' }, { type: 'deployLeader', targetInstanceId: 'v' }])
  })

  it('is not offered to a leader without a Pilot side, nor before the leader can deploy', () => {
    expect(deploys(board('ALL_L', [unit('v', 'FIGHTER')]))).toEqual([{ type: 'deployLeader' }])
    expect(deploys(board('JTL_006', [unit('v', 'FIGHTER')], [], { resources: 5 }))).toEqual([])
  })

  it('attaches the leader to the host, which gets its upgrade stats and becomes a leader unit', () => {
    const s = deployOnto(board('JTL_006', [unit('v', 'FIGHTER')]), 'v')
    expect(find(s, 'v').upgrades).toEqual([leaderOnHost])
    expect(s.players.player.leader).toMatchObject({ deployed: true, epicActionUsed: true })
    expect(s.players.player.units.some(u => u.isLeader)).toBe(false)
    expect(effectivePower(s, find(s, 'v'))).toBe(3 + 5)
    expect(effectiveHp(s, find(s, 'v'))).toBe(5 + 5)
    expect(isLeaderUnit(s, find(s, 'v'))).toBe(true)
  })

  it('fires "When deployed as an upgrade", and the deploy as a unit does not', () => {
    const tie = (s: GameState) => s.players.player.units.filter(u => u.cardId === TOKEN_TIE_FIGHTER).length
    expect(tie(deployOnto(board('JTL_006', [unit('v', 'FIGHTER')]), 'v'))).toBe(2)
    expect(tie(resolve(board('JTL_006', [unit('v', 'FIGHTER')]), { type: 'deployLeader' }))).toBe(0)
  })

  it('sends the leader back to its base zone exhausted when its host is defeated, and it cannot deploy again', () => {
    const s = defeatUnit(deployOnto(board('JTL_006', [unit('v', 'FIGHTER')]), 'v'), 'v')
    expect(s.players.player.leader).toMatchObject({ deployed: false, exhausted: true, epicActionUsed: true })
    expect(s.players.player.discard).toEqual(['FIGHTER'])
    expect(deploys({ ...s, activePlayer: 'player' })).toEqual([])
  })

  it('sends the leader back to its base zone when the upgrade itself is defeated or returned to hand', () => {
    const deployed = deployOnto(board('JTL_006', [unit('v', 'FIGHTER')]), 'v')
    for (const after of [defeatUpgradeAt(deployed, 'v', 0), returnUpgradeToHand(deployed, 'v', 0)]) {
      expect(find(after, 'v').upgrades).toEqual([])
      expect(after.players.player.leader).toMatchObject({ deployed: false, exhausted: true })
      expect(after.players.player.discard).toEqual([])
      expect(after.players.player.hand).toEqual([])
    }
  })

  it('sends the leader back to its base zone when its host returns to hand', () => {
    const s = returnUnitToHand(deployOnto(board('JTL_006', [unit('v', 'FIGHTER')]), 'v'), 'v')
    expect(s.players.player.hand).toEqual(['FIGHTER'])
    expect(s.players.player.leader).toMatchObject({ deployed: false, exhausted: true })
  })

  it('is described with its host', () => {
    const s = board('JTL_006', [unit('v', 'FIGHTER')])
    expect(describeAction(s, 'player', { type: 'deployLeader', targetInstanceId: 'v' })).toBe(`Deploy Darth Vader as a Pilot on ${F.FIGHTER.name}`)
    expect(describeAction(s, 'player', { type: 'deployLeader' })).toBe('Deploy Darth Vader')
  })

  it('counts as a deployed leader for play coverage', () => {
    const cov = newCoverage()
    observeState(cov, deployOnto(board('JTL_006', [unit('v', 'FIGHTER')]), 'v'))
    expect(cov.leadersDeployed.has('JTL_006')).toBe(true)
    expect(cov.played.has('JTL_006')).toBe(false)
  })
})

const choice = (s: GameState): PendingChoice | undefined => s.pendingChoices?.[0]
const accept = (s: GameState, extra: Partial<Extract<Action, { type: 'acceptChoice' }>> = {}): GameState =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s)!.id, ...extra })
const skip = (s: GameState): GameState => resolve(s, { type: 'skipTrigger', choiceId: choice(s)!.id })
const front = (s: GameState): GameState => resolve(s, { type: 'useLeaderAbility', index: 0 })
const canFront = (s: GameState): boolean => legalMoves(s).some(m => m.type === 'useLeaderAbility')
const attackBase = (s: GameState, attackerId: string): GameState => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
/** Back to the player after an action passed the turn, to look at what they may do next. */
const mine = (s: GameState): GameState => ({ ...s, activePlayer: 'player' })
const candidateIds = (s: GameState): string[] => (choice(s) as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId)
/** A host with the board's leader already deployed onto it. */
const withPilot = (instanceId: string, cardId: string, leaderId: string): UnitState =>
  unit(instanceId, cardId, { upgrades: [{ cardId: leaderId, owner: 'player', unitCard: true }] })
const deployed = { leader: { deployed: true, epicActionUsed: true } }
const losingAbilities = (s: GameState): string[] => (s.lastingEffects ?? []).filter(e => e.losesAllAbilities).map(e => e.targetInstanceId!)

describe('JTL_001 Asajj Ventress', () => {
  it('front: 1 damage to a friendly unit, then 1 to an enemy unit in the same arena', () => {
    const s = front(board('JTL_001', [unit('g', 'GRD'), unit('v', 'FIGHTER')], [unit('eg', 'GRD'), unit('es', 'SPC')]))
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', targets: ['g', 'v'] })
    const hit = accept(s, { targetInstanceId: 'g' })
    expect(find(hit, 'g').damage).toBe(1)
    expect(choice(hit)).toMatchObject({ kind: 'selectDamageTarget', amount: 1, unitTargets: ['eg'] })
    expect(find(accept(hit, { targetInstanceId: 'eg' }), 'eg').damage).toBe(1)
  })

  it('Grit as a unit; as a Pilot the host gains Grit and the optional On Attack', () => {
    const asUnit = board('JTL_001', [unit('L', 'JTL_001', { isLeader: true })], [], deployed)
    expect(unitHasKeyword(asUnit, find(asUnit, 'L'), 'Grit')).toBe(true)
    const s = board('JTL_001', [withPilot('v', 'FIGHTER', 'JTL_001'), unit('s2', 'SPC')], [unit('es', 'SPC')], deployed)
    expect(unitHasKeyword(s, find(s, 'v'), 'Grit')).toBe(true)
    expect(choice(attackBase(s, 'v'))).toMatchObject({ kind: 'selectUnitThen', optional: true, targets: ['v', 's2'] })
  })
})

describe('JTL_003 Lando Calrissian', () => {
  it('front: play a card from hand, then a Shield to a unit if you control a ground and a space unit', () => {
    const s = front(board('JTL_003', [unit('g', 'GRD'), unit('v', 'FIGHTER')], [], { hand: ['EV', 'GRD'] }))
    expect(choice(s)).toMatchObject({ kind: 'playCardFrom', zone: 'hand' })
    expect(candidateIds(s)).toEqual(['EV', 'GRD'])
    const played = accept(s, { optionIndex: 0 })
    expect(played.players.player.discard).toContain('EV')
    expect(choice(played)).toMatchObject({ kind: 'mayGiveTokens', token: TOKEN_SHIELD, optional: false })
    const spaceOnly = accept(front(board('JTL_003', [unit('v', 'FIGHTER')], [], { hand: ['EV'] })), { optionIndex: 0 })
    expect(choice(spaceOnly)).toBeUndefined()
  })

  it('as a Pilot: the host gains Sentinel, and he may give a Shield to a unit in a different arena', () => {
    const s = deployOnto(board('JTL_003', [unit('v', 'FIGHTER'), unit('g', 'GRD'), unit('s2', 'SPC')], [unit('eg', 'GRD')]), 'v')
    expect(unitHasKeyword(s, find(s, 'v'), 'Sentinel')).toBe(true)
    expect(choice(s)).toMatchObject({ kind: 'mayGiveTokens', optional: true, targets: ['g', 'eg'] })
  })
})

describe('JTL_006 Darth Vader', () => {
  it('front: a TIE Fighter once you have attacked with a non-token Vehicle this phase', () => {
    const idle = board('JTL_006', [unit('v', 'FIGHTER')])
    expect(canFront(idle)).toBe(false)
    const attacked = mine(attackBase(idle, 'v'))
    expect(canFront(attacked)).toBe(true)
    expect(front(attacked).players.player.units.filter(u => u.cardId === TOKEN_TIE_FIGHTER)).toHaveLength(1)
  })
})

describe('JTL_008 Wedge Antilles', () => {
  it('front: play a card from hand using Piloting, for 1 less', () => {
    const s = front(board('JTL_008', [unit('v', 'FIGHTER'), unit('g', 'GRD')], [], { hand: ['JTL_108', 'GRD'] }))
    expect(choice(s)).toMatchObject({ kind: 'playCardFrom', zone: 'hand', piloting: true, costDelta: -1 })
    expect(candidateIds(s)).toEqual(['JTL_108'])
    const pick = accept(s, { optionIndex: 0 })
    expect(choice(pick)).toMatchObject({ kind: 'attachPlayedCard', targets: ['v'] })
    const done = accept(pick, { targetInstanceId: 'v' })
    expect(find(done, 'v').upgrades).toEqual([{ cardId: 'JTL_108', owner: 'player', unitCard: true }])
    const readyCount = (st: GameState) => st.players.player.resources.filter(r => !r.exhausted).length
    expect(readyCount(s) - readyCount(done)).toBe(effectiveCost(s, 'player', F.JTL_108, find(s, 'v'), undefined, F.JTL_108.piloting) - 1)
  })

  it('as a Pilot: On Attack, the next Pilot card you play this phase costs 1 less', () => {
    const s = board('JTL_008', [withPilot('v', 'FIGHTER', 'JTL_008'), unit('v2', 'FIGHTER')], [], { hand: ['JTL_108'], ...deployed })
    const piloting = (st: GameState) => effectiveCost(st, 'player', F.JTL_108, find(st, 'v2'), undefined, F.JTL_108.piloting)
    expect(piloting(mine(attackBase(s, 'v')))).toBe(piloting(s) - 1)
  })
})

describe('JTL_009 Boba Fett', () => {
  it('as a Pilot: up to 4 damage divided among any number of units', () => {
    const s = deployOnto(board('JTL_009', [unit('v', 'FIGHTER')], [unit('e', 'GRD')]), 'v')
    expect(choice(s)).toMatchObject({ kind: 'distributeDamage', total: 4, remaining: 4, targets: ['v', 'e'] })
    expect(legalMoves(s)).toContainEqual({ type: 'skipTrigger', choiceId: choice(s)!.id })
  })
})

describe('JTL_011 Major Vonreg', () => {
  it('front: play a Vehicle unit from hand, then give another unit +1/+0 for this phase', () => {
    const s = front(board('JTL_011', [unit('g', 'GRD')], [], { hand: ['GRD', 'FIGHTER'] }))
    expect(candidateIds(s)).toEqual(['FIGHTER'])
    const played = accept(s, { optionIndex: 0 })
    expect(played.players.player.units.map(u => u.cardId)).toContain('FIGHTER')
    expect(choice(played)).toMatchObject({ kind: 'mayLastingBuff', power: 1, targets: ['g'] })
  })

  it('as a Pilot: On Attack, may give another unit in this arena +1/+0', () => {
    const s = attackBase(board('JTL_011', [withPilot('v', 'FIGHTER', 'JTL_011'), unit('s2', 'SPC'), unit('g', 'GRD')], [], deployed), 'v')
    expect(choice(s)).toMatchObject({ kind: 'mayLastingBuff', power: 1, optional: true, targets: ['s2'] })
  })
})

describe('JTL_012 Luke Skywalker', () => {
  it('front: 1 damage to a unit once you have attacked with a Fighter this phase', () => {
    const idle = board('JTL_012', [unit('v', 'FIGHTER'), unit('g', 'GRD')], [unit('e', 'GRD')])
    expect(canFront(idle)).toBe(false)
    expect(choice(front(mine(attackBase(idle, 'v'))))).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
  })

  it('as a Pilot: a Fighter host gains "On Attack: You may deal 3 damage to a unit", a Transport does not', () => {
    const fighter = attackBase(board('JTL_012', [withPilot('v', 'FIGHTER', 'JTL_012')], [unit('e', 'GRD')], deployed), 'v')
    expect(choice(fighter)).toMatchObject({ kind: 'selectDamageTarget', amount: 3, optional: true })
    const transport = attackBase(board('JTL_012', [withPilot('t', 'TRANSPORT', 'JTL_012')], [unit('e', 'GRD')], deployed), 't')
    expect(choice(transport)).toBeUndefined()
  })

  it("as a Pilot: can't be defeated by an enemy card ability", () => {
    const s = board('JTL_012', [withPilot('v', 'FIGHTER', 'JTL_012')], [], deployed)
    expect(find(defeatUpgradeAt({ ...s, resolvingSource: { cardId: 'GRD', controller: 'opponent' } }, 'v', 0), 'v').upgrades).toHaveLength(1)
    expect(find(defeatUpgradeAt({ ...s, resolvingSource: { cardId: 'GRD', controller: 'player' } }, 'v', 0), 'v').upgrades).toHaveLength(0)
  })
})

describe('JTL_013 Poe Dameron', () => {
  it('front: pay 1 to flip him and attach him to a friendly Vehicle without a Pilot', () => {
    const s = front(board('JTL_013', [unit('v', 'FIGHTER'), unit('p', 'FIGHTER', { upgrades: [{ cardId: 'JTL_108', owner: 'player', unitCard: true }] }), unit('g', 'GRD')]))
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', targets: ['v'] })
    const done = accept(s, { targetInstanceId: 'v' })
    expect(find(done, 'v').upgrades).toEqual([{ cardId: 'JTL_013', owner: 'player', unitCard: true }])
    expect(done.players.player.leader).toMatchObject({ deployed: true, epicActionUsed: false })
    expect(isLeaderUnit(done, find(done, 'v'))).toBe(true)
  })

  it('as a Pilot: pay 1 to move him to another friendly Vehicle without a Pilot, once each round', () => {
    const s = board('JTL_013', [withPilot('v', 'FIGHTER', 'JTL_013'), unit('v2', 'FIGHTER'), unit('g', 'GRD')], [], deployed)
    const move = (st: GameState) => legalMoves(st).find(m => m.type === 'useAbility' && m.cardId === upgradeSideId('JTL_013'))
    const asked = resolve(s, move(s)!)
    expect(choice(asked)).toMatchObject({ kind: 'selectUnitThen', targets: ['v2'] })
    const moved = mine(accept(asked, { targetInstanceId: 'v2' }))
    expect(find(moved, 'v2').upgrades.map(u => u.cardId)).toEqual(['JTL_013'])
    expect(move(moved)).toBeUndefined()
  })
})

describe('JTL_015 Rio Durant', () => {
  it('front: pay 1 to attack with a space unit, which gets +1/+0 and Saboteur for the attack', () => {
    const s = front(board('JTL_015', [unit('v', 'FIGHTER'), unit('g', 'GRD')], [unit('es', 'SENT')]))
    expect(choice(s)).toMatchObject({ kind: 'mayAttackAnyUnit', attacker: { arena: 'space' } })
    const hit = resolve(s, { type: 'attack', attackerId: 'v', target: { kind: 'base' }, choiceId: choice(s)!.id })
    expect(hit.players.opponent.base.damage).toBe(4)
  })

  it('as a Pilot: the host gains Saboteur, and +1/+0 on a Transport', () => {
    const s = board('JTL_015', [withPilot('v', 'FIGHTER', 'JTL_015'), withPilot('t', 'TRANSPORT', 'JTL_015')], [], deployed)
    expect(unitHasKeyword(s, find(s, 'v'), 'Saboteur')).toBe(true)
    expect(effectivePower(s, find(s, 'v'))).toBe(3 + 3)
    expect(effectivePower(s, find(s, 't'))).toBe(3 + 3 + 1)
  })
})

describe('JTL_017 Han Solo', () => {
  it('front: reveal the top card, then attack; +1/+0 when it and the attacker have different odd costs', () => {
    const run = (attacker: string) => {
      const s = front(board('JTL_017', [unit('v', 'FIGHTER'), unit('t', 'TRANSPORT')], [], { deck: ['ODD3'] }))
      return resolve(s, { type: 'attack', attackerId: attacker, target: { kind: 'base' }, choiceId: choice(s)!.id }).players.opponent.base.damage
    }
    expect(run('v')).toBe(3) // 3 and 3: the same odd cost
    expect(run('t')).toBe(4) // 3 and 5
  })

  it('as a Pilot: ready a resource for each friendly unit or upgrade with an odd cost', () => {
    const s0 = board('JTL_017', [unit('v', 'FIGHTER'), unit('g', 'GRD'), unit('o', 'ODD1', { upgrades: [{ cardId: 'UPG3', owner: 'player' }] })], [unit('e', 'ODD1')])
    const spent = { ...s0, players: { ...s0.players, player: { ...s0.players.player, resources: ready(10).map(r => ({ ...r, exhausted: true })) } } }
    // FIGHTER (3), ODD1 (1) and UPG3 (3); GRD costs 2, the enemy unit is not friendly, and Han is a leader.
    expect(deployOnto(spent, 'v').players.player.resources.filter(r => !r.exhausted)).toHaveLength(3)
  })
})

describe('JTL_018 Kazuda Xiono', () => {
  it('front: a friendly unit loses all abilities for this round, and you take an extra action', () => {
    const s = front(board('JTL_018', [unit('g', 'GRD'), unit('g2', 'GRD')], [unit('e', 'GRD')]))
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', targets: ['g', 'g2'] })
    const done = accept(s, { targetInstanceId: 'g' })
    expect(losingAbilities(done)).toEqual(['g'])
    expect(done.activePlayer).toBe('player')
    expect(resolve(done, { type: 'pass' }).activePlayer).toBe('opponent')
  })

  it('On Attack, as a unit and as a Pilot: any number of friendly units lose all abilities for this round', () => {
    const asUnit = board('JTL_018', [unit('L', 'JTL_018', { isLeader: true }), unit('g', 'GRD'), unit('g2', 'GRD')], [], deployed)
    const asPilot = board('JTL_018', [withPilot('L', 'SPEEDER', 'JTL_018'), unit('g', 'GRD'), unit('g2', 'GRD')], [], deployed)
    for (const s of [asUnit, asPilot]) {
      const first = attackBase(s, 'L')
      expect(choice(first)).toMatchObject({ kind: 'selectUnitThen', optional: true, targets: ['L', 'g', 'g2'] })
      const second = accept(first, { targetInstanceId: 'g' })
      expect(choice(second)).toMatchObject({ targets: ['L', 'g2'] })
      const done = skip(second)
      expect(choice(done)).toBeUndefined()
      expect(losingAbilities(done)).toEqual(['g'])
    }
  })
})
