// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Render as production, so the build tag belongs at the foot of the Help page.
vi.mock('../env', () => ({ isDev: () => false }))

import { HelpOverlay } from '../components/helpOverlay'
import { RELEASE } from '../buildIdentity'

describe('HelpOverlay', () => {
  it('shows the deck screen’s help, not how to play', () => {
    render(<HelpOverlay context="decks" onClose={vi.fn()} />)
    const content = screen.getByTestId('help-content')
    expect(content.innerHTML).toContain('Importing a deck')
    expect(content.innerHTML).not.toContain('Turn structure')
  })

  it('shows the game screen’s help, not deck importing', () => {
    render(<HelpOverlay context="game" onClose={vi.fn()} />)
    const content = screen.getByTestId('help-content')
    expect(content.innerHTML).toContain('Turn structure')
    expect(content.innerHTML).not.toContain('Importing a deck')
  })

  it('shows the fan-content disclaimer whichever screen it was opened from', () => {
    for (const context of ['decks', 'game'] as const) {
      const { unmount } = render(<HelpOverlay context={context} onClose={vi.fn()} />)
      expect(within(screen.getByTestId('help-overlay')).getByText(/unofficial fan site/i)).toBeInTheDocument()
      unmount()
    }
  })

  it('shows the build tag at the foot of the page in prod', () => {
    render(<HelpOverlay context="decks" onClose={vi.fn()} />)
    expect(screen.getByTestId('build-tag')).toHaveTextContent(RELEASE)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<HelpOverlay context="game" onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes when the backdrop around the panel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<HelpOverlay context="game" onClose={onClose} />)

    await user.click(screen.getByTestId('help-overlay'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  /**
   * The panel fills most of the overlay and the guide is long, so a click that lands on the
   * text, or on the padding around it, must not dismiss what you are reading.
   */
  it('stays open when the panel itself is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<HelpOverlay context="game" onClose={onClose} />)

    await user.click(screen.getByTestId('help-content'))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('heading', { name: /help/i }))
    expect(onClose).not.toHaveBeenCalled()
  })

  /**
   * The overlay itself is the scroll container, not the panel inside it: the panel is left to be
   * as tall as its content. jsdom does no layout, so this can only pin the structural intent.
   * Whether the guide actually scrolls on the game screen is a manual check.
   */
  it('makes the overlay the scroll container, with no height cap on the panel', () => {
    render(<HelpOverlay context="game" onClose={vi.fn()} />)
    const overlay = screen.getByTestId('help-overlay')
    const panel = screen.getByTestId('help-content').parentElement!

    expect(overlay.className).toMatch(/overflow-y-auto/)
    expect(panel.className).not.toMatch(/max-h-|overflow-/)
  })
})
