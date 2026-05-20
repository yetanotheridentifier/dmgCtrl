import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuTournamentScreen from '../components/swuTournamentScreen'
import type { Base } from '../hooks/useBases'
import type { TournamentState } from '../hooks/useTournament'
import type { Format } from '../utils/formatFilter'
import { useOrientation } from '../hooks/useOrientation'

vi.mock('../hooks/useOrientation')

const mockUserSettings = vi.hoisted(() => ({
  useHyperspace: false,
  meleePlayerGuid: '',
}))

vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))

vi.mock('../hooks/useBases', () => ({
  useBases: () => ({
    bases: [
      {
        set: 'SOR', number: '026', name: 'Catacombs of Cadera', subtitle: 'Jedha',
        hp: 30, frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png',
        frontArtLowRes: null, hyperspaceArtHiRes: null, hyperspaceArt: null,
        epicAction: '', aspects: ['Aggression'], rarity: 'Common',
      },
      {
        set: 'SOR', number: '022', name: 'Energy Conversion Lab', subtitle: 'Eadu',
        hp: 25, frontArt: 'https://cdn.swu-db.com/images/cards/SOR/022.png',
        frontArtLowRes: null, hyperspaceArtHiRes: null, hyperspaceArt: null,
        epicAction: 'Epic Action: Play a unit that costs 6 or less.', aspects: ['Cunning'], rarity: 'Rare',
      },
    ],
    loading: false,
    error: null,
  }),
}))

const mockOnTournamentStarted = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnTournamentDropped = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnTournamentEnded = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../services/analytics', () => ({
  onImageLoadFailed: vi.fn().mockResolvedValue(undefined),
  onTournamentStarted: mockOnTournamentStarted,
  onTournamentDropped: mockOnTournamentDropped,
  onTournamentEnded: mockOnTournamentEnded,
}))


const mockBase: Base = {
  set: 'SOR',
  number: '026',
  name: 'Catacombs of Cadera',
  subtitle: 'Jedha',
  hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: null,
  hyperspaceArt: null,
  epicAction: '',
  aspects: ['Aggression'],
  rarity: 'Common',
}

const mockAlternativeBase: Base = {
  set: 'SOR',
  number: '022',
  name: 'Energy Conversion Lab',
  subtitle: 'Eadu',
  hp: 25,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/022.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: null,
  hyperspaceArt: null,
  epicAction: 'Epic Action: Play a unit that costs 6 or less.',
  aspects: ['Cunning'],
  rarity: 'Rare',
}

const noTournament: TournamentState | null = null

const activeTournamentNoRounds: TournamentState = {
  base: mockBase,
  format: 'premier' as Format,
  playMode: 'bo3',
  totalRounds: 5,
  rounds: [],
}

const matchInProgressTournament: TournamentState = {
  ...activeTournamentNoRounds,
  rounds: [
    { roundNumber: 1, playerScore: 0, opponentScore: 0, result: null, submitted: false },
  ],
}

const oneRoundCompleteTournament: TournamentState = {
  ...activeTournamentNoRounds,
  rounds: [
    { roundNumber: 1, playerScore: 2, opponentScore: 0, result: 'won', submitted: false },
  ],
}

const completeTournament: TournamentState = {
  ...activeTournamentNoRounds,
  totalRounds: 1,
  rounds: [
    { roundNumber: 1, playerScore: 2, opponentScore: 0, result: 'won', submitted: false },
  ],
}

const limitedBo3OneRoundComplete: TournamentState = {
  base: mockBase,
  format: 'limited' as Format,
  playMode: 'bo3',
  totalRounds: 3,
  rounds: [
    { roundNumber: 1, playerScore: 2, opponentScore: 0, result: 'won', submitted: false },
  ],
}

// Match 1 is active with 1 game already played — "between games" state where Change Base is available
const limitedBo3GameTwoOfMatch: TournamentState = {
  base: mockBase,
  format: 'limited' as Format,
  playMode: 'bo3',
  totalRounds: 3,
  rounds: [
    { roundNumber: 1, playerScore: 1, opponentScore: 0, result: null, submitted: false },
  ],
}

