import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import XwingGameScreen from '../components/xwingGameScreen'
import { useOrientation } from '../hooks/useOrientation'
import { useWakeLock } from '../hooks/useWakeLock'

vi.mock('../hooks/useOrientation')
vi.mock('../hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }))

const mockOnXwingGameStarted = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnXwingGameEnded = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnXwingRoundAdvanced = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../services/analytics', () => ({
  onXwingGameStarted: mockOnXwingGameStarted,
  onXwingGameEnded: mockOnXwingGameEnded,
  onXwingRoundAdvanced: mockOnXwingRoundAdvanced,
}))

const mockUserSettings = vi.hoisted(() => ({
  enableLongPress: true,
  enableActionLog: true,
  enableWakeLock: true,
  enableInitiativeBar: true,
  enableXwingPhases: true,
  xwingTimerMinutes: 75,
}))
vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))

// Mutable timer state — tests mutate this to control what the hook returns
const mockTimerState = vi.hoisted(() => ({
  remaining: 4500,
  isRunning: false,
  isExpired: false,
  start: vi.fn(),
  reset: vi.fn(),
  stop: vi.fn(),
  resume: vi.fn(),
}))
const mockUseTimer = vi.hoisted(() =>
  vi.fn().mockImplementation(() => mockTimerState)
)
vi.mock('../hooks/useTimer', () => ({ useTimer: mockUseTimer }))

beforeEach(() => {
  vi.mocked(useOrientation).mockReturnValue({ isPortrait: false, vmin: 0 })
  mockUserSettings.enableLongPress = true
  mockUserSettings.enableActionLog = true
  mockUserSettings.enableWakeLock = true
  mockUserSettings.enableInitiativeBar = true
  mockUserSettings.enableXwingPhases = true
  mockUserSettings.xwingTimerMinutes = 75
  mockTimerState.remaining = 4500
  mockTimerState.isRunning = false
  mockTimerState.isExpired = false
  mockTimerState.start.mockClear()
  mockTimerState.reset.mockClear()
  mockTimerState.stop.mockClear()
  mockTimerState.resume.mockClear()
  mockOnXwingGameStarted.mockClear()
  mockOnXwingGameEnded.mockClear()
  mockOnXwingRoundAdvanced.mockClear()
})

// ---------------------------------------------------------------------------
// Portrait orientation
// ---------------------------------------------------------------------------

describe('XwingGameScreen portrait', () => {

  it('shows rotate prompt in portrait', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText(/rotate/i)).toBeInTheDocument()
  })

  it('hides game controls in portrait', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('start-game-btn')).not.toBeInTheDocument()
  })

})

// ---------------------------------------------------------------------------
// Pre-game
// ---------------------------------------------------------------------------

describe('XwingGameScreen pre-game', () => {

  it('shows Start Game element before game starts', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('start-game-btn')).toBeInTheDocument()
  })

  it('shows opponent deficit as player score before game starts', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} playerDeficit={0} opponentDeficit={3} />)
    expect(screen.getByTestId('player-score')).toHaveTextContent('3')
  })

  it('shows player deficit as opponent score before game starts', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} playerDeficit={2} opponentDeficit={0} />)
    expect(screen.getByTestId('opponent-score')).toHaveTextContent('2')
  })

})

// ---------------------------------------------------------------------------
// Score counters (post-game-start)
// ---------------------------------------------------------------------------

describe('XwingGameScreen score counters', () => {

  it('player score starts equal to opponent deficit', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} playerDeficit={0} opponentDeficit={3} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('3')
  })

  it('opponent score starts equal to player deficit', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} playerDeficit={2} opponentDeficit={0} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByTestId('opponent-score')).toHaveTextContent('2')
  })

  it('player increment adds 1', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('1')
  })

  it('player decrement clamps at 0', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-decrement'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('0')
  })

  it('opponent increment adds 1', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('opponent-increment'))
    expect(screen.getByTestId('opponent-score')).toHaveTextContent('1')
  })

  it('opponent decrement clamps at 0', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('opponent-decrement'))
    expect(screen.getByTestId('opponent-score')).toHaveTextContent('0')
  })

})

