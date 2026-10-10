import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { effectiveCost, legalMoves } from '../engine/legalMoves'
import { unitHasKeyword, unitHasTrait } from '../engine/keywords'
import { defeatUnit, dealDamageToUnit } from '../engine/combat'
import { createCreditTokens, discardCards, discardFromHand, friendlyCreditTokens } from '../engine/effects'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { triage } from '../bench/triage'
import { getCardDefinition } from '../engine/abilities'
import { IMPLEMENTED_EVENTS, IMPLEMENTED_LEADERS, IMPLEMENTED_UNITS, IMPLEMENTED_UPGRADES, IMPLEMENTED_BASES, SET_PROGRESS } from '../data/implementedCards'
import { REPRINTS } from '../data/reprints'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import { TOKEN_CLONE_TROOPER } from '../engine/tokenUnits'
import { TOKEN_EXPERIENCE, TOKEN_SHIELD } from '../engine/tokenUpgrades'
import type { Action } from '../engine/actions'
import type { EngineCard, GameState, LeaderState, PendingChoice, PhaseEvents, PlayerId, UnitState } from '../engine/types'

/**
 * The cards no other group owned: two leaders that reward a kill or spend tokens (Boba Fett, Han
 * Solo), a leader that hears a reveal as well as a discard (Padmé Amidala), the highest-cost enemy
 * defeated (Dengar), a capture by every friendly unit (Let's Talk), damage dealt to a unit that may
 * not survive it (The Elite Squad), a trait lost for the phase (Nameless Terror), a Bounty beside a
 * When Defeated (Val), a unit handed to the opponent and bought back by its own Bounty (Stolen
 * Landspeeder), a Bounty collected without a defeat (Spare the Target), a whole-deck search that may
 * play what it found (Bounty Posting) and an upgrade that counts keywords (The Darksaber).
 */
const POOL = poolFor(['SOR', 'SHD', 'TWI', 'LOF', 'SEC', 'LAW', 'JTL', 'TS26'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}
const CARDS_BUILT = ['LAW_053', 'SEC_131', 'SEC_143', 'LOF_033', 'SHD_058', 'SHD_161', 'SHD_206', 'SHD_228', 'TS26_22']
const LEADERS_BUILT = ['LAW_007', 'LAW_017', 'SEC_016']
// Cards already built that these tests lean on: a Bounty unit, a Bounty upgrade, a Disclose unit,
// Malakili, a search for an Underworld unit, a return of an Underworld card, Vuutun Palaa.
const PROPS = ['SHD_027', 'SHD_125', 'SEC_062', 'SEC_184', 'LAW_212', 'LAW_136', 'SHD_260', 'SEC_122', 'LOF_076']
const src = (id: string, over: Partial<EngineCard> = {}) => card({ id, type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 3, ...over })
const F: Record<string, EngineCard> = {
  ...CARDS,
  ...Object.fromEntries([...CARDS_BUILT, ...LEADERS_BUILT, ...PROPS].map(id => [id, real(id)])),
  PLAIN: src('PLAIN'),
  PLAIN2: src('PLAIN2'),
  TOUGH: src('TOUGH', { power: 1, hp: 9 }),
  SPC: src('SPC', { arena: 'space' }),
  BH: src('BH', { power: 5, hp: 6, traits: ['BOUNTY HUNTER'] }),
  STRONG: src('STRONG', { power: 5, hp: 6 }),
  C5: src('C5', { cost: 5 }),
  C5B: src('C5B', { cost: 5 }),
  C3: src('C3', { cost: 3 }),
  UNIQ: src('UNIQ', { unique: true, hp: 6 }),
  FORCE: src('FORCE', { traits: ['FORCE'] }),
  VEH: src('VEH', { traits: ['VEHICLE'] }),
  RAID: src('RAID', { keywords: [{ name: 'Raid', value: 1 }] }),
  OVER: src('OVER', { keywords: [{ name: 'Overwhelm' }] }),
  GRIT: src('GRIT', { keywords: [{ name: 'Grit' }] }),
  VIG: src('VIG', { aspects: ['Vigilance'] }),
  CREATURE: src('CREATURE', { traits: ['CREATURE'] }),
  FORCE_CREATURE: src('FORCE_CREATURE', { traits: ['CREATURE'], cost: 1 }),
  DROID: src('DROID', { traits: ['DROID'] }),
  UPG: card({ id: 'UPG', type: 'upgrade', cost: 2, power: 1, hp: 1 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: F[cardId]?.arena ?? 'ground', ...over })
type Side = Parameters<typeof player>[0]
const deck = ['PLAIN', 'PLAIN', 'PLAIN', 'PLAIN', 'PLAIN', 'PLAIN']
const rich = (over: Side = {}) => player({ resources: ready(20), deck, ...over })
const board = (mine: Side = {}, theirs: Side = {}, over: Partial<GameState> = {}) =>
  state({ cards: F, players: { player: rich(mine), opponent: rich(theirs) }, ...over })
const all = (s: GameState) => [...s.players.player.units, ...s.players.opponent.units]
const U = (s: GameState, id: string) => all(s).find(u => u.instanceId === id)
const choice = (s: GameState): PendingChoice => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return s.pendingChoices![0]
}
type Extra = Partial<Extract<Action, { type: 'acceptChoice' }>>
const accept = (s: GameState, extra: Extra = {}) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, ...extra })
const skip = (s: GameState) => resolve(s, { type: 'skipTrigger', choiceId: choice(s).id })
const noChoice = (s: GameState) => expect(s.pendingChoices ?? []).toHaveLength(0)
const declinable = (s: GameState) => legalMoves(s).some(m => m.type === 'skipTrigger')
const unitOffers = (s: GameState) =>
  [...new Set(legalMoves(s).flatMap(m => (m.type === 'acceptChoice' && m.targetInstanceId ? [m.targetInstanceId] : [])))].sort()
