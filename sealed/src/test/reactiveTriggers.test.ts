import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { dealDamageToUnit } from '../engine/combat'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { drawCards, dealDamageToBase, defeatUpgradeAt } from '../engine/effects'
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/**
 * Reactive triggers — abilities that fire off *another* card's event:
 * `whenFriendlyUnitDefeated` (The Twins) and `whenEnemyAttacksBase` (Kachirho Militia).
 */
const F = {
  ...CARDS,
  ASH_127: card({ id: 'ASH_127', type: 'unit', arena: 'ground', power: 2, hp: 7, keywords: [{ name: 'Sentinel' }] }), // The Twins
  ASH_160: card({ id: 'ASH_160', type: 'unit', arena: 'ground', power: 4, hp: 6, keywords: [{ name: 'Hidden' }] }), // Kachirho Militia
  FODDER: card({ id: 'FODDER', type: 'unit', arena: 'ground', power: 1, hp: 1 }),
  GROUNDER: card({ id: 'GROUNDER', type: 'unit', arena: 'ground', power: 3, hp: 5 }),
  SPACER: card({ id: 'SPACER', type: 'unit', arena: 'space', power: 3, hp: 5 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!

describe('whenFriendlyUnitDefeated — The Twins (127)', () => {
  it('heals 1 from your base when another friendly unit is defeated', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('t', 'ASH_127', { arena: 'ground' }), unit('f', 'FODDER', { arena: 'ground' })], base: { cardId: 'TST_B', damage: 4 } }),
        opponent: player(),
      },
    })
    const done = dealDamageToUnit(s, 'f', 1) // FODDER (1 hp) dies
    expect(U(done, 'f')).toBeUndefined()
    expect(done.players.player.base.damage).toBe(3) // healed 1
  })

  it("does not fire for an enemy unit's defeat, nor for its own", () => {
    const enemyDies = state({
      cards: F,
      players: {
        player: player({ units: [unit('t', 'ASH_127', { arena: 'ground' })], base: { cardId: 'TST_B', damage: 4 } }),
        opponent: player({ units: [unit('e', 'FODDER', { arena: 'ground' })] }),
      },
    })
    expect(dealDamageToUnit(enemyDies, 'e', 1).players.player.base.damage).toBe(4) // enemy death → no heal

    const selfDies = state({
      cards: F,
      players: {
        player: player({ units: [unit('t', 'ASH_127', { arena: 'ground', damage: 6 })], base: { cardId: 'TST_B', damage: 4 } }),
        opponent: player(),
      },
    })
    expect(dealDamageToUnit(selfDies, 't', 1).players.player.base.damage).toBe(4) // "another" excludes itself
  })

  it('offers a Sentinel grant to another friendly unit on attack', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('t', 'ASH_127', { arena: 'ground' }), unit('f', 'GROUNDER', { arena: 'ground' })] }),
        opponent: player(),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 't', target: { kind: 'base' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayLastingBuff', keywords: [{ name: 'Sentinel' }] })
  })
})

