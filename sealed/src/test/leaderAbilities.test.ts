import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { describeAction } from '../utils/describeAction'
import { effectivePower, effectiveHp } from '../engine/stats'
import { unitHasKeyword } from '../engine/keywords'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import { recordUnitDefeated, recordUnitEntered } from '../engine/types'
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

describe('Vane (ASH_012) — defeat a friendly upgrade → 2 to base (#309/#348)', () => {
  const cards = { ...CARDS, ASH_012: card({ id: 'ASH_012', type: 'leader', power: 2, hp: 5 }), UP: card({ id: 'UP', type: 'upgrade' }) }

  it('front: offers every friendly upgrade — card AND token — to choose from, and is mandatory', () => {
    const s = state({
      cards,
      players: {
        player: player({
          leader: undeployed('ASH_012'),
          units: [unit('u1', 'TST_U1', { upgrades: [{ cardId: 'UP', owner: 'player' }] }), unit('u2', 'TST_U1', { upgrades: [{ cardId: TOKEN_ADVANTAGE, owner: 'player' }] })],
        }),
        opponent: player(),
      },
    })
    // Target-less action (chosen in the overlay), offered because ≥1 upgrade exists.
    expect(legalMoves(s).filter(a => a.type === 'useLeaderAbility')).toHaveLength(1)
    const raised = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(raised.pendingChoices?.[0]).toMatchObject({
      kind: 'selectUpgradeToDefeat',
      optional: false,
      candidates: [
        { unitId: 'u1', upgradeIndex: 0, cardId: 'UP' },
        { unitId: 'u2', upgradeIndex: 0, cardId: TOKEN_ADVANTAGE }, // token upgrade IS selectable
      ],
    })
    // Mandatory: two picks, no Cancel.
    const moves = legalMoves(raised)
    expect(moves.filter(a => a.type === 'acceptChoice')).toHaveLength(2)
    expect(moves.some(a => a.type === 'skipTrigger')).toBe(false)

    // Defeat the token (option 1): removed, then a damage-target choice for "a base" (either).
    const afterDefeat = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, optionIndex: 1 })
    expect(afterDefeat.players.player.units.find(u => u.instanceId === 'u2')!.upgrades).toHaveLength(0)
    expect(afterDefeat.players.player.units.find(u => u.instanceId === 'u1')!.upgrades.some(a => a.cardId === 'UP')).toBe(true) // untouched
    expect(afterDefeat.pendingChoices?.[0]).toMatchObject({ kind: 'selectDamageTarget', amount: 2, unitTargets: [], baseTargets: ['player', 'opponent'] })
    // Both bases are selectable; choose the enemy base.
    const baseChoices = legalMoves(afterDefeat).flatMap(a => (a.type === 'acceptChoice' && a.baseTarget ? [a.baseTarget] : []))
    expect(baseChoices.sort()).toEqual(['opponent', 'player'])
    const done = resolve(afterDefeat, { type: 'acceptChoice', choiceId: afterDefeat.pendingChoices![0].id, baseTarget: 'opponent' })
    expect(done.players.opponent.base.damage).toBe(2)
    expect(done.players.player.leader.exhausted).toBe(true)
    expect(done.activePlayer).toBe('opponent')
  })

  it('front: can aim the 2 damage at your OWN base ("a base")', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: undeployed('ASH_012'), units: [unit('u1', 'TST_U1', { upgrades: [{ cardId: 'UP', owner: 'player' }] })] }),
        opponent: player(),
      },
    })
    const afterDefeat = resolve(resolve(s, { type: 'useLeaderAbility', index: 0 }), { type: 'acceptChoice', choiceId: 'ASH_012-defeatUpgrade', optionIndex: 0 })
    const done = resolve(afterDefeat, { type: 'acceptChoice', choiceId: afterDefeat.pendingChoices![0].id, baseTarget: 'player' })
    expect(done.players.player.base.damage).toBe(2)
    expect(done.players.opponent.base.damage).toBe(0)
  })

  it('front: is not offered when the player controls no upgrades', () => {
    const s = state({
      cards,
      players: { player: player({ leader: undeployed('ASH_012'), units: [unit('u1', 'TST_U1')] }), opponent: player() },
    })
    expect(legalMoves(s).some(a => a.type === 'useLeaderAbility')).toBe(false)
  })

  it('deployed: On Attack (vs a base) is optional, then defeats the upgrade and hits the chosen base', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: deployed('ASH_012'), units: [unit('L', 'ASH_012', { isLeader: true, upgrades: [{ cardId: 'UP', owner: 'player' }] })] }),
        opponent: player(),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'base' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'selectUpgradeToDefeat', optional: true, candidates: [{ unitId: 'L', cardId: 'UP' }] })
    expect(legalMoves(atk).some(a => a.type === 'skipTrigger')).toBe(true) // Cancel offered
    const afterDefeat = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, optionIndex: 0 })
    expect(afterDefeat.players.player.discard).toContain('UP')
    // No defending unit (attacked the base) → only bases are targets.
    expect(afterDefeat.pendingChoices?.[0]).toMatchObject({ kind: 'selectDamageTarget', unitTargets: [], baseTargets: ['player', 'opponent'] })
    const done = resolve(afterDefeat, { type: 'acceptChoice', choiceId: afterDefeat.pendingChoices![0].id, baseTarget: 'opponent' })
    expect(done.players.opponent.base.damage).toBe(4) // 2 (ability) + 2 (combat, L power 2 after UP defeated)
    expect(done.activePlayer).toBe('opponent')
  })

  it('deployed: On Attack vs a unit offers the defending unit as a damage target', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: deployed('ASH_012'), units: [unit('L', 'ASH_012', { isLeader: true, upgrades: [{ cardId: 'UP', owner: 'player' }] })] }),
        opponent: player({ units: [unit('e1', 'TST_U4')] }), // hp 9 — survives to be targeted
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'unit', instanceId: 'e1' } })
    const afterDefeat = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, optionIndex: 0 })
    // The defending unit is a target alongside both bases.
    expect(afterDefeat.pendingChoices?.[0]).toMatchObject({ kind: 'selectDamageTarget', unitTargets: ['e1'], baseTargets: ['player', 'opponent'] })
    const done = resolve(afterDefeat, { type: 'acceptChoice', choiceId: afterDefeat.pendingChoices![0].id, targetInstanceId: 'e1' })
    // e1 took 2 (ability) then combat damage from L (power 2, UP defeated) = 4 total.
    expect(done.players.opponent.units.find(u => u.instanceId === 'e1')!.damage).toBe(4)
    expect(done.activePlayer).toBe('opponent')
  })

  it('deployed: cancelling the On Attack leaves upgrades intact and proceeds to combat', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: deployed('ASH_012'), units: [unit('L', 'ASH_012', { isLeader: true, upgrades: [{ cardId: 'UP', owner: 'player' }] })] }),
        opponent: player(),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'base' } })
    const done = resolve(atk, { type: 'skipTrigger', choiceId: atk.pendingChoices![0].id })
    expect(done.players.player.units.find(u => u.instanceId === 'L')!.upgrades.some(a => a.cardId === 'UP')).toBe(true)
    // Combat only, no ability: L power 2 + UP's +1 = 3 (the upgrade survives since nothing defeated it).
    expect(done.players.opponent.base.damage).toBe(3)
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

