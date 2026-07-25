import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import '../engine/cardDefinitions' // side-effect: registers Scion Shuttle and Red Leader
import { unitHasTrait } from '../engine/keywords'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'

/**
 * Support lends the source unit's abilities to the chosen attacker for one attack, by putting the
 * source's card id into the attacker's `grantedAbilityCardIds`.
 *
 * The engine spells out "which cards supply this unit's abilities" at roughly sixteen separate
 * sites, and only five of them consulted that field, so whole CATEGORIES of ability were silently
 * never lent (#417). Scion Shuttle's debuff is an `aura`, and Red Leader's cross-arena targeting is
 * `attacksEitherArena`; both hooks were granted-blind. These tests pin the two reported shapes plus
 * the boundaries: exactly one application, and printed traits are not abilities so they do not
 * travel.
 */
const C = {
  ...CARDS,
  // Real ids so the registered abilities apply; stats simplified for readable combat maths.
  ASH_046: card({ id: 'ASH_046', name: 'Scion Shuttle', type: 'unit', arena: 'space', cost: 0, power: 2, hp: 2, keywords: [{ name: 'Support' }] }),
  ASH_037: card({ id: 'ASH_037', name: 'Red Leader', type: 'unit', arena: 'space', cost: 0, power: 2, hp: 2, keywords: [{ name: 'Support' }] }),
  GATK: card({ id: 'GATK', name: 'Ground Attacker', type: 'unit', arena: 'ground', power: 1, hp: 5 }),
  DEF2: card({ id: 'DEF2', name: 'Two HP Defender', type: 'unit', arena: 'ground', power: 0, hp: 2 }),
  DEF3: card({ id: 'DEF3', name: 'Three HP Defender', type: 'unit', arena: 'ground', power: 0, hp: 3 }),
  SDEF: card({ id: 'SDEF', name: 'Space Defender', type: 'unit', arena: 'space', power: 0, hp: 3 }),
  MANDO_SUP: card({ id: 'MANDO_SUP', name: 'Mando Support', type: 'unit', arena: 'ground', traits: ['Mandalorian'], keywords: [{ name: 'Support' }] }),
}

/** A board with `supportCardId` in hand and one ready ground attacker, facing `enemy`. */
function board(supportCardId: string, enemy: ReturnType<typeof unit>) {
  return state({
    cards: C,
    players: {
      player: player({ hand: [supportCardId], units: [unit('u1', 'GATK', { arena: 'ground' })] }),
      opponent: player({ units: [enemy] }),
    },
  })
}

const enemyGone = (s: ReturnType<typeof state>) => s.players.opponent.units.find(u => u.instanceId === 'e1') === undefined

describe('Support lends an aura (Scion Shuttle, #417)', () => {
  it('applies the lent -1/-1 to the defender, defeating a unit that would otherwise survive', () => {
    const played = resolve(board('ASH_046', unit('e1', 'DEF2', { arena: 'ground' })), { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'support', controller: 'player' })

    // The attacker's 1 power meets the defender's effective HP of 2 - 1 = 1, so it is defeated.
    const attacked = resolve(played, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(enemyGone(attacked)).toBe(true)
  })

  it('control: the same attack without the Support grant leaves the defender alive', () => {
    // Identical board, but decline the support so no ability is lent. 1 damage vs 2 HP survives.
    const played = resolve(board('ASH_046', unit('e1', 'DEF2', { arena: 'ground' })), { type: 'playUnit', handIndex: 0 })
    const declined = resolve(played, { type: 'skipTrigger' })
    const attacked = resolve({ ...declined, activePlayer: 'player' }, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(enemyGone(attacked)).toBe(false)
    expect(attacked.players.opponent.units.find(u => u.instanceId === 'e1')?.damage).toBe(1)
  })

  it('applies exactly once, even though the real Scion Shuttle is also in play', () => {
    // The Shuttle that granted the ability is itself on the board and is iterated as its own aura
    // source. Its guard (it must be the attacker) is false, so it must not stack a second -1/-1:
    // against 3 HP, one application leaves the defender alive, two would defeat it.
    const played = resolve(board('ASH_046', unit('e1', 'DEF3', { arena: 'ground' })), { type: 'playUnit', handIndex: 0 })
    const attacked = resolve(played, { type: 'attack', attackerId: 'u1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(enemyGone(attacked)).toBe(false)
  })
})

describe('Support lends a targeting hook (Red Leader, #417)', () => {
  it('lets the borrowing ground unit attack into the space arena', () => {
    const played = resolve(board('ASH_037', unit('e1', 'SDEF', { arena: 'space' })), { type: 'playUnit', handIndex: 0 })
    const crossArena = legalMoves(played).filter(
      a => a.type === 'attack' && a.attackerId === 'u1' && a.target.kind === 'unit' && a.target.instanceId === 'e1',
    )
    expect(crossArena.length).toBeGreaterThan(0)
  })
})

describe('Support lends abilities, not printed traits (#417)', () => {
  it('a borrowed card does not give its printed traits to the borrower', () => {
    // "It gains this unit's other ABILITIES for this attack" — a printed trait is not an ability,
    // so trait-matching effects must not see it. Only a `grantedTraits` hook lends traits.
    const s = state({
      cards: C,
      players: {
        player: player({ units: [unit('u1', 'GATK', { arena: 'ground', grantedAbilityCardIds: ['MANDO_SUP'] })] }),
        opponent: player(),
      },
    })
    expect(unitHasTrait(s, s.players.player.units[0], 'Mandalorian')).toBe(false)
  })
})
