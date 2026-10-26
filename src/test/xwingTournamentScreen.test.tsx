import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import XwingTournamentScreen from '../components/xwingTournamentScreen'
import type { XwingTournamentList, XwingTournamentRound, XwingTournamentState } from '../hooks/useXwingTournament'
import type { XwingList } from '../hooks/useXwingLists'
import { makeMatchMediaMock } from './setup'

const EMPIRE: XwingList = {
  id: 'empire',
  name: 'Vader Wing',
  pilots: [
    { name: 'darthvader', ship: 'tieadvancedx1', points: 21 },
    { name: 'soontirfel', ship: 'tieinterceptor', points: 15 },
    { name: 'vermeil', ship: 'tiedefender', points: 11 },
  ],
}

const mockXwingLists = vi.hoisted(() => ({
  lists: [] as XwingList[],
  saveList: vi.fn(),
  renameList: vi.fn(),
  removeList: vi.fn(),
  clearLists: vi.fn(),
}))
vi.mock('../hooks/useXwingLists', () => ({
  useXwingLists: () => mockXwingLists,
}))

const MINE: XwingTournamentList = {
  name: 'Howlrunner swarm',
  pilots: [
    { name: 'howlrunner', ship: 'tielnfighter', points: 25 },
    { name: 'iden', ship: 'tielnfighter', points: 24 },
  ],
  deficit: 1,
}
const opponent = (name: string): XwingTournamentList => ({ name, pilots: [], deficit: 0 })
const round = (name: string, result: XwingTournamentRound['result'], playerScore = 0, opponentScore = 0): XwingTournamentRound =>
  ({ opponent: opponent(name), result, playerScore, opponentScore })

const TWO_PLAYED: XwingTournamentState = {
  totalRounds: 4,
  scenario: 'None',
  player: MINE,
  rounds: [round('Resistance aces', 'won', 23, 9), round('Phoenix Squadron', 'lost', 11, 20)],
}

type Props = React.ComponentProps<typeof XwingTournamentScreen>

function renderHub(props: Partial<Props> = {}) {
  const handlers = {
    onStartRound: vi.fn(),
    onReturnToRound: vi.fn(),
    onDrop: vi.fn(),
    onFinish: vi.fn(),
    onBack: vi.fn(),
    onHelp: vi.fn(),
    onSettings: vi.fn(),
    onLists: vi.fn(),
  }
  render(
    <XwingTournamentScreen
      tournament={TWO_PLAYED}
      roundInProgress={false}
      isComplete={false}
      totals={{ won: 1, lost: 1, drawn: 0 }}
      margin={5}
      {...handlers}
      {...props}
    />,
  )
  return { user: userEvent.setup(), ...handlers }
}

beforeEach(() => {
  makeMatchMediaMock(false)
  mockXwingLists.lists = [EMPIRE]
})