describe('Baylan Skoll (ASH_003) — +2/+2 this phase to a lone unit (#347)', () => {
  const cards = { ...CARDS, ASH_003: card({ id: 'ASH_003', type: 'leader', cost: 5, power: 4, hp: 6 }) }

  it('front: offers only a unit that is alone in its arena, and gives it +2/+2 for the phase', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: undeployed('ASH_003'), resources: ready(1), units: [unit('g1', 'TST_U1'), unit('s1', 'TST_U2')] }),
        opponent: player(),
      },
    })
    // g1 (ground) and s1 (space) are each alone in their arena → both offered.
    expect(legalMoves(s).filter(a => a.type === 'useLeaderAbility').map(a => a.targetInstanceId).sort()).toEqual(['g1', 's1'])
    const next = resolve(s, { type: 'useLeaderAbility', index: 0, targetInstanceId: 'g1' })
    expect(effectivePower(next, next.players.player.units.find(u => u.instanceId === 'g1')!)).toBe(5) // 3 + 2
    expect(effectiveHp(next, next.players.player.units.find(u => u.instanceId === 'g1')!)).toBe(6) // 4 + 2
    expect(next.players.player.leader.exhausted).toBe(true)
  })

  it('front: is not offered when no arena has a lone friendly unit', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: undeployed('ASH_003'), resources: ready(1), units: [unit('g1', 'TST_U1'), unit('g2', 'TST_U1')] }),
        opponent: player(),
      },
    })
    expect(legalMoves(s).some(a => a.type === 'useLeaderAbility')).toBe(false)
  })

  it('deployed: On Attack targets only a lone NON-leader unit — not Baylan himself', () => {
    const s = state({
      cards,
      // L (Baylan, ground leader unit) + u2 (lone non-leader ground) + s2 (lone non-leader space).
      players: {
        player: player({ leader: deployed('ASH_003'), units: [unit('L', 'ASH_003', { isLeader: true }), unit('u2', 'TST_U1'), unit('s2', 'TST_U2')] }),
        opponent: player(),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'base' } })
    // Baylan (leader unit) is excluded even though he shares the ground arena with u2.
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayLastingBuff', power: 2, hp: 2, targets: ['u2', 's2'] })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, targetInstanceId: 'u2' })
    expect(effectivePower(done, done.players.player.units.find(u => u.instanceId === 'u2')!)).toBe(5)
    expect(unitHasKeyword(done, done.players.player.units.find(u => u.instanceId === 'u2')!, 'Sentinel')).toBe(true)
    expect(done.activePlayer).toBe('opponent')
  })

  it('deployed: On Attack offers nothing when no arena has a lone non-leader unit', () => {
    const s = state({
      cards,
      // Two non-leader ground units → neither is the only non-leader unit in ground.
      players: {
        player: player({ leader: deployed('ASH_003'), units: [unit('L', 'ASH_003', { isLeader: true }), unit('u2', 'TST_U1'), unit('u3', 'TST_U1')] }),
        opponent: player(),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'base' } })
    expect(atk.pendingChoices).toBeUndefined()
    expect(atk.activePlayer).toBe('opponent')
  })
})