function makeProps(overrides: Partial<Parameters<typeof SwuTournamentScreen>[0]> = {}) {
  return {
    base: mockBase,
    format: 'premier' as Format,
    tournament: noTournament,
    matchInProgress: false,
    isComplete: false,
    totals: { won: 0, lost: 0, drawn: 0 },
    points: 0,
    hasPlayedGameInCurrentMatch: false,
    startTournament: vi.fn(),
    startMatch: vi.fn(),
    dropTournament: vi.fn(),
    onGoToGame: vi.fn(),
    onDrop: vi.fn(),
    onBack: vi.fn(),
    onHelp: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
  mockUserSettings.meleePlayerGuid = ''
  mockOnTournamentStarted.mockClear()
  mockOnTournamentDropped.mockClear()
  mockOnTournamentEnded.mockClear()
})

describe('SwuTournamentScreen', () => {

  // --- Rendering ---

  it('shows a match mode selector', () => {
    render(<SwuTournamentScreen {...makeProps()} />)
    expect(screen.getByTestId('tournament-play-mode')).toBeInTheDocument()
  })

  it('shows a total rounds input', () => {
    render(<SwuTournamentScreen {...makeProps()} />)
    expect(screen.getByTestId('tournament-total-rounds')).toBeInTheDocument()
  })

  // --- Action button label by state ---

  it('shows "Start Match 1" when no tournament has started', () => {
    render(<SwuTournamentScreen {...makeProps({ tournament: noTournament })} />)
    expect(screen.getByRole('button', { name: 'Start Match 1' })).toBeInTheDocument()
  })

  it('shows "Return to Match 1" when match is in progress', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: matchInProgressTournament,
      matchInProgress: true,
    })} />)
    expect(screen.getByRole('button', { name: 'Return to Match 1' })).toBeInTheDocument()
  })

  it('shows "Start Match 2" when one match is complete', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: oneRoundCompleteTournament,
      matchInProgress: false,
    })} />)
    expect(screen.getByRole('button', { name: 'Start Match 2' })).toBeInTheDocument()
  })

  it('action button is hidden when tournament is complete', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: completeTournament,
      isComplete: true,
    })} />)
    expect(screen.queryByRole('button', { name: /^(Start|Return) Match/ })).toBeNull()
  })

  // --- Action button callbacks ---

  it('"Start Match 1" calls startTournament with local config values then startMatch then onGoToGame', async () => {
    const user = userEvent.setup()
    const startTournament = vi.fn()
    const startMatch = vi.fn()
    const onGoToGame = vi.fn()
    render(<SwuTournamentScreen {...makeProps({ startTournament, startMatch, onGoToGame })} />)
    await user.click(screen.getByRole('button', { name: 'Start Match 1' }))
    expect(startTournament).toHaveBeenCalledTimes(1)
    expect(startTournament).toHaveBeenCalledWith(
      mockBase,
      'premier',
      expect.stringMatching(/^bo[13]$/),
      expect.any(Number),
    )
    expect(startMatch).toHaveBeenCalledTimes(1)
    expect(onGoToGame).toHaveBeenCalledTimes(1)
  })

  it('"Return to Match N" calls onGoToGame without calling startMatch', async () => {
    const user = userEvent.setup()
    const startMatch = vi.fn()
    const onGoToGame = vi.fn()
    render(<SwuTournamentScreen {...makeProps({
      tournament: matchInProgressTournament,
      matchInProgress: true,
      startMatch,
      onGoToGame,
    })} />)
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))
    expect(onGoToGame).toHaveBeenCalledTimes(1)
    expect(startMatch).not.toHaveBeenCalled()
  })

  it('"Start Match 2" calls startMatch then onGoToGame', async () => {
    const user = userEvent.setup()
    const startMatch = vi.fn()
    const onGoToGame = vi.fn()
    render(<SwuTournamentScreen {...makeProps({
      tournament: oneRoundCompleteTournament,
      matchInProgress: false,
      startMatch,
      onGoToGame,
    })} />)
    await user.click(screen.getByRole('button', { name: 'Start Match 2' }))
    expect(startMatch).toHaveBeenCalledTimes(1)
    expect(onGoToGame).toHaveBeenCalledTimes(1)
  })

  // --- Config inputs: locked after tournament starts ---

  it('play mode selector is enabled before tournament starts', () => {
    render(<SwuTournamentScreen {...makeProps({ tournament: noTournament })} />)
    expect(screen.getByTestId('tournament-play-mode')).not.toBeDisabled()
  })

  it('play mode selector is disabled once tournament has started', () => {
    render(<SwuTournamentScreen {...makeProps({ tournament: activeTournamentNoRounds })} />)
    expect(screen.getByTestId('tournament-play-mode')).toBeDisabled()
  })

  it('total rounds input is enabled before tournament starts', () => {
    render(<SwuTournamentScreen {...makeProps({ tournament: noTournament })} />)
    expect(screen.getByTestId('tournament-total-rounds')).not.toBeDisabled()
  })

  it('total rounds input is disabled once tournament has started', () => {
    render(<SwuTournamentScreen {...makeProps({ tournament: activeTournamentNoRounds })} />)
    expect(screen.getByTestId('tournament-total-rounds')).toBeDisabled()
  })

  it('total rounds selector has options from 2 to 16', () => {
    render(<SwuTournamentScreen {...makeProps()} />)
    const el = screen.getByTestId('tournament-total-rounds')
    const values = Array.from(el.querySelectorAll('option')).map(o => Number((o as HTMLOptionElement).value))
    expect(values).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
  })

  // --- Drop/End button ---

  it('Drop/End button is disabled before tournament starts', () => {
    render(<SwuTournamentScreen {...makeProps({ tournament: noTournament })} />)
    expect(screen.getByTestId('drop-end-button')).toBeDisabled()
  })

  it('Drop/End button shows "Drop" when tournament started but not complete', () => {
    render(<SwuTournamentScreen {...makeProps({ tournament: activeTournamentNoRounds })} />)
    expect(screen.getByTestId('drop-end-button')).toHaveTextContent('Drop')
  })

  it('Drop/End button shows "End Tournament" when tournament is complete', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: completeTournament,
      isComplete: true,
    })} />)
    expect(screen.getByTestId('drop-end-button')).toHaveTextContent('End Tournament')
  })

  it('first click on Drop button shows confirmation state', async () => {
    const user = userEvent.setup()
    render(<SwuTournamentScreen {...makeProps({ tournament: activeTournamentNoRounds })} />)
    await user.click(screen.getByTestId('drop-end-button'))
    expect(screen.getByTestId('drop-end-button')).toHaveTextContent('Confirm')
  })

  it('second click on Drop button calls dropTournament and onDrop', async () => {
    const user = userEvent.setup()
    const dropTournament = vi.fn()
    const onDrop = vi.fn()
    render(<SwuTournamentScreen {...makeProps({
      tournament: activeTournamentNoRounds,
      dropTournament,
      onDrop,
    })} />)
    await user.click(screen.getByTestId('drop-end-button'))
    await user.click(screen.getByTestId('drop-end-button'))
    expect(dropTournament).toHaveBeenCalledTimes(1)
    expect(onDrop).toHaveBeenCalledTimes(1)
  })

  it('clicking elsewhere after first Drop click cancels confirmation', async () => {
    const user = userEvent.setup()
    const dropTournament = vi.fn()
    render(<SwuTournamentScreen {...makeProps({
      tournament: activeTournamentNoRounds,
      dropTournament,
    })} />)
    await user.click(screen.getByTestId('drop-end-button'))
    expect(screen.getByTestId('drop-end-button')).toHaveTextContent('Confirm')
    await user.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByTestId('drop-end-button')).toHaveTextContent('Drop')
    expect(dropTournament).not.toHaveBeenCalled()
  })

  it('"End Tournament" calls dropTournament and onDrop on single click', async () => {
    const user = userEvent.setup()
    const dropTournament = vi.fn()
    const onDrop = vi.fn()
    render(<SwuTournamentScreen {...makeProps({
      tournament: completeTournament,
      isComplete: true,
      dropTournament,
      onDrop,
    })} />)
    await user.click(screen.getByTestId('drop-end-button'))
    expect(dropTournament).toHaveBeenCalledTimes(1)
    expect(onDrop).toHaveBeenCalledTimes(1)
  })

  // --- Back navigation ---

  it('shows Back button when no tournament has started', () => {
    render(<SwuTournamentScreen {...makeProps({ tournament: noTournament })} />)
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('Back button calls onBack when no tournament has started', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<SwuTournamentScreen {...makeProps({ tournament: noTournament, onBack })} />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('Back button is not shown when tournament has started', () => {
    render(<SwuTournamentScreen {...makeProps({ tournament: activeTournamentNoRounds })} />)
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  // --- Melee button ---

  it('Shows "Enter Player ID" when GUID is not set', () => {
    render(<SwuTournamentScreen {...makeProps({ tournament: activeTournamentNoRounds })} />)
    expect(screen.getByRole('button', { name: 'Enter Player ID' })).toBeInTheDocument()
  })

  it('Clicking "Enter Player ID" calls onSettings', async () => {
    const user = userEvent.setup()
    const onSettings = vi.fn()
    render(<SwuTournamentScreen {...makeProps({ tournament: activeTournamentNoRounds, onSettings })} />)
    await user.click(screen.getByRole('button', { name: 'Enter Player ID' }))
    expect(onSettings).toHaveBeenCalledOnce()
  })

  it('Shows "Player Portal" when GUID is set', () => {
    mockUserSettings.meleePlayerGuid = 'test-guid'
    render(<SwuTournamentScreen {...makeProps({ tournament: activeTournamentNoRounds })} />)
    expect(screen.getByRole('button', { name: 'Player Portal' })).toBeInTheDocument()
  })

  it('Player Portal button is enabled', () => {
    mockUserSettings.meleePlayerGuid = 'test-guid'
    render(<SwuTournamentScreen {...makeProps({ tournament: activeTournamentNoRounds })} />)
    expect(screen.getByRole('button', { name: 'Player Portal' })).not.toBeDisabled()
  })

  it('Clicking Player Portal opens the melee.gg player portal URL', async () => {
    mockUserSettings.meleePlayerGuid = 'test-guid'
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null as unknown as Window)
    const user = userEvent.setup()
    render(<SwuTournamentScreen {...makeProps({ tournament: activeTournamentNoRounds })} />)
    await user.click(screen.getByRole('button', { name: 'Player Portal' }))
    expect(openSpy).toHaveBeenCalledWith('https://melee.gg/Player/Portal/test-guid', '_blank')
    openSpy.mockRestore()
  })

  it('Melee button is shown when match is in progress', () => {
    mockUserSettings.meleePlayerGuid = 'test-guid'
    render(<SwuTournamentScreen {...makeProps({ tournament: matchInProgressTournament, matchInProgress: true })} />)
    expect(screen.getByRole('button', { name: 'Player Portal' })).toBeInTheDocument()
  })

  // --- Round totals ---

  it('shows win/loss/draw totals', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: oneRoundCompleteTournament,
      totals: { won: 1, lost: 0, drawn: 0 },
    })} />)
    expect(screen.getByText(/1.*0.*0/)).toBeInTheDocument()
  })

  it('shows points in the record row', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: oneRoundCompleteTournament,
      totals: { won: 1, lost: 0, drawn: 0 },
      points: 3,
    })} />)
    expect(screen.getByText(/3pts/)).toBeInTheDocument()
  })

  it('shows 0pts when no rounds are complete', () => {
    render(<SwuTournamentScreen {...makeProps({ points: 0 })} />)
    expect(screen.getByText(/0pts/)).toBeInTheDocument()
  })

  it('shows correct points for mixed results', () => {
    render(<SwuTournamentScreen {...makeProps({
      totals: { won: 2, lost: 1, drawn: 1 },
      points: 7,
    })} />)
    expect(screen.getByText(/7pts/)).toBeInTheDocument()
  })

  // --- Base art preview ---

  it('renders a base card image', () => {
    render(<SwuTournamentScreen {...makeProps()} />)
    expect(screen.getByRole('img', { name: mockBase.name })).toBeInTheDocument()
  })

  it('base card image src matches the base frontArt', () => {
    render(<SwuTournamentScreen {...makeProps()} />)
    expect(screen.getByRole('img', { name: mockBase.name })).toHaveAttribute('src', mockBase.frontArt)
  })

  // --- Tournament analytics ---

  it('fires onTournamentStarted when clicking Start Match 1', async () => {
    const user = userEvent.setup()
    render(<SwuTournamentScreen {...makeProps({ tournament: noTournament })} />)
    await user.click(screen.getByRole('button', { name: 'Start Match 1' }))
    expect(mockOnTournamentStarted).toHaveBeenCalledWith('premier', 'bo3', 5)
  })

  it('does not fire onTournamentStarted when returning to an existing match', async () => {
    const user = userEvent.setup()
    render(<SwuTournamentScreen {...makeProps({
      tournament: matchInProgressTournament,
      matchInProgress: true,
    })} />)
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))
    expect(mockOnTournamentStarted).not.toHaveBeenCalled()
  })

  it('fires onTournamentDropped with rounds completed when drop is confirmed', async () => {
    const user = userEvent.setup()
    render(<SwuTournamentScreen {...makeProps({ tournament: activeTournamentNoRounds })} />)
    await user.click(screen.getByTestId('drop-end-button'))
    await user.click(screen.getByTestId('drop-end-button'))
    expect(mockOnTournamentDropped).toHaveBeenCalledWith(0, 'premier', 'bo3')
  })

  // --- Change base ---

  it('shows Change Base overlay between games within an ongoing match (limited, bo3)', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: limitedBo3GameTwoOfMatch,
      matchInProgress: true,
      hasPlayedGameInCurrentMatch: true,
    })} />)
    expect(screen.getByTestId('change-base-overlay')).toBeInTheDocument()
  })

  it('does not show Change Base overlay in premier format', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: { ...limitedBo3GameTwoOfMatch, format: 'premier' },
      matchInProgress: true,
      hasPlayedGameInCurrentMatch: true,
    })} />)
    expect(screen.queryByTestId('change-base-overlay')).toBeNull()
  })

  it('does not show Change Base overlay in bo1 mode', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: { ...limitedBo3GameTwoOfMatch, playMode: 'bo1' },
      matchInProgress: true,
      hasPlayedGameInCurrentMatch: true,
    })} />)
    expect(screen.queryByTestId('change-base-overlay')).toBeNull()
  })

  it('does not show Change Base overlay before any games played in current match', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: limitedBo3GameTwoOfMatch,
      matchInProgress: true,
      hasPlayedGameInCurrentMatch: false,
    })} />)
    expect(screen.queryByTestId('change-base-overlay')).toBeNull()
  })

  it('does not show Change Base overlay when no match is in progress (between matches)', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: limitedBo3OneRoundComplete,
      matchInProgress: false,
      hasPlayedGameInCurrentMatch: false,
    })} />)
    expect(screen.queryByTestId('change-base-overlay')).toBeNull()
  })

  it('does not show Change Base overlay when tournament is complete', () => {
    render(<SwuTournamentScreen {...makeProps({
      tournament: { ...limitedBo3GameTwoOfMatch, totalRounds: 1 },
      isComplete: true,
      matchInProgress: true,
      hasPlayedGameInCurrentMatch: true,
    })} />)
    expect(screen.queryByTestId('change-base-overlay')).toBeNull()
  })

  it('tapping Change Base overlay shows aspect and base selectors', async () => {
    const user = userEvent.setup()
    render(<SwuTournamentScreen {...makeProps({
      tournament: limitedBo3GameTwoOfMatch,
      matchInProgress: true,
      hasPlayedGameInCurrentMatch: true,
    })} />)
    await user.click(screen.getByTestId('change-base-overlay'))
    expect(screen.getByTestId('change-base-aspect')).toBeInTheDocument()
    expect(screen.getByTestId('change-base-base')).toBeInTheDocument()
  })

  it('Cancel hides selectors and returns to card art without changing base', async () => {
    const user = userEvent.setup()
    render(<SwuTournamentScreen {...makeProps({
      tournament: limitedBo3GameTwoOfMatch,
      matchInProgress: true,
      hasPlayedGameInCurrentMatch: true,
    })} />)
    await user.click(screen.getByTestId('change-base-overlay'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('change-base-aspect')).toBeNull()
    expect(screen.getByRole('img', { name: mockBase.name })).toBeInTheDocument()
  })

  it('selecting a base hides selectors and updates art preview', async () => {
    const user = userEvent.setup()
    render(<SwuTournamentScreen {...makeProps({
      tournament: limitedBo3GameTwoOfMatch,
      matchInProgress: true,
      hasPlayedGameInCurrentMatch: true,
    })} />)
    await user.click(screen.getByTestId('change-base-overlay'))
    await user.selectOptions(screen.getByTestId('change-base-aspect'), 'Cunning')
    await user.selectOptions(screen.getByTestId('change-base-base'), 'SOR-022')
    expect(screen.queryByTestId('change-base-aspect')).toBeNull()
    expect(screen.getByRole('img', { name: mockAlternativeBase.name })).toBeInTheDocument()
  })

  it('action button passes candidate base to onGoToGame when continuing within a match', async () => {
    const user = userEvent.setup()
    const onGoToGame = vi.fn()
    render(<SwuTournamentScreen {...makeProps({
      tournament: limitedBo3GameTwoOfMatch,
      matchInProgress: true,
      hasPlayedGameInCurrentMatch: true,
      onGoToGame,
    })} />)
    await user.click(screen.getByTestId('change-base-overlay'))
    await user.selectOptions(screen.getByTestId('change-base-aspect'), 'Cunning')
    await user.selectOptions(screen.getByTestId('change-base-base'), 'SOR-022')
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))
    expect(onGoToGame).toHaveBeenCalledWith('bo3', mockAlternativeBase)
  })

  it('action button calls onGoToGame without newBase when no candidate selected mid-match', async () => {
    const user = userEvent.setup()
    const onGoToGame = vi.fn()
    render(<SwuTournamentScreen {...makeProps({
      tournament: limitedBo3GameTwoOfMatch,
      matchInProgress: true,
      hasPlayedGameInCurrentMatch: true,
      onGoToGame,
    })} />)
    await user.click(screen.getByRole('button', { name: 'Return to Match 1' }))
    expect(onGoToGame).toHaveBeenCalledWith('bo3')
  })

  it('action button passes registered base to onGoToGame when starting a new match', async () => {
    const user = userEvent.setup()
    const onGoToGame = vi.fn()
    render(<SwuTournamentScreen {...makeProps({
      tournament: limitedBo3OneRoundComplete,
      matchInProgress: false,
      onGoToGame,
    })} />)
    await user.click(screen.getByRole('button', { name: 'Start Match 2' }))
    expect(onGoToGame).toHaveBeenCalledWith('bo3', mockBase)
  })

  it('fires onTournamentEnded with tournament summary when End Tournament is clicked', async () => {
    const user = userEvent.setup()
    render(<SwuTournamentScreen {...makeProps({
      tournament: completeTournament,
      isComplete: true,
      totals: { won: 1, lost: 0, drawn: 0 },
      points: 3,
    })} />)
    await user.click(screen.getByTestId('drop-end-button'))
    expect(mockOnTournamentEnded).toHaveBeenCalledWith(1, 1, 0, 0, 3, 'premier', 'bo3')
  })

})
