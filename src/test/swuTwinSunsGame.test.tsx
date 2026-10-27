import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import SwuTwinSunsGame from '../components/swuTwinSunsGame'
import { Base } from '../hooks/useBases'
import { useOrientation } from '../hooks/useOrientation'

vi.mock('../hooks/useOrientation')
vi.mock('../hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }))

const mockOnGameStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnGameEnd = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../services/analytics', () => ({
  onGameStart: mockOnGameStart,
  onGameEnd: mockOnGameEnd,
  onDamageDealt: vi.fn().mockResolvedValue(undefined),
  onDamageHealed: vi.fn().mockResolvedValue(undefined),
  onRoundIncremented: vi.fn().mockResolvedValue(undefined),
  onUndoUsed: vi.fn().mockResolvedValue(undefined),
  onEpicActionUsed: vi.fn().mockResolvedValue(undefined),
  onImageLoadFailed: vi.fn().mockResolvedValue(undefined),
}))

const mockUserSettings = vi.hoisted(() => ({ useHyperspace: false, enableInitiativeBar: true }))
vi.mock('../hooks/useUserSettings', () => ({ useUserSettings: () => mockUserSettings }))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const make = (number: string, name: string, hp: number, epicAction = ''): Base => ({
  set: 'SOR',
  number,
  name,
  subtitle: 'Somewhere',
  hp,
  frontArt: `https://cdn.swu-db.com/images/cards/SOR/${number}.png`,
  frontArtLowRes: null,
  hyperspaceArt: null,
  hyperspaceArtHiRes: null,
  epicAction,
  aspects: ['Vigilance'],
  rarity: 'Common',
})

const jediTemple = make('030', 'Jedi Temple', 28, 'Epic Action: Play a card from your hand, ignoring 1 of its aspect penalties.')
const tomb = make('031', 'Tomb of Eilram', 25)
const colossus = make('032', 'Colossus', 35)
const thermal = make('033', 'Thermal Oscillator', 27)
// Three HP: three taps destroy it.
const outpost = make('034', 'Fragile Outpost', 3)

type Seats = (Base | null)[]
const FOUR: Seats = [tomb, colossus, thermal]

function renderGame(seats: Seats = FOUR, base: Base = jediTemple) {
  const onBack = vi.fn()
  const onHelp = vi.fn()
  render(<SwuTwinSunsGame base={base} seats={seats} onBack={onBack} onHelp={onHelp} onSettings={vi.fn()} />)
  return { onBack, onHelp }
}

const cell = (seat: 'Top left' | 'Top right' | 'Bottom left' | 'Bottom right') => screen.getByRole('region', { name: seat })
type Cell = ReturnType<typeof cell>
const cardIn = (c: Cell) => within(c).getByTestId('game-card')
const hit = (c: Cell, times = 1) => { for (let i = 0; i < times; i++) fireEvent.click(cardIn(c)) }
const damageIn = (c: Cell) => within(c).getByTestId('damage')
const bar = () => screen.getByRole('navigation', { name: /facing you/ })
const press = (name: string | RegExp) => fireEvent.click(within(bar()).getByRole('button', { name }))
const claimPlan = /^Plan: tap/
const claimBlast = /^Blast: tap/
const claimInitiative = /^Claim initiative/
const openLog = () => press('Log')
const undo = () => fireEvent.click(screen.getByTestId('log-undo-btn'))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useOrientation).mockReturnValue({ isPortrait: false, vmin: 0 })
  mockUserSettings.enableInitiativeBar = true
})

// ---------------------------------------------------------------------------

