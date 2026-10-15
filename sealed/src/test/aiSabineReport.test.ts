import { describe, it, expect } from 'vitest'
import { beamReplyAi, makeBeamGreedy, BEAM_REPLY_LIMITS, BEAM_REPLY_STOPS_UNPASSED_LIMITS } from '../ai/greedyAi'
import { lastSearchTrace, clearSearchTrace, type BeamLimits } from '../ai/search'
import { DEFAULT_WEIGHTS } from '../ai/evaluate'
import { resolveAi } from '../ai/registry'
import { legalMoves } from '../engine/legalMoves'
import { loadReport, replayUpTo } from './helpers/replayReport'
import { state, player, card, unit, CARDS } from './helpers/engineFixtures'
import type { GameState, LeaderState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * A line the search stops while the opponent has claimed the initiative ends in our own pass, and that
 * pass ends the action phase. So the board it stops at has to be scored after that pass, the same way
 * the root `pass` candidate is, or a move that does nothing (or worse) looks better than passing simply
 * because its line is scored before the round boundary and the pass line after it.
 *
 * Reported from play as Sabine Wren (ASH_006) handing out two Advantage tokens with nothing left to
 * play, and walked on the attached replay rather than reasoned about: her ability's line peaked on the
 * mid-round board (the bot keeps the turn because the player has claimed, and the beam never passes
 * for itself), while `pass` was scored after the regroup and the player's opening reply of the next
 * round. The grant she pays for is not what the search valued: the evaluation does not read it.
 */

const sabineBot = (limits: BeamLimits) => makeBeamGreedy(DEFAULT_WEIGHTS, { ...limits, explain: true })

describe('the reported position: Sabine Wren with nothing left to play (filed report)', () => {
  const report = loadReport('sabineNothingToPlay')
  /** Move 21 is `Opp Sabine Wren ability`, straight after the player took the initiative. */
  const board = replayUpTo(report, 21)

  it('replays to the decision the report is about', () => {
    expect(report.moves[21].action).toEqual({ type: 'useLeaderAbility', index: 0 })
    expect(board.phase).toBe('action')
    expect(board.activePlayer, 'the bot is to move').toBe('opponent')
    expect(board.initiativeTakenBy, 'the player has claimed, so our pass ends the phase').toBe('player')
    expect(board.players.opponent.resources.filter(r => !r.exhausted), 'nothing left to pay with').toHaveLength(0)
    expect(legalMoves(board)).toEqual([{ type: 'useLeaderAbility', index: 0 }, { type: 'pass' }])
  })

  it('the shipped bot passes rather than hand over two Advantage tokens for nothing', () => {
    expect(beamReplyAi(board)).toEqual({ type: 'pass' })
  })

  it('scores the ability at the same point as the pass: after the round boundary', () => {
    clearSearchTrace()
    sabineBot(BEAM_REPLY_LIMITS)(board)
    const [ability, pass] = lastSearchTrace()!.lines!
    expect(ability.board.round, 'the ability line is scored past its own closing pass').toBe(board.round + 1)
    expect(pass.board.round).toBe(board.round + 1)
    expect(ability.value).toBeLessThan(pass.value)
  })

  it('the control still uses it, so an A/B against it measures this change', () => {
    expect(resolveAi('beam-reply-stops-unpassed')(board)).toEqual({ type: 'useLeaderAbility', index: 0 })
    expect(sabineBot(BEAM_REPLY_STOPS_UNPASSED_LIMITS)(board)).toEqual({ type: 'useLeaderAbility', index: 0 })
  })
})

describe('the matched position: Sabine Wren with a unit to play (filed report)', () => {
  const report = loadReport('sabineThenUnit')
  /** Move 16 is `Opp Sabine Wren ability` as round 3 opens, with 4 resources ready. */
  const board = replayUpTo(report, 16)

  it('replays to the decision', () => {
    expect(report.moves[16].action).toEqual({ type: 'useLeaderAbility', index: 0 })
    expect(board.activePlayer).toBe('opponent')
    expect(board.initiativeTakenBy).toBeNull()
    expect(board.players.opponent.resources.filter(r => !r.exhausted)).toHaveLength(4)
  })

  it('the shipped bot still uses the ability, and its line plays a unit to collect the Shielded', () => {
    clearSearchTrace()
    const chosen = sabineBot(BEAM_REPLY_LIMITS)(board)
    expect(chosen).toEqual({ type: 'useLeaderAbility', index: 0 })
    const moves = legalMoves(board)
    const line = lastSearchTrace()!.lines![moves.findIndex(m => m.type === 'useLeaderAbility')]
    expect(line.path[1]?.type, 'the next action plays the unit that gains Shielded').toBe('playUnit')
    // The explaining copy is the shipped search with a readout, so the shipped bot itself must agree.
    expect(beamReplyAi(board)).toEqual(chosen)
  })
})

describe('a scripted position: any action, once the opponent has claimed', () => {
  const undeployed = (cardId: string): LeaderState => ({ cardId, deployed: false, epicActionUsed: false, exhausted: false })
  const cards = { ...CARDS, ASH_006: card({ id: 'ASH_006', type: 'leader', cost: 5, power: 3, hp: 5 }) }

  /** The opponent has claimed and holds an exhausted 3-power unit that readies at regroup. */
  const claimed = (overrides: Partial<GameState> = {}): GameState => state({
    cards,
    initiative: 'opponent',
    initiativeTakenBy: 'opponent',
    activePlayer: 'player',
    players: {
      player: player({ leader: undeployed('ASH_006'), units: [unit('u1', 'TST_U4', { exhausted: true })] }),
      opponent: player({ units: [unit('e1', 'TST_U1', { exhausted: true })] }),
    },
    ...overrides,
  })

  it('passes rather than pay for a grant no unit can collect this phase', () => {
    const s = claimed()
    expect(legalMoves(s).map(m => m.type)).toEqual(['useLeaderAbility', 'pass'])
    expect(beamReplyAi(s)).toEqual({ type: 'pass' })
  })

  it('which the control does not, so it is the closing pass and not the ability that changed', () => {
    expect(sabineBot(BEAM_REPLY_STOPS_UNPASSED_LIMITS)(claimed())).toEqual({ type: 'useLeaderAbility', index: 0 })
  })
})
