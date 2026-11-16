import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { legalMoves } from '../engine/legalMoves'
import { normaliseCard } from '../engine/cardDb'
import { poolFor } from '../bench/setPools'
import { defeatUnit } from '../engine/combat'
import { createCreditTokens, friendlyCreditTokens } from '../engine/effects'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { deployBlocker } from '../components/boardLayout'
import { state, player, card, ready, CARDS } from './helpers/engineFixtures'
import type { EngineCard, GameState, LeaderState, PendingChoice } from '../engine/types'

/**
 * Leaders that deploy through an ordinary Action with its own cost, not the Epic Action:
 *
 * - JTL_014 Admiral Trench: "Action [C=3, Exhaust]: If you control 6 or more resources, deploy this leader."
 * - SEC_008 Bail Organa: "Action [Exhaust, discard 2 cards from your hand]: If you control 4 or more
 *   resources, deploy this leader."
 *
 * Not an Epic Action, so it is not once per game: a deployed leader that is defeated returns to the
 * leader zone exhausted and deploys again once it is ready and the conditions hold.
 */

const POOL = poolFor(['JTL', 'SEC'])
const real = (id: string): EngineCard => {
  const [set, number] = id.split('_')
  const row = POOL.find(c => c.Set === set && String(c.Number) === number)
  if (!row) throw new Error(`${id} is not in the ${set} fixture`)
  return normaliseCard(row)
}
const F: Record<string, EngineCard> = {
  ...CARDS,
  JTL_014: real('JTL_014'),
  SEC_008: real('SEC_008'),
  A: card({ id: 'A', arena: 'ground', cost: 1 }),
  B: card({ id: 'B', arena: 'ground', cost: 2 }),
  C: card({ id: 'C', arena: 'ground', cost: 3 }),
}

type Side = Parameters<typeof player>[0]
const leader = (cardId: string, over: Partial<LeaderState> = {}): LeaderState =>
  ({ cardId, deployed: false, epicActionUsed: false, exhausted: false, ...over })
const board = (mine: Side): GameState => state({
  cards: F,
  players: {
    player: player({ resources: ready(10), deck: [], ...mine }),
    opponent: player({ resources: ready(10), deck: [] }),
  },
})
/** `n` resources, the first `exhausted` of them exhausted. */
const resources = (n: number, exhausted = 0) => ready(n).map((r, i) => ({ ...r, exhausted: i < exhausted }))
const readyCount = (s: GameState) => s.players.player.resources.filter(r => !r.exhausted).length
const deploys = (s: GameState) => legalMoves(s).some(a => a.type === 'deployLeader')
const deploy = (s: GameState) => resolve(s, { type: 'deployLeader' })
const choice = (s: GameState): PendingChoice => {
  const c = s.pendingChoices?.[0]
  if (!c) throw new Error('no pending choice')
  return c
}
const accept = (s: GameState, handIndex: number) => resolve(s, { type: 'acceptChoice', choiceId: choice(s).id, handIndex })
const leaderUnitOf = (s: GameState) => s.players.player.units.find(u => u.isLeader)

/** The leader unit defeated (back in the leader zone, exhausted), and the player to act again. */
const defeated = (s: GameState): GameState => ({ ...defeatUnit(s, leaderUnitOf(s)!.instanceId), activePlayer: 'player' })
const deployedAndDefeated = (s: GameState): GameState => defeated(deploy(s))
const readied = (s: GameState): GameState =>
  ({ ...s, players: { ...s.players, player: { ...s.players.player, leader: { ...s.players.player.leader, exhausted: false } } } })