describe('Ahsoka Tano (ASH_009) — +2/+0 this phase to a weaker unit (#347)', () => {
  const cards = { ...CARDS, ASH_009: card({ id: 'ASH_009', type: 'leader', cost: 6, power: 5, hp: 6 }) }

  it('front: offers any unit with less power than a friendly unit and gives it +2/+0', () => {
    const s = state({
      cards,
      players: {
        // strong friendly (power 5) sets the bar; weak friendly (3) qualifies; strong one does not.
        player: player({ leader: undeployed('ASH_009'), units: [unit('strong', 'TST_U3'), unit('weak', 'TST_U1')] }),
        opponent: player({ units: [unit('e1', 'TST_U1')] }), // power 3 → also qualifies
      },
    })
    const targets = legalMoves(s).filter(a => a.type === 'useLeaderAbility').map(a => a.targetInstanceId).sort()
    expect(targets).toEqual(['e1', 'weak']) // 'strong' (power 5) is not < any friendly power
    const next = resolve(s, { type: 'useLeaderAbility', index: 0, targetInstanceId: 'weak' })
    expect(effectivePower(next, next.players.player.units.find(u => u.instanceId === 'weak')!)).toBe(5) // 3 + 2
    expect(effectiveHp(next, next.players.player.units.find(u => u.instanceId === 'weak')!)).toBe(4) // hp unchanged
  })

  it('deployed: On Attack may give a unit with less power than Ahsoka +2/+0 for the phase', () => {
    const s = state({
      cards, // Ahsoka leader-unit power 5
      players: {
        player: player({ leader: deployed('ASH_009'), units: [unit('L', 'ASH_009', { isLeader: true }), unit('u2', 'TST_U1')] }), // u2 power 3
        opponent: player({ units: [unit('strong', 'TST_U3')] }), // power 5 — not < 5
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'base' } })
    // Only units weaker than Ahsoka (power 5) are offered — u2 (3); L and 'strong' (both 5) are not.
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayLastingBuff', power: 2, hp: 0, targets: ['u2'] })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, targetInstanceId: 'u2' })
    expect(effectivePower(done, done.players.player.units.find(u => u.instanceId === 'u2')!)).toBe(5) // 3 + 2
    expect(effectiveHp(done, done.players.player.units.find(u => u.instanceId === 'u2')!)).toBe(4) // hp unchanged
    expect(done.activePlayer).toBe('opponent')
  })
})

describe('Ezra Bridger (ASH_013) — attack-end Advantage if 3+ dealt to a base (#347)', () => {
  const cards = { ...CARDS, ASH_013: card({ id: 'ASH_013', type: 'leader', cost: 5, power: 3, hp: 6 }) }
  const board = () => state({
    cards,
    players: {
      player: player({ leader: undeployed('ASH_013'), units: [unit('a1', 'TST_U3'), unit('a2', 'TST_U1')] }), // a1 power 5
      opponent: player(),
    },
  })

  it('offers to exhaust the leader for an Advantage on a different unit after a 3+ base hit', () => {
    const atk = resolve(board(), { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(atk.players.opponent.base.damage).toBe(5)
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustLeaderGiveAdvantage', targets: ['a2'] }) // attacker excluded
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, targetInstanceId: 'a2' })
    expect(done.players.player.leader.exhausted).toBe(true)
    expect(done.players.player.units.find(u => u.instanceId === 'a2')!.upgrades.some(a => a.cardId === TOKEN_ADVANTAGE)).toBe(true)
    expect(done.activePlayer).toBe('opponent')
  })

  it('does not trigger when fewer than 3 damage reaches a base', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: undeployed('ASH_013'), units: [unit('a1', 'TST_U4'), unit('a2', 'TST_U1')] }), // a1 power 1
        opponent: player(),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(atk.players.opponent.base.damage).toBe(1)
    expect(atk.pendingChoices).toBeUndefined()
    expect(atk.activePlayer).toBe('opponent')
  })

  it('declining leaves the leader ready', () => {
    const atk = resolve(board(), { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    const done = resolve(atk, { type: 'skipTrigger', choiceId: atk.pendingChoices![0].id })
    expect(done.players.player.leader.exhausted).toBe(false)
    expect(done.players.player.units.find(u => u.instanceId === 'a2')!.upgrades.some(a => a.cardId === TOKEN_ADVANTAGE)).toBe(false)
    expect(done.activePlayer).toBe('opponent')
  })
})

describe('Ezra Bridger (ASH_013) — deployed: reacts to ANY friendly attack ending (#347)', () => {
  const cards = { ...CARDS, ASH_013: card({ id: 'ASH_013', type: 'leader', power: 3, hp: 6 }) }
  const board = (attacker: string) => state({
    cards,
    players: {
      player: player({ leader: deployed('ASH_013'), units: [unit('L', 'ASH_013', { isLeader: true }), unit('a1', attacker)] }),
      opponent: player(),
    },
  })

  it('offers Advantage to a different unit when another friendly unit deals 3+ to a base — no leader exhaust', () => {
    const atk = resolve(board('TST_U3'), { type: 'attack', attackerId: 'a1', target: { kind: 'base' } }) // a1 power 5
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveAdvantage', targets: ['L'] }) // the attacker a1 is excluded
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, targetInstanceId: 'L' })
    expect(done.players.player.units.find(u => u.instanceId === 'L')!.upgrades.some(a => a.cardId === TOKEN_ADVANTAGE)).toBe(true)
    expect(done.activePlayer).toBe('opponent')
  })

  it('does not trigger on a sub-3 base hit', () => {
    const atk = resolve(board('TST_U4'), { type: 'attack', attackerId: 'a1', target: { kind: 'base' } }) // a1 power 1
    expect(atk.pendingChoices).toBeUndefined()
    expect(atk.activePlayer).toBe('opponent')
  })
})

describe('Shin Hati (ASH_016) — attack-end exhaust a cheaper unit (#347)', () => {
  const cards = {
    ...CARDS,
    ASH_016: card({ id: 'ASH_016', type: 'leader', cost: 6, power: 4, hp: 6 }),
    BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 6, power: 1, hp: 9 }),
  }

  it('offers to exhaust the leader to exhaust a ready unit costing less than the base damage', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: undeployed('ASH_016'), units: [unit('a1', 'TST_U3')] }), // power 5 → 5 to base
        opponent: player({ units: [unit('e1', 'TST_U1'), unit('e2', 'BIG')] }),
      },
    })
    // e1 cost 2 < 5 → target; e2 (cost 6) is not.
    const atk = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustLeaderExhaustUnit', targets: ['e1'] })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, targetInstanceId: 'e1' })
    expect(done.players.player.leader.exhausted).toBe(true)
    expect(done.players.opponent.units.find(u => u.instanceId === 'e1')!.exhausted).toBe(true)
    expect(done.activePlayer).toBe('opponent')
  })
})

