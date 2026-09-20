import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, PhaseEvents, PendingChoice, PlayerState } from '../engine/types'
import { TOKEN_EXPERIENCE, TOKEN_WEAKNESS } from '../engine/tokenUpgrades'

/**
 * The cards that play a card out of a discard pile (#471), in the two groups the mechanic falls into.
 *
 * **Play it now** goes through `playCardFrom` with a discard zone: the card picks the pile, the
 * eligible cards, the price and the tail. Those share a door, so they are tested per card only where
 * the card decides something the door does not.
 *
 * **"For this phase, you may play it"** is a `DiscardPlayGrant`, taken later as a Play a Card action.
 * Every one of these is tested for the permission it leaves rather than for a play, because leaving
 * the right permission is the whole of what the card does.
 *
 * Printed text and stats come from the shipped set fixtures, so a test cannot pass against a card the
 * set does not print.
 */

const POOL = poolFor(['LAW', 'SEC', 'LOF', 'JTL', 'TWI', 'SHD', 'SOR', 'TS26', 'HMW', 'ASH'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}
const phaseEvents = (over: Partial<PhaseEvents> = {}): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, played: { player: [], opponent: [] },
  leaderLeftPlay: [],
  ...over,
})

/** The generic cards these tests draw on: something to find in a pile, and something to reject. */
const BITS = {
  ...CARDS,
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 5 }),
  BIG: card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 7, power: 6, hp: 7 }),
  VEH: card({ id: 'VEH', type: 'unit', arena: 'space', cost: 3, power: 3, hp: 3, traits: ['VEHICLE'] }),
  HERO_U: card({ id: 'HERO_U', type: 'unit', arena: 'ground', cost: 4, power: 4, hp: 4, aspects: ['Heroism'] }),
  VIL_U: card({ id: 'VIL_U', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 3, aspects: ['Villainy'] }),
  FORCE_U: card({ id: 'FORCE_U', type: 'unit', arena: 'ground', cost: 8, power: 8, hp: 8, traits: ['FORCE'] }),
  ITEM_UP: card({ id: 'ITEM_UP', type: 'upgrade', cost: 4, power: 2, hp: 2, traits: ['ITEM'] }),
  PLAIN_UP: card({ id: 'PLAIN_UP', type: 'upgrade', cost: 2, power: 1, hp: 1 }),
  HERO_EV: card({ id: 'HERO_EV', type: 'event', cost: 3, aspects: ['Heroism'] }),
}

/** A board with `p` as the player, everything else default, and 12 ready resources unless set. */
const board = (p: Partial<PlayerState>, over: Partial<GameState> = {}): GameState => state({
  cards: BITS,
  players: { player: player({ resources: ready(12), ...p }), opponent: player() },
  ...over,
})
const choice = (s: GameState): PendingChoice => s.pendingChoices![0]
const accept = (s: GameState, extra: Record<string, unknown> = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra } as never)
/** Play the event in hand at index 0. */
const playEvent = (s: GameState) => resolve(s, { type: 'playEvent', handIndex: 0 } as never)

// ── Play it now ────────────────────────────────────────────────────────────────────────────────

describe('Nightbrother (HMW_204) — a unit from the discard, 3 less, ready, defeated at regroup', () => {
  const F = { ...BITS, HMW_204: real('HMW_204') }
  const s = () => ({
    ...board({ hand: ['HMW_204'], discard: ['GRD'], resources: ready(20) }),
    cards: F,
  })

  it('offers the discarded unit when Nightbrother is played', () => {
    const played = resolve(s(), { type: 'playUnit', handIndex: 0 } as never)
    expect(choice(played)).toMatchObject({ kind: 'playCardFrom', zone: 'discard', costDelta: -3, optional: true })
  })

  it('plays it for 3 less, ready, and marks it for defeat at the next regroup', () => {
    const done = accept(resolve(s(), { type: 'playUnit', handIndex: 0 } as never), { optionIndex: 0 })
    const brought = done.players.player.units.find(u => u.cardId === 'GRD')!
    expect(brought).toBeDefined()
    expect(brought.exhausted, 'enters play ready').toBe(false)
    expect(done.delayedEffects).toMatchObject([{ cardId: 'HMW_204', when: 'regroupStart', unitId: brought.instanceId }])
  })

  it('"you may": the play can be declined and the unit stays in the pile', () => {
    const played = resolve(s(), { type: 'playUnit', handIndex: 0 } as never)
    const done = resolve(played, { type: 'skipTrigger', choiceId: choice(played).id } as never)
    expect(done.players.player.discard).toContain('GRD')
  })
})

