import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { unitHasKeyword, unitKeywords } from '../engine/keywords'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, PlayerState } from '../engine/types'

/**
 * The Smuggle cards that each needed engine work of their own: a granted Smuggle (Tech), an
 * additional cost on the bracket (First Light), a watch on every Smuggle play (Hondo Ohnaka), an
 * ability that makes a Smuggle play (Lando Calrissian), a "played from hand" read (Millennium
 * Falcon), and taking control of a resource (DJ). Printed text and stats come from the shipped SHD
 * fixture.
 */

const POOL = poolFor(['SHD'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the SHD fixture`)
  return normaliseCard(row)
}

const SMU = card({ id: 'SMU', type: 'unit', arena: 'ground', cost: 9, power: 2, hp: 2, aspects: ['Aggression'], smuggle: { cost: 4, aspects: ['Cunning'] } })
const PLAIN = card({ id: 'PLAIN', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, aspects: ['Aggression'] })
const BIG = card({ id: 'BIG', type: 'unit', arena: 'ground', cost: 5, power: 2, hp: 9 })

type Over = Partial<PlayerState>
const board = (cards: Record<string, EngineCard>, me: Over = {}, them: Over = {}): GameState =>
  state({ cards: { ...CARDS, SMU, PLAIN, BIG, ...cards }, players: { player: player({ deck: ['TST_U2'], ...me }), opponent: player(them) } })

const smuggles = (s: GameState) => legalMoves(s).filter((m): m is Extract<Action, { type: 'smuggle' }> => m.type === 'smuggle')
const unitOf = (s: GameState, cardId: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.cardId === cardId)
/** Defeat `id` through a resolved choice, so the per-action sweep runs as it would after any defeat. */
const defeat = (s: GameState, id: string) =>
  resolve({ ...s, pendingChoices: [{ kind: 'selectUnitToDefeat', id: 'kill', controller: 'player', targets: [id] }] },
    { type: 'acceptChoice', choiceId: 'kill', targetInstanceId: id })

describe('Tech (SHD_248): each friendly resource gains Smuggle, at its cost plus 2 and its aspect icons', () => {
  const F = { SHD_248: real('SHD_248') }

  it('Tech prints its own Smuggle bracket', () => {
    expect(F.SHD_248.smuggle).toEqual({ cost: 4, aspects: ['Heroism'] })
  })

  it('a resource with no Smuggle of its own is offered one while you control Tech', () => {
    // PLAIN costs 2, Aggression unprovided: 2 + 2 (gained) + 2 (penalty) = 6, itself among the six.
    const s = board(F, { units: [unit('tech', 'SHD_248')], resources: [{ cardId: 'PLAIN', exhausted: false }, ...ready(5)] })
    expect(smuggles(s)).toEqual([{ type: 'smuggle', resourceIndex: 0, granted: true }])
    const short = board(F, { units: [unit('tech', 'SHD_248')], resources: [{ cardId: 'PLAIN', exhausted: false }, ...ready(4)] })
    expect(smuggles(short)).toEqual([])
  })

  it('is not offered without Tech, or while only the opponent controls Tech', () => {
    expect(smuggles(board(F, { resources: [{ cardId: 'PLAIN', exhausted: false }, ...ready(9)] }))).toEqual([])
    expect(smuggles(board(F, { resources: [{ cardId: 'PLAIN', exhausted: false }, ...ready(9)] }, { units: [unit('tech', 'SHD_248')] }))).toEqual([])
  })

  it('a card with Smuggle of its own has both, each an independent ability (CR 14.b)', () => {
    // Printed: 4 + 2 (Cunning) = 6. Gained: 9 + 2 + 2 (Aggression) = 13.
    const rich = board(F, { units: [unit('tech', 'SHD_248')], resources: [{ cardId: 'SMU', exhausted: false }, ...ready(12)] })
    expect(smuggles(rich)).toEqual([{ type: 'smuggle', resourceIndex: 0 }, { type: 'smuggle', resourceIndex: 0, granted: true }])
    const poor = board(F, { units: [unit('tech', 'SHD_248')], resources: [{ cardId: 'SMU', exhausted: false }, ...ready(5)] })
    expect(smuggles(poor)).toEqual([{ type: 'smuggle', resourceIndex: 0 }])
  })

  it('a play using the gained Smuggle is a Smuggle play: paid, replaced, and recorded as using Smuggle', () => {
    const s = board(F, { units: [unit('tech', 'SHD_248')], resources: [{ cardId: 'PLAIN', exhausted: false }, ...ready(5)] })
    const done = resolve(s, { type: 'smuggle', resourceIndex: 0, granted: true })
    expect(unitOf(done, 'PLAIN')?.playedUsingSmuggle).toBe(true)
    expect(done.players.player.resources).toHaveLength(6)
    expect(done.players.player.resources.filter(r => !r.exhausted)).toHaveLength(0)
    expect(done.players.player.resources.at(-1)).toEqual({ cardId: 'TST_U2', exhausted: true })
  })

  it('Scanning Officer (SHD_114) counts a gained Smuggle as the keyword', () => {
    const G = { ...F, SHD_114: real('SHD_114') }
    const opp = { units: [unit('tech', 'SHD_248')], resources: [{ cardId: 'PLAIN', exhausted: false }, { cardId: 'TST_U1', exhausted: false }], deck: ['TST_U2', 'TST_U2'] }
    const s = board(G, { hand: ['SHD_114'], resources: ready(10) }, opp)
    const done = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(done.players.opponent.discard).toEqual(expect.arrayContaining(['PLAIN', 'TST_U1']))
    const without = board(G, { hand: ['SHD_114'], resources: ready(10) }, { ...opp, units: [] })
    expect(resolve(without, { type: 'playUnit', handIndex: 0 }).players.opponent.discard).toEqual([])
  })
})

describe('First Light (SHD_036): Grit, each other friendly non-leader unit gains Grit, Smuggle with "deal 4 damage to a friendly unit"', () => {
  const F = { SHD_036: real('SHD_036') }
  // C=7 Vigilance Villainy: the fixture's Vigilance base covers one, Villainy is +2, so 9.
  const zone = (n = 8) => [{ cardId: 'SHD_036', exhausted: false }, ...ready(n)]

  it('offers the Smuggle once for each friendly unit that could take the damage', () => {
    const s = board(F, { units: [unit('big', 'BIG'), unit('u1', 'TST_U1')], resources: zone() })
    expect(smuggles(s)).toEqual([
      { type: 'smuggle', resourceIndex: 0, costUnitId: 'big' },
      { type: 'smuggle', resourceIndex: 0, costUnitId: 'u1' },
    ])
  })

  it('is not offered with no friendly unit to pay the additional cost', () => {
    expect(smuggles(board(F, { resources: zone() }))).toEqual([])
  })

  it('deals 4 damage to the chosen friendly unit as it pays, then enters play', () => {
    const s = board(F, { units: [unit('big', 'BIG')], resources: zone() })
    const done = resolve(s, { type: 'smuggle', resourceIndex: 0, costUnitId: 'big' })
    expect(done.players.player.units.find(u => u.instanceId === 'big')!.damage).toBe(4)
    expect(unitOf(done, 'SHD_036')?.playedUsingSmuggle).toBe(true)
  })

  it('has Grit itself, and gives Grit to each other friendly non-leader unit only', () => {
    const s = board(F,
      { units: [unit('fl', 'SHD_036'), unit('big', 'BIG'), unit('lead', 'TST_L', { isLeader: true })], leader: { cardId: 'TST_L', deployed: true, epicActionUsed: false, exhausted: false } },
      { units: [unit('e1', 'TST_U1')] })
    const find = (id: string) => [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === id)!
    expect(unitHasKeyword(s, find('fl'), 'Grit')).toBe(true)
    expect(unitHasKeyword(s, find('big'), 'Grit')).toBe(true)
    expect(unitHasKeyword(s, find('lead'), 'Grit')).toBe(false)
    expect(unitHasKeyword(s, find('e1'), 'Grit')).toBe(false)
  })
})

describe('Hondo Ohnaka (SHD_005): When you play a card using Smuggle', () => {
  const F = { SHD_005: real('SHD_005') }
  const front = { leader: { cardId: 'SHD_005', deployed: false, epicActionUsed: false, exhausted: false } }
  const smuggleZone = [{ cardId: 'SMU', exhausted: false }, ...ready(5)]

  it('front: offers to exhaust the leader after a Smuggle play, and if you do, an Experience token for a unit', () => {
    const s = board(F, { ...front, units: [unit('u1', 'TST_U1')], resources: smuggleZone })
    const played = resolve(s, { type: 'smuggle', resourceIndex: 0 })
    const offer = played.pendingChoices?.find(c => c.kind === 'mayPayThen')
    expect(offer).toBeTruthy()
    const paid = resolve(played, { type: 'acceptChoice', choiceId: offer!.id })
    expect(paid.players.player.leader.exhausted).toBe(true)
    expect(paid.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', token: 'TOKEN_EXPERIENCE' })
  })

  it('front: nothing for a card played from hand, an opponent\'s Smuggle play, or an exhausted leader', () => {
    const hand = resolve(board(F, { ...front, hand: ['TST_U1'], resources: ready(5) }), { type: 'playUnit', handIndex: 0 })
    expect(hand.pendingChoices?.some(c => c.kind === 'mayPayThen')).toBeFalsy()
    const tired = board(F, { leader: { ...front.leader, exhausted: true }, resources: smuggleZone })
    expect(resolve(tired, { type: 'smuggle', resourceIndex: 0 }).pendingChoices?.some(c => c.kind === 'mayPayThen')).toBeFalsy()
    const theirs = state({
      cards: { ...CARDS, SMU, ...F },
      activePlayer: 'opponent',
      players: { player: player(front), opponent: player({ resources: smuggleZone, deck: ['TST_U2'] }) },
    })
    expect(resolve(theirs, { type: 'smuggle', resourceIndex: 0 }).pendingChoices?.some(c => c.kind === 'mayPayThen')).toBeFalsy()
  })

  it('back: Raid 1, and a Smuggle play offers an Experience token for a unit, which may be declined', () => {
    expect(F.SHD_005.keywords).toContainEqual({ name: 'Raid', value: 1 })
    const s = board(F, {
      leader: { ...front.leader, deployed: true },
      units: [unit('hondo', 'SHD_005', { isLeader: true })],
      resources: smuggleZone,
    })
    expect(unitKeywords(s, s.players.player.units[0])).toContainEqual({ name: 'Raid', value: 1 })
    const played = resolve(s, { type: 'smuggle', resourceIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayGiveTokens', token: 'TOKEN_EXPERIENCE', optional: true })
  })
})

describe('Lando Calrissian (SHD_017): Play a card using Smuggle. It costs 2 less. Defeat a resource you own and control.', () => {
  const F = { SHD_017: real('SHD_017') }
  const front = { leader: { cardId: 'SHD_017', deployed: false, epicActionUsed: false, exhausted: false } }
  // Lando provides Cunning, so SMU smuggles for 4, and for 2 through Lando.
  const zone = (n: number) => [{ cardId: 'SMU', exhausted: false }, ...ready(n)]

  it('front: usable when a Smuggle play is affordable at 2 less, which the ordinary Smuggle is not', () => {
    const s = board(F, { ...front, resources: zone(2) })
    expect(smuggles(s)).toEqual([])
    expect(legalMoves(s).some(m => m.type === 'useLeaderAbility')).toBe(true)
  })

  it('front: not usable with nothing to smuggle', () => {
    expect(legalMoves(board(F, { ...front, resources: ready(8) })).some(m => m.type === 'useLeaderAbility')).toBe(false)
  })

  it('front: the play costs 2 less, then a resource you own and control is defeated', () => {
    const stolen = { cardId: 'THEIRS', exhausted: false, owner: 'opponent' as const }
    const s = board(F, { ...front, resources: [...zone(2), stolen] })
    const used = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(used.players.player.leader.exhausted).toBe(true)
    expect(used.pendingChoices?.[0]).toMatchObject({ kind: 'playUsingSmuggle' })
    const offered = smuggles(used)
    expect(offered).toEqual([{ type: 'smuggle', resourceIndex: 0, choiceId: used.pendingChoices![0].id }])
    const played = resolve(used, offered[0])
    expect(unitOf(played, 'SMU')?.playedUsingSmuggle).toBe(true)
    // Cost 2 of the 4 ready resources (SMU itself, R0, R1, THEIRS): two still ready.
    expect(played.players.player.resources.filter(r => !r.exhausted)).toHaveLength(2)
    const pick = played.pendingChoices?.[0]
    expect(pick).toMatchObject({ kind: 'selectCardThen' })
    expect(pick?.kind === 'selectCardThen' && pick.candidates).not.toContain('THEIRS')
    const done = resolve(played, { type: 'acceptChoice', choiceId: pick!.id, optionIndex: 0 })
    expect(done.players.player.resources).toHaveLength(3)
    expect(done.players.player.discard).toHaveLength(1)
  })

  it('back: the same Action, without exhausting, once each round', () => {
    const s = board(F, {
      leader: { ...front.leader, deployed: true },
      units: [unit('lando', 'SHD_017', { isLeader: true })],
      resources: [{ cardId: 'SMU', exhausted: false }, { cardId: 'SMU', exhausted: false }, ...ready(6)],
    })
    const action = legalMoves(s).find(m => m.type === 'useAbility' && m.instanceId === 'lando')
    expect(action).toBeTruthy()
    const used = resolve(s, action!)
    const played = resolve(used, smuggles(used)[0])
    const pick = played.pendingChoices![0]
    const done = resolve(played, { type: 'acceptChoice', choiceId: pick.id, optionIndex: 0 })
    expect(done.players.player.units.find(u => u.instanceId === 'lando')!.exhausted).toBe(false)
    const again = { ...done, activePlayer: 'player' as const }
    expect(legalMoves(again).some(m => m.type === 'useAbility' && m.instanceId === 'lando')).toBe(false)
  })
})

describe('Millennium Falcon (SHD_204): if you play this unit from your hand, it gains Ambush', () => {
  const F = { SHD_204: real('SHD_204') }
  // A space unit: the Falcon is one, and Ambush only opens with an enemy unit it could attack.
  const enemy = { units: [unit('e1', 'TST_U2', { arena: 'space' })] }

  it('does not print Ambush as its own keyword', () => {
    expect(F.SHD_204.keywords.map(k => k.name)).not.toContain('Ambush')
  })

  it('played from hand, it has Ambush', () => {
    const played = resolve(board(F, { hand: ['SHD_204'], resources: ready(10) }, enemy), { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'ambush' })
  })

  it('played from hand by an ability, it has Ambush', () => {
    const s = board(F, { hand: ['SHD_204'], resources: ready(10), }, enemy)
    const raised = { ...s, pendingChoices: [{ kind: 'playCardFrom' as const, id: 'pc', controller: 'player' as const, zone: 'hand' as const, candidates: [{ index: 0, cardId: 'SHD_204' }], free: true }] }
    const played = resolve(raised, { type: 'acceptChoice', choiceId: 'pc', optionIndex: 0 })
    expect(played.pendingChoices?.some(c => c.kind === 'ambush')).toBe(true)
  })

  it('smuggled, or played from a discard pile, it does not', () => {
    const smuggled = resolve(board(F, { resources: [{ cardId: 'SHD_204', exhausted: false }, ...ready(10)] }, enemy), { type: 'smuggle', resourceIndex: 0 })
    expect(smuggled.pendingChoices?.some(c => c.kind === 'ambush')).toBeFalsy()
    expect(unitOf(smuggled, 'SHD_204')?.exhausted).toBe(true)
    const s = board(F, { discard: ['SHD_204'], resources: ready(10) }, enemy)
    const raised = { ...s, pendingChoices: [{ kind: 'playCardFrom' as const, id: 'pc', controller: 'player' as const, zone: 'discard' as const, candidates: [{ index: 0, cardId: 'SHD_204' }], free: true }] }
    const fromDiscard = resolve(raised, { type: 'acceptChoice', choiceId: 'pc', optionIndex: 0 })
    expect(fromDiscard.pendingChoices?.some(c => c.kind === 'ambush')).toBeFalsy()
  })
})

describe('DJ (SHD_213): When played using Smuggle, take control of an enemy resource until DJ leaves play', () => {
  const F = { SHD_213: real('SHD_213') }
  // C=7 Cunning Cunning, neither provided by the fixture leader or base: 11.
  const zone = [{ cardId: 'SHD_213', exhausted: false }, ...ready(10)]
  const theirs = { resources: [{ cardId: 'O1', exhausted: true }, { cardId: 'O2', exhausted: false }] }

  it('takes a ready enemy resource, which keeps its ready state (CR 27.1.c)', () => {
    const done = resolve(board(F, { resources: zone }, theirs), { type: 'smuggle', resourceIndex: 0 })
    expect(done.players.opponent.resources).toEqual([{ cardId: 'O1', exhausted: true }])
    const taken = done.players.player.resources.find(r => r.cardId === 'O2')
    expect(taken).toMatchObject({ cardId: 'O2', exhausted: false, owner: 'opponent' })
  })

  it('hands the resource back to its owner once DJ leaves play', () => {
    const taken = resolve(board(F, { resources: zone }, theirs), { type: 'smuggle', resourceIndex: 0 })
    const dj = unitOf(taken, 'SHD_213')!
    const done = defeat({ ...taken, activePlayer: 'player' }, dj.instanceId)
    expect(done.players.player.resources.some(r => r.cardId === 'O2')).toBe(false)
    expect(done.players.opponent.resources).toEqual([{ cardId: 'O1', exhausted: true }, { cardId: 'O2', exhausted: false }])
  })

  it('takes nothing when played from hand', () => {
    const done = resolve(board(F, { hand: ['SHD_213'], resources: ready(10) }, theirs), { type: 'playUnit', handIndex: 0 })
    expect(done.players.opponent.resources).toHaveLength(2)
  })
})
