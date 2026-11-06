// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SetupScreen from '../components/setupScreen'
import { SET_PROGRESS, sumCounts } from '../data/implementedCards'
import { listDecks, saveDeck } from '../data/deckStore'
import { db } from '../data/db'
import { saveGameRecord } from '../data/gameRecords'
import { player, state } from './helpers/engineFixtures'
import { NB_HYPHEN } from '../components/setup/deckSummary'
import { buildCardDb } from '../engine/cardDb'
import { syncCatalogue } from '../data/catalogueSync'
import { importSet, cachedSetCards, cachedSetCount } from '../data/setImport'
import { DESKTOP_QUERY, PORTRAIT_QUERY } from '../hooks/useMediaQuery'
import ashSet from './fixtures/ashSet.json'
import hmwSet from './fixtures/hmwSet.json'
import jtlSet from './fixtures/jtlSet.json'
import type { SwuCard } from '../data/cards'

vi.mock('../data/catalogueSync', () => ({
  syncCatalogue: vi.fn().mockResolvedValue({ hydrated: 0, skipped: 0, failed: 0 }),
}))

vi.mock('../data/setImport', () => ({
  importSet: vi.fn().mockResolvedValue({ cached: 264, total: 264 }),
  // Nothing cached by default, which is the state a fresh install is in.
  cachedSetCount: vi.fn().mockResolvedValue(0),
  cachedSetCards: vi.fn().mockResolvedValue([]),
}))

/**
 * The sets the local cache holds: HMW, which the generators default to, ASH and JTL. Every other code
 * reads as uncached, which is what a set the player has never imported looks like. A saved deck's own
 * cards are looked up one at a time (`getCard`), which finds them in the bundled sets.
 */
const SETS: Record<string, SwuCard[]> = {
  HMW: hmwSet as unknown as SwuCard[],
  ASH: ashSet as unknown as SwuCard[],
  JTL: jtlSet as unknown as SwuCard[],
}

function withCache(sets: Record<string, SwuCard[]>) {
  vi.mocked(cachedSetCards).mockImplementation(code => Promise.resolve(sets[code.toUpperCase()] ?? []))
  vi.mocked(cachedSetCount).mockImplementation(code => Promise.resolve((sets[code.toUpperCase()] ?? []).length))
}

/** The media queries the screen lays itself out by, matched as a test says. */
function withMedia(matching: string[]) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({ matches: matching.includes(query), media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  })
}

const SOR_CARDS = Array.from({ length: 30 }, (_, i) => ({ id: `SOR_${100 + i}`, count: 1 }))
const vader = (name = 'Vader Aggro') => saveDeck({ name, leader: 'SOR_010', base: 'SOR_029', cards: SOR_CARDS })

function validDeckJson(name = 'Vader Aggro') {
  return JSON.stringify({
    metadata: { name },
    leader: { id: 'SOR_010', count: 1 },
    base: { id: 'SOR_029', count: 1 },
    deck: SOR_CARDS,
  })
}

type User = ReturnType<typeof userEvent.setup>

function renderSetup() {
  const onPlay = vi.fn()
  const onHelp = vi.fn()
  const onSettings = vi.fn()
  const onBack = vi.fn()
  const view = render(<SetupScreen onPlay={onPlay} onHelp={onHelp} onSettings={onSettings} onBack={onBack} />)
  return { onPlay, onHelp, onSettings, onBack, view }
}

const dialog = (name: string) => screen.getByRole('dialog', { name })
const deckCard = () => screen.getByTestId('deck-card')
const opponentCard = () => screen.getByTestId('opponent-card')
const goToGame = () => screen.getByRole('button', { name: 'Go to game' })

async function openDeckSheet(user: User) {
  await user.click(within(deckCard()).getByRole('button', { name: /Change deck|Choose a deck/ }))
  return dialog('Your deck')
}

async function chooseDeck(user: User, id: string) {
  const sheet = await openDeckSheet(user)
  await user.click(within(sheet).getByTestId(`deck-option-${id}`))
}

async function openOpponent(user: User) {
  await user.click(within(opponentCard()).getByRole('button', { name: 'Change opponent' }))
  return dialog('Opponent')
}

async function play(user: User, onPlay: ReturnType<typeof vi.fn>) {
  await user.click(goToGame())
  await waitFor(() => expect(onPlay).toHaveBeenCalled())
  return onPlay.mock.calls[0] as [{ id: string; leader: string; base: string; cards: { id: string }[] }, { id: string; leader: string; base: string; cards: { id: string }[] }]
}

