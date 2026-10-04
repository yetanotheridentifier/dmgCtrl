import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { normaliseCard } from '../engine/cardDb'
import { legalMoves } from '../engine/legalMoves'
import { effectiveHp, effectivePower } from '../engine/stats'
import { isLeaderUnit, unitHasKeyword } from '../engine/keywords'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { TOKEN_X_WING } from '../engine/tokenUnits'
import { defeatUnit } from '../engine/combat'
import { defeatUpgradeAt } from '../engine/effects'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, LeaderState, PendingChoice, UnitState } from '../engine/types'

/**
 * Cards that change between a unit and an upgrade once in play: a unit attaching itself (or another
 * Pilot unit) to a Vehicle as an upgrade, and a Pilot upgrade leaving its host for the ground arena.
 */

const POOL = poolFor(['JTL'])
const real = (id: string): EngineCard => {
  const row = POOL.find(c => c.Set === 'JTL' && String(c.Number) === id.split('_')[1])
  if (!row) throw new Error(`${id} is not in the JTL fixture`)
  return normaliseCard(row)
}
const REAL = ['JTL_100', 'JTL_213', 'JTL_049', 'JTL_050', 'JTL_053', 'JTL_038', 'JTL_083', 'JTL_094', 'JTL_126', 'JTL_013']
const vehicle = (id: string, traits: string[], over: Partial<EngineCard> = {}) =>
  card({ id, arena: 'space', cost: 3, power: 3, hp: 5, traits: ['Vehicle', ...traits], ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(REAL.map(id => [id, real(id)])),
  FIGHTER: vehicle('FIGHTER', ['Fighter']),
  TRANSPORT: vehicle('TRANSPORT', ['Transport'], { cost: 5 }),
  SPEEDER: vehicle('SPEEDER', ['Speeder'], { arena: 'ground' }),
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 5 }),
  PIL: card({ id: 'PIL', arena: 'ground', cost: 2, power: 2, hp: 2, traits: ['Pilot'], upgradePower: 1, upgradeHp: 1 }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
  D1: card({ id: 'D1', arena: 'ground', cost: 1, power: 1, hp: 1 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const leader = (cardId: string, over: Partial<LeaderState> = {}): LeaderState =>
  ({ cardId, deployed: false, epicActionUsed: false, exhausted: false, ...over })

function board(mine: UnitState[], theirs: UnitState[] = [], over: { hand?: string[]; deck?: string[]; resources?: number; leader?: LeaderState } = {}): GameState {
  return state({
    cards: F,
    players: {
      player: player({ hand: over.hand ?? [], units: mine, resources: ready(over.resources ?? 10), deck: over.deck ?? ['D1', 'D1'], ...(over.leader ? { leader: over.leader } : {}) }),
      opponent: player({ units: theirs }),
    },
  })
}
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const find = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const byCard = (s: GameState, cardId: string) => all(s).filter(u => u.cardId === cardId)
const choice = (s: GameState): PendingChoice | undefined => s.pendingChoices?.[0]
const targets = (s: GameState): string[] => (choice(s) as { targets: string[] }).targets
const accept = (s: GameState, extra: Partial<Extract<Action, { type: 'acceptChoice' }>> = {}): GameState =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s)!.id, ...extra })
const skip = (s: GameState): GameState => resolve(s, { type: 'skipTrigger', choiceId: choice(s)!.id })
const playUnit = (s: GameState): GameState => resolve(s, { type: 'playUnit', handIndex: 0 })
const pilotOn = (cardId: string, owner: 'player' | 'opponent' = 'player') => ({ cardId, owner, unitCard: true })

describe('JTL_100 Poe Dameron', () => {
  it('as a unit: creates an X-Wing, then may attach himself to a friendly Vehicle without a Pilot', () => {
    const s = playUnit(board([unit('v', 'FIGHTER'), unit('p', 'FIGHTER', { upgrades: [pilotOn('PIL')] }), unit('g', 'GRD')], [unit('e', 'FIGHTER')], { hand: ['JTL_100'] }))
    const xwing = byCard(s, TOKEN_X_WING)[0]
    expect(xwing).toBeDefined()
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', optional: true })
    expect(targets(s).sort()).toEqual(['v', xwing.instanceId].sort())
    const done = accept(s, { targetInstanceId: 'v' })
    expect(byCard(done, 'JTL_100')).toEqual([])
    expect(find(done, 'v')!.upgrades).toEqual([pilotOn('JTL_100')])
    expect(effectivePower(done, find(done, 'v')!)).toBe(3 + 2)
    expect(effectiveHp(done, find(done, 'v')!)).toBe(5 + 3)
  })

  it('stays a unit when the attach is declined', () => {
    const s = skip(playUnit(board([unit('v', 'FIGHTER')], [], { hand: ['JTL_100'] })))
    expect(byCard(s, 'JTL_100')).toHaveLength(1)
    expect(find(s, 'v')!.upgrades).toEqual([])
  })
})

