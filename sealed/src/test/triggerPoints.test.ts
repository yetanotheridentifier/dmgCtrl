import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import { drawCards, dealDamageToBase } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import { unitHasKeyword } from '../engine/keywords'
import { effectiveCost } from '../engine/legalMoves'
import { registerCard } from '../engine/abilities'
import type { GameState, PendingChoice, PlayerId } from '../engine/types'

/**
 * Ticket #474's first two groups. Both read events the engine ALREADY dispatches, so nothing here
 * adds a trigger point: the work is the context those points carry.
 *
 * - "When this unit is dealt damage and survives" is `whenDamageDealt` with its survivors filtered
 *   to the registering unit. Tarfful is the only one that needs more, and only `byCombat`.
 * - "When this unit deals combat damage to a base" is `onAttackEnd` with `ctx.combatDamageToBase`,
 *   which is the attacker itself and combat damage only. Populist Advisor reads the same event from
 *   the far side (`whenDamageDealt` on its own base), and Sabé's front reads it for any friendly attacker
 *   (`whenFriendlyAttackEnds`).
 */
const F = {
  ...CARDS,
  // Group A — "when this unit is dealt damage and survives"
  HMW_156: card({ id: 'HMW_156', name: 'Arena Acklay', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 6, traits: ['Creature'] }),
  HMW_166: card({ id: 'HMW_166', name: 'Gungi', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 5, traits: ['Force', 'Jedi', 'Wookiee'], keywords: [{ name: 'Grit' }] }),
  HMW_169: card({ id: 'HMW_169', name: 'Crosshair', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 6, traits: ['Clone'] }),
  HMW_211: card({ id: 'HMW_211', name: 'Tech', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 5, traits: ['Clone'] }),
  SHD_250: card({ id: 'SHD_250', name: 'Tarfful', type: 'unit', arena: 'ground', cost: 7, power: 3, hp: 9, traits: ['Wookiee'], keywords: [{ name: 'Restore', value: 2 }] }),
  // Group B — "when this unit deals combat damage to a base"
  LOF_166: card({ id: 'LOF_166', name: 'Blockade Runner', type: 'unit', arena: 'space', cost: 5, power: 4, hp: 4, traits: ['Rebel', 'Vehicle'], keywords: [{ name: 'Saboteur' }] }),
  SEC_041: card({ id: 'SEC_041', name: 'Populist Advisor', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 4, traits: ['New Republic', 'Official'], keywords: [{ name: 'Sentinel' }] }),
  SEC_147: card({ id: 'SEC_147', name: 'Chopper', type: 'unit', arena: 'ground', cost: 2, power: 4, hp: 1, traits: ['Rebel', 'Droid'] }),
  SEC_150: card({ id: 'SEC_150', name: 'Valiant Commando', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 3, traits: ['Rebel', 'Trooper'] }),
  SEC_205: card({ id: 'SEC_205', name: 'Obi-Wan Kenobi', type: 'unit', arena: 'ground', cost: 4, power: 4, hp: 5, traits: ['Force', 'Jedi'] }),
  SHD_147: card({ id: 'SHD_147', name: 'Ketsu Onyo', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 2, traits: ['Mandalorian'], keywords: [{ name: 'Saboteur' }] }),
  SOR_133: card({ id: 'SOR_133', name: 'Seventh Sister', type: 'unit', arena: 'ground', cost: 5, power: 3, hp: 6, traits: ['Force', 'Imperial'], keywords: [{ name: 'Saboteur' }] }),
  JTL_188: card({ id: 'JTL_188', name: 'Moff Gideon', type: 'unit', arena: 'ground', cost: 4, power: 5, hp: 4, traits: ['Imperial', 'Official'] }),
  // Props
  WOOKIEE: card({ id: 'WOOKIEE', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 6, traits: ['Wookiee'] }),
  BIGGUN: card({ id: 'BIGGUN', type: 'unit', arena: 'ground', cost: 4, power: 4, hp: 8 }),
  SPACER: card({ id: 'SPACER', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 6 }),
  CHEAPUP: card({ id: 'CHEAPUP', type: 'upgrade', cost: 2, power: 1, hp: 1 }),
  DEARUP: card({ id: 'DEARUP', type: 'upgrade', cost: 4, power: 2, hp: 2 }),
}

const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
const noChoice = (s: GameState) => expect(s.pendingChoices ?? [], 'no choice is raised').toHaveLength(0)
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; upgradeIndex?: number }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const hasExp = (s: GameState, id: string) => (U(s, id)?.upgrades ?? []).some(a => a.cardId === TOKEN_EXPERIENCE)
/** Drive a real attack, which is the only way the combat-damage context is produced. */
const attackBase = (s: GameState, attackerId: string, who: PlayerId = 'player') =>
  resolve({ ...s, activePlayer: who }, { type: 'attack', attackerId, target: { kind: 'base' } })
