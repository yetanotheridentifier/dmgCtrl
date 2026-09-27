import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import { cardsPlayedThisPhase } from '../engine/types'
import type { EngineCard, GameState, PlayerId } from '../engine/types'

/**
 * Smuggle (CR 14, #469): "If this card is a resource, you may play it for its smuggle cost. Replace
 * it with the top card of your deck." An alternate cost, not a discount: the printed bracket
 * ("Smuggle [C=4 Cunning]") replaces both the numeral AND the aspect list checked for the aspect
 * penalty, which can differ from the card's own printed aspects (Hotshot DL-44 Blaster is Aggression
 * but smuggles as Cunning).
 *
 * It is a standing permission read straight off the card, like a `DiscardPlayGrant`'s
 * `playFromDiscard` action, not a raised `playCardFrom` choice: nothing has to play it for you, any
 * resource with the keyword offers it directly. `smuggle` (legalMoves.ts) generates the move,
 * `takeSmuggle` (resolve.ts) resolves it through the existing `playFromZone` door (#468) with an
 * `altCost` term and a `resourceTop` tail, so paying, taking the card out of the zone and handing it
 * to the door for its type is the same code a `playCardFrom` uses.
 */

describe('Smuggle: the alternate cost (framework)', () => {
  const cards = {
    ...CARDS,
    // Smuggle cost 4, Cunning — different from the card's own aspects, so the penalty check has to
    // read the bracket's own list rather than the card's.
    SMU: card({ id: 'SMU', type: 'unit', arena: 'ground', cost: 9, power: 2, hp: 2, aspects: ['Aggression'], smuggle: { cost: 4, aspects: ['Cunning'] } }),
    SMUP: card({ id: 'SMUP', type: 'upgrade', cost: 9, power: 1, hp: 1, aspects: ['Aggression'], smuggle: { cost: 2, aspects: [] } }),
    SME: card({ id: 'SME', type: 'event', cost: 9, aspects: ['Aggression'], smuggle: { cost: 1, aspects: [] } }),
    PLAIN: card({ id: 'PLAIN', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }),
  }
  const board = (resources: { cardId: string; exhausted: boolean }[], over: Parameters<typeof player>[0] = {}) => state({
    cards,
    players: {
      player: player({ resources, deck: ['TST_U2'], ...over }),
      opponent: player(),
    },
  })

  it('is not offered from a resource with no Smuggle bracket', () => {
    const s = board([{ cardId: 'PLAIN', exhausted: false }, ...ready(3)])
    expect(legalMoves(s).some(m => m.type === 'smuggle')).toBe(false)
  })

  it('is offered once the smuggle cost is affordable, the card itself counted (CR 14.e)', () => {
    // Cost 4, no Cunning provided by the fixture leader/base → +2 penalty = 6. Five ready resources
    // including SMU itself.
    const s = board([{ cardId: 'SMU', exhausted: false }, ...ready(5)])
    expect(legalMoves(s).some(m => m.type === 'smuggle' && m.resourceIndex === 0)).toBe(true)
  })

  it('is not offered when even the whole zone cannot cover the smuggle cost', () => {
    const s = board([{ cardId: 'SMU', exhausted: false }, ...ready(4)]) // 5 ready, needs 6
    expect(legalMoves(s).some(m => m.type === 'smuggle')).toBe(false)
  })

  it('checks the aspect penalty against the SMUGGLE bracket, not the card\'s own aspects', () => {
    // Same fixture, but a card whose own aspect (Aggression) IS provided and whose smuggle aspect
    // (Cunning) is not: the penalty still applies, because Smuggle reads its own bracket.
    const provided = card({ id: 'SMU2', type: 'unit', arena: 'ground', cost: 9, power: 2, hp: 2, aspects: ['Command'], smuggle: { cost: 4, aspects: ['Cunning'] } })
    const s = board([{ cardId: 'SMU2', exhausted: false }, ...ready(5)], {})
    const withCard = { ...s, cards: { ...cards, SMU2: provided } }
    // 4 + 2 (Cunning unprovided) = 6, six ready including the card itself.
    expect(legalMoves(withCard).some(m => m.type === 'smuggle')).toBe(true)
    const oneShort = { ...withCard, players: { ...withCard.players, player: { ...withCard.players.player, resources: [{ cardId: 'SMU2', exhausted: false }, ...ready(4)] } } }
    expect(legalMoves(oneShort).some(m => m.type === 'smuggle')).toBe(false)
  })

  it('pays the smuggle cost, the card itself among the ready resources, then replaces it with the top of the deck', () => {
    const s = board([{ cardId: 'SMU', exhausted: false }, ...ready(5)])
    const move = legalMoves(s).find(m => m.type === 'smuggle')!
    const done = resolve(s, move)
    expect(done.players.player.units.some(u => u.cardId === 'SMU')).toBe(true)
    // Cost 6 (4 + 2 Cunning penalty): SMU pays one of it itself, 5 others exhausted — all 6 ready
    // resources spent, but the zone is the same size once the replacement takes SMU's place.
    expect(done.players.player.resources.filter(r => !r.exhausted)).toHaveLength(0)
    expect(done.players.player.resources).toHaveLength(6)
    // The replacement is facedown and exhausted (CR 1.7.7), on TOP of what stayed.
    expect(done.players.player.resources.at(-1)).toEqual({ cardId: 'TST_U2', exhausted: true })
    expect(done.players.player.deck).toEqual([])
  })

  it('records the play as played this phase, exactly like any other play', () => {
    const s = board([{ cardId: 'SMU', exhausted: false }, ...ready(5)])
    const move = legalMoves(s).find(m => m.type === 'smuggle')!
    const done = resolve(s, move)
    expect(cardsPlayedThisPhase(done, 'player')).toContain('SMU')
  })

  it('an upgrade goes to the attach step, priced against the host, and replaces the resource all the same', () => {
    const s = board([{ cardId: 'SMUP', exhausted: false }, ...ready(2)], { units: [unit('u1', 'TST_U1')] })
    const move = legalMoves(s).find(m => m.type === 'smuggle')!
    expect(move).toMatchObject({ targetInstanceId: 'u1' })
    const done = resolve(s, move)
    expect(done.players.player.units.find(u => u.instanceId === 'u1')!.upgrades.some(a => a.cardId === 'SMUP')).toBe(true)
    // Cost 2, no aspects to penalise: SMUP pays for itself and one other resource, leaving the third
    // (of the original three) ready.
    expect(done.players.player.resources.filter(r => !r.exhausted)).toHaveLength(1)
    expect(done.players.player.resources.at(-1)).toEqual({ cardId: 'TST_U2', exhausted: true })
  })

  it('an event resolves and reaches the discard pile, and still replaces the resource', () => {
    const s = board([{ cardId: 'SME', exhausted: false }, ...ready(1)])
    const move = legalMoves(s).find(m => m.type === 'smuggle')!
    const done = resolve(s, move)
    expect(done.players.player.discard).toContain('SME')
    expect(done.players.player.resources.at(-1)).toEqual({ cardId: 'TST_U2', exhausted: true })
  })
})

