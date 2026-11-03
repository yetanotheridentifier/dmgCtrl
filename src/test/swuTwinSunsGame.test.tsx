import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import SwuTwinSunsGame from '../components/swuTwinSunsGame'
import { Base } from '../hooks/useBases'
import { useOrientation } from '../hooks/useOrientation'

vi.mock('../hooks/useOrientation')
vi.mock('../hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }))

const mockOnGameStart = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnGameEnd = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnForceGained = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnForceUsed = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../services/analytics', () => ({
  onGameStart: mockOnGameStart,
  onGameEnd: mockOnGameEnd,
  onDamageDealt: vi.fn().mockResolvedValue(undefined),
  onDamageHealed: vi.fn().mockResolvedValue(undefined),
  onRoundIncremented: vi.fn().mockResolvedValue(undefined),
  onUndoUsed: vi.fn().mockResolvedValue(undefined),
  onEpicActionUsed: vi.fn().mockResolvedValue(undefined),
  onForceGained: mockOnForceGained,
  onForceUsed: mockOnForceUsed,
  onImageLoadFailed: vi.fn().mockResolvedValue(undefined),
}))

const mockUserSettings = vi.hoisted(() => ({
  useHyperspace: false,
  enableInitiativeBar: true,
  forceTokenDisplay: 'lof-only' as 'always-on' | 'lof-only' | 'always-off',
}))
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
const lothal: Base = { ...make('026', 'Lothal Airfield', 25, 'When a friendly Force unit attacks: The Force is with you (create your Force token).'), set: 'LOF' }
const monastery: Base = { ...make('022', 'Mystic Monastery', 25, 'Action: The Force is with you (create your Force token). Use this ability no more than 3 times each game.'), set: 'LOF' }

type Seats = (Base | null)[]
const FOUR: Seats = [tomb, colossus, thermal]

type Seat = 'Top left' | 'Top right' | 'Bottom left' | 'Bottom right'

// The game starts once someone has the initiative: by default you take it, null leaves the question open.
function renderGame(seats: Seats = FOUR, base: Base = jediTemple, initiative: Seat | null = 'Bottom right') {
  const onBack = vi.fn()
  const onHelp = vi.fn()
  render(<SwuTwinSunsGame base={base} seats={seats} onBack={onBack} onHelp={onHelp} onSettings={vi.fn()} />)
  if (initiative) hit(cell(initiative))
  return { onBack, onHelp }
}

const cell = (seat: Seat) => screen.getByRole('region', { name: seat })
type Cell = ReturnType<typeof cell>
const cardIn = (c: Cell) => within(c).getByTestId('game-card')
const hit = (c: Cell, times = 1) => { for (let i = 0; i < times; i++) fireEvent.click(cardIn(c)) }
const damageIn = (c: Cell) => within(c).getByTestId('damage')
// The colour of the card's border, as written (jsdom gives a hex colour back as rgb()).
const outlineIn = (c: Cell) => within(c).getByTestId('card-outline').style.borderColor
const bar = () => screen.getByRole('navigation', { name: /^Game( over)?, facing you$/ })
const press = (name: string | RegExp) => fireEvent.click(within(bar()).getByRole('button', { name }))
const claimPlan = /^Plan: tap/
const claimBlast = /^Blast: tap/
const claimInitiative = /^Claim initiative/
// 3 players: Back, Log, More and End game beside the single base.
const sideName = 'Game controls, facing you'
const side = () => screen.getByRole('navigation', { name: sideName })
const tapSide = (name: string | RegExp) => fireEvent.click(within(side()).getByRole('button', { name }))
// The single base stays centred, the controls set over the row's right end out of its flow.
const centred = (row: HTMLElement) => row.style.justifyContent === 'center' && side().style.position === 'absolute'
const openLog = () => press('Log')
const undo = () => fireEvent.click(screen.getByTestId('log-undo-btn'))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useOrientation).mockReturnValue({ isPortrait: false, vmin: 0 })
  mockUserSettings.enableInitiativeBar = true
  mockUserSettings.forceTokenDisplay = 'lof-only'
})

// ---------------------------------------------------------------------------

