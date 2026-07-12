import { describe, it, expect } from 'vitest'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword, unitKeywordValue } from '../engine/keywords'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { normaliseCard } from '../engine/cardDb'
import { card, state, unit, player, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_EXPERIENCE, TOKEN_SHIELD, TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import type { PlayerId, UpgradeAttachment } from '../engine/types'

const UPGRADE = (over: Partial<Parameters<typeof card>[0]> = {}) =>
  card({ id: 'TST_UP', type: 'upgrade', cost: 1, power: 0, hp: 0, ...over })

/** An attachment record: an upgrade card owned by `owner` (defaults to player). */
const att = (cardId: string, owner: PlayerId = 'player'): UpgradeAttachment => ({ cardId, owner })
const hasUpgrade = (u: { upgrades: UpgradeAttachment[] }, cardId: string) => u.upgrades.some(a => a.cardId === cardId)

/** A card pool with a few upgrade cards for attachment tests (#308). */
function withUpgrades() {
  return state({
    cards: {
      ...CARDS,
      TST_UP_STAT: card({ id: 'TST_UP_STAT', type: 'upgrade', cost: 2, power: 2, hp: 2 }), // +2/+2
      TST_UP_SENT: card({ id: 'TST_UP_SENT', type: 'upgrade', cost: 1, power: 0, hp: 0, keywords: [{ name: 'Sentinel' }] }),
      TST_UP_RAID: card({ id: 'TST_UP_RAID', type: 'upgrade', cost: 1, power: 0, hp: 0, keywords: [{ name: 'Raid', value: 1 }] }),
    },
  })
}

describe('upgrade stat modifiers (#308)', () => {
  it('adds an attached upgrade’s power/HP to the unit', () => {
    const s = withUpgrades()
    const u = unit('u1', 'TST_U1', { upgrades: [att('TST_UP_STAT')] }) // base 3/4 + 2/2
    expect(effectivePower(s, u)).toBe(5)
    expect(effectiveHp(s, u)).toBe(6)
  })

  it('sums multiple attached upgrades', () => {
    const s = withUpgrades()
    const u = unit('u1', 'TST_U1', { upgrades: [att('TST_UP_STAT'), att('TST_UP_STAT')] })
    expect(effectivePower(s, u)).toBe(7)
    expect(effectiveHp(s, u)).toBe(8)
  })

  it('leaves a unit with no upgrades on its printed stats', () => {
    const s = withUpgrades()
    expect(effectivePower(s, unit('u1', 'TST_U1'))).toBe(3)
    expect(effectiveHp(s, unit('u1', 'TST_U1'))).toBe(4)
  })

  it('a power upgrade increases the damage the unit deals in an attack', () => {
    const s = state({
      cards: { ...CARDS, TST_UP: UPGRADE({ cost: 1, power: 2, hp: 0 }) },
      players: {
        player: player({ units: [unit('u1', 'TST_U1', { upgrades: [att('TST_UP')] })] }), // 3 power + 2
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
    expect(next.players.opponent.base.damage).toBe(5)
  })

  it('a real normalised stat upgrade (Entrenched, Power 3) boosts attack via the data path', () => {
    // Entrenched (SOR_072) is a real +3/+3 upgrade — proving the SWUDB→engine path
    // applies the modifier, not just synthetic test cards.
    const entrenched = normaliseCard({ Set: 'SOR', Number: '072', Name: 'Entrenched', Type: 'Upgrade', Power: '3', HP: '3' })
    const s = state({
      cards: { ...CARDS, SOR_072: entrenched },
      players: {
        player: player({ units: [unit('u1', 'TST_U1', { upgrades: [att('SOR_072')] })] }), // 3 base + 3
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
    expect(next.players.opponent.base.damage).toBe(6)
  })
})

describe('upgrade granted keywords (#308)', () => {
  it('a unit gains a keyword from an attached upgrade', () => {
    const s = withUpgrades()
    expect(unitHasKeyword(s, unit('u1', 'TST_U1', { upgrades: [att('TST_UP_SENT')] }), 'Sentinel')).toBe(true)
    expect(unitHasKeyword(s, unit('u2', 'TST_U1'), 'Sentinel')).toBe(false)
  })

  it('stacks keyword values across the card and its upgrades', () => {
    const s = state({
      cards: {
        ...CARDS,
        TST_R2: card({ id: 'TST_R2', type: 'unit', arena: 'ground', power: 2, hp: 4, keywords: [{ name: 'Raid', value: 2 }] }),
        TST_UP_RAID: card({ id: 'TST_UP_RAID', type: 'upgrade', keywords: [{ name: 'Raid', value: 1 }] }),
      },
    })
    expect(unitKeywordValue(s, unit('u1', 'TST_R2', { upgrades: [att('TST_UP_RAID')] }), 'Raid')).toBe(3)
  })

  it('Raid granted by an upgrade boosts attacking power only', () => {
    const s = withUpgrades()
    const u = unit('u1', 'TST_U1', { upgrades: [att('TST_UP_RAID')] }) // base 3/4, +Raid 1
    expect(effectivePower(s, u)).toBe(3)
    expect(effectivePower(s, u, { attacking: true })).toBe(4)
  })
})

describe('playing upgrades — legal moves (#308)', () => {
  it('offers playUpgrade for an affordable upgrade onto any unit (friendly or enemy)', () => {
    const s = state({
      cards: { ...CARDS, TST_UP: UPGRADE({ cost: 1 }) },
      players: {
        player: player({ hand: ['TST_UP'], resources: ready(3), units: [unit('u1', 'TST_U1')] }),
        opponent: player({ units: [unit('e1', 'TST_U2')] }),
      },
    })
    const ups = legalMoves(s).filter(a => a.type === 'playUpgrade')
    expect(ups).toContainEqual({ type: 'playUpgrade', handIndex: 0, targetInstanceId: 'u1' })
    expect(ups).toContainEqual({ type: 'playUpgrade', handIndex: 0, targetInstanceId: 'e1' })
    expect(ups).toHaveLength(2)
  })

  it('does not offer playUpgrade when unaffordable', () => {
    const s = state({
      cards: { ...CARDS, TST_UP: UPGRADE({ cost: 3 }) },
      players: {
        player: player({ hand: ['TST_UP'], resources: ready(1), units: [unit('u1', 'TST_U1')] }),
        opponent: player(),
      },
    })
    expect(legalMoves(s).some(a => a.type === 'playUpgrade')).toBe(false)
  })

  it('does not offer playUpgrade with no units in play', () => {
    const s = state({
      cards: { ...CARDS, TST_UP: UPGRADE({ cost: 1 }) },
      players: {
        player: player({ hand: ['TST_UP'], resources: ready(3) }),
        opponent: player(),
      },
    })
    expect(legalMoves(s).some(a => a.type === 'playUpgrade')).toBe(false)
  })
})

describe('playing upgrades — resolution (#308)', () => {
  it('attaches the upgrade to the chosen unit, pays the cost, and removes it from hand', () => {
    const s = state({
      cards: { ...CARDS, TST_UP: UPGRADE({ cost: 1, power: 2, hp: 2 }) },
      players: {
        player: player({ hand: ['TST_UP'], resources: ready(2), units: [unit('u1', 'TST_U1')] }),
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'u1' })
    const u = next.players.player.units.find(x => x.instanceId === 'u1')!
    expect(u.upgrades).toEqual([att('TST_UP', 'player')])
    expect(next.players.player.hand).toEqual([])
    expect(next.players.player.resources.filter(r => r.exhausted)).toHaveLength(1)
  })

  it('can attach an upgrade to an enemy unit (owned by the player who played it)', () => {
    const s = state({
      cards: { ...CARDS, TST_UP: UPGRADE({ cost: 1 }) },
      players: {
        player: player({ hand: ['TST_UP'], resources: ready(2) }),
        opponent: player({ units: [unit('e1', 'TST_U2')] }),
      },
    })
    const next = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'e1' })
    expect(next.players.opponent.units[0].upgrades).toEqual([att('TST_UP', 'player')])
  })
})

describe('upgrade lifecycle (#308)', () => {
  it('sends a defeated unit’s self-owned card-upgrade to that owner’s discard', () => {
    const s = state({
      cards: { ...CARDS, TST_UP: UPGRADE({ power: 0, hp: 0 }) },
      players: {
        player: player({ units: [unit('u1', 'TST_U3')] }), // 5/1 attacker
        opponent: player({ units: [unit('e1', 'TST_U1', { upgrades: [att('TST_UP', 'opponent')] })] }), // 3/4 + upgrade
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.opponent.units).toHaveLength(0) // 5 power ≥ 4 HP
    expect(next.players.opponent.discard).toContain('TST_UP')
    expect(next.players.opponent.discard).toContain('TST_U1')
  })

  it('returns an enemy-attached upgrade to its OWNER’s discard, not the controller’s', () => {
    // The player owns an upgrade attached to an enemy unit; when that unit dies the
    // upgrade returns to the player's discard, the unit card to the opponent's.
    const s = state({
      cards: { ...CARDS, TST_UP: UPGRADE({ power: 0, hp: 0 }) },
      players: {
        player: player({ units: [unit('u1', 'TST_U3')] }), // 5/1 attacker
        opponent: player({ units: [unit('e1', 'TST_U1', { upgrades: [att('TST_UP', 'player')] })] }),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.player.discard).toContain('TST_UP') // owner gets it back
    expect(next.players.opponent.discard).not.toContain('TST_UP') // not the controller
    expect(next.players.opponent.discard).toContain('TST_U1') // the unit card → its owner
  })
})

describe('token upgrades (#308)', () => {
  it('Experience gives +1/+1', () => {
    const s = state()
    const u = unit('u1', 'TST_U1', { upgrades: [att(TOKEN_EXPERIENCE)] }) // 3/4 → 4/5
    expect(effectivePower(s, u)).toBe(4)
    expect(effectiveHp(s, u)).toBe(5)
  })

  it('Shield prevents one instance of combat damage and is then consumed', () => {
    const s = state({
      players: {
        player: player({ units: [unit('u1', 'TST_U3')] }), // 5/1 attacker
        opponent: player({ units: [unit('e1', 'TST_U1', { upgrades: [att(TOKEN_SHIELD)] })] }), // 3/4 + shield
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    const e1 = next.players.opponent.units.find(u => u.instanceId === 'e1')
    expect(e1).toBeDefined() // damage prevented → survives
    expect(e1!.damage).toBe(0)
    expect(hasUpgrade(e1!, TOKEN_SHIELD)).toBe(false) // shield consumed
    expect(next.players.player.units).toHaveLength(0) // counter still kills the 5/1 attacker
  })

  it('Advantage boosts the unit’s next attack and is then removed', () => {
    const s = state({
      players: {
        player: player({ units: [unit('u1', 'TST_U2', { upgrades: [att(TOKEN_ADVANTAGE)] })] }), // 2/2 + adv
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'base' } })
    expect(next.players.opponent.base.damage).toBe(3) // 2 power + 1 advantage
    expect(hasUpgrade(next.players.player.units[0], TOKEN_ADVANTAGE)).toBe(false)
  })

  it('Advantage boosts a defending unit’s counterattack, then is removed', () => {
    const s = state({
      players: {
        player: player({ units: [unit('u1', 'TST_U4')] }), // 1/9 attacker (survives)
        opponent: player({ units: [unit('e1', 'TST_U1', { upgrades: [att(TOKEN_ADVANTAGE)] })] }), // 3/4 + adv
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(next.players.player.units.find(u => u.instanceId === 'u1')!.damage).toBe(4) // 3 + 1 advantage
    expect(hasUpgrade(next.players.opponent.units.find(u => u.instanceId === 'e1')!, TOKEN_ADVANTAGE)).toBe(false)
  })
})
