import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves, effectiveCost } from '../engine/legalMoves'
import { payCost } from '../engine/resources'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import { cardsPlayedThisPhase } from '../engine/types'
import type { EngineCard, GameState, PhaseEvents, PlayerId, PendingChoice } from '../engine/types'

/**
 * Playing a card out of a zone that is not the active player's hand (#468).
 *
 * `playCardFrom` is the one door: any card type, out of the resource zone (yours or an opponent's),
 * the top of your deck, or your hand when an ability rather than the Play a Card action is doing the
 * playing. `attachPlayedCard` is its second step for an upgrade, which cannot be priced until its
 * host is known.
 *
 * Two rules decide how it pays, and both are in the comprehensive rules rather than inferable from
 * the engine:
 *
 * - **CR 6.2.f** puts "Pay cost(s)" at step 4 and "Put card into play" at step 5, so a card played
 *   out of the resource zone is still a resource while its cost is paid. **CR 14.e** spells the
 *   consequence out for Smuggle: "As the card is still in the resource zone while paying costs, a
 *   card with Smuggle can be exhausted to help pay its own Smuggle cost."
 * - **CR 1.7.4**: a player may rearrange their resources at any time up to the point a specific
 *   resource is chosen, and may change which of them are ready or exhausted so long as the counts
 *   are unchanged. So *which* resources a payment exhausts never matters in itself. What matters is
 *   that the card about to leave the zone is the one exhausted where there is a choice, which is
 *   what `payCost`'s `prefer` does.
 */

/** Push a choice straight onto a state: these tests exercise the door, not the cards that open it. */
const withChoice = (s: GameState, choice: PendingChoice): GameState => ({ ...s, pendingChoices: [choice] })
const answer = (s: GameState, extra: Record<string, unknown> = {}) =>
  resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, ...extra } as never)

const cards = {
  ...CARDS,
  // A 2-cost upgrade, a 2-cost event and a 3-cost unit, each with one unprovided aspect icon so the
  // penalty is visible. The test player's leader provides Command + Heroism and its base Vigilance.
  RU: card({ id: 'RU', type: 'upgrade', cost: 2, power: 2, hp: 2, aspects: ['Aggression'] }),
  RE: card({ id: 'RE', type: 'event', cost: 2, aspects: ['Aggression'] }),
  RN: card({ id: 'RN', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2, aspects: ['Aggression'] }),
}

describe('payCost: which resources are exhausted (CR 1.7.4)', () => {
  const p = (n: number) => player({ resources: Array.from({ length: n }, (_, i) => ({ cardId: `R${i}`, exhausted: false })) })

  it('exhausts in array order when nothing is preferred, as it always has', () => {
    expect(payCost(p(3), 2).resources).toEqual([
      { cardId: 'R0', exhausted: true }, { cardId: 'R1', exhausted: true }, { cardId: 'R2', exhausted: false },
    ])
  })

  it('exhausts a preferred resource first, so the card about to leave the zone pays for itself', () => {
    // R2 is the card being played: exhausting it costs the player nothing, because it leaves the
    // zone either way. Under CR 1.7.4 the player may always arrange it so.
    expect(payCost(p(3), 2, [2]).resources).toEqual([
      { cardId: 'R0', exhausted: true }, { cardId: 'R1', exhausted: false }, { cardId: 'R2', exhausted: true },
    ])
  })

  it('ignores a preferred resource that is already exhausted and pays from the rest', () => {
    const player3 = player({ resources: [{ cardId: 'R0', exhausted: false }, { cardId: 'R1', exhausted: true }, { cardId: 'R2', exhausted: false }] })
    expect(payCost(player3, 1, [1]).resources.filter(r => !r.exhausted)).toEqual([{ cardId: 'R2', exhausted: false }])
  })
})

