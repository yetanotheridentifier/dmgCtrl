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
import { loadReport, replayUpTo } from './helpers/replayReport'
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
 * Every position in the first block below ends one action with the marker set, then has the next
 * player answer a choice of their own (Cutthroat Podracer's When Played) and checks the turn passes
 * to the other side. The blocks after it take the opposite failure, a marker that is never set.
 */

const POOL = poolFor(['LAW', 'TS26', 'ASH'])
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
  ASH_092: real('ASH_092'), // Foundling Rescue: you may defeat a unit with 2 or less remaining HP
  ASH_153: real('ASH_153'), // Green Leader: When Defeated, you may deal 2 damage to a unit
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
 * **#696.** The other half of the same rule: a marker that is never set at all.
 *
 * Answering your OWN choice can raise one for the other player, and control has to go to them to
 * answer it. Without the actor recorded at that hand-over, the turn advances from whoever answered
 * last, which gives the player who acted a second action in a row.
 *
 * Foundling Rescue is the shape the report caught (below): the caster answers their own
 * "defeat a unit", the defeated Green Leader's When Defeated belongs to the other player, and the
 * turn must pass to that player once it is answered, not back to the caster.
 */
describe('answering your own choice, when it hands one to the other player', () => {
  const rescue = () =>
    board(
      { hand: ['ASH_092'], units: [unit('mine', 'GRD')] },
      { units: [unit('green', 'ASH_153')] },
    )

  it('records the caster as the actor while the other player answers', () => {
    const played = resolve(rescue(), { type: 'playEvent', handIndex: 0 })
    expect(played.pendingChoices?.[0]).toMatchObject({ kind: 'selectUnitToDefeat', controller: 'player' })
    expect(played.activePlayer).toBe('player')

    const defeated = accept(played, 'green')
    expect(defeated.pendingChoices?.[0], "Green Leader's When Defeated").toMatchObject({ kind: 'mayDamage', controller: 'opponent' })
    expect(defeated.activePlayer, 'the opponent answers it').toBe('opponent')
    expect(defeated.pendingResumeActive, "the player's action is still unfinished").toBe('player')
  })

  it('passes the turn to the other player once they have answered', () => {
    const played = resolve(rescue(), { type: 'playEvent', handIndex: 0 })
    const answered = accept(accept(played, 'green'), 'mine')
    expect(answered.activePlayer, 'the caster does not act twice in a row').toBe('opponent')
    expect.soft(answered.pendingResumeActive).toBeUndefined()
    expect(answered.players.player.units.find(u => u.instanceId === 'mine')?.damage).toBe(2)
  })

  it('passes the turn the same way when the other player declines', () => {
    const played = resolve(rescue(), { type: 'playEvent', handIndex: 0 })
    const defeated = accept(played, 'green')
    const declined = resolve(defeated, { type: 'skipTrigger', choiceId: defeated.pendingChoices![0].id })
    expect(declined.activePlayer).toBe('opponent')
    expect.soft(declined.pendingResumeActive).toBeUndefined()
  })
})

/**
 * **#696 on the board it was reported from.** The same fixture `nestedDeployTargets.test.ts`
 * replays for #529, read at the earlier moment it also caught:
 *
 * - move 34: the opponent plays an event (their first action of the round: they hold the initiative)
 * - move 35: they answer its own choice, defeating the player's Green Leader
 * - move 36: the player answers Green Leader's When Defeated
 *
 * The opponent's action is over at that point, so the turn is the player's. The report's move 37 is
 * another opponent action, which is the defect recorded in the move list.
 *
 * `replayUpTo` counts moves, so the board after move 35 is `replayUpTo(report, 36)`.
 */
describe('#696: the reported game', () => {
  const report = loadReport('nestedDeployShieldTarget')

  it('hands control to the player with the opponent recorded as the actor', () => {
    const handed = replayUpTo(report, 36)
    expect(handed.pendingChoices?.[0]).toMatchObject({ kind: 'mayDamage', controller: 'player' })
    expect(handed.activePlayer).toBe('player')
    expect(handed.pendingResumeActive).toBe('opponent')
  })

  it('gives the turn to the player once they have answered', () => {
    const answered = replayUpTo(report, 37)
    expect(answered.pendingChoices ?? []).toEqual([])
    expect(answered.activePlayer, 'the opponent acted at move 34 and does not act again at 37').toBe('player')
    expect.soft(answered.pendingResumeActive).toBeUndefined()
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