describe('JTL_213 Sidon Ithano', () => {
  it('as a unit: may attach himself to an enemy Vehicle without a Pilot, which gets -2/-2', () => {
    const s = playUnit(board([unit('v', 'FIGHTER')], [unit('e', 'FIGHTER'), unit('ep', 'FIGHTER', { upgrades: [pilotOn('PIL', 'opponent')] }), unit('eg', 'GRD')], { hand: ['JTL_213'] }))
    expect(targets(s)).toEqual(['e'])
    const done = accept(s, { targetInstanceId: 'e' })
    expect(byCard(done, 'JTL_213')).toEqual([])
    expect(find(done, 'e')!.upgrades).toEqual([pilotOn('JTL_213')])
    expect(effectivePower(done, find(done, 'e')!)).toBe(1)
    expect(effectiveHp(done, find(done, 'e')!)).toBe(3)
  })
})

describe('JTL_049 L3-37', () => {
  const l3 = unit('l3', 'JTL_049', { damage: 1, upgrades: [{ cardId: 'UPG', owner: 'player' }, { cardId: TOKEN_SHIELD, owner: 'player' }] })

  it('about to be defeated, may attach herself to a friendly Vehicle without a Pilot instead', () => {
    const s = defeatUnit(board([l3, unit('v', 'FIGHTER'), unit('p', 'FIGHTER', { upgrades: [pilotOn('PIL')] })], [unit('e', 'FIGHTER')]), 'l3')
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', optional: true, controller: 'player' })
    expect(targets(s)).toEqual(['v'])
    const done = accept(s, { targetInstanceId: 'v' })
    expect(find(done, 'v')!.upgrades).toEqual([pilotOn('JTL_049')])
    expect(byCard(done, 'JTL_049')).toEqual([])
    // Her upgrades are defeated; she is not.
    expect(done.players.player.discard).toEqual(['UPG'])
    expect(effectivePower(done, find(done, 'v')!)).toBe(3 + 3)
  })

  it('is defeated as usual when that is declined, or when there is no Vehicle to take her', () => {
    const declined = skip(defeatUnit(board([l3, unit('v', 'FIGHTER')]), 'l3'))
    expect(declined.players.player.discard.sort()).toEqual(['JTL_049', 'UPG'])
    expect(find(declined, 'v')!.upgrades).toEqual([])
    const none = defeatUnit(board([l3]), 'l3')
    expect(choice(none)).toBeUndefined()
    expect(none.players.player.discard.sort()).toEqual(['JTL_049', 'UPG'])
  })
})

describe('JTL_050 Phantom II', () => {
  const useIt = (s: GameState) => legalMoves(s).find(m => m.type === 'useAbility' && m.cardId === 'JTL_050')

  it('Action [1 resource]: attaches itself to The Ghost, which gets +3/+3 and Grit', () => {
    const s = board([unit('ph', 'JTL_050', { damage: 2 }), unit('gh', 'JTL_053')])
    const asked = resolve(s, useIt(s)!)
    expect(targets(asked)).toEqual(['gh'])
    const done = accept(asked, { targetInstanceId: 'gh' })
    expect(byCard(done, 'JTL_050')).toEqual([])
    const ghost = find(done, 'gh')!
    expect(ghost.upgrades).toEqual([pilotOn('JTL_050')])
    expect(effectivePower(done, ghost)).toBe(F.JTL_053.power! + 3)
    expect(effectiveHp(done, ghost)).toBe(F.JTL_053.hp! + 3)
    expect(unitHasKeyword(done, ghost, 'Grit')).toBe(true)
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(1)
  })

  it('is not offered without The Ghost in play', () => {
    expect(useIt(board([unit('ph', 'JTL_050'), unit('v', 'TRANSPORT')]))).toBeUndefined()
  })
})

describe('JTL_038 Corvus', () => {
  it('When Played: may attach a friendly Pilot unit to it', () => {
    const s = playUnit(board([unit('pil', 'PIL', { damage: 1 }), unit('g', 'GRD')], [unit('epil', 'PIL')], { hand: ['JTL_038'] }))
    expect(choice(s)).toMatchObject({ kind: 'selectUnitThen', optional: true })
    expect(targets(s)).toEqual(['pil'])
    const done = accept(s, { targetInstanceId: 'pil' })
    const corvus = byCard(done, 'JTL_038')[0]
    expect(corvus.upgrades).toEqual([pilotOn('PIL')])
    expect(find(done, 'pil')).toBeUndefined()
    expect(effectivePower(done, corvus)).toBe(F.JTL_038.power! + 1)
  })

  it('or moves a friendly Pilot upgrade from another unit to it', () => {
    const s = playUnit(board([unit('v', 'FIGHTER', { upgrades: [pilotOn('JTL_100')] })], [], { hand: ['JTL_038'] }))
    expect(targets(s)).toEqual(['v'])
    const done = accept(s, { targetInstanceId: 'v' })
    expect(find(done, 'v')!.upgrades).toEqual([])
    expect(byCard(done, 'JTL_038')[0].upgrades).toEqual([pilotOn('JTL_100')])
  })
})