// ---------------------------------------------------------------------------
// Terminal condition — 50 points
// ---------------------------------------------------------------------------

describe('XwingGameScreen game over', () => {

  it('shows Game Won when player reaches 50', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('player-increment')
    for (let i = 0; i < 50; i++) fireEvent.click(btn)
    expect(screen.getByTestId('result-banner')).toHaveTextContent(/game won/i)
  })

  it('shows Game Lost when opponent reaches 50', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('opponent-increment')
    for (let i = 0; i < 50; i++) fireEvent.click(btn)
    expect(screen.getByTestId('result-banner')).toHaveTextContent(/game lost/i)
  })

  it('player increment is disabled when game is over', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('player-increment')
    for (let i = 0; i < 50; i++) fireEvent.click(btn)
    expect(screen.getByTestId('player-increment')).toBeDisabled()
  })

  it('opponent increment is disabled when game is over', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('opponent-increment')
    for (let i = 0; i < 50; i++) fireEvent.click(btn)
    expect(screen.getByTestId('opponent-increment')).toBeDisabled()
  })

})

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe('XwingGameScreen navigation', () => {

  it('shows dmgCtrl title before game starts', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText('dmgCtrl')).toBeInTheDocument()
  })

  it('hides dmgCtrl title after game starts', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.queryByText('dmgCtrl')).not.toBeInTheDocument()
  })

  it('calls onBack when back button clicked before game starts', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<XwingGameScreen onBack={onBack} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('calls onBack when back button clicked after game starts', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<XwingGameScreen onBack={onBack} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('calls onHelp when help button clicked', async () => {
    const user = userEvent.setup()
    const onHelp = vi.fn()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={onHelp} />)
    await user.click(screen.getByRole('button', { name: /help/i }))
    expect(onHelp).toHaveBeenCalledOnce()
  })

  it('calls onSettings when settings button clicked', async () => {
    const user = userEvent.setup()
    const onSettings = vi.fn()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} onSettings={onSettings} />)
    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(onSettings).toHaveBeenCalledOnce()
  })

})

// ---------------------------------------------------------------------------
// Log button
// ---------------------------------------------------------------------------

describe('XwingGameScreen log button', () => {

  it('shows log button when enableActionLog is true', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('log-btn')).toBeInTheDocument()
  })

  it('hides log button when enableActionLog is false', () => {
    mockUserSettings.enableActionLog = false
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('log-btn')).not.toBeInTheDocument()
  })

})

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

describe('XwingGameScreen analytics', () => {

  it('fires onXwingGameStarted when Start Game is clicked', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(mockOnXwingGameStarted).toHaveBeenCalledOnce()
    expect(mockOnXwingGameStarted).toHaveBeenCalledWith(0, 0)
  })

  it('fires onXwingGameStarted with correct deficit values', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} playerDeficit={2} opponentDeficit={1} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(mockOnXwingGameStarted).toHaveBeenCalledWith(2, 1)
  })

  it('fires onXwingGameEnded when back is pressed after game starts', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(mockOnXwingGameEnded).toHaveBeenCalledOnce()
  })

  it('does not fire onXwingGameEnded when back is pressed before game starts', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(mockOnXwingGameEnded).not.toHaveBeenCalled()
  })

  it('onXwingGameEnded includes correct scores and result', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(mockOnXwingGameEnded).toHaveBeenCalledWith(
      expect.objectContaining({
        player_score: 2,
        opponent_score: 0,
        player_deficit: 0,
        opponent_deficit: 0,
        result: null,
      })
    )
  })

})

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

