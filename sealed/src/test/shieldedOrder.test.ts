import { describe, it, expect } from 'vitest'
import { loadReport, replayUpTo, replayWith, pickTrigger } from './helpers/replayReport'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { normaliseCard } from '../engine/cardDb'
import { cardId } from '../data/cards'
import { SET_CODES, poolFor } from '../bench/setPools'
import { legalMoves } from '../engine/legalMoves'
import { resolve } from '../engine/resolve'
import { effectivePower } from '../engine/stats'
import { KEYWORD_AMBUSH, KEYWORD_SHIELDED } from '../engine/cardDefinitions' // also registers every implemented card
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { AIS } from '../ai/registry'
import type { EngineCard, GameState, LeaderState, PendingChoice, UnitState } from '../engine/types'

/**
 * **Shielded is a triggered ability its controller orders** (CR 7.6.13b: "When Played abilities,
 * Ambush, and Shielded all resolve in the same timing window, in the order that the card's controller
 * chooses").
 *
 * Reported on Mae (Ambush, Shielded, Grit): the Shield arrived before the Ambush attack could be
 * taken, so the attack was always soaked by it. Taking the attack first is the stronger line there,
 * since the damage feeds Grit and the Shield is still to come.
 *
 * The question is only put where the order can show. A Shielded unit with nothing else to resolve, or
 * with an ability that reaches the same board either way round, is asked nothing.
 */

const ALL_CARDS = poolFor(SET_CODES)
const real = (id: string): EngineCard => {
  const row = ALL_CARDS.find(c => cardId(c.Set, c.Number) === id)
  if (!row) throw new Error(`${id} is not in a bundled set`)
  return normaliseCard(row)
}

const MAE = 'HMW_055'
const shields = (u: UnitState): number => u.upgrades.filter(a => a.cardId === TOKEN_SHIELD).length
const find = (s: GameState, instanceId: string): UnitState | undefined =>
  [...s.players.player.units, ...s.players.opponent.units].find(u => u.instanceId === instanceId)
type Order = Extract<PendingChoice, { kind: 'chooseNextTrigger' }>
const orderAsk = (s: GameState): Order | undefined =>
  (s.pendingChoices ?? []).find((c): c is Order => c.kind === 'chooseNextTrigger')
const ambushAsk = (s: GameState) => (s.pendingChoices ?? []).find(c => c.kind === 'ambush')
const pick = (s: GameState, keyword: string): GameState => {
  const [action] = pickTrigger(s, keyword)
  if (!action) throw new Error(`no ordering question to answer with ${keyword}`)
  return resolve(s, action)
}