/**
 * Answer every choice until none is left. `answer` says how for the ones a test cares about (an
 * `acceptChoice`'s fields, or 'skip'); anything else takes the first move on offer, which is how an
 * ordering prompt the test has no opinion on is got past.
 */
const settle = (s: GameState, answer: (c: PendingChoice) => Extra | 'skip' | undefined = () => undefined): GameState => {
  let next = s
  for (let i = 0; i < 40 && (next.pendingChoices?.length ?? 0) > 0; i++) {
    const c = next.pendingChoices![0]
    const a = answer(c)
    // Asked as the player the choice belongs to: a board built by hand has not handed them the turn.
    next = a === 'skip' ? skip(next) : a ? accept(next, a) : resolve(next, legalMoves({ ...next, activePlayer: c.controller })[0])
  }
  noChoice(next)
  return next
}
const play = (s: GameState, cardId: string, who: PlayerId = 'player'): GameState => {
  const handIndex = s.players[who].hand.indexOf(cardId)
  expect(handIndex, `${cardId} in ${who}'s hand`).toBeGreaterThanOrEqual(0)
  return resolve(s, F[cardId].type === 'event' ? { type: 'playEvent', handIndex } : { type: 'playUnit', handIndex })
}
const attackUnit = (s: GameState, attackerId: string, target: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'unit', instanceId: target } })
const attackBase = (s: GameState, attackerId: string) => resolve(s, { type: 'attack', attackerId, target: { kind: 'base' } })
const phaseEvents = (over: Partial<PhaseEvents>): PhaseEvents => ({
  enteredPlay: { player: [], opponent: [] }, defeated: { player: [], opponent: [] }, basesAttacked: [], basesDamaged: [],
  upgradesDefeated: [], damagedUnits: [], leftPlay: { player: [], opponent: [] }, leaderLeftPlay: [], played: { player: [], opponent: [] }, ...over,
})
const undeployed = (cardId: string, over: Partial<LeaderState> = {}): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false, ...over })
const deployed = (cardId: string): LeaderState => ({ cardId, deployed: true, epicActionUsed: true, exhausted: false })
/** The deployed leader unit `L` of `id`, plus the player's other units. */
const back = (id: string, mine: Side = {}, theirs: Side = {}) =>
  board({ leader: deployed(id), ...mine, units: [unit('L', id, { isLeader: true }), ...(mine.units ?? [])] }, theirs)
const credits = (s: GameState, who: PlayerId = 'player') => friendlyCreditTokens(s, who)
const readyResources = (s: GameState, who: PlayerId = 'player') => s.players[who].resources.filter(r => !r.exhausted).length
const tokensOn = (s: GameState, id: string, token: string) => U(s, id)!.upgrades.filter(u => u.cardId === token).length
const modeIndex = (s: GameState, suffix: string) => {
  const c = choice(s)
  return c.kind === 'chooseMode' ? c.modes.findIndex(m => m.endsWith(suffix)) : -1
}

describe('registration', () => {
  it('registers each card and lists it as built', () => {
    const built = [...IMPLEMENTED_EVENTS, ...IMPLEMENTED_UNITS, ...IMPLEMENTED_UPGRADES, ...IMPLEMENTED_BASES]
    for (const id of CARDS_BUILT) {
      expect(getCardDefinition(id), id).toBeTruthy()
      expect(built.some(c => c.id === id), id).toBe(true)
    }
    for (const id of LEADERS_BUILT) {
      expect(getCardDefinition(id)?.leaderAbilities, id).toBeTruthy()
      expect(IMPLEMENTED_LEADERS.find(l => l.id === id), id).toMatchObject({ front: true, back: true })
    }
  })

  it('lists Bossk (SHD_010) as built on both sides', () => {
    expect(IMPLEMENTED_LEADERS.find(l => l.id === 'SHD_010')).toMatchObject({ front: true, back: true })
  })

  it('reads Sullustan Sapper (LAW_081) as playing as printed: its corrected keywords are the ones the triage strips', () => {
    expect(triage(poolFor(['LAW'])).triaged.map(c => c.id)).not.toContain('LAW_081')
  })
})

