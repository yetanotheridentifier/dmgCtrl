import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuTournamentScreen from '../components/swuTournamentScreen'
import type { Base } from '../hooks/useBases'
import type { TournamentState, TournamentRound } from '../hooks/useTournament'
import { useOrientation } from '../hooks/useOrientation'

vi.mock('../hooks/useOrientation')

const mockUserSettings = vi.hoisted(() => ({
  useHyperspace: false,
  meleePlayerGuid: '',
}))

vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))

function makeBase(set: string, number: string, name: string, aspects: string[], hp = 30): Base {
  return {
    set, number, name, subtitle: '', hp,
    frontArt: `https://cdn.swu-db.com/images/cards/${set}/${number}.png`,
    frontArtLowRes: null, hyperspaceArtHiRes: null, hyperspaceArt: null,
    epicAction: '', aspects, rarity: 'Common',
  }
}

const catacombs = makeBase('SOR', '026', 'Catacombs of Cadera', ['Aggression'])
const energyLab = makeBase('SOR', '022', 'Energy Conversion Lab', ['Cunning'], 25)
const jediTemple = makeBase('LOF', '021', 'Jedi Temple', ['Command'], 28)

vi.mock('../hooks/useBases', () => ({
  useBases: () => ({ bases: [catacombs, energyLab, jediTemple], loading: false, error: null }),
}))

const mockOnTournamentDropped = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnTournamentEnded = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../services/analytics', () => ({
  onImageLoadFailed: vi.fn().mockResolvedValue(undefined),
  onTournamentDropped: mockOnTournamentDropped,
  onTournamentEnded: mockOnTournamentEnded,
}))

const done = (n: number, result: 'won' | 'lost' | 'drawn', p: number, o: number): TournamentRound =>
  ({ roundNumber: n, playerScore: p, opponentScore: o, result, submitted: false })
const open = (n: number, p = 0, o = 0): TournamentRound =>
  ({ roundNumber: n, playerScore: p, opponentScore: o, result: null, submitted: false })

const tournament = (over: Partial<TournamentState> = {}): TournamentState => ({
  base: catacombs, format: 'premier', playMode: 'bo3', totalRounds: 5, rounds: [], ...over,
})

// The K2 board: three rounds played, the fourth next.
const threePlayed = tournament({ rounds: [done(1, 'won', 2, 1), done(2, 'lost', 0, 2), done(3, 'won', 2, 0)] })

type Props = Parameters<typeof SwuTournamentScreen>[0]

function makeProps(over: Partial<Props> = {}): Props {
  return {
    tournament: tournament(),
    matchInProgress: false,
    isComplete: false,
    totals: { won: 0, lost: 0, drawn: 0 },
    points: 0,
    hasPlayedGameInCurrentMatch: false,
    startMatch: vi.fn(),
    dropTournament: vi.fn(),
    onGoToGame: vi.fn(),
    onDrop: vi.fn(),
    onBack: vi.fn(),
    onHelp: vi.fn(),
    onSettings: vi.fn(),
    ...over,
  }
}

const renderHub = (over: Partial<Props> = {}) => render(<SwuTournamentScreen {...makeProps(over)} />)
const rows = () => within(screen.getByRole('list', { name: 'Rounds' })).getAllByRole('listitem')

beforeEach(() => {
  vi.mocked(useOrientation).mockReturnValue({ isPortrait: false, vmin: 390 })
  mockUserSettings.meleePlayerGuid = ''
  mockOnTournamentDropped.mockClear()
  mockOnTournamentEnded.mockClear()
})

