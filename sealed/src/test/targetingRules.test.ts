import { describe, it, expect } from 'vitest'
import twiSet from './fixtures/twiSet.json'
import { enemyAttackTargets, legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { buildCardDb } from '../engine/cardDb'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { SwuCard } from '../data/cards'
import type { Action } from '../engine/actions'
import type { GameState, LastingEffect, PendingChoice } from '../engine/types'

/**
 * Targeting rules — who may attack what: "can't attack bases" (Wicket), "can't be attacked
 * while …" (Tatooine Repulsor Train) and "may attack either arena" (Red Leader). All are answered by
 * `enemyAttackTargets`, whose `targets` and `canAttackBase` are the only inputs to `attackMoves`, so
 * one statement of each rule binds every path that offers an attack — Ambush and Support included.
 */
const F = {
  ...CARDS,
  ASH_034: card({ id: 'ASH_034', type: 'unit', arena: 'ground', power: 3, hp: 3, keywords: [{ name: 'Saboteur' }] }), // Wicket
  ASH_037: card({ id: 'ASH_037', type: 'unit', arena: 'space', power: 6, hp: 6, keywords: [{ name: 'Support' }] }), // Red Leader
  ASH_035: card({ id: 'ASH_035', type: 'unit', arena: 'ground', power: 8, hp: 7 }), // Tatooine Repulsor Train
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', power: 2, hp: 5 }),
  SPC: card({ id: 'SPC', type: 'unit', arena: 'space', power: 2, hp: 5 }),
  SENTINEL_GRD: card({ id: 'SENTINEL_GRD', type: 'unit', arena: 'ground', power: 2, hp: 5, keywords: [{ name: 'Sentinel' }] }),
  SENTINEL_SPC: card({ id: 'SENTINEL_SPC', type: 'unit', arena: 'space', power: 2, hp: 5, keywords: [{ name: 'Sentinel' }] }),
}
const attacks = (s: GameState, attackerId: string) =>
  legalMoves(s).filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack' && a.attackerId === attackerId)
const targetsOf = (s: GameState, attackerId: string) =>
  attacks(s, attackerId).map(a => (a.target.kind === 'base' ? 'base' : a.target.instanceId)).sort()

describe("Wicket (034) — can't attack bases", () => {
  it('offers enemy units but never the base', () => {
    const s = state({
      cards: F,
      players: { player: player({ units: [unit('w', 'ASH_034', { arena: 'ground' })] }), opponent: player({ units: [unit('e', 'GRD', { arena: 'ground' })] }) },
    })
    expect(targetsOf(s, 'w')).toEqual(['e'])
  })

  it('a normal unit in the same spot CAN attack the base (control)', () => {
    const s = state({
      cards: F,
      players: { player: player({ units: [unit('n', 'GRD', { arena: 'ground' })] }), opponent: player({ units: [unit('e', 'GRD', { arena: 'ground' })] }) },
    })
    expect(targetsOf(s, 'n')).toEqual(['base', 'e'])
  })

  /**
   * **The restriction is on the attack target, not on where the damage ends up.** An attack declares
   * a legal target and only then computes damage, so Overwhelm's excess reaching the base is not the
   * unit attacking the base: it attacked a unit, and the surplus tramples through (CR 1.9.11).
   */
  it('still tramples excess to the base with Overwhelm', () => {
    const s = state({
      cards: { ...F, OVERWHELM_UP: card({ id: 'OVERWHELM_UP', type: 'upgrade', power: 0, hp: 0, keywords: [{ name: 'Overwhelm' }] }) },
      players: {
        player: player({ units: [unit('w', 'ASH_034', { arena: 'ground', upgrades: [{ cardId: 'OVERWHELM_UP', owner: 'player' }] })] }),
        opponent: player({ units: [unit('e', 'GRD', { arena: 'ground', damage: 4 })] }), // 1 HP left
      },
    })
    expect(targetsOf(s, 'w'), 'the base is still not a legal attack target').toEqual(['e'])
    const done = resolve(s, { type: 'attack', attackerId: 'w', target: { kind: 'unit', instanceId: 'e' } })
    expect(done.players.opponent.base.damage, 'power 3 less the defender\'s 1 remaining HP').toBe(2)
  })
})

describe('Red Leader (037) — may attack units in either arena', () => {
  it('reaches a ground unit from the space arena', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('r', 'ASH_037', { arena: 'space' })] }),
        opponent: player({ units: [unit('g', 'GRD', { arena: 'ground' }), unit('sp', 'SPC', { arena: 'space' })] }),
      },
    })
    expect(targetsOf(s, 'r')).toEqual(['base', 'g', 'sp'])
  })

  it('a normal space unit only reaches the space arena (control)', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('n', 'SPC', { arena: 'space' })] }),
        opponent: player({ units: [unit('g', 'GRD', { arena: 'ground' }), unit('sp', 'SPC', { arena: 'space' })] }),
      },
    })
    expect(targetsOf(s, 'n')).toEqual(['base', 'sp'])
  })

  /**
   * **Reaching into an arena is not being in it.**
   *
   * Sentinel reads "Enemy units **in this arena** must attack a Sentinel when they attack you", so the
   * forcing is scoped by the SENTINEL's arena and applies to the units standing in it. Red Leader is a
   * space unit; being able to attack into the ground arena does not place it there, so a ground
   * Sentinel must not lock it.
   *
   * Reported from live play: a player holding Red Leader could not attack the base while the space
   * lane was open, because the widened target list swept a ground Sentinel into the forcing set.
   */
  const withSentinel = (sentinel: ReturnType<typeof unit>) => state({
    cards: F,
    players: {
      player: player({ units: [unit('r', 'ASH_037', { arena: 'space' })] }),
      opponent: player({ units: [sentinel, unit('sp', 'SPC', { arena: 'space' })] }),
    },
  })

  it('is not locked by a Sentinel in the OTHER arena', () => {
    const s = withSentinel(unit('gs', 'SENTINEL_GRD', { arena: 'ground' }))
    // Still reaches everything, base included: nothing in the space arena is forcing it.
    expect(targetsOf(s, 'r')).toEqual(['base', 'gs', 'sp'])
  })

  it('IS locked by a Sentinel in its own arena', () => {
    const s = withSentinel(unit('ss', 'SENTINEL_SPC', { arena: 'space' }))
    expect(targetsOf(s, 'r')).toEqual(['ss'])
  })

  /** A ground Sentinel still locks a ground attacker, which is the rule the fix must not weaken. */
  it('still locks an ordinary attacker standing in the Sentinel\'s arena (control)', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('g', 'GRD', { arena: 'ground' })] }),
        opponent: player({ units: [unit('gs', 'SENTINEL_GRD', { arena: 'ground' }), unit('other', 'GRD', { arena: 'ground' })] }),
      },
    })
    expect(targetsOf(s, 'g')).toEqual(['gs'])
  })
})

