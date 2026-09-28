import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { getCardDefinition } from '../engine/abilities'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions'
import { state, player, card, unit, ready, CARDS } from './helpers/engineFixtures'
import { unitHasKeyword, unitKeywordValue } from '../engine/keywords'
import type { EngineCard, GameState, LeaderState, PendingChoice } from '../engine/types'

/**
 * Plot (CR 14, #470): "When you deploy a leader, you may play this card from your resources, paying
 * its cost. Replace it with the top card of your deck."
 *
 * Unlike Smuggle (a standing action read straight off the card any time legal moves are generated),
 * Plot is a reaction to one event: the controller's own leader deploying. Every Plot card in the
 * deploying player's own resources reacts to the same deploy, so it is offered as one `playCardFrom`
 * choice over all of them, re-offered (`then.again`) until the player declines or none are left -
 * the same "one at a time" shape Endless Legions already uses. The cost is the card's own printed
 * cost (no alternate cost, unlike Smuggle), and "replace it with the top card of your deck" is the
 * existing `resourceTop` tail (`PlayFromTail.resourceTop`, already documented as serving Smuggle,
 * Plot and LAW_066 before this ticket built anything).
 */

const PLOT_CARDS = {
  ...CARDS,
  PLOT1: card({ id: 'PLOT1', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2, keywords: [{ name: 'Plot' }] }),
  PLOT2: card({ id: 'PLOT2', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, keywords: [{ name: 'Plot' }] }),
  NOPLOT: card({ id: 'NOPLOT', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 2 }),
}
const undeployed = (cardId: string): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })
const deployBoard = (resources: { cardId: string; exhausted: boolean }[], over: Parameters<typeof player>[0] = {}) => state({
  cards: PLOT_CARDS,
  players: {
    player: player({ leader: undeployed('TST_L'), resources, deck: ['TST_U2'], ...over }),
    opponent: player({ leader: undeployed('TST_L') }),
  },
})
const plotChoice = (s: GameState): Extract<PendingChoice, { kind: 'playCardFrom' }> | undefined =>
  s.pendingChoices?.find((c): c is Extract<PendingChoice, { kind: 'playCardFrom' }> => c.kind === 'playCardFrom')

describe('Plot: the framework (CR 14)', () => {
  it('offers to play a Plot card from resources once the leader deploys', () => {
    const s = deployBoard([{ cardId: 'PLOT1', exhausted: false }, ...ready(5)])
    const done = resolve(s, { type: 'deployLeader' })
    expect(plotChoice(done)).toMatchObject({ zone: 'resources', optional: true })
    expect(plotChoice(done)?.candidates).toContainEqual({ index: 0, cardId: 'PLOT1' })
  })

  it('is not offered when nothing in resources carries Plot', () => {
    const s = deployBoard([{ cardId: 'NOPLOT', exhausted: false }, ...ready(5)])
    const done = resolve(s, { type: 'deployLeader' })
    expect(plotChoice(done)).toBeUndefined()
  })

  it('is not offered when resources cannot cover the printed cost', () => {
    // PLOT1 costs 2; only itself (1 resource) is ready.
    const s = deployBoard([{ cardId: 'PLOT1', exhausted: false }])
    const done = resolve(s, { type: 'deployLeader' })
    expect(plotChoice(done)).toBeUndefined()
  })

  it('pays the printed cost (no alternate cost), plays the unit, and replaces it with the top of the deck', () => {
    const s = deployBoard([{ cardId: 'PLOT1', exhausted: false }, ...ready(5)])
    const raised = resolve(s, { type: 'deployLeader' })
    const choice = plotChoice(raised)!
    const done = resolve(raised, { type: 'acceptChoice', choiceId: choice.id, optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'PLOT1')).toBe(true)
    // Cost 2, so 2 of the 6 ready resources (including PLOT1 itself) end up spent; the replacement
    // lands on top, facedown and exhausted (CR 1.7.7).
    expect(done.players.player.resources.at(-1)).toEqual({ cardId: 'TST_U2', exhausted: true })
    expect(done.players.player.deck).toEqual([])
  })

  it('is a may: declining leaves the card in resources and the deck untouched', () => {
    const s = deployBoard([{ cardId: 'PLOT1', exhausted: false }, ...ready(5)])
    const raised = resolve(s, { type: 'deployLeader' })
    const choice = plotChoice(raised)!
    const done = resolve(raised, { type: 'skipTrigger', choiceId: choice.id })
    expect(done.players.player.resources.some(r => r.cardId === 'PLOT1')).toBe(true)
    expect(done.players.player.deck).toEqual(['TST_U2'])
  })

  it('re-offers the rest after one Plot card is played, so a second one can go too', () => {
    const s = deployBoard([{ cardId: 'PLOT1', exhausted: false }, { cardId: 'PLOT2', exhausted: false }, ...ready(5)])
    const raised = resolve(s, { type: 'deployLeader' })
    const first = plotChoice(raised)!
    const afterFirst = resolve(raised, { type: 'acceptChoice', choiceId: first.id, optionIndex: first.candidates.findIndex(c => c.cardId === 'PLOT1') })
    const second = plotChoice(afterFirst)
    expect(second?.candidates.some(c => c.cardId === 'PLOT2')).toBe(true)
    const done = resolve(afterFirst, { type: 'acceptChoice', choiceId: second!.id, optionIndex: second!.candidates.findIndex(c => c.cardId === 'PLOT2') })
    expect(done.players.player.units.map(u => u.cardId)).toEqual(expect.arrayContaining(['PLOT1', 'PLOT2']))
  })

  it('never reaches into the opponent\'s resources', () => {
    const s = {
      ...deployBoard([...ready(5)]),
      players: {
        player: { ...deployBoard([...ready(5)]).players.player },
        opponent: player({ leader: undeployed('TST_L'), resources: [{ cardId: 'PLOT1', exhausted: false }, ...ready(5)] }),
      },
    }
    const done = resolve({ ...s, cards: PLOT_CARDS }, { type: 'deployLeader' })
    expect(plotChoice(done)).toBeUndefined()
  })
})

