import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { describeAction } from '../utils/describeAction'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import type { LeaderState } from '../engine/types'

/** Undeployed-leader activated abilities (#309). */
const undeployed = (cardId: string): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })

describe('Cad Bane (ASH_011) — front: deal 1 to a unit with 2+ remaining HP (#309)', () => {
  const cards = { ...CARDS, ASH_011: card({ id: 'ASH_011', type: 'leader', cost: 6, power: 4, hp: 7 }) }

  it('offers the ability only against units with 2+ remaining HP', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: undeployed('ASH_011'), units: [unit('u1', 'TST_U1')] }), // hp 4 → remaining 4
        opponent: player({ units: [unit('e1', 'TST_U3'), unit('e2', 'TST_U1', { damage: 3 })] }), // e1 hp1; e2 remaining 1
      },
    })
    const targets = legalMoves(s).filter(a => a.type === 'useLeaderAbility').map(a => a.targetInstanceId).sort()
    expect(targets).toEqual(['u1']) // e1 (1 HP) and e2 (1 remaining) excluded
  })

  it('deals 1 to the chosen unit, exhausts the leader, and passes the turn', () => {
    const s = state({
      cards,
      players: { player: player({ leader: undeployed('ASH_011'), units: [unit('u1', 'TST_U1')] }), opponent: player() },
    })
    const next = resolve(s, { type: 'useLeaderAbility', index: 0, targetInstanceId: 'u1' })
    expect(next.players.player.units[0].damage).toBe(1)
    expect(next.players.player.leader.exhausted).toBe(true)
    expect(next.activePlayer).toBe('opponent')
    // No longer offered once the leader is exhausted (this-round limit).
    expect(legalMoves({ ...next, activePlayer: 'player' }).some(a => a.type === 'useLeaderAbility')).toBe(false)
  })
})

describe('Emperor Palpatine (ASH_015) — front: Advantage per other friendly unit (#309)', () => {
  const cards = { ...CARDS, ASH_015: card({ id: 'ASH_015', type: 'leader', cost: 7 }) }

  it('targets only exhausted friendly units and gives one Advantage per other friendly unit', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: undeployed('ASH_015'), units: [unit('u1', 'TST_U1', { exhausted: true }), unit('u2', 'TST_U1'), unit('u3', 'TST_U1')] }),
        opponent: player({ units: [unit('e1', 'TST_U1', { exhausted: true })] }), // enemy exhausted unit is NOT a target
      },
    })
    expect(legalMoves(s).filter(a => a.type === 'useLeaderAbility').map(a => a.targetInstanceId)).toEqual(['u1'])
    const next = resolve(s, { type: 'useLeaderAbility', index: 0, targetInstanceId: 'u1' })
    // u2 + u3 = 2 other friendly units → 2 Advantage tokens on u1.
    expect(next.players.player.units.find(u => u.instanceId === 'u1')!.upgrades.filter(a => a.cardId === TOKEN_ADVANTAGE)).toHaveLength(2)
    expect(next.players.player.leader.exhausted).toBe(true)
  })
})

const deployed = (cardId: string): LeaderState => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })

describe('Cad Bane (ASH_011) — deployed: On Attack may deal 1 (#309)', () => {
  const cards = { ...CARDS, ASH_011: card({ id: 'ASH_011', type: 'leader', power: 4, hp: 7 }) }
  const board = () => state({
    cards,
    players: {
      player: player({ leader: deployed('ASH_011'), units: [unit('L', 'ASH_011', { isLeader: true })] }),
      opponent: player({ units: [unit('e1', 'TST_U4')] }), // hp 9
    },
  })

  it('fires On Attack before damage, suspending combat with the attacker in control', () => {
    const atk = resolve(board(), { type: 'attack', attackerId: 'L', target: { kind: 'unit', instanceId: 'e1' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayDamage', amount: 1 })
    expect(atk.pendingAttack).toMatchObject({ attackerId: 'L', stage: 'onDefense' })
    expect(atk.activePlayer).toBe('player')
    expect(atk.players.opponent.units[0].damage).toBe(0) // no combat damage yet
  })

  it('accepting deals the 1 then resolves combat', () => {
    const atk = resolve(board(), { type: 'attack', attackerId: 'L', target: { kind: 'unit', instanceId: 'e1' } })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, targetInstanceId: 'e1' })
    expect(done.players.opponent.units.find(u => u.instanceId === 'e1')!.damage).toBe(5) // 1 (On Attack) + 4 (combat)
    expect(done.pendingChoices).toBeUndefined()
    expect(done.pendingAttack).toBeUndefined()
    expect(done.activePlayer).toBe('opponent')
  })

  it('declining proceeds to normal combat', () => {
    const atk = resolve(board(), { type: 'attack', attackerId: 'L', target: { kind: 'unit', instanceId: 'e1' } })
    const done = resolve(atk, { type: 'skipTrigger', choiceId: atk.pendingChoices![0].id })
    expect(done.players.opponent.units.find(u => u.instanceId === 'e1')!.damage).toBe(4) // combat only
    expect(done.activePlayer).toBe('opponent')
  })
})

describe('Emperor Palpatine (ASH_015) — deployed: On Attack may give Advantage per other (#309)', () => {
  it('offers only another exhausted friendly unit and gives one Advantage per other friendly unit', () => {
    const s = state({
      cards: { ...CARDS, ASH_015: card({ id: 'ASH_015', type: 'leader', power: 3, hp: 5 }) },
      players: {
        player: player({ leader: deployed('ASH_015'), units: [unit('L', 'ASH_015', { isLeader: true }), unit('u2', 'TST_U1', { exhausted: true }), unit('u3', 'TST_U1')] }),
        opponent: player(),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'base' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayAdvantageEach', targets: ['u2'] }) // u3 ready, L excluded
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, targetInstanceId: 'u2' })
    expect(done.players.player.units.find(u => u.instanceId === 'u2')!.upgrades.filter(a => a.cardId === TOKEN_ADVANTAGE)).toHaveLength(2) // L + u3
    expect(done.players.opponent.base.damage).toBe(3) // base attack completed
    expect(done.activePlayer).toBe('opponent')
  })
})

describe('Vane (ASH_012) — defeat a friendly upgrade → 2 to base (#309)', () => {
  const cards = { ...CARDS, ASH_012: card({ id: 'ASH_012', type: 'leader', power: 2, hp: 5 }), UP: card({ id: 'UP', type: 'upgrade' }) }

  it('front: defeats the chosen unit’s upgrade and deals 2 to the enemy base', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: undeployed('ASH_012'), units: [unit('u1', 'TST_U1', { upgrades: [{ cardId: 'UP', owner: 'player' }] }), unit('u2', 'TST_U1')] }),
        opponent: player(),
      },
    })
    expect(legalMoves(s).filter(a => a.type === 'useLeaderAbility').map(a => a.targetInstanceId)).toEqual(['u1']) // only the unit with an upgrade
    const next = resolve(s, { type: 'useLeaderAbility', index: 0, targetInstanceId: 'u1' })
    expect(next.players.player.units.find(u => u.instanceId === 'u1')!.upgrades.some(a => a.cardId === 'UP')).toBe(false)
    expect(next.players.player.discard).toContain('UP')
    expect(next.players.opponent.base.damage).toBe(2)
    expect(next.players.player.leader.exhausted).toBe(true)
  })

  it('deployed: On Attack may defeat a friendly upgrade to deal 2 to the base', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: deployed('ASH_012'), units: [unit('L', 'ASH_012', { isLeader: true, upgrades: [{ cardId: 'UP', owner: 'player' }] })] }),
        opponent: player(),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'base' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayDefeatUpgradeForBase', targets: ['L'] })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, targetInstanceId: 'L' })
    expect(done.players.player.discard).toContain('UP')
    expect(done.players.opponent.base.damage).toBe(4) // 2 (ability) + 2 (combat, L power 2)
    expect(done.activePlayer).toBe('opponent')
  })
})