describe('SwuTwinSunsGame: layout', () => {
  // You hold the phone at its bottom edge: your base, bottom right, faces you, and the top row is
  // turned to face the far side.
  it('each base sits in its setup cell, yours bottom right, the top row turned to face the far side', () => {
    renderGame()
    expect(within(cell('Bottom right')).getByRole('button', { name: /^Jedi Temple, your base/ })).toBeInTheDocument()
    expect(within(cell('Bottom left')).getByRole('button', { name: /^Tomb of Eilram/ })).toBeInTheDocument()
    expect(within(cell('Top right')).getByRole('button', { name: /^Colossus/ })).toBeInTheDocument()
    expect(within(cell('Top left')).getByRole('button', { name: /^Thermal Oscillator/ })).toBeInTheDocument()
    expect(cell('Top left')).toHaveStyle({ transform: 'rotate(180deg)' })
    expect(cell('Top right')).toHaveStyle({ transform: 'rotate(180deg)' })
    expect(cell('Bottom left')).not.toHaveStyle({ transform: 'rotate(180deg)' })
    expect(cell('Bottom right')).not.toHaveStyle({ transform: 'rotate(180deg)' })
  })

  it('4 players: the bar runs between the side-by-side bases, facing you', () => {
    renderGame()
    expect(screen.getByTestId('twin-suns').getAttribute('data-players')).toBe('4')
    expect(bar().style.transform).not.toMatch(/rotate/)
    for (const name of ['Back to setup', 'Log', 'More', 'End game']) {
      expect(within(bar()).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(within(bar()).getByRole('button', { name: /^Round 1/ })).toBeInTheDocument()
  })

  it('3 players: the bar sits between the two bases on one side; the single base is centred on the other, the controls at its right', () => {
    renderGame([tomb, null, thermal])
    expect(screen.queryByRole('region', { name: 'Top right' })).not.toBeInTheDocument()
    const top = screen.getByTestId('twin-suns-row-top')
    const bottom = screen.getByTestId('twin-suns-row-bottom')
    expect(within(bottom).getByRole('navigation', { name: 'Game, facing you' })).toBeInTheDocument()
    expect(within(bottom).queryByRole('navigation', { name: sideName })).not.toBeInTheDocument()
    expect(within(top).getByRole('region', { name: 'Top left' })).toBeInTheDocument()
    expect(centred(top)).toBe(true)
    // The right end of the screen, your seat's end, facing you like the bar.
    expect(top.firstElementChild).toBe(side())
    expect(side().style.transform).not.toMatch(/rotate/)
  })

  it('3 players: the controls are a base cell’s size, their column the width of the base below them', () => {
    renderGame([tomb, null, thermal])
    // In line with the pair's cells: the same share of the row, and the same card width within it.
    const pairCell = cell('Bottom right')
    const controlsStyle = side().style
    expect(controlsStyle.position).toBe('absolute')
    expect(controlsStyle.right).toBe('0px')
    expect(controlsStyle.left).toBe('')
    const bare = (s: string) => s.replace(/\s/g, '')
    expect(bare(cell('Top left').style.flex)).toContain(bare(controlsStyle.width))
    expect(controlsStyle.containerType).toBe('size')
    const sizedCard = cardIn(pairCell).parentElement!.parentElement as HTMLElement
    expect((side().firstElementChild as HTMLElement).style.width).toBe(sizedCard.style.width)
  })

  it('3 players with the bottom left seat empty: the bar sits between the two top bases, the controls beside yours', () => {
    renderGame([null, colossus, thermal])
    const bottom = screen.getByTestId('twin-suns-row-bottom')
    expect(within(screen.getByTestId('twin-suns-row-top')).getByRole('navigation', { name: 'Game, facing you' })).toBeInTheDocument()
    expect(centred(bottom)).toBe(true)
    expect(bottom.firstElementChild).toBe(side())
  })

  it('3 players: the counters and Round, used each round, are in the bar; Back, Log, More and End game beside the single base', () => {
    renderGame([tomb, null, thermal])
    for (const name of [claimInitiative, claimPlan, claimBlast, /^Round 1/]) {
      expect(within(bar()).getByRole('button', { name })).toBeInTheDocument()
      expect(within(side()).queryByRole('button', { name })).not.toBeInTheDocument()
    }
    for (const name of ['Back to setup', 'Log', 'More', 'End game']) {
      expect(within(side()).getByRole('button', { name })).toBeInTheDocument()
      expect(within(bar()).queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it.each([['a phone', 844, 390], ['a tablet', 1024, 768]])('4 players on %s: Back, Log and More at the top, the counters and Round together in the middle, End game at the foot', (_, width, height) => {
    withViewport(width, height, () => {
      renderGame()
      const parts = Array.from(bar().children) as HTMLElement[]
      const middle = within(bar()).getByRole('group', { name: 'This round' })
      const at = parts.indexOf(middle)
      // Equal space either side of the middle group.
      expect(parts[at - 1].style.flex).not.toBe('')
      expect(parts[at - 1].style.flex).toBe(parts[at + 1].style.flex)
      for (const name of [claimInitiative, claimPlan, claimBlast, /^Round 1/]) expect(within(middle).getByRole('button', { name })).toBeInTheDocument()
      for (const name of ['Back to setup', 'Log', 'More']) expect(within(parts[0]).getByRole('button', { name })).toBeInTheDocument()
      expect(parts[parts.length - 1]).toBe(within(bar()).getByRole('button', { name: 'End game' }))
      expect(at).toBeGreaterThan(0)
      expect(at).toBeLessThan(parts.length - 1)
    })
  })

  it('4 players in the last phase: the note and Finish game in the middle group, in Round\'s place', () => {
    renderGame([outpost, colossus, thermal])
    hit(cell('Bottom left'), 3)
    press('No one')
    const middle = within(bar()).getByRole('group', { name: 'This round' })
    expect(within(middle).getByRole('button', { name: /^Finish game/ })).toBeInTheDocument()
    expect(within(middle).getByText('LAST PHASE')).toBeInTheDocument()
  })

  it('4 players keep every control in the bar, with no separate controls', () => {
    renderGame()
    expect(screen.queryByRole('navigation', { name: sideName })).not.toBeInTheDocument()
  })

  it('keeps the bases and the bar off the screen edges by the edge tokens', () => {
    renderGame()
    const { style } = screen.getByTestId('twin-suns')
    expect([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft])
      .toEqual(['var(--edge-top)', 'var(--edge-right)', 'var(--edge-bottom)', 'var(--edge-left)'])
  })

  it('in portrait keeps its landscape layout, turned a quarter, with no rotate prompt', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    renderGame()
    expect(screen.getByTestId('turned-frame').style.transform).toMatch(/rotate\(90deg\)/)
    expect(screen.getByTestId('turned-frame')).toContainElement(screen.getByTestId('twin-suns'))
    expect(screen.queryByText(/rotate/i)).not.toBeInTheDocument()
  })

  it('in landscape is upright', () => {
    renderGame()
    expect(screen.getByTestId('turned-frame').style.transform).not.toMatch(/rotate/)
  })

  // A viewport of the given size answering min-width and min-height queries.
  const withViewport = (width: number, height: number, run: () => void) => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: [...query.matchAll(/min-(width|height): (\d+)px/g)].every(([, side, px]) => (side === 'width' ? width : height) >= Number(px)),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    try { run() } finally { window.matchMedia = original }
  }
  const barSquares = (size: string) => ['Back to setup', 'Log', 'More', 'End game', claimInitiative, claimPlan, claimBlast, /^Round 1/]
    .every(name => within(bar()).getByRole('button', { name }).style.width === size)

  it.each([[1024, 768], [768, 1024]])('on a tablet (%ix%i) every bar control is a 94px square', (width, height) => {
    withViewport(width, height, () => {
      renderGame()
      expect(barSquares('94px')).toBe(true)
    })
  })

  it('on a phone Back, Log and More are the counters\' 60px squares, each icon centred in a 26px box', () => {
    withViewport(844, 390, () => {
      renderGame()
      for (const name of ['Back to setup', 'Log', 'More', claimInitiative, claimPlan, claimBlast]) {
        const { style } = within(bar()).getByRole('button', { name })
        expect([style.width, style.height]).toEqual(['60px', '60px'])
      }
      for (const name of ['Back to setup', 'Log', 'More']) {
        const box = (within(bar()).getByRole('button', { name }).firstElementChild as HTMLElement).style
        expect([box.width, box.height, box.alignItems, box.justifyContent]).toEqual(['26px', '26px', 'center', 'center'])
      }
    })
  })

  // A phone held in portrait is tall, but its turned screen is a phone's landscape one.
  it('on a phone held in portrait the bar keeps its phone size', () => {
    vi.mocked(useOrientation).mockReturnValue({ isPortrait: true, vmin: 0 })
    withViewport(390, 844, () => {
      renderGame()
      expect(within(bar()).getByRole('button', { name: 'Log' }).style.width).not.toBe('94px')
    })
  })
})

describe('SwuTwinSunsGame: 3 players, the table’s controls in the bar and the rest beside the single base', () => {
  const buttonsIn = (el: HTMLElement) => within(el).queryAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent)
  const ADMIN = ['Back to setup', 'Log', 'More']

  it('while asking who has the initiative: the question in the bar; Back, Log and More beside, with no End game', () => {
    renderGame([tomb, null, thermal], jediTemple, null)
    expect(within(bar()).getByText('Who has the initiative?')).toBeInTheDocument()
    expect(buttonsIn(side())).toEqual(ADMIN)
  })

  it('choosing a counter: the prompt and Cancel in the bar', () => {
    renderGame([tomb, null, thermal])
    press(claimPlan)
    expect(within(bar()).getByText('Tap the base of the player who claimed Plan')).toBeInTheDocument()
    expect(buttonsIn(bar())).toEqual(['Cancel'])
    expect(buttonsIn(side())).toEqual(ADMIN)
    press('Cancel')
    expect(within(bar()).getByRole('button', { name: /^Round 1/ })).toBeInTheDocument()
  })

  it('End game, from beside the single base: the question and its answers in the bar', () => {
    renderGame([tomb, null, thermal])
    tapSide('End game')
    expect(within(bar()).getByText('End the game now? Most HP left wins.')).toBeInTheDocument()
    expect(buttonsIn(bar())).toEqual(['Keep playing', 'End game now'])
    expect(buttonsIn(side())).toEqual(ADMIN)
  })

  // The bar is half the screen's height, so a state's answers sit side by side: they share its width
  // rather than each taking all of it and running off the side.
  it.each([
    ['End game', () => tapSide('End game'), ['Keep playing', 'End game now']],
    ['a base destroyed', () => hit(cell('Bottom left'), 3), ['No one', 'Undo the damage']],
  ] as const)('%s: the answers share the bar’s width side by side', (_, open, names) => {
    renderGame([outpost, null, thermal])
    open()
    const row = within(bar()).getByRole('button', { name: names[0] }).parentElement as HTMLElement
    expect(within(row).getAllByRole('button').map(b => b.textContent)).toEqual(names)
    // One equal column each, which may be narrower than its words: no answer widens the row.
    expect(row.style.display).toBe('grid')
    expect(row.style.gridAutoFlow).toBe('column')
    expect(row.style.gridAutoColumns).toBe('minmax(0, 1fr)')
  })

  it('a base destroyed, the last phase and the result', () => {
    renderGame([outpost, null, thermal])
    hit(cell('Bottom left'), 3)
    expect(within(bar()).getByText('Fragile Outpost is destroyed')).toBeInTheDocument()
    expect(buttonsIn(bar())).toEqual(['No one', 'Undo the damage'])
    press('No one')
    // The last phase: Finish game in Round's place, and the note in End game's.
    expect(within(bar()).getByRole('button', { name: /^Finish game/ })).toBeInTheDocument()
    expect(within(bar()).getByRole('group', { name: 'Counters' })).toBeInTheDocument()
    expect(within(side()).getByText('LAST PHASE')).toBeInTheDocument()
    expect(buttonsIn(side())).toEqual(ADMIN)
    press(/^Finish game/)
    expect(bar()).toHaveTextContent('RESULT · ROUND 1')
    expect(buttonsIn(bar())).toEqual([])
    expect(buttonsIn(side())).toEqual([...ADMIN, 'New setup', 'Rematch'])
  })

  it('opening the log from beside the single base', () => {
    renderGame([tomb, null, thermal])
    tapSide('Log')
    expect(screen.getByTestId('log-undo-btn')).toBeInTheDocument()
  })

  it('on a tablet every control is a 94px square, in both places', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
    try {
      renderGame([tomb, null, thermal])
      for (const name of [claimInitiative, claimPlan, claimBlast, /^Round 1/]) expect(within(bar()).getByRole('button', { name }).style.width).toBe('94px')
      for (const name of [...ADMIN, 'End game']) expect(within(side()).getByRole('button', { name }).style.width).toBe('94px')
    } finally { window.matchMedia = original }
  })
})

describe('SwuTwinSunsGame: deciding the initiative', () => {
  it('the game opens asking who has the initiative, with no round, counters or End game yet', () => {
    renderGame(FOUR, jediTemple, null)
    expect(within(bar()).getByText('Who has the initiative?')).toBeInTheDocument()
    expect(within(bar()).getByText('Tap the base of the player who takes it')).toBeInTheDocument()
    for (const name of [/^Round/, 'End game', claimInitiative, claimPlan, claimBlast, 'Cancel']) {
      expect(within(bar()).queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(within(cell('Top left')).getByRole('button', { name: 'Thermal Oscillator: takes the initiative' })).toBeInTheDocument()
    expect(mockOnGameStart).not.toHaveBeenCalled()
  })

  it('a base you can choose keeps its single border, with no ring drawn outside it', () => {
    renderGame(FOUR, jediTemple, null)
    for (const seat of ['Bottom right', 'Bottom left', 'Top right', 'Top left'] as const) {
      for (let el = cardIn(cell(seat)).parentElement; el && el !== cell(seat); el = el.parentElement) {
        expect(el.style.boxShadow).toBe('')
      }
      expect(outlineIn(cell(seat))).toBe('var(--color-accent)')
    }
  })

  it('tapping a base gives it the initiative, takes no damage and starts the game', () => {
    renderGame(FOUR, jediTemple, 'Top left')
    expect(within(cell('Top left')).getByRole('button', { name: 'Initiative, Thermal Oscillator: tap to move it' })).toBeInTheDocument()
    expect(damageIn(cell('Top left'))).toHaveTextContent('0')
    expect(within(bar()).getByRole('button', { name: /^Round 1/ })).toBeInTheDocument()
    expect(mockOnGameStart).toHaveBeenCalledTimes(1)
  })

  it('undoing the choice asks again, and choosing again does not start a second game', () => {
    renderGame(FOUR, jediTemple, 'Top left')
    openLog()
    undo()
    expect(within(bar()).getByText('Who has the initiative?')).toBeInTheDocument()
    hit(cell('Bottom left'))
    expect(within(cell('Bottom left')).getByRole('button', { name: /^Initiative, Tomb of Eilram/ })).toBeInTheDocument()
    expect(mockOnGameStart).toHaveBeenCalledTimes(1)
  })

  it('leaving before anyone has it records no game', () => {
    const { onBack } = renderGame(FOUR, jediTemple, null)
    press('Back to setup')
    expect(onBack).toHaveBeenCalled()
    expect(mockOnGameEnd).not.toHaveBeenCalled()
  })

  it('the Initiative button in the bar is outlined solid, not dashed', () => {
    renderGame()
    const style = within(bar()).getByRole('button', { name: claimInitiative }).style
    expect(style.border).toMatch(/^2px solid /)
    expect(style.background).not.toBe('transparent')
  })
})

describe('SwuTwinSunsGame: damage', () => {
  it('the game starts at round 1: tapping a card adds 1 damage to that base alone', () => {
    renderGame()
    hit(cell('Top left'), 2)
    expect(damageIn(cell('Top left'))).toHaveTextContent('2')
    expect(within(cell('Top left')).getByText('25 HP left')).toBeInTheDocument()
    expect(damageIn(cell('Bottom right'))).toHaveTextContent('0')
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

  it('while dragging, only that base lights, red adding and green removing', () => {
    renderGame()
    hit(cell('Top right'), 5)
    fireEvent.pointerDown(cardIn(cell('Top right')), { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(cardIn(cell('Top right')), { clientY: 140, pointerId: 1 })
    expect(outlineIn(cell('Top right'))).toBe('var(--color-error)')
    for (const seat of ['Top left', 'Bottom left', 'Bottom right'] as const) expect(outlineIn(cell(seat))).toBe('var(--color-accent)')
    expect(screen.getByTestId('drag-amount').style.transform).toContain('rotate(180deg)')
    fireEvent.pointerMove(cardIn(cell('Top right')), { clientY: 60, pointerId: 1 })
    expect(outlineIn(cell('Top right'))).toBe('var(--color-success)')
    fireEvent.pointerUp(cardIn(cell('Top right')), { clientY: 60, pointerId: 1 })
    expect(outlineIn(cell('Top right'))).toBe('var(--color-accent)')
  })

  it('Undo in the log takes damage back', () => {
    renderGame()
    hit(cell('Bottom left'))
    openLog()
    undo()
    expect(damageIn(cell('Bottom left'))).toHaveTextContent('0')
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
    hit(cell('Bottom left'))
    expect(within(cell('Bottom left')).getByRole('img', { name: 'Plan, Tomb of Eilram' })).toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: 'Plan is claimed this round' })).toBeDisabled()
    // Choosing the base took no damage.
    expect(damageIn(cell('Bottom left'))).toHaveTextContent('0')
  })

  it('while choosing who claimed Plan, each base’s border takes the Plan colour, and goes back after', () => {
    renderGame()
    press(claimPlan)
    expect(outlineIn(cell('Bottom left'))).toBe('rgb(91, 140, 255)')
    hit(cell('Bottom left'))
    expect(outlineIn(cell('Bottom left'))).toBe('var(--color-accent)')
  })

  it('Cancel leaves the counter unclaimed', () => {
    renderGame()
    press(claimPlan)
    press('Cancel')
    expect(within(bar()).getByRole('button', { name: claimPlan })).toBeEnabled()
    hit(cell('Bottom left'))
    expect(damageIn(cell('Bottom left'))).toHaveTextContent('1')
  })

  it('Blast deals 1 damage to every other base at once, and undo takes it all back', () => {
    renderGame()
    press(claimBlast)
    hit(cell('Top right'))
    expect(within(cell('Top right')).getByRole('img', { name: 'Blast, Colossus' })).toBeInTheDocument()
    expect(damageIn(cell('Top right'))).toHaveTextContent('0')
    expect(damageIn(cell('Bottom right'))).toHaveTextContent('1')
    expect(damageIn(cell('Bottom left'))).toHaveTextContent('1')
    expect(damageIn(cell('Top left'))).toHaveTextContent('1')
    expect(within(bar()).getByRole('button', { name: 'Blast is claimed this round' })).toBeDisabled()
    openLog()
    undo()
    expect(damageIn(cell('Bottom right'))).toHaveTextContent('0')
    expect(damageIn(cell('Top left'))).toHaveTextContent('0')
    expect(within(bar()).getByRole('button', { name: claimBlast })).toBeEnabled()
  })

  it('Round returns Plan and Blast and moves the round on', () => {
    renderGame()
    press(claimPlan)
    hit(cell('Bottom left'))
    press(claimBlast)
    hit(cell('Top right'))
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
    hit(cell('Top left'))
    press(/^Round 1/)
    press(/^Round 2/)
    const token = within(cell('Top left')).getByRole('button', { name: 'Initiative, Thermal Oscillator: tap to move it' })
    fireEvent.click(token)
    hit(cell('Bottom right'))
    expect(within(cell('Bottom right')).getByRole('button', { name: 'Initiative, Jedi Temple: tap to move it' })).toBeInTheDocument()
    expect(within(cell('Top left')).queryByRole('button', { name: /^Initiative/ })).not.toBeInTheDocument()
    press(claimInitiative)
    hit(cell('Bottom left'))
    expect(within(cell('Bottom left')).getByRole('button', { name: /^Initiative, Tomb of Eilram/ })).toBeInTheDocument()
  })
})

describe('SwuTwinSunsGame: epic action', () => {
  it('the round button on the text box marks it used: the overlay covers the text box and takes no taps', () => {
    renderGame()
    fireEvent.click(within(cell('Bottom right')).getByRole('button', { name: 'Jedi Temple: epic action, tap when used' }))
    const overlay = within(cell('Bottom right')).getByTestId('epic-action-token')
    expect(overlay).toHaveTextContent('Epic Action Used')
    expect(overlay.tagName).not.toBe('BUTTON')
    expect(overlay.style.pointerEvents).toBe('none')
    expect(within(overlay).getByTestId('overlay-watermark')).toHaveAttribute('src', expect.stringContaining('dmgctrl-icon'))
    expect(within(cell('Bottom right')).queryByRole('button', { name: /epic action/ })).not.toBeInTheDocument()
  })

  it('undo in the log takes it back', () => {
    renderGame()
    fireEvent.click(within(cell('Bottom right')).getByRole('button', { name: 'Jedi Temple: epic action, tap when used' }))
    openLog()
    undo()
    expect(within(cell('Bottom right')).queryByTestId('epic-action-token')).not.toBeInTheDocument()
    expect(within(cell('Bottom right')).getByRole('button', { name: 'Jedi Temple: epic action, tap when used' })).toBeInTheDocument()
  })
  it('a base with no epic action has no button', () => {
    renderGame()
    expect(within(cell('Bottom left')).queryByRole('button', { name: /epic action/ })).not.toBeInTheDocument()
  })
})

describe('SwuTwinSunsGame: the Force', () => {
  const gainIn = (c: Cell) => within(c).getByRole('button', { name: /: gain the Force/ })
  const forceIn = (c: Cell) => within(c).queryByTestId('force-token')

  it('a Force base has a Force button on its card; tapping it puts the Force overlay on the text box', () => {
    renderGame([lothal, colossus, thermal])
    fireEvent.click(within(cell('Bottom left')).getByRole('button', { name: 'Lothal Airfield: gain the Force' }))
    expect(forceIn(cell('Bottom left'))).toHaveTextContent('The Force is With You')
    expect(mockOnForceGained).toHaveBeenCalledWith('LOF-026', 'LOF')
    expect(forceIn(cell('Bottom right'))).not.toBeInTheDocument()
  })

  it('tapping the overlay uses the Force, and the button comes back', () => {
    renderGame([lothal, colossus, thermal])
    fireEvent.click(gainIn(cell('Bottom left')))
    fireEvent.click(within(cell('Bottom left')).getByRole('button', { name: 'Lothal Airfield: the Force is with you, tap to clear' }))
    expect(forceIn(cell('Bottom left'))).not.toBeInTheDocument()
    expect(mockOnForceUsed).toHaveBeenCalledWith('LOF-026', 'LOF')
    expect(gainIn(cell('Bottom left'))).toBeInTheDocument()
  })

  it('undo in the log takes back the Force gained', () => {
    renderGame([lothal, colossus, thermal])
    fireEvent.click(gainIn(cell('Bottom left')))
    openLog()
    expect(screen.getByText('Lothal Airfield: Force gained', { selector: 'span' })).toBeInTheDocument()
    undo()
    expect(forceIn(cell('Bottom left'))).not.toBeInTheDocument()
  })

  it('follows the Force tokens setting: LOF bases only, Always, Off', () => {
    const { unmount } = render(<SwuTwinSunsGame base={jediTemple} seats={[lothal, colossus, thermal]} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /: gain the Force/ })).toHaveLength(1)
    unmount()
    mockUserSettings.forceTokenDisplay = 'always-on'
    const always = render(<SwuTwinSunsGame base={jediTemple} seats={[lothal, colossus, thermal]} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /: gain the Force/ })).toHaveLength(4)
    always.unmount()
    mockUserSettings.forceTokenDisplay = 'always-off'
    render(<SwuTwinSunsGame base={jediTemple} seats={[lothal, colossus, thermal]} onBack={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Force/ })).not.toBeInTheDocument()
  })

  it('Mystic Monastery counts its uses down, and has none left after three', () => {
    renderGame([monastery, colossus, thermal])
    const top = cell('Bottom left')
    expect(gainIn(top)).toHaveAccessibleName('Mystic Monastery: gain the Force, 3 uses left')
    for (let i = 0; i < 3; i++) {
      fireEvent.click(gainIn(top))
      fireEvent.click(within(top).getByRole('button', { name: /the Force is with you, tap to clear/ }))
    }
    expect(within(top).getByRole('button', { name: 'Mystic Monastery: no Force uses left' })).toBeDisabled()
  })

  it('with the epic action used too, the two share the text box', () => {
    mockUserSettings.forceTokenDisplay = 'always-on'
    renderGame()
    const you = cell('Bottom right')
    fireEvent.click(within(you).getByRole('button', { name: 'Jedi Temple: epic action, tap when used' }))
    fireEvent.click(gainIn(you))
    const epic = within(you).getByTestId('epic-action-token')
    const force = within(you).getByTestId('force-token')
    expect(100 - parseFloat(epic.style.right)).toBeLessThan(parseFloat(force.style.left))
  })
})