// ── The cards ──────────────────────────────────────────────────────────────────────────────────
// Printed text and stats come from the shipped SHD fixture, so a test cannot pass against text the
// set does not print.

const POOL = poolFor(['SHD'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the SHD fixture`)
  return normaliseCard(row)
}

/** Push the resource at index 0 straight into play via Smuggle, however many other ready resources it takes. */
const smuggleFromP0 = (s: GameState, extraReady: number, targetInstanceId?: string) => {
  const withZone = {
    ...s,
    players: { ...s.players, player: { ...s.players.player, resources: [s.players.player.resources[0], ...ready(extraReady)] } },
  }
  const move = legalMoves(withZone).find(m => m.type === 'smuggle')
  if (!move) throw new Error('Smuggle was not offered')
  return resolve(withZone, targetInstanceId ? { ...move, targetInstanceId } : move)
}

describe('Cassian Andor (SHD_148) — When played using Smuggle: Ready this unit', () => {
  const F = { ...CARDS, SHD_148: real('SHD_148') }
  const board = (over: Parameters<typeof player>[0] = {}) => state({ cards: F, players: { player: player({ deck: ['TST_U2'], ...over }), opponent: player() } })

  it('readies itself when played via Smuggle', () => {
    const s = board({ resources: [{ cardId: 'SHD_148', exhausted: false }] })
    const done = smuggleFromP0(s, 12)
    expect(done.players.player.units.find(u => u.cardId === 'SHD_148')!.exhausted).toBe(false)
  })

  it('does not ready itself when played the ordinary way, from hand', () => {
    const s = board({ hand: ['SHD_148'], resources: ready(12) })
    const done = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(done.players.player.units.find(u => u.cardId === 'SHD_148')!.exhausted).toBe(true)
  })
})

describe('Hotshot DL-44 Blaster (SHD_174) — When played using Smuggle: Attack with attached unit', () => {
  const F = { ...CARDS, SHD_174: real('SHD_174') }
  const board = () => state({
    cards: F,
    players: {
      player: player({ resources: [{ cardId: 'SHD_174', exhausted: false }, ...ready(12)], deck: ['TST_U2'], units: [unit('u1', 'TST_U1')] }),
      opponent: player({ units: [unit('e1', 'TST_U1')] }),
    },
  })

  it('offers an attack with the host when smuggled onto it', () => {
    const done = smuggleFromP0(board(), 12, 'u1')
    expect(done.pendingChoices?.[0]).toMatchObject({ kind: 'mayAttack', unitId: 'u1' })
  })

  it('does not offer an attack when played the ordinary way, from hand', () => {
    const s = { ...board(), players: { ...board().players, player: { ...board().players.player, hand: ['SHD_174'], resources: ready(12) } } }
    const done = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'u1' })
    expect(done.pendingChoices?.some(c => c.kind === 'mayAttack')).toBeFalsy()
  })
})

describe('Privateer Crew (SHD_113) — When played using Smuggle: Give 3 Experience tokens to this unit', () => {
  const F = { ...CARDS, SHD_113: real('SHD_113') }
  const board = () => state({ cards: F, players: { player: player({ resources: [{ cardId: 'SHD_113', exhausted: false }, ...ready(12)], deck: ['TST_U2'] }), opponent: player() } })

  it('gives 3 Experience tokens when smuggled', () => {
    const done = smuggleFromP0(board(), 12)
    const played = done.players.player.units.find(u => u.cardId === 'SHD_113')!
    expect(played.upgrades.filter(a => a.cardId === 'TOKEN_EXPERIENCE')).toHaveLength(3)
  })

  it('gives nothing when played the ordinary way, from hand', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['SHD_113'], resources: ready(12) }), opponent: player() } })
    const done = resolve(s, { type: 'playUnit', handIndex: 0 })
    const played = done.players.player.units.find(u => u.cardId === 'SHD_113')!
    expect(played.upgrades).toHaveLength(0)
  })
})

describe("L3-37 (SHD_197) — When Played: rescue a captured card, else give a Shield token", () => {
  const F = { ...CARDS, SHD_197: real('SHD_197'), GUARD: card({ id: 'GUARD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }) }
  const board = (over: Parameters<typeof player>[0] = {}) => state({ cards: F, players: { player: player({ hand: ['SHD_197'], resources: ready(10), ...over }), opponent: player() } })

  it('gives a Shield token when nothing is captured anywhere', () => {
    const done = resolve(board(), { type: 'playUnit', handIndex: 0 })
    const played = done.players.player.units.find(u => u.cardId === 'SHD_197')!
    expect(played.upgrades.some(a => a.cardId === 'TOKEN_SHIELD')).toBe(true)
  })

  it('rescues a captured card instead, when offered one', () => {
    const s = board({ units: [unit('guard', 'GUARD', { captured: [{ cardId: 'TST_U1', owner: 'opponent' as PlayerId }] })] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'selectCardThen', candidates: ['TST_U1'] })
    const done = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.opponent.units.some(u => u.cardId === 'TST_U1')).toBe(true)
    expect(done.players.player.units.find(u => u.instanceId === 'guard')!.captured).toEqual([])
    const l337 = done.players.player.units.find(u => u.cardId === 'SHD_197')!
    expect(l337.upgrades.some(a => a.cardId === 'TOKEN_SHIELD'), 'no shield when it rescued instead').toBe(false)
  })

  it('the rescue is a may: declining still gives the Shield token', () => {
    const s = board({ units: [unit('guard', 'GUARD', { captured: [{ cardId: 'TST_U1', owner: 'opponent' as PlayerId }] })] })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const done = resolve(played, { type: 'skipTrigger', choiceId: played.pendingChoices![0].id })
    expect(done.players.player.units.find(u => u.cardId === 'SHD_197')!.upgrades.some(a => a.cardId === 'TOKEN_SHIELD')).toBe(true)
    expect(done.players.opponent.units.some(u => u.cardId === 'TST_U1')).toBe(false)
  })
})

describe('Enterprising Lackeys (SHD_107) — When Defeated: may defeat a friendly resource, then resource itself', () => {
  const F = { ...CARDS, SHD_107: real('SHD_107') }
  const board = () => state({
    cards: F,
    players: { player: player({ units: [unit('u1', 'SHD_107')], resources: [{ cardId: 'TST_U2', exhausted: false }] }), opponent: player() },
  })
  /** Defeat u1 directly, the way any other "may defeat a unit" ability does, to exercise the When
   *  Defeated ability itself without needing a full combat sequence. */
  const defeatU1 = (s: GameState) =>
    resolve({ ...s, pendingChoices: [{ kind: 'selectUnitToDefeat', id: 'c', controller: 'player', targets: ['u1'] }] },
      { type: 'acceptChoice', choiceId: 'c', targetInstanceId: 'u1' })

  it('offers to defeat a friendly resource once it is defeated', () => {
    const done = defeatU1(board())
    expect(done.pendingChoices?.[0]).toMatchObject({ kind: 'selectCardThen', candidates: ['TST_U2'] })
  })

  it('defeats the chosen resource and puts itself into play as a resource, when it does', () => {
    const raised = defeatU1(board())
    const done = resolve(raised, { type: 'acceptChoice', choiceId: raised.pendingChoices![0].id, optionIndex: 0 })
    expect(done.players.player.resources.map(r => r.cardId)).not.toContain('TST_U2')
    expect(done.players.player.resources.map(r => r.cardId)).toContain('SHD_107')
    expect(done.players.player.units.some(u => u.cardId === 'SHD_107'), 'the unit itself is gone').toBe(false)
  })

  it('is a may: declining leaves the resource zone and the discard pile untouched', () => {
    const raised = defeatU1(board())
    const done = resolve(raised, { type: 'skipTrigger', choiceId: raised.pendingChoices![0].id })
    expect(done.players.player.resources.map(r => r.cardId)).toEqual(['TST_U2'])
    expect(done.players.player.discard).toContain('SHD_107')
  })
})

describe("Tobias Beckett (SHD_217, cost 4) — When you play a non-unit card: may exhaust a unit costing the same or less, once each round", () => {
  const F = {
    ...CARDS, SHD_217: real('SHD_217'),
    CHEAP: card({ id: 'CHEAP', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1 }),
    PRICEY: card({ id: 'PRICEY', type: 'unit', arena: 'ground', cost: 5, power: 1, hp: 1 }),
    EV: card({ id: 'EV', type: 'event', cost: 1, aspects: [] }),
  }
  const board = (over: Parameters<typeof player>[0] = {}) => state({
    cards: F,
    players: {
      player: player({ units: [unit('tobias', 'SHD_217'), unit('cheap', 'CHEAP'), unit('pricey', 'PRICEY')], hand: ['EV'], resources: ready(6), ...over }),
      opponent: player(),
    },
  })

  it('offers to exhaust a unit costing the same as or less than the card played, and no pricier one', () => {
    const played = resolve(board(), { type: 'playEvent', handIndex: 0 })
    // EV costs 1: CHEAP (1) qualifies, Tobias himself (4) and PRICEY (5) do not.
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustUnit', targets: ['cheap'] })
  })

  it('is not offered again once used this round', () => {
    const marked = {
      ...board(),
      players: {
        ...board().players,
        player: { ...board().players.player, units: board().players.player.units.map(u => (u.cardId === 'SHD_217' ? { ...u, usedAbilities: ['SHD_217#round'] } : u)) },
      },
    }
    const played = resolve(marked, { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices?.some(c => c.kind === 'mayExhaustUnit')).toBeFalsy()
  })

  it('is not offered for a unit card', () => {
    const s = board({ hand: ['TST_U1'], resources: ready(6) })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.some(c => c.kind === 'mayExhaustUnit')).toBeFalsy()
  })
})

describe('Plain Smuggle cards need no registration beyond the keyword itself', () => {
  const ids = ['SHD_111', 'SHD_149', 'SHD_089', 'SHD_065', 'SHD_119']
  const F = Object.fromEntries(ids.map(id => [id, real(id)]))

  it.each(ids)('%s smuggles for its printed cost', id => {
    const smuggle = F[id].smuggle!
    expect(smuggle).toBeTruthy()
    const s = state({
      cards: { ...CARDS, ...F },
      players: { player: player({ resources: [{ cardId: id, exhausted: false }, ...ready(20)], deck: ['TST_U2'] }), opponent: player() },
    })
    expect(legalMoves(s).some(m => m.type === 'smuggle')).toBe(true)
  })
})
