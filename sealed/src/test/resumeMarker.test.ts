import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { buildCardDb, normaliseCard } from '../engine/cardDb'
import { initGame } from '../engine/initGame'
import { seededShuffle, nextSeed } from '../engine/rng'
import { hasPendingChoices } from '../engine/types'
import { randomAi } from '../ai/randomAi'
import { setupAi } from '../ai/setupAi'
import { buildCoverageDecks } from '../bench/coverageDecks'
import { poolFor } from '../bench/setPools'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { TOKEN_SHIELD } from '../engine/tokenUpgrades'
import { state, player, unit as fixtureUnit, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, UnitState } from '../engine/types'

/**
 * `pendingResumeActive` remembers whose action a handed-over choice belongs to, so the turn returns
 * to them once the choices drain. It is only meaningful while something is outstanding. A marker
 * left behind after its choices drained is read by the NEXT choice to drain, which then restores a
 * player who is not acting and advances the turn from them: the other player acts twice in a row.
 *
 * Every position here ends one action with the marker set, then has the next player answer a choice
 * of their own (Cutthroat Podracer's When Played) and checks the turn passes to the other side.
 */

const POOL = poolFor(['LAW', 'TS26'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}

const F: Record<string, EngineCard> = {
  ...CARDS,
  LAW_079: real('LAW_079'), // K-2SO: On Attack, you may deal 3 damage to a damaged ground unit
  LAW_213: real('LAW_213'), // Cutthroat Podracer: When Played, you may deal 2 damage to an exhausted ground unit
  TS26_66: real('TS26_66'), // Wartime Pirate: On Attack, an opponent deals 1 damage to a unit
  ASH_062: card({ id: 'ASH_062', type: 'unit', arena: 'ground', cost: 4, power: 5, hp: 4, keywords: [{ name: 'Shielded' }] }), // The Mandalorian
  GRD: card({ id: 'GRD', type: 'unit', arena: 'ground', cost: 2, power: 2, hp: 8 }),
}
const unit = (instanceId: string, cardId: string, over: Partial<UnitState> = {}): UnitState =>
  fixtureUnit(instanceId, cardId, { arena: 'ground', ...over })
type Side = Parameters<typeof player>[0]
const board = (mine: Side, theirs: Side, over: Partial<GameState> = {}) =>
  state({
    cards: F,
    players: {
      player: player({ resources: ready(10), deck: [], ...mine }),
      opponent: player({ resources: ready(10), deck: [], ...theirs }),
    },
    ...over,
  })
const attack = (s: GameState, attackerId: string, target?: string) =>
  resolve(s, { type: 'attack', attackerId, target: target ? { kind: 'unit', instanceId: target } : { kind: 'base' } })
const accept = (s: GameState, targetInstanceId?: string) => {
  expect(s.pendingChoices?.length ?? 0, 'a choice is raised').toBeGreaterThan(0)
  return resolve(s, { type: 'acceptChoice', choiceId: s.pendingChoices![0].id, targetInstanceId })
}
/** The side to act plays Cutthroat Podracer from hand and answers its When Played choice. */
const playPodracerAndAnswer = (s: GameState, target: string) => {
  const played = resolve(s, { type: 'playUnit', handIndex: 0 })
  expect(played.pendingChoices?.[0]?.controller).toBe(s.activePlayer)
  return accept(played, target)
}

describe('the resume marker does not outlive the choices it was set for', () => {
  it("an attacker's own On Attack choice (K-2SO), answered, leaves no marker and the next choice passes the turn once", () => {
    const s = board({ units: [unit('me', 'LAW_079')] }, { units: [unit('e', 'GRD', { damage: 1, exhausted: true })], hand: ['LAW_213'] })
    const done = accept(attack(s, 'me'), 'e')
    expect(done.activePlayer).toBe('opponent')
    expect.soft(done.pendingResumeActive).toBeUndefined()

    const answered = playPodracerAndAnswer(done, 'me')
    expect(answered.activePlayer).toBe('player')
  })

  it('an On Attack choice the opponent makes (Wartime Pirate), answered, leaves no marker', () => {
    const s = board({ units: [unit('me', 'TS26_66')] }, { units: [unit('e', 'GRD')], hand: ['LAW_213'] })
    const attacked = attack(s, 'me')
    expect(attacked.pendingChoices?.[0]?.controller).toBe('opponent')
    const done = accept(attacked, 'e')
    expect(done.activePlayer).toBe('opponent')
    expect.soft(done.pendingResumeActive).toBeUndefined()

    const answered = playPodracerAndAnswer(done, 'me')
    expect(answered.activePlayer).toBe('player')
  })

  it("a combat prevention offer the defender's controller answers (The Mandalorian) leaves no marker", () => {
    const s = board(
      { units: [unit('mando', 'ASH_062', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] }), unit('ally', 'GRD')], hand: ['LAW_213'] },
      { units: [unit('e', 'GRD')] },
      { activePlayer: 'opponent' },
    )
    const attacked = attack(s, 'e', 'ally')
    expect(attacked.pendingChoices?.[0]).toMatchObject({ kind: 'mayPreventDamage', controller: 'player' })
    const done = accept(attacked)
    expect(done.activePlayer).toBe('player')
    expect.soft(done.pendingResumeActive).toBeUndefined()

    const answered = playPodracerAndAnswer(done, 'e')
    expect(answered.activePlayer).toBe('opponent')
  })
})

/**
 * The guard for the class. The marker is set in several places (an attack that suspends, a
 * prevention offer, a handed-over choice, a trigger order that puts the other side first) and a
 * drained queue can leave `resumeAfterChoice` by several exits, so a list of paths would rot. This
 * plays real games over every set's coverage decks and asserts that once nothing is outstanding, no
 * marker is left behind.
 */
describe('no resume marker survives a settled position in real games', () => {
  it('holds across a seeded sweep of coverage decks', () => {
    const pool = poolFor(['all'])
    const cardDb = buildCardDb(pool)
    const decks = buildCoverageDecks(pool, 1).decks
    const stale: string[] = []
    let markersSeen = 0

    decks.forEach((deck, d) => {
      const seed = nextSeed(2000 + d)
      const shuffleSeed = { v: seed }
      const shuffle = <T,>(arr: T[]): T[] => { shuffleSeed.v = nextSeed(shuffleSeed.v); return seededShuffle(arr, shuffleSeed.v) }
      let s: GameState = initGame(deck, deck, cardDb, { firstPlayer: 'player', shuffle, rngSeed: seed })
      for (let i = 0; i < 5000 && s.winner === null; i++) {
        const action = setupAi(s) ?? randomAi(s)
        if (!action) break
        const before = s
        s = resolve(s, action)
        // A finished game is left as the winning blow found it, and nothing reads it again.
        if (s.pendingResumeActive === undefined || s.winner !== null) continue
        markersSeen++
        const outstanding = hasPendingChoices(s) || (s.pendingTriggers ?? []).length > 0
        if (!outstanding && stale.length < 5) {
          const answered = (before.pendingChoices ?? []).map(c => `${c.kind}/${c.controller}`).join(', ')
          stale.push(`deck ${d}, action ${i} (${action.type}, ${before.phase}, choices before: ${answered || 'none'}): marker ${s.pendingResumeActive} left, active ${s.activePlayer}`)
        }
      }
    })

    expect(markersSeen, 'the sweep must actually hand a choice over').toBeGreaterThan(0)
    expect(stale).toEqual([])
  }, 60_000) // about 2s alone, several times that while the full suite runs alongside it
})