describe('Shin Hati (ASH_016) — deployed: exhaust a cheaper unit, once each round (#347)', () => {
  const cards = {
    ...CARDS,
    ASH_016: card({ id: 'ASH_016', type: 'leader', cost: 6, power: 4, hp: 6 }),
  }
  const board = () => state({
    cards,
    players: {
      player: player({ leader: deployed('ASH_016'), units: [unit('L', 'ASH_016', { isLeader: true }), unit('a1', 'TST_U3'), unit('a2', 'TST_U3')] }),
      opponent: player({ units: [unit('e1', 'TST_U1'), unit('e2', 'TST_U1')] }),
    },
  })

  it('reacts to a friendly base hit with no leader-exhaust cost, then is spent for the round', () => {
    const atk = resolve(board(), { type: 'attack', attackerId: 'a1', target: { kind: 'base' } }) // 5 to base
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustUnit' })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, targetInstanceId: 'e1' })
    expect(done.players.opponent.units.find(u => u.instanceId === 'e1')!.exhausted).toBe(true)
    expect(done.players.player.leader.exhausted).toBe(false) // deployed side does not exhaust the leader

    // A second friendly attack this round finds a valid target (e2) but the ability is spent.
    const atk2 = resolve({ ...done, activePlayer: 'player' }, { type: 'attack', attackerId: 'a2', target: { kind: 'base' } })
    expect(atk2.pendingChoices).toBeUndefined()
  })
})

describe('Grand Admiral Sloane (ASH_007) — front: Choose One arena buff (#348)', () => {
  const cards = { ...CARDS, ASH_007: card({ id: 'ASH_007', type: 'leader', cost: 5, power: 4, hp: 5 }) }
  const board = () => state({
    cards,
    players: {
      player: player({ leader: undeployed('ASH_007'), units: [unit('fg', 'TST_U1'), unit('fs', 'TST_U2')] }), // fg ground, fs space
      opponent: player({ units: [unit('eg', 'TST_U1')] }), // eg ground
    },
  })

  it('offers a two-option modal and applies Sentinel + Overwhelm to every unit in the chosen arena', () => {
    const s = board()
    const opts = legalMoves(s).filter(a => a.type === 'useLeaderAbility')
    expect(opts).toHaveLength(1) // one target-less action
    const raised = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(raised.pendingChoices?.[0]).toMatchObject({ kind: 'chooseOne' })
    expect(raised.players.player.leader.exhausted).toBe(true)
    const choiceMoves = legalMoves(raised).filter(a => a.type === 'acceptChoice')
    expect(choiceMoves.map(a => a.optionIndex)).toEqual([0, 1]) // ground / space

    // Choose ground (option 0): each ground unit — friendly AND enemy — gains the keywords.
    const done = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, optionIndex: 0 })
    expect(unitHasKeyword(done, done.players.player.units.find(u => u.instanceId === 'fg')!, 'Sentinel')).toBe(true)
    expect(unitHasKeyword(done, done.players.player.units.find(u => u.instanceId === 'fg')!, 'Overwhelm')).toBe(true)
    expect(unitHasKeyword(done, done.players.opponent.units.find(u => u.instanceId === 'eg')!, 'Sentinel')).toBe(true)
    expect(unitHasKeyword(done, done.players.player.units.find(u => u.instanceId === 'fs')!, 'Sentinel')).toBe(false) // space untouched
    expect(done.activePlayer).toBe('opponent')
  })
})