describe('SetupScreen', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(syncCatalogue).mockClear()
    withCache({})
    vi.mocked(importSet).mockReset()
    vi.mocked(importSet).mockResolvedValue({ cached: 264, total: 264 })
    withMedia([])
  })

  afterEach(() => withMedia([]))

  describe('the header', () => {
    it('goes back to game select', async () => {
      const user = userEvent.setup()
      const { onBack } = renderSetup()
      await user.click(screen.getByRole('button', { name: 'Back to game select' }))
      expect(onBack).toHaveBeenCalledOnce()
    })

    it('is titled Sealed', () => {
      renderSetup()
      expect(screen.getByRole('heading', { level: 1, name: 'Sealed' })).toBeInTheDocument()
    })

    it('opens help and settings from More', async () => {
      const user = userEvent.setup()
      const { onHelp, onSettings } = renderSetup()

      await user.click(screen.getByRole('button', { name: 'More' }))
      await user.click(within(dialog('More')).getByRole('button', { name: 'Help' }))
      expect(onHelp).toHaveBeenCalledOnce()
      expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull()

      await user.click(screen.getByRole('button', { name: 'More' }))
      await user.click(within(dialog('More')).getByRole('button', { name: 'Settings' }))
      expect(onSettings).toHaveBeenCalledOnce()
    })
  })

  /** The three-column screen, its native selects and its checkbox are gone: every choice is a sheet. */
  it('has no native select, checkbox or text box on the screen', () => {
    vader()
    renderSetup()
    const setup = screen.getByTestId('setup-screen')
    expect(setup.querySelector('select, input, textarea')).toBeNull()
  })

  describe('a first visit, with no saved decks', () => {
    it('offers to generate a deck or import one, on the deck card', () => {
      renderSetup()
      expect(within(deckCard()).getByText('Choose your deck')).toBeInTheDocument()
      expect(within(deckCard()).getByRole('button', { name: 'Generate a deck' })).toBeInTheDocument()
      expect(within(deckCard()).getByRole('button', { name: 'Import deck JSON' })).toBeInTheDocument()
    })

    it('keeps Go to game disabled until a deck is chosen, saying so', () => {
      renderSetup()
      expect(goToGame()).toBeDisabled()
      expect(screen.getByText('Choose your deck first')).toBeInTheDocument()
    })
  })

  describe('choosing your deck', () => {
    it('lists the saved decks, each with View, and Generate a deck and Import deck JSON', async () => {
      const user = userEvent.setup()
      const a = vader('Vader Aggro')
      const b = saveDeck({ name: 'Maz', leader: 'HMW_002', base: 'HMW_019', cards: [] })
      renderSetup()
      const sheet = await openDeckSheet(user)

      expect(within(sheet).getByTestId(`deck-option-${a.id}`)).toHaveTextContent('Vader Aggro')
      expect(within(sheet).getByTestId(`deck-option-${b.id}`)).toHaveTextContent('Maz')
      expect(within(sheet).getByRole('button', { name: 'View Vader Aggro' })).toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: 'View Maz' })).toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: /Generate a deck/ })).toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: 'Import deck JSON' })).toBeInTheDocument()
    })

    it('names each deck\'s leader, base and set once they are looked up', async () => {
      const user = userEvent.setup()
      const a = vader()
      renderSetup()
      const sheet = await openDeckSheet(user)
      await waitFor(() => expect(within(sheet).getByTestId(`deck-option-${a.id}`)).toHaveTextContent('Darth Vader · Administrator\'s Tower · SOR'))
    })

    it('chooses a deck with one tap, closing the sheet and enabling Go to game', async () => {
      const user = userEvent.setup()
      const a = vader()
      const { onPlay } = renderSetup()
      await chooseDeck(user, a.id)

      expect(screen.queryByRole('dialog', { name: 'Your deck' })).toBeNull()
      expect(within(deckCard()).getByTestId('deck-name')).toHaveTextContent('Vader Aggro')
      expect(goToGame()).toBeEnabled()
      const [mine] = await play(user, onPlay)
      expect(mine.id).toBe(a.id)
    })

    it('marks the chosen deck in the sheet', async () => {
      const user = userEvent.setup()
      const a = vader()
      const b = vader('Other')
      renderSetup()
      await chooseDeck(user, a.id)
      const sheet = await openDeckSheet(user)
      expect(within(sheet).getByTestId(`deck-option-${a.id}`)).toHaveAttribute('aria-pressed', 'true')
      expect(within(sheet).getByTestId(`deck-option-${b.id}`)).toHaveAttribute('aria-pressed', 'false')
    })

    it('sums the chosen deck up: aspects, leader and base, cards, set, types and cost curve', async () => {
      const user = userEvent.setup()
      const a = vader()
      renderSetup()
      await chooseDeck(user, a.id)
      const card = deckCard()

      await waitFor(() => expect(card).toHaveTextContent('Darth Vader · Administrator\'s Tower'))
      expect(within(card).getAllByRole('img').map(i => i.getAttribute('alt'))).toEqual(expect.arrayContaining(['Aggression', 'Villainy', 'Cunning']))
      expect(card).toHaveTextContent(/30 cards · SOR · \d+ units?/)
      expect(within(card).getByRole('img', { name: /^Cost curve: / })).toBeInTheDocument()
    })
  })

  describe('viewing a deck', () => {
    async function viewVader(user: User) {
      const a = vader()
      renderSetup()
      const sheet = await openDeckSheet(user)
      await user.click(within(sheet).getByRole('button', { name: 'View Vader Aggro' }))
      return { a, view: dialog('Vader Aggro') }
    }

    it('shows the leader and base, then the card list by type, units first and by cost', async () => {
      const user = userEvent.setup()
      const { view } = await viewVader(user)

      expect(await within(view).findByRole('button', { name: /^Darth Vader.*: see the card$/ })).toBeInTheDocument()
      expect(within(view).getByRole('button', { name: /^Administrator's Tower.*: see the card$/ })).toBeInTheDocument()
      const list = within(view).getByTestId('deck-list')
      await waitFor(() => expect(within(list).getAllByRole('heading').length).toBeGreaterThan(0))
      const headings = within(list).getAllByRole('heading').map(h => h.textContent ?? '')
      expect(headings[0]).toMatch(/^Units · \d+$/)
      const costs = within(within(list).getByTestId('deck-group-Units')).getAllByTestId('deck-row-cost').map(c => Number(c.textContent))
      expect(costs).toEqual([...costs].sort((x, y) => x - y))
    })

    /** A type heading travels with its first card, so it never sits alone at the foot of a column. */
    it('keeps each type heading with its first card', async () => {
      const user = userEvent.setup()
      const { view } = await viewVader(user)
      const list = within(view).getByTestId('deck-list')
      await waitFor(() => expect(within(list).getAllByRole('heading').length).toBeGreaterThan(0))
      for (const heading of within(list).getAllByRole('heading')) {
        const keep = heading.parentElement!
        expect(keep.style.breakInside).toBe('avoid')
        expect(keep.querySelector('[data-testid="deck-row"]')).not.toBeNull()
      }
    })

    it('shows a card on a tap, and puts it away again', async () => {
      const user = userEvent.setup()
      const { view } = await viewVader(user)
      const list = within(view).getByTestId('deck-list')
      const row = (await within(list).findAllByTestId('deck-row'))[0]

      await user.click(row)
      expect(screen.getByTestId('card-shown')).toBeInTheDocument()
      expect(within(screen.getByTestId('card-shown')).getByTestId('card-face')).toBeInTheDocument()

      await user.click(screen.getByTestId('card-shown'))
      expect(screen.queryByTestId('card-shown')).toBeNull()
    })

    it('uses the deck, closing the view and the sheet', async () => {
      const user = userEvent.setup()
      const { view } = await viewVader(user)
      await user.click(within(view).getByRole('button', { name: 'Use this deck' }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(within(deckCard()).getByTestId('deck-name')).toHaveTextContent('Vader Aggro')
    })

    it('deletes the deck, back to a sheet without it', async () => {
      const user = userEvent.setup()
      const { a, view } = await viewVader(user)
      await user.click(within(view).getByRole('button', { name: 'Delete' }))

      expect(listDecks()).toEqual([])
      expect(within(dialog('Your deck')).queryByTestId(`deck-option-${a.id}`)).toBeNull()
    })

    it('opens the chosen deck from View on the deck card', async () => {
      const user = userEvent.setup()
      const a = vader()
      renderSetup()
      await chooseDeck(user, a.id)
      await user.click(within(deckCard()).getByRole('button', { name: 'View' }))
      expect(dialog('Vader Aggro')).toBeInTheDocument()
    })

    it('forgets a chosen deck once it is deleted', async () => {
      const user = userEvent.setup()
      const a = vader()
      renderSetup()
      await chooseDeck(user, a.id)
      await user.click(within(deckCard()).getByRole('button', { name: 'View' }))
      await user.click(within(dialog('Vader Aggro')).getByRole('button', { name: 'Delete' }))
      await user.click(within(dialog('Your deck')).getByRole('button', { name: 'Close' }))

      expect(goToGame()).toBeDisabled()
    })
  })

  /** A deck built for you from one set: seen before it is played, and never kept. */
  describe('generating a deck', () => {
    async function openGenerate(user: User) {
      renderSetup()
      await user.click(within(deckCard()).getByRole('button', { name: 'Generate a deck' }))
      return dialog('Generated deck')
    }

    it('shows a fresh deck from the newest set, with its leader, base and card list', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      const view = await openGenerate(user)

      expect(within(view).getByRole('button', { name: 'Set: HMW' })).toBeInTheDocument()
      const list = await within(view).findByTestId('deck-list')
      expect(within(list).getAllByTestId('deck-row').length).toBeGreaterThan(5)
      expect(list.textContent).not.toMatch(/HMW_\d/)
      expect(within(view).getAllByRole('button', { name: /: see the card$/ })).toHaveLength(2)
    })

    it('says the set is caching, with nothing to use, while it is', async () => {
      vi.mocked(importSet).mockImplementationOnce(() => new Promise(() => { /* still caching */ }))
      const user = userEvent.setup()
      const view = await openGenerate(user)
      expect(await within(view).findByText(/Caching HMW/)).toBeInTheDocument()
      expect(within(view).getByRole('button', { name: 'Use this deck' })).toBeDisabled()
    })

    it('generates again, a different deck', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      const view = await openGenerate(user)
      const list = await within(view).findByTestId('deck-list')
      const first = list.textContent
      let changed = false
      for (let i = 0; i < 5 && !changed; i++) {
        await user.click(within(view).getByRole('button', { name: 'Generate again' }))
        changed = within(view).getByTestId('deck-list').textContent !== first
      }
      expect(changed).toBe(true)
    })

    it('builds from the set chosen on it, and remembers the set', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      const view = await openGenerate(user)
      await user.click(within(view).getByRole('button', { name: 'Set: HMW' }))
      await user.click(within(dialog('Set')).getByTestId('set-option-ASH'))

      expect(within(dialog('Generated deck')).getByRole('button', { name: 'Set: ASH' })).toBeInTheDocument()
      await waitFor(() => expect(within(dialog('Generated deck')).getByTestId('deck-list').textContent).toMatch(/\w/))
      expect(JSON.parse(localStorage.getItem('sealed_setup')!).playerSet).toBe('ASH')
    })

    it('plays the generated deck once used, without saving it', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      const onPlay = vi.fn()
      render(<SetupScreen onPlay={onPlay} onHelp={vi.fn()} onSettings={vi.fn()} onBack={vi.fn()} />)
      await user.click(within(deckCard()).getByRole('button', { name: 'Generate a deck' }))
      await within(dialog('Generated deck')).findByTestId('deck-list')
      await user.click(within(dialog('Generated deck')).getByRole('button', { name: 'Use this deck' }))

      expect(within(deckCard()).getByTestId('deck-name')).toHaveTextContent(/generated/)
      const [mine] = await play(user, onPlay)
      expect(mine.id).toBe('generated')
      expect(mine.leader).toMatch(/^HMW_/)
      expect(listDecks()).toEqual([])
    })

    it('is offered in the deck sheet as well', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      vader()
      renderSetup()
      const sheet = await openDeckSheet(user)
      await user.click(within(sheet).getByRole('button', { name: /Generate a deck/ }))
      expect(dialog('Generated deck')).toBeInTheDocument()
    })
  })

  describe('importing a deck', () => {
    async function openImport(user: User) {
      renderSetup()
      await user.click(within(deckCard()).getByRole('button', { name: 'Import deck JSON' }))
      return dialog('Import deck JSON')
    }

    it('imports a pasted deck, saves it and chooses it', async () => {
      const user = userEvent.setup()
      const sheet = await openImport(user)
      await user.click(within(sheet).getByLabelText('Deck JSON'))
      await user.paste(validDeckJson())
      await user.click(within(sheet).getByRole('button', { name: 'Import' }))

      expect(listDecks().map(d => d.name)).toEqual(['Vader Aggro'])
      expect(screen.queryByRole('dialog', { name: 'Import deck JSON' })).toBeNull()
      expect(within(deckCard()).getByTestId('deck-name')).toHaveTextContent('Vader Aggro')
    })

    it('pastes from the clipboard with Paste', async () => {
      const user = userEvent.setup()
      const sheet = await openImport(user)
      vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue(validDeckJson('From clipboard'))
      await user.click(within(sheet).getByRole('button', { name: 'Paste' }))

      await waitFor(() => expect(within(sheet).getByLabelText('Deck JSON')).toHaveValue(validDeckJson('From clipboard')))
    })

    it.each([
      ['{nope', /Couldn't read that/],
      [JSON.stringify({ leader: { id: 'SOR_010' }, base: { id: 'SOR_029' }, deck: [{ id: 'SOR_100', count: 5 }] }), /at least 30/],
      [JSON.stringify({ leader: { id: 'SOR_010' }, deck: SOR_CARDS }), /exactly 1 base/],
    ])('shows today\'s error for a bad paste and keeps the text (%#)', async (text, message) => {
      const user = userEvent.setup()
      const sheet = await openImport(user)
      await user.click(within(sheet).getByLabelText('Deck JSON'))
      await user.paste(text)
      await user.click(within(sheet).getByRole('button', { name: 'Import' }))

      expect(within(sheet).getByRole('alert')).toHaveTextContent(message)
      expect(within(sheet).getByLabelText('Deck JSON')).toHaveValue(text)
      expect(within(sheet).getByLabelText('Deck JSON')).toHaveAttribute('aria-invalid', 'true')
      expect(listDecks()).toEqual([])
    })

    it('caches the imported deck\'s cards, leader and base first', async () => {
      const user = userEvent.setup()
      const sheet = await openImport(user)
      await user.click(within(sheet).getByLabelText('Deck JSON'))
      await user.paste(validDeckJson())
      await user.click(within(sheet).getByRole('button', { name: 'Import' }))

      await waitFor(() => expect(syncCatalogue).toHaveBeenCalledTimes(1))
      const refs = vi.mocked(syncCatalogue).mock.calls[0][0]
      expect(refs).toHaveLength(32)
      expect(refs[0]).toEqual({ set: 'SOR', number: '010' })
    })
  })

  describe('the opponent', () => {
    it('defaults to a generated deck, a new one each game', () => {
      renderSetup()
      expect(opponentCard()).toHaveTextContent('Generated deck')
      expect(opponentCard()).toHaveTextContent(/A new deck every game/)
      expect(opponentCard()).toHaveTextContent(/random leader · random base aspect/)
    })

    it('opens on Generated, with the set linked to your deck', async () => {
      const user = userEvent.setup()
      renderSetup()
      const sheet = await openOpponent(user)
      expect(within(sheet).getByRole('group', { name: 'Opponent\'s deck' })).toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: 'Generated' })).toHaveAttribute('aria-pressed', 'true')
      expect(within(sheet).getByRole('switch', { name: 'Same set as my deck' })).toHaveAttribute('aria-checked', 'true')
      expect(within(sheet).queryByRole('button', { name: /^Set: / })).toBeNull()
      expect(sheet).toHaveTextContent(/left random, a leader never gets a base of its own aspect/i)
    })

    it('plays against a freshly generated opponent from the set of your deck', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      const ahsoka = saveDeck({ name: 'Ahsoka', leader: 'ASH_009', base: 'ASH_023', cards: [] })
      const { onPlay } = renderSetup()
      await chooseDeck(user, ahsoka.id)
      await waitFor(() => expect(opponentCard()).toHaveTextContent('from ASH'))

      const [, theirs] = await play(user, onPlay)
      expect(theirs.id).toBe('generated')
      expect(theirs.leader).toMatch(/^ASH_/)
      expect(theirs.cards.length).toBeGreaterThan(0)
    })

    it('caches your deck\'s set before building its opponent', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      const a = vader()
      // SOR arrives in the cache once its fetch has run, as it would for real.
      vi.mocked(importSet).mockImplementation(async code => {
        if (code === 'SOR') withCache({ ...SETS, SOR: SETS.ASH.map(c => ({ ...c, Set: 'SOR' })) })
        return { cached: 264, total: 264 }
      })
      const { onPlay } = renderSetup()
      await chooseDeck(user, a.id)

      const [, theirs] = await play(user, onPlay)
      expect(importSet).toHaveBeenCalledWith('SOR', expect.anything())
      expect(theirs.leader).toMatch(/^SOR_/)
    })

    describe('a generated opponent\'s leader and base aspect', () => {
      const maz = 'HMW_002'

      it('lists the set\'s leaders with Random first, and the base aspects', async () => {
        withCache(SETS)
        const user = userEvent.setup()
        renderSetup()
        const sheet = await openOpponent(user)
        await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Leader: Random' })).toBeInTheDocument())

        await user.click(within(sheet).getByRole('button', { name: 'Leader: Random' }))
        const leaders = dialog('Opponent\'s leader')
        expect(leaders).toHaveTextContent('The 18 leaders in HMW')
        expect(within(leaders).getByTestId('leader-option-random')).toHaveAttribute('aria-pressed', 'true')
        expect(within(leaders).getAllByTestId(/^leader-option-/)).toHaveLength(19)
        await user.click(within(leaders).getByTestId(`leader-option-${maz}`))

        const back = dialog('Opponent')
        expect(within(back).getByRole('button', { name: 'Leader: Maz Kanata' })).toBeInTheDocument()
        await user.click(within(back).getByRole('button', { name: 'Base aspect: Random' }))
        const aspects = dialog('Opponent\'s base aspect')
        expect(within(aspects).getAllByTestId(/^aspect-option-/).map(o => o.textContent)).toEqual(['Random', 'Aggression', 'Command', 'Cunning', 'Vigilance'])
      })

      it('plays against the leader and base aspect chosen, even a matching pair', async () => {
        withCache(SETS)
        const user = userEvent.setup()
        const mine = saveDeck({ name: 'Mine', leader: 'HMW_001', base: 'HMW_019', cards: [] })
        const { onPlay } = renderSetup()
        await chooseDeck(user, mine.id)
        const sheet = await openOpponent(user)
        await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Leader: Random' })).toBeInTheDocument())
        await user.click(within(sheet).getByRole('button', { name: 'Leader: Random' }))
        await user.click(within(dialog('Opponent\'s leader')).getByTestId(`leader-option-${maz}`))
        await user.click(within(dialog('Opponent')).getByRole('button', { name: 'Base aspect: Random' }))
        await user.click(within(dialog('Opponent\'s base aspect')).getByTestId('aspect-option-Command'))
        await user.click(within(dialog('Opponent')).getByRole('button', { name: 'Close' }))

        expect(opponentCard()).toHaveTextContent('Maz Kanata · Command base')
        const [, theirs] = await play(user, onPlay)
        expect(theirs.leader).toBe(maz)
        expect(SETS.HMW.find(c => `${c.Set}_${c.Number}` === theirs.base)?.Aspects).toContain('Command')
      })

      it('offers No aspect only for a set with a base that has none, and builds on it', async () => {
        withCache(SETS)
        const user = userEvent.setup()
        const mine = saveDeck({ name: 'Mine', leader: 'HMW_001', base: 'HMW_019', cards: [] })
        const { onPlay } = renderSetup()
        await chooseDeck(user, mine.id)
        const sheet = await openOpponent(user)
        await user.click(within(sheet).getByRole('switch', { name: 'Same set as my deck' }))
        await user.click(within(sheet).getByRole('button', { name: 'Set: HMW' }))
        await user.click(within(dialog('Opponent\'s set')).getByTestId('set-option-JTL'))
        await waitFor(() => expect(within(dialog('Opponent')).getByRole('button', { name: 'Base aspect: Random' })).toBeInTheDocument())
        await user.click(within(dialog('Opponent')).getByRole('button', { name: 'Base aspect: Random' }))

        const aspects = dialog('Opponent\'s base aspect')
        expect(within(aspects).getByTestId('aspect-option-None')).toHaveTextContent(/No aspect.*Lake Country/)
        await user.click(within(aspects).getByTestId('aspect-option-None'))
        await user.click(within(dialog('Opponent')).getByRole('button', { name: 'Close' }))

        const [, theirs] = await play(user, onPlay)
        expect(theirs.base).toBe('JTL_031')
      })

      it('has no No aspect for a set without such a base', async () => {
        withCache(SETS)
        const user = userEvent.setup()
        renderSetup()
        const sheet = await openOpponent(user)
        await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Base aspect: Random' })).toBeInTheDocument())
        await user.click(within(sheet).getByRole('button', { name: 'Base aspect: Random' }))
        expect(within(dialog('Opponent\'s base aspect')).queryByTestId('aspect-option-None')).toBeNull()
      })

      it('drops a leader the newly chosen set does not offer', async () => {
        withCache(SETS)
        const user = userEvent.setup()
        renderSetup()
        const sheet = await openOpponent(user)
        await waitFor(() => expect(within(sheet).getByRole('button', { name: 'Leader: Random' })).toBeInTheDocument())
        await user.click(within(sheet).getByRole('button', { name: 'Leader: Random' }))
        await user.click(within(dialog('Opponent\'s leader')).getByTestId(`leader-option-${maz}`))
        await user.click(within(dialog('Opponent')).getByRole('switch', { name: 'Same set as my deck' }))
        await user.click(within(dialog('Opponent')).getByRole('button', { name: 'Set: HMW' }))
        await user.click(within(dialog('Opponent\'s set')).getByTestId('set-option-ASH'))

        await waitFor(() => expect(within(dialog('Opponent')).getByRole('button', { name: 'Leader: Random' })).toBeInTheDocument())
      })
    })

    describe('the opponent\'s set', () => {
      it('starts an unlinked opponent on your deck\'s set, and builds from the one chosen', async () => {
        withCache(SETS)
        const user = userEvent.setup()
        const mine = saveDeck({ name: 'Mine', leader: 'HMW_001', base: 'HMW_019', cards: [] })
        const { onPlay } = renderSetup()
        await chooseDeck(user, mine.id)
        const sheet = await openOpponent(user)
        await user.click(within(sheet).getByRole('switch', { name: 'Same set as my deck' }))
        expect(within(sheet).getByRole('button', { name: 'Set: HMW' })).toBeInTheDocument()

        await user.click(within(sheet).getByRole('button', { name: 'Set: HMW' }))
        const sets = dialog('Opponent\'s set')
        expect(within(sets).getAllByTestId(/^set-option-/).map(o => o.textContent)).toEqual(SET_PROGRESS.map(s => s.code))
        await user.click(within(sets).getByTestId('set-option-ASH'))
        await user.click(within(dialog('Opponent')).getByRole('button', { name: 'Close' }))

        expect(opponentCard()).toHaveTextContent('from ASH')
        expect(opponentCard()).not.toHaveTextContent('Same set as your deck')
        const [, theirs] = await play(user, onPlay)
        expect(theirs.leader).toMatch(/^ASH_/)
      })

      it('caches a chosen set that is not cached yet, saying so on the sheet', async () => {
        withCache(SETS)
        vi.mocked(importSet).mockImplementation(code => code === 'LOF' ? new Promise(() => { /* still caching */ }) : Promise.resolve({ cached: 264, total: 264 }))
        const user = userEvent.setup()
        renderSetup()
        const sheet = await openOpponent(user)
        await user.click(within(sheet).getByRole('switch', { name: 'Same set as my deck' }))
        await user.click(within(sheet).getByRole('button', { name: 'Set: HMW' }))
        await user.click(within(dialog('Opponent\'s set')).getByTestId('set-option-LOF'))

        expect(importSet).toHaveBeenCalledWith('LOF', expect.anything())
        expect(within(dialog('Opponent')).getByTestId('opponent-pool-summary')).toHaveTextContent('Caching LOF…')
      })
    })

    describe('one of my decks', () => {
      it('picks a saved deck at random by default, and can be the deck you play', async () => {
        const user = userEvent.setup()
        const a = vader()
        const { onPlay } = renderSetup()
        await chooseDeck(user, a.id)
        const sheet = await openOpponent(user)
        await user.click(within(sheet).getByRole('button', { name: 'One of my decks' }))

        expect(within(sheet).getByTestId('opponent-option-random')).toHaveAttribute('aria-pressed', 'true')
        expect(within(sheet).getByTestId('opponent-option-random')).toHaveTextContent(/Picked at random each game/)
        await user.click(within(sheet).getByRole('button', { name: 'Close' }))
        expect(opponentCard()).toHaveTextContent('Any of my decks')

        const [, theirs] = await play(user, onPlay)
        expect(theirs.id).toBe(a.id)
      })

      it('plays against the saved deck chosen, which has View', async () => {
        const user = userEvent.setup()
        const mine = vader('Mine')
        const theirs = saveDeck({ name: 'Theirs', leader: 'SOR_011', base: 'SOR_029', cards: SOR_CARDS })
        const { onPlay } = renderSetup()
        await chooseDeck(user, mine.id)
        const sheet = await openOpponent(user)
        await user.click(within(sheet).getByRole('button', { name: 'One of my decks' }))
        expect(within(sheet).getByRole('button', { name: 'View Theirs' })).toBeInTheDocument()
        await user.click(within(sheet).getByTestId(`opponent-option-${theirs.id}`))
        await user.click(within(sheet).getByRole('button', { name: 'Close' }))

        expect(opponentCard()).toHaveTextContent('Theirs')
        const [, opponent] = await play(user, onPlay)
        expect(opponent.id).toBe(theirs.id)
      })

      it('views a saved deck from the opponent sheet', async () => {
        const user = userEvent.setup()
        saveDeck({ name: 'Theirs', leader: 'SOR_011', base: 'SOR_029', cards: SOR_CARDS })
        renderSetup()
        const sheet = await openOpponent(user)
        await user.click(within(sheet).getByRole('button', { name: 'One of my decks' }))
        await user.click(within(sheet).getByRole('button', { name: 'View Theirs' }))
        expect(dialog('Theirs')).toBeInTheDocument()
      })

      /**
       * Saved games as Boba Fett on a Cunning aspect base against Darth Vader on a Vigilance one, read
       * from each game's starting position. A matchup never played says nothing. JTL, because another
       * test here stands ASH's cards in for SOR's, and the screen's card lookup lasts the session.
       */
      describe('your record by matchup', () => {
        // Text content matches with its spaces normalised; the record's hyphen is the non-breaking one.
        const threeTwo = `3${NB_HYPHEN}2, 60%`
        const JTL = buildCardDb(SETS.JTL)
        const seat = (leader: string, base: string) => player({ leader: { cardId: leader, deployed: false, epicActionUsed: false, exhausted: false }, base: { cardId: base, damage: 0 } })
        // Boba Fett on Chopper Base against Vader on City in the Clouds.
        const start = state({ cards: JTL, players: { player: seat('JTL_009', 'JTL_029'), opponent: seat('JTL_006', 'JTL_019') } })
        const game = (winner: 'player' | 'opponent') =>
          saveGameRecord({ playerDeckName: 'Mine', opponentDeckName: 'Theirs', winner, startedAt: 1, endedAt: 10, initialState: start, moves: [], finalState: start })

        beforeEach(async () => {
          await db.games.clear()
          for (const w of ['player', 'player', 'opponent', 'player', 'opponent'] as const) await game(w)
        })
        afterEach(() => db.games.clear())

        // Vader on Shield Generator Complex: another Vigilance aspect base, so the same matchup.
        const vaderDeck = () => saveDeck({ name: 'Theirs', leader: 'JTL_006', base: 'JTL_020', cards: SOR_CARDS })
        const boba = () => saveDeck({ name: 'Mine', leader: 'JTL_009', base: 'JTL_029', cards: SOR_CARDS })
        const luke = () => saveDeck({ name: 'Luke', leader: 'JTL_012', base: 'JTL_019', cards: SOR_CARDS })

        it('shows it on each opposing deck in the opponent sheet, and nothing for a matchup not played', async () => {
          const user = userEvent.setup()
          const mine = boba()
          const theirs = vaderDeck()
          const other = luke()
          renderSetup()
          await chooseDeck(user, mine.id)
          const sheet = await openOpponent(user)
          await user.click(within(sheet).getByRole('button', { name: 'One of my decks' }))

          await waitFor(() => expect(within(sheet).getByTestId(`opponent-option-${theirs.id}`)).toHaveTextContent(threeTwo))
          expect(within(sheet).getByTestId(`opponent-option-${other.id}`)).not.toHaveTextContent('%')
        })

        it('shows the chosen opponent\'s on the opponent card, and every matchup on a sheet', async () => {
          const user = userEvent.setup()
          const mine = boba()
          const theirs = vaderDeck()
          renderSetup()
          await chooseDeck(user, mine.id)
          const sheet = await openOpponent(user)
          await user.click(within(sheet).getByRole('button', { name: 'One of my decks' }))
          await user.click(within(sheet).getByTestId(`opponent-option-${theirs.id}`))
          await user.click(within(sheet).getByRole('button', { name: 'Close' }))

          await waitFor(() => expect(opponentCard()).toHaveTextContent(`Your record: ${threeTwo}`))
          expect(screen.getByTestId('matchup-summary')).toHaveTextContent(`As Boba Fett, Any Methods Necessary · Cunning base: ${threeTwo}`)
          await user.click(within(opponentCard()).getByRole('button', { name: 'Matchups' }))
          const rows = within(dialog('Matchups')).getAllByTestId('matchup-row')
          expect(rows).toHaveLength(1)
          expect(within(rows[0]).getAllByRole('cell').slice(2).map(c => c.textContent)).toEqual(['Darth Vader, Victor Squadron Leader · Vigilance base', '5', '60%'])
        })

        it('shows no matchups for a leader and base never played', async () => {
          const user = userEvent.setup()
          const other = luke()
          vaderDeck()
          renderSetup()
          await chooseDeck(user, other.id)
          // Give the records time to load, then look.
          await new Promise(r => setTimeout(r, 200))
          expect(screen.queryByTestId('matchup-summary')).not.toBeInTheDocument()
        })
      })
    })

    /** With no set cached there is nothing to generate, so a generated opponent falls back to a saved deck. */
    it('falls back to one of your decks while no set is cached', async () => {
      const user = userEvent.setup()
      const a = vader()
      const { onPlay } = renderSetup()
      await chooseDeck(user, a.id)
      const [, theirs] = await play(user, onPlay)
      expect(theirs.id).toBe(a.id)
    })
  })

  /** The screen comes back as it was left, across a game and across a reload. */
  describe('remembering the setup', () => {
    it('restores the chosen deck and the opponent choices', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      const a = vader()
      const first = renderSetup()
      await chooseDeck(user, a.id)
      const sheet = await openOpponent(user)
      await user.click(within(sheet).getByRole('switch', { name: 'Same set as my deck' }))
      await user.click(within(sheet).getByRole('button', { name: /^Set: / }))
      await user.click(within(dialog('Opponent\'s set')).getByTestId('set-option-HMW'))
      await waitFor(() => expect(within(dialog('Opponent')).getByRole('button', { name: 'Base aspect: Random' })).toBeInTheDocument())
      await user.click(within(dialog('Opponent')).getByRole('button', { name: 'Base aspect: Random' }))
      await user.click(within(dialog('Opponent\'s base aspect')).getByTestId('aspect-option-Cunning'))
      first.view.unmount()

      renderSetup()
      expect(within(deckCard()).getByTestId('deck-name')).toHaveTextContent('Vader Aggro')
      await waitFor(() => expect(opponentCard()).toHaveTextContent('from HMW'))
      expect(opponentCard()).toHaveTextContent('Cunning base')
    })

    it('restores a chosen opponent deck', async () => {
      const user = userEvent.setup()
      const theirs = vader('Theirs')
      const first = renderSetup()
      const sheet = await openOpponent(user)
      await user.click(within(sheet).getByRole('button', { name: 'One of my decks' }))
      await user.click(within(sheet).getByTestId(`opponent-option-${theirs.id}`))
      first.view.unmount()

      renderSetup()
      expect(opponentCard()).toHaveTextContent('Theirs')
    })

    /** A deck removed since is not a choice: the defaults stand in for it. */
    it('falls back when a remembered deck is gone', async () => {
      const user = userEvent.setup()
      const a = vader()
      const first = renderSetup()
      await chooseDeck(user, a.id)
      first.view.unmount()
      localStorage.setItem('sealed_decks', '[]')

      renderSetup()
      expect(goToGame()).toBeDisabled()
      expect(opponentCard()).toHaveTextContent('Generated deck')
    })
  })

  /**
   * Caching follows what is on the screen: each generator caches the set it is pointed at, and each
   * saved deck caches the cards it names, so a cold cache reaches a playable deck unasked.
   */
  describe('caching what the screen needs', () => {
    it('caches the newest set from a cold cache, once', async () => {
      renderSetup()
      await waitFor(() => expect(importSet).toHaveBeenCalledWith('HMW', expect.anything()))
      await new Promise(r => setTimeout(r, 20))
      expect(vi.mocked(importSet).mock.calls.map(c => c[0])).toEqual(['HMW'])
    })

    it('fetches nothing when that set is already cached', async () => {
      withCache(SETS)
      renderSetup()
      await new Promise(r => setTimeout(r, 20))
      expect(importSet).not.toHaveBeenCalled()
    })

    it('fetches a set that holds only a few of its cards', async () => {
      withCache({ HMW: SETS.HMW.slice(0, 4) })
      renderSetup()
      await waitFor(() => expect(importSet).toHaveBeenCalledWith('HMW', expect.anything()))
    })

    it('reports a failed fetch where it was asked for', async () => {
      vi.mocked(importSet).mockRejectedValueOnce(new Error('Set HMW could not be fetched (SWUDB 502)'))
      const user = userEvent.setup()
      renderSetup()
      await user.click(within(deckCard()).getByRole('button', { name: 'Generate a deck' }))
      expect(await within(dialog('Generated deck')).findByText(/could not be fetched/i)).toBeInTheDocument()
    })

    it('caches the cards a saved deck names, once', async () => {
      saveDeck({ name: 'Old Deck', leader: 'SOR_010', base: 'SOR_029', cards: [{ id: 'SOR_100', count: 2 }] })
      const user = userEvent.setup()
      renderSetup()
      await waitFor(() => expect(syncCatalogue).toHaveBeenCalledTimes(1))
      expect(vi.mocked(syncCatalogue).mock.calls[0][0]).toEqual([
        { set: 'SOR', number: '010' },
        { set: 'SOR', number: '029' },
        { set: 'SOR', number: '100' },
      ])
      await openDeckSheet(user)
      expect(syncCatalogue).toHaveBeenCalledTimes(1)
    })
  })

  describe('a deck on a base with no aspect', () => {
    it('shows only the leader\'s aspects', async () => {
      const user = userEvent.setup()
      const jtl = saveDeck({ name: 'Ackbar', leader: 'JTL_016', base: 'JTL_031', cards: [] })
      renderSetup()
      const sheet = await openDeckSheet(user)
      const row = within(sheet).getByTestId(`deck-option-${jtl.id}`)
      await waitFor(() => expect(row).toHaveTextContent('Lake Country'))
      expect(within(row).getAllByRole('img').map(i => i.getAttribute('alt'))).toEqual(['Cunning', 'Heroism'])
    })
  })

  describe('layout', () => {
    it('lays out landscape as the two cards side by side, with the deck list only on a view', async () => {
      const user = userEvent.setup()
      const a = vader()
      renderSetup()
      await chooseDeck(user, a.id)
      expect(screen.getByTestId('setup-screen')).toHaveAttribute('data-layout', 'landscape')
      expect(screen.queryByTestId('deck-beside')).toBeNull()
    })

    it('shows the chosen deck\'s contents beside setup on a desktop', async () => {
      withMedia([DESKTOP_QUERY])
      const user = userEvent.setup()
      const a = vader()
      renderSetup()
      await chooseDeck(user, a.id)
      expect(screen.getByTestId('setup-screen')).toHaveAttribute('data-layout', 'desktop')
      const beside = screen.getByTestId('deck-beside')
      expect(beside).toHaveTextContent('In your deck')
      expect(await within(beside).findAllByTestId('deck-row')).not.toHaveLength(0)
    })

    it('shows the leader and base on the deck card in portrait', async () => {
      withMedia([PORTRAIT_QUERY])
      const user = userEvent.setup()
      const a = vader()
      renderSetup()
      await chooseDeck(user, a.id)
      expect(screen.getByTestId('setup-screen')).toHaveAttribute('data-layout', 'portrait')
      expect(await within(deckCard()).findByRole('button', { name: /^Darth Vader.*: see the card$/ })).toBeInTheDocument()
    })

    // jsdom does no layout, so this pins the structure that keeps a notice under the cards from
    // squeezing them on a phone: both cards in one block that never shrinks, so the page scrolls.
    it.each([['portrait', [PORTRAIT_QUERY]], ['landscape', []]])('keeps the cards at full height under a notice in %s', (layout, media) => {
      withMedia(media)
      render(<SetupScreen onPlay={vi.fn()} onHelp={vi.fn()} onSettings={vi.fn()} onBack={vi.fn()} notice={<aside>Share your games?</aside>} />)
      expect(screen.getByTestId('setup-screen')).toHaveAttribute('data-layout', layout)
      const cards = screen.getByTestId('setup-cards')
      expect(cards).toContainElement(screen.getByTestId('deck-card'))
      expect(cards).toContainElement(screen.getByTestId('opponent-card'))
      expect(cards).toHaveStyle({ flexShrink: '0' })
    })

    // jsdom does no layout, so this pins the structure that keeps Go to game on a 844x390 screen with
    // no decks saved: the deck card's two buttons in one row in landscape, stacked elsewhere.
    it.each([['landscape', 'row', []], ['portrait', 'column', [PORTRAIT_QUERY]], ['desktop', 'column', [DESKTOP_QUERY]]])(
      'lays out Generate and Import in a %s deck card as a %s',
      (layout, direction, media) => {
        withMedia(media as string[])
        renderSetup()
        expect(screen.getByTestId('setup-screen')).toHaveAttribute('data-layout', layout)
        const generate = within(deckCard()).getByRole('button', { name: 'Generate a deck' })
        const row = generate.parentElement!
        expect(row).toContainElement(within(deckCard()).getByRole('button', { name: 'Import deck JSON' }))
        expect(row).toHaveStyle({ flexDirection: direction })
      },
    )
  })

  /** The card catalogue column's reference panel, moved to More › Card support. */
  describe('card support', () => {
    async function openCardSupport(user: User) {
      await user.click(screen.getByRole('button', { name: 'More' }))
      await user.click(within(dialog('More')).getByRole('button', { name: 'Card support' }))
      return dialog('Card support')
    }

    it('lists every set by legality group, each with how many of its cards are built', async () => {
      const user = userEvent.setup()
      renderSetup()
      const sheet = await openCardSupport(user)

      expect(within(sheet).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['In rotation', 'Rotated out', 'Other sets'])
      for (const set of SET_PROGRESS) {
        const done = sumCounts(set.done)
        const total = sumCounts(set.total)
        const row = within(sheet).getByTestId(`set-progress-${set.code}`)
        expect(row).toHaveTextContent(done === total ? `All ${total} cards` : `${done} of ${total} cards`)
      }
    })

    it('opens a set to show its card types, and shuts it again', async () => {
      const user = userEvent.setup()
      renderSetup()
      const sheet = await openCardSupport(user)
      const set = SET_PROGRESS[0]
      const toggle = within(within(sheet).getByTestId(`set-progress-${set.code}`)).getByRole('button')

      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(within(sheet).queryByTestId(`set-${set.code}-units`)).toBeNull()
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(within(sheet).getByTestId(`set-${set.code}-units`)).toHaveTextContent(`${set.done.units} / ${set.total.units}`)
      await user.click(toggle)
      expect(within(sheet).queryByTestId(`set-${set.code}-units`)).toBeNull()
    })
  })
})
