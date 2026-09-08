import { describe, it, expect } from 'vitest'
import { resolve } from '../engine/resolve'
import '../engine/cardDefinitions' // side effect: registers card behaviours
import { state, player, unit, card, ready, CARDS } from './helpers/engineFixtures'
import { loadReport, replayUpTo } from './helpers/replayReport'
import { isLeaderUnit } from '../engine/keywords'
import type { GameState } from '../engine/types'

/**
 * **"Exhaust a friendly leader" has to reach the leader wherever it currently is.**
 *
 * A leader in the base zone carries `leader.exhausted`. A DEPLOYED leader is a unit on the board with
 * its own `exhausted`, and `deployLeader` never touches the base-zone flag again: regroup readies the
 * two independently. So paying the cost by setting `leader.exhausted` charges nothing once the leader
 * has deployed. The leader unit keeps its action and can still attack that round.
 *
 * Mando's N-1 Starfighter is the only card that can ask this of a deployed leader. The other four
 * leader-exhaust costs are leader FRONT abilities, and `collectLeaderTriggers` returns nothing once
 * the leader is deployed, so they can never see one. This is a unit ability, so it always can.
 */

const F = {
  ...CARDS,
  ASH_203: card({ id: 'ASH_203', name: "Mando's N-1 Starfighter", type: 'unit', arena: 'space', cost: 2, power: 1, hp: 3 }),
}

const choice = (s: GameState) => s.pendingChoices![0]
const leaderUnitOf = (s: GameState) => s.players.player.units.find(u => isLeaderUnit(s, u))

/** Mando's N-1 ready in space, and the player's leader either deployed as a unit or still in base. */
const board = (deployed: boolean, leaderExhausted = false) => state({
  cards: F,
  players: {
    player: player({
      resources: ready(10),
      leader: { cardId: 'TST_L', deployed, epicActionUsed: deployed, exhausted: false },
      units: deployed
        ? [unit('n1', 'ASH_203', { arena: 'space' }), unit('L', 'TST_L', { isLeader: true, exhausted: leaderExhausted })]
        : [unit('n1', 'ASH_203', { arena: 'space' })],
    }),
    opponent: player(),
  },
})

describe("Mando's N-1 Starfighter (203) — the leader-exhaust cost", () => {
  it('exhausts the base-zone leader when it has not deployed (control)', () => {
    const atk = resolve(board(false), { type: 'attack', attackerId: 'n1', target: { kind: 'base' } })
    expect(choice(atk)).toMatchObject({ kind: 'mayExhaustLeaderBuffSelf', power: 2 })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: choice(atk).id })
    expect(done.players.player.leader.exhausted).toBe(true)
    expect(done.players.opponent.base.damage, 'power 1 plus the 2 buff').toBe(3)
  })

  it('exhausts the leader UNIT when the leader is deployed', () => {
    const atk = resolve(board(true), { type: 'attack', attackerId: 'n1', target: { kind: 'base' } })
    expect(choice(atk)).toMatchObject({ kind: 'mayExhaustLeaderBuffSelf' })
    const done = resolve(atk, { type: 'acceptChoice', choiceId: choice(atk).id })
    expect(leaderUnitOf(done)!.exhausted, 'the cost lands on the leader that is actually in play').toBe(true)
    expect(done.players.opponent.base.damage, 'and the buff still applies').toBe(3)
  })

  it('is not offered at all when the deployed leader is already exhausted', () => {
    const atk = resolve(board(true, true), { type: 'attack', attackerId: 'n1', target: { kind: 'base' } })
    expect(atk.pendingChoices ?? [], 'there is no cost left to pay').toHaveLength(0)
    expect(atk.players.opponent.base.damage, 'so no buff either').toBe(1)
  })
})

/**
 * The board the ticket was filed from. Move 43 is the attack that raised the offer, move 44 accepts
 * it, and the reporter's deployed Grogu (`u7`) stayed ready through both.
 */
describe('#577: the reported game', () => {
  const report = loadReport('deployedLeaderExhaust')

  it('exhausts the reporter\'s deployed Grogu when the cost is paid', () => {
    const before = replayUpTo(report, 44)
    expect(before.players.player.leader.deployed, 'Grogu is on the board as a unit').toBe(true)
    expect(leaderUnitOf(before)!.exhausted, 'and is ready when the offer is made').toBe(false)

    const after = replayUpTo(report, 45)
    expect(leaderUnitOf(after)!.exhausted).toBe(true)
  })
})