describe('Bo-Katan Kryze (ASH_010) — front: create a Mandalorian token (#348)', () => {
  const cards = { ...CARDS, ASH_010: card({ id: 'ASH_010', type: 'leader', cost: 10 }) }
  const withArenas = (ground: boolean, space: boolean, resources = 2) =>
    state({
      cards,
      players: {
        player: player({
          leader: undeployed('ASH_010'),
          resources: ready(resources),
          units: [...(ground ? [unit('g', 'TST_U1')] : []), ...(space ? [unit('s', 'TST_U2')] : [])],
        }),
        opponent: player(),
      },
    })

  it('is offered only with a unit in each arena and 2 resources, and creates an exhausted token', () => {
    expect(legalMoves(withArenas(true, true)).some(a => a.type === 'useLeaderAbility')).toBe(true)
    expect(legalMoves(withArenas(true, false)).some(a => a.type === 'useLeaderAbility')).toBe(false) // no space unit
    expect(legalMoves(withArenas(true, true, 1)).some(a => a.type === 'useLeaderAbility')).toBe(false) // can't pay 2

    const next = resolve(withArenas(true, true), { type: 'useLeaderAbility', index: 0 })
    const tokens = next.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)
    expect(tokens).toHaveLength(1)
    expect(tokens[0].exhausted).toBe(true)
    expect(next.players.player.resources.filter(r => !r.exhausted)).toHaveLength(0) // paid 2
    expect(next.players.player.leader.exhausted).toBe(true)
  })

  it('deployed back: On Attack creates a token when you control a unit in each arena', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: deployed('ASH_010'), units: [unit('L', 'ASH_010', { isLeader: true }), unit('s', 'TST_U2')] }),
        opponent: player(),
      },
    })
    const after = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'base' } })
    expect(after.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(1)
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

describe('Luke Skywalker (ASH_005) — heal on a friendly attack ending (#348)', () => {
  const cards = { ...CARDS, ASH_005: card({ id: 'ASH_005', type: 'leader', cost: 7, power: 6, hp: 7 }) }
  // a1 (TST_U4: power 1, hp 9) attacks e1 (TST_U1: power 3, hp 4): a1 survives with 3 counter damage.
  const boardFront = () => state({
    cards,
    players: {
      player: player({ leader: undeployed('ASH_005'), units: [unit('a1', 'TST_U4')] }),
      opponent: player({ units: [unit('e1', 'TST_U1')] }),
    },
  })

  it('front: after a friendly attack, may exhaust the leader to heal 1 from the attacker', () => {
    const atk = resolve(boardFront(), { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(atk.players.player.units.find(u => u.instanceId === 'a1')!.damage).toBe(3) // counter damage
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustLeaderHealUnit', unitId: 'a1', amount: 1 })
    const healed = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id })
    expect(healed.players.player.units.find(u => u.instanceId === 'a1')!.damage).toBe(2) // 3 − 1
    expect(healed.players.player.leader.exhausted).toBe(true)
    expect(healed.activePlayer).toBe('opponent')
  })

  it('front: declining leaves the leader ready and the unit still damaged', () => {
    const atk = resolve(boardFront(), { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'e1' } })
    const done = resolve(atk, { type: 'skipTrigger', choiceId: atk.pendingChoices![0].id })
    expect(done.players.player.units.find(u => u.instanceId === 'a1')!.damage).toBe(3)
    expect(done.players.player.leader.exhausted).toBe(false)
  })

  it('front: no offer when the attacker took no damage (attacked the base)', () => {
    const s = state({
      cards,
      players: { player: player({ leader: undeployed('ASH_005'), units: [unit('a1', 'TST_U4')] }), opponent: player() },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'base' } })
    expect(atk.pendingChoices).toBeUndefined()
    expect(atk.activePlayer).toBe('opponent')
  })

  it('deployed: heal 2 from the attacker or your base — mandatory, player chooses', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: deployed('ASH_005'), base: { cardId: 'TST_B', damage: 5 }, units: [unit('L', 'ASH_005', { isLeader: true }), unit('a1', 'TST_U4')] }),
        opponent: player({ units: [unit('e1', 'TST_U1')] }),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'a1', target: { kind: 'unit', instanceId: 'e1' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'selectHealTarget', amount: 2, unitTargets: ['a1'], baseTargets: ['player'] })
    expect(legalMoves(atk).some(a => a.type === 'skipTrigger')).toBe(false) // mandatory
    // Heal the base.
    const healedBase = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, baseTarget: 'player' })
    expect(healedBase.players.player.base.damage).toBe(3) // 5 − 2
    // …or heal the unit instead.
    const healedUnit = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, targetInstanceId: 'a1' })
    expect(healedUnit.players.player.units.find(u => u.instanceId === 'a1')!.damage).toBe(1) // 3 − 2
  })
})

describe('The Armorer (ASH_001) — play an upgrade from your resources (#348)', () => {
  const cards = {
    ...CARDS,
    ASH_001: card({ id: 'ASH_001', type: 'leader', cost: 5, power: 4, hp: 6 }),
    UP: card({ id: 'UP', type: 'upgrade', cost: 1, power: 2, hp: 2 }),
  }

  it('front: reveals a resource upgrade, plays it (paying cost) on a unit that entered this phase, and resources the top of the deck', () => {
    let s = state({
      cards,
      players: {
        player: player({
          leader: undeployed('ASH_001'),
          resources: [{ cardId: 'UP', exhausted: false }, { cardId: 'R0', exhausted: false }], // UP (upgrade) + 1 payer
          units: [unit('u1', 'TST_U1')],
          deck: ['TST_U2', 'TST_U1'],
        }),
        opponent: player(),
      },
    })
    s = recordUnitEntered(s, 'player', 'u1') // u1 entered play this phase

    expect(legalMoves(s).some(a => a.type === 'useLeaderAbility')).toBe(true)
    const raised = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(raised.pendingChoices?.[0]).toMatchObject({ kind: 'selectResourceUpgrade', optional: false, candidates: [{ resourceIndex: 0, cardId: 'UP' }] })

    const targeting = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, optionIndex: 0 })
    expect(targeting.pendingChoices?.[0]).toMatchObject({ kind: 'attachResourceUpgrade', cardId: 'UP', targets: ['u1'], payCost: true })

    const done = resolve(targeting, { type: 'acceptChoice', choiceId: targeting.pendingChoices![0].id, targetInstanceId: 'u1' })
    const u1 = done.players.player.units.find(u => u.instanceId === 'u1')!
    expect(u1.upgrades.some(a => a.cardId === 'UP')).toBe(true) // attached
    // Resources: UP left the pool, R0 paid the cost (exhausted), the deck top (TST_U2) is now a ready resource.
    expect(done.players.player.resources).toEqual([{ cardId: 'R0', exhausted: true }, { cardId: 'TST_U2', exhausted: false }])
    expect(done.players.player.deck).toEqual(['TST_U1']) // top card moved to resources
    expect(done.players.player.leader.exhausted).toBe(true)
    expect(done.activePlayer).toBe('opponent')
  })

  it('front: is not offered without a unit that entered this phase', () => {
    const s = state({
      cards,
      players: { player: player({ leader: undeployed('ASH_001'), resources: [{ cardId: 'UP', exhausted: false }, { cardId: 'R0', exhausted: false }], units: [unit('u1', 'TST_U1')] }), opponent: player() },
    })
    // u1 did NOT enter this phase → no legal target.
    expect(legalMoves(s).some(a => a.type === 'useLeaderAbility')).toBe(false)
  })

  it('deployed back: on attack end, may play an upgrade from resources (paying its cost) on a friendly unit', () => {
    const s = state({
      cards,
      players: {
        player: player({
          leader: deployed('ASH_001'),
          resources: [{ cardId: 'UP', exhausted: false }, { cardId: 'R0', exhausted: false }],
          units: [unit('L', 'ASH_001', { isLeader: true }), unit('u1', 'TST_U1')],
          deck: ['TST_U2'],
        }),
        opponent: player(),
      },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'base' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'selectResourceUpgrade', optional: true })
    expect(legalMoves(atk).some(a => a.type === 'skipTrigger')).toBe(true) // may (Cancel)
    const targeting = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id, optionIndex: 0 })
    expect(targeting.pendingChoices?.[0]).toMatchObject({ kind: 'attachResourceUpgrade', payCost: true, targets: ['L', 'u1'] })
    const done = resolve(targeting, { type: 'acceptChoice', choiceId: targeting.pendingChoices![0].id, targetInstanceId: 'u1' })
    expect(done.players.player.units.find(u => u.instanceId === 'u1')!.upgrades.some(a => a.cardId === 'UP')).toBe(true)
    // Cost paid: R0 is exhausted; UP left the pool; the deck top became a ready resource.
    expect(done.players.player.resources).toEqual([{ cardId: 'R0', exhausted: true }, { cardId: 'TST_U2', exhausted: false }])
  })
})