describe('the reported game: Mae played into a Rebel Pathfinder', () => {
  const report = loadReport('maeShieldAmbush')
  /** Move 12 plays Mae and move 13 is her Ambush attack on the Pathfinder (`u1`). */
  const MAE_PLAY = 12
  const played = (): GameState => replayUpTo(report, MAE_PLAY + 1, ALL_CARDS)
  const mae = (s: GameState): UnitState => s.players.player.units.find(u => u.cardId === MAE)!
  const attackPathfinder = (s: GameState): GameState =>
    resolve(s, { type: 'attack', attackerId: mae(s).instanceId, target: { kind: 'unit', instanceId: 'u1' } })

  it('plays Mae at move 12 with an enemy unit to ambush', () => {
    expect(report.moves[MAE_PLAY]).toMatchObject({ by: 'player', action: { type: 'playUnit' } })
    const s = played()
    expect(mae(s)).toBeDefined()
    expect(s.cards[find(s, 'u1')!.cardId].name).toBe('Rebel Pathfinder')
  })

  it('asks the player which of Shielded and Ambush resolves next, before either has', () => {
    const s = played()
    const ask = orderAsk(s)
    expect(ask, 'the ordering question').toBeDefined()
    expect(ask!.controller).toBe('player')
    expect(ask!.candidates.map(c => c.cardId).sort()).toEqual([KEYWORD_AMBUSH, KEYWORD_SHIELDED].sort())
    expect(ask!.candidates.every(c => c.sourceInstanceId === mae(s).instanceId)).toBe(true)
    expect(shields(mae(s)), 'no Shield yet').toBe(0)
    expect(ambushAsk(s), 'no Ambush offer yet').toBeUndefined()
    // Nothing but the ordering question can be answered, so the order is never settled by accident.
    expect(legalMoves(s).every(m => m.type === 'acceptChoice' && m.choiceId === ask!.id)).toBe(true)
    expect(legalMoves(s)).toHaveLength(2)
  })

  it('Ambush first: the attack lands on Mae, feeds her Grit, and the Shield arrives afterwards', () => {
    const ambushing = pick(played(), KEYWORD_AMBUSH)
    expect(shields(mae(ambushing)), 'still no Shield while she attacks').toBe(0)
    expect(ambushAsk(ambushing)).toBeDefined()
    const after = attackPathfinder(ambushing)
    expect(mae(after).damage, 'the Pathfinder hit her').toBeGreaterThan(0)
    expect(shields(mae(after)), 'Shielded resolved after the attack').toBe(1)
    expect(effectivePower(after, mae(after)), 'Grit counts the damage').toBe(2 + mae(after).damage)
    expect(after.pendingChoices ?? []).toEqual([])
    expect(after.pendingTriggers).toBeUndefined()
    expect(after.activePlayer, 'the turn passes once the play is finished').toBe('opponent')
  })

  it('Shielded first: the Shield soaks the attack, as the report saw', () => {
    const shielded = pick(played(), KEYWORD_SHIELDED)
    expect(shields(mae(shielded))).toBe(1)
    expect(ambushAsk(shielded), 'the Ambush offer follows without a second question').toBeDefined()
    expect(orderAsk(shielded)).toBeUndefined()
    const after = attackPathfinder(shielded)
    expect(mae(after).damage).toBe(0)
    expect(shields(mae(after))).toBe(0)
    expect(after.activePlayer).toBe('opponent')
  })

  it('declining the Ambush after choosing it first still gives the Shield', () => {
    const ambushing = pick(played(), KEYWORD_AMBUSH)
    const declined = resolve(ambushing, { type: 'skipTrigger', choiceId: ambushAsk(ambushing)!.id })
    expect(shields(mae(declined))).toBe(1)
    expect(mae(declined).exhausted).toBe(true)
    expect(declined.pendingChoices ?? []).toEqual([])
  })

  it('replays to the board the report was filed from once the order is answered the way it used to resolve', () => {
    const final = replayWith(report, { [MAE_PLAY + 1]: s => pickTrigger(s, KEYWORD_SHIELDED) }, report.moves.length, ALL_CARDS)
    expect(mae(final).damage).toBe(0)
    expect(shields(mae(final))).toBe(0)
  })

  it('the bot answers the question, so the engine never waits on it', () => {
    let s: GameState = { ...played() }
    const move = AIS['beam-reply'](s)
    expect(move).toMatchObject({ type: 'acceptChoice', choiceId: orderAsk(s)!.id })
    // Drive the same seat with the bot until the play is finished: every owed ability resolves.
    for (let guard = 0; guard < 8 && s.activePlayer === 'player' && ((s.pendingChoices ?? []).length > 0 || s.pendingTriggers); guard++) {
      s = resolve(s, AIS['beam-reply'](s)!)
    }
    expect(s.pendingChoices ?? []).toEqual([])
    expect(s.pendingTriggers).toBeUndefined()
    expect(s.activePlayer).toBe('opponent')
    // Here it prices the two orders apart and takes the attack first: Mae ends damaged and shielded.
    expect(mae(s).damage).toBe(2)
    expect(shields(mae(s))).toBe(1)
  })
})

// ── When the question is and is not put ──────────────────────────────────────────────────────