describe('playCardFrom: a card in the resource zone pays for itself (CR 6.2.f, CR 14.e)', () => {
  const board = (resources: { cardId: string; exhausted: boolean }[]) => state({
    cards,
    players: {
      player: player({ resources, units: [unit('u1', 'TST_U1')], deck: ['TST_U2'] }),
      opponent: player(),
    },
  })

  /** The general door, opened on the player's own resource zone with no cost help. */
  const playFrom = (s: GameState, candidates: { index: number; cardId: string }[]) =>
    withChoice(s, { kind: 'playCardFrom', id: 'c1', controller: 'player' as PlayerId, zone: 'resources', candidates, optional: true })

  it('offers a unit whose cost equals every ready resource, the unit itself included', () => {
    // RN costs 3 + 2 aspect penalty = 5. Five ready resources, one of which IS the unit.
    const s = playFrom(board([
      { cardId: 'RN', exhausted: false }, { cardId: 'R1', exhausted: false }, { cardId: 'R2', exhausted: false },
      { cardId: 'R3', exhausted: false }, { cardId: 'R4', exhausted: false },
    ]), [{ index: 0, cardId: 'RN' }])
    expect(legalMoves(s).some(m => m.type === 'acceptChoice' && m.optionIndex === 0)).toBe(true)

    const done = answer(s, { optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'RN'), 'the unit is in play').toBe(true)
    // All four that stayed paid; RN paid for itself and left.
    expect(done.players.player.resources).toEqual([
      { cardId: 'R1', exhausted: true }, { cardId: 'R2', exhausted: true },
      { cardId: 'R3', exhausted: true }, { cardId: 'R4', exhausted: true },
    ])
  })

  it('is not offered when the zone cannot cover the cost even with the card counted', () => {
    const s = playFrom(board([
      { cardId: 'RN', exhausted: false }, { cardId: 'R1', exhausted: false }, { cardId: 'R2', exhausted: false },
      { cardId: 'R3', exhausted: true },
    ]), [{ index: 0, cardId: 'RN' }])
    // 3 ready against a cost of 5.
    expect(legalMoves(s).some(m => m.type === 'acceptChoice' && m.optionIndex === 0)).toBe(false)
  })

  it('plays a unit through the one door: it is recorded as played', () => {
    const s = playFrom(board([
      { cardId: 'RN', exhausted: false }, { cardId: 'R1', exhausted: false }, { cardId: 'R2', exhausted: false },
      { cardId: 'R3', exhausted: false }, { cardId: 'R4', exhausted: false },
    ]), [{ index: 0, cardId: 'RN' }])
    expect(cardsPlayedThisPhase(answer(s, { optionIndex: 0 }), 'player')).toContain('RN')
  })

  it('plays an event from the zone: it resolves and reaches the discard pile', () => {
    const s = playFrom(board([
      { cardId: 'RE', exhausted: false }, { cardId: 'R1', exhausted: false },
      { cardId: 'R2', exhausted: false }, { cardId: 'R3', exhausted: false },
    ]), [{ index: 0, cardId: 'RE' }])
    const done = answer(s, { optionIndex: 0 })
    expect(done.players.player.discard).toContain('RE')
    expect(done.players.player.resources.map(r => r.cardId)).toEqual(['R1', 'R2', 'R3'])
    expect(cardsPlayedThisPhase(done, 'player')).toContain('RE')
  })

  it('takes an upgrade to its attach step, and prices it against the host', () => {
    const s = playFrom(board([
      { cardId: 'RU', exhausted: false }, { cardId: 'R1', exhausted: false },
      { cardId: 'R2', exhausted: false }, { cardId: 'R3', exhausted: false },
    ]), [{ index: 0, cardId: 'RU' }])
    const attaching = answer(s, { optionIndex: 0 })
    expect(attaching.pendingChoices?.[0]).toMatchObject({ kind: 'attachPlayedCard', cardId: 'RU', targets: ['u1'] })

    const done = resolve(attaching, { type: 'acceptChoice', choiceId: attaching.pendingChoices![0].id, targetInstanceId: 'u1' })
    expect(done.players.player.units.find(u => u.instanceId === 'u1')!.upgrades.some(a => a.cardId === 'RU')).toBe(true)
    expect(done.players.player.resources.map(r => r.cardId)).toEqual(['R1', 'R2', 'R3'])
  })

  it('may be declined, leaving the zone untouched', () => {
    const s = playFrom(board([{ cardId: 'RN', exhausted: false }, ...Array.from({ length: 4 }, (_, i) => ({ cardId: `R${i + 1}`, exhausted: false }))]), [{ index: 0, cardId: 'RN' }])
    const done = resolve(s, { type: 'skipTrigger', choiceId: 'c1' })
    expect(done.players.player.resources).toHaveLength(5)
    expect(done.players.player.units).toHaveLength(1)
  })
})

