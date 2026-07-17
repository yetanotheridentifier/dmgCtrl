import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { card, state, player, unit, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { GameState } from '../engine/types'

function withCards(extra: Record<string, ReturnType<typeof card>>, overrides: Partial<GameState>) {
  return state({ cards: { ...CARDS, ...extra }, ...overrides })
}

const RAIDER = card({ id: 'TST_RAID', type: 'unit', arena: 'ground', power: 2, hp: 5, keywords: [{ name: 'Raid', value: 2 }] })
const GRITTY = card({ id: 'TST_GRIT', type: 'unit', arena: 'ground', power: 1, hp: 6, keywords: [{ name: 'Grit' }] })
const OVERWHELMER = card({ id: 'TST_OVER', type: 'unit', arena: 'ground', power: 6, hp: 6, keywords: [{ name: 'Overwhelm' }] })
const RESTORER = card({ id: 'TST_REST', type: 'unit', arena: 'ground', power: 2, hp: 4, keywords: [{ name: 'Restore', value: 2 }] })
const SENTINEL = card({ id: 'TST_SENT', type: 'unit', arena: 'ground', power: 2, hp: 4, keywords: [{ name: 'Sentinel' }] })
const SABOTEUR = card({ id: 'TST_SAB', type: 'unit', arena: 'ground', power: 2, hp: 4, keywords: [{ name: 'Saboteur' }] })

describe('Raid (power while attacking)', () => {
  it('adds Raid to attacks but not to counter-damage', () => {
    const s = withCards({ TST_RAID: RAIDER }, {
      players: {
        player: player({ units: [unit('a1', 'TST_RAID')] }),
        opponent: player({ units: [unit('d1', 'TST_RAID')] }),
      },
    })
    // both are 2/5 Raid 2 — attacker hits for 4, defender counters for printed 2
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    expect(next.players.opponent.units[0].damage).toBe(4)
    expect(next.players.player.units[0].damage).toBe(2)
  })

  it('applies Raid to base attacks', () => {
    const s = withCards({ TST_RAID: RAIDER }, {
      players: {
        player: player({ units: [unit('a1', 'TST_RAID')] }),
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(next.players.opponent.base.damage).toBe(4)
  })
})

describe('Grit (power = printed + damage on it)', () => {
  it('boosts a damaged attacker', () => {
    const s = withCards({ TST_GRIT: GRITTY }, {
      players: {
        player: player({ units: [unit('a1', 'TST_GRIT', { damage: 3 })] }), // 1+3 power
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(next.players.opponent.base.damage).toBe(4)
  })

  it("counter-damage uses the defender's PRE-attack damage (simultaneous, CR 6.3.4)", () => {
    const s = withCards({ TST_GRIT: GRITTY }, {
      players: {
        player: player({ units: [unit('a1', 'TST_U1')] }), // 3/4 attacker
        opponent: player({ units: [unit('d1', 'TST_GRIT', { damage: 2 })] }), // grit: 1+2 = 3 counter
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    // counter is 3 (pre-attack damage 2), NOT 6 (post-attack damage 5)
    expect(next.players.player.units[0].damage).toBe(3)
    expect(next.players.opponent.units[0].damage).toBe(5)
  })
})

describe('Overwhelm (excess combat damage to base)', () => {
  it('sends excess damage past a defeated defender to the base', () => {
    const s = withCards({ TST_OVER: OVERWHELMER }, {
      players: {
        player: player({ units: [unit('a1', 'TST_OVER')] }), // 6 power
        opponent: player({ units: [unit('d1', 'TST_U2', { arena: 'ground' })] }), // 2/2 → 4 excess
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    expect(next.players.opponent.units).toHaveLength(0)
    expect(next.players.opponent.base.damage).toBe(4)
  })

  it('deals no base damage when the defender survives', () => {
    const s = withCards({ TST_OVER: OVERWHELMER }, {
      players: {
        player: player({ units: [unit('a1', 'TST_OVER')] }),
        opponent: player({ units: [unit('d1', 'TST_U4')] }), // 1/9 survives 6
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    expect(next.players.opponent.base.damage).toBe(0)
  })

  it('accounts for existing damage on the defender when computing excess', () => {
    const s = withCards({ TST_OVER: OVERWHELMER }, {
      players: {
        player: player({ units: [unit('a1', 'TST_OVER')] }), // 6 power
        opponent: player({ units: [unit('d1', 'TST_U1', { damage: 2 })] }), // 3/4 with 2 dmg → 2 remaining → 4 excess
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    expect(next.players.opponent.base.damage).toBe(4)
  })

  it('overwhelm excess can win the game', () => {
    const s = withCards({ TST_OVER: OVERWHELMER }, {
      players: {
        player: player({ units: [unit('a1', 'TST_OVER')] }),
        opponent: player({
          units: [unit('d1', 'TST_U2', { arena: 'ground' })], // 2/2 → 4 excess
          base: { cardId: 'TST_B', damage: 27 },
        }),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'd1' } })
    expect(next.winner).toBe('player')
  })
})

describe('Restore (heal own base on attack)', () => {
  it('heals the controlling base when the unit attacks', () => {
    const s = withCards({ TST_REST: RESTORER }, {
      players: {
        player: player({ units: [unit('a1', 'TST_REST')], base: { cardId: 'TST_B', damage: 5 } }),
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(next.players.player.base.damage).toBe(3)
  })

  it('cannot heal below zero damage', () => {
    const s = withCards({ TST_REST: RESTORER }, {
      players: {
        player: player({ units: [unit('a1', 'TST_REST')], base: { cardId: 'TST_B', damage: 1 } }),
        opponent: player(),
      },
    })
    const next = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(next.players.player.base.damage).toBe(0)
  })
})

describe('Sentinel (forced defender) and Saboteur (ignores it)', () => {
  function sentinelBoard(attackerCard: 'TST_U1' | 'TST_SAB') {
    return withCards({ TST_SENT: SENTINEL, TST_SAB: SABOTEUR }, {
      players: {
        player: player({ units: [{ ...unit('a1', 'TST_U1'), cardId: attackerCard }] }),
        opponent: player({
          units: [
            unit('s1', 'TST_SENT', { exhausted: true }), // exhausted Sentinel still soaks
            unit('e1', 'TST_U1'),
          ],
        }),
      },
    })
  }

  it('restricts attack targets to Sentinel units in that arena — no base, no others', () => {
    const attacks = legalMoves(sentinelBoard('TST_U1')).filter(a => a.type === 'attack')
    expect(attacks).toEqual([{ type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 's1' } }])
  })

  it('does not restrict attackers in the other arena', () => {
    const s = withCards({ TST_SENT: SENTINEL }, {
      players: {
        player: player({ units: [unit('a1', 'TST_U2')] }), // space attacker
        opponent: player({ units: [unit('s1', 'TST_SENT')] }), // ground sentinel
      },
    })
    const attacks = legalMoves(s).filter(a => a.type === 'attack')
    expect(attacks).toContainEqual({ type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
  })

  it('Saboteur ignores Sentinel', () => {
    const attacks = legalMoves(sentinelBoard('TST_SAB')).filter(a => a.type === 'attack')
    expect(attacks).toContainEqual({ type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(attacks).toContainEqual({ type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'e1' } })
  })

  const shieldedDefender = (attackerCard: string) => withCards({ TST_SAB: SABOTEUR }, {
    players: {
      player: player({ units: [{ ...unit('a1', 'TST_U1'), cardId: attackerCard }] }), // power via card
      opponent: player({ units: [unit('e1', 'TST_U1', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })] }), // hp 4, shielded
    },
  })

  it('Saboteur defeats the defender’s Shield before combat, so the hit lands (not optional)', () => {
    const after = resolve(shieldedDefender('TST_SAB'), { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'e1' } })
    const e1 = after.players.opponent.units.find(u => u.instanceId === 'e1')!
    expect(e1.upgrades.some(a => a.cardId === TOKEN_SHIELD)).toBe(false) // shield defeated
    expect(e1.damage).toBe(2) // took the 2 combat damage (SABOTEUR power 2)
  })

  it('without Saboteur, the Shield soaks the hit and is spent (contrast)', () => {
    const after = resolve(shieldedDefender('TST_U1'), { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'e1' } })
    const e1 = after.players.opponent.units.find(u => u.instanceId === 'e1')!
    expect(e1.upgrades.some(a => a.cardId === TOKEN_SHIELD)).toBe(false) // shield consumed
    expect(e1.damage).toBe(0) // damage prevented
  })
})