const F: Record<string, EngineCard> = {
  ...CARDS,
  [MAE]: real(MAE),
  SOR_068: real('SOR_068'), // Cargo Juggernaut: Shielded, "When Played: If you control another Vigilance unit, heal 4 damage from your base."
  SOR_038: real('SOR_038'), // Count Dooku: Shielded, "When Played: You may defeat a unit with 4 or less remaining HP."
  ASH_064: real('ASH_064'), // The Armorer: Shielded, "When Played: Give a Shield token to each friendly unit with Shielded (including this one)."
  SOR_079: real('SOR_079'), // Admiral Piett: each friendly non-leader unit that costs 6 or more gains Ambush
  LOF_231: real('LOF_231'), // Darth Tyranus: Shielded, and Ambush while the Force is with you
  JTL_242: real('JTL_242'), // Shuttle ST-149: Shielded, "When Played/When Defeated: You may take control of a token upgrade on a unit and attach it to a different eligible unit."
  SHIELDED: card({ id: 'SHIELDED', type: 'unit', arena: 'ground', cost: 1, power: 2, hp: 2, keywords: [{ name: 'Shielded' }] }),
  SOR_050: real('SOR_050'), // The Ghost: Shielded, "When Played/On Attack: You may give a Shield token to another Spectre unit."
  SPECTRE: card({ id: 'SPECTRE', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 3, traits: ['SPECTRE'] }),
  VIGIL: card({ id: 'VIGIL', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 3, aspects: ['Vigilance'] }),
  FOE: card({ id: 'FOE', type: 'unit', arena: 'ground', cost: 1, power: 1, hp: 6 }),
}
type Side = Parameters<typeof player>[0]
const play = (handCard: string, mine: Side = {}, theirs: Side = {}): GameState =>
  resolve(state({
    cards: F,
    players: { player: player({ hand: [handCard], resources: ready(10), ...mine }), opponent: player(theirs) },
  }), { type: 'playUnit', handIndex: 0 })
const entered = (s: GameState, id: string): UnitState => s.players.player.units.find(u => u.cardId === id)!

describe('a Shielded unit is asked nothing when the order cannot show', () => {
  it('with no other ability: the Shield is simply given', () => {
    const s = play('SHIELDED', {}, { units: [unit('e1', 'FOE')] })
    expect(s.pendingChoices ?? []).toEqual([])
    expect(shields(entered(s, 'SHIELDED'))).toBe(1)
  })

  it('with Ambush and nothing to attack: the Ambush does nothing, so there is nothing to order', () => {
    const s = play(MAE)
    expect(s.pendingChoices ?? []).toEqual([])
    expect(shields(entered(s, MAE))).toBe(1)
    expect(entered(s, MAE).exhausted).toBe(true)
  })

  it('with a When Played that reaches the same board either way (Cargo Juggernaut heals the base)', () => {
    const s = play('SOR_068', { units: [unit('v', 'VIGIL')], base: { cardId: 'TST_B', damage: 6 } })
    expect(s.pendingChoices ?? []).toEqual([])
    expect(shields(entered(s, 'SOR_068'))).toBe(1)
    expect(s.players.player.base.damage).toBe(2)
    expect(s.pendingTriggers).toBeUndefined()
  })

  it('with a When Played whose condition is unmet (Cargo Juggernaut alone)', () => {
    const s = play('SOR_068', { base: { cardId: 'TST_B', damage: 6 } })
    expect(s.pendingChoices ?? []).toEqual([])
    expect(shields(entered(s, 'SOR_068'))).toBe(1)
    expect(s.players.player.base.damage).toBe(6)
  })

  it('with a When Played that asks something whose every answer comes out the same (The Ghost)', () => {
    // "You may give a Shield token to another Spectre unit": given or declined, her own Shield is hers.
    const s = play('SOR_050', { units: [unit('spec', 'SPECTRE')] })
    expect(orderAsk(s)).toBeUndefined()
    // The Shield is already on her, and her own question is the only one put.
    expect(shields(entered(s, 'SOR_050'))).toBe(1)
    expect(s.pendingChoices).toHaveLength(1)
    const done = resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, targetInstanceId: 'spec' })
    expect(shields(find(done, 'spec')!)).toBe(1)
    expect(shields(entered(done, 'SOR_050'))).toBe(1)
    expect(done.pendingChoices ?? []).toEqual([])
  })

  it('The Armorer: her Shielded and her When Played each give her a Shield, in either order', () => {
    const s = play('ASH_064')
    expect(s.pendingChoices ?? []).toEqual([])
    expect(shields(entered(s, 'ASH_064'))).toBe(2)
  })
})