describe('playCardFrom: playing free and at a discount', () => {
  const board = () => state({
    cards,
    players: { player: player({ resources: [{ cardId: 'RN', exhausted: false }], deck: ['TST_U2'] }), opponent: player() },
  })

  it('a free play bypasses the cost and the aspect penalty (CR 8.5)', () => {
    const s = withChoice(board(), { kind: 'playCardFrom', id: 'c1', controller: 'player', zone: 'resources', candidates: [{ index: 0, cardId: 'RN' }], free: true })
    const done = answer(s, { optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'RN')).toBe(true)
    expect(done.players.player.resources).toEqual([])
  })
})

describe('effectiveCost: aspect penalties a play waives', () => {
  // The fixture leader provides Command + Heroism, the base Vigilance. RN's Aggression is unprovided.
  const s = state({ cards, players: { player: player(), opponent: player() } })
  const cost = (waive?: Parameters<typeof effectiveCost>[4]) => effectiveCost(s, 'player', cards.RN, undefined, waive)

  it('charges the penalty with no waiver', () => {
    expect(cost()).toBe(5) // 3 + 2
  })

  it('"ignoring its aspect penalties" waives every one', () => {
    expect(cost({ all: true })).toBe(3)
  })

  it('waives only the named icons', () => {
    expect(cost({ aspects: ['Villainy'] })).toBe(5)
    expect(cost({ aspects: ['Aggression'] })).toBe(3)
  })

  it('"ignoring 1 of its … aspect penalties" waives a single penalty', () => {
    const twoIcons = card({ id: 'RR', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, aspects: ['Aggression', 'Cunning'] })
    const two = state({ cards: { ...cards, RR: twoIcons }, players: { player: player(), opponent: player() } })
    expect(effectiveCost(two, 'player', twoIcons)).toBe(5) // 1 + 2 + 2
    expect(effectiveCost(two, 'player', twoIcons, undefined, { aspects: ['Aggression', 'Cunning'], one: true })).toBe(3)
    expect(effectiveCost(two, 'player', twoIcons, undefined, { aspects: ['Aggression', 'Cunning'] })).toBe(1)
  })
})

// ── The cards ──────────────────────────────────────────────────────────────────────────────────
// Printed text and stats come from the shipped set fixtures, so a test cannot pass against a card
// the set does not print.

const POOL = poolFor(['LAW', 'SEC', 'LOF', 'JTL', 'TWI', 'SHD', 'SOR', 'TS26', 'HMW'])
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