describe('Maul (HMW_016) — deployed: a unit defeated THIS PHASE, 5 less', () => {
  const F = { ...BITS, HMW_016: real('HMW_016') }
  const maulBoard = (defeated: string[]) => ({
    ...board({
      leader: { cardId: 'HMW_016', deployed: false, epicActionUsed: false, exhausted: false },
      discard: ['GRD', 'BIG'], resources: ready(20),
    }),
    cards: F,
    phaseEvents: phaseEvents({ defeated: { player: defeated, opponent: [] } }),
  })

  it('offers only the units defeated this phase, not everything in the pile', () => {
    const deployed = resolve(maulBoard(['BIG']), { type: 'deployLeader' } as never)
    const c = choice(deployed)
    expect(c).toMatchObject({ kind: 'playCardFrom', zone: 'discard', costDelta: -5 })
    expect(c.kind === 'playCardFrom' && c.candidates.map(r => r.cardId)).toEqual(['BIG'])
  })

  it('raises nothing when nothing was defeated this phase', () => {
    const deployed = resolve(maulBoard([]), { type: 'deployLeader' } as never)
    expect(deployed.pendingChoices ?? []).toHaveLength(0)
  })
})

describe('Palpatine\'s Return (SHD_094) — 6 less, or 8 less for a Force unit', () => {
  const F = { ...BITS, SHD_094: real('SHD_094') }

  it('reads 8 less on a Force unit and 6 less otherwise, per candidate', () => {
    // The event is Command + Villainy and the test leader provides Command + Heroism, so its own
    // price is 6 + 2 for the unprovided Villainy = 8. What is under test is what the UNIT then
    // costs on top: a Force unit at 8 is free with 8 off, and BIG at 7 is 1 with 6 off.
    const withForce = { ...board({ hand: ['SHD_094'], discard: ['FORCE_U'], resources: ready(12) }), cards: F }
    const done = accept(playEvent(withForce), { optionIndex: 0 })
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(8) // 8 + 0

    const plain = { ...board({ hand: ['SHD_094'], discard: ['BIG'], resources: ready(12) }), cards: F }
    const donePlain = accept(playEvent(plain), { optionIndex: 0 })
    expect(donePlain.players.player.resources.filter(r => r.exhausted)).toHaveLength(9) // 8 + (7 − 6)
  })
})

describe('Home One (SOR_102) — a Heroism unit from the discard, 3 less', () => {
  const F = { ...BITS, SOR_102: real('SOR_102') }

  it('offers only the Heroism units in the pile', () => {
    const s = { ...board({ hand: ['SOR_102'], discard: ['GRD', 'HERO_U'], resources: ready(20) }), cards: F }
    const played = resolve(s, { type: 'playUnit', handIndex: 0 } as never)
    const c = choice(played)
    expect(c.kind === 'playCardFrom' && c.candidates.map(r => r.cardId)).toEqual(['HERO_U'])
    expect(c).toMatchObject({ costDelta: -3 })
  })
})