describe('a Shielded unit is asked when the other ability needs an answer of its own', () => {
  it('a granted Ambush is ordered against a printed Shielded (Admiral Piett and Cargo Juggernaut)', () => {
    const s = play('SOR_068', { units: [unit('piett', 'SOR_079')] }, { units: [unit('e1', 'FOE')] })
    const ask = orderAsk(s)
    expect(ask?.candidates.map(c => c.cardId).sort()).toEqual([KEYWORD_AMBUSH, KEYWORD_SHIELDED].sort())
    expect(shields(entered(s, 'SOR_068'))).toBe(0)
    const ambushing = pick(s, KEYWORD_AMBUSH)
    const juggernaut = entered(ambushing, 'SOR_068')
    const after = resolve(ambushing, { type: 'attack', attackerId: juggernaut.instanceId, target: { kind: 'unit', instanceId: 'e1' } })
    expect(entered(after, 'SOR_068').damage).toBe(1)
    expect(shields(entered(after, 'SOR_068'))).toBe(1)
  })

  it('a conditional Ambush is ordered against Shielded (Darth Tyranus with the Force)', () => {
    const withForce = play('LOF_231', { forceToken: true }, { units: [unit('e1', 'FOE')] })
    expect(orderAsk(withForce)?.candidates.map(c => c.cardId).sort()).toEqual([KEYWORD_AMBUSH, KEYWORD_SHIELDED].sort())
    const without = play('LOF_231', {}, { units: [unit('e1', 'FOE')] })
    expect(without.pendingChoices ?? []).toEqual([])
    expect(shields(entered(without, 'LOF_231'))).toBe(1)
  })

  it('a When Played that can defeat its own unit is ordered against Shielded (Count Dooku)', () => {
    // "You may defeat a unit with 4 or less remaining HP" can name Dooku himself (4 HP). Shielded
    // first, a friendly upgrade was defeated this phase along with him; the other way, none was.
    const s = play('SOR_038', {}, { units: [unit('e1', 'FOE', { damage: 3 })] })
    expect(orderAsk(s)?.candidates.map(c => c.cardId).sort()).toEqual([KEYWORD_SHIELDED, 'SOR_038'].sort())
    const own = (first: string): GameState => {
      const asked = pick(s, first)
      return resolve(asked, { type: 'acceptChoice', choiceId: asked.pendingChoices![0].id, targetInstanceId: entered(s, 'SOR_038').instanceId })
    }
    expect(own(KEYWORD_SHIELDED).phaseEvents?.upgradesDefeated).toEqual(['player'])
    expect(own('SOR_038').phaseEvents?.upgradesDefeated).toEqual([])
    // Whichever is first, defeating an enemy leaves him shielded.
    const first = pick(s, 'SOR_038')
    const done = resolve(first, { type: 'acceptChoice', choiceId: first.pendingChoices![0].id, targetInstanceId: 'e1' })
    expect(find(done, 'e1')).toBeUndefined()
    expect(shields(entered(done, 'SOR_038'))).toBe(1)
  })

  it('a When Played whose answer can move the Shield is ordered against Shielded (Shuttle ST-149)', () => {
    // "You may take control of a token upgrade on a unit and attach it to a different eligible unit":
    // its own Shield is there to take only once Shielded has resolved.
    const s = play('JTL_242', { units: [unit('friend', 'VIGIL')] }, { units: [unit('e1', 'FOE', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'opponent' }] })] })
    expect(orderAsk(s)?.candidates.map(c => c.cardId).sort()).toEqual(['JTL_242', KEYWORD_SHIELDED].sort())
  })

  it('Shielded is listed first, so a bot that cannot separate the orders keeps the Shield-first one', () => {
    const s = play(MAE, {}, { units: [unit('e1', 'FOE')] })
    expect(orderAsk(s)!.candidates[0].cardId).toBe(KEYWORD_SHIELDED)
  })
})

/**
 * CR 7.5.5f: "If the active player chooses to resolve Ambush before other simultaneous triggered
 * abilities, those other triggered abilities are not resolved until after the attack resulting from
 * Ambush and any abilities triggered during the attack are resolved."
 */