describe('Greef Karga (ASH_017) — when you play a unit, Advantage (#309)', () => {
  const cards = { ...CARDS, ASH_017: card({ id: 'ASH_017', type: 'leader' }) }

  it('front: playing a unit offers to exhaust the leader for an Advantage token on it', () => {
    const s = state({
      cards,
      players: { player: player({ leader: undeployed('ASH_017'), hand: ['TST_U1'], resources: ready(6) }), opponent: player() },
    })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustLeaderForAdvantage' })
    expect(played.activePlayer).toBe('player') // holds the turn for the choice

    const accepted = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id })
    expect(accepted.players.player.leader.exhausted).toBe(true)
    expect(accepted.players.player.units[0].upgrades.some(a => a.cardId === TOKEN_ADVANTAGE)).toBe(true)
    expect(accepted.activePlayer).toBe('opponent')
  })

  it('front: declining leaves the leader ready and the unit without a token', () => {
    const s = state({
      cards,
      players: { player: player({ leader: undeployed('ASH_017'), hand: ['TST_U1'], resources: ready(6) }), opponent: player() },
    })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    const declined = resolve(played, { type: 'skipTrigger', choiceId: played.pendingChoices![0].id })
    expect(declined.players.player.leader.exhausted).toBe(false)
    expect(declined.players.player.units[0].upgrades.some(a => a.cardId === TOKEN_ADVANTAGE)).toBe(false)
    expect(declined.activePlayer).toBe('opponent')
  })

  it('deployed: playing a unit gives it an Advantage token with no choice', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: deployed('ASH_017'), hand: ['TST_U1'], resources: ready(6), units: [unit('L', 'ASH_017', { isLeader: true })] }),
        opponent: player(),
      },
    })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    expect(played.pendingChoices).toBeUndefined()
    expect(played.players.player.units.find(u => u.cardId === 'TST_U1')!.upgrades.some(a => a.cardId === TOKEN_ADVANTAGE)).toBe(true)
    expect(played.activePlayer).toBe('opponent')
  })
})

describe('choice-id collisions (#309 regression)', () => {
  it('a Support choice and Greef Karga’s trigger on the same played unit get distinct ids and labels', () => {
    const s = state({
      cards: { ...CARDS, ASH_017: card({ id: 'ASH_017', type: 'leader' }), SUP: card({ id: 'SUP', type: 'unit', arena: 'ground', cost: 0, keywords: [{ name: 'Support' }] }) },
      players: {
        player: player({ leader: undeployed('ASH_017'), hand: ['SUP'], resources: ready(4), units: [unit('u1', 'TST_U1')] }),
        opponent: player({ units: [unit('e1', 'TST_U1')] }),
      },
    })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    const kinds = played.pendingChoices!.map(c => c.kind)
    expect(kinds).toContain('support')
    expect(kinds).toContain('mayExhaustLeaderForAdvantage')
    const ids = played.pendingChoices!.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length) // ids are unique

    // No duplicate "Skip support" — each skip resolves to its own choice.
    const skipLabels = legalMoves(played).filter(a => a.type === 'skipTrigger').map(a => describeAction(played, 'player', a))
    expect(skipLabels.filter(l => l === 'Skip support')).toHaveLength(1)
  })
})

describe('Bo-Katan Kryze (ASH_010) — custom deploy condition (#309)', () => {
  const cards = { ...CARDS, ASH_010: card({ id: 'ASH_010', type: 'leader', cost: 10 }), MANDO: card({ id: 'MANDO', type: 'unit', arena: 'ground', traits: ['Mandalorian'] }) }
  const withResourcesAndMandos = (n: number, mandos: number) =>
    state({
      cards,
      players: {
        player: player({ leader: undeployed('ASH_010'), resources: ready(n), units: Array.from({ length: mandos }, (_, i) => unit(`m${i}`, 'MANDO')) }),
        opponent: player(),
      },
    })

  it('deploys when resources + friendly Mandalorian units ≥ 10 (below the raw cost of 10)', () => {
    expect(legalMoves(withResourcesAndMandos(7, 3)).some(a => a.type === 'deployLeader')).toBe(true) // 7 + 3
  })

  it('does not deploy when the combined total is under 10', () => {
    expect(legalMoves(withResourcesAndMandos(6, 3)).some(a => a.type === 'deployLeader')).toBe(false) // 6 + 3 = 9
  })
})