describe('Salvage (JTL_121) — a Vehicle unit (paying its cost), then 1 damage to it', () => {
  const F = { ...BITS, JTL_121: real('JTL_121') }

  it('offers only Vehicles, charges full price, and damages what it played', () => {
    const s = { ...board({ hand: ['JTL_121'], discard: ['GRD', 'VEH'], resources: ready(12) }), cards: F }
    const played = playEvent(s)
    const c = choice(played)
    expect(c.kind === 'playCardFrom' && c.candidates.map(r => r.cardId)).toEqual(['VEH'])
    // "(paying its cost)": no discount and no free play, so the play carries neither term.
    expect(c.kind === 'playCardFrom' && (c.free ?? false)).toBe(false)
    expect(c.kind === 'playCardFrom' && (c.costDelta ?? 0)).toBe(0)

    const before = played.players.player.resources.filter(r => r.exhausted).length
    const done = accept(played, { optionIndex: 0 })
    expect(done.players.player.resources.filter(r => r.exhausted).length - before).toBe(3) // VEH's full cost
    const brought = done.players.player.units.find(u => u.cardId === 'VEH')!
    expect(brought.damage).toBe(1)
  })
})

describe('Mechanize (TS26_57) — a non-Vehicle (paying its cost) and an Experience token', () => {
  const F = { ...BITS, TS26_57: real('TS26_57') }

  it('excludes Vehicles and gives the played unit an Experience token', () => {
    const s = { ...board({ hand: ['TS26_57'], discard: ['VEH', 'GRD'], resources: ready(12) }), cards: F }
    const played = playEvent(s)
    expect(choice(played).kind === 'playCardFrom' && (choice(played) as { candidates: { cardId: string }[] }).candidates.map(r => r.cardId)).toEqual(['GRD'])

    const done = accept(played, { optionIndex: 0 })
    const brought = done.players.player.units.find(u => u.cardId === 'GRD')!
    expect(brought.upgrades.map(u => u.cardId)).toEqual([TOKEN_EXPERIENCE])
  })
})

describe('Unnatural Life (TWI_189) — a unit defeated this phase, 2 less, ready, defeated at regroup', () => {
  const F = { ...BITS, TWI_189: real('TWI_189') }

  it('offers only the units defeated this phase, and brings one back ready and doomed', () => {
    const s = {
      ...board({ hand: ['TWI_189'], discard: ['GRD', 'BIG'], resources: ready(12) }),
      cards: F,
      phaseEvents: phaseEvents({ defeated: { player: ['GRD'], opponent: [] } }),
    }
    const played = playEvent(s)
    const c = choice(played)
    expect(c.kind === 'playCardFrom' && c.candidates.map(r => r.cardId)).toEqual(['GRD'])

    const done = accept(played, { optionIndex: 0 })
    const brought = done.players.player.units.find(u => u.cardId === 'GRD')!
    expect(brought.exhausted).toBe(false)
    expect(done.delayedEffects).toMatchObject([{ cardId: 'TWI_189', when: 'regroupStart' }])
  })
})

describe('Salvaged Materials (LAW_245) — an Item upgrade, 3 less, defeated at regroup', () => {
  const F = { ...BITS, LAW_245: real('LAW_245') }

  it('offers only Item upgrades, and attaches the one chosen for 3 less', () => {
    const s = {
      ...board({ hand: ['LAW_245'], discard: ['PLAIN_UP', 'ITEM_UP'], resources: ready(12), units: [unit('u1', 'GRD')] }),
      cards: F,
    }
    const played = playEvent(s)
    const c = choice(played)
    expect(c.kind === 'playCardFrom' && c.candidates.map(r => r.cardId)).toEqual(['ITEM_UP'])

    const picked = accept(played, { optionIndex: 0 })
    expect(choice(picked)).toMatchObject({ kind: 'attachPlayedCard', cardId: 'ITEM_UP' })
    const done = accept(picked, { targetInstanceId: 'u1' })
    expect(done.players.player.units[0].upgrades.map(u => u.cardId)).toEqual(['ITEM_UP'])
  })
})

