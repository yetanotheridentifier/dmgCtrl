// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsSheet } from '../components/settingsSheet'
import { SettingsProvider } from '../hooks/useSettings'
import { loadSettings, STORAGE_KEY, defaultSettings } from '../data/settingsStore'
import { SHARING_HELP_SECTION } from '../utils/helpSections'
import { PHONE_LANDSCAPE_QUERY, PHONE_PORTRAIT_QUERY } from '../hooks/useMediaQuery'

const originalMatchMedia = window.matchMedia

/** The media queries the sheet reads, matched as a test says. */
function withMedia(matching: string[]) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({ matches: matching.includes(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

function setup({ onClose = vi.fn(), onHelp = vi.fn() } = {}) {
  render(
    <SettingsProvider>
      <SettingsSheet open onClose={onClose} onHelp={onHelp} />
    </SettingsProvider>,
  )
  return { onClose, onHelp, user: userEvent.setup() }
}

const store = (patch: object) => localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...defaultSettings(), ...patch }))
const sheet = () => within(screen.getByRole('dialog', { name: 'Sealed settings' }))
const toggle = (name: string) => sheet().getByRole('switch', { name })
/** The pace stepper: the row holding its buttons. */
const pace = () => sheet().getByRole('button', { name: 'Decrease opponent pace' }).parentElement!
const baseHealth = (name: string) => within(sheet().getByRole('group', { name: 'Base health' })).getByRole('button', { name })

describe('SettingsSheet', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  it('is a sheet titled Sealed settings, with no Help link', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Sealed settings' })).toBeInTheDocument()
    expect(sheet().queryByRole('button', { name: /^help$/i })).toBeNull()
  })

  it('shows the stored settings', () => {
    store({ allowUndo: true, baseHealthDisplay: 'remaining', opponentDelayMs: 2000, shareGames: 'yes', showBugReport: true })
    setup()
    expect(toggle('Allow undo')).toHaveAttribute('aria-checked', 'true')
    expect(baseHealth('Health left')).toHaveAttribute('aria-pressed', 'true')
    expect(baseHealth('Damage taken')).toHaveAttribute('aria-pressed', 'false')
    expect(pace()).toHaveTextContent('2 s')
    expect(toggle('Share games to improve the bot')).toHaveAttribute('aria-checked', 'true')
    expect(toggle('Report a bug button')).toHaveAttribute('aria-checked', 'true')
  })

  describe('allow undo', () => {
    it('says what it does', () => {
      setup()
      expect(sheet().getByText('Rewinds past draws and searches. For practice.')).toBeInTheDocument()
    })

    it('is saved as a boolean', async () => {
      store({ allowUndo: false })
      const { user } = setup()
      await user.click(toggle('Allow undo'))
      expect(toggle('Allow undo')).toHaveAttribute('aria-checked', 'true')
      expect(loadSettings().allowUndo).toBe(true)
    })
  })

  describe('opponent pace', () => {
    it('shows half a second by default', () => {
      setup()
      expect(pace()).toHaveTextContent('0.5 s')
    })

    it('steps through the paces on offer, saved as milliseconds, from Instant to 2 s', async () => {
      store({ opponentDelayMs: 250 })
      const { user } = setup()
      const quicker = sheet().getByRole('button', { name: 'Decrease opponent pace' })
      const slower = sheet().getByRole('button', { name: 'Increase opponent pace' })

      await user.click(quicker)
      expect(pace()).toHaveTextContent('Instant')
      expect(loadSettings().opponentDelayMs).toBe(0)
      expect(quicker).toBeDisabled()

      for (const [label, ms] of [['0.25 s', 250], ['0.5 s', 500], ['1 s', 1000], ['2 s', 2000]] as const) {
        await user.click(slower)
        expect(pace()).toHaveTextContent(label)
        expect(loadSettings().opponentDelayMs).toBe(ms)
      }
      expect(slower).toBeDisabled()
    })
  })

  it('saves base health as damage or remaining', async () => {
    const { user } = setup()
    expect(baseHealth('Damage taken')).toHaveAttribute('aria-pressed', 'true')

    await user.click(baseHealth('Health left'))
    expect(loadSettings().baseHealthDisplay).toBe('remaining')

    await user.click(baseHealth('Damage taken'))
    expect(loadSettings().baseHealthDisplay).toBe('damage')
  })

  it('changing one setting leaves the others alone', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ allowUndo: true, baseHealthDisplay: 'damage', showBugReport: true, opponentDelayMs: 1000 }))
    const { user } = setup()
    await user.click(baseHealth('Health left'))
    expect(loadSettings()).toEqual({ allowUndo: true, baseHealthDisplay: 'remaining', showBugReport: true, opponentDelayMs: 1000, shareGames: 'unasked' })
  })

  describe('sharing games to improve the bot', () => {
    const share = () => toggle('Share games to improve the bot')

    it('says what is sent', () => {
      setup()
      expect(sheet().getByText(/Both decks and every decision; nothing identifies you\./)).toBeInTheDocument()
    })

    it.each(['unasked', 'no'] as const)('is off when the answer is %s', stored => {
      store({ shareGames: stored })
      setup()
      expect(share()).toHaveAttribute('aria-checked', 'false')
    })

    it('opts in when turned on and out when turned off', async () => {
      const { user } = setup()
      await user.click(share())
      expect(loadSettings().shareGames).toBe('yes')
      await user.click(share())
      expect(loadSettings().shareGames).toBe('no')
    })

    it("links to the Help section that says what is sent, changing nothing", async () => {
      const { user, onHelp } = setup()
      await user.click(sheet().getByRole('button', { name: "What's sent" }))
      expect(onHelp).toHaveBeenCalledExactlyOnceWith(SHARING_HELP_SECTION)
      expect(loadSettings().shareGames).toBe('unasked')
    })
  })

  describe('report a bug button', () => {
    it('is offered on a desktop, saved as a boolean', async () => {
      store({ showBugReport: false })
      const { user } = setup()
      expect(sheet().getByText('Adds Report a bug to More. Desktop only.')).toBeInTheDocument()
      await user.click(toggle('Report a bug button'))
      expect(loadSettings().showBugReport).toBe(true)
    })

    it.each([PHONE_LANDSCAPE_QUERY, PHONE_PORTRAIT_QUERY])('is not offered on a phone (%s)', query => {
      withMedia([query])
      setup()
      expect(sheet().queryByRole('switch', { name: 'Report a bug button' })).toBeNull()
    })
  })

  // The PWA at the site root is a separate app with no way back into Sealed.
  it('offers no way out to the dmgCtrl app', () => {
    setup()
    expect(sheet().queryByRole('button', { name: 'App settings' })).toBeNull()
  })

  it('closes on Close and on Escape', async () => {
    const { user, onClose } = setup()
    await user.click(sheet().getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