describe('SwuTwinSunsGame: a base destroyed', () => {
  // Fragile Outpost bottom left, 3 HP.
  const destroyOutpost = () => {
    renderGame([outpost, colossus, thermal])
    hit(cell('Top right'), 7)
    hit(cell('Bottom left'), 3)
  }

  it('shows Destroyed over its card and asks who destroyed it', () => {
    destroyOutpost()
    expect(within(cell('Bottom left')).getByRole('img', { name: 'Fragile Outpost is destroyed' })).toBeInTheDocument()
    expect(within(bar()).getByText('Fragile Outpost is destroyed')).toBeInTheDocument()
    expect(within(bar()).getByText('Tap the base of the player who destroyed it. That base heals 5.')).toBeInTheDocument()
  })

  it('while choosing who destroyed it, the bases that can heal have a green border', () => {
    destroyOutpost()
    expect(outlineIn(cell('Top right'))).toBe('var(--color-success)')
  })

  it('tapping the base that destroyed it heals that base 5', () => {
    destroyOutpost()
    hit(cell('Top right'))
    expect(damageIn(cell('Top right'))).toHaveTextContent('2')
    expect(within(cell('Top right')).getByText('+5 healed')).toBeInTheDocument()
  })

  it('No one skips the heal', () => {
    destroyOutpost()
    press('No one')
    expect(damageIn(cell('Top right'))).toHaveTextContent('7')
    expect(within(bar()).getByText(/LAST PHASE/)).toBeInTheDocument()
  })

  it('Undo the damage takes back the last hit and closes it', () => {
    destroyOutpost()
    press('Undo the damage')
    expect(damageIn(cell('Bottom left'))).toHaveTextContent('2')
    expect(within(cell('Bottom left')).queryByRole('img', { name: /is destroyed/ })).not.toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: /^Round 1/ })).toBeInTheDocument()
  })

  it('that player is out: the card stays covered and takes no input', () => {
    destroyOutpost()
    press('No one')
    expect(cardIn(cell('Bottom left'))).toBeDisabled()
    expect(within(cell('Bottom left')).getByRole('img', { name: 'Fragile Outpost is destroyed' })).toBeInTheDocument()
  })

  it('then the bar shows Last phase, Finish game replaces Round, and the counters still work', () => {
    destroyOutpost()
    press('No one')
    expect(within(bar()).queryByRole('button', { name: /^Round/ })).not.toBeInTheDocument()
    expect(within(bar()).getByRole('button', { name: 'Finish game: end of this phase' })).toBeInTheDocument()
    press(claimPlan)
    hit(cell('Top left'))
    expect(within(cell('Top left')).getByRole('img', { name: 'Plan, Thermal Oscillator' })).toBeInTheDocument()
  })
})