describe('Gideon\'s Light Cruiser (SHD_242) — a Villainy unit ≤3, hand or discard, free', () => {
  const F = { ...BITS, SHD_242: real('SHD_242'), SHD_007: real('SHD_007') }
  const gideonBoard = (over: Partial<PlayerState> = {}) => ({
    ...board({ hand: ['SHD_242'], discard: ['VIL_U'], resources: ready(20), ...over }),
    cards: F,
  })

  it('does nothing without Moff Gideon', () => {
    const played = resolve(gideonBoard(), { type: 'playUnit', handIndex: 0 } as never)
    expect(played.pendingChoices ?? []).toHaveLength(0)
  })

  it('offers the hand AND the discard pile while you control Moff Gideon as a leader', () => {
    const s = gideonBoard({
      leader: { cardId: 'SHD_007', deployed: false, epicActionUsed: false, exhausted: false },
      hand: ['SHD_242', 'VIL_U'],
    })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 } as never)
    const c = choice(played)
    expect(c).toMatchObject({ kind: 'playCardFrom', zone: 'handOrDiscard', free: true })
    // One copy in each half of the paired zone: the hand's first, then the pile's.
    expect(c.kind === 'playCardFrom' && c.candidates.map(r => r.cardId)).toEqual(['VIL_U', 'VIL_U'])
  })
})

describe('A Fine Addition (TWI_040) — an upgrade from your hand or ANY player\'s discard pile', () => {
  const F = { ...BITS, TWI_040: real('TWI_040') }
  const fineBoard = (enemyDefeated: string[]) => ({
    ...state({
      cards: F,
      players: {
        player: player({ hand: ['TWI_040'], discard: ['PLAIN_UP'], resources: ready(12), units: [unit('u1', 'GRD')] }),
        opponent: player({ discard: ['ITEM_UP'] }),
      },
    }),
    phaseEvents: phaseEvents({ defeated: { player: [], opponent: enemyDefeated } }),
  })

  it('does nothing unless an enemy unit was defeated this phase', () => {
    expect(playEvent(fineBoard([])).pendingChoices ?? []).toHaveLength(0)
  })

  it('reaches into both discard piles as one zone, ignoring the aspect penalty', () => {
    const played = playEvent(fineBoard(['GRD']))
    const c = choice(played)
    expect(c).toMatchObject({ kind: 'playCardFrom', zone: 'anyDiscard', waive: { all: true } })
    expect(c.kind === 'playCardFrom' && c.candidates.map(r => r.cardId)).toEqual(['PLAIN_UP', 'ITEM_UP'])
  })

  it('an upgrade taken from the opponent\'s pile attaches as theirs, and goes home when defeated', () => {
    const played = playEvent(fineBoard(['GRD']))
    // Index 1 is the opponent's ITEM_UP: own pile first, theirs after it.
    const done = accept(accept(played, { optionIndex: 1 }), { targetInstanceId: 'u1' })
    expect(done.players.opponent.discard).toEqual([])
    expect(done.players.player.units[0].upgrades).toEqual([{ cardId: 'ITEM_UP', owner: 'opponent' }])
  })
})