describe('SwuTwinSunsGame: layout', () => {
  it('each base sits in its setup cell, the top row turned to face the far side', () => {
    renderGame()
    expect(within(cell('Top left')).getByRole('button', { name: /^Jedi Temple, your base/ })).toBeInTheDocument()
    expect(within(cell('Top right')).getByRole('button', { name: /^Tomb of Eilram/ })).toBeInTheDocument()
    expect(within(cell('Bottom left')).getByRole('button', { name: /^Colossus/ })).toBeInTheDocument()
    expect(within(cell('Bottom right')).getByRole('button', { name: /^Thermal Oscillator/ })).toBeInTheDocument()
    expect(cell('Top left')).toHaveStyle({ transform: 'rotate(180deg)' })
    expect(cell('Top right')).toHaveStyle({ transform: 'rotate(180deg)' })
    expect(cell('Bottom left')).not.toHaveStyle({ transform: 'rotate(180deg)' })
    expect(cell('Bottom right')).not.toHaveStyle({ transform: 'rotate(180deg)' })
  })

  it('4 players: the bar runs between the side-by-side bases, facing you', () => {
    renderGame()
    expect(screen.getByTestId('twin-suns').getAttribute('data-players')).toBe('4')
    expect(bar()).toHaveStyle({ transform: 'rotate(180deg)' })
    for (const name of ['Back to setup', 'Log', 'More', 'End game']) {
      expect(within(bar()).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(within(bar()).getByRole('button', { name: /^Round 1/ })).toBeInTheDocument()
  })

  it('3 players: the bar sits between the two bases on one side and the single base is centred on the other', () => {
    renderGame([tomb, null, thermal])
    expect(screen.queryByRole('region', { name: 'Bottom left' })).not.toBeInTheDocument()
    const top = screen.getByTestId('twin-suns-row-top')
    const bottom = screen.getByTestId('twin-suns-row-bottom')
    expect(within(top).getByRole('navigation', { name: /facing you/ })).toBeInTheDocument()
    expect(within(bottom).queryByRole('navigation')).not.toBeInTheDocument()
    expect(bottom).toHaveStyle({ justifyContent: 'center' })
    expect(within(bottom).getByRole('region', { name: 'Bottom right' })).toBeInTheDocument()
  })

  it('3 players with the top right seat empty: the bar sits between the two bottom bases', () => {
    renderGame([null, colossus, thermal])
    expect(within(screen.getByTestId('twin-suns-row-bottom')).getByRole('navigation', { name: /facing you/ })).toBeInTheDocument()
    expect(screen.getByTestId('twin-suns-row-top')).toHaveStyle({ justifyContent: 'center' })
  })

  it('keeps the bases and the bar off the screen edges by the edge tokens', () => {
    renderGame()
    const { style } = screen.getByTestId('twin-suns')
    expect([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft])
      .toEqual(['var(--edge-top)', 'var(--edge-right)', 'var(--edge-bottom)', 'var(--edge-left)'])
  })

  it('asks to rotate the phone in portrait', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    renderGame()
    expect(screen.queryByTestId('twin-suns')).not.toBeInTheDocument()
    expect(screen.getByText(/rotate/i)).toBeInTheDocument()
  })

  it('on a tablet every bar control is a 94px square', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query === '(min-height: 600px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    try {
      renderGame()
      for (const name of ['Back to setup', 'Log', 'More', 'End game', claimInitiative, claimPlan, claimBlast, /^Round 1/]) {
        expect(within(bar()).getByRole('button', { name })).toHaveStyle({ width: '94px', height: '94px' })
      }
    } finally {
      window.matchMedia = original
    }
  })
})

describe('SwuTwinSunsGame: damage', () => {
  it('the game starts at round 1: tapping a card adds 1 damage to that base alone', () => {
    renderGame()
    hit(cell('Bottom right'), 2)
    expect(damageIn(cell('Bottom right'))).toHaveTextContent('2')
    expect(within(cell('Bottom right')).getByText('25 HP left')).toBeInTheDocument()
    expect(damageIn(cell('Top left'))).toHaveTextContent('0')
    expect(mockOnGameStart).toHaveBeenCalledTimes(1)
  })

  it('dragging up on a bottom card adds more; on a top card up is down the screen', () => {
    renderGame()
    const drag = (c: Cell, from: number, to: number) => {
      fireEvent.pointerDown(cardIn(c), { clientY: from, pointerId: 1 })
      fireEvent.pointerMove(cardIn(c), { clientY: to, pointerId: 1 })
      fireEvent.pointerUp(cardIn(c), { clientY: to, pointerId: 1 })
    }
    drag(cell('Bottom left'), 100, 60)
    drag(cell('Top right'), 100, 140)
    expect(damageIn(cell('Bottom left'))).toHaveTextContent('3')
    expect(damageIn(cell('Top right'))).toHaveTextContent('3')
  })

  it('Undo in the log takes damage back', () => {
    renderGame()
    hit(cell('Top right'))
    openLog()
    undo()
    expect(damageIn(cell('Top right'))).toHaveTextContent('0')
  })
})

