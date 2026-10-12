// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import userGuideHtml from '../../docs/userGuide.md'
import { ShareGamesNotice, ShareGamesPill } from '../components/shareGamesNotice'
import { SettingsProvider } from '../hooks/useSettings'
import { defaultSettings, loadSettings, saveSettings, STORAGE_KEY } from '../data/settingsStore'
import type { ShareGames } from '../data/settingsStore'
import { splitSections, SHARING_HELP_SECTION } from '../utils/helpSections'

/**
 * The setup screen asks once whether finished games may be sent to train the bot, as a card that
 * sits beside everything else and stops nothing. After an answer it is a small pill that opens
 * Settings, and it never asks again.
 *
 * Card and pill are two components, because they live in two places: the card in the page, the
 * pill in the app header. They are rendered together here, as `App` renders them, each in its own
 * container so a test can say which of the two drew something.
 */

function setup(onOpenSettings = vi.fn()) {
  render(
    <SettingsProvider>
      <div data-testid="pill-place">
        <ShareGamesPill onOpenSettings={onOpenSettings} />
      </div>
      <div data-testid="card-place">
        <ShareGamesNotice />
      </div>
    </SettingsProvider>,
  )
  return onOpenSettings
}

const answered = (shareGames: ShareGames) => saveSettings({ ...defaultSettings(), shareGames })

const text = (html: string) => {
  const el = document.createElement('div')
  el.innerHTML = html
  return (el.textContent ?? '').replace(/\s+/g, ' ')
}