describe('every card in every set is built or plays as printed', () => {
  const built = new Set([
    ...IMPLEMENTED_LEADERS.filter(l => l.front && l.back), ...IMPLEMENTED_BASES, ...IMPLEMENTED_UNITS, ...IMPLEMENTED_UPGRADES, ...IMPLEMENTED_EVENTS,
  ].map(c => c.id))
  const credited = new Set([...built, ...REPRINTS.filter(r => built.has(r.canonical)).flatMap(r => r.printings)])

  it.each(SET_PROGRESS.map(s => s.code))('%s has no card the triage holds back that the manifest does not list', code => {
    const unbuilt = triage(poolFor([code])).triaged.map(c => c.id).filter(id => !credited.has(id))
    expect(unbuilt).toEqual([])
  })

  it.each(SET_PROGRESS.map(s => s.code))('%s counts as many cards done as it prints, type by type', code => {
    const set = SET_PROGRESS.find(s => s.code === code)!
    expect({ ...set.done, tokens: 0 }).toEqual({ ...set.total, tokens: 0 })
  })

  it('files Snapshot Reflexes as the upgrade it is printed as, in both of its sets', () => {
    expect(IMPLEMENTED_UPGRADES.some(c => c.id === 'SOR_215')).toBe(true)
    expect(IMPLEMENTED_EVENTS.some(c => c.id === 'SOR_215')).toBe(false)
  })
})

describe('LAW_007 Boba Fett: a Credit token when a friendly Bounty Hunter attacks and defeats the defender', () => {
  const front = (mine: Side = {}, theirs: Side = {}) => board({ leader: undeployed('LAW_007'), ...mine }, theirs)

  it('front: may exhaust the leader to create a Credit token', () => {
    const s = attackUnit(front({ units: [unit('bh', 'BH')] }, { units: [unit('e', 'PLAIN')] }), 'bh', 'e')
    expect(choice(s).kind).toBe('mayPayThen')
    expect(declinable(s)).toBe(true)
    const done = accept(s)
    expect(credits(done)).toBe(1)
    expect(done.players.player.leader.exhausted).toBe(true)
    const declined = skip(s)
    expect(credits(declined)).toBe(0)
    expect(declined.players.player.leader.exhausted).toBe(false)
  })

  it('front: nothing for a unit that is not a Bounty Hunter, a defender that survives, an attack on a base or an exhausted leader', () => {
    noChoice(attackUnit(front({ units: [unit('p', 'STRONG')] }, { units: [unit('e', 'PLAIN')] }), 'p', 'e'))
    noChoice(attackUnit(front({ units: [unit('bh', 'BH')] }, { units: [unit('e', 'TOUGH')] }), 'bh', 'e'))
    noChoice(attackBase(front({ units: [unit('bh', 'BH')] }), 'bh'))
    noChoice(attackUnit(board({ leader: undeployed('LAW_007', { exhausted: true }), units: [unit('bh', 'BH')] }, { units: [unit('e', 'PLAIN')] }), 'bh', 'e'))
  })

  it('back: creates the Credit token outright, for his own attack as well', () => {
    const other = attackUnit(back('LAW_007', { units: [unit('bh', 'BH')] }, { units: [unit('e', 'PLAIN')] }), 'bh', 'e')
    noChoice(other)
    expect(credits(other)).toBe(1)
    // Raid 1 takes his 3 power to 4 against the defender's 3 HP.
    const own = attackUnit(back('LAW_007', {}, { units: [unit('e', 'PLAIN')] }), 'L', 'e')
    expect(U(own, 'e')).toBeUndefined()
    expect(credits(own)).toBe(1)
    expect(credits(attackUnit(back('LAW_007', { units: [unit('p', 'STRONG')] }, { units: [unit('e', 'PLAIN')] }), 'p', 'e'))).toBe(0)
  })
})

