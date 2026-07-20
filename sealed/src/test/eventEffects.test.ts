import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { unitHasKeyword } from '../engine/keywords'
import { effectivePower } from '../engine/stats'
import { dealDamageToUnit } from '../engine/combat'
import { returnUnitToHand } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { TOKEN_MANDALORIAN } from '../engine/tokenUnits'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'

/** Events whose effects reuse the existing effect primitives and pending choices. */
const F = {
  ...CARDS,
  ASH_151: card({ id: 'ASH_151', type: 'event', name: 'Operation Cinder', cost: 6 }),
  ASH_187: card({ id: 'ASH_187', type: 'event', name: 'Reckoning', cost: 3 }),
  ASH_138: card({ id: 'ASH_138', type: 'event', name: 'Turning the Tide', cost: 3 }),
  ASH_264: card({ id: 'ASH_264', type: 'event', name: 'A New Order', cost: 1 }),
  ASH_067: card({ id: 'ASH_067', type: 'event', name: 'Get Lost', cost: 4 }),
  ASH_092: card({ id: 'ASH_092', type: 'event', name: 'Foundling Rescue', cost: 4 }),
  ASH_091: card({ id: 'ASH_091', type: 'event', name: 'Buy Time', cost: 3 }),
  ASH_103: card({ id: 'ASH_103', type: 'event', name: 'Long Live the Empire', cost: 2 }),
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 6 }),
  TOUGH: card({ id: 'TOUGH', type: 'unit', arena: 'ground', cost: 4, power: 2, hp: 20 }),
  IMP: card({ id: 'IMP', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 6, traits: ['Imperial'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
}
const U = (s: GameState, id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)
const rich = (over: Parameters<typeof player>[0] = {}) => player({ resources: ready(20), ...over })
const play = (s: GameState) => resolve(s, { type: 'playEvent', handIndex: 0 })
const choice = (s: GameState) => s.pendingChoices![0]
const upgraded = (id: string, cardId: string) => unit(id, cardId, { upgrades: [{ cardId: 'UPG', owner: 'player' }] })

describe('Operation Cinder (151) — 5 to your base, then 5 to every unit', () => {
  it('hits both sides and your own base', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_151'], units: [unit('a', 'TOUGH')], base: { cardId: 'TST_B', damage: 2 } }),
        opponent: player({ units: [unit('e', 'TOUGH')] }),
      },
    })
    const done = play(s)
    expect(done.players.player.base.damage).toBe(7)
    expect(U(done, 'a')!.damage).toBe(5)
    expect(U(done, 'e')!.damage).toBe(5)
  })
})

describe('Reckoning (187) — damage equal to the total damage on your units', () => {
  it('totals your own units’ damage and deals it to a chosen unit', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_187'], units: [unit('a', 'TOUGH', { damage: 3 }), unit('b', 'TOUGH', { damage: 4 })] }),
        opponent: player({ units: [unit('e', 'TOUGH')] }),
      },
    })
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 7 })
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'e' })
    expect(U(done, 'e')!.damage).toBe(7)
  })

  it('does nothing when your units are undamaged', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_187'], units: [unit('a', 'TOUGH')] }), opponent: player({ units: [unit('e', 'TOUGH')] }) } })
    expect(play(s).pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Turning the Tide (138) — 1 damage per friendly unit', () => {
  it('scales with how many units you control', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_138'], units: [unit('a', 'GRD'), unit('b', 'GRD'), unit('c', 'GRD')] }),
        opponent: player({ units: [unit('e', 'TOUGH')] }),
      },
    })
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'selectDamageTarget', amount: 3 })
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'e' })
    expect(U(done, 'e')!.damage).toBe(3)
  })
})

describe('A New Order (264) — an Advantage token to each of up to 2 units', () => {
  it('gives one each to two different units, and can stop early', () => {
    const s = state({
      cards: F,
      players: { player: rich({ hand: ['ASH_264'], units: [unit('a', 'GRD'), unit('b', 'GRD')] }), opponent: player() },
    })
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'multiPick' })
    const one = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'a' })
    const two = resolve(one, { type: 'acceptChoice', choiceId: choice(one).id, targetInstanceId: 'b' })
    const advs = (id: string) => U(two, id)!.upgrades.filter(u => u.cardId === TOKEN_ADVANTAGE).length
    expect(advs('a')).toBe(1)
    expect(advs('b')).toBe(1)
    expect(two.pendingChoices ?? []).toHaveLength(0) // pool spent
  })
})

