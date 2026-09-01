import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsOverlay } from '../components/settingsOverlay'
import { SettingsProvider } from '../hooks/useSettings'
import { loadSettings, STORAGE_KEY, defaultSettings } from '../data/settingsStore'

function setup(onClose = vi.fn()) {
  render(
    <SettingsProvider>
      <SettingsOverlay onClose={onClose} />
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ allowUndo: true, baseHealthDisplay: 'damage', showBugReport: true }))
    setup()

    await user.selectOptions(screen.getByTestId('setting-base-health'), 'remaining')

    expect(loadSettings()).toEqual({ allowUndo: true, baseHealthDisplay: 'remaining', showBugReport: true })
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