describe('LAW_017 Han Solo: defeat friendly tokens to deal damage', () => {
  const front = (mine: Side = {}, theirs: Side = {}) => board({ leader: undeployed('LAW_017'), ...mine }, theirs)
  const usable = (s: GameState) => legalMoves(s).some(m => m.type === 'useLeaderAbility')
  const use = (s: GameState) => resolve(s, { type: 'useLeaderAbility', index: 0 })

  it('front: is not offered without a friendly token', () => {
    expect(usable(front({ units: [unit('f', 'PLAIN')] }, { units: [unit('e', 'PLAIN')] }))).toBe(false)
  })

  it('front: a Credit token pays for it, and it deals 1 damage to a unit', () => {
    const s = use(createCreditTokens(front({}, { units: [unit('e', 'PLAIN')] }), 'player', 1))
    expect(credits(s)).toBe(0)
    expect(s.players.player.leader.exhausted).toBe(true)
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
    expect(declinable(s)).toBe(false)
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
  })

  it('front: a token upgrade or a token unit pays for it, asked which kind when there are several', () => {
    const s = use(front({ units: [unit('t', TOKEN_CLONE_TROOPER), unit('f', 'PLAIN', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })] }, { units: [unit('e', 'PLAIN')] }))
    expect(choice(s).kind).toBe('chooseMode')
    const viaUnit = accept(accept(s, { optionIndex: modeIndex(s, 'defeatUnit') }), { targetInstanceId: 't' })
    expect(U(viaUnit, 't')).toBeUndefined()
    expect(choice(viaUnit)).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
    const viaUpgrade = accept(accept(s, { optionIndex: modeIndex(s, 'defeatUpgrade') }), { optionIndex: 0 })
    expect(U(viaUpgrade, 'f')!.upgrades).toEqual([])
    expect(choice(viaUpgrade)).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
  })

  it('back: defeats any number of friendly tokens as he attacks, and deals that much damage to a unit', () => {
    const s = createCreditTokens(back('LAW_017', { units: [unit('t', TOKEN_CLONE_TROOPER)] }, { units: [unit('e', 'TOUGH')] }), 'player', 2)
    let a = attackBase(s, 'L')
    expect(choice(a).kind).toBe('chooseMode')
    a = accept(a, { optionIndex: modeIndex(a, 'defeatCredit') })
    a = accept(a, { optionIndex: modeIndex(a, 'defeatCredit') })
    expect(credits(a)).toBe(0)
    // The token unit is still there to defeat, so the question is asked again, and stopping is an answer.
    a = accept(a, { optionIndex: modeIndex(a, 'stop') })
    expect(choice(a)).toMatchObject({ kind: 'selectDamageTarget', amount: 2 })
    const done = accept(a, { targetInstanceId: 'e' })
    expect(U(done, 'e')!.damage).toBe(2)
    expect(U(done, 't')).toBeTruthy()
    noChoice(done)
  })

  it('back: defeating nothing deals nothing, and with no token there is nothing to ask', () => {
    const s = createCreditTokens(back('LAW_017', {}, { units: [unit('e', 'TOUGH')] }), 'player', 1)
    const a = attackBase(s, 'L')
    const stopped = accept(a, { optionIndex: modeIndex(a, 'stop') })
    noChoice(stopped)
    expect(U(stopped, 'e')!.damage).toBe(0)
    noChoice(attackBase(back('LAW_017', {}, { units: [unit('e', 'TOUGH')] }), 'L'))
  })

  it('back: has Saboteur', () => {
    expect(unitHasKeyword(back('LAW_017'), unit('L', 'LAW_017', { isLeader: true }), 'Saboteur')).toBe(true)
  })
})

describe('LAW_053 Dengar: a Credit token when a unit with the highest cost among enemy units is defeated, once each round', () => {
  const s = () => board({ units: [unit('d', 'LAW_053')] }, { units: [unit('e5', 'C5'), unit('e5b', 'C5B'), unit('e3', 'C3'), unit('e2', 'PLAIN')] })

  it('creates one for the costliest enemy unit, and for either of two that tie', () => {
    expect(credits(defeatUnit(s(), 'e5'))).toBe(1)
    expect(credits(defeatUnit(s(), 'e5b'))).toBe(1)
  })

  it('creates none for a cheaper enemy unit or for a friendly one', () => {
    expect(credits(defeatUnit(s(), 'e3'))).toBe(0)
    expect(credits(defeatUnit(board({ units: [unit('d', 'LAW_053'), unit('f', 'C5')] }, { units: [unit('e', 'PLAIN')] }), 'f'))).toBe(0)
  })

  it('reads the cost of the unit as it was: the last enemy unit is the costliest', () => {
    expect(credits(defeatUnit(board({ units: [unit('d', 'LAW_053')] }, { units: [unit('e', 'PLAIN')] }), 'e'))).toBe(1)
  })

  it('is used only once each round', () => {
    const once = defeatUnit(s(), 'e5')
    expect(credits(defeatUnit(once, 'e5b'))).toBe(1)
  })
})