const attackUnit = (s: GameState, attackerId: string, defenderId: string, who: PlayerId = 'player') =>
  resolve({ ...s, activePlayer: who }, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: defenderId } })

// ── Group A: "When this unit is dealt damage and survives" ────────────────────────────────────

describe('HMW_156 Arena Acklay', () => {
  const board = (damage = 0) => state({
    cards: F,
    players: {
      player: player({ units: [unit('acklay', 'HMW_156', { damage })] }),
      opponent: player(),
    },
  })

  it('deals 2 damage to each enemy base when it is damaged and survives', () => {
    const hit = dealDamageToUnit(board(), 'acklay', 2)
    expect(U(hit, 'acklay')?.damage).toBe(2)
    expect(hit.players.opponent.base.damage).toBe(2)
    expect(hit.players.player.base.damage, 'its own base is not an enemy base').toBe(0)
  })

  it('does not fire when the damage defeats it', () => {
    const dead = dealDamageToUnit(board(5), 'acklay', 1) // 5 + 1 = 6 hp
    expect(U(dead, 'acklay')).toBeUndefined()
    expect(dead.players.opponent.base.damage).toBe(0)
  })
})

describe('HMW_166 Gungi', () => {
  const board = () => state({
    cards: F,
    players: {
      player: player({ units: [unit('gungi', 'HMW_166', { exhausted: true })], hand: ['TST_U1'] }),
      opponent: player(),
    },
  })

  it('offers a discard when damaged and survives, and readies him if taken', () => {
    const hit = dealDamageToUnit(board(), 'gungi', 1)
    expect(choice(hit).kind).toBe('selectDiscard')
    const done = accept(hit, { handIndex: 0 })
    expect(done.players.player.hand).toHaveLength(0)
    expect(U(done, 'gungi')?.exhausted, 'readied by the discard').toBe(false)
  })

  it('leaves him exhausted when the discard is declined', () => {
    const hit = dealDamageToUnit(board(), 'gungi', 1)
    const done = skip(hit)
    expect(done.players.player.hand).toHaveLength(1)
    expect(U(done, 'gungi')?.exhausted).toBe(true)
  })
})

describe('HMW_211 Tech', () => {
  it('offers an exhaust when damaged and survives', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('tech', 'HMW_211')] }),
        opponent: player({ units: [unit('e', 'BIGGUN')] }),
      },
    })
    const hit = dealDamageToUnit(s, 'tech', 1)
    expect(choice(hit).kind).toBe('mayExhaustUnit')
    const done = accept(hit, { targetInstanceId: 'e' })
    expect(U(done, 'e')?.exhausted).toBe(true)
  })
})

describe('HMW_169 Crosshair', () => {
  it('makes each player draw when damaged and survives', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('cross', 'HMW_169')], deck: ['TST_U1', 'TST_U1'] }),
        opponent: player({ deck: ['TST_U2', 'TST_U2'] }),
      },
    })
    const hit = dealDamageToUnit(s, 'cross', 1)
    expect(hit.players.player.hand).toHaveLength(1)
    expect(hit.players.opponent.hand).toHaveLength(1)
    // Its OWN second ability then reads the opponent's draw, which is the printed interaction.
    expect(hit.players.opponent.base.damage).toBe(2)
  })

  it('deals 2 damage to an opponent who draws during the action phase', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('cross', 'HMW_169')] }),
        opponent: player({ deck: ['TST_U2', 'TST_U2'] }),
      },
    })
    expect(drawCards(s, 'opponent', 1).players.opponent.base.damage).toBe(2)
    // Once per draw event, not once per card (the head reads "1 or more cards").
    expect(drawCards(s, 'opponent', 2).players.opponent.base.damage).toBe(2)
  })

  it('reads an opponent only, and only during the action phase', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('cross', 'HMW_169')], deck: ['TST_U1', 'TST_U1'] }),
        opponent: player({ deck: ['TST_U2', 'TST_U2'] }),
      },
    })
    expect(drawCards(s, 'player', 1).players.player.base.damage, 'its own controller drawing is not an opponent drawing').toBe(0)
    const regroup: GameState = { ...s, phase: 'regroup' }
    expect(drawCards(regroup, 'opponent', 1).players.opponent.base.damage, 'regroup draws are not action-phase draws').toBe(0)
  })
})