describe('SwuTwinSunsGame: counters', () => {
  it('shows the counters even with the Initiative setting off', () => {
    mockUserSettings.enableInitiativeBar = false
    renderGame()
    for (const name of [claimInitiative, claimPlan, claimBlast]) {
      expect(within(bar()).getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('Plan: tap it, then the base that claimed it; the token sits there and the button shows as taken', () => {
    renderGame()
    press(claimPlan)
    expect(within(bar()).getByText('Tap the base of the player who claimed Plan')).toBeInTheDocument()
    hit(cell('Top right'))
    expect(within(cell('Top right')).getByRole('img', { name: 'Plan, Tomb of Eilram' })).toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: 'Plan is claimed this round' })).toBeDisabled()
    // Choosing the base took no damage.
    expect(damageIn(cell('Top right'))).toHaveTextContent('0')
  })

  it('Cancel leaves the counter unclaimed', () => {
    renderGame()
    press(claimPlan)
    press('Cancel')
    expect(within(bar()).getByRole('button', { name: claimPlan })).toBeEnabled()
    hit(cell('Top right'))
    expect(damageIn(cell('Top right'))).toHaveTextContent('1')
  })

  it('Blast deals 1 damage to every other base at once, and undo takes it all back', () => {
    renderGame()
    press(claimBlast)
    hit(cell('Bottom left'))
    expect(within(cell('Bottom left')).getByRole('img', { name: 'Blast, Colossus' })).toBeInTheDocument()
    expect(damageIn(cell('Bottom left'))).toHaveTextContent('0')
    expect(damageIn(cell('Top left'))).toHaveTextContent('1')
    expect(damageIn(cell('Top right'))).toHaveTextContent('1')
    expect(damageIn(cell('Bottom right'))).toHaveTextContent('1')
    expect(within(bar()).getByRole('button', { name: 'Blast is claimed this round' })).toBeDisabled()
    openLog()
    undo()
    expect(damageIn(cell('Top left'))).toHaveTextContent('0')
    expect(damageIn(cell('Bottom right'))).toHaveTextContent('0')
    expect(within(bar()).getByRole('button', { name: claimBlast })).toBeEnabled()
  })

  it('Round returns Plan and Blast and moves the round on', () => {
    renderGame()
    press(claimPlan)
    hit(cell('Top right'))
    press(claimBlast)
    hit(cell('Bottom left'))
    press(/^Round 1: tap for round 2/)
    expect(within(bar()).getByRole('button', { name: /^Round 2/ })).toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: claimPlan })).toBeEnabled()
    expect(within(bar()).getByRole('button', { name: claimBlast })).toBeEnabled()
    expect(screen.queryByRole('img', { name: /^Plan,/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^Blast,/ })).not.toBeInTheDocument()
  })

  it('initiative stays on its holder across rounds, and moves from the bar or from the token', () => {
    renderGame()
    press(claimInitiative)
    hit(cell('Bottom right'))
    press(/^Round 1/)
    press(/^Round 2/)
    const token = within(cell('Bottom right')).getByRole('button', { name: 'Initiative, Thermal Oscillator: tap to move it' })
    fireEvent.click(token)
    hit(cell('Top left'))
    expect(within(cell('Top left')).getByRole('button', { name: 'Initiative, Jedi Temple: tap to move it' })).toBeInTheDocument()
    expect(within(cell('Bottom right')).queryByRole('button', { name: /^Initiative/ })).not.toBeInTheDocument()
    press(claimInitiative)
    hit(cell('Top right'))
    expect(within(cell('Top right')).getByRole('button', { name: /^Initiative, Tomb of Eilram/ })).toBeInTheDocument()
  })
})

describe('SwuTwinSunsGame: epic action', () => {
  it('the round button on the text box marks it used; tapping the used plate undoes it', () => {
    renderGame()
    fireEvent.click(within(cell('Top left')).getByRole('button', { name: 'Jedi Temple: epic action, tap when used' }))
    const plate = within(cell('Top left')).getByRole('button', { name: 'Jedi Temple: epic action used, tap to undo' })
    expect(plate).toHaveTextContent('EPIC ACTION USED')
    fireEvent.click(plate)
    expect(within(cell('Top left')).getByRole('button', { name: 'Jedi Temple: epic action, tap when used' })).toBeInTheDocument()
  })

  it('a base with no epic action has no button', () => {
    renderGame()
    expect(within(cell('Top right')).queryByRole('button', { name: /epic action/ })).not.toBeInTheDocument()
  })
})