describe('Get Lost (067) — defeat an upgraded non-leader unit', () => {
  it('offers only upgraded non-leader units, on either side', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_067'], units: [upgraded('mine', 'GRD'), unit('plain', 'GRD')] }),
        opponent: player({ units: [upgraded('theirs', 'GRD'), unit('lead', 'GRD', { isLeader: true, upgrades: [{ cardId: 'UPG', owner: 'opponent' }] })] }),
      },
    })
    const played = play(s)
    const c = choice(played)
    expect(c.kind === 'selectUnitToDefeat' && c.targets.sort()).toEqual(['mine', 'theirs'])
    const done = resolve(played, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'theirs' })
    expect(U(done, 'theirs')).toBeUndefined()
  })

  it('raises no choice when nothing is upgraded', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_067'], units: [unit('a', 'GRD')] }), opponent: player() } })
    expect(play(s).pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Foundling Rescue (092) — optional defeat, then a token', () => {
  it('offers only units with 2 or less remaining HP, and always creates the token', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_092'] }),
        opponent: player({ units: [unit('weak', 'GRD', { damage: 5 }), unit('healthy', 'GRD')] }), // 6hp: 1 left vs 6
      },
    })
    const played = play(s)
    const c = choice(played)
    expect(c.kind === 'selectUnitToDefeat' && c.targets).toEqual(['weak'])
    const done = resolve(played, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'weak' })
    expect(U(done, 'weak')).toBeUndefined()
    expect(done.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(1)
  })

  it('still creates the token when the defeat is declined', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_092'] }), opponent: player({ units: [unit('weak', 'GRD', { damage: 5 })] }) } })
    const played = play(s)
    const done = resolve(played, { type: 'skipTrigger', choiceId: choice(played).id })
    expect(U(done, 'weak')).toBeDefined()
    expect(done.players.player.units.filter(u => u.cardId === TOKEN_MANDALORIAN)).toHaveLength(1)
  })
})

describe('Buy Time (091) — a Mandalorian token with Sentinel for the phase', () => {
  it('creates the token and gives that token Sentinel', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_091'] }), opponent: player() } })
    const done = play(s)
    const token = done.players.player.units.find(u => u.cardId === TOKEN_MANDALORIAN)!
    expect(token).toBeDefined()
    expect(unitHasKeyword(done, token, 'Sentinel')).toBe(true)
  })
})

describe('Long Live the Empire (103) — defeat a friendly Imperial to resource the top card', () => {
  it('defeats the chosen Imperial and resources the top card', () => {
    const s = state({
      cards: F,
      players: {
        player: rich({ hand: ['ASH_103'], units: [unit('imp', 'IMP'), unit('plain', 'GRD')], deck: ['GRD', 'TOUGH'] }),
        opponent: player(),
      },
    })
    const played = play(s)
    const c = choice(played)
    expect(c.kind === 'selectUnitToDefeat' && c.targets).toEqual(['imp']) // friendly Imperials only
    const before = played.players.player.resources.length
    const done = resolve(played, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'imp' })
    expect(U(done, 'imp')).toBeUndefined()
    expect(done.players.player.resources).toHaveLength(before + 1)
    expect(done.players.player.deck[0]).toBe('TOUGH') // top card went to resources
  })

  it('resources nothing if the defeat is declined', () => {
    const s = state({ cards: F, players: { player: rich({ hand: ['ASH_103'], units: [unit('imp', 'IMP')], deck: ['GRD'] }), opponent: player() } })
    const played = play(s)
    const before = played.players.player.resources.length
    const done = resolve(played, { type: 'skipTrigger', choiceId: choice(played).id })
    expect(done.players.player.resources).toHaveLength(before)
  })
})

// ── Events that chain a second effect off the first ───────────────────────────────────────────

const G = {
  ...F,
  ASH_246: card({ id: 'ASH_246', type: 'event', name: 'Exploit Advantage', cost: 2 }),
  ASH_089: card({ id: 'ASH_089', type: 'event', name: 'Perserverance', cost: 2 }),
  ASH_233: card({ id: 'ASH_233', type: 'event', name: 'Keep Them Talking', cost: 2 }),
  ASH_236: card({ id: 'ASH_236', type: 'event', name: 'Far Far Away', cost: 3 }),
  ASH_232: card({ id: 'ASH_232', type: 'event', name: 'Full of Surprises', cost: 2 }),
  CHEAP: card({ id: 'CHEAP', type: 'unit', arena: 'ground', cost: 3, power: 1, hp: 5 }),
  DEAR: card({ id: 'DEAR', type: 'unit', arena: 'ground', cost: 6, power: 1, hp: 5 }),
  BIGUPG: card({ id: 'BIGUPG', type: 'upgrade', cost: 5, power: 1, hp: 1 }),
}
const shields = (s: GameState, id: string) => U(s, id)!.upgrades.filter(u => u.cardId === 'TOKEN_SHIELD').length

describe('Exploit Advantage (246) — defeat a friendly upgrade to draw 2', () => {
  it('draws only when an upgrade is actually defeated', () => {
    const s = state({
      cards: G,
      players: { player: rich({ hand: ['ASH_246'], units: [upgraded('g', 'GRD')], deck: ['GRD', 'GRD', 'GRD'] }), opponent: player() },
    })
    const played = play(s)
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, optionIndex: 0 })
    expect(U(done, 'g')!.upgrades).toHaveLength(0)
    expect(done.players.player.hand).toHaveLength(2)

    const declined = resolve(played, { type: 'skipTrigger', choiceId: choice(played).id })
    expect(declined.players.player.hand).toHaveLength(0) // no defeat → no draw
  })
})