describe('SHD_250 Tarfful', () => {
  const board = () => state({
    cards: F,
    players: {
      player: player({ units: [unit('tarfful', 'SHD_250'), unit('wook', 'WOOKIEE'), unit('other', 'BIGGUN')] }),
      opponent: player({ units: [unit('atk', 'BIGGUN'), unit('victim', 'SPACER', { arena: 'ground' })] }),
    },
  })

  it('turns combat damage a friendly Wookiee survived back onto an enemy ground unit', () => {
    const fought = attackUnit(board(), 'atk', 'wook', 'opponent') // BIGGUN 4 power into a 2/6 Wookiee
    expect(U(fought, 'wook')?.damage).toBe(4)
    const done = accept(fought, { targetInstanceId: 'victim' })
    expect(U(done, 'victim')?.damage, 'that much damage, i.e. the 4 it survived').toBe(4)
  })

  it('does not read a non-Wookiee, nor ability damage', () => {
    const nonWookiee = attackUnit(board(), 'atk', 'other', 'opponent')
    noChoice(nonWookiee)

    const abilityDamage = dealDamageToUnit(board(), 'wook', 3)
    expect(U(abilityDamage, 'wook')?.damage).toBe(3)
    noChoice(abilityDamage) // "dealt COMBAT damage" — ctx.byCombat
  })
})

// ── Group B: "When this unit deals combat damage to a base" ───────────────────────────────────

describe('LOF_166 Blockade Runner', () => {
  it('offers an Experience token to itself after damaging a base', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('br', 'LOF_166')] }),
        opponent: player(),
      },
    })
    const swung = attackBase(s, 'br')
    expect(swung.players.opponent.base.damage).toBe(4)
    const done = accept(swung, { targetInstanceId: 'br' })
    expect(hasExp(done, 'br')).toBe(true)
  })

  it('does not fire when the attack dealt the base no damage', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('br', 'LOF_166')] }),
        opponent: player({ units: [unit('d', 'SPACER')] }),
      },
    })
    noChoice(attackUnit(s, 'br', 'd')) // a unit attack is not base damage
  })
})

describe('SEC_147 Chopper', () => {
  it('makes each player discard a card after damaging a base', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('chop', 'SEC_147')], hand: ['TST_U1', 'TST_U2'] }),
        opponent: player({ hand: ['TST_U3'] }),
      },
    })
    let done = attackBase(s, 'chop')
    // Two discard choices, one per player.
    while ((done.pendingChoices ?? []).length > 0) done = accept(done, { handIndex: 0 })
    expect(done.players.player.hand).toHaveLength(1)
    expect(done.players.opponent.hand).toHaveLength(0)
  })
})

describe('SEC_150 Valiant Commando', () => {
  it('may defeat itself to deal 3 more to the base it hit', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('vc', 'SEC_150')] }),
        opponent: player(),
      },
    })
    const swung = attackBase(s, 'vc')
    expect(swung.players.opponent.base.damage).toBe(3)
    const done = accept(swung)
    expect(U(done, 'vc'), 'defeated itself').toBeUndefined()
    expect(done.players.opponent.base.damage).toBe(6)
  })

  it('is optional', () => {
    const s = state({
      cards: F,
      players: { player: player({ units: [unit('vc', 'SEC_150')] }), opponent: player() },
    })
    const done = skip(attackBase(s, 'vc'))
    expect(U(done, 'vc')).toBeDefined()
    expect(done.players.opponent.base.damage).toBe(3)
  })
})

describe('SHD_147 Ketsu Onyo', () => {
  it('may defeat an upgrade costing 2 or less after damaging a base', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('ketsu', 'SHD_147')] }),
        opponent: player({ units: [unit('e', 'BIGGUN', { upgrades: [{ cardId: 'CHEAPUP', owner: 'opponent' }, { cardId: 'DEARUP', owner: 'opponent' }] })] }),
      },
    })
    const swung = attackBase(s, 'ketsu')
    const offered = (choice(swung) as { candidates?: { cardId: string }[] }).candidates ?? []
    expect(offered.map(c => c.cardId), 'the 4-cost upgrade is out of reach').toEqual(['CHEAPUP'])
    const done = accept(swung, { targetInstanceId: 'e', upgradeIndex: 0 })
    expect((U(done, 'e')?.upgrades ?? []).map(a => a.cardId)).toEqual(['DEARUP'])
  })
})

