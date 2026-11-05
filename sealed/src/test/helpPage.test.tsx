// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Render as production, so the build tag belongs at the foot of the Help page.
vi.mock('../env', () => ({ isDev: () => false }))

import { HelpPage } from '../components/helpPage'
import { RELEASE } from '../buildIdentity'
import { PORTRAIT_QUERY } from '../hooks/useMediaQuery'

const SECTIONS = ['Decks', 'Opponent', 'Playing', 'The board', 'Prompts', 'After the game']

const sectionLinks = () => within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('button')
const currentSection = () => sectionLinks().filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)
const content = () => screen.getByTestId('help-content')

const landscape = window.matchMedia

/** Held upright: the one query the page lays itself out by. */
function portrait() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({ matches: query === PORTRAIT_QUERY, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: landscape })
})

describe('HelpPage', () => {
  it('is one page titled Sealed help, with every section a link and a heading in the content', () => {
    render(<HelpPage context="game" onClose={vi.fn()} />)

    expect(screen.getAllByRole('heading', { level: 1 }).map(h => h.textContent)).toEqual(['Sealed help'])
    expect(sectionLinks().map(b => b.textContent)).toEqual(SECTIONS)
    expect(within(content()).getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(SECTIONS)
  })

  it.each([
    ['decks', 'Decks'],
    ['game', 'Playing'],
  ] as const)('opened from the %s screen, opens at %s', (context, opensAt) => {
    render(<HelpPage context={context} onClose={vi.fn()} />)
    expect(currentSection()).toEqual([opensAt])
  })

  /** A link to one part of the help, such as Settings' "What's sent", opens the page there. */
  it.each(['decks', 'game'] as const)('opens at a section named by a link, over the %s screen', context => {
    render(<HelpPage context={context} section="After the game" onClose={vi.fn()} />)
    expect(currentSection()).toEqual(['After the game'])
  })

  it('marks a section link current when it is chosen', async () => {
    const user = userEvent.setup()
    render(<HelpPage context="decks" onClose={vi.fn()} />)

    await user.click(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Prompts' }))
    expect(currentSection()).toEqual(['Prompts'])
  })

  it('opens and closes a board topic with a tap, one at a time', async () => {
    const user = userEvent.setup()
    render(<HelpPage context="game" onClose={vi.fn()} />)
    const board = within(screen.getByRole('region', { name: 'The board' }))
    const colours = board.getByRole('button', { name: 'Target colours' })
    const tokens = board.getByRole('button', { name: 'The Force and Credit tokens' })

    expect(colours).toHaveAttribute('aria-expanded', 'false')
    expect(board.queryByText(/good for it/)).toBeNull()

    await user.click(colours)
    expect(colours).toHaveAttribute('aria-expanded', 'true')
    expect(board.getByText(/good for it/)).toBeInTheDocument()

    await user.click(tokens)
    expect(tokens).toHaveAttribute('aria-expanded', 'true')
    expect(colours).toHaveAttribute('aria-expanded', 'false')

    await user.click(tokens)
    expect(tokens).toHaveAttribute('aria-expanded', 'false')
  })

  it('puts the section links in a column on the left in landscape', () => {
    render(<HelpPage context="game" onClose={vi.fn()} />)
    expect(screen.getByRole('navigation', { name: 'Sections' })).toHaveStyle({ flexDirection: 'column' })
  })

  /** As the PWA's help does: two rows rather than one that scrolls sideways off the screen. */
  it('puts the section links in rows across the top in portrait', () => {
    portrait()
    render(<HelpPage context="decks" onClose={vi.fn()} />)
    expect(screen.getByRole('navigation', { name: 'Sections' })).toHaveStyle({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' })
  })

  it.each([
    ['decks', 'Back to setup'],
    ['game', 'Back to the game'],
  ] as const)('from the %s screen, %s closes it', async (context, label) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<HelpPage context={context} onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: label }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<HelpPage context="game" onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows the build tag at the foot of the page in prod', () => {
    render(<HelpPage context="decks" onClose={vi.fn()} />)
    expect(within(content()).getByTestId('build-tag')).toHaveTextContent(RELEASE)
  })
})