describe('XwingGameScreen timer', () => {

  it('timer is not shown before game starts', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('xwing-timer')).not.toBeInTheDocument()
  })

  it('timer is shown after Start Game is pressed', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByTestId('xwing-timer')).toBeInTheDocument()
  })

  it('timer displays the formatted remaining time', async () => {
    mockTimerState.remaining = 4500
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByTestId('xwing-timer')).toHaveTextContent('75:00')
  })

  it('useTimer is called with xwingTimerMinutes * 60 as duration', () => {
    mockUserSettings.xwingTimerMinutes = 60
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(mockUseTimer).toHaveBeenCalledWith(3600)
  })

  it('timer.start is called when Start Game is pressed', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(mockTimerState.start).toHaveBeenCalledOnce()
  })

  it('timer.stop is called when game reaches game over', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('player-increment')
    for (let i = 0; i < 50; i++) fireEvent.click(btn)
    expect(mockTimerState.stop).toHaveBeenCalled()
  })

  it('onTimerExpired is called when timer isExpired becomes true', async () => {
    const onTimerExpired = vi.fn()
    mockTimerState.isExpired = true
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} onTimerExpired={onTimerExpired} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(onTimerExpired).toHaveBeenCalled()
  })

  it('analytics payload includes elapsed_seconds', async () => {
    mockTimerState.remaining = 4200  // 300 s elapsed from 4500
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(mockOnXwingGameEnded).toHaveBeenCalledWith(
      expect.objectContaining({ elapsed_seconds: 300 })
    )
  })

  it('analytics payload includes timer_expired', async () => {
    mockTimerState.isExpired = true
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(mockOnXwingGameEnded).toHaveBeenCalledWith(
      expect.objectContaining({ timer_expired: true })
    )
  })

})

// ---------------------------------------------------------------------------
// Wake lock
// ---------------------------------------------------------------------------

describe('XwingGameScreen wake lock', () => {

  it('calls useWakeLock with enableWakeLock=true by default', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(vi.mocked(useWakeLock)).toHaveBeenCalledWith(true)
  })

  it('calls useWakeLock with enableWakeLock=false when setting is disabled', () => {
    mockUserSettings.enableWakeLock = false
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(vi.mocked(useWakeLock)).toHaveBeenCalledWith(false)
  })

})

// ---------------------------------------------------------------------------
// Round tracker
// ---------------------------------------------------------------------------

describe('XwingGameScreen round tracker', () => {

  it('round tracker is not shown before game starts', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('round-tracker')).not.toBeInTheDocument()
  })

  it('round tracker is shown after game starts', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByTestId('round-tracker')).toBeInTheDocument()
  })

  it('renders 12 round indicators', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    for (let i = 1; i <= 12; i++) {
      expect(screen.getByRole('button', { name: `Round ${i}` })).toBeInTheDocument()
    }
  })

  it('round 1 is highlighted on game start', async () => {
    mockTimerState.remaining = 4500
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByRole('button', { name: 'Round 1' }).style.borderColor).toBe('var(--color-accent)')
  })

  it('tapping round 2 while on round 1 advances to round 2', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    expect(screen.getByRole('button', { name: 'Round 2' }).style.borderColor).toBe('var(--color-accent)')
    expect(screen.getByRole('button', { name: 'Round 1' }).style.borderColor).not.toBe('var(--color-accent)')
  })

  it('tapping round 3 while on round 1 does nothing', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 3' }))
    expect(screen.getByRole('button', { name: 'Round 1' }).style.borderColor).toBe('var(--color-accent)')
  })

  it('tapping the current round (round 1) does nothing', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 1' }))
    expect(screen.getByRole('button', { name: 'Round 1' }).style.borderColor).toBe('var(--color-accent)')
  })

  it('fires onXwingRoundAdvanced with correct from/to values', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    expect(mockOnXwingRoundAdvanced).toHaveBeenCalledWith(1, 2)
  })

  it('does not advance round when timer is expired', async () => {
    mockTimerState.isExpired = true
    mockTimerState.remaining = 0
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    expect(screen.getByRole('button', { name: 'Round 1' }).style.borderColor).toBe('var(--color-error)')
  })

  it('does not fire analytics when round advance is blocked by timer expiry', async () => {
    mockTimerState.isExpired = true
    mockTimerState.remaining = 0
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    expect(mockOnXwingRoundAdvanced).not.toHaveBeenCalled()
  })

  it('does not advance round when game is over', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const scoreBtn = screen.getByTestId('player-increment')
    for (let i = 0; i < 50; i++) fireEvent.click(scoreBtn)
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    // Result banner shown means game is over; round 1 still highlighted (not advanced)
    expect(screen.getByTestId('result-banner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Round 1' })).toBeInTheDocument()
  })

  it('timer does not stop when round advances to 12', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    mockTimerState.stop.mockClear()
    for (let i = 2; i <= 12; i++) {
      fireEvent.click(screen.getByRole('button', { name: `Round ${i}` }))
    }
    expect(mockTimerState.stop).not.toHaveBeenCalled()
  })

  // --- Colour thresholds (tracks timer) ---

  it('current round indicator is accent blue when timer > 5:00', async () => {
    mockTimerState.remaining = 301
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByRole('button', { name: 'Round 1' }).style.borderColor).toBe('var(--color-accent)')
  })

  it('current round indicator is amber when timer is at exactly 5:00', async () => {
    mockTimerState.remaining = 300
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByRole('button', { name: 'Round 1' }).style.borderColor).toBe('var(--color-warning)')
  })

  it('current round indicator is amber when timer is between 5:00 and 1:00', async () => {
    mockTimerState.remaining = 150
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByRole('button', { name: 'Round 1' }).style.borderColor).toBe('var(--color-warning)')
  })

  it('current round indicator is red when timer is at exactly 1:00', async () => {
    mockTimerState.remaining = 60
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByRole('button', { name: 'Round 1' }).style.borderColor).toBe('var(--color-error)')
  })

  it('current round indicator is red when timer is expired', async () => {
    mockTimerState.remaining = 0
    mockTimerState.isExpired = true
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByRole('button', { name: 'Round 1' }).style.borderColor).toBe('var(--color-error)')
  })

})