describe('JTL_014 Admiral Trench: Action [C=3, Exhaust]: if you control 6 or more resources, deploy this leader', () => {
  const trench = (mine: Side = {}) => board({ leader: leader('JTL_014'), ...mine })

  it('deploying pays 3 and exhausts the leader, and does not spend the epic action', () => {
    const s = deploy(trench({ resources: resources(6) }))
    expect(leaderUnitOf(s)?.cardId).toBe('JTL_014')
    expect(s.players.player.leader).toMatchObject({ deployed: true, epicActionUsed: false, exhausted: true })
    expect(readyCount(s)).toBe(3)
  })

  it('needs 6 resources controlled: 5 ready ones are not enough, 6 with 3 of them ready are', () => {
    expect(deploys(trench({ resources: resources(5) }))).toBe(false)
    expect(deployBlocker(trench({ resources: resources(5) }))).toBe('Needs 6 resources; you have 5')
    expect(deploys(trench({ resources: resources(6, 3) }))).toBe(true)
  })

  it('needs the 3 paid: 6 controlled with only 2 ready is not enough, unless a Credit token makes up the rest', () => {
    const short = trench({ resources: resources(6, 4) })
    expect(deploys(short)).toBe(false)
    expect(deployBlocker(short)).toBe('Costs 3 to deploy; you can pay 2')
    const credited = createCreditTokens(short, 'player', 1)
    expect(deploys(credited)).toBe(true)
    const asked = deploy(credited)
    expect(choice(asked)).toMatchObject({ kind: 'payWith', cost: 3 })
    const end = resolve(asked, { type: 'acceptChoice', choiceId: choice(asked).id, credits: 1 })
    expect(end.players.player.leader.deployed).toBe(true)
    expect(friendlyCreditTokens(end, 'player')).toBe(0)
    expect(readyCount(end)).toBe(0)
  })

  it('needs the leader ready, since exhausting it is part of the cost', () => {
    const s = trench({ leader: leader('JTL_014', { exhausted: true }), resources: resources(6) })
    expect(deploys(s)).toBe(false)
    expect(deployBlocker(s)).toBe('Your leader is exhausted')
  })

  it('is not once per game: defeated, he deploys again once ready', () => {
    const defeated = deployedAndDefeated(trench({ resources: resources(10) }))
    expect(defeated.players.player.leader).toMatchObject({ deployed: false, epicActionUsed: false, exhausted: true })
    expect(deploys(defeated)).toBe(false)
    const again = readied(defeated)
    expect(deploys(again)).toBe(true)
    expect(deploy(again).players.player.leader.deployed).toBe(true)
  })
})

describe('SEC_008 Bail Organa: Action [Exhaust, discard 2 cards from your hand]: if you control 4 or more resources, deploy this leader', () => {
  const bail = (mine: Side = {}) => board({ leader: leader('SEC_008'), hand: ['A', 'B', 'C'], ...mine })

  it('deploying exhausts the leader, discards the 2 cards the player picks, spends no resources and not the epic action', () => {
    const asked = deploy(bail({ resources: resources(4) }))
    expect(choice(asked)).toMatchObject({ kind: 'selectHandCardThen', controller: 'player', handIndices: [0, 1, 2] })
    expect(leaderUnitOf(asked)).toBeUndefined()
    const one = accept(asked, 2)
    expect(one.players.player.discard).toEqual(['C'])
    expect(choice(one)).toMatchObject({ kind: 'selectHandCardThen', handIndices: [0, 1] })
    const end = accept(one, 0)
    expect(end.pendingChoices ?? []).toHaveLength(0)
    expect(end.players.player.hand).toEqual(['B'])
    expect(end.players.player.discard).toEqual(['C', 'A'])
    expect(leaderUnitOf(end)?.cardId).toBe('SEC_008')
    expect(end.players.player.leader).toMatchObject({ deployed: true, epicActionUsed: false, exhausted: true })
    expect(readyCount(end)).toBe(4)
    expect(end.activePlayer).toBe('opponent')
  })

  it('needs 4 resources controlled, ready or not', () => {
    expect(deploys(bail({ resources: resources(3) }))).toBe(false)
    expect(deployBlocker(bail({ resources: resources(3) }))).toBe('Needs 4 resources; you have 3')
    expect(deploys(bail({ resources: resources(4, 4) }))).toBe(true)
  })

  it('needs 2 cards in hand to discard', () => {
    const s = bail({ resources: resources(4), hand: ['A'] })
    expect(deploys(s)).toBe(false)
    expect(deployBlocker(s)).toBe('Discards 2 cards to deploy; you have 1')
  })

  it('needs the leader ready, since exhausting it is part of the cost', () => {
    expect(deploys(bail({ leader: leader('SEC_008', { exhausted: true }), resources: resources(4) }))).toBe(false)
  })

  it('is not once per game: defeated, he deploys again once ready', () => {
    const s = bail({ resources: resources(4), hand: ['A', 'B', 'C', 'A', 'B'] })
    const back = defeated(accept(accept(deploy(s), 0), 0))
    expect(back.players.player.leader).toMatchObject({ deployed: false, epicActionUsed: false, exhausted: true })
    expect(deploys(back)).toBe(false)
    expect(deploys(readied(back))).toBe(true)
  })
})