describe('SwuTournamentScreen: header', () => {
  it('is titled Tournament and says the game, format, match and rounds', () => {
    renderHub({ tournament: tournament({ format: 'limited', playMode: 'bo1', totalRounds: 4 }) })
    expect(screen.getByRole('heading', { level: 1, name: 'Tournament' })).toBeInTheDocument()
    expect(screen.getByText('SWU · Limited · Best of 1 · 4 rounds')).toBeInTheDocument()
  })

  it('Back goes to setup, keeping the tournament', async () => {
    const onBack = vi.fn()
    const dropTournament = vi.fn()
    renderHub({ onBack, dropTournament })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
    expect(dropTournament).not.toHaveBeenCalled()
  })

  it('More opens Help and Settings', async () => {
    const onHelp = vi.fn()
    const onSettings = vi.fn()
    renderHub({ onHelp, onSettings })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Help' }))
    expect(onHelp).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalledOnce()
  })

  it('has none of the old selects', () => {
    renderHub()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})

describe('SwuTournamentScreen: record and base', () => {
  it('shows the record as W–L–D, the points and the counts in words', () => {
    renderHub({ tournament: threePlayed, totals: { won: 2, lost: 1, drawn: 0 }, points: 6 })
    const record = screen.getByRole('region', { name: 'Record' })
    expect(within(record).getByText('2–1–0')).toBeInTheDocument()
    expect(within(record).getByText('6 points')).toBeInTheDocument()
    expect(within(record).getByText('Won 2, lost 1, drawn 0')).toBeInTheDocument()
  })

  it('a single point reads 1 point', () => {
    renderHub({ totals: { won: 0, lost: 0, drawn: 1 }, points: 1 })
    expect(screen.getByText('1 point')).toBeInTheDocument()
  })

  it('starts at 0–0–0 and 0 points', () => {
    renderHub()
    expect(screen.getByText('0–0–0')).toBeInTheDocument()
    expect(screen.getByText('0 points')).toBeInTheDocument()
  })

  it('names your base for the tournament', () => {
    renderHub()
    const base = screen.getByRole('region', { name: 'Your base' })
    expect(within(base).getByText('Catacombs of Cadera')).toBeInTheDocument()
    expect(within(base).getByText('Your base for this tournament')).toBeInTheDocument()
  })
})

describe('SwuTournamentScreen: rounds', () => {
  it('lists every round, played or not', () => {
    renderHub({ tournament: threePlayed })
    expect(rows()).toHaveLength(5)
    expect(rows().map(r => within(r).getByText(/^Round \d+$/).textContent)).toEqual(['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5'])
  })

  it('a played round shows its result and the games score', () => {
    renderHub({ tournament: tournament({ rounds: [done(1, 'won', 2, 1), done(2, 'lost', 0, 2), done(3, 'drawn', 1, 1)] }) })
    expect(rows()[0]).toHaveTextContent('Won')
    expect(rows()[0]).toHaveTextContent('2–1')
    expect(rows()[1]).toHaveTextContent('Lost')
    expect(rows()[1]).toHaveTextContent('0–2')
    expect(rows()[2]).toHaveTextContent('Drawn')
    expect(rows()[2]).toHaveTextContent('1–1')
  })

  it('marks the next round and dims the ones after it', () => {
    renderHub({ tournament: threePlayed })
    expect(rows()[3]).toHaveTextContent('Next')
    expect(rows()[3]).toHaveAttribute('aria-current', 'step')
    expect(rows()[4].style.opacity).toBe('0.5')
    expect(rows()[2].style.opacity).not.toBe('0.5')
    expect(rows()[3].style.opacity).not.toBe('0.5')
  })

  it('a round under way reads In progress', () => {
    renderHub({ tournament: tournament({ rounds: [open(1)] }), matchInProgress: true })
    expect(rows()[0]).toHaveTextContent('In progress')
    expect(rows()[0]).toHaveAttribute('aria-current', 'step')
  })
})

describe('SwuTournamentScreen: next round', () => {
  it('Start round N starts the next match on your registered base', async () => {
    const startMatch = vi.fn()
    const onGoToGame = vi.fn()
    renderHub({ tournament: threePlayed, startMatch, onGoToGame })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start round 4' }))
    expect(startMatch).toHaveBeenCalledOnce()
    expect(onGoToGame).toHaveBeenCalledWith('bo3', catacombs)
  })

  it('with a match under way, Return to round N goes back to it without starting another', async () => {
    const startMatch = vi.fn()
    const onGoToGame = vi.fn()
    renderHub({ tournament: tournament({ rounds: [open(1)] }), matchInProgress: true, startMatch, onGoToGame })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Return to round 1' }))
    expect(startMatch).not.toHaveBeenCalled()
    expect(onGoToGame).toHaveBeenCalledWith('bo3')
  })
})

describe('SwuTournamentScreen: Player portal', () => {
  it('without a player ID, Enter player ID opens Settings', async () => {
    const onSettings = vi.fn()
    renderHub({ onSettings })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Enter player ID' }))
    expect(onSettings).toHaveBeenCalledOnce()
  })

  it('with a player ID, Player portal opens melee.gg', async () => {
    mockUserSettings.meleePlayerGuid = 'test-guid'
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null as unknown as Window)
    renderHub()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Player portal' }))
    expect(openSpy).toHaveBeenCalledWith('https://melee.gg/Player/Portal/test-guid', '_blank')
    openSpy.mockRestore()
  })
})

describe('SwuTournamentScreen: Drop', () => {
  const dropSheet = () => screen.getByRole('dialog', { name: 'Drop from the tournament?' })

  it('Drop opens a sheet with your record, Keep playing and Drop', async () => {
    renderHub({ tournament: threePlayed, totals: { won: 2, lost: 1, drawn: 0 }, points: 6 })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Drop' }))
    expect(within(dropSheet()).getByText('Your record (2–1–0, 6 points) is cleared and you go back to setup. This can’t be undone.')).toBeInTheDocument()
    expect(within(dropSheet()).getByRole('button', { name: 'Keep playing' })).toBeInTheDocument()
    expect(within(dropSheet()).getByRole('button', { name: 'Drop' })).toBeInTheDocument()
  })

  it('Keep playing closes the sheet and keeps the tournament', async () => {
    const dropTournament = vi.fn()
    renderHub({ dropTournament })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Drop' }))
    await user.click(within(dropSheet()).getByRole('button', { name: 'Keep playing' }))
    expect(screen.queryByRole('dialog', { name: 'Drop from the tournament?' })).not.toBeInTheDocument()
    expect(dropTournament).not.toHaveBeenCalled()
  })

  it('Drop in the sheet clears the tournament, records the drop and returns to setup', async () => {
    const dropTournament = vi.fn()
    const onDrop = vi.fn()
    renderHub({ tournament: threePlayed, dropTournament, onDrop })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Drop' }))
    await user.click(within(dropSheet()).getByRole('button', { name: 'Drop' }))
    expect(mockOnTournamentDropped).toHaveBeenCalledWith(3, 'premier', 'bo3')
    expect(dropTournament).toHaveBeenCalledOnce()
    expect(onDrop).toHaveBeenCalledOnce()
  })
})

describe('SwuTournamentScreen: complete', () => {
  const finished = tournament({ totalRounds: 2, rounds: [done(1, 'won', 2, 0), done(2, 'won', 1, 0)] })

  it('is titled Tournament complete, with the final record, Finish and Player portal, and no Drop', () => {
    renderHub({ tournament: finished, isComplete: true, totals: { won: 2, lost: 0, drawn: 0 }, points: 6 })
    expect(screen.getByRole('heading', { level: 1, name: 'Tournament complete' })).toBeInTheDocument()
    expect(screen.getByText('2–0–0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter player ID' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drop' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Start|Return to) round/ })).not.toBeInTheDocument()
    expect(rows().some(r => r.textContent?.includes('Next'))).toBe(false)
  })

  it('Finish records the result, clears the tournament and returns to setup', async () => {
    const dropTournament = vi.fn()
    const onDrop = vi.fn()
    renderHub({ tournament: finished, isComplete: true, totals: { won: 2, lost: 0, drawn: 0 }, points: 6, dropTournament, onDrop })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Finish' }))
    expect(mockOnTournamentEnded).toHaveBeenCalledWith(2, 2, 0, 0, 6, 'premier', 'bo3')
    expect(mockOnTournamentDropped).not.toHaveBeenCalled()
    expect(dropTournament).toHaveBeenCalledOnce()
    expect(onDrop).toHaveBeenCalledOnce()
  })
})

describe('SwuTournamentScreen: change base between games (Limited, best of 3)', () => {
  const betweenGames = tournament({ format: 'limited', totalRounds: 3, rounds: [open(1)] })
  const changeBase = () => screen.queryByRole('button', { name: 'Change base' })

  it('is offered after a game of the match has been played', () => {
    renderHub({ tournament: betweenGames, matchInProgress: true, hasPlayedGameInCurrentMatch: true })
    expect(changeBase()).toBeInTheDocument()
  })

  it.each([
    ['in Premier', { tournament: tournament({ rounds: [open(1)] }), matchInProgress: true, hasPlayedGameInCurrentMatch: true }],
    ['in Eternal', { tournament: tournament({ format: 'eternal', rounds: [open(1)] }), matchInProgress: true, hasPlayedGameInCurrentMatch: true }],
    ['in best of 1', { tournament: tournament({ format: 'limited', playMode: 'bo1', rounds: [open(1)] }), matchInProgress: true, hasPlayedGameInCurrentMatch: true }],
    ['before a game of the match is played', { tournament: betweenGames, matchInProgress: true, hasPlayedGameInCurrentMatch: false }],
    ['between rounds', { tournament: tournament({ format: 'limited', rounds: [done(1, 'won', 2, 0)] }), matchInProgress: false }],
  ] as [string, Partial<Props>][])('is not offered %s', (_, over) => {
    renderHub(over)
    expect(changeBase()).not.toBeInTheDocument()
  })

  it('opens the base sheet on the bases of your set, and the base chosen plays the next game', async () => {
    const onGoToGame = vi.fn()
    renderHub({ tournament: betweenGames, matchInProgress: true, hasPlayedGameInCurrentMatch: true, onGoToGame })
    const user = userEvent.setup()
    await user.click(changeBase()!)
    const sheet = screen.getByRole('dialog', { name: 'Choose your base' })
    expect(within(sheet).queryByRole('button', { name: /^Jedi Temple/ })).not.toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: /^Energy Conversion Lab/ }))
    expect(screen.queryByRole('dialog', { name: 'Choose your base' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Your base' })).getByText('Energy Conversion Lab')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Return to round 1' }))
    expect(onGoToGame).toHaveBeenCalledWith('bo3', energyLab)
  })

  it('the next round goes back to your registered base', async () => {
    const onGoToGame = vi.fn()
    renderHub({ tournament: tournament({ format: 'limited', rounds: [done(1, 'won', 2, 0)] }), onGoToGame })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start round 2' }))
    expect(onGoToGame).toHaveBeenCalledWith('bo3', catacombs)
  })
})

describe('SwuTournamentScreen: portrait', () => {
  it('shows the same record, rounds and actions', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 390 })
    renderHub({ tournament: threePlayed, totals: { won: 2, lost: 1, drawn: 0 }, points: 6 })
    expect(screen.getByText('2–1–0')).toBeInTheDocument()
    expect(rows()).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'Start round 4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drop' })).toBeInTheDocument()
    expect(screen.getByText('SWU · Premier · Best of 3 · 5 rounds')).toBeInTheDocument()
  })
})