describe('Grogu (ASH_018) — triggered deploy + combat-conditional aura (#348)', () => {
  const cards = {
    ...CARDS,
    ASH_018: card({ id: 'ASH_018', type: 'leader', cost: 4, power: 0, hp: 3, unique: true }),
    BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 4, power: 3, hp: 3, unique: true }),
    SMALL: card({ id: 'SMALL', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2, unique: true }),
    COMMON: card({ id: 'COMMON', type: 'unit', arena: 'ground', cost: 5, power: 3, hp: 3, unique: false }),
  }
  const playing = (hand: string) => state({
    cards,
    players: { player: player({ leader: undeployed('ASH_018'), hand: [hand], resources: ready(5) }), opponent: player() },
  })

  it('offers to deploy Grogu when you play a Unique unit costing 4+, without burning the epic action', () => {
    const played = resolve(playing('BIG'), { type: 'playCard', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayDeployLeader' })
    const deployed = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id })
    expect(deployed.players.player.leader.deployed).toBe(true)
    expect(deployed.players.player.units.some(u => u.cardId === 'ASH_018' && u.isLeader)).toBe(true)
    expect(deployed.players.player.leader.epicActionUsed).toBe(false) // not once-per-game → can redeploy
  })

  it('can redeploy after being defeated (undeployed + ready, even though the epic action was marked used)', () => {
    const s = state({
      cards,
      players: { player: player({ leader: { cardId: 'ASH_018', deployed: false, epicActionUsed: true, exhausted: false }, hand: ['BIG'], resources: ready(5) }), opponent: player() },
    })
    const played = resolve(s, { type: 'playCard', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayDeployLeader' }) // offered despite epicActionUsed
    expect(resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id }).players.player.leader.deployed).toBe(true)
  })

  it('does not offer redeploy while exhausted (just-defeated, before it readies at regroup)', () => {
    const s = state({
      cards,
      players: { player: player({ leader: { cardId: 'ASH_018', deployed: false, epicActionUsed: false, exhausted: true }, hand: ['BIG'], resources: ready(5) }), opponent: player() },
    })
    expect(resolve(s, { type: 'playCard', handIndex: 0 }).pendingChoices).toBeUndefined()
  })

  it('does not offer for a non-Unique unit, or a Unique unit costing under 4', () => {
    expect(resolve(playing('COMMON'), { type: 'playCard', handIndex: 0 }).pendingChoices).toBeUndefined() // not Unique
    expect(resolve(playing('SMALL'), { type: 'playCard', handIndex: 0 }).pendingChoices).toBeUndefined() // cost 3
  })

  it('offers for Unique units costing MORE than 4, not just exactly 4', () => {
    const big5 = { ...cards, BIG5: card({ id: 'BIG5', type: 'unit', arena: 'ground', cost: 5, power: 3, hp: 3, unique: true }) }
    const s5 = state({ cards: big5, players: { player: player({ leader: undeployed('ASH_018'), hand: ['BIG5'], resources: ready(5) }), opponent: player() } })
    expect(resolve(s5, { type: 'playCard', handIndex: 0 }).pendingChoices?.[0]).toMatchObject({ kind: 'mayDeployLeader' })

    const big7 = { ...cards, BIG7: card({ id: 'BIG7', type: 'unit', arena: 'ground', cost: 7, power: 5, hp: 5, unique: true }) }
    const s7 = state({ cards: big7, players: { player: player({ leader: undeployed('ASH_018'), hand: ['BIG7'], resources: ready(7) }), opponent: player() } })
    expect(resolve(s7, { type: 'playCard', handIndex: 0 }).pendingChoices?.[0]).toMatchObject({ kind: 'mayDeployLeader' })
  })

  it('declining leaves Grogu undeployed', () => {
    const played = resolve(playing('BIG'), { type: 'playCard', handIndex: 0 })
    const declined = resolve(played, { type: 'skipTrigger', choiceId: played.pendingChoices![0].id })
    expect(declined.players.player.leader.deployed).toBe(false)
  })

  it('never offers the normal (resource-cost) deploy', () => {
    const s = state({ cards, players: { player: player({ leader: undeployed('ASH_018'), resources: ready(10) }), opponent: player() } })
    expect(legalMoves(s).some(a => a.type === 'deployLeader')).toBe(false)
  })

  const deployedGrogu = () => ({ cardId: 'ASH_018', deployed: true, epicActionUsed: true, exhausted: false } as LeaderState)

  it('deployed: a friendly unit DEFENDING gets +1/0 (stronger counter-attack)', () => {
    const s = state({
      cards,
      activePlayer: 'opponent',
      players: {
        player: player({ leader: deployedGrogu(), units: [unit('L', 'ASH_018', { isLeader: true }), unit('u2', 'TST_U1')] }), // u2 power 3
        opponent: player({ units: [unit('e1', 'TST_U4')] }), // hp 9 attacker
      },
    })
    const after = resolve(s, { type: 'attack', attackerId: 'e1', target: { kind: 'unit', instanceId: 'u2' } })
    expect(after.players.opponent.units.find(u => u.instanceId === 'e1')!.damage).toBe(4) // u2 counter 3 + 1
  })

  it('deployed: while a friendly unit attacks, the enemy DEFENDER gets -1/0 (weaker counter)', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: deployedGrogu(), units: [unit('L', 'ASH_018', { isLeader: true }), unit('u2', 'TST_U4')] }), // u2 power 1, hp 9
        opponent: player({ units: [unit('e1', 'TST_U1')] }), // power 3, hp 4
      },
    })
    const after = resolve(s, { type: 'attack', attackerId: 'u2', target: { kind: 'unit', instanceId: 'e1' } })
    expect(after.players.player.units.find(u => u.instanceId === 'u2')!.damage).toBe(2) // e1 counter 3 − 1
  })

  it('deployed: Grogu attacking himself does not apply the -1 (only ANOTHER friendly unit)', () => {
    const s = state({
      cards,
      players: {
        player: player({ leader: deployedGrogu(), units: [unit('L', 'ASH_018', { isLeader: true, cardId: 'ASH_018' })] }),
        opponent: player({ units: [unit('e1', 'TST_U1')] }), // power 3
      },
    })
    // Give L some power so it can attack meaningfully.
    const withPower = { ...s, cards: { ...s.cards, ASH_018: card({ id: 'ASH_018', type: 'leader', power: 4, hp: 6, unique: true }) } }
    const after = resolve(withPower, { type: 'attack', attackerId: 'L', target: { kind: 'unit', instanceId: 'e1' } })
    expect(after.players.player.units.find(u => u.instanceId === 'L')!.damage).toBe(3) // e1 counter full 3 (no -1)
  })
})