describe('SEC_016 Padmé Amidala: 1 damage to a unit when you reveal or discard cards from your hand', () => {
  const front = (mine: Side = {}, theirs: Side = {}) => board({ leader: undeployed('SEC_016'), ...mine }, { units: [unit('e', 'TOUGH')], ...theirs })

  it('front: a discard from your hand offers exhausting her to deal 1 damage to a unit', () => {
    const s = discardFromHand(front({ hand: ['PLAIN'] }), 'player', 0)
    expect(choice(s).kind).toBe('mayPayThen')
    const paid = accept(s)
    expect(paid.players.player.leader.exhausted).toBe(true)
    expect(choice(paid)).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
    expect(U(accept(paid, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
    expect(skip(s).players.player.leader.exhausted).toBe(false)
  })

  it("front: an opponent's discard, a discard from your deck and an exhausted leader raise nothing", () => {
    noChoice(discardFromHand(front({}, { hand: ['PLAIN'] }), 'opponent', 0))
    noChoice(discardCards(front(), 'player', 'deck', [0]))
    noChoice(discardFromHand(board({ leader: undeployed('SEC_016', { exhausted: true }), hand: ['PLAIN'] }, { units: [unit('e', 'TOUGH')] }), 'player', 0))
  })

  it('front: revealing cards from your hand to disclose does the same, once for the whole reveal', () => {
    // Bardottan Ornithopter: "You may disclose Vigilance. If you do, draw a card."
    let s = play(front({ hand: ['SEC_062', 'VIG'] }), 'SEC_062')
    expect(choice(s).kind).toBe('disclose')
    s = accept(s, { handIndex: 0 })
    if (s.pendingChoices?.[0]?.kind === 'disclose') s = accept(s)
    let asked = 0
    const done = settle(s, c => {
      if (c.kind === 'mayPayThen') { asked++; return {} }
      return c.kind === 'selectDamageTarget' ? { targetInstanceId: 'e' } : undefined
    })
    expect(asked).toBe(1)
    expect(U(done, 'e')!.damage).toBe(1)
    expect(done.players.player.leader.exhausted).toBe(true)
  })

  it('front: revealing an event for a card that asks for one does the same', () => {
    // ISB Agent: "You may reveal an event from your hand. If you do, deal 1 damage to a unit."
    const revealed = accept(play(front({ hand: ['SEC_184', 'TST_E1'] }, { units: [unit('e', 'TOUGH'), unit('e2', 'TOUGH')] }), 'SEC_184'))
    let asked = 0
    const done = settle(revealed, c => {
      if (c.kind === 'mayPayThen') { asked++; return {} }
      // Her own damage goes on one unit and the ISB Agent's on the other.
      return c.kind === 'selectDamageTarget' ? { targetInstanceId: c.id.startsWith('SEC_016') ? 'e' : 'e2' } : undefined
    })
    expect(asked).toBe(1)
    expect([U(done, 'e')!.damage, U(done, 'e2')!.damage]).toEqual([1, 1])
    expect(done.players.player.hand).toEqual(['TST_E1'])
  })

  it("front: an opponent's reveal is not yours", () => {
    const theirTurn: GameState = { ...front({}, { hand: ['SEC_184', 'TST_E1'], units: [unit('e', 'TOUGH')] }), activePlayer: 'opponent' }
    const s = accept(play(theirTurn, 'SEC_184', 'opponent'))
    expect((s.pendingChoices ?? []).every(c => c.kind !== 'mayPayThen')).toBe(true)
  })

  it('front: a declined disclose reveals nothing', () => {
    const s = skip(play(front({ hand: ['SEC_062', 'VIG'] }), 'SEC_062'))
    noChoice(s)
  })

  it('back: may deal 1 damage to a unit, with nothing to exhaust', () => {
    const s = discardFromHand(back('SEC_016', { hand: ['PLAIN'] }, { units: [unit('e', 'TOUGH')] }), 'player', 0)
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 1 })
    expect(declinable(s)).toBe(true)
    expect(U(accept(s, { targetInstanceId: 'e' }), 'e')!.damage).toBe(1)
  })
})

describe("SEC_131 Let's Talk: costs 3 less if a friendly unit left play; each friendly unit captures an enemy non-leader unit in its arena", () => {
  it('costs 3 less once a friendly unit has left play this phase', () => {
    expect(effectiveCost(board(), 'player', F.SEC_131)).toBe(9)
    expect(effectiveCost(board({}, {}, { phaseEvents: phaseEvents({ leftPlay: { player: [], opponent: ['PLAIN'] } }) }), 'player', F.SEC_131)).toBe(9)
    expect(effectiveCost(board({}, {}, { phaseEvents: phaseEvents({ leftPlay: { player: ['PLAIN'], opponent: [] } }) }), 'player', F.SEC_131)).toBe(6)
  })

  it('has each friendly unit capture one, and none is optional', () => {
    const s = board(
      { hand: ['SEC_131'], units: [unit('g1', 'PLAIN'), unit('g2', 'PLAIN2'), unit('sp', 'SPC')] },
      { units: [unit('e1', 'PLAIN'), unit('e2', 'C3'), unit('el', 'TOUGH', { isLeader: true })] },
    )
    let p = play(s, 'SEC_131')
    // The space unit has nothing in its arena to capture, and a leader unit is never captured.
    expect(unitOffers(p)).toEqual(['g1', 'g2'])
    expect(declinable(p)).toBe(false)
    p = accept(p, { targetInstanceId: 'g2' })
    expect(unitOffers(p)).toEqual(['e1', 'e2'])
    expect(declinable(p)).toBe(false)
    p = accept(p, { targetInstanceId: 'e2' })
    expect(unitOffers(p)).toEqual(['g1'])
    p = accept(accept(p, { targetInstanceId: 'g1' }), { targetInstanceId: 'e1' })
    noChoice(p)
    expect(U(p, 'g2')!.captured).toEqual([{ cardId: 'C3', owner: 'opponent' }])
    expect(U(p, 'g1')!.captured).toEqual([{ cardId: 'PLAIN', owner: 'opponent' }])
    expect(p.players.opponent.units.map(u => u.instanceId)).toEqual(['el'])
  })

  it('stops when the enemy units run out', () => {
    const s = board({ hand: ['SEC_131'], units: [unit('g1', 'PLAIN'), unit('g2', 'PLAIN2')] }, { units: [unit('e1', 'PLAIN')] })
    const p = accept(accept(play(s, 'SEC_131'), { targetInstanceId: 'g1' }), { targetInstanceId: 'e1' })
    noChoice(p)
    expect(U(p, 'g1')!.captured).toHaveLength(1)
  })
})

describe('SEC_143 The Elite Squad: When Played/When damage is dealt to this unit, may deal 2 damage to another unique unit', () => {
  it('offers another unique unit when played', () => {
    const p = play(board({ hand: ['SEC_143'] }, { units: [unit('uq', 'UNIQ'), unit('e', 'PLAIN')] }), 'SEC_143')
    expect(choice(p)).toMatchObject({ kind: 'selectDamageTarget', amount: 2 })
    expect(unitOffers(p)).toEqual(['uq'])
    expect(declinable(p)).toBe(true)
    expect(U(accept(p, { targetInstanceId: 'uq' }), 'uq')!.damage).toBe(2)
  })

  it('offers it again each time damage is dealt to it, and not to itself', () => {
    const s = dealDamageToUnit(board({ units: [unit('sq', 'SEC_143')] }, { units: [unit('uq', 'UNIQ')] }), 'sq', 1)
    expect(choice(s)).toMatchObject({ kind: 'selectDamageTarget', amount: 2, controller: 'player' })
    expect(unitOffers(s)).toEqual(['uq'])
  })

  it('still fires when the damage defeats it', () => {
    const s = dealDamageToUnit(board({ units: [unit('sq', 'SEC_143')] }, { units: [unit('uq', 'UNIQ')] }), 'sq', 20)
    expect(U(s, 'sq')).toBeUndefined()
    const done = settle(s, c => (c.kind === 'selectDamageTarget' ? { targetInstanceId: 'uq' } : undefined))
    expect(U(done, 'uq')!.damage).toBe(2)
  })

  it('does nothing for damage to another unit, for a Shield that soaks it, or with no other unique unit', () => {
    noChoice(dealDamageToUnit(board({ units: [unit('sq', 'SEC_143'), unit('f', 'TOUGH')] }, { units: [unit('uq', 'UNIQ')] }), 'f', 1))
    noChoice(dealDamageToUnit(board({ units: [unit('sq', 'SEC_143', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })] }, { units: [unit('uq', 'UNIQ')] }), 'sq', 1))
    noChoice(dealDamageToUnit(board({ units: [unit('sq', 'SEC_143')] }, { units: [unit('e', 'PLAIN')] }), 'sq', 1))
  })
})