describe('SwuTwinSunsGame: game over', () => {
  const finishGame = () => press('Finish game: end of this phase')

  it('Finish game places each base over its card; a destroyed base keeps its cover', () => {
    renderGame([outpost, colossus, thermal])
    hit(cell('Bottom right'), 14) // Jedi Temple 14 left
    hit(cell('Top right'), 16) // Colossus 19 left
    hit(cell('Top left'), 21) // Thermal 6 left
    hit(cell('Bottom left'), 3)
    press('No one')
    finishGame()
    expect(within(cell('Top right')).getByRole('img', { name: '1st · Won, 19 HP left' })).toBeInTheDocument()
    expect(within(cell('Bottom right')).getByRole('img', { name: '2nd, 14 HP left' })).toBeInTheDocument()
    expect(within(cell('Top left')).getByRole('img', { name: '3rd, 6 HP left' })).toBeInTheDocument()
    expect(within(cell('Bottom left')).getByRole('img', { name: 'Fragile Outpost is destroyed' })).toBeInTheDocument()
    const over = screen.getByRole('navigation', { name: 'Game over, facing you' })
    expect(within(over).getByText(/Jedi Temple \(you\)/)).toBeInTheDocument()
    expect(within(over).getByRole('button', { name: 'Rematch' })).toBeInTheDocument()
    expect(within(over).getByRole('button', { name: 'New setup' })).toBeInTheDocument()
  })

  it('a tie for most HP is a draw between those players, recorded from your side', () => {
    renderGame([tomb, colossus, thermal], make('035', 'Twin Base', 25))
    hit(cell('Top right'), 20)
    hit(cell('Top left'), 20)
    press('End game')
    press('End game now')
    expect(within(cell('Bottom right')).getByRole('img', { name: '1st · Draw, 25 HP left' })).toBeInTheDocument()
    expect(within(cell('Bottom left')).getByRole('img', { name: '1st · Draw, 25 HP left' })).toBeInTheDocument()
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

  it('Rematch keeps the bases and seats, resets the damage and asks who has the initiative', () => {
    renderGame()
    hit(cell('Bottom left'), 4)
    press('End game')
    press('End game now')
    press('Rematch')
    expect(damageIn(cell('Bottom left'))).toHaveTextContent('0')
    expect(within(cell('Bottom left')).getByRole('button', { name: /^Tomb of Eilram/ })).toBeEnabled()
    expect(within(bar()).getByText('Who has the initiative?')).toBeInTheDocument()
    expect(mockOnGameStart).toHaveBeenCalledTimes(1)
    hit(cell('Top right'))
    expect(within(bar()).getByRole('button', { name: /^Round 1/ })).toBeInTheDocument()
    expect(mockOnGameStart).toHaveBeenCalledTimes(2)
  })

  it('New setup goes back to setup', () => {
    const { onBack } = renderGame()
    press('End game')
    press('End game now')
    press('New setup')
    expect(onBack).toHaveBeenCalled()
  })
})