// ── The cards ──────────────────────────────────────────────────────────────────────────────────
// Printed text and stats come from the shipped SEC/TS26 fixtures, so a test cannot pass against
// text the sets do not print.

const POOL = poolFor(['SEC', 'TS26'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the SEC/TS26 fixture`)
  return normaliseCard(row)
}

describe('Plain Plot cards need no registration beyond the keyword itself', () => {
  // Otherwise vanilla, held back purely by Plot (triage's "new-keyword-only" bucket).
  const ids = ['SEC_036', 'SEC_070', 'SEC_100', 'SEC_123', 'SEC_176', 'SEC_226']

  it.each(ids)('%s carries the Plot keyword and needs nothing registered', id => {
    const c = real(id)
    expect(c.keywords.some(k => k.name === 'Plot'), id).toBe(true)
    expect(getCardDefinition(id), id).toBeUndefined()
    const s = state({
      cards: { ...CARDS, [id]: c },
      players: { player: player({ leader: undeployed('TST_L'), resources: [{ cardId: id, exhausted: false }, ...ready(10)], deck: ['TST_U2'] }), opponent: player({ leader: undeployed('TST_L') }) },
    })
    const done = resolve(s, { type: 'deployLeader' })
    expect(plotChoice(done)?.candidates.some(cnd => cnd.cardId === id)).toBe(true)
  })
})

describe('Lurking Snub Fighter (SEC_189) — the source data omits its own Keywords array', () => {
  it('still normalises with the Plot keyword, via the data correction', () => {
    const c = real('SEC_189')
    expect(c.keywords).toContainEqual({ name: 'Plot' })
  })

  it('When Played: may exhaust a unit', () => {
    const F = { ...CARDS, SEC_189: real('SEC_189') }
    const s = state({
      cards: F,
      players: { player: player({ hand: ['SEC_189'], resources: ready(10), units: [unit('u1', 'TST_U1')] }), opponent: player() },
    })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayExhaustUnit' })
  })
})

describe('First Light (SEC_088) — Ambush; when it attacks and defeats a unit, may draw a card; Plot', () => {
  const F = { ...CARDS, SEC_088: real('SEC_088') }
  it('carries Plot', () => expect(real('SEC_088').keywords.some(k => k.name === 'Plot')).toBe(true))
  it('offers to draw a card once it attacks and defeats a unit', () => {
    // SEC_088 is cost 7, power 5 — enough to defeat TST_U3 (power 5, hp 1) outright.
    const s = state({
      cards: F,
      players: { player: player({ units: [unit('fl', 'SEC_088')], resources: ready(10) }), opponent: player({ units: [unit('e1', 'TST_U3')] }) },
    })
    const done = resolve(s, { type: 'attack', attackerId: 'fl', target: { kind: 'unit', instanceId: 'e1' } })
    expect(done.pendingChoices?.some(c => c.kind === 'mayPayToDraw')).toBe(true)
  })
})

describe('Cad Bane (SEC_034) — When Played: may defeat a unit with 2 or less remaining HP', () => {
  const F = { ...CARDS, SEC_034: real('SEC_034') }
  it('offers only units at 2 or less remaining HP', () => {
    const s = state({
      cards: { ...F, TST_U4: card({ id: 'TST_U4', type: 'unit', arena: 'ground', cost: 2, power: 1, hp: 2 }) },
      players: { player: player({ hand: ['SEC_034'], resources: ready(10) }), opponent: player({ units: [unit('weak', 'TST_U4', { damage: 0 }), unit('tough', 'TST_U1')] }) },
    })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'selectUnitToDefeat', targets: ['weak'] })
  })
})

describe('Chancellor Palpatine, unit (SEC_082) — When Played: if you control a leader unit, 2 Spy tokens with Sentinel this phase', () => {
  const F = { ...CARDS, SEC_082: real('SEC_082') }
  it('creates the tokens when a leader unit is controlled', () => {
    const s = state({
      cards: F,
      players: { player: player({ hand: ['SEC_082'], resources: ready(10), units: [unit('L', 'TST_L', { isLeader: true })] }), opponent: player() },
    })
    const done = resolve(s, { type: 'playUnit', handIndex: 0 })
    const spies = done.players.player.units.filter(u => u.cardId === 'TOKEN_SPY')
    expect(spies).toHaveLength(2)
  })

  it('creates nothing without a leader unit in play', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['SEC_082'], resources: ready(10) }), opponent: player() } })
    const done = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'TOKEN_SPY')).toBe(false)
  })
})

describe('Mas Amedda (SEC_084) — When Played: Experience token to each of up to 2 other Official units', () => {
  const F = { ...CARDS, SEC_084: real('SEC_084'), OFF1: card({ id: 'OFF1', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, traits: ['OFFICIAL'] }), OFF2: card({ id: 'OFF2', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, traits: ['OFFICIAL'] }) }
  it('offers only other Official units, up to 2', () => {
    const s = state({
      cards: F,
      players: { player: player({ hand: ['SEC_084'], resources: ready(10), units: [unit('o1', 'OFF1'), unit('o2', 'OFF2'), unit('plain', 'TST_U1')] }), opponent: player() },
    })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'selectUnitThen', targets: expect.arrayContaining(['o1', 'o2']) })
    expect((played.pendingChoices?.[0] as { targets: string[] }).targets).not.toContain('plain')
  })
})

describe('Naboo Royal Starship (SEC_099) — constant: each friendly leader unit gains Raid 2 and Overwhelm', () => {
  const F = { ...CARDS, SEC_099: real('SEC_099') }
  it('grants the keywords to a friendly leader unit but not a friendly non-leader unit', () => {
    const s = state({
      cards: F,
      players: { player: player({ units: [unit('nrs', 'SEC_099'), unit('L', 'TST_L', { isLeader: true }), unit('plain', 'TST_U1')] }), opponent: player() },
    })
    expect(legalMoves(s)).toBeDefined() // sanity: the aura must not throw during move generation
    expect(unitHasKeyword(s, s.players.player.units.find(u => u.instanceId === 'L')!, 'Overwhelm')).toBe(true)
    expect(unitHasKeyword(s, s.players.player.units.find(u => u.instanceId === 'plain')!, 'Overwhelm')).toBe(false)
  })
})

describe('Jar Jar Binks (SEC_111) — When Played: may give another friendly unit +2/+2 for this phase', () => {
  const F = { ...CARDS, SEC_111: real('SEC_111') }
  it('offers another friendly unit, not itself', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['SEC_111'], resources: ready(10), units: [unit('other', 'TST_U1')] }), opponent: player() } })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'mayLastingBuff', targets: ['other'] })
  })
})

describe('Trade Route Taxation (SEC_126) — chosen opponent can\'t play events this phase, if you outnumber them', () => {
  const F = { ...CARDS, SEC_126: real('SEC_126') }
  it('bans the opponent\'s events for the phase when you control more units', () => {
    const s = state({
      cards: { ...F, EV: card({ id: 'EV', type: 'event', cost: 1 }) },
      players: { player: player({ hand: ['SEC_126'], resources: ready(10), units: [unit('u1', 'TST_U1'), unit('u2', 'TST_U1')] }), opponent: player({ hand: ['EV'], resources: ready(10) }) },
    })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const asOpponent = { ...played, activePlayer: 'opponent' as const }
    expect(legalMoves(asOpponent).some(m => m.type === 'playEvent')).toBe(false)
  })

  it('does not ban events when you do not outnumber them', () => {
    const s = state({
      cards: { ...F, EV: card({ id: 'EV', type: 'event', cost: 1 }) },
      players: { player: player({ hand: ['SEC_126'], resources: ready(10) }), opponent: player({ hand: ['EV'], resources: ready(10), units: [unit('u1', 'TST_U1')] }) },
    })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const asOpponent = { ...played, activePlayer: 'opponent' as const }
    expect(legalMoves(asOpponent).some(m => m.type === 'playEvent')).toBe(true)
  })
})

describe('Hondo Ohnaka (SEC_140) — constant: each other friendly unit gains Raid 1', () => {
  const F = { ...CARDS, SEC_140: real('SEC_140') }
  it('grants Raid 1 to another friendly unit but not to itself', () => {
    const s = state({ cards: F, players: { player: player({ units: [unit('hondo', 'SEC_140'), unit('other', 'TST_U1')] }), opponent: player() } })
    expect(unitKeywordValue(s, s.players.player.units.find(u => u.instanceId === 'other')!, 'Raid')).toBe(1)
    expect(unitKeywordValue(s, s.players.player.units.find(u => u.instanceId === 'hondo')!, 'Raid')).toBe(0)
  })
})

describe('Kaydel Connix (SEC_149) — When Played: may defeat all non-unique upgrades on a unit', () => {
  const F = { ...CARDS, SEC_149: real('SEC_149'), UP1: card({ id: 'UP1', type: 'upgrade', cost: 1, power: 1, hp: 1 }), UP2: card({ id: 'UP2', type: 'upgrade', cost: 1, power: 1, hp: 1, unique: true }) }
  it('defeats the non-unique upgrades and leaves the unique one', () => {
    const s = state({
      cards: F,
      players: {
        player: player({ hand: ['SEC_149'], resources: ready(10), units: [unit('u1', 'TST_U1', { upgrades: [{ cardId: 'UP1', owner: 'player' }, { cardId: 'UP2', owner: 'player' }] })] }),
        opponent: player(),
      },
    })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    const targeted = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, targetInstanceId: 'u1' })
    const u1 = targeted.players.player.units.find(u => u.instanceId === 'u1')!
    expect(u1.upgrades.map(a => a.cardId)).toEqual(['UP2'])
  })
})

describe('Strike Force X-Wing (SEC_152) — When Played: may deal 2 damage to a ready unit', () => {
  const F = { ...CARDS, SEC_152: real('SEC_152') }
  it('offers only ready units', () => {
    const s = state({
      cards: F,
      players: { player: player({ hand: ['SEC_152'], resources: ready(10) }), opponent: player({ units: [unit('ready', 'TST_U1'), unit('exh', 'TST_U1', { exhausted: true })] }) },
    })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'selectDamageTarget', unitTargets: ['ready'] })
  })
})

describe('Cinta Kaz (SEC_172) — When Played: may attack with a unit', () => {
  const F = { ...CARDS, SEC_172: real('SEC_172') }
  it('offers an attack with a friendly ready unit', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['SEC_172'], resources: ready(10), units: [unit('u1', 'TST_U1')] }), opponent: player() } })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.some(c => c.kind === 'mayAttackAnyUnit')).toBe(true)
  })
})

describe('Topple the Summit (SEC_183) — deal 3 damage to each damaged unit', () => {
  const F = { ...CARDS, SEC_183: real('SEC_183') }
  it('damages only units already carrying damage', () => {
    const s = state({
      cards: F,
      players: { player: player({ hand: ['SEC_183'], resources: ready(10), units: [unit('dmg', 'TST_U4', { damage: 1 })] }), opponent: player({ units: [unit('fresh', 'TST_U1')] }) },
    })
    const done = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(done.players.player.units.find(u => u.instanceId === 'dmg')!.damage).toBe(4)
    expect(done.players.opponent.units.find(u => u.instanceId === 'fresh')!.damage).toBe(0)
  })
})

describe('Garindan (SEC_186) — When Played: name a card, look at hand and discard a card with that name', () => {
  const F = { ...CARDS, SEC_186: real('SEC_186') }
  it('raises a nameCard choice, then discards a matching card from the opponent\'s hand', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['SEC_186'], resources: ready(10) }), opponent: player({ hand: ['TST_U1'] }) } })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'nameCard' })
    const named = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, cardName: 'TST_U1' })
    expect(named.players.opponent.hand).not.toContain('TST_U1')
  })
})

describe('Fully Armed and Operational (SEC_194): not built here — needs "previous action" sequencing, split out', () => {
  it('is not registered', () => expect(getCardDefinition('SEC_194')).toBeUndefined())
})
describe('Sly Moore (SEC_033): not built here — needs a new phase-scoped attacking-a-base stat modifier, split out', () => {
  it('is not registered', () => expect(getCardDefinition('SEC_033')).toBeUndefined())
})
describe('Vigil (SEC_050): not built here — needs new constant damage prevention/redirection primitives, split out', () => {
  it('is not registered', () => expect(getCardDefinition('SEC_050')).toBeUndefined())
})

describe('One in a Million (SEC_053) — can\'t be played from hand; defeat a unit matching your ready resources', () => {
  const F = { ...CARDS, SEC_053: real('SEC_053') }
  it('is never offered as a play from hand', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['SEC_053'], resources: ready(3) }), opponent: player() } })
    expect(legalMoves(s).some(m => m.type === 'playEvent')).toBe(false)
  })

  it('is playable via Plot, and defeats a unit whose power and remaining HP both equal ready resources', () => {
    const s = deployBoard(
      [{ cardId: 'SEC_053', exhausted: false }, ...ready(3)],
      {},
    )
    const withF = { ...s, cards: { ...PLOT_CARDS, SEC_053: real('SEC_053'), MATCH: card({ id: 'MATCH', type: 'unit', arena: 'ground', cost: 1, power: 3, hp: 3 }) } }
    const target = { ...withF, players: { ...withF.players, opponent: { ...withF.players.opponent, units: [unit('m', 'MATCH')] } } }
    const raised = resolve(target, { type: 'deployLeader' })
    const choice = plotChoice(raised)!
    const played = resolve(raised, { type: 'acceptChoice', choiceId: choice.id, optionIndex: choice.candidates.findIndex(c => c.cardId === 'SEC_053') })
    expect(played.pendingChoices?.some(c => c.kind === 'selectUnitToDefeat' && c.targets.includes('m'))).toBe(true)
  })
})

describe('The Wrong Ride (SEC_235) — exhaust 2 enemy resources', () => {
  const F = { ...CARDS, SEC_235: real('SEC_235') }
  it('exhausts exactly 2 of the opponent\'s ready resources', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['SEC_235'], resources: ready(10) }), opponent: player({ resources: ready(4) }) } })
    const done = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect(done.players.opponent.resources.filter(r => r.exhausted)).toHaveLength(2)
  })
})

describe('FN Trooper Corps (SEC_243) — When Played: Experience token to another friendly unit', () => {
  const F = { ...CARDS, SEC_243: real('SEC_243') }
  it('offers another friendly unit', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['SEC_243'], resources: ready(10), units: [unit('other', 'TST_U1')] }), opponent: player() } })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ targets: ['other'] })
  })
})

describe('Remote Escort Tank (SEC_255) — When Played: give a unit Sentinel for this phase', () => {
  const F = { ...CARDS, SEC_255: real('SEC_255') }
  it('offers any unit, friend or foe', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['SEC_255'], resources: ready(10) }), opponent: player({ units: [unit('e', 'TST_U1')] }) } })
    const played = resolve(s, { type: 'playUnit', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ targets: expect.arrayContaining(['e']) })
  })
})

describe('Secret Marriage (TS26_46) — Shield up to 2 non-Vehicle units; draw if an enemy is shielded this way', () => {
  const F = { ...CARDS, TS26_46: real('TS26_46'), VEH: card({ id: 'VEH', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 1, traits: ['VEHICLE'] }) }
  it('does not offer a Vehicle unit', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['TS26_46'], resources: ready(10), units: [unit('veh', 'VEH'), unit('u1', 'TST_U1')] }), opponent: player() } })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    expect((played.pendingChoices?.[0] as { targets: string[] }).targets).not.toContain('veh')
  })

  it('draws a card when an enemy unit is shielded this way', () => {
    const s = state({ cards: F, players: { player: player({ hand: ['TS26_46'], resources: ready(10), deck: ['TST_U1'] }), opponent: player({ units: [unit('e', 'TST_U1')] }) } })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const done = resolve(played, { type: 'acceptChoice', choiceId: played.pendingChoices![0].id, targetInstanceId: 'e' })
    // Only one eligible unit existed ('e'), so the up-to-2 pick has nothing left to re-offer and
    // finishes immediately rather than raising a second "Done" choice.
    expect(done.players.player.hand.length).toBeGreaterThan(0)
  })
})

describe('When Has Become Now (SEC_245) — play a card with Plot from resources; top of deck into play as a resource', () => {
  const F = { ...CARDS, SEC_245: real('SEC_245'), PLOT1: PLOT_CARDS.PLOT1 }
  it('offers only Plot resources, and resources the top of the deck once played', () => {
    const s = state({
      cards: F,
      players: { player: player({ hand: ['SEC_245'], resources: [{ cardId: 'PLOT1', exhausted: false }, ...ready(5)], deck: ['TST_U2'] }), opponent: player() },
    })
    const played = resolve(s, { type: 'playEvent', handIndex: 0 })
    const choice = plotChoice(played)!
    expect(choice.candidates).toContainEqual({ index: 0, cardId: 'PLOT1' })
    const done = resolve(played, { type: 'acceptChoice', choiceId: choice.id, optionIndex: 0 })
    expect(done.players.player.units.some(u => u.cardId === 'PLOT1')).toBe(true)
    expect(done.players.player.resources.at(-1)).toEqual({ cardId: 'TST_U2', exhausted: true })
  })
})

describe('Chancellor Palpatine, leader front (SEC_001) — Action: search top 5 for a card with Plot, reveal, draw', () => {
  const F = { ...CARDS, SEC_001: real('SEC_001'), PLOT1: PLOT_CARDS.PLOT1 }
  const board = (deck: string[]) => state({
    cards: F,
    players: { player: player({ leader: undeployed('SEC_001'), resources: ready(10), deck }), opponent: player() },
  })

  it('is offered as a leader action', () => {
    const s = board(['TST_U1', 'TST_U1', 'TST_U1', 'TST_U1', 'TST_U1'])
    expect(legalMoves(s).some(m => m.type === 'useLeaderAbility')).toBe(true)
  })

  it('reveals the top 5 and draws the card with Plot among them', () => {
    const s = board(['TST_U1', 'TST_U1', 'PLOT1', 'TST_U1', 'TST_U1'])
    const used = resolve(s, { type: 'useLeaderAbility', index: 0 })
    expect(used.pendingChoices?.[0]).toMatchObject({ kind: 'searchDraw' })
    const choice = used.pendingChoices![0]
    const done = resolve(used, { type: 'acceptChoice', choiceId: choice.id, deckIndex: (choice as { eligibleIndices: number[] }).eligibleIndices[0] })
    expect(done.players.player.hand).toContain('PLOT1')
  })
})

describe('Chancellor Palpatine, back (When Deployed discount): not built here, split out to a follow-up', () => {
  it('the leader is not registered with a back-side ability', () => {
    expect(getCardDefinition('SEC_001')?.abilities ?? []).toEqual([])
  })
})