describe('Perserverance (089) — heal 3 from a unit and shield it', () => {
  it('heals and shields the same unit', () => {
    const s = state({ cards: G, players: { player: rich({ hand: ['ASH_089'], units: [unit('g', 'GRD', { damage: 5 })] }), opponent: player() } })
    const played = play(s)
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'g' })
    expect(U(done, 'g')!.damage).toBe(2)
    expect(shields(done, 'g')).toBe(1)
  })
})

describe('Keep Them Talking (233) — exhaust up to 2 units costing 3 or less', () => {
  it('offers only cheap units and exhausts up to two', () => {
    const s = state({
      cards: G,
      players: {
        player: rich({ hand: ['ASH_233'] }),
        opponent: player({ units: [unit('a', 'CHEAP'), unit('b', 'CHEAP'), unit('big', 'DEAR')] }),
      },
    })
    const played = play(s)
    const c = choice(played)
    expect(c.kind === 'multiPick' && c.targets.sort()).toEqual(['a', 'b'])
    const one = resolve(played, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'a' })
    const two = resolve(one, { type: 'acceptChoice', choiceId: choice(one).id, targetInstanceId: 'b' })
    expect(U(two, 'a')!.exhausted).toBe(true)
    expect(U(two, 'b')!.exhausted).toBe(true)
    expect(two.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Far Far Away (236) — bounce one of yours, then one of theirs', () => {
  it('returns a friendly then an enemy non-leader', () => {
    const s = state({
      cards: G,
      players: {
        player: rich({ hand: ['ASH_236'], units: [unit('mine', 'GRD')] }),
        opponent: player({ units: [unit('theirs', 'GRD'), unit('lead', 'GRD', { isLeader: true })] }),
      },
    })
    const played = play(s)
    const first = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'mine' })
    expect(U(first, 'mine')).toBeUndefined()
    expect(first.players.player.hand).toContain('GRD')

    const c = choice(first)
    expect(c.kind === 'selectUnitToReturn' && c.targets).toEqual(['theirs']) // leaders excluded
    const done = resolve(first, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'theirs' })
    expect(U(done, 'theirs')).toBeUndefined()
    expect(done.players.opponent.hand).toContain('GRD')
  })

  it('does nothing further if the friendly return is declined', () => {
    const s = state({
      cards: G,
      players: { player: rich({ hand: ['ASH_236'], units: [unit('mine', 'GRD')] }), opponent: player({ units: [unit('theirs', 'GRD')] }) },
    })
    const played = play(s)
    const done = resolve(played, { type: 'skipTrigger', choiceId: choice(played).id })
    expect(U(done, 'theirs')).toBeDefined()
    expect(done.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Full of Surprises (232) — bounce a cheap upgrade, then shield a unit', () => {
  it('offers only upgrades costing 2 or less, then shields a chosen unit', () => {
    const s = state({
      cards: G,
      players: {
        player: rich({ hand: ['ASH_232'], units: [upgraded('g', 'GRD')] }),
        opponent: player({ units: [unit('e', 'GRD', { upgrades: [{ cardId: 'BIGUPG', owner: 'opponent' }] })] }),
      },
    })
    const played = play(s)
    const c = choice(played)
    expect(c.kind === 'selectUpgradeToReturn' && c.candidates.map(x => x.cardId)).toEqual(['UPG']) // BIGUPG costs 5
    const returned = resolve(played, { type: 'acceptChoice', choiceId: c.id, optionIndex: 0 })
    expect(U(returned, 'g')!.upgrades).toHaveLength(0)
    expect(returned.players.player.hand).toContain('UPG')

    const shield = choice(returned)
    expect(shield).toMatchObject({ kind: 'mayGiveTokens', count: 1 })
    const done = resolve(returned, { type: 'acceptChoice', choiceId: shield.id, targetInstanceId: 'g' })
    expect(shields(done, 'g')).toBe(1)
  })
})

// ── Events whose effect is sized by the board, or by what happened this phase ──────────────────

const H = {
  ...G,
  ASH_115: card({ id: 'ASH_115', type: 'event', name: 'The Student Guides the Master', cost: 1 }),
  ASH_139: card({ id: 'ASH_139', type: 'event', name: 'Hold Them Off', cost: 4 }),
  ASH_163: card({ id: 'ASH_163', type: 'event', name: 'Reckless Sacrifice', cost: 2 }),
  ASH_188: card({ id: 'ASH_188', type: 'event', name: 'Galvanized Leap', cost: 4 }),
  ASH_211: card({ id: 'ASH_211', type: 'event', name: 'Fateful Goodbye', cost: 2 }),
  ASH_231: card({ id: 'ASH_231', type: 'event', name: 'Diplomatic Pageantry', cost: 1 }),
  STRONG: card({ id: 'STRONG', type: 'unit', arena: 'ground', cost: 5, power: 5, hp: 8 }),
  WEAK1: card({ id: 'WEAK1', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 4 }),
  SPACER: card({ id: 'SPACER', type: 'unit', arena: 'space', cost: 2, power: 2, hp: 6 }),
}

describe('The Student Guides the Master (115) — +1/+0 per weaker friendly unit', () => {
  it('scales with how many friendly units have less power than the chosen one', () => {
    const s = state({
      cards: H,
      players: { player: rich({ hand: ['ASH_115'], units: [unit('big', 'STRONG'), unit('w1', 'WEAK1'), unit('w2', 'WEAK1'), unit('peer', 'STRONG')] }), opponent: player() },
    })
    const played = play(s)
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'big' })
    expect(effectivePower(done, U(done, 'big')!)).toBe(5 + 2) // two weaker friendlies; the equal-power peer doesn't count
  })
})

