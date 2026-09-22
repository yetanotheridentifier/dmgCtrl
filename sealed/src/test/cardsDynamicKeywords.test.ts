import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { unitHasKeyword, unitKeywordValue, unitKeywords } from '../engine/keywords'
import { TOKEN_EXPERIENCE } from '../engine/tokenUpgrades'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, LeaderState, PendingChoice, PlayerId, UnitState } from '../engine/types'
import type { Action } from '../engine/actions'

/**
 * The cards that treat a keyword as a value rather than a fixed property, and the two engine
 * additions they needed.
 *
 * - **Swapped keywords** (`swappedKeywords`): a card exchanges two keyword names on its unit, applied
 *   as a rename over the unit's finished keyword list. "Replace any Raid it has or gains with
 *   Restore" is therefore a rename of whatever every other source ended up granting, which is what
 *   "has or gains" means, and it needs neither a read-before-hide nor a suppression.
 * - **A keyword remembered on a unit** (`UnitState.namedKeyword`): the keyword its controller chose
 *   as it arrived, read by its aura for as long as it is in play, exactly as `namedCard` is.
 *
 * The source data parses the literal word `Keyword`/`Keywords` out of these cards' ability text into
 * their `Keywords[]` array, so each one's printed keywords are asserted against the fixture too.
 *
 * Printed stats, traits and keywords come from the shipped set fixtures, post-correction.
 */

const SHIPPED = ['HMW_001', 'JTL_047', 'JTL_053', 'LOF_105', 'TS26_3']

const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = poolFor([set]).find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, arena: 'ground', cost: 2, power: 2, hp: 8, ...over })
const upg = (id: string, over: Partial<EngineCard> = {}) => card({ id, type: 'upgrade', cost: 1, power: 0, hp: 0, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries(SHIPPED.map(id => [id, real(id)])),
  GRD: src('GRD'),
  RAID2: src('RAID2', { keywords: [{ name: 'Raid', value: 2 }] }),
  REST1: src('REST1', { keywords: [{ name: 'Restore', value: 1 }] }),
  TWOKW: src('TWOKW', { keywords: [{ name: 'Sentinel' }, { name: 'Saboteur' }] }),
  ONEKW: src('ONEKW', { keywords: [{ name: 'Sentinel' }] }),
  SPECTRE: src('SPECTRE', { traits: ['REBEL', 'SPECTRE'] }),
  VEHICLE: src('VEHICLE', { traits: ['REBEL', 'VEHICLE'] }),
  AMBUSHER: src('AMBUSHER', { keywords: [{ name: 'Ambush' }] }),
  REST3: src('REST3', { keywords: [{ name: 'Restore', value: 3 }] }),
  RAID_UP: upg('RAID_UP', { keywords: [{ name: 'Raid', value: 1 }] }),
  SENT_UP: upg('SENT_UP', { keywords: [{ name: 'Sentinel' }] }),
  PLAIN_UP: upg('PLAIN_UP'),
  PLAIN_L: card({ id: 'PLAIN_L', type: 'leader', cost: 5, power: 4, hp: 7 }),
}

const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(x => x.instanceId === id)!

type Side = Parameters<typeof player>[0]
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(10), deck: [], ...mine }),
      opponent: player({ resources: ready(10), deck: [], ...theirs }),
    },
    ...over,
  })
const undeployed = (cardId: string): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })
const deployed = (cardId: string): LeaderState => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })

const moves = (s: GameState): Action[] => legalMoves(s)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = { targetInstanceId?: string; optionIndex?: number; handIndex?: number; baseTarget?: PlayerId }
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const attack = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
const names = (s: GameState, id: string) => unitKeywords(s, U(s, id)).map(k => k.name).sort()

// ── HMW_001 Asajj Ventress ────────────────────────────────────────────────────────────────────