describe('SwuTwinSunsGame: a base destroyed', () => {
  // Fragile Outpost top right, 3 HP.
  const destroyOutpost = () => {
    renderGame([outpost, colossus, thermal])
    hit(cell('Bottom left'), 7)
    hit(cell('Top right'), 3)
  }

  it('shows Destroyed over its card and asks who destroyed it', () => {
    destroyOutpost()
    expect(within(cell('Top right')).getByRole('img', { name: 'Fragile Outpost is destroyed' })).toBeInTheDocument()
    expect(within(bar()).getByText('Fragile Outpost is destroyed')).toBeInTheDocument()
    expect(within(bar()).getByText('Tap the base of the player who destroyed it. That base heals 5.')).toBeInTheDocument()
  })

  it('tapping the base that destroyed it heals that base 5', () => {
    destroyOutpost()
    hit(cell('Bottom left'))
    expect(damageIn(cell('Bottom left'))).toHaveTextContent('2')
    expect(within(cell('Bottom left')).getByText('+5 healed')).toBeInTheDocument()
  })

  it('No one skips the heal', () => {
    destroyOutpost()
    press('No one')
    expect(damageIn(cell('Bottom left'))).toHaveTextContent('7')
    expect(within(bar()).getByText(/LAST PHASE/)).toBeInTheDocument()
  })

  it('Undo the damage takes back the last hit and closes it', () => {
    destroyOutpost()
    press('Undo the damage')
    expect(damageIn(cell('Top right'))).toHaveTextContent('2')
    expect(within(cell('Top right')).queryByRole('img', { name: /is destroyed/ })).not.toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: /^Round 1/ })).toBeInTheDocument()
  })

  it('that player is out: the card stays covered and takes no input', () => {
    destroyOutpost()
    press('No one')
    expect(cardIn(cell('Top right'))).toBeDisabled()
    expect(within(cell('Top right')).getByRole('img', { name: 'Fragile Outpost is destroyed' })).toBeInTheDocument()
  })

  it('then the bar shows Last phase, Finish game replaces Round, and the counters still work', () => {
    destroyOutpost()
    press('No one')
    expect(within(bar()).queryByRole('button', { name: /^Round/ })).not.toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: 'Finish game: end of this phase' })).toBeInTheDocument()
    press(claimPlan)
    hit(cell('Bottom right'))
    expect(within(cell('Bottom right')).getByRole('img', { name: 'Plan, Thermal Oscillator' })).toBeInTheDocument()
  })
})

describe('SwuTwinSunsGame: game over', () => {
  const finishGame = () => press('Finish game: end of this phase')

  it('Finish game places each base over its card; a destroyed base keeps its cover', () => {
    renderGame([outpost, colossus, thermal])
    hit(cell('Top left'), 14) // Jedi Temple 14 left
    hit(cell('Bottom left'), 16) // Colossus 19 left
    hit(cell('Bottom right'), 21) // Thermal 6 left
    hit(cell('Top right'), 3)
    press('No one')
    finishGame()
    expect(within(cell('Bottom left')).getByRole('img', { name: '1st · Won, 19 HP left' })).toBeInTheDocument()
    expect(within(cell('Top left')).getByRole('img', { name: '2nd, 14 HP left' })).toBeInTheDocument()
    expect(within(cell('Bottom right')).getByRole('img', { name: '3rd, 6 HP left' })).toBeInTheDocument()
    expect(within(cell('Top right')).getByRole('img', { name: 'Fragile Outpost is destroyed' })).toBeInTheDocument()
    const over = screen.getByRole('navigation', { name: 'Game over, facing you' })
    expect(within(over).getByText(/Jedi Temple \(you\)/)).toBeInTheDocument()
    expect(within(over).getByRole('button', { name: 'Rematch' })).toBeInTheDocument()
    expect(within(over).getByRole('button', { name: 'New setup' })).toBeInTheDocument()
  })

  it('a tie for most HP is a draw between those players, recorded from your side', () => {
    renderGame([tomb, colossus, thermal], make('035', 'Twin Base', 25))
    hit(cell('Bottom left'), 20)
    hit(cell('Bottom right'), 20)
    press('End game')
    press('End game now')
    expect(within(cell('Top left')).getByRole('img', { name: '1st · Draw, 25 HP left' })).toBeInTheDocument()
    expect(within(cell('Top right')).getByRole('img', { name: '1st · Draw, 25 HP left' })).toBeInTheDocument()
    openLog()
    expect(screen.getByText('Game drawn')).toBeInTheDocument()
    expect(mockOnGameEnd).toHaveBeenCalledTimes(1)
  })

  it('End game asks first; Keep playing goes back to the game', () => {
    renderGame()
    press('End game')
    press('Keep playing')
    expect(within(bar()).getByRole('button', { name: /^Round 1/ })).toBeInTheDocument()
  })

  it('Rematch keeps the bases and seats and resets the damage', () => {
    renderGame()
    hit(cell('Top right'), 4)
    press('End game')
    press('End game now')
    press('Rematch')
    expect(damageIn(cell('Top right'))).toHaveTextContent('0')
    expect(within(cell('Top right')).getByRole('button', { name: /^Tomb of Eilram/ })).toBeEnabled()
    expect(within(bar()).getByRole('button', { name: /^Round 1/ })).toBeInTheDocument()
  })

  it('New setup goes back to setup', () => {
    const { onBack } = renderGame()
    press('End game')
    press('End game now')
    press('New setup')
    expect(onBack).toHaveBeenCalled()
  })
})
