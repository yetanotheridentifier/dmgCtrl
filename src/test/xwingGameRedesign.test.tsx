import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import XwingGameScreen from '../components/xwingGameScreen'
import { useOrientation } from '../hooks/useOrientation'

// The redesigned game screen: three columns, whole-tile ships, the centre panel by phase, the log
// drawer, the round-and-timer sheet, and game over with Rematch, One more round and New setup.

vi.mock('../hooks/useOrientation')
vi.mock('../hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }))
vi.mock('../services/analytics', () => ({
  onXwingGameStarted: vi.fn().mockResolvedValue(undefined),
  onXwingGameEnded: vi.fn().mockResolvedValue(undefined),
  onXwingRoundAdvanced: vi.fn().mockResolvedValue(undefined),
}))

const mockUserSettings = vi.hoisted(() => ({
  enableInitiativeBar: true,
  enableXwingPhases: true,
  enableXwingAlwaysIncDec: false,
  xwingTimerMinutes: 75,
  setXwingTimerMinutes: vi.fn(),
}))
vi.mock('../hooks/useUserSettings', () => ({ useUserSettings: () => mockUserSettings }))

const mockTimerState = vi.hoisted(() => ({
  remaining: 4500, isRunning: false, isExpired: false,
  start: vi.fn(), reset: vi.fn(), stop: vi.fn(), resume: vi.fn(),
}))
vi.mock('../hooks/useTimer', () => ({ useTimer: () => mockTimerState }))

beforeEach(() => {
  vi.mocked(useOrientation).mockReturnValue({ isPortrait: false, vmin: 0 })
  mockUserSettings.enableXwingPhases = true
  mockUserSettings.enableXwingAlwaysIncDec = false
  mockUserSettings.xwingTimerMinutes = 75
  mockUserSettings.setXwingTimerMinutes.mockClear()
  mockTimerState.remaining = 4500
  mockTimerState.isExpired = false
  mockTimerState.start.mockClear()
  mockTimerState.reset.mockClear()
})

const ACADEMY = { name: 'academypilot', ship: 'tielnfighter', points: 5 }
const MINE = [
  { name: 'howlrunner', ship: 'tielnfighter', points: 9 },
  ACADEMY, ACADEMY,
]
const THEIRS = [
  { name: 'darthvader', ship: 'tieadvancedx1', points: 12 },
  { name: 'wampa', ship: 'tielnfighter', points: 6 },
]

type Props = Partial<React.ComponentProps<typeof XwingGameScreen>>

function renderGame(props: Props = {}) {
  const user = userEvent.setup()
  const onBack = vi.fn()
  render(<XwingGameScreen onBack={onBack} onHelp={vi.fn()} playerPilots={MINE} opponentPilots={THEIRS} {...props} />)
  return { user, onBack }
}

async function start(props: Props = {}) {
  const r = renderGame(props)
  await r.user.click(screen.getByRole('button', { name: 'Start game' }))
  return r
}

async function tapPhase(user: ReturnType<typeof userEvent.setup>, times: number) {
  for (let i = 0; i < times; i++) await user.click(screen.getByTestId('phase-btn'))
}

describe('ship tiles', () => {
  it('shows a hint over the ship columns before the game, which goes once it starts', async () => {
    const { user } = renderGame()
    expect(screen.getByText('Tap a ship to damage it; tap again or long-press to destroy')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start game' }))
    expect(screen.queryByText('Tap a ship to damage it; tap again or long-press to destroy')).not.toBeInTheDocument()
  })

  it('shows every ship before the game, disabled', () => {
    renderGame()
    expect(screen.getByTestId('player-ship-btn-0')).toBeDisabled()
    expect(screen.getByTestId('opponent-ship-btn-1')).toBeDisabled()
    expect(within(screen.getByTestId('player-ship-btn-1')).getByText('Academy Pilot 1')).toBeInTheDocument()
  })

  it('the whole tile damages, then destroys, and the destroyed ship stays in place', async () => {
    const { user } = await start()
    const tile = screen.getByTestId('opponent-ship-btn-0')
    await user.click(tile)
    expect(tile).toHaveTextContent('Half · 6 of 12')
    expect(screen.getByTestId('player-score')).toHaveTextContent('6')
    await user.click(tile)
    expect(screen.getByTestId('opponent-ship-btn-0')).toHaveTextContent('Destroyed')
    expect(screen.getByTestId('player-score')).toHaveTextContent('12')
  })

  it('shows each ship\'s faction symbol before its name, from the pilot', () => {
    renderGame({ opponentPilots: [{ name: 'lukeskywalker', ship: 't65xwing', points: 6 }] })
    expect(within(screen.getByTestId('player-ship-btn-0')).getByRole('img', { name: 'Galactic Empire' })).toBeInTheDocument()
    expect(within(screen.getByTestId('player-ship-btn-2')).getByRole('img', { name: 'Galactic Empire' })).toBeInTheDocument()
    expect(within(screen.getByTestId('opponent-ship-btn-0')).getByRole('img', { name: 'Rebel Alliance' })).toBeInTheDocument()
  })

  it('shows no symbol for a pilot it does not know', () => {
    renderGame({ opponentPilots: [{ name: 'notarealpilot', ship: 't65xwing', points: 6 }] })
    expect(within(screen.getByTestId('opponent-ship-btn-0')).queryByRole('img')).not.toBeInTheDocument()
  })

  it('a destroyed ship shows the dmgCtrl mark in place of its faction symbol', async () => {
    const { user } = await start()
    const tile = screen.getByTestId('opponent-ship-btn-0')
    await user.click(tile)
    expect(within(tile).getByRole('img', { name: 'Galactic Empire' })).toBeInTheDocument()
    await user.click(tile)
    const destroyed = screen.getByTestId('opponent-ship-btn-0')
    expect(within(destroyed).getByRole('img', { name: 'Destroyed' })).toBeInTheDocument()
    expect(within(destroyed).getAllByRole('img')).toHaveLength(1)
  })

  it('lays out the ships by the row rule', () => {
    const seven = [...MINE, { name: 'maulermithel', ship: 'tielnfighter', points: 8 }, { name: 'majorvynder', ship: 'tielnfighter', points: 10 }, { name: 'countdown', ship: 'tielnfighter', points: 7 }, ACADEMY]
    renderGame({ playerPilots: seven })
    const rows = within(screen.getByTestId('player-pilot-list')).getAllByTestId('ship-row')
    expect(rows).toHaveLength(4)
    expect(rows.map(r => within(r).getAllByRole('button').length)).toEqual([1, 2, 2, 2])
  })
})

describe('centre panel, phase tracker on', () => {
  it('asks who has initiative in Planning, and marks FIRST under that score in the later phases', async () => {
    const { user } = await start()
    expect(screen.getByText('Who has initiative?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Opponent' }))
    await tapPhase(user, 1)
    expect(screen.queryByText('Who has initiative?')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('opponent-score-tile')).getByText('FIRST')).toBeInTheDocument()
    expect(within(screen.getByTestId('player-score-tile')).queryByText('FIRST')).not.toBeInTheDocument()
  })

  it('shows mission points only in the End phase', async () => {
    const { user } = await start({ scenario: 'Assault at the Satellite Array' })
    await tapPhase(user, 5)
    expect(screen.queryByTestId('player-scenario-4')).not.toBeInTheDocument()
    await tapPhase(user, 4)
    expect(screen.getByTestId('player-scenario-4')).toBeInTheDocument()
  })
})