describe('Osha (HMW_017) — play a Villainy unit from your resources', () => {
  // A Villainy unit, a Heroism one that is not eligible, and a Heroism unit to have lost.
  const F = {
    ...CARDS,
    HMW_017: real('HMW_017'),
    VIL: card({ id: 'VIL', type: 'unit', arena: 'ground', cost: 2, power: 3, hp: 3, aspects: ['Villainy'] }),
    HERO: card({ id: 'HERO', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, aspects: ['Heroism'] }),
  }
  /** Osha's controller: her leader, a resource zone holding VIL, and a hand to resource from. */
  const board = (over: Parameters<typeof player>[0] = {}, lost = true) => ({
    ...state({
      cards: F,
      players: {
        player: player({
          leader: { cardId: 'HMW_017', deployed: false, epicActionUsed: false, exhausted: false },
          resources: [{ cardId: 'VIL', exhausted: false }, ...ready(4)],
          hand: ['TST_U1'],
          deck: ['TST_U2'],
          ...over,
        }),
        opponent: player(),
      },
    }),
    ...(lost ? { phaseEvents: phaseEvents({ defeated: { player: ['HERO'], opponent: [] } }) } : {}),
  })

  it('front: is offered only once a friendly Heroism unit was defeated this phase', () => {
    expect(legalMoves(board({}, false)).some(m => m.type === 'useLeaderAbility')).toBe(false)
    expect(legalMoves(board()).some(m => m.type === 'useLeaderAbility')).toBe(true)
  })

  it('front: plays the Villainy unit for its cost, ignoring the Villainy penalty, then offers the resourcing', () => {
    const raised = resolve(board(), { type: 'useLeaderAbility', index: 0 })
    expect(raised.pendingChoices?.[0]).toMatchObject({ kind: 'playCardFrom', zone: 'resources', candidates: [{ index: 0, cardId: 'VIL' }] })

    const played = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, optionIndex: 0 })
    expect(played.players.player.units.some(u => u.cardId === 'VIL'), 'the unit is in play').toBe(true)
    // Cost 2 with the Villainy penalty waived (the leader provides neither Cunning nor Heroism to
    // this fixture's zone): VIL paid one of it itself, so exactly one other resource is exhausted.
    expect(played.players.player.resources.filter(r => r.exhausted)).toHaveLength(1)
    expect(played.players.player.resources.map(r => r.cardId)).toEqual(['R0', 'R1', 'R2', 'R3'])

    // "If you do, you may resource a card from your hand."
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayResourceFromHand', controller: 'player' })
    const resourced = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, handIndex: 0 })
    expect(resourced.players.player.hand).toEqual([])
    // CR 1.7.7: a card an ability resources arrives facedown and exhausted.
    expect(resourced.players.player.resources.at(-1)).toEqual({ cardId: 'TST_U1', exhausted: true })
  })

  it('front: the resourcing is a may', () => {
    const raised = resolve(board(), { type: 'useLeaderAbility', index: 0 })
    const played = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, optionIndex: 0 })
    const kept = resolve(played, { type: 'skipTrigger', choiceId: played.pendingChoices![0].id })
    expect(kept.players.player.hand).toEqual(['TST_U1'])
  })

  it('offers only Villainy units, not the other cards in the zone', () => {
    const s = board({ resources: [{ cardId: 'HERO', exhausted: false }, { cardId: 'TST_E1', exhausted: false }, ...ready(4)] })
    expect(legalMoves(s).some(m => m.type === 'useLeaderAbility'), 'nothing Villainy to play').toBe(false)
  })

  it('back: the same play as an Action, with no Heroism-defeat condition', () => {
    const s = {
      ...board({
        leader: { cardId: 'HMW_017', deployed: true, epicActionUsed: false, exhausted: false },
        units: [unit('L', 'HMW_017', { isLeader: true })],
      }, false),
    }
    const use = legalMoves(s).find(m => m.type === 'useAbility')
    expect(use, 'the deployed action is offered with no unit lost').toBeTruthy()
    const raised = resolve(s, use!)
    expect(raised.pendingChoices?.[0]).toMatchObject({ kind: 'playCardFrom', zone: 'resources' })
  })
})

describe('From a Certain Point of View (LAW_264) — play a card from hand, ignoring its aspect penalties', () => {
  const F = {
    ...CARDS,
    LAW_264: real('LAW_264'),
    OFF: card({ id: 'OFF', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, aspects: ['Villainy', 'Aggression'] }),
    OFFUP: card({ id: 'OFFUP', type: 'upgrade', cost: 1, power: 1, hp: 1, aspects: ['Villainy'] }),
  }
  const board = (hand: string[]) => state({
    cards: F,
    players: {
      player: player({ hand: ['LAW_264', ...hand], resources: ready(6), units: [unit('u1', 'TST_U1')] }),
      opponent: player(),
    },
  })

  it('plays a unit from hand with no aspect penalty at all', () => {
    const played = resolve(board(['OFF']), { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'playCardFrom', zone: 'hand', waive: { all: true } })
    const done = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'OFF')).toBe(true)
    // LAW_264 costs 1; OFF costs 2 with both its penalties waived. 6 − 1 − 2 = 3 ready.
    expect(done.players.player.resources.filter(r => !r.exhausted)).toHaveLength(3)
  })

  it('plays an upgrade from hand, which still needs a host', () => {
    const played = resolve(board(['OFFUP']), { type: 'playEvent', handIndex: 0 })
    const attaching = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, optionIndex: 0 })
    expect(attaching.pendingChoices?.[0]).toMatchObject({ kind: 'attachPlayedCard', cardId: 'OFFUP', targets: ['u1'] })
    const done = resolve(attaching, { type: 'acceptChoice', choiceId: attaching.pendingChoices![0].id, targetInstanceId: 'u1' })
    expect(done.players.player.units[0].upgrades.some(a => a.cardId === 'OFFUP')).toBe(true)
  })

  it('plays an event from hand, which resolves', () => {
    const played = resolve(board(['TST_E1']), { type: 'playEvent', handIndex: 0 })
    const done = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.player.discard).toEqual(['LAW_264', 'TST_E1'])
  })
})

