import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * **The real pairing in ASH where one ability meets another's condition.**
 *
 * Luke Skywalker (ASH_112) is Unique and costs 6, so playing him triggers Grogu (ASH_018) as well as
 * his own When Played:
 *
 * | | |
 * | --- | --- |
 * | Luke, When Played | "If you control at least 4 units, deal 3 damage to each enemy unit." |
 * | Grogu, leader | "When you play a Unique unit that costs 4 or more: if this leader is ready, you may deploy him." |
 *
 * With two units already out, Luke arriving makes three: his condition is unmet at the moment the
 * batch is collected. Deploying Grogu makes four and meets it.
 *
 * So an ability that would do nothing *right now* is not an ability that will do nothing. The one that
 * can act resolves first and the board is read again afterwards, rather than the inert one being spent
 * while it is still inert.
 */
const LUKE = 'ASH_112'
const GROGU = 'ASH_018'

const cards = {
  ...CARDS,
  [LUKE]: card({ id: LUKE, name: 'Luke Skywalker', type: 'unit', arena: 'ground', cost: 6, power: 5, hp: 5, unique: true }),
  [GROGU]: card({ id: GROGU, name: 'Grogu', type: 'leader', cost: 5, power: 3, hp: 6 }),
  GRUNT: card({ id: 'GRUNT', type: 'unit', arena: 'ground', power: 1, hp: 6 }),
}

/** Grogu ready and undeployed, two friendly units out, Luke in hand and affordable. */
function board(): GameState {
  return state({
    cards,
    players: {
      player: player({
        leader: { cardId: GROGU, deployed: false, epicActionUsed: false, exhausted: false },
        hand: [LUKE],
        resources: ready(6),
        units: [unit('a', 'GRUNT'), unit('b', 'GRUNT')],
      }),
      opponent: player({ units: [unit('e1', 'GRUNT'), unit('e2', 'GRUNT')] }),
    },
  })
}

const choice = (s: GameState, kind: string) => (s.pendingChoices ?? []).find(c => c.kind === kind)
const enemyDamage = (s: GameState) => s.players.opponent.units.map(u => u.damage)

describe('Luke Skywalker and Grogu: a condition met by its own batch-mate', () => {
  it('does not ask an ordering question when only Grogu can act', () => {
    const played = resolve(board(), { type: 'playUnit', handIndex: 0 })
    expect(choice(played, 'chooseNextTrigger'), "Luke's condition is unmet, so there is nothing to order").toBeUndefined()
    expect(choice(played, 'mayDeployLeader'), "Grogu's offer is what is left").toBeDefined()
    expect(enemyDamage(played), 'and nothing has been dealt yet').toEqual([0, 0])
  })

  it("deploying Grogu meets Luke's condition, and Luke then fires", () => {
    const played = resolve(board(), { type: 'playUnit', handIndex: 0 })
    const deployed = resolve(played, { type: 'acceptChoice', choiceId: choice(played, 'mayDeployLeader')!.id })
    expect(deployed.players.player.leader.deployed).toBe(true)
    expect(deployed.players.player.units.length, 'two grunts, Luke and Grogu').toBe(4)
    expect(enemyDamage(deployed), 'Luke swept for 3 once the fourth unit landed').toEqual([3, 3])
  })

  it('declining the deploy leaves the condition unmet, so Luke does nothing', () => {
    const played = resolve(board(), { type: 'playUnit', handIndex: 0 })
    const declined = resolve(played, { type: 'skipTrigger', choiceId: choice(played, 'mayDeployLeader')!.id })
    expect(declined.players.player.leader.deployed).toBe(false)
    expect(enemyDamage(declined)).toEqual([0, 0])
    expect(declined.pendingTriggers ?? [], 'and the batch is finished either way').toEqual([])
  })
})
