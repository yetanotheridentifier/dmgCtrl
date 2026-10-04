import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { defeatUnit } from '../engine/combat'
import { normaliseCard } from '../engine/cardDb'
import { legalMoves } from '../engine/legalMoves'
import { effectiveHp, effectivePower } from '../engine/stats'
import { unitHasKeyword } from '../engine/keywords'
import { poolFor, SET_CODES } from '../bench/setPools'
import { describeAction } from '../utils/describeAction'
import { TOKEN_TIE_FIGHTER } from '../engine/tokenUnits'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, UnitState } from '../engine/types'

/**
 * Piloting: a Pilot unit card may instead be played as an upgrade on a friendly Vehicle without a
 * Pilot, for the cost and aspects in its own bracket. Attached, it adds its printed upgrade +X/+Y and
 * its upgrade side's abilities to the host; its unit side (printed keywords, unit-only abilities)
 * stays behind.
 */

const POOL = poolFor(SET_CODES)
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the bundled fixtures`)
  return normaliseCard(row)
}
const PILOTS = ['JTL_108', 'JTL_150', 'JTL_084', 'JTL_210', 'JTL_035', 'JTL_058', 'JTL_255']

const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(PILOTS.map(id => [id, real(id)])),
  VEH: card({ id: 'VEH', arena: 'space', cost: 3, power: 3, hp: 3, traits: ['Vehicle', 'Capital Ship'] }),
  VEH2: card({ id: 'VEH2', arena: 'space', cost: 3, power: 3, hp: 3, traits: ['Vehicle'] }),
  GRD: card({ id: 'GRD', arena: 'ground', cost: 2, power: 2, hp: 5 }),
  // Provides Command, so Clone Pilot's bracket costs no penalty.
  CMD_L: card({ id: 'CMD_L', type: 'leader', cost: 5, power: 4, hp: 7, aspects: ['Command', 'Villainy'] }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })

function board(hand: string[], mine: UnitState[], theirs: UnitState[] = [], resources = 6): GameState {
  return state({
    cards: F,
    players: {
      player: player({ leader: { cardId: 'CMD_L', deployed: false, epicActionUsed: false, exhausted: false }, hand, units: mine, resources: ready(resources) }),
      opponent: player({ units: theirs }),
    },
  })
}

const pilotMoves = (s: GameState): Extract<Action, { type: 'playUpgrade' }>[] =>
  legalMoves(s).filter((m): m is Extract<Action, { type: 'playUpgrade' }> => m.type === 'playUpgrade' && m.piloting === true)
const readyCount = (s: GameState) => s.players.player.resources.filter(r => !r.exhausted).length
/** Answer the player's first pending choice by picking `targetInstanceId`, if one is pending. */
const answer = (s: GameState, targetInstanceId: string): GameState => {
  const choice = s.pendingChoices?.find(c => c.controller === 'player')
  return choice ? resolve(s, { type: 'acceptChoice', choiceId: choice.id, targetInstanceId }) : s
}
const find = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!

describe('the Piloting bracket', () => {
  it('is read off the card with its cost, its aspects and the printed upgrade modifier', () => {
    const clone = real('JTL_108')
    expect(clone.piloting).toEqual({ cost: 2, aspects: ['Command'] })
    expect(clone.upgradePower).toBe(2)
    expect(clone.upgradeHp).toBe(2)
    expect(real('JTL_255').piloting).toEqual({ cost: 1, aspects: [] }) // Sullustan Spacer: no aspect icon
  })
})

describe('playing a Pilot as an upgrade', () => {
  it('is offered on a friendly Vehicle without a Pilot, and the unit play stays', () => {
    const s = board(['JTL_108'], [unit('v', 'VEH'), unit('g', 'GRD')], [unit('e', 'VEH2')])
    expect(pilotMoves(s).map(m => m.targetInstanceId)).toEqual(['v'])
    expect(legalMoves(s)).toContainEqual({ type: 'playUnit', handIndex: 0 })
  })

  it('is described as a Pilot play at the bracket cost', () => {
    const s = board(['JTL_084'], [unit('v', 'VEH')])
    expect(describeAction(s, 'player', pilotMoves(s)[0])).toBe('Play Wingman Victor Two as a Pilot (1) on VEH')
  })

  it('is not offered on a Vehicle that already has a Pilot', () => {
    const s = board(['JTL_108'], [unit('v', 'VEH', { upgrades: [{ cardId: 'JTL_255', owner: 'player', unitCard: true }] })])
    expect(pilotMoves(s)).toEqual([])
  })

  it('costs the bracket, not the printed cost', () => {
    // Wingman Victor Two: 2 as a unit, 1 as a pilot, Command Villainy both ways (the leader provides both).
    const s = board(['JTL_084'], [unit('v', 'VEH')], [], 3)
    expect(readyCount(resolve(s, pilotMoves(s)[0]))).toBe(2)
    expect(readyCount(resolve(s, { type: 'playUnit', handIndex: 0 }))).toBe(1)
  })

  it('attaches the card with its printed upgrade modifier', () => {
    const s = board(['JTL_108'], [unit('v', 'VEH')])
    const next = resolve(s, pilotMoves(s)[0])
    const v = find(next, 'v')
    expect(v.upgrades).toEqual([{ cardId: 'JTL_108', owner: 'player', unitCard: true }])
    expect(next.players.player.hand).toEqual([])
    expect(next.players.player.units.map(u => u.instanceId)).toEqual(['v'])
    expect(effectivePower(next, v)).toBe(5)
    expect(effectiveHp(next, v)).toBe(5)
  })

  it('charges the aspect penalty against the bracket aspects', () => {
    // Biggs prints Aggression Heroism on the card and on his bracket, cost 3 as a unit and 1 as a pilot.
    const s = board(['JTL_150'], [unit('v', 'VEH')], [], 6)
    const next = resolve(s, pilotMoves(s)[0])
    expect(readyCount(next)).toBe(6 - (1 + 4)) // two missing icons
  })

  it('leaves the unit side behind: printed keywords do not travel', () => {
    // Biggs prints Grit and Overwhelm; on a Capital Ship (no Fighter, Speeder or Transport) neither applies.
    const s = board(['JTL_150'], [unit('v', 'VEH')])
    const next = resolve(s, pilotMoves(s)[0])
    const v = find(next, 'v')
    expect(unitHasKeyword(next, v, 'Grit')).toBe(false)
    expect(unitHasKeyword(next, v, 'Overwhelm')).toBe(false)
  })

  it('goes to its owner\'s discard when the host is defeated', () => {
    const s = board(['JTL_108'], [unit('v', 'VEH')])
    const next = defeatUnit(resolve(s, pilotMoves(s)[0]), 'v')
    expect(next.players.player.discard).toContain('JTL_108')
  })
})

describe('the two "When played as" heads', () => {
  it('"When played as an upgrade" fires for the pilot play only (Wingman Victor Two)', () => {
    const s = board(['JTL_084'], [unit('v', 'VEH')])
    const asPilot = resolve(s, pilotMoves(s)[0])
    expect(asPilot.players.player.units.filter(u => u.cardId === TOKEN_TIE_FIGHTER)).toHaveLength(1)
    const asUnit = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(asUnit.players.player.units.filter(u => u.cardId === TOKEN_TIE_FIGHTER)).toHaveLength(0)
  })

  it('"When played as a unit" fires for the unit play only (The Mandalorian)', () => {
    const s = board(['JTL_210'], [unit('v', 'VEH')], [unit('e', 'GRD')], 10)
    const asUnit = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(asUnit.pendingChoices?.length ?? 0).toBeGreaterThan(0) // "exhaust up to 2 ground units"
    const asPilot = resolve(s, pilotMoves(s)[0])
    // As an upgrade it exhausts an enemy unit in the host's arena (space); the only enemy is on the ground.
    expect(find(asPilot, 'e').exhausted).toBe(false)
    expect(asPilot.pendingChoices ?? []).toEqual([])
  })
})

describe('the upgrade side\'s abilities belong to the host', () => {
  it('a granted On Attack fires for the host, and the unit side has none (Tam Ryvora)', () => {
    const s = board(['JTL_035'], [unit('v', 'VEH')], [unit('e', 'VEH2')])
    const piloted = resolve(s, pilotMoves(s)[0])
    const attacked = answer(resolve({ ...piloted, activePlayer: 'player' }, { type: 'attack', attackerId: 'v', target: { kind: 'base' } }), 'e')
    expect(effectivePower(attacked, find(attacked, 'e'))).toBe(2)

    const asUnit = state({ cards: F, players: { player: player({ units: [unit('t', 'JTL_035', { arena: 'ground' })] }), opponent: player({ units: [unit('e', 'GRD')] }) } })
    const attackedByUnit = resolve(asUnit, { type: 'attack', attackerId: 't', target: { kind: 'base' } })
    expect(attackedByUnit.pendingChoices ?? []).toEqual([])
    expect(effectivePower(attackedByUnit, find(attackedByUnit, 'e'))).toBe(2)
  })

  it('an "Attached unit gains <keyword>" applies to the host (Academy Graduate)', () => {
    const s = board(['JTL_058'], [unit('v', 'VEH')])
    const next = resolve(s, pilotMoves(s)[0])
    expect(unitHasKeyword(next, find(next, 'v'), 'Sentinel')).toBe(true)
  })
})