describe('Kylo Ren (LOF_001) — deployed: any number of upgrades from the discard onto himself', () => {
  const F = { ...BITS, LOF_001: real('LOF_001') }
  const kyloBoard = () => ({
    ...board({
      leader: { cardId: 'LOF_001', deployed: false, epicActionUsed: false, exhausted: false },
      discard: ['PLAIN_UP', 'ITEM_UP'], resources: ready(20),
      units: [unit('other', 'GRD')],
    }),
    cards: F,
  })

  it('offers the upgrades in the pile and no other host than Kylo himself', () => {
    const deployed = resolve(kyloBoard(), { type: 'deployLeader' } as never)
    const c = choice(deployed)
    expect(c).toMatchObject({ kind: 'playCardFrom', zone: 'discard' })
    expect(c.kind === 'playCardFrom' && c.candidates.map(r => r.cardId)).toEqual(['PLAIN_UP', 'ITEM_UP'])
    const kylo = deployed.players.player.units.find(u => u.isLeader)!
    expect(c.kind === 'playCardFrom' && c.targetUnits).toEqual([kylo.instanceId])
  })

  it('"any number (one at a time, paying their costs)": re-offers what is left after each play', () => {
    const deployed = resolve(kyloBoard(), { type: 'deployLeader' } as never)
    const kylo = deployed.players.player.units.find(u => u.isLeader)!
    const first = accept(accept(deployed, { optionIndex: 0 }), { targetInstanceId: kylo.instanceId })
    expect(choice(first)).toMatchObject({ kind: 'playCardFrom', zone: 'discard' })
    expect(choice(first).kind === 'playCardFrom' && (choice(first) as { candidates: { cardId: string }[] }).candidates.map(r => r.cardId)).toEqual(['ITEM_UP'])

    const second = accept(accept(first, { optionIndex: 0 }), { targetInstanceId: kylo.instanceId })
    expect(second.players.player.units.find(u => u.isLeader)!.upgrades.map(u => u.cardId)).toEqual(['PLAIN_UP', 'ITEM_UP'])
    expect(second.pendingChoices ?? []).toHaveLength(0) // nothing left in the pile
  })
})

describe('Lama Su (SEC_003) — deployed: an upgrade from the discard on a friendly non-Vehicle, 1 less', () => {
  const F = { ...BITS, SEC_003: real('SEC_003') }

  it('excludes Vehicle hosts and prices the upgrade 1 less', () => {
    const withBoard = {
      ...board({
        leader: { cardId: 'SEC_003', deployed: true, epicActionUsed: false, exhausted: false },
        discard: ['PLAIN_UP'], resources: ready(12),
        units: [unit('lama', 'SEC_003', { isLeader: true }), unit('veh', 'VEH'), unit('grd', 'GRD')],
      }),
      cards: F,
    }
    const attacked = resolve(withBoard, { type: 'attack', attackerId: 'lama', target: { kind: 'base' } } as never)
    const c = attacked.pendingChoices?.find(p => p.kind === 'playCardFrom')
    expect(c).toMatchObject({ kind: 'playCardFrom', zone: 'discard', costDelta: -1, optional: true })
    expect(c && c.kind === 'playCardFrom' && c.targetUnits).toEqual(['lama', 'grd']) // the Vehicle is out
  })
})

describe('Old Daka (LOF_036) — defeat a friendly Night unit, then play it from the discard free', () => {
  const F = { ...BITS, LOF_036: real('LOF_036'), NIGHT: card({ id: 'NIGHT', type: 'unit', arena: 'ground', cost: 3, power: 3, hp: 3, traits: ['NIGHT'] }) }

  it('offers only other Night units, and replays the one it defeated for free', () => {
    const s = {
      ...board({ hand: ['LOF_036'], resources: ready(20), units: [unit('n', 'NIGHT'), unit('g', 'GRD')] }),
      cards: F,
    }
    const played = resolve(s, { type: 'playUnit', handIndex: 0 } as never)
    const pick = played.pendingChoices!.find(c => c.kind === 'selectUnitToDefeat')!
    expect(pick.kind === 'selectUnitToDefeat' && pick.targets).toEqual(['n'])

    const defeated = resolve(played, { type: 'acceptChoice', choiceId: pick.id, targetInstanceId: 'n' } as never)
    const replay = defeated.pendingChoices!.find(c => c.kind === 'playCardFrom')!
    expect(replay).toMatchObject({ zone: 'discard', free: true, optional: true })
    const done = resolve(defeated, { type: 'acceptChoice', choiceId: replay.id, optionIndex: 0 } as never)
    expect(done.players.player.units.some(u => u.cardId === 'NIGHT')).toBe(true)
  })
})

// ── "For this phase, you may play it" ───────────────────────────────────────────────────────────