describe('an attack made by Ambush is over before the abilities waiting behind it resolve', () => {
  const S: Record<string, EngineCard> = {
    ...F,
    ASH_194: real('ASH_194'), // Snub Fighter Squadron: Ambush, "When Played: Deal 1 damage to a space unit."
    HULK: card({ id: 'HULK', type: 'unit', arena: 'space', cost: 4, power: 2, hp: 7 }),
  }
  const played = (): GameState => resolve(state({
    cards: S,
    players: { player: player({ hand: ['ASH_194'], resources: ready(10) }), opponent: player({ units: [unit('hulk', 'HULK', { arena: 'space' })] }) },
  }), { type: 'playUnit', handIndex: 0 })
  const squadron = (s: GameState): UnitState => entered(s, 'ASH_194')

  it('the When Played is offered after the combat damage, not in the middle of the attack', () => {
    const s = played()
    expect(orderAsk(s)?.candidates.map(c => c.cardId).sort()).toEqual(['ASH_194', KEYWORD_AMBUSH].sort())
    const ambushing = pick(s, KEYWORD_AMBUSH)
    const attacked = resolve(ambushing, { type: 'attack', attackerId: squadron(ambushing).instanceId, target: { kind: 'unit', instanceId: 'hulk' } })
    expect(find(attacked, 'hulk')!.damage, 'the Squadron has dealt its 4').toBe(4)
    expect(squadron(attacked).damage, 'and taken 2 back').toBe(2)
    expect(attacked.pendingAttack, 'the attack is not waiting on anything').toBeUndefined()
    expect(attacked.heldTriggers).toBeUndefined()
    expect(attacked.pendingChoices).toHaveLength(1)
    expect(attacked.pendingChoices![0]).toMatchObject({ kind: 'mayDamage', amount: 1 })
    expect(attacked.activePlayer).toBe('player')
    const done = resolve(attacked, { type: 'acceptChoice', choiceId: attacked.pendingChoices![0].id, targetInstanceId: 'hulk' })
    expect(find(done, 'hulk')!.damage).toBe(5)
    expect(done.pendingChoices ?? []).toEqual([])
    expect(done.pendingTriggers).toBeUndefined()
    expect(done.activePlayer, 'one play, one turn').toBe('opponent')
  })

  it('the When Played first, then the attack, still passes the turn once', () => {
    const first = pick(played(), 'ASH_194')
    const pinged = resolve(first, { type: 'acceptChoice', choiceId: first.pendingChoices![0].id, targetInstanceId: 'hulk' })
    expect(find(pinged, 'hulk')!.damage).toBe(1)
    const attacked = resolve(pinged, { type: 'attack', attackerId: squadron(pinged).instanceId, target: { kind: 'unit', instanceId: 'hulk' } })
    expect(find(attacked, 'hulk')!.damage).toBe(5)
    expect(attacked.pendingChoices ?? []).toEqual([])
    expect(attacked.activePlayer).toBe('opponent')
  })
})

describe('a deploying leader orders Shielded and Ambush the same way', () => {
  const imp = (id: string, name: string) => card({ id, type: 'unit', arena: 'ground', traits: ['Imperial'], keywords: [{ name }] })
  const cards = {
    ...CARDS,
    ASH_008: card({ id: 'ASH_008', type: 'leader', cost: 7, power: 5, hp: 8 }), // Moff Gideon: gains the keywords of an Imperial in the discard
    IMP_AMBUSH: imp('IMP_AMBUSH', 'Ambush'),
    IMP_SHIELD: imp('IMP_SHIELD', 'Shielded'),
    FOE: F.FOE,
  }
  const undeployed: LeaderState = { cardId: 'ASH_008', deployed: false, epicActionUsed: false, exhausted: false }
  const deploy = (discard: string[], foes: UnitState[] = [unit('e1', 'FOE')]): GameState => resolve(state({
    cards,
    players: { player: player({ leader: undeployed, resources: ready(7), discard }), opponent: player({ units: foes }) },
  }), { type: 'deployLeader' })
  const moff = (s: GameState): UnitState => s.players.player.units.find(u => u.cardId === 'ASH_008')!

  it('asks which resolves next when he gains both', () => {
    const s = deploy(['IMP_AMBUSH', 'IMP_SHIELD'])
    expect(orderAsk(s)?.candidates.map(c => c.cardId).sort()).toEqual([KEYWORD_AMBUSH, KEYWORD_SHIELDED].sort())
    expect(shields(moff(s))).toBe(0)
    const ambushing = pick(s, KEYWORD_AMBUSH)
    const after = resolve(ambushing, { type: 'attack', attackerId: moff(ambushing).instanceId, target: { kind: 'unit', instanceId: 'e1' } })
    expect(moff(after).damage).toBe(1)
    expect(shields(moff(after))).toBe(1)
  })

  it('asks nothing with Shielded alone, or with no unit to ambush', () => {
    const alone = deploy(['IMP_SHIELD'])
    expect(alone.pendingChoices ?? []).toEqual([])
    expect(shields(moff(alone))).toBe(1)
    const noTarget = deploy(['IMP_AMBUSH', 'IMP_SHIELD'], [])
    expect(noTarget.pendingChoices ?? []).toEqual([])
    expect(shields(moff(noTarget))).toBe(1)
    expect(moff(noTarget).exhausted, 'a leader deploys ready').toBe(false)
  })
})