describe("Tatooine Repulsor Train (035) — can't be attacked while you control 2+ exhausted units", () => {
  const board = (defenderExtras: ReturnType<typeof unit>[], train: Parameters<typeof unit>[2] = {}) => state({
    cards: F,
    players: {
      player: player({ units: [unit('a', 'GRD', { arena: 'ground' })] }), // active attacker
      opponent: player({ units: [unit('t', 'ASH_035', { arena: 'ground', ...train }), ...defenderExtras] }),
    },
  })

  it('is attackable with fewer than 2 exhausted friendlies', () => {
    const s = board([unit('x', 'GRD', { arena: 'ground', exhausted: true })]) // only 1 exhausted
    expect(targetsOf(s, 'a')).toContain('t')
  })

  it('is NOT attackable once its controller has 2+ exhausted units', () => {
    const s = board([unit('x', 'GRD', { arena: 'ground', exhausted: true }), unit('y', 'GRD', { arena: 'ground', exhausted: true })])
    const t = targetsOf(s, 'a')
    expect(t).not.toContain('t')
    expect(t).toContain('x') // the others are still fair game
  })

  it('is attackable again if it gains Sentinel — and then forces the attack', () => {
    const s = board(
      [unit('x', 'GRD', { arena: 'ground', exhausted: true }), unit('y', 'GRD', { arena: 'ground', exhausted: true })],
      { upgrades: [{ cardId: 'SENTINEL_UP', owner: 'opponent' }] },
    )
    const withUpgrade = { ...s, cards: { ...F, SENTINEL_UP: card({ id: 'SENTINEL_UP', type: 'upgrade', power: 0, hp: 0, keywords: [{ name: 'Sentinel' }] }) } }
    expect(targetsOf(withUpgrade, 'a')).toEqual(['t']) // Sentinel re-exposes it and locks the attack on
  })

  it('On Attack: deals 2 damage per friendly exhausted unit to a chosen ground unit', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ units: [unit('t', 'ASH_035', { arena: 'ground' }), unit('x', 'GRD', { arena: 'ground', exhausted: true })] }),
        opponent: player({ units: [unit('e', 'GRD', { arena: 'ground' })] }),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 't', target: { kind: 'base' } })
    // The Train exhausts itself by attacking, so 2 exhausted friendlies → 4 damage.
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'selectDamageTarget', amount: 4 })
  })
})