describe('Improvise (LAW_242) — look at the top card of your deck, play it for 1 less or discard it', () => {
  const F = { ...CARDS, LAW_242: real('LAW_242'), TOP: card({ id: 'TOP', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2, aspects: [] }) }
  const board = (resources: number) => state({
    cards: F,
    players: {
      player: player({ hand: ['LAW_242'], deck: ['TOP', 'TST_U1'], resources: ready(resources) }),
      opponent: player(),
    },
  })

  it('plays the top card for 1 less', () => {
    const played = resolve(board(6), { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'playCardFrom', zone: 'deckTop', costDelta: -1, optional: true })
    const done = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'TOP')).toBe(true)
    expect(done.players.player.deck, 'the card left the deck').toEqual(['TST_U1'])
    // Improvise costs 1 + 2 for its unprovided Cunning; TOP costs 3 − 1.
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(5)
  })

  it('offers the discard when you decline, and leaves the card on top if you decline that too', () => {
    const played = resolve(board(6), { type: 'playEvent', handIndex: 0 })
    const declined = resolve(played, { type: 'skipTrigger', choiceId: played.pendingChoices![0].id })
    expect(declined.pendingChoices?.[0]).toMatchObject({ kind: 'mayDiscardTop', cardId: 'TOP' })

    const discarded = resolve(declined, { type: 'acceptChoice', choiceId: declined.pendingChoices![0].id })
    expect(discarded.players.player.discard).toContain('TOP')
    expect(discarded.players.player.deck).toEqual(['TST_U1'])

    const kept = resolve(declined, { type: 'skipTrigger', choiceId: declined.pendingChoices![0].id })
    expect(kept.players.player.deck).toEqual(['TOP', 'TST_U1'])
  })

  it('still offers the discard when the top card cannot be paid for', () => {
    // Improvise takes 3 of the 4 resources; TOP then costs 2 against the 1 left.
    const played = resolve(board(4), { type: 'playEvent', handIndex: 0 })
    const play = played.pendingChoices!.find(c => c.kind === 'playCardFrom')!
    expect(legalMoves(played).some(m => m.type === 'acceptChoice' && m.choiceId === play.id), 'nothing to play').toBe(false)
    const declined = resolve(played, { type: 'skipTrigger', choiceId: play.id })
    expect(declined.pendingChoices?.[0], 'the discard is still offered').toMatchObject({ kind: 'mayDiscardTop' })
  })
})

describe("You're My Only Hope (SOR_246) — play the top card for 5 less, or free on a hurt base", () => {
  const F = { ...CARDS, SOR_246: real('SOR_246'), TOP: card({ id: 'TOP', type: 'unit', arena: 'ground', cost: 6, power: 2, hp: 2, aspects: [] }) }
  // TST_B has 30 HP, so `damage` sets what is left.
  const board = (damage: number, resources = 10) => state({
    cards: F,
    players: {
      player: player({ hand: ['SOR_246'], deck: ['TOP'], resources: ready(resources), base: { cardId: 'TST_B', damage } }),
      opponent: player(),
    },
  })

  it('costs 5 less while the base is healthy', () => {
    const played = resolve(board(0), { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'playCardFrom', zone: 'deckTop', costDelta: -5 })
    const done = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.player.resources.filter(r => r.exhausted), '3 for the event + 1 for TOP').toHaveLength(4)
  })

  it('is free once the base has 5 or less remaining HP', () => {
    const played = resolve(board(25), { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'playCardFrom', free: true })
    const done = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'TOP')).toBe(true)
    expect(done.players.player.resources.filter(r => r.exhausted), 'only the event was paid for').toHaveLength(3)
  })
})