describe('The Mandalorian (ASH_014) — draw on initiative / on attack (#348)', () => {
  const cards = { ...CARDS, ASH_014: card({ id: 'ASH_014', type: 'leader', cost: 6, power: 4, hp: 6 }) }

  it('front: taking the initiative offers to pay 1 and draw, then passes the turn', () => {
    const s = state({
      cards,
      players: { player: player({ leader: undeployed('ASH_014'), resources: ready(2), deck: ['TST_U1', 'TST_U2'] }), opponent: player() },
    })
    const taken = resolve(s, { type: 'takeInitiative' })
    expect(taken.initiative).toBe('player')
    expect(taken.pendingChoices?.[0]).toMatchObject({ kind: 'mayPayToDraw', cost: 1, draw: 1 })
    expect(taken.activePlayer).toBe('player') // holds for the choice

    const drew = resolve(taken, { type: 'acceptChoice', choiceId: taken.pendingChoices![0].id })
    expect(drew.players.player.hand).toEqual(['TST_U1']) // drew the top card
    expect(drew.players.player.resources.filter(r => !r.exhausted)).toHaveLength(1) // paid 1
    expect(drew.activePlayer).toBe('opponent') // transition completed after the choice
  })

  it('front: declining draws nothing, keeps resources, and still passes the turn', () => {
    const s = state({
      cards,
      players: { player: player({ leader: undeployed('ASH_014'), resources: ready(2), deck: ['TST_U1'] }), opponent: player() },
    })
    const taken = resolve(s, { type: 'takeInitiative' })
    const declined = resolve(taken, { type: 'skipTrigger', choiceId: taken.pendingChoices![0].id })
    expect(declined.players.player.hand).toEqual([])
    expect(declined.players.player.resources.filter(r => !r.exhausted)).toHaveLength(2)
    expect(declined.activePlayer).toBe('opponent')
  })

  it('front: taking initiative right after a pass still ends the phase once the choice resolves', () => {
    const s = state({
      cards,
      consecutivePasses: 1, // opponent just passed
      players: { player: player({ leader: undeployed('ASH_014'), resources: ready(2), deck: ['TST_U1', 'TST_U2', 'TST_U1'] }), opponent: player() },
    })
    const taken = resolve(s, { type: 'takeInitiative' })
    expect(taken.phase).toBe('action') // still action while the choice is pending
    const done = resolve(taken, { type: 'skipTrigger', choiceId: taken.pendingChoices![0].id })
    expect(done.phase).toBe('regroup') // CR 1.15.5c — the phase ends
  })

  it('front: no offer with no ready resources, or when the leader is deployed', () => {
    const broke = state({ cards, players: { player: player({ leader: undeployed('ASH_014'), resources: [], deck: ['TST_U1'] }), opponent: player() } })
    expect(resolve(broke, { type: 'takeInitiative' }).pendingChoices).toBeUndefined()
    const deployedLeader = state({
      cards,
      players: { player: player({ leader: deployed('ASH_014'), resources: ready(2), units: [unit('L', 'ASH_014', { isLeader: true })] }), opponent: player() },
    })
    expect(resolve(deployedLeader, { type: 'takeInitiative' }).pendingChoices).toBeUndefined()
  })

  it('deployed: On Attack with the initiative, may draw a card for free', () => {
    const s = state({
      cards,
      initiative: 'player',
      players: { player: player({ leader: deployed('ASH_014'), units: [unit('L', 'ASH_014', { isLeader: true })], deck: ['TST_U1'] }), opponent: player() },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'base' } })
    expect(atk.pendingChoices?.[0]).toMatchObject({ kind: 'mayPayToDraw', cost: 0, draw: 1 })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: atk.pendingChoices![0].id })
    expect(done.players.player.hand).toEqual(['TST_U1']) // free draw
    expect(done.players.opponent.base.damage).toBe(4) // combat continued (L power 4)
    expect(done.activePlayer).toBe('opponent')
  })

  it('deployed: no draw offered without the initiative', () => {
    const s = state({
      cards,
      initiative: 'opponent',
      players: { player: player({ leader: deployed('ASH_014'), units: [unit('L', 'ASH_014', { isLeader: true })], deck: ['TST_U1'] }), opponent: player() },
    })
    const atk = resolve(s, { type: 'attack', attackerId: 'L', target: { kind: 'base' } })
    expect(atk.pendingChoices).toBeUndefined()
    expect(atk.players.opponent.base.damage).toBe(4)
  })
})