describe('Hold Them Off (139) — a friendly unit spreads its power among units in its arena', () => {
  it('distributes exactly that unit’s power, and only within its arena', () => {
    const s = state({
      cards: H,
      players: {
        player: rich({ hand: ['ASH_139'], units: [unit('src', 'STRONG')] }),
        opponent: player({ units: [unit('a', 'TOUGH'), unit('b', 'TOUGH'), unit('sp', 'SPACER', { arena: 'space' })] }),
      },
    })
    const played = play(s)
    const picked = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'src' })
    const dist = choice(picked)
    expect(dist).toMatchObject({ kind: 'distributeDamage', remaining: 5 })
    expect(dist.kind === 'distributeDamage' && dist.targets).not.toContain('sp') // space unit is out of reach

    let cur = picked
    for (let i = 0; i < 5; i++) cur = resolve(cur, { type: 'acceptChoice', choiceId: choice(cur).id, targetInstanceId: 'a' })
    expect(U(cur, 'a')!.damage).toBe(5)
    expect(cur.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Reckless Sacrifice (163) — discard a unit to snipe something pricier', () => {
  it('offers only units costing more than the discarded card', () => {
    const s = state({
      cards: H,
      players: {
        player: rich({ hand: ['ASH_163', 'CHEAP'] }), // CHEAP costs 3
        opponent: player({ units: [unit('dear', 'DEAR'), unit('cheap', 'CHEAP')] }), // 6 vs 3
      },
    })
    const played = play(s)
    const discarded = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, handIndex: 0 })
    const dmg = choice(discarded)
    expect(dmg.kind === 'mayDamage' && dmg.targets).toEqual(['dear']) // only the costlier unit
    const done = resolve(discarded, { type: 'acceptChoice', choiceId: dmg.id, targetInstanceId: 'dear' })
    expect(U(done, 'dear')).toBeUndefined() // DEAR has 5 HP, so the 5 damage defeats it
  })
})

describe('Galvanized Leap (188) — ready a unit damaged this phase', () => {
  it('offers only units that took damage this phase', () => {
    const s = state({
      cards: H,
      players: {
        player: rich({ hand: ['ASH_188'], units: [unit('hurt', 'TOUGH', { exhausted: true }), unit('fine', 'TOUGH', { exhausted: true })] }),
        opponent: player({ units: [unit('e', 'GRD')] }),
      },
    })
    // Damage 'hurt' this phase via an attack against it.
    const attacked = resolve({ ...s, activePlayer: 'opponent' }, { type: 'attack', attackerId: 'e', target: { kind: 'unit', instanceId: 'hurt' } })
    const played = play({ ...attacked, activePlayer: 'player' })
    const c = choice(played)
    // Both combatants took damage, and the card says "a unit" — not "a friendly unit" — so the
    // attacker is a legal (if unhelpful) target too.
    expect(c.kind === 'selectUnitToReady' && c.targets.sort()).toEqual(['e', 'hurt'])
    const done = resolve(played, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'hurt' })
    expect(U(done, 'hurt')!.exhausted).toBe(false)
  })

  it('raises no choice when nothing was damaged this phase', () => {
    const s = state({ cards: H, players: { player: rich({ hand: ['ASH_188'], units: [unit('a', 'TOUGH', { exhausted: true })] }), opponent: player() } })
    expect(play(s).pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Fateful Goodbye (211) — pays out if a friendly unit left play this phase', () => {
  it('distributes 3 Advantage after a friendly unit was defeated, and 5 for a leader unit', () => {
    const base = state({
      cards: H,
      players: { player: rich({ hand: ['ASH_211'], units: [unit('gone', 'WEAK1'), unit('keep', 'TOUGH')] }), opponent: player() },
    })
    expect(play(base).pendingChoices ?? []).toHaveLength(0) // nothing has left play yet

    const dead = dealDamageToUnit(base, 'gone', 99)
    expect(choice(play(dead))).toMatchObject({ kind: 'distributeTokens', remaining: 3 })

    const leaderBase = state({
      cards: H,
      players: { player: rich({ hand: ['ASH_211'], units: [unit('lead', 'WEAK1', { isLeader: true }), unit('keep', 'TOUGH')] }), opponent: player() },
    })
    const leaderDead = dealDamageToUnit(leaderBase, 'lead', 99)
    expect(choice(play(leaderDead))).toMatchObject({ kind: 'distributeTokens', remaining: 5 })
  })

  it('counts a unit returned to hand as having left play', () => {
    const s = state({
      cards: H,
      players: { player: rich({ hand: ['ASH_211'], units: [unit('bounced', 'WEAK1'), unit('keep', 'TOUGH')] }), opponent: player() },
    })
    const bounced = returnUnitToHand(s, 'bounced')
    expect(choice(play(bounced))).toMatchObject({ kind: 'distributeTokens', remaining: 3 })
  })
})

describe('Diplomatic Pageantry (231) — exhaust one of each side, then reward', () => {
  it('exhausts a friendly and an enemy, then gives 2 Advantage to a friendly unit', () => {
    const s = state({
      cards: H,
      players: {
        player: rich({ hand: ['ASH_231'], units: [unit('mine', 'TOUGH'), unit('other', 'TOUGH')] }),
        opponent: player({ units: [unit('theirs', 'TOUGH')] }),
      },
    })
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'selectPair', mode: 'exhaust' })
    const first = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'mine' })
    const second = resolve(first, { type: 'acceptChoice', choiceId: choice(first).id, targetInstanceId: 'theirs' })
    expect(U(second, 'mine')!.exhausted).toBe(true)
    expect(U(second, 'theirs')!.exhausted).toBe(true)

    const reward = choice(second)
    expect(reward).toMatchObject({ kind: 'mayGiveTokens', count: 2 })
    const done = resolve(second, { type: 'acceptChoice', choiceId: reward.id, targetInstanceId: 'other' })
    expect(U(done, 'other')!.upgrades.filter(u => u.cardId === TOKEN_ADVANTAGE)).toHaveLength(2)
  })
})