describe('Hondo Ohnaka (LAW_094) — Action: play the top card of your deck, once each round', () => {
  const F = { ...CARDS, LAW_094: real('LAW_094'), TOP: card({ id: 'TOP', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, aspects: [] }) }
  const board = (resources: number, deck = ['TOP']) => state({
    cards: F,
    players: {
      player: player({ deck, resources: ready(resources), units: [unit('hondo', 'LAW_094')] }),
      opponent: player(),
    },
  })

  it('plays the top card at its full cost, and only once a round', () => {
    const s = board(4, ['TOP', 'TOP'])
    const raised = resolve(s, legalMoves(s).find(m => m.type === 'useAbility')!)
    expect(raised.pendingChoices?.[0]).toMatchObject({ kind: 'playCardFrom', zone: 'deckTop' })
    const done = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'TOP')).toBe(true)
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(2)
    expect(legalMoves({ ...done, activePlayer: 'player' }).some(m => m.type === 'useAbility'), 'spent for the round').toBe(false)
  })

  it('is not offered when the top card cannot be paid for, or the deck is empty', () => {
    expect(legalMoves(board(1)).some(m => m.type === 'useAbility')).toBe(false)
    expect(legalMoves(board(4, [])).some(m => m.type === 'useAbility')).toBe(false)
  })
})

describe("Tear This Ship Apart (LAW_066) — play a card from an opponent's resources for free", () => {
  const F = { ...CARDS, LAW_066: real('LAW_066'), THEIRS: card({ id: 'THEIRS', type: 'unit', arena: 'ground', cost: 6, power: 4, hp: 4, aspects: ['Villainy'] }) }
  const board = () => state({
    cards: F,
    players: {
      player: player({ hand: ['LAW_066'], resources: ready(13) }),
      opponent: player({ resources: [{ cardId: 'THEIRS', exhausted: false }, ...ready(2)], deck: ['TST_U1', 'TST_U2'] }),
    },
  })

  it('plays the opponent\'s card for free, under your control, and replaces it from their deck', () => {
    const played = resolve(board(), { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'playCardFrom', zone: 'opponentResources', free: true, optional: true })
    const done = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, optionIndex: 0 })

    expect(done.players.player.units.some(u => u.cardId === 'THEIRS'), 'it enters under your control').toBe(true)
    // The event costs 7 + 4 for its unprovided Cunning and Villainy; the unit itself was free.
    expect(done.players.player.resources.filter(r => r.exhausted), 'only the event was paid for').toHaveLength(11)
    // "That opponent resources the top card of their deck" — facedown and exhausted (CR 1.7.7).
    expect(done.players.opponent.resources.map(r => r.cardId)).toEqual(['R0', 'R1', 'TST_U1'])
    expect(done.players.opponent.resources.at(-1)!.exhausted).toBe(true)
    expect(done.players.opponent.deck).toEqual(['TST_U2'])
  })

  it('may be declined, and then nothing is resourced', () => {
    const played = resolve(board(), { type: 'playEvent', handIndex: 0 })
    const done = resolve(played, { type: 'skipTrigger', choiceId: played.pendingChoices![0].id })
    expect(done.players.opponent.resources).toHaveLength(3)
    expect(done.players.opponent.deck).toHaveLength(2)
  })
})