describe('JTL_083 Pantoran Starship Thief', () => {
  const stolen = () => {
    const s = playUnit(board([unit('mine', 'FIGHTER', { upgrades: [pilotOn('PIL')] })], [unit('e', 'FIGHTER'), unit('t', 'TRANSPORT'), unit('sp', 'SPEEDER')], { hand: ['JTL_083'] }))
    expect(choice(s)).toMatchObject({ kind: 'mayPayThen', cost: 3 })
    const paid = accept(s)
    expect(spent(paid)).toBe(spent(s) + 3)
    expect(targets(paid).sort()).toEqual(['e', 't'])
    return accept(paid, { targetInstanceId: 'e' })
  }
  const spent = (s: GameState) => s.players.player.resources.filter(r => r.exhausted).length

  it('may pay 3 to attach itself to a Fighter or Transport without a Pilot and take control of it', () => {
    const s = stolen()
    expect(s.players.player.units.map(u => u.instanceId)).toContain('e')
    expect(find(s, 'e')!.upgrades).toEqual([pilotOn('JTL_083')])
    expect(byCard(s, 'JTL_083')).toEqual([])
  })

  it('hands the unit back to its owner when the thief detaches', () => {
    const s = stolen()
    const defeated = resolve({ ...defeatUpgradeAt(s, 'e', 0), activePlayer: 'player' }, { type: 'pass' })
    expect(defeated.players.opponent.units.map(u => u.instanceId)).toContain('e')
    expect(defeated.players.player.discard).toContain('JTL_083')
  })
})

describe('JTL_094 Luke Skywalker', () => {
  it('as an upgrade about to be defeated, moves to the ground arena as an exhausted unit instead', () => {
    const s = defeatUpgradeAt(board([unit('v', 'FIGHTER', { upgrades: [pilotOn('JTL_094')] })]), 'v', 0)
    expect(find(s, 'v')!.upgrades).toEqual([])
    expect(byCard(s, 'JTL_094')).toEqual([expect.objectContaining({ arena: 'ground', exhausted: true, damage: 0, isLeader: false })])
    expect(s.players.player.discard).toEqual([])
  })

  it('does the same when his host is defeated', () => {
    const s = defeatUnit(board([unit('v', 'FIGHTER', { upgrades: [pilotOn('JTL_094')] })]), 'v')
    expect(s.players.player.discard).toEqual(['FIGHTER'])
    expect(byCard(s, 'JTL_094')).toEqual([expect.objectContaining({ arena: 'ground', exhausted: true })])
  })
})

describe('JTL_126 Eject', () => {
  const play = (s: GameState) => resolve(s, { type: 'playEvent', handIndex: 0 })

  it('detaches a Pilot upgrade, moves it to the ground arena as an exhausted unit under its owner, and draws a card', () => {
    const s = play(board([unit('v', 'FIGHTER', { upgrades: [{ cardId: 'UPG', owner: 'player' }, pilotOn('PIL')] })], [unit('e', 'FIGHTER', { upgrades: [pilotOn('JTL_100', 'opponent')] })], { hand: ['JTL_126'] }))
    expect(choice(s)).toMatchObject({ kind: 'selectUpgradeThen' })
    expect((choice(s) as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId)).toEqual(['PIL', 'JTL_100'])
    const done = accept(s, { optionIndex: 1 })
    expect(find(done, 'e')!.upgrades).toEqual([])
    expect(done.players.opponent.units.filter(u => u.cardId === 'JTL_100')).toEqual([expect.objectContaining({ arena: 'ground', exhausted: true })])
    expect(done.players.player.hand).toEqual(['D1'])
  })

  it('ejects a Pilot leader as its leader unit', () => {
    const s = play(board([unit('v', 'FIGHTER', { upgrades: [pilotOn('JTL_013')] })], [], { hand: ['JTL_126'], leader: leader('JTL_013', { deployed: true, epicActionUsed: true }) }))
    const done = accept(s, { optionIndex: 0 })
    const poe = byCard(done, 'JTL_013')
    expect(poe).toEqual([expect.objectContaining({ isLeader: true, arena: 'ground', exhausted: true })])
    expect(isLeaderUnit(done, poe[0])).toBe(true)
    expect(isLeaderUnit(done, find(done, 'v')!)).toBe(false)
    expect(done.players.player.leader).toMatchObject({ deployed: true })
  })

  it('still draws with no Pilot upgrade in play', () => {
    const s = play(board([unit('v', 'FIGHTER')], [], { hand: ['JTL_126'] }))
    expect(choice(s)).toBeUndefined()
    expect(s.players.player.hand).toEqual(['D1'])
  })
})