describe('XwingTournamentScreen: between rounds', () => {

  it('heads the screen Tournament with the game and the rounds', () => {
    renderHub()
    expect(screen.getByRole('heading', { level: 1, name: 'Tournament' })).toBeInTheDocument()
    expect(screen.getByText('X-Wing · 4 rounds')).toBeInTheDocument()
  })

  it('shows the record as wins–losses with the running margin', () => {
    renderHub()
    const record = screen.getByRole('region', { name: 'Record' })
    expect(within(record).getByText('1–1')).toBeInTheDocument()
    expect(within(record).getByText('Won 1, lost 1')).toBeInTheDocument()
    expect(within(record).getByText('Margin +5')).toBeInTheDocument()
  })

  it('a negative margin carries a minus sign, and a draw joins the record', () => {
    renderHub({ totals: { won: 0, lost: 1, drawn: 1 }, margin: -9 })
    const record = screen.getByRole('region', { name: 'Record' })
    expect(within(record).getByText('0–1–1')).toBeInTheDocument()
    expect(within(record).getByText('Won 0, lost 1, drawn 1')).toBeInTheDocument()
    expect(within(record).getByText('Margin −9')).toBeInTheDocument()
  })

  it('shows your list for the tournament with its points', () => {
    renderHub()
    const list = screen.getByRole('region', { name: 'Your list' })
    expect(within(list).getByText('Howlrunner swarm')).toBeInTheDocument()
    expect(within(list).getByText('Your list for this tournament · 49 pts')).toBeInTheDocument()
  })

  it('lists every round: each played one with win or loss, its score and the opponent’s list, then the next', () => {
    renderHub()
    const rows = within(screen.getByRole('list', { name: 'Rounds' })).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('Round 1')
    expect(rows[0]).toHaveTextContent('Won')
    expect(rows[0]).toHaveTextContent('23–9')
    expect(rows[0]).toHaveTextContent('vs Resistance aces')
    expect(rows[1]).toHaveTextContent('Lost')
    expect(rows[1]).toHaveTextContent('11–20')
    expect(rows[1]).toHaveTextContent('vs Phoenix Squadron')
    expect(rows[2]).toHaveTextContent('Next')
    expect(rows[2]).toHaveAttribute('aria-current', 'step')
    expect(rows[3]).toHaveTextContent('Round 4')
  })

  it('Start round N opens the opponent list sheet: each saved list and No list', async () => {
    const { user } = renderHub()
    await user.click(screen.getByRole('button', { name: 'Start round 3' }))
    const sheet = screen.getByRole('dialog', { name: 'Opponent’s list for round 3' })
    expect(within(sheet).getByText('Vader Wing')).toBeInTheDocument()
    expect(within(sheet).getByText('No list')).toBeInTheDocument()
  })

  it('choosing a saved list starts the round against it, the deficit from its points', async () => {
    const { user, onStartRound } = renderHub()
    await user.click(screen.getByRole('button', { name: 'Start round 3' }))
    await user.click(within(screen.getByRole('dialog')).getByText('Vader Wing'))
    expect(onStartRound).toHaveBeenCalledWith({ name: 'Vader Wing', pilots: EMPIRE.pilots, deficit: 3 })
  })

  it('choosing No list starts the round with no ships', async () => {
    const { user, onStartRound } = renderHub()
    await user.click(screen.getByRole('button', { name: 'Start round 3' }))
    await user.click(within(screen.getByRole('dialog')).getByText('No list'))
    expect(onStartRound).toHaveBeenCalledWith({ name: 'No list', pilots: [], deficit: 0 })
  })

  it('Import XWS in the opponent sheet goes to Squad lists', async () => {
    const { user, onLists } = renderHub()
    await user.click(screen.getByRole('button', { name: 'Start round 3' }))
    await user.click(screen.getByRole('button', { name: 'Import XWS' }))
    expect(onLists).toHaveBeenCalled()
  })

  it('a round under way is returned to, with no sheet', async () => {
    const t = { ...TWO_PLAYED, rounds: [...TWO_PLAYED.rounds, round('Scum aces', null)] }
    const { user, onReturnToRound } = renderHub({ tournament: t, roundInProgress: true })
    const rows = within(screen.getByRole('list', { name: 'Rounds' })).getAllByRole('listitem')
    expect(rows[2]).toHaveTextContent('In progress')
    expect(rows[2]).toHaveTextContent('vs Scum aces')
    await user.click(screen.getByRole('button', { name: 'Return to round 3' }))
    expect(onReturnToRound).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Drop asks first, with the record that would be cleared', async () => {
    const { user, onDrop } = renderHub()
    await user.click(screen.getByRole('button', { name: 'Drop' }))
    const sheet = screen.getByRole('dialog', { name: 'Drop from the tournament?' })
    expect(sheet).toHaveTextContent('Your record (1–1, margin +5) is cleared and you go back to setup. This can’t be undone.')
    await user.click(within(sheet).getByRole('button', { name: 'Keep playing' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onDrop).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Drop' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Drop' }))
    expect(onDrop).toHaveBeenCalled()
  })

  it('Back, Help and Settings', async () => {
    const { user, onBack, onHelp, onSettings } = renderHub()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Help' }))
    expect(onHelp).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalled()
  })

  it('portrait shows the same record, list and rounds', () => {
    makeMatchMediaMock(true)
    renderHub()
    expect(screen.getByRole('region', { name: 'Record' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Your list' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start round 3' })).toBeInTheDocument()
  })
})

describe('XwingTournamentScreen: complete', () => {

  const DONE: XwingTournamentState = {
    ...TWO_PLAYED,
    totalRounds: 2,
  }

  it('reads Tournament complete, offers Finish and no Drop', async () => {
    const { user, onFinish } = renderHub({ tournament: DONE, isComplete: true })
    expect(screen.getByRole('heading', { level: 1, name: 'Tournament complete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drop' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(onFinish).toHaveBeenCalled()
  })
})