describe('centre panel, phase tracker off', () => {
  beforeEach(() => { mockUserSettings.enableXwingPhases = false })

  it('holds the round button and a First choice that can change at any time', async () => {
    const { user } = await start()
    const roundBtn = screen.getByTestId('round-btn')
    expect(roundBtn).toHaveTextContent('Round 1 of 12')
    expect(roundBtn).toHaveTextContent('Tap to score the round')
    const first = screen.getByRole('group', { name: 'First' })
    await user.click(within(first).getByRole('button', { name: 'Opp' }))
    expect(within(screen.getByTestId('opponent-score-tile')).getByText('FIRST')).toBeInTheDocument()
    await user.click(within(first).getByRole('button', { name: 'You' }))
    expect(within(screen.getByTestId('player-score-tile')).getByText('FIRST')).toBeInTheDocument()
  })

  it('one tap opens the round scoring, and its button scores the round and starts the next', async () => {
    const { user } = await start({ scenario: 'Assault at the Satellite Array' })
    await user.click(screen.getByTestId('round-btn'))
    await user.click(screen.getByRole('button', { name: /Start round 2/ }))
    expect(screen.getByTestId('round-btn')).toHaveTextContent('Round 2 of 12')
    await user.click(screen.getByTestId('round-btn'))
    await user.click(screen.getByTestId('player-scenario-4'))
    await user.click(screen.getByRole('button', { name: /Start round 3/ }))
    expect(screen.getByTestId('player-score')).toHaveTextContent('4')
    expect(screen.getByTestId('round-btn')).toHaveTextContent('Round 3 of 12')
  })

  it('opening the scoring is logged, so Undo takes back a mistaken tap', async () => {
    const { user } = await start()
    await user.click(screen.getByTestId('round-btn'))
    expect(screen.queryByTestId('round-btn')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('log-btn'))
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('round-btn')).toHaveTextContent('Round 1 of 12')
  })
})

