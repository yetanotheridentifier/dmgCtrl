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
vi.mock('../services/analytics', () => ({
  onXwingGameStarted: mockOnXwingGameStarted,
  onXwingGameEnded: mockOnXwingGameEnded,
}))

const mockUserSettings = vi.hoisted(() => ({
  enableLongPress: true,
  enableActionLog: true,
  enableWakeLock: true,
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
  mockUserSettings.xwingTimerMinutes = 75
  mockTimerState.remaining = 4500
  mockTimerState.isRunning = false
  mockTimerState.isExpired = false
  mockTimerState.start.mockClear()
  mockTimerState.reset.mockClear()
  mockTimerState.stop.mockClear()
  mockOnXwingGameStarted.mockClear()
  mockOnXwingGameEnded.mockClear()
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
// Pre-game (deficit entry)
// ---------------------------------------------------------------------------

describe('XwingGameScreen pre-game', () => {

  it('shows Your deficit label before game starts', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText(/your deficit/i)).toBeInTheDocument()
  })

  it("shows Opp's deficit label before game starts", () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText(/opp's deficit/i)).toBeInTheDocument()
  })

  it('shows Start Game button before game starts', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('start-game-btn')).toBeInTheDocument()
  })

  it('deficit inputs default to 0', () => {
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByTestId('player-deficit-value')).toHaveTextContent('0')
    expect(screen.getByTestId('opponent-deficit-value')).toHaveTextContent('0')
  })

  it('player deficit increments', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-deficit-increment'))
    expect(screen.getByTestId('player-deficit-value')).toHaveTextContent('1')
  })

  it('player deficit decrements but clamps at 0', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-deficit-decrement'))
    expect(screen.getByTestId('player-deficit-value')).toHaveTextContent('0')
  })

  it('opponent deficit increments', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('opponent-deficit-increment'))
    expect(screen.getByTestId('opponent-deficit-value')).toHaveTextContent('1')
  })

  it('hides deficit controls after Start Game', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.queryByText(/your deficit/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/opp's deficit/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('start-game-btn')).not.toBeInTheDocument()
  })

})

// ---------------------------------------------------------------------------
// Score counters (post-game-start)
// ---------------------------------------------------------------------------

describe('XwingGameScreen score counters', () => {

  it('player score starts at 0 after Start Game regardless of deficit', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-deficit-increment'))
    await user.click(screen.getByTestId('player-deficit-increment'))
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('0')
  })

  it('opponent score starts at 0 after Start Game regardless of deficit', async () => {
    const user = userEvent.setup()
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('opponent-deficit-increment'))
    await user.click(screen.getByTestId('start-game-btn'))
    expect(screen.getByTestId('opponent-score')).toHaveTextContent('0')
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
    render(<XwingGameScreen onBack={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByTestId('player-deficit-increment'))
    await user.click(screen.getByTestId('player-deficit-increment'))
    await user.click(screen.getByTestId('opponent-deficit-increment'))
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