// ---------------------------------------------------------------------------
// Log overlay
// ---------------------------------------------------------------------------

describe('XwingGameScreen log overlay', () => {

  it('log overlay is hidden by default', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('log-overlay')).not.toBeInTheDocument()
  })

  it('clicking log button shows the log overlay', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByTestId('log-overlay')).toBeInTheDocument()
  })

  it('clicking log button again hides the log overlay', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.queryByTestId('log-overlay')).not.toBeInTheDocument()
  })

  it('log overlay shows "No actions yet" when no entries exist', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText(/no actions yet/i)).toBeInTheDocument()
  })

})

// ---------------------------------------------------------------------------
// Log entries
// ---------------------------------------------------------------------------

describe('XwingGameScreen log entries', () => {

  it('starting the game adds a "Round 1" entry', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Round 1')).toBeInTheDocument()
  })

  it('incrementing player score adds an entry showing the delta and new total', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('You +1 (1)')).toBeInTheDocument()
  })

  it('incrementing player score twice shows cumulative total in second entry', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('You +1 (2)')).toBeInTheDocument()
  })

  it('decrementing player score adds an entry with minus sign', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByTestId('player-decrement'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('You −1 (1)')).toBeInTheDocument()
  })

  it('incrementing opponent score adds an entry with Opp prefix', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('opponent-increment'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Opp +1 (1)')).toBeInTheDocument()
  })

  it('decrementing opponent score adds an entry with minus sign', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('opponent-increment'))
    await user.click(screen.getByTestId('opponent-increment'))
    await user.click(screen.getByTestId('opponent-decrement'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Opp −1 (1)')).toBeInTheDocument()
  })

  it('advancing the round adds a Round entry', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Round 2')).toBeInTheDocument()
  })

  it('log is empty before game starts', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText(/no actions yet/i)).toBeInTheDocument()
  })

  it('log resets when Start Game is clicked again after undoing back to pre-game', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    // undo the score change, then undo game start
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    // now back in pre-game; start again
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Round 1')).toBeInTheDocument()
    expect(screen.queryByText('You +1 (1)')).not.toBeInTheDocument()
  })

})

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe('XwingGameScreen undo', () => {

  it('undo button is present on the last log entry', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByTestId('log-undo-btn')).toBeInTheDocument()
  })

  it('clicking undo removes the last log entry', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.queryByText('You +1 (1)')).not.toBeInTheDocument()
  })

  it('clicking undo after a player increment reverts the player score', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('1')
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('0')
  })

  it('clicking undo after an opponent increment reverts the opponent score', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('opponent-increment'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('opponent-score')).toHaveTextContent('0')
  })

  it('clicking undo after a round advance reverts to the previous round', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    // after undoing the round advance, Round 2 should be clickable again (current round is 1)
    expect(screen.getByRole('button', { name: 'Round 2' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Round 2' }).style.cursor).toBe('pointer')
  })

  it('clicking undo on "Round 1" returns to the pre-game screen', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('start-game-btn')).toBeInTheDocument()
  })

  it('undo can step back through multiple entries in sequence', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByTestId('log-btn'))
    // undo second increment: score back to 1
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('1')
    // undo first increment: score back to 0
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('0')
  })

  it('undoing game start resets the timer', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(mockTimerState.reset).toHaveBeenCalledOnce()
  })

  it('undoing a score change does not reset the timer', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(mockTimerState.reset).not.toHaveBeenCalled()
  })

  it('starting game again after undo calls timer.start() afresh', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    mockTimerState.start.mockClear()
    await user.click(screen.getByTestId('start-game-btn'))
    expect(mockTimerState.start).toHaveBeenCalledOnce()
  })

  it('undoing from game-ended state resumes the timer', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment')) // adds a log entry
    // advance to round 12 and trigger game end via phase button
    for (let r = 2; r <= 12; r++) {
      await user.click(screen.getByRole('button', { name: `Round ${r}` }))
    }
    const btn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(btn) // reach End
    await user.click(btn)                              // trigger game over
    expect(screen.getByTestId('result-banner')).toBeInTheDocument()
    // undo the score change (last log entry before game end)
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(mockTimerState.resume).toHaveBeenCalledOnce()
    expect(mockTimerState.reset).not.toHaveBeenCalled()
  })

  it('timer resumes after undoing the score change that triggered score-based game over', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    for (let i = 0; i < 50; i++) await user.click(screen.getByTestId('player-increment'))
    mockTimerState.stop.mockClear()
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(mockTimerState.resume).toHaveBeenCalledOnce()
    expect(mockTimerState.reset).not.toHaveBeenCalled()
  })

  it('undoing a score change during normal play does not call resume', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(mockTimerState.resume).not.toHaveBeenCalled()
  })

})

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