describe('Boga (HMW_122) — names a non-Vehicle in your pile, playable this phase for 1 less', () => {
  const F = { ...BITS, HMW_122: real('HMW_122') }

  it('offers only non-Vehicle units not named Boga, and grants the named one', () => {
    const s = {
      ...board({ hand: ['HMW_122'], discard: ['VEH', 'GRD'], resources: ready(20) }),
      cards: F,
    }
    const played = resolve(s, { type: 'playUnit', handIndex: 0 } as never)
    const c = choice(played)
    expect(c.kind === 'selectFromDiscard' || c.kind === 'selectCardThen' || c.kind === 'playCardFrom').toBe(true)
    const done = accept(played, { optionIndex: 0, cardId: 'GRD' })
    expect(done.discardPlayGrants).toMatchObject([{ player: 'player', owner: 'player', cardId: 'GRD', costDelta: -1 }])
  })

  it('the granted card is then playable as a normal action, for 1 less', () => {
    const s = {
      ...board({ discard: ['GRD'], resources: ready(12) }),
      cards: F,
      discardPlayGrants: [{ player: 'player' as const, owner: 'player' as const, cardId: 'GRD', costDelta: -1 }],
    }
    expect(legalMoves(s).filter(m => m.type === 'playFromDiscard')).toHaveLength(1)
    const done = resolve(s, { type: 'playFromDiscard', grantIndex: 0 } as never)
    expect(done.players.player.units.some(u => u.cardId === 'GRD')).toBe(true)
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(1) // 2 − 1
  })
})

describe('Tireless Magnaguard (HMW_109) — replayable free with 2 Weakness, if it had 5+ power', () => {
  const F = { ...BITS, HMW_109: real('HMW_109') }
  const dying = (power: number) => {
    const s = { ...board({ units: [unit('m', 'HMW_109')], resources: ready(12) }), cards: F }
    return { ...s, lastingEffects: power === 5 ? undefined : [{ targetInstanceId: 'm', power: power - 5 }] }
  }

  it('grants the replay when it had 5 or more power', () => {
    const s = dying(5)
    const dead = resolve({ ...s, pendingChoices: [{ kind: 'selectUnitToDefeat', id: 'd', controller: 'player', targets: ['m'] } as PendingChoice] },
      { type: 'acceptChoice', choiceId: 'd', targetInstanceId: 'm' } as never)
    expect(dead.discardPlayGrants).toMatchObject([{ player: 'player', owner: 'player', cardId: 'HMW_109', free: true, tokens: [TOKEN_WEAKNESS, TOKEN_WEAKNESS] }])
  })

  it('grants nothing when its power had been reduced below 5', () => {
    const s = dying(4)
    const dead = resolve({ ...s, pendingChoices: [{ kind: 'selectUnitToDefeat', id: 'd', controller: 'player', targets: ['m'] } as PendingChoice] },
      { type: 'acceptChoice', choiceId: 'd', targetInstanceId: 'm' } as never)
    expect(dead.discardPlayGrants).toBeUndefined()
  })

  it('the replay is free and arrives with 2 Weakness tokens', () => {
    const s = {
      ...board({ discard: ['HMW_109'], resources: ready(12) }),
      cards: F,
      discardPlayGrants: [{ player: 'player' as const, owner: 'player' as const, cardId: 'HMW_109', free: true, tokens: [TOKEN_WEAKNESS, TOKEN_WEAKNESS] }],
    }
    const done = resolve(s, { type: 'playFromDiscard', grantIndex: 0 } as never)
    const back = done.players.player.units.find(u => u.cardId === 'HMW_109')!
    expect(back.upgrades.filter(u => u.cardId === TOKEN_WEAKNESS)).toHaveLength(2)
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(0)
  })
})