// ── Events that replay units from the discard, and modal "choose one" ─────────────────────────

const J = {
  ...H,
  ASH_247: card({ id: 'ASH_247', type: 'event', name: 'One Must Destroy to Create', cost: 3 }),
  ASH_104: card({ id: 'ASH_104', type: 'event', name: 'Dathomiri Magicks', cost: 6 }),
  ASH_257: card({ id: 'ASH_257', type: 'event', name: 'Choose Your Path', cost: 2 }),
  FORCEU: card({ id: 'FORCEU', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 5, traits: ['Force'] }),
  MANDOU: card({ id: 'MANDOU', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 5, traits: ['Mandalorian'] }),
  TINY: card({ id: 'TINY', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 2 }),
  RIG: card({ id: 'RIG', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 2, traits: ['Vehicle'] }),
}

describe('One Must Destroy to Create (247) — defeat a unit, then replay it free', () => {
  it('defeats the chosen unit and offers it back from the discard for free', () => {
    const s = state({
      cards: J,
      players: { player: rich({ hand: ['ASH_247'], units: [unit('g', 'GRD'), unit('lead', 'GRD', { isLeader: true })] }), opponent: player() },
    })
    const played = play(s)
    const c = choice(played)
    expect(c.kind === 'selectUnitToDefeat' && c.targets).toEqual(['g']) // leaders excluded
    const defeated = resolve(played, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'g' })
    expect(defeated.players.player.discard).toContain('GRD')

    const replay = choice(defeated)
    expect(replay).toMatchObject({ kind: 'mayPlayUnitFromDiscard' })
    const before = defeated.players.player.resources.filter(r => !r.exhausted).length
    const done = resolve(defeated, { type: 'acceptChoice', choiceId: replay.id, optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'GRD')).toBe(true)
    expect(done.players.player.discard).not.toContain('GRD')
    expect(done.players.player.resources.filter(r => !r.exhausted).length).toBe(before) // free
  })

  it('leaves it in the discard when the replay is declined', () => {
    const s = state({ cards: J, players: { player: rich({ hand: ['ASH_247'], units: [unit('g', 'GRD')] }), opponent: player() } })
    const played = play(s)
    const defeated = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, targetInstanceId: 'g' })
    const done = resolve(defeated, { type: 'skipTrigger', choiceId: choice(defeated).id })
    expect(done.players.player.discard).toContain('GRD')
    expect(done.players.player.units).toHaveLength(0)
  })
})