describe('Moff Gideon (ASH_008) — front: play a unit costing 1 less (#348)', () => {
  const cards = {
    ...CARDS,
    ASH_008: card({ id: 'ASH_008', type: 'leader', cost: 7, power: 5, hp: 8 }),
    IMP: card({ id: 'IMP', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, traits: ['Imperial'] }),
    GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2 }),
  }
  const withImperialDefeated = () => recordUnitDefeated(
    state({ cards, players: { player: player({ leader: undeployed('ASH_008'), hand: ['GRUNT'], resources: ready(2) }), opponent: player() } }),
    'player',
    'IMP',
  )

  it('is offered only when a friendly Imperial died this phase, and plays the unit at −1 cost', () => {
    const s = withImperialDefeated()
    expect(legalMoves(s).some(a => a.type === 'useLeaderAbility')).toBe(true)
    const raised = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(raised.pendingChoices?.[0]).toMatchObject({ kind: 'playUnitFromHand', costDelta: -1, entersReady: false, candidates: [{ handIndex: 0, cardId: 'GRUNT' }] })
    const done = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, handIndex: 0 })
    const grunt = done.players.player.units.find(u => u.cardId === 'GRUNT')!
    expect(grunt.exhausted).toBe(true) // enters exhausted (not Fennec's ready)
    expect(done.players.player.hand).toEqual([])
    expect(done.players.player.resources.filter(r => !r.exhausted)).toHaveLength(0) // paid 3 − 1 = 2
    expect(done.players.player.leader.exhausted).toBe(true)
    expect(done.activePlayer).toBe('opponent')
  })

  it('is not offered when no friendly Imperial was defeated this phase', () => {
    const s = state({ cards, players: { player: player({ leader: undeployed('ASH_008'), hand: ['GRUNT'], resources: ready(2) }), opponent: player() } })
    expect(legalMoves(s).some(a => a.type === 'useLeaderAbility')).toBe(false)
  })
})

describe('Fennec Shand (ASH_002) — front: exhaust a friendly unit + C=1 → play a unit ready (#348)', () => {
  const cards = {
    ...CARDS,
    ASH_002: card({ id: 'ASH_002', type: 'leader', cost: 4, power: 3, hp: 4 }),
    GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }),
  }
  const board = (resources = 3) => state({
    cards,
    players: { player: player({ leader: undeployed('ASH_002'), hand: ['GRUNT'], resources: ready(resources), units: [unit('x1', 'TST_U1')] }), opponent: player() },
  })

  it('exhausts the chosen friendly unit, pays 1, and plays the hand unit entering READY', () => {
    const s = board()
    expect(legalMoves(s).some(a => a.type === 'useLeaderAbility')).toBe(true)
    // Step 1: use the ability → pay C=1, exhaust leader, choose a friendly unit to exhaust.
    const raised = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(raised.pendingChoices?.[0]).toMatchObject({ kind: 'selectUnitToExhaust', targets: ['x1'] })
    expect(raised.players.player.leader.exhausted).toBe(true)
    expect(raised.players.player.resources.filter(r => !r.exhausted)).toHaveLength(2) // paid the C=1
    // Step 2: exhaust x1 → the play-from-hand choice appears.
    const exhausted = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, targetInstanceId: 'x1' })
    expect(exhausted.players.player.units.find(u => u.instanceId === 'x1')!.exhausted).toBe(true)
    expect(exhausted.pendingChoices?.[0]).toMatchObject({ kind: 'playUnitFromHand', entersReady: true, candidates: [{ handIndex: 0, cardId: 'GRUNT' }] })
    // Step 3: play GRUNT → enters ready, cost 2 paid.
    const done = resolve(exhausted, { type: 'acceptChoice', choiceId: exhausted.pendingChoices![0].id, handIndex: 0 })
    expect(done.players.player.units.find(u => u.cardId === 'GRUNT')!.exhausted).toBe(false) // READY
    expect(done.players.player.hand).toEqual([])
    expect(done.players.player.resources.filter(r => !r.exhausted)).toHaveLength(0) // 3 − 1 (C) − 2 (GRUNT)
    expect(done.activePlayer).toBe('opponent')
  })

  it('is not offered without a ready friendly unit to exhaust, or when the hand unit is unaffordable', () => {
    const noReadyUnit = state({
      cards,
      players: { player: player({ leader: undeployed('ASH_002'), hand: ['GRUNT'], resources: ready(3), units: [unit('x1', 'TST_U1', { exhausted: true })] }), opponent: player() },
    })
    expect(legalMoves(noReadyUnit).some(a => a.type === 'useLeaderAbility')).toBe(false)
    // Only 2 resources: 1 for C=1 leaves 1, but GRUNT costs 2 → unaffordable.
    expect(legalMoves(board(2)).some(a => a.type === 'useLeaderAbility')).toBe(false)
  })
})