describe('LOF_033 Nameless Terror: may exhaust a Force unit when played; enemy units lose the Force trait for the phase as it attacks', () => {
  it('When Played: offers the Force units on either side, and may be declined', () => {
    const p = play(board({ hand: ['LOF_033'], units: [unit('f', 'FORCE')] }, { units: [unit('ef', 'FORCE'), unit('e', 'PLAIN')] }), 'LOF_033')
    expect(unitOffers(p)).toEqual(['ef', 'f'])
    expect(declinable(p)).toBe(true)
    expect(U(accept(p, { targetInstanceId: 'ef' }), 'ef')!.exhausted).toBe(true)
  })

  it('On Attack: each enemy unit loses Force, friendly units keep it, and it comes back with the next phase', () => {
    const s = attackBase(board({ units: [unit('nt', 'LOF_033'), unit('f', 'FORCE')] }, { units: [unit('ef', 'FORCE')] }), 'nt')
    expect(unitHasTrait(s, U(s, 'ef')!, 'Force')).toBe(false)
    expect(unitHasTrait(s, U(s, 'f')!, 'Force')).toBe(true)
    // Both players pass, which ends the action phase and the effect with it.
    const regroup = resolve(resolve(s, { type: 'pass' }), { type: 'pass' })
    expect(regroup.phase).toBe('regroup')
    expect(unitHasTrait(regroup, U(regroup, 'ef')!, 'Force')).toBe(true)
  })
})

describe('SHD_058 Val: a Bounty of 3 damage to a unit, and 2 Experience tokens to a friendly unit When Defeated', () => {
  it("resolves both: the opponent's Bounty and her controller's When Defeated", () => {
    const s = defeatUnit(board({ units: [unit('val', 'SHD_058'), unit('f', 'TOUGH')] }, { units: [unit('e', 'TOUGH')] }), 'val')
    const controllers: Record<string, PlayerId> = {}
    const done = settle(s, c => {
      if (c.kind === 'selectDamageTarget') { controllers.damage = c.controller; expect(c.amount).toBe(3); return { targetInstanceId: 'f' } }
      if (c.kind === 'mayGiveTokens') { controllers.tokens = c.controller; return { targetInstanceId: 'f' } }
      return undefined
    })
    expect(controllers).toEqual({ damage: 'opponent', tokens: 'player' })
    expect(U(done, 'f')!.damage).toBe(3)
    expect(tokensOn(done, 'f', TOKEN_EXPERIENCE)).toBe(2)
  })

  it('offers the Experience tokens to friendly units only', () => {
    const s = defeatUnit(board({ units: [unit('val', 'SHD_058'), unit('f', 'TOUGH')] }, { units: [unit('e', 'TOUGH')] }), 'val')
    let offered: string[] = []
    settle(s, c => {
      if (c.kind === 'mayCollectBounty') return 'skip'
      if (c.kind === 'mayGiveTokens') { offered = [...c.targets]; return { targetInstanceId: 'f' } }
      return undefined
    })
    expect(offered).toEqual(['f'])
  })
})