/**
 * **"Can't attack bases" is a targeting rule like any other, so it binds every path that grants an
 * attack.** It was the one such rule computed OUTSIDE `enemyAttackTargets`: the four choice-driven
 * paths each re-derived base legality from `sentinelLocked` alone and so dropped this half of it.
 * Wicket could not attack a base on its own turn, but could through Support, a granted attack, or
 * Grogu and Thrawn.
 */
describe("Wicket (034) — can't attack bases on any path that grants an attack", () => {
  const withChoice = (choice: PendingChoice) => state({
    cards: F,
    pendingChoices: [choice],
    players: {
      player: player({ units: [unit('w', 'ASH_034', { arena: 'ground' }), unit('n', 'GRD', { arena: 'ground' })] }),
      opponent: player({ units: [unit('e', 'GRD', { arena: 'ground' })] }),
    },
  })
  const support: PendingChoice = { kind: 'support', id: 'c', controller: 'player', unitId: 'n' }
  const anyUnit: PendingChoice = { kind: 'mayAttackAnyUnit', id: 'c', controller: 'player', restore: 0 }
  const named: PendingChoice = { kind: 'mayAttack', id: 'c', controller: 'player', unitId: 'w' }

  it('via Support', () => {
    expect(targetsOf(withChoice(support), 'w')).toEqual(['e'])
  })

  it('via an attack offered to any ready unit (Grogu, Thrawn, the rider events)', () => {
    expect(targetsOf(withChoice(anyUnit), 'w')).toEqual(['e'])
  })

  it('via an attack offered to one named unit (Improvised Identity)', () => {
    expect(targetsOf(withChoice(named), 'w')).toEqual(['e'])
  })

  it('and an ordinary unit still reaches the base on those paths (control)', () => {
    expect(targetsOf(withChoice(anyUnit), 'n')).toEqual(['base', 'e'])
  })
})

/**
 * **An ability that grants a MANDATORY attack must not offer itself when no attack is legal.**
 * Thrawn and the four rider events print "Attack with a unit" with no "may", so their choice has no
 * decline: raising it with nothing to attack would leave the player no legal move at all. Their
 * guards therefore have to ask the same question the move enumeration does, base legality included.
 */
describe('a mandatory granted attack is offered only when one is legal', () => {
  const G = { ...F, ASH_004: card({ id: 'ASH_004', type: 'leader', cost: 8, power: 5, hp: 8 }), ASH_162: card({ id: 'ASH_162', type: 'event', cost: 1 }) }

  /** Wicket ready and alone, and no enemy unit: it cannot attack a base, and there is nothing else. */
  const noAttackPossible = (over: Parameters<typeof player>[0] = {}) => state({
    cards: G,
    players: {
      player: player({ resources: ready(10), units: [unit('w', 'ASH_034', { arena: 'ground' })], ...over }),
      opponent: player(),
    },
  })

  it('Thrawn (004) cannot use his leader action', () => {
    const s = noAttackPossible({ leader: { cardId: 'ASH_004', deployed: false, epicActionUsed: false, exhausted: false } })
    expect(legalMoves(s).some(m => m.type === 'useLeaderAbility')).toBe(false)
  })

  it('Rash Action (162) raises no choice, so the board is never left unanswerable', () => {
    const s = noAttackPossible({ hand: ['ASH_162'] })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices ?? []).toHaveLength(0)
    expect(legalMoves(played).length, 'the player still has moves').toBeGreaterThan(0)
  })

  it('but both are on offer as soon as there is something to attack (control)', () => {
    const withEnemy = (over: Parameters<typeof player>[0]) => ({
      ...noAttackPossible(over),
      players: { ...noAttackPossible(over).players, opponent: player({ units: [unit('e', 'GRD', { arena: 'ground' })] }) },
    })
    const thrawn = withEnemy({ leader: { cardId: 'ASH_004', deployed: false, epicActionUsed: false, exhausted: false } })
    expect(legalMoves(thrawn).some(m => m.type === 'useLeaderAbility')).toBe(true)
    const played = resolve(withEnemy({ hand: ['ASH_162'] }), { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices ?? []).toHaveLength(1)
  })
})