describe('Endless Legions (SHD_109) — play each unit revealed from your resources for free', () => {
  const F = {
    ...CARDS,
    SHD_109: real('SHD_109'),
    A: card({ id: 'A', type: 'unit', arena: 'ground', cost: 6, power: 4, hp: 4, aspects: [] }),
    B: card({ id: 'B', type: 'unit', arena: 'ground', cost: 7, power: 5, hp: 5, aspects: [] }),
  }
  const board = () => state({
    cards: F,
    players: {
      player: player({
        hand: ['SHD_109'],
        // 14 for the event itself, plus the two units and an event that is not a unit.
        resources: [...ready(14), { cardId: 'A', exhausted: false }, { cardId: 'B', exhausted: false }, { cardId: 'TST_E1', exhausted: false }],
      }),
      opponent: player(),
    },
  })

  it('offers only the units, and plays them one at a time until you stop', () => {
    const played = resolve(board(), { type: 'playEvent', handIndex: 0 })
    const first = played.pendingChoices![0]
    expect(first).toMatchObject({ kind: 'playCardFrom', zone: 'resources', free: true, optional: true })
    expect((first as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId)).toEqual(['A', 'B'])

    const one = resolve(played, { type: 'acceptChoice', choiceId: first.id, optionIndex: 0 })
    expect(one.players.player.units.map(u => u.cardId)).toEqual(['A'])
    // Re-offered with the rest, re-indexed against the zone the play just shortened.
    const again = one.pendingChoices!.find(c => c.kind === 'playCardFrom')!
    expect((again as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId)).toEqual(['B'])

    const both = resolve(one, { type: 'acceptChoice', choiceId: again.id, optionIndex: 0 })
    expect(both.players.player.units.map(u => u.cardId)).toEqual(['A', 'B'])
    expect(both.players.player.resources.filter(r => !r.exhausted), 'both played free').toHaveLength(1)
    expect(both.pendingChoices?.some(c => c.kind === 'playCardFrom'), 'nothing left to offer').toBeFalsy()
  })

  it('stops when you decline, leaving the rest as resources', () => {
    const played = resolve(board(), { type: 'playEvent', handIndex: 0 })
    const done = resolve(played, { type: 'skipTrigger', choiceId: played.pendingChoices![0].id })
    expect(done.players.player.units).toEqual([])
    expect(done.players.player.resources.map(r => r.cardId)).toContain('A')
  })
})

describe('A Precarious Predicament (LOF_222) — the return, unless its controller says otherwise', () => {
  const F = { ...CARDS, LOF_222: real('LOF_222'), LOF_264: real('LOF_264') }
  const board = (mine: Parameters<typeof player>[0] = {}) => state({
    cards: F,
    players: {
      player: player({ hand: ['LOF_222', 'LOF_264'], resources: ready(6), ...mine }),
      opponent: player({ units: [unit('e1', 'TST_U1'), unit('boss', 'TST_U1', { isLeader: true })] }),
    },
  })
  /** Play the event and pick the enemy unit, leaving the opponent's answer outstanding. */
  const toTheAnswer = (s = board()) => {
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    return resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, targetInstanceId: 'e1' })
  }

  it('offers only enemy non-leader units', () => {
    const played = resolve(board(), { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'selectUnitThen', targets: ['e1'] })
  })

  it('returns the unit when its controller says nothing', () => {
    const asked = toTheAnswer()
    expect(asked.pendingChoices?.[0]).toMatchObject({ kind: 'mayPayThen', controller: 'opponent' })
    const done = resolve(asked, { type: 'skipTrigger', choiceId: asked.pendingChoices![0].id })
    expect(done.players.opponent.units.map(u => u.instanceId)).toEqual(['boss'])
    expect(done.players.opponent.hand).toContain('TST_U1')
  })

  it('keeps the unit when they say it, and offers It\'s Worse for free from your hand', () => {
    const asked = toTheAnswer()
    const said = resolve(asked, { type: 'acceptChoice', choiceId: asked.pendingChoices![0].id })
    expect(said.players.opponent.units.map(u => u.instanceId), 'the unit stays').toEqual(['e1', 'boss'])
    expect(said.pendingChoices?.[0]).toMatchObject({ kind: 'playCardFrom', zone: 'handOrResources', free: true, optional: true })

    const done = resolve(said, { type: 'acceptChoice', choiceId: said.pendingChoices![0].id, optionIndex: 0 })
    // It's Worse costs 7 and was played for nothing: only the 4 for the Predicament are spent.
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(4)
    expect(done.players.player.discard).toContain('LOF_264')
    expect(done.pendingChoices?.[0], 'and it resolves: defeat a non-leader unit').toMatchObject({ kind: 'selectUnitToDefeat' })
  })

  it("plays It's Worse out of the resource zone as readily as out of hand", () => {
    const asked = toTheAnswer(board({ hand: ['LOF_222'], resources: [...ready(6), { cardId: 'LOF_264', exhausted: true }] }))
    const said = resolve(asked, { type: 'acceptChoice', choiceId: asked.pendingChoices![0].id })
    const offer = said.pendingChoices![0] as { candidates: { cardId: string }[] }
    expect(offer.candidates.map(c => c.cardId)).toEqual(['LOF_264'])
    const done = resolve(said, { type: 'acceptChoice', choiceId: said.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.player.resources.map(r => r.cardId), 'it left the resource zone').not.toContain('LOF_264')
    expect(done.players.player.discard).toContain('LOF_264')
  })

  it('the free play is a may', () => {
    const asked = toTheAnswer()
    const said = resolve(asked, { type: 'acceptChoice', choiceId: asked.pendingChoices![0].id })
    const done = resolve(said, { type: 'skipTrigger', choiceId: said.pendingChoices![0].id })
    expect(done.players.player.hand).toContain('LOF_264')
    expect(done.players.opponent.units).toHaveLength(2)
  })
})