describe('ShareGamesNotice', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('before the player has answered', () => {
    it('shows the notice as a card, with what is and is not sent', () => {
      setup()
      const card = screen.getByTestId('share-games-notice')

      expect(within(card).getByRole('heading', { name: 'Help improve gameplay' })).toBeInTheDocument()
      expect(card).toHaveTextContent('The AI bot gets better by learning from real games. If you opt in, each game you finish is sent to train it.')
      expect(card).toHaveTextContent('What is sent: both decks as loaded, every decision made in the game by you and the bot, who won, how long it took, and the app version.')
      expect(card).toHaveTextContent('What is not sent: your name, your deck names, or anything else that identifies you. There is no account, and your IP address is not linked to games. Because of that, a game cannot be traced back to you, and it also cannot be found and deleted later.')
      expect(card).toHaveTextContent('This data export is disabled unless you turn it on, and you can change it at any time in Settings.')
      expect(screen.queryByTestId('share-games-pill')).toBeNull()
    })

    /** The pill's place holds nothing at all while the card is asking, not an empty wrapper. */
    it('draws the card in its own place and leaves the pill place empty', () => {
      setup()

      expect(screen.getByTestId('card-place')).toContainElement(screen.getByTestId('share-games-notice'))
      expect(screen.getByTestId('pill-place')).toBeEmptyDOMElement()
    })

    /** A card in the page, not a dialog over it: nothing is covered and nothing has to be dismissed. */
    it('is not a dialog and covers nothing', () => {
      setup()
      const card = screen.getByTestId('share-games-notice')

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(card).not.toHaveAttribute('aria-modal')
      expect(card.className).not.toMatch(/\bfixed\b|\babsolute\b|inset-0/)
    })

    /** Neither answer is favoured: the two buttons are styled identically and neither takes focus. */
    it('offers yes and no as two buttons of equal weight, with nothing chosen for the player', () => {
      setup()
      const yes = screen.getByRole('button', { name: 'Share my games' })
      const no = screen.getByRole('button', { name: 'Not now' })

      expect(yes.className).toBe(no.className)
      expect(yes).not.toHaveFocus()
      expect(no).not.toHaveFocus()
      expect(within(screen.getByTestId('share-games-notice')).queryByRole('checkbox')).toBeNull()
    })

    it('writes nothing just by being shown', () => {
      setup()
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('opts in on "Share my games" and collapses to the pill', async () => {
      const user = userEvent.setup()
      setup()

      await user.click(screen.getByRole('button', { name: 'Share my games' }))

      expect(loadSettings().shareGames).toBe('yes')
      expect(screen.queryByTestId('share-games-notice')).toBeNull()
      expect(screen.getByTestId('share-games-pill')).toHaveTextContent('Your games are improving the bot')
    })

    it('records a no on "Not now" and collapses to the pill', async () => {
      const user = userEvent.setup()
      setup()

      await user.click(screen.getByRole('button', { name: 'Not now' }))

      expect(loadSettings().shareGames).toBe('no')
      expect(screen.queryByTestId('share-games-notice')).toBeNull()
      expect(screen.getByTestId('share-games-pill')).toHaveTextContent('Improve the bot')
    })
  })

  describe('after an answer', () => {
    it.each(['yes', 'no'] as const)('does not show the notice again after a %s', stored => {
      answered(stored)
      setup()

      expect(screen.queryByTestId('share-games-notice')).toBeNull()
      expect(screen.getByTestId('share-games-pill')).toBeInTheDocument()
    })

    /**
     * The card's place is left with nothing in it, so whatever follows it starts where it would
     * have without a notice. The pill is the button itself, with no wrapper to space or align it.
     */
    it.each(['yes', 'no'] as const)('leaves the card place empty after a %s, and the pill place holds only the button', stored => {
      answered(stored)
      setup()

      expect(screen.getByTestId('card-place')).toBeEmptyDOMElement()
      expect(screen.getByTestId('pill-place').firstElementChild).toBe(screen.getByTestId('share-games-pill'))
    })

    /**
     * It sits in a header row that must not wrap: the label stays on one line, and below the width
     * where it fits beside the title and the two buttons it is not shown at all. Settings is still
     * a click away on the cog.
     */
    it.each(['yes', 'no'] as const)('keeps to one line and is hidden on a narrow window after a %s', stored => {
      answered(stored)
      setup()
      const classes = screen.getByTestId('share-games-pill').className.split(/\s+/)

      expect(classes).toContain('whitespace-nowrap')
      expect(classes).toContain('hidden')
      expect(classes).toContain('sm:inline-block')
    })

    /** Smaller and lighter than the header's icon buttons, so it does not read as a third one. */
    it.each(['yes', 'no'] as const)('is not styled as a header icon button after a %s', stored => {
      answered(stored)
      setup()
      const classes = screen.getByTestId('share-games-pill').className.split(/\s+/)

      expect(classes).toContain('rounded-full')
      expect(classes).toContain('text-xs')
      expect(classes).not.toContain('border-2')
      expect(classes).not.toContain('border-line')
    })

    it.each([
      ['no', 'Improve the bot'],
      ['yes', 'Your games are improving the bot'],
    ] as const)('when the answer is %s the pill reads "%s" and opens Settings', async (stored, label) => {
      const user = userEvent.setup()
      answered(stored)
      const onOpenSettings = setup()

      const pill = screen.getByRole('button', { name: label })
      expect(pill).toBe(screen.getByTestId('share-games-pill'))
      await user.click(pill)

      expect(onOpenSettings).toHaveBeenCalledOnce()
      // Opening Settings is all the pill does: it changes no answer itself.
      expect(loadSettings().shareGames).toBe(stored)
    })

    /** Quiet in both states: no badge, counter or movement, and the opted-in pill is the fainter. */
    it('keeps the pill quiet, and quieter once opted in', () => {
      answered('no')
      setup()
      const notOptedIn = screen.getByTestId('share-games-pill').className
      cleanup()
      answered('yes')
      setup()
      const optedIn = screen.getByTestId('share-games-pill')

      for (const className of [notOptedIn, optedIn.className]) {
        expect(className).not.toMatch(/animate-|shadow-|bg-accent|text-accent|border-accent/)
      }
      expect(notOptedIn).toContain('text-ink-dim')
      expect(optedIn.className).toContain('text-ink-faint')
      expect(optedIn.children).toHaveLength(0)
    })
  })

  /** The Help section repeats the notice, so the two cannot be allowed to say different things. */
  it('says nothing the Help section does not also say', () => {
    setup()
    const section = splitSections(userGuideHtml).sections.find(s => s.title === SHARING_HELP_SECTION)!
    const help = text(section.html)

    const paragraphs = [...screen.getByTestId('share-games-notice').querySelectorAll('p')]
    expect(paragraphs).toHaveLength(4)
    for (const p of paragraphs) {
      expect(help).toContain((p.textContent ?? '').replace(/\s+/g, ' ').trim())
    }
  })
})