describe('Asajj Ventress (HMW_001): Raid and Restore trade places for one attack', () => {
  it("her printed keywords are Restore 2 — the source reads Raid and Restore out of her front's ability text", () => {
    expect(real('HMW_001').keywords).toEqual([{ name: 'Restore', value: 2 }])
  })

  const front = (mine: Side = {}, theirs: Side = {}) =>
    board({ leader: undeployed('HMW_001'), base: { cardId: 'TST_B', damage: 6 }, ...mine }, theirs)

  it('her front offers the action, which exhausts her and raises the attack', () => {
    const s = front({ units: [unit('a', 'RAID2')] }, { units: [unit('e', 'GRD')] })
    expect(moves(s)).toContainEqual({ type: 'useLeaderAbility', index: 0 })
    const used = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(choice(used)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    expect(used.players.player.leader.exhausted).toBe(true)
  })

  it('a Raid 2 attacker loses the Raid and heals 2 instead', () => {
    const s = front({ units: [unit('a', 'RAID2')] })
    const done = attack(resolve(s, { type: 'useLeaderAbility', index: 0 }), 'a')
    expect(done.players.opponent.base.damage).toBe(2) // printed power only: the Raid is now Restore
    expect(done.players.player.base.damage).toBe(4) // 6 - 2 restored
  })

  it('without her action the same attacker keeps its Raid', () => {
    const s = front({ units: [unit('a', 'RAID2')] })
    const done = attack(s, 'a')
    expect(done.players.opponent.base.damage).toBe(4)
    expect(done.players.player.base.damage).toBe(6)
  })

  it('a Restore 1 attacker gains Raid 1 instead: the swap runs both ways', () => {
    const s = front({ units: [unit('a', 'REST1')] })
    const done = attack(resolve(s, { type: 'useLeaderAbility', index: 0 }), 'a')
    expect(done.players.opponent.base.damage).toBe(3) // 2 power + the Raid 1 the Restore became
    expect(done.players.player.base.damage).toBe(6) // nothing restored
  })

  it('Raid it GAINS from an upgrade is swapped too, and the values add up', () => {
    const s = front({ units: [unit('a', 'RAID2', { upgrades: [{ cardId: 'RAID_UP', owner: 'player' }] })] })
    const done = attack(resolve(s, { type: 'useLeaderAbility', index: 0 }), 'a')
    expect(done.players.opponent.base.damage).toBe(2)
    expect(done.players.player.base.damage).toBe(3) // 6 - (2 + 1) restored
  })

  it('the swap lasts for that attack only', () => {
    const s = front({ units: [unit('a', 'RAID2')] })
    const used = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(names(used, 'a')).toEqual(['Raid']) // not yet: the rider lands on the chosen attacker
    const done = attack(used, 'a')
    expect(names(done, 'a')).toEqual(['Raid'])
    expect(U(done, 'a').grantedAbilityCardIds).toBeUndefined()
  })

  it('her back has Restore 2 of its own and the same action, which costs her no exhaust', () => {
    const s = board(
      { leader: deployed('HMW_001'), base: { cardId: 'TST_B', damage: 6 }, units: [unit('l', 'HMW_001', { isLeader: true }), unit('a', 'RAID2')] },
      { units: [unit('e', 'GRD')] },
    )
    expect(attack(s, 'l').players.player.base.damage).toBe(4) // her own Restore 2
    const used = resolve(s, { type: 'useAbility', instanceId: 'l', cardId: 'HMW_001', index: 0 })
    expect(choice(used)).toMatchObject({ kind: 'mayAttackAnyUnit' })
    expect(U(used, 'l').exhausted).toBe(false) // her back prints "Action:", not "Action [Exhaust]:"
    const done = attack(used, 'a')
    expect(done.players.opponent.base.damage).toBe(2)
    expect(done.players.player.base.damage).toBe(4)
  })

  it('her own Restore 2 becomes Raid 2 when she is the one attacking under her back action', () => {
    const s = board(
      { leader: deployed('HMW_001'), base: { cardId: 'TST_B', damage: 6 }, units: [unit('l', 'HMW_001', { isLeader: true })] },
      { units: [unit('e', 'GRD')] },
    )
    const done = attack(resolve(s, { type: 'useAbility', instanceId: 'l', cardId: 'HMW_001', index: 0 }), 'l')
    expect(done.players.opponent.base.damage).toBe(3 + 2) // her printed 3 power plus the Raid 2 her Restore became
    expect(done.players.player.base.damage).toBe(6) // nothing restored
  })
})

// ── TS26_3 Maul ───────────────────────────────────────────────────────────────────────────────

describe('Maul (TS26_3): more different Keywords than Experience tokens', () => {
  it('his printed keywords are empty — the source reads the word "Keywords" out of his ability text', () => {
    expect(real('TS26_3').keywords).toEqual([])
  })

  const exp = (s: GameState, id: string) => U(s, id).upgrades.filter(u => u.cardId === TOKEN_EXPERIENCE).length
  const front = (mine: Side = {}, theirs: Side = {}) => board({ leader: undeployed('TS26_3'), ...mine }, theirs)

  it('a unit with 2 keywords and no Experience takes a token and 1 damage', () => {
    const s = front({ units: [unit('a', 'TWOKW')] })
    const used = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(choice(used)).toMatchObject({ kind: 'selectUnitThen' })
    const done = accept(used, { targetInstanceId: 'a' })
    expect(exp(done, 'a')).toBe(1)
    expect(U(done, 'a').damage).toBe(1)
  })

  it('a unit with 1 keyword and 1 Experience token is left alone: "more", not "as many"', () => {
    const s = front({ units: [unit('a', 'ONEKW', { upgrades: [{ cardId: TOKEN_EXPERIENCE, owner: 'player' }] })] })
    const done = accept(resolve(s, { type: 'useLeaderAbility', index: 0 }), { targetInstanceId: 'a' })
    expect(exp(done, 'a')).toBe(1)
    expect(U(done, 'a').damage).toBe(0)
  })

  it('DIFFERENT keywords: Raid 2 and a Raid 1 upgrade are one keyword, not two', () => {
    const s = front({ units: [unit('a', 'RAID2', { upgrades: [{ cardId: 'RAID_UP', owner: 'player' }, { cardId: TOKEN_EXPERIENCE, owner: 'player' }] })] })
    const done = accept(resolve(s, { type: 'useLeaderAbility', index: 0 }), { targetInstanceId: 'a' })
    expect(U(done, 'a').damage).toBe(0)
  })

  it('an enemy unit is a legal choice', () => {
    const s = front({}, { units: [unit('e', 'TWOKW')] })
    const done = accept(resolve(s, { type: 'useLeaderAbility', index: 0 }), { targetInstanceId: 'e' })
    expect(exp(done, 'e')).toBe(1)
    expect(U(done, 'e').damage).toBe(1)
  })

  it('his back does the same when he deploys and on each of his attacks', () => {
    const deployedBoard = board(
      { leader: deployed('TS26_3'), units: [unit('l', 'TS26_3', { isLeader: true }), unit('a', 'TWOKW')] },
      { units: [unit('e', 'GRD')] },
    )
    const attacked = accept(attack(deployedBoard, 'l'), { targetInstanceId: 'a' })
    expect(exp(attacked, 'a')).toBe(1)
    expect(U(attacked, 'a').damage).toBe(1)

    // Deploying him raises the same choice.
    const undeployedBoard = board(
      { leader: { cardId: 'TS26_3', deployed: false, epicActionUsed: false, exhausted: false }, resources: ready(12), units: [unit('a', 'TWOKW')] },
      { units: [unit('e', 'GRD')] },
    )
    const deployedNow = resolve(undeployedBoard, { type: 'deployLeader' })
    expect(choice(deployedNow)).toMatchObject({ kind: 'selectUnitThen' })
    expect(exp(accept(deployedNow, { targetInstanceId: 'a' }), 'a')).toBe(1)
  })
})

// ── JTL_053 The Ghost ─────────────────────────────────────────────────────────────────────────

describe("The Ghost (JTL_053): each other friendly Spectre unit gains this unit's Keywords", () => {
  it('its printed keywords are empty — Sentinel is conditional and "Keywords" is the ability text', () => {
    expect(real('JTL_053').keywords).toEqual([])
  })

  const ghost = (over: Partial<UnitState> = {}) => unit('g', 'JTL_053', over)

  it('while upgraded it gains Sentinel, and every other friendly Spectre gains it too', () => {
    const s = board(
      { units: [ghost({ upgrades: [{ cardId: 'PLAIN_UP', owner: 'player' }] }), unit('sp', 'SPECTRE'), unit('nv', 'GRD')] },
      { units: [unit('e', 'SPECTRE')] },
    )
    expect(unitHasKeyword(s, U(s, 'g'), 'Sentinel')).toBe(true)
    expect(unitHasKeyword(s, U(s, 'sp'), 'Sentinel')).toBe(true)
    expect(unitHasKeyword(s, U(s, 'nv'), 'Sentinel')).toBe(false)
    expect(unitHasKeyword(s, U(s, 'e'), 'Sentinel')).toBe(false)
  })

  it('unupgraded it has no keywords, so the other Spectres gain none', () => {
    const s = board({ units: [ghost(), unit('sp', 'SPECTRE')] })
    expect(unitHasKeyword(s, U(s, 'g'), 'Sentinel')).toBe(false)
    expect(unitHasKeyword(s, U(s, 'sp'), 'Sentinel')).toBe(false)
  })

  it('a valued keyword travels with its numeral', () => {
    const s = board({ units: [ghost({ upgrades: [{ cardId: 'RAID_UP', owner: 'player' }] }), unit('sp', 'SPECTRE')] })
    expect(unitKeywordValue(s, U(s, 'sp'), 'Raid')).toBe(1)
    expect(unitHasKeyword(s, U(s, 'sp'), 'Sentinel')).toBe(true) // the upgrade also makes it upgraded
  })
})

// ── LOF_105 Oppo Rancisis ─────────────────────────────────────────────────────────────────────

describe('Oppo Rancisis (LOF_105): he gains what another friendly unit has', () => {
  it('his printed keywords are empty — all nine the source lists are his ability text', () => {
    expect(real('LOF_105').keywords).toEqual([])
  })

  const oppo = (mine: UnitState[] = [], theirs: UnitState[] = []) =>
    board({ units: [unit('o', 'LOF_105'), ...mine] }, { units: theirs })

  it('alone he has none of them', () => {
    expect(names(oppo(), 'o')).toEqual([])
  })

  it('an unvalued keyword on another friendly unit is copied as itself', () => {
    const s = oppo([unit('f', 'AMBUSHER')])
    expect(unitHasKeyword(s, U(s, 'o'), 'Ambush')).toBe(true)
    expect(unitHasKeyword(s, U(s, 'o'), 'Sentinel')).toBe(false)
  })

  it('an ENEMY unit with the keyword does not give it to him', () => {
    const s = oppo([], [unit('e', 'AMBUSHER')])
    expect(unitHasKeyword(s, U(s, 'o'), 'Ambush')).toBe(false)
  })

  it('Raid on another friendly unit gives him Raid 2, whatever its numeral', () => {
    const s = oppo([unit('f', 'RAID2')]) // Raid 2
    expect(unitKeywordValue(s, U(s, 'o'), 'Raid')).toBe(2)
    const one = oppo([unit('f', 'GRD', { upgrades: [{ cardId: 'RAID_UP', owner: 'player' }] })]) // Raid 1
    expect(unitKeywordValue(one, U(one, 'o'), 'Raid')).toBe(2)
  })

  it('Restore on another friendly unit gives him Restore 2, whatever its numeral', () => {
    const s = oppo([unit('f', 'REST3')])
    expect(unitKeywordValue(s, U(s, 'o'), 'Restore')).toBe(2)
  })

  it('he does not read himself: his own copied Ambush cannot be its own source', () => {
    const s = oppo([unit('f', 'AMBUSHER'), unit('g', 'GRD')])
    expect(unitHasKeyword(s, U(s, 'g'), 'Ambush')).toBe(false)
  })
})

// ── JTL_047 Admiral Yularen ───────────────────────────────────────────────────────────────────

describe('Admiral Yularen (JTL_047): friendly Vehicles gain the Keyword he chose', () => {
  it('his printed keywords are empty — all four options are read out of his ability text', () => {
    expect(real('JTL_047').keywords).toEqual([])
  })

  const play = (mine: Side = {}, theirs: Side = {}) =>
    resolve(board({ hand: ['JTL_047'], leader: undeployed('PLAIN_L'), ...mine }, theirs), { type: 'playUnit', handIndex: 0 })

  it('he offers Grit, Restore 1, Sentinel and Shielded', () => {
    const played = play()
    expect(choice(played)).toMatchObject({ kind: 'chooseMode', modes: ['Grit', 'Restore', 'Sentinel', 'Shielded'] })
  })

  it('the chosen keyword goes to each friendly Vehicle, and to nobody else', () => {
    const played = play({ units: [unit('v', 'VEHICLE'), unit('nv', 'GRD')] }, { units: [unit('e', 'VEHICLE')] })
    const done = accept(played, { optionIndex: 2 }) // Sentinel
    expect(unitHasKeyword(done, U(done, 'v'), 'Sentinel')).toBe(true)
    expect(unitHasKeyword(done, U(done, 'nv'), 'Sentinel')).toBe(false)
    expect(unitHasKeyword(done, U(done, 'e'), 'Sentinel')).toBe(false)
  })

  it('Restore is granted as Restore 1', () => {
    const played = play({ units: [unit('v', 'VEHICLE')] })
    const done = accept(played, { optionIndex: 1 })
    expect(unitKeywordValue(done, U(done, 'v'), 'Restore')).toBe(1)
  })

  it('the grant ends when he leaves play', () => {
    const played = play({ units: [unit('v', 'VEHICLE')] })
    const done = accept(played, { optionIndex: 2 })
    const yularen = done.players.player.units.find(u => u.cardId === 'JTL_047')!
    const gone = { ...done, players: { ...done.players, player: { ...done.players.player, units: done.players.player.units.filter(u => u.instanceId !== yularen.instanceId) } } }
    expect(unitHasKeyword(gone, U(gone, 'v'), 'Sentinel')).toBe(false)
  })
})
