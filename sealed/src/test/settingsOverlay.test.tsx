// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsOverlay } from '../components/settingsOverlay'
import { SettingsProvider } from '../hooks/useSettings'
import { loadSettings, STORAGE_KEY, defaultSettings, OPPONENT_DELAYS_MS } from '../data/settingsStore'
import { SHARING_HELP_SECTION } from '../utils/helpSections'

function setup(onClose = vi.fn(), onHelp: (section: string) => void = vi.fn()) {
  render(
    <SettingsProvider>
      <SettingsOverlay onClose={onClose} onHelp={onHelp} />
    </SettingsProvider>,
  )
  return onClose
}

describe('SettingsOverlay', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows the current settings', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSettings(), allowUndo: true, baseHealthDisplay: 'remaining' }))
    setup()
    expect(screen.getByTestId('setting-allow-undo')).toBeChecked()
    expect(screen.getByTestId('setting-base-health')).toHaveValue('remaining')
  })

  /** #533: the setting is the whole fix, so it has to survive the overlay closing. */
  it('persists a change to undo', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSettings(), allowUndo: false }))
    setup()

    await user.click(screen.getByTestId('setting-allow-undo'))

    expect(screen.getByTestId('setting-allow-undo')).toBeChecked()
    expect(loadSettings().allowUndo).toBe(true)
  })

  /** #324: purely a display preference, but it still has to stick. */
  it('persists a change to the base health display', async () => {
    const user = userEvent.setup()
    setup()

    await user.selectOptions(screen.getByTestId('setting-base-health'), 'remaining')

    expect(loadSettings().baseHealthDisplay).toBe('remaining')
  })

  /** The bug report button is developer chrome, so it is hidden in the shipped build. */
  it('persists a change to the bug report button', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSettings(), showBugReport: false }))
    setup()

    await user.click(screen.getByTestId('setting-show-bug-report'))

    expect(screen.getByTestId('setting-show-bug-report')).toBeChecked()
    expect(loadSettings().showBugReport).toBe(true)
  })

  it('changing one setting leaves the others alone', async () => {
    const user = userEvent.setup()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ allowUndo: true, baseHealthDisplay: 'damage', showBugReport: true, opponentDelayMs: 1000 }))
    setup()

    await user.selectOptions(screen.getByTestId('setting-base-health'), 'remaining')

    expect(loadSettings()).toEqual({ allowUndo: true, baseHealthDisplay: 'remaining', showBugReport: true, opponentDelayMs: 1000, shareGames: 'unasked' })
  })

  describe('sharing games to improve the bot', () => {
    const toggle = () => screen.getByRole('checkbox', { name: 'Share games to improve the bot' })

    it('says what it does, and that it is off by default', () => {
      setup()
      expect(screen.getByTestId('setting-share-games-help')).toHaveTextContent(
        'Sends finished games (both decks and every decision) to train the bot. Nothing identifies you. Off by default.',
      )
    })

    it.each(['unasked', 'no'] as const)('is off when the answer is %s', stored => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ shareGames: stored }))
      setup()
      expect(toggle()).not.toBeChecked()
    })

    it('is on once the player has opted in', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ shareGames: 'yes' }))
      setup()
      expect(toggle()).toBeChecked()
    })

    it('opts in when turned on and out when turned off', async () => {
      const user = userEvent.setup()
      setup()

      await user.click(toggle())
      expect(toggle()).toBeChecked()
      expect(loadSettings().shareGames).toBe('yes')

      await user.click(toggle())
      expect(toggle()).not.toBeChecked()
      expect(loadSettings().shareGames).toBe('no')
    })

    it('links to the Help section that says what is sent', async () => {
      const user = userEvent.setup()
      const onHelp = vi.fn()
      setup(vi.fn(), onHelp)

      await user.click(screen.getByRole('button', { name: 'What is sent?' }))

      expect(onHelp).toHaveBeenCalledExactlyOnceWith(SHARING_HELP_SECTION)
      // Reading about it changes nothing.
      expect(loadSettings().shareGames).toBe('unasked')
    })
  })

  describe('opponent pace', () => {
    it('shows half a second by default, and offers instant', () => {
      setup()
      const select = screen.getByTestId('setting-opponent-delay')
      expect(select).toHaveValue('500')
      expect(within(select).getByRole('option', { name: /instant/i })).toHaveValue('0')
      expect(within(select).getAllByRole('option').map(o => Number((o as HTMLOptionElement).value))).toEqual([...OPPONENT_DELAYS_MS])
    })

    it('persists a change as a number of milliseconds', async () => {
      const user = userEvent.setup()
      setup()

      await user.selectOptions(screen.getByTestId('setting-opponent-delay'), '0')

      expect(screen.getByTestId('setting-opponent-delay')).toHaveValue('0')
      expect(loadSettings().opponentDelayMs).toBe(0)
    })
  })

  it('closes on the close button and on Escape', async () => {
    const user = userEvent.setup()
    const onClose = setup()

    await user.click(screen.getByTestId('settings-close'))
    expect(onClose).toHaveBeenCalledOnce()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  /**
   * Undo is off by default and the reason is not guessable from the label. Without it the
   * setting reads as an arbitrary restriction rather than a deliberate one.
   */
  it('explains why undo is off by default', () => {
    setup()
    expect(screen.getByTestId('setting-allow-undo-help')).toHaveTextContent(/practis|playtest/i)
  })
})
