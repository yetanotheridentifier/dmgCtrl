import { describe, it, expect } from 'vitest'
import secSet from './fixtures/secSet.json'
import { loadReport, replayUpTo } from './helpers/replayReport'
import { legalMoves } from '../engine/legalMoves'
import type { SwuCard } from '../data/cards'
import type { Action } from '../engine/actions'

/**
 * The reported game: the player leads with Cassian Andor (SEC_012), whose undeployed front reads
 * "Friendly units that have damaged an opponent's base this phase can't be attacked (unless they have
 * Sentinel)". Their High Command Councilor (`u1`) attacks the enemy base, and later in the same action
 * phase the opponent's High Command Councilor (`u2`) attacks it, which the front forbids.
 *
 * Move 16 is that attack, so the board is read just before it.
 */
const report = loadReport('cassianBaseAttackerAttacked')
const before = replayUpTo(report, 16, secSet as unknown as SwuCard[])
const attacks = legalMoves(before).filter((a): a is Extract<Action, { type: 'attack' }> => a.type === 'attack')

describe('the reported game where a unit that damaged the enemy base was attacked', () => {
  it('is the board the report describes: the opponent to act, Cassian undeployed, u1 having damaged their base', () => {
    expect(before.activePlayer).toBe('opponent')
    expect(before.players.player.leader).toMatchObject({ cardId: 'SEC_012', deployed: false })
    expect(before.players.player.units.map(u => u.instanceId)).toContain('u1')
    expect(before.players.opponent.base.damage).toBeGreaterThan(0)
  })

  it('does not offer the opponent an attack on u1', () => {
    expect(attacks.filter(a => a.target.kind === 'unit' && a.target.instanceId === 'u1')).toEqual([])
  })

  it('still offers u2 an attack (the base), so only the protected unit is closed off', () => {
    expect(attacks.some(a => a.attackerId === 'u2')).toBe(true)
  })
})