describe('SHD_161 Stolen Landspeeder: played from hand it goes to the opponent, and its owner collects it back', () => {
  it('When Played from hand: an opponent takes control of it, for good', () => {
    const p = play(board({ hand: ['SHD_161'] }), 'SHD_161')
    const stolen = p.players.opponent.units.find(u => u.cardId === 'SHD_161')!
    expect(stolen).toBeTruthy()
    expect(stolen.owner).toBe('player')
    expect(p.players.player.units).toEqual([])
    const regroup = resolve(resolve(p, { type: 'pass' }), { type: 'pass' })
    expect(regroup.players.opponent.units.some(u => u.cardId === 'SHD_161')).toBe(true)
  })

  it('Bounty: its owner plays it from their discard pile for free with an Experience token, and keeps it', () => {
    const s = defeatUnit(board({}, { units: [unit('ls', 'SHD_161', { owner: 'player' })] }), 'ls')
    expect(s.players.player.discard).toContain('SHD_161')
    expect(choice(s)).toMatchObject({ kind: 'mayCollectBounty', controller: 'player' })
    const done = settle(s, c => (c.kind === 'playCardFrom' ? { optionIndex: 0 } : undefined))
    const mine = done.players.player.units.find(u => u.cardId === 'SHD_161')!
    expect(mine).toBeTruthy()
    expect(mine.upgrades.map(u => u.cardId)).toEqual([TOKEN_EXPERIENCE])
    expect(done.players.player.discard).not.toContain('SHD_161')
    expect(done.players.opponent.units).toEqual([])
    expect(readyResources(done)).toBe(20)
  })

  it('Bounty: an opponent who does not own it gets nothing', () => {
    const done = defeatUnit(board({ units: [unit('ls', 'SHD_161')] }), 'ls')
    noChoice(done)
    expect(all(done)).toEqual([])
    expect(done.players.player.discard).toContain('SHD_161')
  })
})

describe("SHD_206 Spare the Target: return an enemy non-leader unit to its owner's hand and collect its Bounties", () => {
  it('returns the unit and has the player who played it collect its Bounty', () => {
    // Hylobon Enforcer: "Bounty - Draw a card."
    const s = board({ hand: ['SHD_206'] }, { units: [unit('b', 'SHD_027'), unit('el', 'TOUGH', { isLeader: true })] })
    const p = play(s, 'SHD_206')
    expect(unitOffers(p)).toEqual(['b'])
    const returned = accept(p, { targetInstanceId: 'b' })
    expect(returned.players.opponent.hand).toEqual(['SHD_027'])
    expect(choice(returned)).toMatchObject({ kind: 'mayCollectBounty', controller: 'player' })
    const done = accept(returned)
    expect(done.players.player.hand).toHaveLength(1)
    noChoice(done)
  })

  it('collects a Bounty an upgrade gave it', () => {
    // Price on Your Head: "Attached unit gains: Bounty - Put the top card of your deck into play as a resource."
    const s = board({ hand: ['SHD_206'] }, { units: [unit('b', 'PLAIN', { upgrades: [{ cardId: 'SHD_125', owner: 'player' }] })] })
    const done = settle(accept(play(s, 'SHD_206'), { targetInstanceId: 'b' }))
    expect(done.players.player.resources).toHaveLength(21)
  })

  it('just returns a unit with no Bounty', () => {
    const done = accept(play(board({ hand: ['SHD_206'] }, { units: [unit('e', 'PLAIN')] }), 'SHD_206'), { targetInstanceId: 'e' })
    noChoice(done)
    expect(done.players.opponent.hand).toEqual(['PLAIN'])
  })
})

describe('SHD_228 Bounty Posting: search your deck for a Bounty upgrade, draw it, and you may play it', () => {
  const s = () => board({ hand: ['SHD_228'], deck: ['PLAIN', 'UPG', 'SHD_125', 'PLAIN'], units: [unit('f', 'PLAIN')] }, { units: [unit('e', 'PLAIN')] })
  // What the event itself costs this player, aspect penalty included.
  const eventCost = effectiveCost(s(), 'player', F.SHD_228)

  it('offers only the Bounty upgrades in the whole deck, and draws the one picked', () => {
    const p = play(s(), 'SHD_228')
    const c = choice(p)
    expect(c.kind).toBe('searchDraw')
    expect(c.kind === 'searchDraw' && c.eligibleIndices).toEqual([2])
    const drawn = accept(p, { deckIndex: 2 })
    expect(drawn.players.player.hand).toEqual(['SHD_125'])
    expect(drawn.players.player.deck.slice().sort()).toEqual(['PLAIN', 'PLAIN', 'UPG'])
  })

  it('then offers to play that upgrade, paying its cost', () => {
    const drawn = accept(play(s(), 'SHD_228'), { deckIndex: 2 })
    const c = choice(drawn)
    expect(c.kind).toBe('playCardFrom')
    expect(declinable(drawn)).toBe(true)
    const done = settle(drawn, x => (x.kind === 'playCardFrom' ? { optionIndex: 0 } : x.kind === 'attachPlayedCard' ? { targetInstanceId: 'e' } : undefined))
    expect(U(done, 'e')!.upgrades.map(u => u.cardId)).toEqual(['SHD_125'])
    expect(done.players.player.hand).toEqual([])
    expect(readyResources(done)).toBe(20 - eventCost - effectiveCost(s(), 'player', F.SHD_125))
  })

  it('leaves it in hand when declined', () => {
    const done = skip(accept(play(s(), 'SHD_228'), { deckIndex: 2 }))
    noChoice(done)
    expect(done.players.player.hand).toEqual(['SHD_125'])
    expect(readyResources(done)).toBe(20 - eventCost)
  })
})