describe('Dathomiri Magicks (104) — cheaper with a Force unit, replays up to 3 from the discard', () => {
  const spent = (before: GameState, after: GameState) =>
    before.players.player.resources.filter(r => !r.exhausted).length - after.players.player.resources.filter(r => !r.exhausted).length

  it('costs 1 less while you control a Force unit', () => {
    const withForce = state({ cards: J, players: { player: rich({ hand: ['ASH_104'], units: [unit('f', 'FORCEU')] }), opponent: player() } })
    expect(spent(withForce, play(withForce))).toBe(5) // 6 − 1

    const without = state({ cards: J, players: { player: rich({ hand: ['ASH_104'] }), opponent: player() } })
    expect(spent(without, play(without))).toBe(6)
  })

  it('offers only non-Vehicle units costing 2 or less, up to three of them', () => {
    const s = state({
      cards: J,
      players: { player: rich({ hand: ['ASH_104'], discard: ['TINY', 'TINY', 'TINY', 'RIG', 'DEAR'] }), opponent: player() },
    })
    const played = play(s)
    const c = choice(played)
    expect(c.kind === 'mayPlayUnitFromDiscard' && c.candidates).toEqual(['TINY', 'TINY', 'TINY']) // RIG is a Vehicle, DEAR too dear

    let cur = played
    for (let i = 0; i < 3; i++) cur = resolve(cur, { type: 'acceptChoice', choiceId: choice(cur).id, optionIndex: 0 })
    expect(cur.players.player.units.filter(u => u.cardId === 'TINY')).toHaveLength(3)
    expect(cur.pendingChoices ?? []).toHaveLength(0) // three is the cap
  })
})

describe('Choose Your Path (257) — choose one of two conditional modes', () => {
  it('offers only the modes whose condition you meet', () => {
    const forceOnly = state({
      cards: J,
      players: { player: rich({ hand: ['ASH_257'], units: [unit('f', 'FORCEU')], base: { cardId: 'TST_B', damage: 9 } }), opponent: player() },
    })
    const played = play(forceOnly)
    const c = choice(played)
    expect(c.kind === 'chooseMode' && c.modes).toEqual(['healBase'])
    const done = resolve(played, { type: 'acceptChoice', choiceId: c.id, optionIndex: 0 })
    expect(done.players.player.base.damage).toBe(4)
  })

  it('offers both when you control both a Force and a Mandalorian unit', () => {
    const both = state({
      cards: J,
      players: { player: rich({ hand: ['ASH_257'], units: [unit('f', 'FORCEU'), unit('m', 'MANDOU')], base: { cardId: 'TST_B', damage: 9 } }), opponent: player() },
    })
    const played = play(both)
    const c = choice(played)
    expect(c.kind === 'chooseMode' && [...c.modes].sort()).toEqual(['healBase', 'mandoToken'])
    const idx = c.kind === 'chooseMode' ? c.modes.indexOf('mandoToken') : 0
    const done = resolve(played, { type: 'acceptChoice', choiceId: c.id, optionIndex: idx })
    const token = done.players.player.units.find(u => u.cardId === TOKEN_MANDALORIAN)!
    expect(token.upgrades.filter(u => u.cardId === TOKEN_ADVANTAGE)).toHaveLength(1)
    expect(done.players.player.base.damage).toBe(9) // the other mode didn't happen
  })

  it('does nothing at all when neither condition is met', () => {
    const neither = state({ cards: J, players: { player: rich({ hand: ['ASH_257'], units: [unit('g', 'GRD')] }), opponent: player() } })
    expect(play(neither).pendingChoices ?? []).toHaveLength(0)
  })
})

// ── Taking control of a unit ──────────────────────────────────────────────────────────────────

const K = {
  ...J,
  ASH_200: card({ id: 'ASH_200', type: 'event', name: 'Rehabilitation', cost: 5 }),
  ASH_246X: card({ id: 'ASH_246X', type: 'upgrade', cost: 1, power: 1, hp: 1 }),
}