describe('XwingGameScreen initiative', () => {

  it('initiative bar is visible before game starts', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('initiative-indicator')).toBeInTheDocument()
  })

  it('initiative bar is visible after game starts', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByTestId('initiative-indicator')).toBeInTheDocument()
  })

  it('indicator position is none by default', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'none')
  })

  it('tapping OPP zone sets initiative to opponent', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('initiative-opp-zone'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'opponent')
  })

  it('tapping YOU zone sets initiative to player', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('initiative-you-zone'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'player')
  })

  it('tapping OPP zone when already opponent stays opponent', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('initiative-opp-zone'))
    await user.click(screen.getByTestId('initiative-opp-zone'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'opponent')
  })

  it('tapping YOU zone when already player stays player', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('initiative-you-zone'))
    await user.click(screen.getByTestId('initiative-you-zone'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'player')
  })

  it('advancing the round resets initiative to neutral', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('initiative-opp-zone'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'opponent')
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'none')
  })

  it('initiative is not reset when Start Game is pressed', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('initiative-opp-zone'))
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'opponent')
  })

  it('initiative is not reset when undoing game start', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('initiative-you-zone'))
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'player')
  })

  it('initiative bar is hidden when enableInitiativeBar is false', () => {
    mockUserSettings.enableInitiativeBar = false
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('initiative-indicator')).not.toBeInTheDocument()
  })

  it('initiative tap zones are present in the Planning phase', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    // phase is Planning after Start Game
    expect(screen.getByTestId('initiative-opp-zone')).toBeInTheDocument()
    expect(screen.getByTestId('initiative-you-zone')).toBeInTheDocument()
  })

  it('initiative tap zones are absent once past the Planning phase', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('phase-btn')) // Planning → System
    expect(screen.queryByTestId('initiative-opp-zone')).not.toBeInTheDocument()
    expect(screen.queryByTestId('initiative-you-zone')).not.toBeInTheDocument()
  })

  it('initiative set in Planning is preserved when phase advances to System', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('initiative-opp-zone'))
    await user.click(screen.getByTestId('phase-btn')) // Planning → System
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'opponent')
  })

  it('initiative can be updated again in the next Planning phase', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('initiative-opp-zone')) // set to opponent
    // advance to next round via phase button (Planning → ... → End → advance round)
    for (let i = 0; i < 5; i++) await user.click(screen.getByTestId('phase-btn'))
    // now in Planning of round 2; initiative was reset by round advance
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'none')
    // can now set initiative
    await user.click(screen.getByTestId('initiative-you-zone'))
    expect(screen.getByTestId('initiative-indicator')).toHaveAttribute('data-position', 'player')
  })

})