describe('Stolen AT-Hauler (JTL_221) — the permission goes to an OPPONENT', () => {
  const F = { ...BITS, JTL_221: real('JTL_221') }

  it('grants the opponent a free play out of this card\'s owner\'s pile', () => {
    const s = {
      ...state({ cards: F, players: { player: player({ units: [unit('h', 'JTL_221')] }), opponent: player({ resources: ready(12) }) } }),
    }
    const dead = resolve({ ...s, pendingChoices: [{ kind: 'selectUnitToDefeat', id: 'd', controller: 'player', targets: ['h'] } as PendingChoice] },
      { type: 'acceptChoice', choiceId: 'd', targetInstanceId: 'h' } as never)
    expect(dead.discardPlayGrants).toMatchObject([{ player: 'opponent', owner: 'player', cardId: 'JTL_221', free: true }])
  })

  it('the opponent plays it out of our pile, and it stays ours', () => {
    const s = {
      ...state({
        cards: F,
        players: { player: player({ discard: ['JTL_221'] }), opponent: player({ resources: ready(12) }) },
        activePlayer: 'opponent',
      }),
      discardPlayGrants: [{ player: 'opponent' as const, owner: 'player' as const, cardId: 'JTL_221', free: true }],
    }
    expect(legalMoves(s).filter(m => m.type === 'playFromDiscard')).toHaveLength(1)
    const done = resolve(s, { type: 'playFromDiscard', grantIndex: 0 } as never)
    const stolen = done.players.opponent.units.find(u => u.cardId === 'JTL_221')!
    expect(stolen).toBeDefined()
    expect(stolen.owner, 'played by the opponent, still ours').toBe('player')
    expect(done.players.player.discard).toEqual([])
  })
})

describe('Cobb Vanth (SHD_115) — searches the top 10, discards a unit ≤2, then may play it free', () => {
  const F = { ...BITS, SHD_115: real('SHD_115'), TINY: card({ id: 'TINY', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }) }

  it('discards the found unit and grants a free play of it for the phase', () => {
    const s = {
      ...board({ units: [unit('c', 'SHD_115')], deck: ['TINY', 'BIG', 'GRD'], resources: ready(12) }),
      cards: F,
    }
    const dead = resolve({ ...s, pendingChoices: [{ kind: 'selectUnitToDefeat', id: 'd', controller: 'player', targets: ['c'] } as PendingChoice] },
      { type: 'acceptChoice', choiceId: 'd', targetInstanceId: 'c' } as never)
    const search = dead.pendingChoices!.find(p => p.kind === 'searchDraw')!
    const done = resolve(dead, { type: 'acceptChoice', choiceId: search.id, deckIndex: 0 } as never)
    expect(done.players.player.discard).toContain('TINY')
    expect(done.discardPlayGrants).toMatchObject([{ player: 'player', owner: 'player', cardId: 'TINY', free: true }])
  })
})

describe('Aid from the Innocent (TWI_201) — two Heroism non-units, playable this phase for 2 less', () => {
  const F = { ...BITS, TWI_201: real('TWI_201') }

  it('grants a 2-less play for each of the two cards it discarded', () => {
    const s = {
      ...board({ hand: ['TWI_201'], deck: ['HERO_EV', 'PLAIN_UP', 'GRD'], resources: ready(12) }),
      cards: { ...F, PLAIN_UP: card({ id: 'PLAIN_UP', type: 'upgrade', cost: 2, power: 1, hp: 1, aspects: ['Heroism'] }) },
    }
    const played = playEvent(s)
    const search = played.pendingChoices!.find(p => p.kind === 'searchDraw')!
    const one = resolve(played, { type: 'acceptChoice', choiceId: search.id, deckIndex: 0 } as never)
    const two = resolve(one, { type: 'acceptChoice', choiceId: choice(one).id, deckIndex: 0 } as never)
    expect(two.players.player.discard).toEqual(expect.arrayContaining(['HERO_EV', 'PLAIN_UP']))
    expect(two.discardPlayGrants).toMatchObject([
      { player: 'player', owner: 'player', cardId: 'HERO_EV', costDelta: -2 },
      { player: 'player', owner: 'player', cardId: 'PLAIN_UP', costDelta: -2 },
    ])
  })
})