describe('Rehabilitation (200) — take control of a unit until the regroup phase', () => {
  const stolen = () => {
    const s = state({
      cards: K,
      players: {
        player: rich({ hand: ['ASH_200'] }),
        opponent: player({
          units: [
            unit('prize', 'STRONG', { damage: 2, upgrades: [{ cardId: 'UPG', owner: 'opponent' }] }),
            unit('lead', 'STRONG', { isLeader: true }),
          ],
        }),
      },
    })
    const played = play(s)
    const c = choice(played)
    expect(c.kind === 'selectUnitToDefeat' || c.kind === 'selectUnitToSteal').toBe(true)
    return resolve(played, { type: 'acceptChoice', choiceId: c.id, targetInstanceId: 'prize' })
  }

  it('moves the unit to your side, keeping its damage, upgrades and ready state', () => {
    const took = stolen()
    expect(took.players.player.units.map(u => u.instanceId)).toContain('prize')
    expect(took.players.opponent.units.map(u => u.instanceId)).not.toContain('prize')
    const u = U(took, 'prize')!
    expect(u.damage).toBe(2)
    expect(u.upgrades).toHaveLength(1)
    expect(u.exhausted).toBe(false) // came across ready, so it can attack
    expect(u.owner).toBe('opponent') // controlled by us, still owned by them
  })

  it('applies -3/-0 for the phase', () => {
    const took = stolen()
    expect(effectivePower(took, U(took, 'prize')!)).toBe(5 - 3 + 1) // STRONG 5, −3, +1 from the upgrade
  })

  it('excludes leaders', () => {
    const s = state({
      cards: K,
      players: { player: rich({ hand: ['ASH_200'] }), opponent: player({ units: [unit('lead', 'STRONG', { isLeader: true })] }) },
    })
    expect(play(s).pendingChoices ?? []).toHaveLength(0)
  })

  it('returns to its owner at the start of regroup, before units ready', () => {
    const took = stolen()
    // Both players pass to end the action phase.
    const passed = resolve(resolve({ ...took, activePlayer: 'player', consecutivePasses: 0 }, { type: 'pass' }), { type: 'pass' })
    expect(passed.phase).toBe('regroup')
    expect(passed.players.opponent.units.map(u => u.instanceId)).toContain('prize')
    expect(passed.players.player.units.map(u => u.instanceId)).not.toContain('prize')
    expect(U(passed, 'prize')!.owner).toBeUndefined() // home again — controller and owner match
    expect(effectivePower(passed, U(passed, 'prize')!)).toBe(5 + 1) // the −3 lapsed with the phase
  })

  it('sends the card to its OWNER’s discard if it is defeated while you control it', () => {
    const took = stolen()
    const dead = dealDamageToUnit(took, 'prize', 99)
    expect(U(dead, 'prize')).toBeUndefined()
    expect(dead.players.opponent.discard).toContain('STRONG') // owner's discard, not the thief's
    expect(dead.players.player.discard).not.toContain('STRONG')
    expect(dead.players.opponent.discard).toContain('UPG') // and the upgrade to its own owner
  })
})

// ── Attack-granting events ────────────────────────────────────────────────────────────────────

const L = {
  ...K,
  ASH_162: card({ id: 'ASH_162', type: 'event', name: 'Rash Action', cost: 2 }),
  ASH_184: card({ id: 'ASH_184', type: 'event', name: 'Follow Me', cost: 1 }),
  ASH_234: card({ id: 'ASH_234', type: 'event', name: 'Masterstroke', cost: 2 }),
  ASH_137: card({ id: 'ASH_137', type: 'event', name: 'Wipe Them Out', cost: 2 }),
  FRAGILE: card({ id: 'FRAGILE', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1 }),
}

describe('attack-granting events', () => {
  it('Rash Action (162): +1/+0, and a base hit makes the opponent discard', () => {
    const s = state({
      cards: L,
      players: {
        player: rich({ hand: ['ASH_162'], units: [unit('a', 'GRD')] }),
        opponent: player({ hand: ['GRD', 'TOUGH'] }),
      },
    })
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    const attacked = resolve(played, { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    expect(attacked.players.opponent.base.damage).toBe(3) // GRD's 2 power + 1
    const discard = choice(attacked)
    expect(discard).toMatchObject({ kind: 'selectDiscard', controller: 'opponent' })
    const done = resolve(attacked, { type: 'acceptChoice', choiceId: discard.id, handIndex: 0 })
    expect(done.players.opponent.hand).toHaveLength(1)
  })

  it('Follow Me (184): after the attack, 3 Advantage tokens to a unit', () => {
    const s = state({
      cards: L,
      players: { player: rich({ hand: ['ASH_184'], units: [unit('a', 'GRD'), unit('b', 'GRD')] }), opponent: player() },
    })
    const played = play(s)
    const attacked = resolve(played, { type: 'attack', attackerId: 'a', target: { kind: 'base' } })
    const give = choice(attacked)
    expect(give).toMatchObject({ kind: 'mayGiveTokens', count: 3 })
    const done = resolve(attacked, { type: 'acceptChoice', choiceId: give.id, targetInstanceId: 'b' })
    expect(U(done, 'b')!.upgrades.filter(u => u.cardId === TOKEN_ADVANTAGE)).toHaveLength(3)
  })

  it('Masterstroke (234): +1/+0 per defending unit in the arena', () => {
    const s = state({
      cards: L,
      players: {
        player: rich({ hand: ['ASH_234'], units: [unit('a', 'GRD')] }),
        opponent: player({ units: [unit('x', 'TOUGH'), unit('y', 'TOUGH'), unit('sp', 'SPACER', { arena: 'space' })] }),
      },
    })
    const played = play(s)
    const done = resolve(played, { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'x' } })
    expect(U(done, 'x')!.damage).toBe(2 + 2) // two ground defenders; the space unit doesn't count
  })

  it('Wipe Them Out (137): excess damage may be aimed at another unit in the arena', () => {
    const s = state({
      cards: L,
      players: {
        player: rich({ hand: ['ASH_137'], units: [unit('a', 'STRONG')] }), // 5 power
        opponent: player({ units: [unit('weak', 'FRAGILE'), unit('other', 'TOUGH')] }),
      },
    })
    const played = play(s)
    const attacked = resolve(played, { type: 'attack', attackerId: 'a', target: { kind: 'unit', instanceId: 'weak' } })
    expect(U(attacked, 'weak')).toBeUndefined()
    const spill = choice(attacked)
    expect(spill).toMatchObject({ kind: 'selectDamageTarget', amount: 4 }) // 5 power − 1 HP
    const done = resolve(attacked, { type: 'acceptChoice', choiceId: spill.id, targetInstanceId: 'other' })
    expect(U(done, 'other')!.damage).toBe(4)
  })
})

// ── The last three ────────────────────────────────────────────────────────────────────────────

const M = {
  ...L,
  ASH_186: card({ id: 'ASH_186', type: 'event', name: 'Treacherous Minefield', cost: 2 }),
  ASH_090: card({ id: 'ASH_090', type: 'event', name: 'Reforge', cost: 2 }),
  ASH_235: card({ id: 'ASH_235', type: 'event', name: 'Sense Through the Force', cost: 2 }),
  GROUNDUPG: card({ id: 'GROUNDUPG', type: 'upgrade', cost: 6, power: 3, hp: 3 }),
  COST4: card({ id: 'COST4', type: 'unit', arena: 'ground', cost: 4, power: 1, hp: 4 }),
}

describe('Treacherous Minefield (186) — an arena-wide On Attack for the phase', () => {
  it('makes every unit in the chosen arena hurt itself when it attacks', () => {
    const s = state({
      cards: M,
      players: {
        player: rich({ hand: ['ASH_186'], units: [unit('g', 'TOUGH'), unit('sp', 'SPACER', { arena: 'space' })] }),
        opponent: player({ units: [unit('e', 'TOUGH'), unit('esp', 'SPACER', { arena: 'space' })] }),
      },
    })
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'selectArenaToGrant' })
    const ground = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, optionIndex: 0 })

    const attacked = resolve({ ...ground, activePlayer: 'player' }, { type: 'attack', attackerId: 'g', target: { kind: 'base' } })
    expect(U(attacked, 'g')!.damage).toBe(2) // hurt itself attacking

    // The space arena was untouched.
    const spaceAttack = resolve({ ...attacked, activePlayer: 'player' }, { type: 'attack', attackerId: 'sp', target: { kind: 'base' } })
    expect(U(spaceAttack, 'sp')!.damage).toBe(0)
  })
})