describe('TS26_22 The Darksaber: Sentinel, and readies its unit when played with 4 different keywords among friendly units', () => {
  const playOn = (s: GameState, target: string) => resolve(s, { type: 'playUpgrade', handIndex: s.players.player.hand.indexOf('TS26_22'), targetInstanceId: target })

  it('attaches to a non-Vehicle unit only, and gives it Sentinel', () => {
    const s = board({ hand: ['TS26_22'], units: [unit('h', 'PLAIN'), unit('v', 'VEH')] })
    const targets = legalMoves(s).flatMap(m => (m.type === 'playUpgrade' ? [m.targetInstanceId] : []))
    expect(targets).toEqual(['h'])
    const p = playOn(s, 'h')
    expect(unitHasKeyword(p, U(p, 'h')!, 'Sentinel')).toBe(true)
  })

  it('readies the attached unit with 4 different keywords among friendly units, its own Sentinel included', () => {
    const s = board({ hand: ['TS26_22'], units: [unit('h', 'PLAIN', { exhausted: true }), unit('a', 'RAID'), unit('b', 'OVER'), unit('c', 'GRIT')] })
    expect(U(playOn(s, 'h'), 'h')!.exhausted).toBe(false)
  })

  it('leaves it exhausted with fewer, and does not count enemy units', () => {
    const s = board({ hand: ['TS26_22'], units: [unit('h', 'PLAIN', { exhausted: true }), unit('a', 'RAID'), unit('b', 'OVER')] }, { units: [unit('c', 'GRIT')] })
    expect(U(playOn(s, 'h'), 'h')!.exhausted).toBe(true)
  })
})

describe('a trait one card gives another is read by every filter over cards out of play', () => {
  // Malakili: "Each friendly Creature unit and each Creature unit you own that isn't in play gains the Underworld trait."
  it('a search for an Underworld unit finds a Creature in the deck while Malakili is in play', () => {
    // Syndicate Spice Runner: "Search the top 3 cards of your deck for an Underworld unit, reveal it, and draw it."
    const withHim = play(board({ hand: ['LAW_136'], deck: ['PLAIN', 'CREATURE', 'PLAIN'], units: [unit('m', 'LAW_212')] }), 'LAW_136')
    const c = choice(withHim)
    expect(c.kind === 'searchDraw' && c.eligibleIndices).toEqual([1])
    const without = play(board({ hand: ['LAW_136'], deck: ['PLAIN', 'CREATURE', 'PLAIN'] }), 'LAW_136')
    const d = choice(without)
    expect(d.kind === 'searchDraw' && d.eligibleIndices).toEqual([])
  })

  it('a return of an Underworld card from the discard pile offers a Creature while Malakili is in play', () => {
    // Street Gang Recruiter: "You may return an Underworld card from your discard pile to your hand."
    const withHim = play(board({ hand: ['SHD_260'], discard: ['PLAIN', 'CREATURE'], units: [unit('m', 'LAW_212')] }), 'SHD_260')
    expect(JSON.stringify(choice(withHim))).toContain('CREATURE')
    noChoice(play(board({ hand: ['SHD_260'], discard: ['PLAIN', 'CREATURE'] }), 'SHD_260'))
  })

  it('a play of a card with a trait from hand does not offer a card that has lost it', () => {
    // Soresu Stance: "Play a Force unit from your hand (paying its cost) and give a Shield token to it."
    const s = board({ hand: ['LOF_076', 'FORCE'] })
    expect(choice(play(s, 'LOF_076')).kind).toBe('playUnitFromHand')
    noChoice(play({ ...s, traitsRemoved: { player: ['force'] } }, 'LOF_076'))
  })
})

describe('units paying costs as resources (Vuutun Palaa) pay for an upgrade played from hand', () => {
  it('offers the upgrade with too few resources, and exhausts the Droids chosen to pay for it', () => {
    const s = board({ units: [unit('v', 'SEC_122'), unit('d1', 'DROID'), unit('d2', 'DROID')], hand: ['UPG'], resources: ready(1) })
    expect(legalMoves(s).some(m => m.type === 'playUpgrade' && m.targetInstanceId === 'd1')).toBe(true)
    let p = resolve(s, { type: 'playUpgrade', handIndex: 0, targetInstanceId: 'v' })
    expect(choice(p).kind).toBe('exploit')
    p = accept(p, { targetInstanceId: 'd1' })
    p = settle(p, c => (c.kind === 'exploit' ? 'skip' : undefined))
    expect(U(p, 'v')!.upgrades.map(u => u.cardId)).toEqual(['UPG'])
    expect(U(p, 'd1')!.exhausted).toBe(true)
    expect(U(p, 'd2')!.exhausted).toBe(false)
    expect(readyResources(p)).toBe(0)
  })

  it('does not offer it without him', () => {
    const s = board({ units: [unit('d1', 'DROID'), unit('d2', 'DROID')], hand: ['UPG'], resources: ready(1) })
    expect(legalMoves(s).some(m => m.type === 'playUpgrade')).toBe(false)
  })
})