// ---------------------------------------------------------------------------
// Phase tracker
// ---------------------------------------------------------------------------

describe('XwingGameScreen phase tracker', () => {

  it('phase button is not shown before game starts', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByTestId('phase-btn')).not.toBeInTheDocument()
  })

  it('phase button shows Planning after Start Game', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByTestId('phase-btn')).toHaveTextContent('Planning')
  })

  it('tapping cycles through all five phases in order', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('phase-btn')
    expect(btn).toHaveTextContent('Planning')
    await user.click(btn)
    expect(btn).toHaveTextContent('System')
    await user.click(btn)
    expect(btn).toHaveTextContent('Activation')
    await user.click(btn)
    expect(btn).toHaveTextContent('Engagement')
    await user.click(btn)
    expect(btn).toHaveTextContent('End')
  })

  it('tapping End advances the round and resets to Planning', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('phase-btn')
    // advance to End
    for (let i = 0; i < 4; i++) await user.click(btn)
    expect(btn).toHaveTextContent('End')
    // tap End
    await user.click(btn)
    expect(btn).toHaveTextContent('Planning')
    expect(screen.getByRole('button', { name: 'Round 2' }).style.borderColor).toBe('var(--color-accent)')
  })

  it('tapping End when timer has expired triggers game over rather than advancing the round', async () => {
    mockTimerState.isExpired = true
    mockTimerState.remaining = 0
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(btn) // Planning → End
    await user.click(btn) // End → game over
    expect(screen.getByTestId('result-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('phase-btn')).not.toBeInTheDocument()
  })

  it('advancing round via round tracker resets phase to Planning', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('phase-btn')
    await user.click(btn)
    await user.click(btn)
    expect(btn).toHaveTextContent('Activation')
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    expect(btn).toHaveTextContent('Planning')
  })

  it('phase button is not shown at game over', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    // drive player score to 50 to trigger game over
    for (let i = 0; i < 50; i++) await user.click(screen.getByTestId('player-increment'))
    expect(screen.queryByTestId('phase-btn')).not.toBeInTheDocument()
  })

  it('undo after End-tap restores phase to End', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(btn)
    await user.click(btn) // End → advance round → Planning
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(btn).toHaveTextContent('End')
  })

  it('undo after round-tracker advance restores phase to what it was before', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('phase-btn')
    await user.click(btn)
    await user.click(btn)
    expect(btn).toHaveTextContent('Activation')
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    expect(btn).toHaveTextContent('Planning')
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(btn).toHaveTextContent('Activation')
  })

  it('tapping End on round 12 does not advance to Planning', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    for (let r = 2; r <= 12; r++) {
      await user.click(screen.getByRole('button', { name: `Round ${r}` }))
    }
    const btn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(btn) // Planning → System → Activation → Engagement → End
    expect(btn).toHaveTextContent('End')
    await user.click(btn) // should stay at End
    expect(btn).toHaveTextContent('End')
  })

  it('non-End phases on round 12 still advance normally', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    for (let r = 2; r <= 12; r++) {
      await user.click(screen.getByRole('button', { name: `Round ${r}` }))
    }
    const btn = screen.getByTestId('phase-btn')
    expect(btn).toHaveTextContent('Planning')
    await user.click(btn)
    expect(btn).toHaveTextContent('System')
    await user.click(btn)
    expect(btn).toHaveTextContent('Activation')
  })

  it('phase button is not shown when enableXwingPhases is false', async () => {
    mockUserSettings.enableXwingPhases = false
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.queryByTestId('phase-btn')).not.toBeInTheDocument()
  })

  it('tapping End phase at round 12 triggers game over and shows result banner', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    for (let r = 2; r <= 12; r++) {
      await user.click(screen.getByRole('button', { name: `Round ${r}` }))
    }
    const btn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(btn) // reach End phase
    await user.click(btn) // trigger game over
    expect(screen.getByTestId('result-banner')).toBeInTheDocument()
  })

  it('undo from round-12 game-end restores to round 12 End phase, not round 11', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    for (let r = 2; r <= 12; r++) {
      await user.click(screen.getByRole('button', { name: `Round ${r}` }))
    }
    const btn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(btn)
    await user.click(btn) // game over
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    // game should be restored to round 12, End phase — not round 11
    expect(screen.getByRole('button', { name: 'Round 12' }).style.borderColor).toBe('var(--color-accent)')
    expect(btn).toHaveTextContent('End')
  })

  it('undo from timer-expired game-end restores to the End phase of the current round', async () => {
    mockTimerState.isExpired = true
    mockTimerState.remaining = 0
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(btn) // reach End
    await user.click(btn) // game over
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(btn).toHaveTextContent('End')
    expect(screen.queryByTestId('result-banner')).not.toBeInTheDocument()
  })

  it('tapping End phase when timer expired triggers game over and shows result banner', async () => {
    mockTimerState.isExpired = true
    mockTimerState.remaining = 0
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    const btn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(btn) // reach End phase
    await user.click(btn) // trigger game over
    expect(screen.getByTestId('result-banner')).toBeInTheDocument()
  })

  it('result banner shows Game Won when player has more points at end', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('player-increment'))
    for (let r = 2; r <= 12; r++) {
      await user.click(screen.getByRole('button', { name: `Round ${r}` }))
    }
    const btn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(btn)
    await user.click(btn)
    expect(screen.getByTestId('result-banner')).toHaveTextContent('Game Won')
  })

  it('result banner shows Game Lost when opponent has more points at end', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByTestId('opponent-increment'))
    for (let r = 2; r <= 12; r++) {
      await user.click(screen.getByRole('button', { name: `Round ${r}` }))
    }
    const btn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(btn)
    await user.click(btn)
    expect(screen.getByTestId('result-banner')).toHaveTextContent('Game Lost')
  })

  it('result banner shows Draw when scores are equal at end', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    for (let r = 2; r <= 12; r++) {
      await user.click(screen.getByRole('button', { name: `Round ${r}` }))
    }
    const btn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(btn)
    await user.click(btn)
    expect(screen.getByTestId('result-banner')).toHaveTextContent('Draw')
  })

  it('initiative tap zones are always present when phases are disabled', async () => {
    mockUserSettings.enableXwingPhases = false
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    // advance a phase would normally lock initiative, but phases are disabled
    expect(screen.getByTestId('initiative-opp-zone')).toBeInTheDocument()
    expect(screen.getByTestId('initiative-you-zone')).toBeInTheDocument()
  })

})