describe('Reforge (090) — swap an upgrade for one dug out of the deck at −4', () => {
  it('defeats the upgrade, then attaches a found one at a discount', () => {
    const s = state({
      cards: M,
      players: {
        player: rich({ hand: ['ASH_090'], units: [upgraded('g', 'TOUGH')], deck: ['GRD', 'GROUNDUPG', 'GRD'] }),
        opponent: player(),
      },
    })
    const played = play(s)
    const defeated = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, optionIndex: 0 })
    expect(U(defeated, 'g')!.upgrades).toHaveLength(0)

    const search = choice(defeated)
    expect(search.kind === 'searchPlayUpgrade' && search.eligibleIndices).toEqual([1]) // only the upgrade
    const before = defeated.players.player.resources.filter(r => !r.exhausted).length
    const done = resolve(defeated, { type: 'acceptChoice', choiceId: search.id, deckIndex: 1 })
    expect(U(done, 'g')!.upgrades.map(u => u.cardId)).toEqual(['GROUNDUPG'])
    expect(done.players.player.resources.filter(r => !r.exhausted).length).toBe(before - 2) // 6 − 4
  })
})

describe('Sense Through the Force (235) — name a cost, then dig', () => {
  it('pays out 3 Advantage on a correct guess, and nothing on a wrong one', () => {
    const s = state({
      cards: M,
      players: { player: rich({ hand: ['ASH_235'], units: [unit('f', 'FORCEU')], deck: ['COST4', 'GRD'] }), opponent: player() },
    })
    const played = play(s)
    expect(choice(played)).toMatchObject({ kind: 'chooseNumber', max: 10 })

    const guessed = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, optionIndex: 4 })
    const drawn = resolve(guessed, { type: 'acceptChoice', choiceId: choice(guessed).id, deckIndex: 0 }) // COST4
    expect(drawn.players.player.hand).toContain('COST4')
    const reward = choice(drawn)
    expect(reward).toMatchObject({ kind: 'mayGiveTokens', count: 3 })
    const done = resolve(drawn, { type: 'acceptChoice', choiceId: reward.id, targetInstanceId: 'f' })
    expect(U(done, 'f')!.upgrades.filter(u => u.cardId === TOKEN_ADVANTAGE)).toHaveLength(3)

    const wrong = resolve(played, { type: 'acceptChoice', choiceId: choice(played).id, optionIndex: 7 })
    const drawnWrong = resolve(wrong, { type: 'acceptChoice', choiceId: choice(wrong).id, deckIndex: 0 })
    expect(drawnWrong.players.player.hand).toContain('COST4') // still drawn
    expect(drawnWrong.pendingChoices ?? []).toHaveLength(0) // but no payout
  })
})