describe('Bib Fortuna (SOR_177) — Action: play an event from your hand for 1 less', () => {
  const F = { ...CARDS, SOR_177: real('SOR_177'), EV: card({ id: 'EV', type: 'event', cost: 3, aspects: [] }) }
  const board = () => state({
    cards: F,
    players: {
      player: player({ hand: ['EV', 'TST_U1'], resources: ready(4), units: [unit('bib', 'SOR_177')] }),
      opponent: player(),
    },
  })

  it('offers only the event, and plays it a resource cheaper', () => {
    const s = board()
    const use = legalMoves(s).find(m => m.type === 'useAbility')
    expect(use, 'the action is offered').toBeTruthy()
    const raised = resolve(s, use!)
    expect(raised.pendingChoices?.[0]).toMatchObject({ kind: 'playCardFrom', zone: 'hand', costDelta: -1 })
    expect((raised.pendingChoices![0] as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId)).toEqual(['EV'])

    const done = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.player.discard).toContain('EV')
    expect(done.players.player.resources.filter(r => r.exhausted)).toHaveLength(2) // 3 − 1
    expect(done.players.player.units.find(u => u.instanceId === 'bib')!.exhausted, 'the [Exhaust] cost').toBe(true)
  })
})

describe('Agent Kallus (LAW_003) — play a card from hand, ignoring its aspect penalties', () => {
  const F = {
    ...CARDS,
    LAW_003: real('LAW_003'),
    PRICEY: card({ id: 'PRICEY', type: 'unit', arena: 'ground', cost: 3, power: 2, hp: 2, aspects: ['Heroism', 'Aggression'] }),
  }
  const board = (over: Parameters<typeof player>[0] = {}) => state({
    cards: F,
    players: {
      player: player({
        leader: { cardId: 'LAW_003', deployed: false, epicActionUsed: false, exhausted: false },
        hand: ['PRICEY'], resources: ready(4), base: { cardId: 'TST_B', damage: 5 }, ...over,
      }),
      opponent: player(),
    },
  })

  it('front: costs 1 to use, then plays the card with no aspect penalty', () => {
    const raised = resolve(board(), { type: 'useLeaderAbility', index: 0 })
    expect(raised.players.player.resources.filter(r => r.exhausted), "the action's C=1").toHaveLength(1)
    const done = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'PRICEY')).toBe(true)
    expect(done.players.player.resources.filter(r => r.exhausted), '1 for the action + 3 for the unit').toHaveLength(4)
  })

  it('front: is not offered when the action plus the cheapest card is unaffordable', () => {
    expect(legalMoves(board({ resources: ready(3) })).some(m => m.type === 'useLeaderAbility')).toBe(false)
    expect(legalMoves(board({ resources: ready(4) })).some(m => m.type === 'useLeaderAbility')).toBe(true)
  })

  // The deployed side's other half, which fires on an ordinary hand play as much as on the action's.
  const deployed = (hand: string[]) => board({
    leader: { cardId: 'LAW_003', deployed: true, epicActionUsed: false, exhausted: false },
    hand, resources: ready(8),
    units: [unit('L', 'LAW_003', { isLeader: true })],
  })

  it('back: heals 2 from your base when you play a Heroism card', () => {
    const done = resolve(deployed(['TST_U2']), { type: 'playUnit', handIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'TST_U2')).toBe(true)
    expect(done.players.player.base.damage, '5 − 2').toBe(3)
  })

  it('back: a card with no Heroism icon heals nothing', () => {
    expect(resolve(deployed(['TST_U1']), { type: 'playUnit', handIndex: 0 }).players.player.base.damage).toBe(5)
  })
})