// ---------------------------------------------------------------------------
// Scenario name
// ---------------------------------------------------------------------------

describe('XwingGameScreen scenario name', () => {

  it('shows scenario name subtitle after game starts when scenario is set', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByTestId('scenario-name')).toHaveTextContent('Salvage Mission')
  })

  it('does not show scenario name when scenario is None', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.queryByTestId('scenario-name')).not.toBeInTheDocument()
  })

  it('does not show scenario name before game starts', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Ancient Knowledge" />)
    expect(screen.queryByTestId('scenario-name')).not.toBeInTheDocument()
  })

})

// ---------------------------------------------------------------------------
// Scenario scoring
// ---------------------------------------------------------------------------

describe('XwingGameScreen scenario scoring', () => {

  it('scenario point buttons are not shown when scenario is None', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn)
    expect(screen.queryByTestId('player-scenario-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('opponent-scenario-0')).not.toBeInTheDocument()
  })

  it('scenario point buttons are not shown in round 1 End phase', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn) // reach End of round 1
    expect(screen.queryByTestId('player-scenario-0')).not.toBeInTheDocument()
  })

  it('scenario point buttons are not shown when phases are disabled', async () => {
    mockUserSettings.enableXwingPhases = false
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.queryByTestId('player-scenario-0')).not.toBeInTheDocument()
  })

  it('scenario point buttons appear in End phase of round 2 with a scenario', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn)
    expect(screen.getByTestId('player-scenario-0')).toBeInTheDocument()
    expect(screen.getByTestId('player-scenario-2')).toBeInTheDocument()
    expect(screen.getByTestId('player-scenario-4')).toBeInTheDocument()
    expect(screen.getByTestId('opponent-scenario-0')).toBeInTheDocument()
    expect(screen.getByTestId('opponent-scenario-2')).toBeInTheDocument()
    expect(screen.getByTestId('opponent-scenario-4')).toBeInTheDocument()
  })

  it('inc/dec buttons are disabled by scenario buttons during End-phase scoring', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn)
    expect(screen.getByTestId('player-increment')).toBeDisabled()
    expect(screen.getByTestId('opponent-increment')).toBeDisabled()
    expect(screen.getByTestId('player-scenario-0')).toBeInTheDocument()
  })

  it('inc/dec buttons return after phase advance from End', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn) // reach End
    await user.click(phaseBtn) // advance to round 3
    expect(screen.getByTestId('player-increment')).toBeInTheDocument()
    expect(screen.queryByTestId('player-scenario-0')).not.toBeInTheDocument()
  })

  it('tapping phase button applies pending player scenario points to displayed score', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn)
    await user.click(screen.getByTestId('player-scenario-2'))
    await user.click(phaseBtn)
    expect(screen.getByTestId('player-score')).toHaveTextContent('2')
  })

  it('tapping phase button applies pending opponent scenario points to displayed score', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn)
    await user.click(screen.getByTestId('opponent-scenario-4'))
    await user.click(phaseBtn)
    expect(screen.getByTestId('opponent-score')).toHaveTextContent('4')
  })

  it('advancing via round tracker from End phase applies pending scenario points', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn)
    await user.click(screen.getByTestId('player-scenario-2'))
    await user.click(screen.getByRole('button', { name: 'Round 3' }))
    expect(screen.getByTestId('player-score')).toHaveTextContent('2')
  })

  it('combined scenario and ship score of 50 triggers game over', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    for (let i = 0; i < 48; i++) fireEvent.click(screen.getByTestId('player-increment'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn)
    await user.click(screen.getByTestId('player-scenario-2'))
    await user.click(phaseBtn)
    expect(screen.getByTestId('result-banner')).toBeInTheDocument()
  })

  it('log records a separate scenario entry when scenario points are scored', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn)
    await user.click(screen.getByTestId('player-scenario-2'))
    await user.click(phaseBtn)
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getByText('Scenario: You +2, Opp +0')).toBeInTheDocument()
    expect(screen.getByText('Round 3')).toBeInTheDocument()
  })

  it('undo of scenario round advance restores both score and round', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn)
    await user.click(screen.getByTestId('player-scenario-2'))
    await user.click(phaseBtn) // apply +2, advance to round 3
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('0')
    expect(screen.getByRole('button', { name: 'Round 2' }).style.borderColor).toBe('var(--color-accent)')
  })

  it('scenario buttons are disabled after undo when a scenario entry already exists for the current round', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} scenario="Salvage Mission" />)
    await user.click(screen.getByTestId('start-game-btn'))
    await user.click(screen.getByRole('button', { name: 'Round 2' }))
    const phaseBtn = screen.getByTestId('phase-btn')
    for (let i = 0; i < 4; i++) await user.click(phaseBtn) // reach End
    await user.click(screen.getByTestId('player-scenario-2'))
    await user.click(phaseBtn) // advance to round 3 — logs scenario + round entries
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn')) // undo Round 3, back in End phase round 2
    expect(screen.getByTestId('player-scenario-0')).toBeDisabled()
    expect(screen.getByTestId('player-scenario-2')).toBeDisabled()
    expect(screen.getByTestId('player-scenario-4')).toBeDisabled()
    expect(screen.getByTestId('opponent-scenario-0')).toBeDisabled()
  })

})