// ── "Can't be attacked": one rule, every source of an attack ────────────────────────────────────

const C = {
  ...F,
  ...buildCardDb(twiSet as unknown as SwuCard[]),
  SEC_012: card({ id: 'SEC_012', type: 'leader', cost: 5, power: 3, hp: 6 }), // Cassian Andor
  SEC_135: card({ id: 'SEC_135', type: 'unit', arena: 'ground', power: 3, hp: 3 }), // Muckraker Crab Droid
  SOR_142: card({ id: 'SOR_142', type: 'unit', arena: 'ground', power: 2, hp: 3 }), // Sabine Wren
  TWI_195: card({ id: 'TWI_195', type: 'unit', arena: 'ground', power: 3, hp: 4 }), // Sabine Wren
  SENTINEL_UP: card({ id: 'SENTINEL_UP', type: 'upgrade', power: 0, hp: 0, keywords: [{ name: 'Sentinel' }] }),
  OVERWHELM_UP: card({ id: 'OVERWHELM_UP', type: 'upgrade', power: 0, hp: 0, keywords: [{ name: 'Overwhelm' }] }),
  CMD: card({ id: 'CMD', type: 'unit', arena: 'ground', power: 1, hp: 5, aspects: ['Command'] }),
  AGG: card({ id: 'AGG', type: 'unit', arena: 'ground', power: 1, hp: 5, aspects: ['Aggression'] }),
  CUN: card({ id: 'CUN', type: 'unit', arena: 'ground', power: 1, hp: 5, aspects: ['Cunning'] }),
  SEP: card({ id: 'SEP', type: 'unit', arena: 'ground', power: 1, hp: 5, traits: ['Separatist'] }),
}
const cassian = { cardId: 'SEC_012', deployed: false, epicActionUsed: false, exhausted: false }
const sentinel = [{ cardId: 'SENTINEL_UP', owner: 'opponent' as const }]

/**
 * Cassian Andor's undeployed front: "Friendly units that have damaged an opponent's base this phase
 * can't be attacked (unless they have Sentinel)." The opponent leads with him here and attacks the
 * player's base with `d`, so the board handed back is the player's turn, with `d` the protected unit.
 */
function cassianBoard({ leader = cassian, defender = {}, playerUnits = [], baseShielded = false }: {
  leader?: typeof cassian
  defender?: Parameters<typeof unit>[2]
  playerUnits?: ReturnType<typeof unit>[]
  baseShielded?: boolean
} = {}): GameState {
  const s = state({
    cards: C,
    activePlayer: 'opponent',
    ...(baseShielded ? { shieldedBases: ['player' as const] } : {}),
    players: {
      player: player({ units: [unit('a', 'GRD', { arena: 'ground' }), unit('n', 'GRD', { arena: 'ground' }), ...playerUnits] }),
      opponent: player({ leader, units: [unit('d', 'GRD', { arena: 'ground', ...defender }), unit('x', 'GRD', { arena: 'ground' })] }),
    },
  })
  const attacked = resolve(s, { type: 'attack', attackerId: 'd', target: { kind: 'base' } })
  expect(attacked.activePlayer, 'the attack hands the turn to the player').toBe('player')
  return attacked
}

