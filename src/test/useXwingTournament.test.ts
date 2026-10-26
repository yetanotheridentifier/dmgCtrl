import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useXwingTournament, type XwingTournamentList } from '../hooks/useXwingTournament'

const MINE: XwingTournamentList = {
  name: 'Howlrunner swarm',
  pilots: [{ name: 'howlrunner', ship: 'tielnfighter', points: 49 }],
  deficit: 1,
}
const ACES: XwingTournamentList = { name: 'Resistance aces', pilots: [{ name: 'poedameron', ship: 't70xwing', points: 50 }], deficit: 0 }
const PHOENIX: XwingTournamentList = { name: 'Phoenix Squadron', pilots: [{ name: 'herasyndulla', ship: 'vcx100lightfreighter', points: 48 }], deficit: 2 }
const NO_LIST: XwingTournamentList = { name: 'No list', pilots: [], deficit: 0 }

beforeEach(() => localStorage.clear())

function started() {
  const hook = renderHook(() => useXwingTournament())
  act(() => hook.result.current.startTournament(4, 'Chance Engagement', MINE, ACES))
  return hook
}

describe('useXwingTournament', () => {

  it('has no tournament until one is started', () => {
    const { result } = renderHook(() => useXwingTournament())
    expect(result.current.tournament).toBeNull()
    expect(result.current.roundInProgress).toBe(false)
  })

  it('starting a tournament fixes your list and the rounds, and starts round 1 against the chosen opponent', () => {
    const { result } = started()
    const t = result.current.tournament!
    expect(t.totalRounds).toBe(4)
    expect(t.player).toEqual(MINE)
    expect(t.rounds).toEqual([{ opponent: ACES, scenario: 'Chance Engagement', result: null, playerScore: 0, opponentScore: 0 }])
    expect(result.current.roundInProgress).toBe(true)
  })

  it('records each round from the game: result and scores', () => {
    const { result } = started()
    act(() => result.current.completeRound('won', 23, 9))
    expect(result.current.tournament!.rounds[0]).toEqual({ opponent: ACES, scenario: 'Chance Engagement', result: 'won', playerScore: 23, opponentScore: 9 })
    expect(result.current.roundInProgress).toBe(false)
  })

  it('the next round is played against the opponent chosen for it, No list included', () => {
    const { result } = started()
    act(() => result.current.completeRound('won', 23, 9))
    act(() => result.current.startRound(PHOENIX, 'Chance Engagement'))
    act(() => result.current.completeRound('lost', 11, 20))
    act(() => result.current.startRound(NO_LIST, 'Chance Engagement'))
    expect(result.current.tournament!.rounds.map(r => r.opponent.name)).toEqual(['Resistance aces', 'Phoenix Squadron', 'No list'])
    expect(result.current.roundInProgress).toBe(true)
  })

  it('each round keeps the scenario chosen for it', () => {
    const { result } = started()
    act(() => result.current.completeRound('won', 23, 9))
    act(() => result.current.startRound(PHOENIX, 'Salvage Mission'))
    act(() => result.current.completeRound('lost', 11, 20))
    act(() => result.current.startRound(NO_LIST, 'None'))
    expect(result.current.tournament!.rounds.map(r => r.scenario)).toEqual(['Chance Engagement', 'Salvage Mission', 'None'])
  })

  it('a tournament saved with one scenario for every round reopens with it on each round', () => {
    localStorage.setItem('xwing_tournament', JSON.stringify({
      totalRounds: 3,
      scenario: 'Ancient Knowledge',
      player: MINE,
      rounds: [
        { opponent: ACES, result: 'won', playerScore: 23, opponentScore: 9 },
        { opponent: PHOENIX, result: null, playerScore: 0, opponentScore: 0 },
      ],
    }))
    const { result } = renderHook(() => useXwingTournament())
    expect(result.current.tournament!.rounds.map(r => r.scenario)).toEqual(['Ancient Knowledge', 'Ancient Knowledge'])
    expect(result.current.roundInProgress).toBe(true)
  })

  it('a round under way is not replaced by starting another', () => {
    const { result } = started()
    act(() => result.current.startRound(PHOENIX, 'None'))
    expect(result.current.tournament!.rounds).toHaveLength(1)
    expect(result.current.tournament!.rounds[0].opponent).toEqual(ACES)
  })

  it('counts the record and the margin, the total of the score differences', () => {
    const { result } = started()
    act(() => result.current.completeRound('won', 23, 9))
    act(() => result.current.startRound(PHOENIX, 'None'))
    act(() => result.current.completeRound('lost', 11, 20))
    expect(result.current.totals).toEqual({ won: 1, lost: 1, drawn: 0 })
    expect(result.current.margin).toBe(5)
  })

  it('a drawn game counts as drawn and adds nothing to the margin', () => {
    const { result } = started()
    act(() => result.current.completeRound('drawn', 20, 20))
    expect(result.current.totals).toEqual({ won: 0, lost: 0, drawn: 1 })
    expect(result.current.margin).toBe(0)
  })

  it('is complete once every round has a result, and no further round starts', () => {
    const hook = renderHook(() => useXwingTournament())
    act(() => hook.result.current.startTournament(2, 'None', MINE, ACES))
    act(() => hook.result.current.completeRound('won', 30, 10))
    expect(hook.result.current.isComplete).toBe(false)
    act(() => hook.result.current.startRound(PHOENIX, 'None'))
    act(() => hook.result.current.completeRound('won', 25, 12))
    expect(hook.result.current.isComplete).toBe(true)
    act(() => hook.result.current.startRound(ACES, 'None'))
    expect(hook.result.current.tournament!.rounds).toHaveLength(2)
  })

  it('survives closing the app: a new instance reopens it as left', () => {
    const { result } = started()
    act(() => result.current.completeRound('won', 23, 9))
    act(() => result.current.startRound(PHOENIX, 'Salvage Mission'))
    const reopened = renderHook(() => useXwingTournament())
    expect(reopened.result.current.tournament).toEqual(result.current.tournament)
    expect(reopened.result.current.roundInProgress).toBe(true)
  })

  it('dropping clears it, for this session and the next', () => {
    const { result } = started()
    act(() => result.current.dropTournament())
    expect(result.current.tournament).toBeNull()
    expect(renderHook(() => useXwingTournament()).result.current.tournament).toBeNull()
  })

  it('ignores saved state it cannot read', () => {
    localStorage.setItem('xwing_tournament', '{not json')
    expect(renderHook(() => useXwingTournament()).result.current.tournament).toBeNull()
  })

})