describe('game over', () => {
  async function playToTimeOut(props: Props = {}) {
    const r = await start(props)
    mockTimerState.isExpired = true
    mockTimerState.remaining = 0
    await tapPhase(r.user, 5)
    return r
  }

  it('offers Rematch and New setup with the result', async () => {
    const { user, onBack } = await playToTimeOut({ matchType: 'Tournament' })
    expect(screen.getByTestId('result-banner')).toHaveTextContent('Draw')
    expect(screen.queryByRole('button', { name: 'One more round' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New setup' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('Rematch goes back to before the game with the same lists', async () => {
    const { user } = await start()
    await user.click(screen.getByTestId('opponent-ship-btn-0'))
    mockTimerState.isExpired = true
    await tapPhase(user, 5)
    mockTimerState.isExpired = false
    await user.click(screen.getByRole('button', { name: 'Rematch' }))
    expect(screen.getByRole('button', { name: 'Start game' })).toBeInTheDocument()
    expect(screen.getByTestId('player-score')).toHaveTextContent('0')
    expect(screen.getByTestId('opponent-ship-btn-0')).toHaveTextContent('Darth Vader')
    expect(screen.getByTestId('opponent-ship-btn-0')).not.toHaveTextContent('Half')
  })

  it('shows the score breakdown for both sides', async () => {
    const { user } = await start({ opponentDeficit: 3 })
    await user.click(screen.getByTestId('opponent-ship-btn-0'))
    mockTimerState.isExpired = true
    await tapPhase(user, 5)
    const breakdown = screen.getByTestId('score-breakdown')
    expect(within(breakdown).getByText('Ships')).toBeInTheDocument()
    expect(within(breakdown).getByText('Mission')).toBeInTheDocument()
    expect(within(breakdown).getByText('Deficit')).toBeInTheDocument()
    expect(within(breakdown).getByTestId('breakdown-player-ships')).toHaveTextContent('6')
    expect(within(breakdown).getByTestId('breakdown-player-total')).toHaveTextContent('6')
  })

  it('offers One more round in a Casual game that ran out of time, and it ends again after that round', async () => {
    const { user } = await playToTimeOut({ matchType: 'Casual' })
    await user.click(screen.getByRole('button', { name: 'One more round' }))
    expect(screen.queryByTestId('result-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('phase-btn')).toHaveTextContent('Planning')
    await tapPhase(user, 5)
    expect(screen.getByTestId('result-banner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'One more round' })).toBeInTheDocument()
  })

  it('in a tournament game, the only way on is Back to tournament, which records the result from the scores', async () => {
    const onRoundComplete = vi.fn()
    const { user } = await start({ matchType: 'Tournament', onRoundComplete })
    await user.click(screen.getByTestId('opponent-ship-btn-0'))
    mockTimerState.isExpired = true
    await tapPhase(user, 5)
    const panel = screen.getByTestId('result-banner').parentElement!
    expect(within(panel).queryByRole('button', { name: 'Rematch' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'One more round' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'New setup' })).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Back to tournament' }))
    expect(onRoundComplete).toHaveBeenCalledWith('won', 6, 0)
  })

  it.each([
    ['lost', 'player-ship-btn-0', 0, 4],
    ['drawn', null, 0, 0],
  ] as const)('a tournament game records a %s game', async (result, ship, mine, theirs) => {
    const onRoundComplete = vi.fn()
    const { user } = await start({ matchType: 'Tournament', onRoundComplete })
    if (ship) await user.click(screen.getByTestId(ship))
    mockTimerState.isExpired = true
    await tapPhase(user, 5)
    await user.click(within(screen.getByTestId('result-banner').parentElement!).getByRole('button', { name: 'Back to tournament' }))
    expect(onRoundComplete).toHaveBeenCalledWith(result, mine, theirs)
  })

  it('in a tournament game, the header back button goes back to the tournament without recording', async () => {
    const onRoundComplete = vi.fn()
    const { user, onBack } = await start({ matchType: 'Tournament', onRoundComplete })
    await user.click(screen.getByRole('button', { name: 'Back to tournament' }))
    expect(onBack).toHaveBeenCalled()
    expect(onRoundComplete).not.toHaveBeenCalled()
  })

  it('does not offer One more round when a side has no ships left', async () => {
    const { user } = await start({ matchType: 'Casual', opponentPilots: [ACADEMY] })
    await user.click(screen.getByTestId('opponent-ship-btn-0'))
    await user.click(screen.getByTestId('opponent-ship-btn-0'))
    mockTimerState.isExpired = true
    await tapPhase(user, 5)
    expect(screen.getByTestId('result-banner')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'One more round' })).not.toBeInTheDocument()
  })
})

describe('round and timer sheet', () => {
  it('sets the game length in 5-minute steps until Start game', async () => {
    const { user } = renderGame()
    await user.click(screen.getByTestId('round-timer-btn'))
    const sheet = screen.getByRole('dialog', { name: 'Round and timer' })
    await user.click(within(sheet).getByRole('button', { name: 'Increase game length' }))
    expect(mockUserSettings.setXwingTimerMinutes).toHaveBeenCalledWith(80)
  })

  it('has no game length once the game has started', async () => {
    const { user } = await start()
    await user.click(screen.getByTestId('round-timer-btn'))
    const sheet = screen.getByRole('dialog', { name: 'Round and timer' })
    expect(within(sheet).queryByRole('button', { name: 'Increase game length' })).not.toBeInTheDocument()
  })
})

describe('score buttons', () => {
  it('are hidden by default when both sides have a list', async () => {
    await start()
    expect(screen.queryByTestId('player-increment')).not.toBeInTheDocument()
    expect(screen.queryByTestId('opponent-increment')).not.toBeInTheDocument()
  })

  // The buttons over a column stand in for its tiles: those over the opponent's column score for you.
  it('always show over a side with No list, which is scored with them', async () => {
    const { user } = await start({ opponentPilots: [] })
    expect(screen.queryByTestId('opponent-increment')).not.toBeInTheDocument()
    const column = screen.getByTestId('opponent-column')
    await user.click(within(column).getByTestId('player-increment'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('1')
  })
})

describe('log drawer', () => {
  it('lists entries newest first under their round, with numbered ship names', async () => {
    const { user } = await start()
    await user.click(screen.getByTestId('player-ship-btn-2'))
    await user.click(screen.getByTestId('opponent-ship-btn-1'))
    await user.click(screen.getByTestId('log-btn'))
    const drawer = screen.getByRole('dialog', { name: 'Log' })
    const entries = within(drawer).getAllByTestId('log-entry')
    expect(entries[0]).toHaveTextContent('"Wampa" damaged')
    expect(entries[1]).toHaveTextContent('Academy Pilot 2 damaged')
    expect(within(drawer).getByText(/Round 1/)).toBeInTheDocument()
  })

  it('Undo takes back the newest entry, and repeating it steps further back', async () => {
    const { user } = await start()
    await user.click(screen.getByTestId('opponent-ship-btn-1'))
    await user.click(screen.getByTestId('opponent-ship-btn-1'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('6')
    await user.click(screen.getByTestId('log-btn'))
    expect(screen.getAllByTestId('log-undo-btn')).toHaveLength(1)
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('3')
    await user.click(screen.getByTestId('log-undo-btn'))
    expect(screen.getByTestId('player-score')).toHaveTextContent('0')
  })
})