describe('SOR_133 Seventh Sister', () => {
  it('may deal 3 damage to a ground unit the defending player controls', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('ss', 'SOR_133')] }),
        // `unit()` reads the arena off the SHARED fixture pool, so a card only in `F` needs it stated.
        opponent: player({ units: [unit('g', 'BIGGUN'), unit('sp', 'SPACER', { arena: 'space' })] }),
      },
    })
    const swung = attackBase(s, 'ss')
    const targets = (choice(swung) as { targets?: string[] }).targets ?? []
    expect(targets, 'that opponent, ground only').toEqual(['g'])
    expect(U(accept(swung, { targetInstanceId: 'g' }), 'g')?.damage).toBe(3)
  })
})

describe('JTL_188 Moff Gideon', () => {
  it('makes each unit that opponent plays this phase cost 1 more', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('gid', 'JTL_188')] }),
        opponent: player(),
      },
    })
    expect(effectiveCost(s, 'opponent', F.BIGGUN), 'no surcharge before he connects').toBe(4)
    const swung = attackBase(s, 'gid')
    expect(effectiveCost(swung, 'opponent', F.BIGGUN)).toBe(5)
    expect(effectiveCost(swung, 'opponent', F.CHEAPUP), 'units only').toBe(2)
    expect(effectiveCost(swung, 'player', F.BIGGUN), 'his own controller pays the printed cost').toBe(4)
  })
})

describe('SEC_041 Populist Advisor', () => {
  const board = () => state({
    cards: F,
    players: {
      player: player({ units: [unit('pa', 'SEC_041')] }),
      opponent: player({ units: [unit('atk', 'BIGGUN')] }),
    },
  })

  it('gains Sentinel for the phase when an enemy unit deals combat damage to its base', () => {
    // Its printed Sentinel is on the card; the ability is what a lasting effect adds, so read the
    // lasting effect rather than the keyword, which would pass vacuously.
    const swung = attackBase(board(), 'atk', 'opponent')
    expect(swung.players.player.base.damage).toBe(4)
    expect((swung.lastingEffects ?? []).some(e => e.targetInstanceId === 'pa' && (e.keywords ?? []).some(k => k.name === 'Sentinel'))).toBe(true)
    expect(unitHasKeyword(swung, U(swung, 'pa')!, 'Sentinel')).toBe(true)
  })

  it('does not fire on ability damage to its base', () => {
    const pinged = dealDamageToBase(board(), 'player', 3, { cardId: 'TST_E1', controller: 'opponent' })
    expect(pinged.players.player.base.damage).toBe(3)
    expect((pinged.lastingEffects ?? []).some(e => e.targetInstanceId === 'pa')).toBe(false)
  })
})

describe('SEC_205 Obi-Wan Kenobi', () => {
  it("mills the defending player's deck and grants that card back out of their discard", () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('obi', 'SEC_205')] }),
        opponent: player({ deck: ['TST_U2', 'TST_U3'] }),
      },
    })
    const swung = attackBase(s, 'obi')
    expect(swung.players.opponent.deck, 'top card milled').toEqual(['TST_U3'])
    expect(swung.players.opponent.discard).toEqual(['TST_U2'])
    const grant = (swung.discardPlayGrants ?? [])[0]
    expect(grant, 'a standing permission for this phase').toBeDefined()
    expect(grant.cardId).toBe('TST_U2')
    expect(grant.player, 'the permission is Obi-Wan\'s controller\'s').toBe('player')
    expect(grant.owner, "the card is still the opponent's (CR 1.5.2)").toBe('opponent')
    expect(grant.waive, 'ignoring its aspect penalties').toEqual({ all: true })
  })
})

/** SEC_017 Sabé's front reads a friendly unit's base damage from `whenFriendlyAttackEnds`. */
describe('whenFriendlyAttackEnds carries the base damage', () => {
  it('reaches every friendly unit with the attack\'s combat damage to the base', () => {
    // The point Sabé's front listens on fires for a friendly unit's base damage, with the figure on it.
    const seen: { combatDamageToBase?: number }[] = []
    registerCard('TST_FAE', { abilities: [{ trigger: 'whenFriendlyAttackEnds', description: 'probe', effect: (s, ctx) => { seen.push({ combatDamageToBase: ctx.combatDamageToBase }); return s } }] })
    const s = state({
      cards: { ...F, TST_FAE: card({ id: 'TST_FAE', type: 'unit', arena: 'ground', power: 1, hp: 9 }) },
      players: {
        player: player({ units: [unit('probe', 'TST_FAE'), unit('ally', 'BIGGUN')] }),
        opponent: player(),
      },
    })
    attackBase(s, 'ally')
    expect(seen, "a friendly unit's attack reaches the probe with the base damage on it").toEqual([{ combatDamageToBase: 4 }])
  })
})
