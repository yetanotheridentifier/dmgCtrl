import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit } from '../engine/combat'
import { normaliseCard } from '../engine/cardDb'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { effectivePower } from '../engine/stats'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, LeaderState, PendingChoice, PlayerId, UnitState } from '../engine/types'

/**
 * Cards registered against Bounty (#467): the primitive itself is `bounty.test.ts`. Each test here
 * checks the registration's own filter/amount, not the primitive (already covered).
 */

const POOL = poolFor(['SHD'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the SHD fixture`)
  return normaliseCard(row)
}
const SHIPPED = [
  'SHD_027', 'SHD_095', 'SHD_134', 'SHD_195', 'SHD_116', 'SHD_125', 'SHD_167', 'SHD_211', 'SHD_185',
  'SHD_221', 'SHD_068', 'SHD_176', 'SHD_261', 'SHD_071', 'SHD_173', 'SHD_033', 'SHD_165',
  'SHD_117', 'SHD_140', 'SHD_216', 'SHD_138', 'SHD_139', 'SHD_010', 'SHD_186',
]
const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 8, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  GRD: src('GRD'),
  GRD2: src('GRD2'),
  WEAK_DEF: src('WEAK_DEF', { power: 1, hp: 6 }),
  UNQ: card({ id: 'UNQ', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, unique: true }),
  UPG_BOUNTY: card({ id: 'UPG_BOUNTY', type: 'upgrade', cost: 1 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)
type Side = Parameters<typeof player>[0]
const rich = (over: Side = {}) => player({ resources: ready(20), deck: [], ...over })
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })

const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = { targetInstanceId?: string; optionIndex?: number; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
/** Defeat `id` and accept the resulting "collect this Bounty?" choice (its only pending one). */
const collectBounty = (s: GameState, id: string, extra: Extra = {}) => accept(defeatUnit(s, id), extra)

describe('Bounty rewards printed on the unit itself', () => {
  it('SHD_027 Hylobon Enforcer / SHD_095 / SHD_134 / SHD_195: draw a card for the opponent, collected by them', () => {
    for (const id of ['SHD_027', 'SHD_095', 'SHD_134', 'SHD_195']) {
      const s = board({ units: [unit('tgt', id)] }, { deck: ['GRD'] })
      const defeated = defeatUnit(s, 'tgt')
      expect(choice(defeated).controller, id).toBe('opponent')
      const done = accept(defeated)
      expect(done.players.opponent.hand, id).toHaveLength(1)
      expect(done.players.player.hand, id).toHaveLength(0)
    }
  })

  it('SHD_116 Outlaw Corona: the top card of the collector\'s deck enters play as a resource', () => {
    const s = board({ units: [unit('tgt', 'SHD_116')], deck: ['GRD'] }, { deck: ['GRD2'] })
    const done = collectBounty(s, 'tgt')
    expect(done.players.opponent.resources.map(r => r.cardId)).toContain('GRD2')
    expect(done.players.opponent.deck).toHaveLength(0)
  })

  it('SHD_167 Wanted Insurgents: deal 2 damage to a unit either side, chosen by the collector', () => {
    const s = board({ units: [unit('tgt', 'SHD_167')] }, { units: [unit('e', 'GRD')] })
    const collected = accept(defeatUnit(s, 'tgt')) // collect the Bounty first
    expect(choice(collected)).toMatchObject({ kind: 'selectDamageTarget', amount: 2, controller: 'opponent' })
    const done = accept(collected, { targetInstanceId: 'e' })
    expect(U(done, 'e')?.damage).toBe(2)
  })

  it('SHD_211 Fugitive Wookiee: exhaust a unit either side, chosen by the collector', () => {
    const s = board({ units: [unit('tgt', 'SHD_211')] }, { units: [unit('e', 'GRD', { exhausted: false })] })
    const collected = accept(defeatUnit(s, 'tgt'))
    const done = accept(collected, { targetInstanceId: 'e' })
    expect(U(done, 'e')?.exhausted).toBe(true)
  })

  it('SHD_185 Doctor Evazan: readies every exhausted resource the collector has, up to 12, no choice', () => {
    const s = board({ units: [unit('tgt', 'SHD_185')] }, { resources: ready(5).map(r => ({ ...r, exhausted: true })) })
    const done = collectBounty(s, 'tgt')
    expect(done.players.opponent.resources.every(r => !r.exhausted)).toBe(true)
  })
})

describe('Bounty rewards granted by an attached upgrade', () => {
  it('an upgrade with its own Bounty fires for its host, independent of the host\'s own printed one', () => {
    const s = board({ units: [unit('tgt', 'SHD_027', { upgrades: [{ cardId: 'SHD_221', owner: 'player' }] })] }, { deck: ['GRD'], resources: ready(3).map(r => ({ ...r, exhausted: true })) })
    let next = defeatUnit(s, 'tgt')
    expect(choice(next).kind).toBe('chooseNextTrigger') // two sources on one unit: CR 7.6.9 order
    next = accept(next)
    next = accept(next) // first source
    next = accept(next) // second source
    expect(next.players.opponent.hand).toHaveLength(1) // SHD_027's own "draw a card"
    expect(next.players.opponent.resources.some(r => !r.exhausted)).toBe(true) // SHD_221's own "ready 2"
  })

  it('SHD_068 Public Enemy: gives a Shield token to a unit either side', () => {
    const s = board({ units: [unit('tgt', 'GRD', { upgrades: [{ cardId: 'SHD_068', owner: 'player' }] })] }, { units: [unit('e', 'GRD2') ] })
    const collected = accept(defeatUnit(s, 'tgt'))
    const done = accept(collected, { targetInstanceId: 'e' })
    expect(U(done, 'e')?.upgrades.some(u => u.cardId.startsWith('TOKEN_SHIELD'))).toBe(true)
  })

  it('SHD_176 Death Mark: draw 2 cards for the collector', () => {
    const s = board({ units: [unit('tgt', 'GRD', { upgrades: [{ cardId: 'SHD_176', owner: 'player' }] })] }, { deck: ['GRD', 'GRD2'] })
    const done = collectBounty(s, 'tgt')
    expect(done.players.opponent.hand).toHaveLength(2)
  })

  it('SHD_261 Rich Reward: an Experience token to each of up to 2 units, one pick at a time', () => {
    const s = board({ units: [unit('tgt', 'GRD', { upgrades: [{ cardId: 'SHD_261', owner: 'player' }] })] }, { units: [unit('e1', 'GRD2'), unit('e2', 'UNQ')] })
    let next = defeatUnit(s, 'tgt')
    next = accept(next) // collect the Bounty
    next = accept(next, { targetInstanceId: 'e1' })
    next = accept(next, { targetInstanceId: 'e2' })
    expect(U(next, 'e1')?.upgrades.some(u => u.cardId.startsWith('TOKEN_EXPERIENCE'))).toBe(true)
    expect(U(next, 'e2')?.upgrades.some(u => u.cardId.startsWith('TOKEN_EXPERIENCE'))).toBe(true)
  })

  it('SHD_071 Top Target: heals 4, or 6 for a unique host, from a unit or base, the collector\'s choice', () => {
    const plain = board({ units: [unit('tgt', 'GRD', { upgrades: [{ cardId: 'SHD_071', owner: 'player' }], damage: 8 })] }, {})
    expect(choice(accept(defeatUnit(plain, 'tgt')))).toMatchObject({ amount: 4 })

    const uniq = board({ units: [unit('tgt', 'UNQ', { upgrades: [{ cardId: 'SHD_071', owner: 'player' }], damage: 2 })] }, {})
    expect(choice(accept(defeatUnit(uniq, 'tgt')))).toMatchObject({ amount: 6 })
  })

  it('SHD_173 Guild Target: deals 2, or 3 for a unique host, to either base', () => {
    const plain = board({ units: [unit('tgt', 'GRD', { upgrades: [{ cardId: 'SHD_173', owner: 'player' }] })] }, {})
    expect(choice(accept(defeatUnit(plain, 'tgt')))).toMatchObject({ amount: 2 })
    const uniq = board({ units: [unit('tgt', 'UNQ', { upgrades: [{ cardId: 'SHD_173', owner: 'player' }] })] }, {})
    expect(choice(accept(defeatUnit(uniq, 'tgt')))).toMatchObject({ amount: 3 })
  })

  it('SHD_125 Price on Your Head (upgrade): the same resource-from-deck reward as Outlaw Corona', () => {
    const s = board({ units: [unit('tgt', 'GRD', { upgrades: [{ cardId: 'SHD_125', owner: 'player' }] })], deck: [] }, { deck: ['GRD2'] })
    const done = collectBounty(s, 'tgt')
    expect(done.players.opponent.resources.map(r => r.cardId)).toContain('GRD2')
  })

  it('SHD_221 Wanted (upgrade): readies 2 of the collector\'s exhausted resources, no choice', () => {
    const s = board({ units: [unit('tgt', 'GRD', { upgrades: [{ cardId: 'SHD_221', owner: 'player' }] })] }, { resources: ready(3).map(r => ({ ...r, exhausted: true })) })
    const done = collectBounty(s, 'tgt')
    expect(done.players.opponent.resources.filter(r => !r.exhausted)).toHaveLength(2)
  })
})

describe('Bounty conditionally granted while exhausted', () => {
  it('SHD_033 Synara San: has a Bounty (deal 5 to a base) only while she is exhausted when she leaves play', () => {
    const readyBoard = board({ units: [unit('tgt', 'SHD_033', { exhausted: false })] }, {})
    expect(defeatUnit(readyBoard, 'tgt').pendingChoices ?? []).toHaveLength(0)
    const exhaustedBoard = board({ units: [unit('tgt', 'SHD_033', { exhausted: true })] }, {})
    const defeated = defeatUnit(exhaustedBoard, 'tgt')
    expect(choice(defeated).controller).toBe('opponent')
    const collected = accept(defeated) // collect the Bounty
    const done = accept(collected, { baseTarget: 'opponent' })
    expect(done.players.opponent.base.damage).toBe(5)
  })

  it('SHD_165 Unlicensed Headhunter: has a Bounty (heal 5 from the collector\'s base) only while exhausted', () => {
    const s = board({ units: [unit('tgt', 'SHD_165', { exhausted: true })] }, { base: { cardId: 'TST_B', damage: 8 } })
    const done = collectBounty(s, 'tgt')
    expect(done.players.opponent.base.damage).toBe(3)
  })
})

describe('Cards that only read "has a Bounty"', () => {
  it('SHD_117 Reputable Hunter: costs 1 less while an enemy unit has a Bounty', () => {
    const noBounty = board({}, { units: [unit('e', 'GRD')] })
    expect(effectiveCost(noBounty, 'player', F.SHD_117)).toBe(F.SHD_117.cost)
    const withBounty = board({}, { units: [unit('e', 'SHD_027')] })
    expect(effectiveCost(withBounty, 'player', F.SHD_117)).toBe(F.SHD_117.cost - 1)
  })

  it('SHD_140 Trandoshan Hunters: gives itself an Experience token When Played only if an enemy has a Bounty', () => {
    const s = board({ hand: ['SHD_140'] }, { units: [unit('e', 'SHD_027')] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const mine = played.players.player.units.find(u => u.cardId === 'SHD_140')
    expect(mine?.upgrades.some(u => u.cardId.startsWith('TOKEN_EXPERIENCE'))).toBe(true)
  })

  it('SHD_216 Chain Code Collector: the defender gets -4/-0 for this attack only while it has a Bounty', () => {
    // SHD_027 (power 1) has a Bounty: -4/-0 clamps its counter-damage to 0.
    const withBounty = board({ units: [unit('atk', 'SHD_216')] }, { units: [unit('def', 'SHD_027')] })
    const hit = resolve(withBounty, { type: 'attack', attackerId: 'atk', target: { kind: 'unit', instanceId: 'def' } })
    expect(U(hit, 'atk')?.damage ?? 0).toBe(0)
    // WEAK_DEF (power 1, no Bounty) deals its full power back.
    const noBounty = board({ units: [unit('atk2', 'SHD_216')] }, { units: [unit('def2', 'WEAK_DEF')] })
    const hit2 = resolve(noBounty, { type: 'attack', attackerId: 'atk2', target: { kind: 'unit', instanceId: 'def2' } })
    expect(U(hit2, 'atk2')?.damage).toBe(F.WEAK_DEF.power)
  })

  it('SHD_138 Jango Fett: +3/+0 and Overwhelm only while attacking a unit with a Bounty; draws on a kill', () => {
    // SHD_027 (power 1, hp 4, undamaged) needs 4 to kill. Jango's printed power alone (3) survives it;
    // only the Bounty bonus (+3/+0 = 6) both kills it AND, with the also-conditional Overwhelm, spills
    // the 2 excess to the opponent's base.
    const s = board({ units: [unit('atk', 'SHD_138')], deck: ['GRD'] }, { units: [unit('def', 'SHD_027')] })
    const attackedRaw = resolve(s, { type: 'attack', attackerId: 'atk', target: { kind: 'unit', instanceId: 'def' } })
    expect(U(attackedRaw, 'def')).toBeUndefined() // defeated
    expect(attackedRaw.players.opponent.base.damage).toBe(2) // Overwhelm's excess (6 power - 4 HP)
    // SHD_027 also has its OWN Bounty (defeated here, collected by 'player'), which nests ahead of
    // Jango's own onAttackEnd batch (CR 7.6.11) — decline it to isolate Jango's own draw.
    const attacked = skip(attackedRaw)
    expect(attacked.players.player.hand).toHaveLength(1) // "attacks and defeats a unit: draw a card"

    // WEAK_DEF (power 1, hp 6, no Bounty): Jango keeps his printed 3 power, no Overwhelm, survives.
    const plain = board({ units: [unit('atk2', 'SHD_138')] }, { units: [unit('def2', 'WEAK_DEF')] })
    const notAttacked = resolve(plain, { type: 'attack', attackerId: 'atk2', target: { kind: 'unit', instanceId: 'def2' } })
    expect(U(notAttacked, 'def2')?.damage).toBe(F.SHD_138.power)
    expect(notAttacked.players.opponent.base.damage).toBe(0)
  })

  it('SHD_139 Krrsantan: When Played may ready itself only if an enemy has a Bounty; On Attack may burn its own damage into a ground unit', () => {
    const noBounty = board({ hand: ['SHD_139'] }, {})
    const playedNoBounty = resolve(noBounty, { type: 'playUnit', handIndex: 0 })
    expect(playedNoBounty.pendingChoices ?? []).toHaveLength(0)

    const s = board({ hand: ['SHD_139'] }, { units: [unit('e', 'SHD_027')] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const mine = played.players.player.units.find(u => u.cardId === 'SHD_139')!
    const ready = accept(played)
    expect(U(ready, mine.instanceId)?.exhausted).toBe(false)
  })

  it('SHD_010 Bossk front: usable only while a unit has a Bounty; deals 1 damage to it, then may give it +1/+0 for the phase', () => {
    const undeployedBossk: LeaderState = { cardId: 'SHD_010', deployed: false, epicActionUsed: false, exhausted: false }
    const noBounty = board({ leader: undeployedBossk }, { units: [unit('e', 'GRD')] })
    expect(legalMoves(noBounty)).not.toContainEqual({ type: 'useLeaderAbility', index: 0 })

    // SHD_116 Outlaw Corona: has a Bounty and no Grit, so its power is unaffected by the damage Bossk
    // deals it, keeping this test's power reading about Bossk's own +1/+0 alone.
    const s = board({ leader: undeployedBossk }, { units: [unit('e', 'SHD_116')] })
    expect(legalMoves(s)).toContainEqual({ type: 'useLeaderAbility', index: 0 })
    const used = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(used.players.player.leader.exhausted).toBe(true)
    const damaged = accept(used, { targetInstanceId: 'e' })
    expect(U(damaged, 'e')?.damage).toBe(1)
    const coronaPower = F.SHD_116.power ?? 0
    const declined = skip(damaged)
    expect(effectivePower(declined, U(declined, 'e')!)).toBe(coronaPower)
    const buffed = accept(damaged, { targetInstanceId: 'e' })
    expect(effectivePower(buffed, U(buffed, 'e')!)).toBe(coronaPower + 1)
  })

  it('SHD_186 Hunter of the Haxion Brood: gains Shielded (and its entry Shield token) only while an enemy unit has a Bounty', () => {
    const noBounty = board({ hand: ['SHD_186'] }, { units: [unit('e', 'GRD')] })
    const playedNoBounty = resolve(noBounty, { type: 'playUnit', handIndex: 0 })
    const mineNoBounty = playedNoBounty.players.player.units.find(u => u.cardId === 'SHD_186')
    expect(mineNoBounty?.upgrades.some(u => u.cardId.startsWith('TOKEN_SHIELD'))).toBe(false)

    const withBounty = board({ hand: ['SHD_186'] }, { units: [unit('e', 'SHD_027')] })
    const played = resolve(withBounty, { type: 'playUnit', handIndex: 0 })
    const mine = played.players.player.units.find(u => u.cardId === 'SHD_186')
    expect(mine?.upgrades.some(u => u.cardId.startsWith('TOKEN_SHIELD'))).toBe(true)
  })
})