describe('whenEnemyAttacksBase — Kachirho Militia (160)', () => {
  const board = (attackerCard: string, arena: 'ground' | 'space', militia: Parameters<typeof unit>[2] = {}) => state({
    cards: F,
    players: {
      player: player({ units: [unit('a', attackerCard, { arena })] }), // active attacker
      opponent: player({ units: [unit('k', 'ASH_160', { arena: 'ground', exhausted: true, ...militia })] }),
    },
  })

  it('readies itself when an enemy GROUND unit attacks your base', () => {
    const done = resolve(board('GROUNDER', 'ground'), { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(U(done, 'k').exhausted).toBe(false)
  })

  it('does not fire for a space attacker', () => {
    const done = resolve(board('SPACER', 'space'), { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(U(done, 'k').exhausted).toBe(true)
  })

  it('is once per round', () => {
    const first = resolve(board('GROUNDER', 'ground'), { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(U(first, 'k').exhausted).toBe(false)
    // Re-exhaust it and attack again in the same round → it stays exhausted.
    const reExhausted: GameState = {
      ...first,
      activePlayer: 'player',
      players: { ...first.players, opponent: { ...first.players.opponent, units: first.players.opponent.units.map(u => (u.instanceId === 'k' ? { ...u, exhausted: true } : u)) }, player: { ...first.players.player, units: first.players.player.units.map(u => ({ ...u, exhausted: false })) } },
    }
    const second = resolve(reExhausted, { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(U(second, 'k').exhausted).toBe(true) // already used this round
  })
})

describe('whenUpgradeAttached — Sabine Wren (208)', () => {
  const S = { ...F, ASH_208: card({ id: 'ASH_208', type: 'unit', arena: 'ground', cost: 5, power: 4, hp: 5, keywords: [{ name: 'Shielded' }] }), UPG: card({ id: 'UPG', type: 'upgrade', power: 1, hp: 1 }) }

  it('fires when she enters play with a Shield from Shielded', () => {
    const board = state({
      cards: S,
      players: {
        player: player({ hand: ['ASH_208'], resources: Array.from({ length: 10 }, () => ({ cardId: 'r', exhausted: false })), units: [unit('g', 'GROUNDER', { arena: 'ground' })] }),
        opponent: player(),
      },
    })
    const played = resolve(board, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustUnit' })
  })

  it('fires when an upgrade card is played onto her', () => {
    const board = state({
      cards: S,
      players: {
        player: player({ hand: ['UPG'], resources: Array.from({ length: 10 }, () => ({ cardId: 'r', exhausted: false })), units: [unit('sw', 'ASH_208', { arena: 'ground' })] }),
        opponent: player(),
      },
    })
    const played = resolve(board, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'sw' })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustUnit' })
  })

  it('does not fire for an upgrade attached to a different unit', () => {
    const board = state({
      cards: S,
      players: {
        player: player({ hand: ['UPG'], resources: Array.from({ length: 10 }, () => ({ cardId: 'r', exhausted: false })), units: [unit('sw', 'ASH_208', { arena: 'ground' }), unit('g', 'GROUNDER', { arena: 'ground' })] }),
        opponent: player(),
      },
    })
    const played = resolve(board, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'g' })
    expect(played.pendingChoices ?? []).toHaveLength(0)
  })
})

// ── Draw / own-base-damage / upgrade-defeat triggers, and phase trackers ────────────────

const G = {
  ...F,
  ASH_169: card({ id: 'ASH_169', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 4 }), // Axe Woves
  ASH_204: card({ id: 'ASH_204', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 4 }), // Blade Three
  ASH_032: card({ id: 'ASH_032', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 4 }), // Rancor Keeper
  ASH_161: card({ id: 'ASH_161', type: 'unit', arena: 'ground', cost: 7, power: 5, hp: 7 }), // Zeb Orrelios
  ASH_039: card({ id: 'ASH_039', type: 'unit', arena: 'ground', cost: 6, power: 6, hp: 6, keywords: [{ name: 'Overwhelm' }] }), // Baylan Skoll
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
}
const adv = (u: { upgrades: { cardId: string }[] }) => u.upgrades.filter(a => a.cardId === TOKEN_ADVANTAGE).length
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })

describe('whenDrawCards — Axe Woves (169)', () => {
  it('gains an Advantage token when its controller draws, once per draw event not per card', () => {
    const s = state({ cards: G, players: { player: rich({ units: [unit('a', 'ASH_169')], deck: ['GROUNDER', 'GROUNDER', 'GROUNDER'] }), opponent: player() } })
    const drawn = drawCards(s, 'player', 2)
    expect(drawn.players.player.hand).toHaveLength(2)
    expect(adv(U(drawn, 'a'))).toBe(1) // one event, one token
  })

  it('does not fire for the opponent drawing, nor on an empty deck', () => {
    const s = state({ cards: G, players: { player: rich({ units: [unit('a', 'ASH_169')], deck: [] }), opponent: player({ deck: ['GROUNDER'] }) } })
    expect(adv(U(drawCards(s, 'opponent', 1), 'a'))).toBe(0)
    expect(adv(U(drawCards(s, 'player', 1), 'a'))).toBe(0) // nothing drawn → no trigger
  })

  /**
   * The card spells this case out: "When you draw 1 or more cards (including during the regroup
   * phase)". The regroup draw built the hand inline instead of going through `drawCards`, so the
   * trigger never fired there.
   */
  it('fires on the regroup draw, for both players', () => {
    const s = state({
      phase: 'action',
      activePlayer: 'player',
      initiative: 'player',
      consecutivePasses: 1, // one more pass ends the phase
      cards: G,
      players: {
        player: rich({ units: [unit('a', 'ASH_169')], deck: ['GROUNDER', 'GROUNDER', 'GROUNDER'] }),
        opponent: player({ units: [unit('b', 'ASH_169')], deck: ['GROUNDER', 'GROUNDER', 'GROUNDER'] }),
      },
    })
    const after = resolve(s, { type: 'pass' })
    expect(after.phase).toBe('regroup')
    expect(adv(U(after, 'a'))).toBe(1)
    expect(adv(U(after, 'b'))).toBe(1) // the opponent's copy reacts to their own draw
  })

  it('still takes empty-deck damage when the regroup draw comes up short', () => {
    const s = state({
      phase: 'action',
      activePlayer: 'player',
      initiative: 'player',
      consecutivePasses: 1,
      cards: G,
      players: {
        player: rich({ units: [unit('a', 'ASH_169')], deck: ['GROUNDER'] }), // 1 of the 2 cards
        opponent: player({ deck: ['GROUNDER', 'GROUNDER'] }),
      },
    })
    const before = s.players.player.base.damage
    const after = resolve(s, { type: 'pass' })
    expect(after.players.player.base.damage).toBe(before + 3) // one missed card = 3 damage
    expect(adv(U(after, 'a'))).toBe(1) // a partial draw is still a draw
  })
})

describe('whenOwnBaseDamaged — Blade Three (204)', () => {
  it('gains an Advantage token when its controller’s base is damaged', () => {
    const s = state({ cards: G, players: { player: rich({ units: [unit('b', 'ASH_204')] }), opponent: player() } })
    expect(adv(U(dealDamageToBase(s, 'player', 3), 'b'))).toBe(1)
    expect(adv(U(dealDamageToBase(s, 'opponent', 3), 'b'))).toBe(0) // the enemy base isn't "your base"
  })

  it('fires on combat damage to the base too', () => {
    const s = state({
      cards: G,
      activePlayer: 'opponent',
      players: { player: rich({ units: [unit('b', 'ASH_204')] }), opponent: player({ units: [unit('e', 'SPACER', { arena: 'space' })] }) },
    })
    const hit = resolve(s, { type: 'attack', attackerId: 'e', target: { kind: 'base' } })
    expect(adv(U(hit, 'b'))).toBe(1)
  })
})

describe('whenFriendlyUpgradeDefeated — Zeb Orrelios (161)', () => {
  it('offers 1 damage to a base when a friendly upgrade is defeated', () => {
    const s = state({ cards: G, players: { player: rich({ units: [unit('z', 'ASH_161'), unit('g', 'GROUNDER', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] }), opponent: player() } })
    const gone = defeatUpgradeAt(s, 'g', 0)
    expect(gone.pendingChoices?.[0]).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
    const dealt = resolve(gone, { type: 'acceptChoice', choiceId: gone.pendingChoices![0].id, baseTarget: 'opponent' })
    expect(dealt.players.opponent.base.damage).toBe(1)
  })

  it('fires when the upgrade goes down with its host unit', () => {
    const s = state({ cards: G, players: { player: rich({ units: [unit('z', 'ASH_161'), unit('f', 'FODDER', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] }), opponent: player() } })
    const dead = dealDamageToUnit(s, 'f', 5) // FODDER dies, taking its upgrade with it
    expect(dead.pendingChoices?.[0]).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
  })

  it('gives 3 Advantage tokens to another unit when played', () => {
    const s = state({ cards: G, players: { player: rich({ hand: ['ASH_161'], units: [unit('g', 'GROUNDER')] }), opponent: player() } })
    const p = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(p.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', count: 3 })
  })
})

describe('Rancor Keeper (032) — damage any number of bases when a friendly unit survives damage', () => {
  const board = () => state({ cards: G, players: { player: rich({ units: [unit('r', 'ASH_032'), unit('g', 'GROUNDER')] }), opponent: player() } })

  it('offers each base once, and only once each round', () => {
    const hurt = dealDamageToUnit(board(), 'g', 1) // GROUNDER (5 hp) survives
    const c = hurt.pendingChoices?.[0]
    expect(c).toMatchObject({ kind: 'damageAnyBases' })
    // Hit both bases, then finish.
    const one = resolve(hurt, { type: 'acceptChoice', choiceId: c!.id, baseTarget: 'opponent' })
    const two = resolve(one, { type: 'acceptChoice', choiceId: one.pendingChoices![0].id, baseTarget: 'player' })
    expect(two.players.opponent.base.damage).toBe(1)
    expect(two.players.player.base.damage).toBe(1)
    expect(two.pendingChoices ?? []).toHaveLength(0) // both bases used up

    // Second damage event the same round — already used.
    const again = dealDamageToUnit(two, 'g', 1)
    expect(again.pendingChoices ?? []).toHaveLength(0)
  })

  it('does not fire when the damaged unit is defeated', () => {
    const s = state({ cards: G, players: { player: rich({ units: [unit('r', 'ASH_032'), unit('f', 'FODDER')] }), opponent: player() } })
    const dead = dealDamageToUnit(s, 'f', 1) // FODDER dies rather than surviving
    expect(dead.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Baylan Skoll (039) — phase-condition triggers', () => {
  it('gives Advantage only if an enemy base was damaged this phase', () => {
    const clean = state({ cards: G, players: { player: rich({ hand: ['ASH_039'], units: [unit('g', 'GROUNDER')] }), opponent: player() } })
    expect(resolve(clean, { type: 'playUnit', handIndex: 0 }).pendingChoices ?? []).toHaveLength(0)

    const damaged = dealDamageToBase(clean, 'opponent', 2)
    const p = resolve(damaged, { type: 'playUnit', handIndex: 0 })
    expect(p.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', count: 1 })
  })

  it('offers the exhaust only if a friendly upgrade was defeated this phase', () => {
    const s = state({ cards: G, players: { player: rich({ hand: ['ASH_039'], units: [unit('g', 'GROUNDER', { upgrades: [{ cardId: 'UPG', owner: 'player' }] })] }), opponent: player() } })
    const lost = defeatUpgradeAt(s, 'g', 0)
    const p = resolve(lost, { type: 'playUnit', handIndex: 0 })
    expect(p.pendingChoices?.some(c => c.kind === 'mayExhaustUnit')).toBe(true)
  })
})