describe("Cassian Andor (SEC_012) front: friendly units that damaged an opponent's base can't be attacked", () => {
  it('closes off a unit that dealt combat damage to the enemy base, and only that unit', () => {
    const s = cassianBoard()
    expect(s.players.player.base.damage, 'the attack landed').toBe(2)
    expect(targetsOf(s, 'a')).toEqual(['base', 'x'])
  })

  it('a unit that attacked the base but dealt it no damage is still attackable', () => {
    const s = cassianBoard({ baseShielded: true })
    expect(s.players.player.base.damage, 'the shield soaked it').toBe(0)
    expect(targetsOf(s, 'a')).toEqual(['base', 'd', 'x'])
  })

  it('counts Overwhelm damage that tramples through to the base', () => {
    const s0 = state({
      cards: C,
      activePlayer: 'opponent',
      players: {
        player: player({ units: [unit('a', 'GRD', { arena: 'ground' }), unit('weak', 'GRD', { arena: 'ground', damage: 4 })] }),
        opponent: player({ leader: cassian, units: [unit('d', 'GRD', { arena: 'ground', upgrades: [{ cardId: 'OVERWHELM_UP', owner: 'opponent' }] }), unit('x', 'GRD', { arena: 'ground' })] }),
      },
    })
    const s = resolve(s0, { type: 'attack', attackerId: 'd', target: { kind: 'unit', instanceId: 'weak' } })
    expect(s.players.player.base.damage, '2 power into 1 remaining HP: 1 tramples').toBe(1)
    expect(targetsOf(s, 'a')).toEqual(['base', 'x'])
  })

  it('counts damage a friendly unit deals to the enemy base with an ability (Vanguard Droid Bomber)', () => {
    const play = (units: ReturnType<typeof unit>[]) => {
      const s0 = state({
        cards: C,
        activePlayer: 'opponent',
        players: {
          player: player({ units: [unit('sa', 'SPC', { arena: 'space' })] }),
          opponent: player({ leader: cassian, resources: ready(10), hand: ['TWI_160'], units }),
        },
      })
      const s = resolve(s0, { type: 'playUnit', handIndex: 0 })
      const bomber = s.players.opponent.units.find(u => u.cardId === 'TWI_160')!
      return { s, bomber: bomber.instanceId }
    }
    const fired = play([unit('sep', 'SEP', { arena: 'ground' })])
    expect(fired.s.players.player.base.damage, 'When Played dealt 2 to the base').toBe(2)
    expect(targetsOf(fired.s, 'sa')).toEqual(['base'])
    // Control: without another Separatist the ability does nothing, and the Bomber is fair game.
    const idle = play([])
    expect(idle.s.players.player.base.damage).toBe(0)
    expect(targetsOf(idle.s, 'sa')).toEqual(['base', idle.bomber])
  })

  it('with Sentinel the unit is attackable again, and forces the attack', () => {
    const s = cassianBoard({ defender: { upgrades: sentinel } })
    expect(targetsOf(s, 'a')).toEqual(['d'])
  })

  it("protects only Cassian's side: the player's own base attackers stay attackable", () => {
    // The opponent's unit attacked first, then the player's `a` hits back at the base.
    const s = cassianBoard()
    const back = resolve(s, { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(back.activePlayer).toBe('opponent')
    expect(targetsOf(back, 'x')).toEqual(['a', 'base', 'n'])
  })

  it('stops once he is deployed: the front is no longer in play', () => {
    const s = cassianBoard({ leader: { ...cassian, deployed: true } })
    expect(targetsOf(s, 'a')).toEqual(['base', 'd', 'x'])
  })
})

/**
 * **Every "can't be attacked" protection binds every source of an attack, with the Sentinel exception
 * exactly where the card prints one.** A row per protection: the board it holds on, and whether
 * Sentinel lifts it. Each row is read through the five sources of an attack (the action phase, Ambush,
 * Support, an attack offered to any unit, an attack offered to one named unit) and through
 * `enemyAttackTargets` as the AI's race reads it. The lasting rows are the protection the event or
 * When Played leaves behind; the cards' own tests show they leave it.
 */
describe("can't be attacked: every protection, every source of an attack", () => {
  type Row = { name: string; defender: Parameters<typeof unit>[2]; extras?: ReturnType<typeof unit>[]; lasting?: LastingEffect; unlessSentinel: boolean; cardId?: string; cassian?: boolean }
  const rows: Row[] = [
    { name: 'Hidden', defender: { hidden: true }, unlessSentinel: true },
    { name: 'Tatooine Repulsor Train (ASH_035), 2 exhausted friendlies', cardId: 'ASH_035', defender: { exhausted: true }, extras: [unit('e2', 'GRD', { arena: 'ground', exhausted: true })], unlessSentinel: true },
    { name: 'Muckraker Crab Droid (SEC_135), ready', cardId: 'SEC_135', defender: {}, unlessSentinel: false },
    { name: 'Sabine Wren (SOR_142), 3 aspects among other friendlies', cardId: 'SOR_142', defender: {}, extras: [unit('c1', 'CMD', { arena: 'ground' }), unit('c2', 'AGG', { arena: 'ground' }), unit('c3', 'CUN', { arena: 'ground' })], unlessSentinel: true },
    { name: 'Sabine Wren (TWI_195), exhausted', cardId: 'TWI_195', defender: { exhausted: true }, unlessSentinel: true },
    { name: 'On Top of Things (TWI_219) / Go Into Hiding (LOF_262)', defender: {}, lasting: { targetInstanceId: 'd', cannotBeAttacked: true, unlessSentinel: true }, unlessSentinel: true },
    { name: 'Dooku (LOF_211) / Ben Solo (LAW_185)', defender: {}, lasting: { targetInstanceId: 'd', cannotBeAttacked: true }, unlessSentinel: false },
    { name: 'Cassian Andor (SEC_012) front, after damaging the base', defender: {}, cassian: true, unlessSentinel: true },
  ]

  const board = (row: Row, withSentinel: boolean, choice?: PendingChoice): GameState => {
    const defender = { arena: 'ground' as const, ...row.defender, ...(withSentinel ? { upgrades: sentinel } : {}) }
    const base = row.cassian
      ? cassianBoard({ defender })
      : state({
        cards: C,
        ...(row.lasting ? { lastingEffects: [row.lasting] } : {}),
        players: {
          player: player({ units: [unit('a', 'GRD', { arena: 'ground' }), unit('n', 'GRD', { arena: 'ground' })] }),
          opponent: player({ units: [unit('d', row.cardId ?? 'GRD', defender), unit('x', 'GRD', { arena: 'ground' }), ...(row.extras ?? [])] }),
        },
      })
    return choice ? { ...base, pendingChoices: [choice] } : base
  }
  const sources: [string, PendingChoice | undefined][] = [
    ['the action phase', undefined],
    ['Ambush', { kind: 'ambush', id: 'c', controller: 'player', unitId: 'a' }],
    ['Support', { kind: 'support', id: 'c', controller: 'player', unitId: 'n' }],
    ['an attack offered to any unit', { kind: 'mayAttackAnyUnit', id: 'c', controller: 'player', restore: 0 }],
    ['an attack offered to one named unit', { kind: 'mayAttack', id: 'c', controller: 'player', unitId: 'a' }],
  ]
  const hits = (s: GameState) => targetsOf(s, 'a').includes('d')

  for (const row of rows) {
    describe(row.name, () => {
      for (const [source, choice] of sources) {
        it(`is not a target via ${source}`, () => {
          expect(hits(board(row, false, choice))).toBe(false)
        })
      }

      it("is not a target in the AI's race read", () => {
        const s = board(row, false)
        expect(enemyAttackTargets(s, s.players.player.units[0], 'player').targets.map(u => u.instanceId)).not.toContain('d')
      })

      if (row.unlessSentinel) {
        it('is a target again with Sentinel, which forces the attack', () => {
          for (const [, choice] of sources) expect(targetsOf(board(row, true, choice), 'a')).toEqual(['d'])
        })
      } else {
        it('stays out of reach with Sentinel, and does not force the attack', () => {
          for (const [, choice] of sources) {
            const t = targetsOf(board(row, true, choice), 'a')
            expect(t).not.toContain('d')
            expect(t).toContain('x')
          }
        })
      }
    })
  }
})
