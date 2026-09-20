// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeckSelectScreen from '../components/deckSelectScreen'
import { TOTAL_PROGRESS, SET_PROGRESS, CARD_TYPES } from '../data/implementedCards'
import { saveDeck } from '../data/deckStore'
import { syncCatalogue } from '../data/catalogueSync'
import { importSet, cachedSetCards, cachedSetCount } from '../data/setImport'
import ashSet from './fixtures/ashSet.json'
import hmwSet from './fixtures/hmwSet.json'
import type { SwuCard } from '../data/cards'

vi.mock('../data/catalogueSync', () => ({
  syncCatalogue: vi.fn().mockResolvedValue({ hydrated: 0, skipped: 0, failed: 0 }),
}))

vi.mock('../data/setImport', () => ({
  importSet: vi.fn().mockResolvedValue({ cached: 264, total: 264 }),
  // Nothing cached by default, which is the state a fresh install is in: the generated-deck panel
  // has to work before anyone has imported anything.
  cachedSetCount: vi.fn().mockResolvedValue(0),
  cachedSetCards: vi.fn().mockResolvedValue([]),
}))

/**
 * The sets the local cache holds. Two whole sets from the fixtures: HMW, which both generators
 * default to, and ASH, the set these tests switch to. Every other code reads as uncached, which is
 * what a set the player has never imported looks like.
 */
const SETS: Record<string, SwuCard[]> = {
  HMW: hmwSet as unknown as SwuCard[],
  ASH: ashSet as unknown as SwuCard[],
}

function withCache(sets: Record<string, SwuCard[]>) {
  vi.mocked(cachedSetCards).mockImplementation(code => Promise.resolve(sets[code.toUpperCase()] ?? []))
  vi.mocked(cachedSetCount).mockImplementation(code => Promise.resolve((sets[code.toUpperCase()] ?? []).length))
}

function validDeckJson(name = 'Vader Aggro') {
  return JSON.stringify({
    metadata: { name },
    leader: { id: 'SOR_010', count: 1 },
    base: { id: 'SOR_029', count: 1 },
    deck: Array.from({ length: 30 }, (_, i) => ({ id: `SOR_${100 + i}`, count: 1 })),
  })
}

describe('DeckSelectScreen', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(syncCatalogue).mockClear()
    // Reset rather than left set by whichever test ran last: a cached pool changes what the screen
    // renders, so leaking one makes the order of these tests matter.
    withCache({})
    // Reset rather than cleared: several tests queue a one-off implementation, and the screen now
    // fetches on open, so a leaked pending or rejecting mock would change what the next test renders.
    vi.mocked(importSet).mockReset()
    vi.mocked(importSet).mockResolvedValue({ cached: 264, total: 264 })
  })

  it('shows an empty state when no decks are saved', () => {
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    expect(screen.getByTestId('deck-empty-state')).toBeInTheDocument()
  })

  it('breaks progress down per set, newest first, with a row per card type', () => {
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    const panel = screen.getByTestId('set-progress')

    // Newest set first, in the order the manifest declares.
    const codes = SET_PROGRESS.map(s => s.code)
    const rendered = within(panel).getAllByRole('group').map(el => el.getAttribute('data-testid'))
    expect(rendered).toEqual(codes.map(c => `set-progress-${c}`))
    expect(codes[0]).toBe('HMW') // most recent at the top

    // Sets are blocked by legality, with the two non-current blocks labelled.
    expect(within(panel).getByTestId('set-group-rotation')).toBeInTheDocument()
    expect(within(within(panel).getByTestId('set-group-retired')).getByText(/rotated out/i)).toBeInTheDocument()
    expect(within(within(panel).getByTestId('set-group-out-of-cycle')).getByText(/other sets/i)).toBeInTheDocument()

    // Only the newest set is expanded.
    expect((within(panel).getByTestId('set-progress-HMW') as HTMLDetailsElement).open).toBe(true)
    for (const code of codes.slice(1)) {
      expect((within(panel).getByTestId(`set-progress-${code}`) as HTMLDetailsElement).open, code).toBe(false)
    }

    // Every set carries a row per card type, showing implemented / total.
    for (const set of SET_PROGRESS) {
      for (const type of CARD_TYPES) {
        expect(within(panel).getByTestId(`set-${set.code}-${type}`)).toHaveTextContent(`${set.done[type]} / ${set.total[type]}`)
      }
    }
  })

  it('shows a total implementation progress bar (every set)', () => {
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    const bar = screen.getByTestId('implementation-progress')
    expect(within(bar).getByText(`${TOTAL_PROGRESS.done} / ${TOTAL_PROGRESS.total} cards`)).toBeInTheDocument()
    const pct = Math.round((TOTAL_PROGRESS.done / TOTAL_PROGRESS.total) * 100)
    expect(within(bar).getByLabelText(`${pct}% implemented`)).toBeInTheDocument()
    expect(within(bar).getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(pct))
  })

  it('imports a pasted deck and lists it', async () => {
    const user = userEvent.setup()
    render(<DeckSelectScreen onPlay={vi.fn()} />)

    await user.click(screen.getByTestId('deck-import-textarea'))
    await user.paste(validDeckJson())
    await user.click(screen.getByTestId('deck-import-btn'))

    expect(within(screen.getByTestId('deck-list')).getByText('Vader Aggro')).toBeInTheDocument()
    expect(screen.queryByTestId('deck-empty-state')).not.toBeInTheDocument()
  })

  it('clears the textarea after a successful import', async () => {
    const user = userEvent.setup()
    render(<DeckSelectScreen onPlay={vi.fn()} />)

    await user.click(screen.getByTestId('deck-import-textarea'))
    await user.paste(validDeckJson())
    await user.click(screen.getByTestId('deck-import-btn'))

    expect(screen.getByTestId('deck-import-textarea')).toHaveValue('')
  })

  it('shows an error for an invalid paste and keeps the text', async () => {
    const user = userEvent.setup()
    render(<DeckSelectScreen onPlay={vi.fn()} />)

    await user.click(screen.getByTestId('deck-import-textarea'))
    await user.paste('{nope')
    await user.click(screen.getByTestId('deck-import-btn'))

    expect(screen.getByTestId('deck-import-error')).toBeInTheDocument()
    expect(screen.getByTestId('deck-import-textarea')).toHaveValue('{nope')
  })

  it('shows a specific message for a too-small deck', async () => {
    const user = userEvent.setup()
    render(<DeckSelectScreen onPlay={vi.fn()} />)

    const small = JSON.stringify({
      leader: { id: 'SOR_010' },
      base: { id: 'SOR_029' },
      deck: [{ id: 'SOR_100', count: 5 }],
    })
    await user.click(screen.getByTestId('deck-import-textarea'))
    await user.paste(small)
    await user.click(screen.getByTestId('deck-import-btn'))

    expect(screen.getByTestId('deck-import-error')).toHaveTextContent(/at least 30/i)
  })

  it('kicks off a catalogue sync for the imported deck cards', async () => {
    const user = userEvent.setup()
    render(<DeckSelectScreen onPlay={vi.fn()} />)

    await user.click(screen.getByTestId('deck-import-textarea'))
    await user.paste(validDeckJson())
    await user.click(screen.getByTestId('deck-import-btn'))

    await waitFor(() => expect(syncCatalogue).toHaveBeenCalledTimes(1))
    const refs = vi.mocked(syncCatalogue).mock.calls[0][0]
    // leader + base + 30 deck cards
    expect(refs).toHaveLength(32)
    expect(refs[0]).toEqual({ set: 'SOR', number: '010' })
  })

  /** With no set cached there is nothing to generate, so the default opponent falls back to a built deck. */
  it('falls back to a random built opponent while no set is cached', async () => {
    const user = userEvent.setup()
    const onPlay = vi.fn()
    const saved = saveDeck({ name: 'Ready Deck', leader: 'SOR_010', base: 'SOR_029', cards: [{ id: 'SOR_100', count: 30 }] })
    render(<DeckSelectScreen onPlay={onPlay} />)

    const row = within(screen.getByTestId('deck-list')).getByText('Ready Deck').closest('li')!
    await user.click(within(row).getByRole('button', { name: /play/i }))

    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(onPlay.mock.calls[0][0].id).toBe(saved.id)
    // only one deck saved, so the random opponent pick must be that deck
    expect(onPlay.mock.calls[0][1].id).toBe(saved.id)
  })

  it('defaults the opponent selector to a random generated deck', () => {
    saveDeck({ name: 'One', leader: 'SOR_010', base: 'SOR_029', cards: [] })
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    expect((screen.getByTestId('opponent-deck-select') as HTMLSelectElement).value).toBe('generated')
  })

  /**
   * Three columns: the deck you play with, the deck the bot plays, and the card catalogue. The
   * opponent gets a column of its own because choosing what the bot plays is now a panel rather than a
   * single dropdown, and the catalogue is a reference column: it explains what gets cached and
   * reports what is built, with nothing to operate.
   */
  it('lays the screen out as your deck, the opponent, then the card catalogue', async () => {
    withCache(SETS)
    saveDeck({ name: 'One', leader: 'SOR_010', base: 'SOR_029', cards: [] })
    render(<DeckSelectScreen onPlay={vi.fn()} />)

    const opponent = screen.getByTestId('opponent-column')
    expect(await within(opponent).findByTestId('opponent-generation-panel')).toBeInTheDocument()
    expect(within(opponent).getByTestId('opponent-deck-select')).toBeInTheDocument()

    const player = screen.getByTestId('player-column')
    expect(within(player).getByTestId('generated-deck-panel')).toBeInTheDocument()
    expect(within(player).getByTestId('deck-list')).toBeInTheDocument()
    expect(within(player).getByTestId('deck-import-textarea')).toBeInTheDocument()

    const catalogue = screen.getByTestId('catalogue-column')
    expect(within(catalogue).getByTestId('implemented-cards')).toBeInTheDocument()
  })

  it('plays against an explicitly selected opponent deck', async () => {
    const user = userEvent.setup()
    const onPlay = vi.fn()
    const mine = saveDeck({ name: 'Mine', leader: 'SOR_010', base: 'SOR_029', cards: [] })
    const theirs = saveDeck({ name: 'Theirs', leader: 'SOR_011', base: 'SOR_029', cards: [] })
    render(<DeckSelectScreen onPlay={onPlay} />)

    await user.selectOptions(screen.getByTestId('opponent-deck-select'), theirs.id)
    const row = within(screen.getByTestId('deck-list')).getByText('Mine').closest('li')!
    await user.click(within(row).getByRole('button', { name: /play/i }))

    expect(onPlay.mock.calls[0][0].id).toBe(mine.id)
    expect(onPlay.mock.calls[0][1].id).toBe(theirs.id)
  })

  it('hides the opponent selector when no decks are saved', () => {
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    expect(screen.queryByTestId('opponent-deck-select')).not.toBeInTheDocument()
  })

  /**
   * A deck built from the cached set, to play with or against.
   *
   * It exists to make the **generator** inspectable: the card list is shown so a deck can be judged
   * against what a real pool would actually give you, which is how the tripled-Legendary case was
   * found. It is never persisted, and it works before any deck has been imported, since generated
   * against generated is the quickest way to exercise a pool.
   */
  describe('the generated deck', () => {
    const withPool = () => withCache(SETS)

    /** The panel caches the set itself now, so there is nothing to generate only while that runs. */
    it('offers nothing to generate while its set is still being cached', async () => {
      vi.mocked(importSet).mockImplementationOnce(() => new Promise(() => { /* still caching */ }))
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      expect(await screen.findByTestId('generated-deck-subtitle')).toHaveTextContent('Caching HMW…')
      expect(screen.getByTestId('generate-deck-button')).toBeDisabled()
      expect(screen.getByTestId('play-generated-button')).toBeDisabled()
    })

    it('names the set it would build from once one is cached', async () => {
      withPool()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      expect(await screen.findByTestId('generated-deck-subtitle')).toHaveTextContent('Built from HMW')
      expect(screen.getByTestId('generate-deck-button')).toBeEnabled()
    })

    /** The card list is the deliverable: a deck you cannot read is a deck you cannot judge. */
    it('lists every card with name, cost, rarity and copies', async () => {
      withPool()
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await user.click(await screen.findByTestId('generate-deck-button'))

      const list = screen.getByTestId('generated-deck-cards')
      const entries = within(list).getAllByRole('listitem')
      expect(entries.length).toBeGreaterThan(5)
      // cost, name, rarity initial, copies. The copy count is what makes a tripled Legendary visible.
      for (const li of entries) expect(li.textContent).toMatch(/^\d+.+[CURLS?]x\d+$/)
      // Names, not ids: an id-only list cannot be judged against a real pool by eye.
      expect(list.textContent).not.toMatch(/HMW_\d/)
    })

    /**
     * Ordered by cost **within each type block**, because that is how a curve is read. Sorting
     * globally would interleave units with events and hide whether the unit curve is right, which is
     * one of the shape rules the generator targets.
     */
    it('orders each type block by increasing cost', async () => {
      withPool()
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await user.click(await screen.findByTestId('generate-deck-button'))

      const lists = within(screen.getByTestId('generated-deck-cards')).getAllByRole('list')
      expect(lists.length).toBeGreaterThan(1)
      for (const list of lists) {
        const costs = within(list).getAllByRole('listitem')
          .map(li => Number(/^\d+/.exec(li.textContent ?? '')?.[0] ?? NaN))
        expect(costs).toEqual([...costs].sort((a, b) => a - b))
      }
    })

    /**
     * Units on the left, the non-unit cards on the right. A decklist is read units-first, and a
     * flowing two-column grid interleaves the types so neither the curve nor the unit count can be
     * taken in at a glance.
     */
    it('groups the list by card type, units first', async () => {
      withPool()
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await user.click(await screen.findByTestId('generate-deck-button'))

      const panel = screen.getByTestId('generated-deck-cards')
      const headings = within(panel).getAllByRole('heading').map(h => h.textContent ?? '')
      expect(headings[0]).toMatch(/^Units/)
      // Each heading carries its own copy count, so the deck adds up in view.
      for (const h of headings) expect(h).toMatch(/\(\d+\)/)
    })

    /** The leader and base are cards too: previously the base showed as a bare id. */
    it('names the leader and base, both hoverable', async () => {
      withPool()
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await user.click(await screen.findByTestId('generate-deck-button'))

      const subtitle = screen.getByTestId('generated-deck-subtitle')
      expect(subtitle.textContent).not.toMatch(/HMW_\d/)
      expect(within(subtitle).getAllByTestId('static-card-ref')).toHaveLength(2)
    })

    /** Hovering a card shows its art, the same popover the log uses. */
    it('makes every card hoverable for its art', async () => {
      withPool()
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await user.click(await screen.findByTestId('generate-deck-button'))

      const refs = within(screen.getByTestId('generated-deck-cards')).getAllByTestId('static-card-ref')
      expect(refs.length).toBeGreaterThan(5)
      expect(refs[0]).toHaveAttribute('data-card-id')
    })

    it('plays with the generated deck', async () => {
      withPool()
      const user = userEvent.setup()
      const onPlay = vi.fn()
      render(<DeckSelectScreen onPlay={onPlay} />)
      await user.click(await screen.findByTestId('generate-deck-button'))
      await user.click(screen.getByTestId('play-generated-button'))

      expect(onPlay).toHaveBeenCalled()
      expect(onPlay.mock.calls[0][0].id).toBe('generated')
      expect(onPlay.mock.calls[0][0].cards.length).toBeGreaterThan(0)
    })

    /** A partial cache of the default set: one leader, one base and a single unit, far short of a 30-card deck. */
    const withThinPool = () => withCache({
      HMW: [
        { Set: 'HMW', Number: '001', Name: 'Test Leader', Type: 'Leader', Cost: '5', Power: '4', HP: '7' },
        { Set: 'HMW', Number: '002', Name: 'Test Base', Type: 'Base', HP: '30' },
        { Set: 'HMW', Number: '900', Name: 'Big Test Unit', Type: 'Unit', Arenas: ['Ground'], Cost: '0', Power: '4', HP: '3' },
      ] as unknown as SwuCard[],
    })

    it('says the cached set cannot fill a deck rather than offering a short one', async () => {
      withThinPool()
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await user.click(await screen.findByTestId('generate-deck-button'))

      expect(screen.getByTestId('generated-deck-subtitle')).toHaveTextContent('Cannot fill a 30-card deck from HMW')
      expect(screen.getByTestId('play-generated-button')).toBeDisabled()
    })

    it('falls back to a random built opponent when the cached set cannot fill a deck', async () => {
      withThinPool()
      const user = userEvent.setup()
      const onPlay = vi.fn()
      const saved = saveDeck({ name: 'Ready Deck', leader: 'SOR_010', base: 'SOR_029', cards: [{ id: 'SOR_100', count: 30 }] })
      render(<DeckSelectScreen onPlay={onPlay} />)
      expect(await screen.findByTestId('generated-deck-subtitle')).toHaveTextContent('Built from HMW')

      const row = within(screen.getByTestId('deck-list')).getByText('Ready Deck').closest('li')!
      await user.click(within(row).getByRole('button', { name: /play/i }))

      expect(onPlay.mock.calls[0][1].id).toBe(saved.id)
    })

    it('offers a generated opponent even with no decks imported', async () => {
      withPool()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      const select = await screen.findByTestId('opponent-deck-select')
      const options = within(select).getAllByRole('option').map(o => o.textContent)
      expect(options[0]).toBe('Random generated deck')
      expect(options[1]).toBe('Random built deck')
    })

    /**
     * "Built" is the distinction the rename carries: it picks among the player's own imported decks
     * and must never hand back a generated one, or the two options would mean the same thing.
     */
    it('keeps the generated deck out of the random built pick', async () => {
      withPool()
      const user = userEvent.setup()
      const onPlay = vi.fn()
      const mine = saveDeck({ name: 'Mine', leader: 'SOR_010', base: 'SOR_029', cards: [] })
      render(<DeckSelectScreen onPlay={onPlay} />)
      await screen.findByTestId('generated-deck-subtitle')
      await user.selectOptions(screen.getByTestId('opponent-deck-select'), 'random')

      const row = within(screen.getByTestId('deck-list')).getByText('Mine').closest('li')!
      await user.click(within(row).getByRole('button', { name: /play/i }))

      expect(onPlay.mock.calls[0][1].id).toBe(mine.id)
    })

    it('plays against a freshly generated opponent when chosen', async () => {
      withPool()
      const user = userEvent.setup()
      const onPlay = vi.fn()
      const mine = saveDeck({ name: 'Mine', leader: 'SOR_010', base: 'SOR_029', cards: [] })
      render(<DeckSelectScreen onPlay={onPlay} />)

      await user.selectOptions(await screen.findByTestId('opponent-deck-select'), 'generated')
      const row = within(screen.getByTestId('deck-list')).getByText('Mine').closest('li')!
      await user.click(within(row).getByRole('button', { name: /play/i }))

      expect(onPlay.mock.calls[0][0].id).toBe(mine.id)
      expect(onPlay.mock.calls[0][1].id).toBe('generated')
      expect(onPlay.mock.calls[0][1].cards.length).toBeGreaterThan(0)
    })

    /**
     * Choosing what the bot plays is how a suspect leader gets watched. The matrix rates a leader, and
     * a game against it shows whether that rating belongs to the leader or to the bot.
     */
    describe('choosing the generated opponent', () => {
      // The leaders come from the set each side is set to, which both default to HMW.
      const POOL = SETS.HMW
      const mazKanata = POOL.find(c => c.Type === 'Leader' && c.Name === 'Maz Kanata')!
      const mazKanataId = `${mazKanata.Set}_${mazKanata.Number}`

      it('offers every leader and base aspect, with random first', async () => {
        withPool()
        render(<DeckSelectScreen onPlay={vi.fn()} />)
        const panel = await screen.findByTestId('opponent-generation-panel')

        const leaders = within(within(panel).getByTestId('opponent-leader-select')).getAllByRole('option')
        expect(leaders[0]).toHaveTextContent('Random leader')
        expect(leaders).toHaveLength(19)
        // Each leader shows its aspects, since the aspects are what the pairing rule is about.
        expect(leaders.find(o => (o as HTMLOptionElement).value === mazKanataId)).toHaveTextContent(/Maz Kanata.*Command/)

        const aspects = within(within(panel).getByTestId('opponent-aspect-select')).getAllByRole('option')
        expect(aspects.map(o => o.textContent)).toEqual(['Random base aspect', 'Aggression', 'Command', 'Cunning', 'Vigilance'])
      })

      it('says a random pick never doubles an aspect, and that choosing both overrides it', async () => {
        withPool()
        render(<DeckSelectScreen onPlay={vi.fn()} />)
        const panel = await screen.findByTestId('opponent-generation-panel')
        expect(panel).toHaveTextContent(/never pairs a leader with a base/i)
        expect(panel).toHaveTextContent(/choos(e|ing) both/i)
      })

      it('plays against a generated opponent with the leader and base aspect chosen, even a matching pair', async () => {
        withPool()
        const user = userEvent.setup()
        const onPlay = vi.fn()
        saveDeck({ name: 'Mine', leader: 'SOR_010', base: 'SOR_029', cards: [] })
        render(<DeckSelectScreen onPlay={onPlay} />)
        const panel = await screen.findByTestId('opponent-generation-panel')

        await user.selectOptions(within(panel).getByTestId('opponent-leader-select'), mazKanataId)
        await user.selectOptions(within(panel).getByTestId('opponent-aspect-select'), 'Command')
        const row = within(screen.getByTestId('deck-list')).getByText('Mine').closest('li')!
        await user.click(within(row).getByRole('button', { name: /play/i }))

        const opponent = onPlay.mock.calls[0][1]
        expect(opponent.id).toBe('generated')
        expect(opponent.leader).toBe(mazKanataId)
        const base = POOL.find(c => `${c.Set}_${c.Number}` === opponent.base)
        expect(base?.Aspects).toContain('Command')
      })

      it('only applies to a generated opponent', async () => {
        withPool()
        const user = userEvent.setup()
        const theirs = saveDeck({ name: 'Theirs', leader: 'SOR_011', base: 'SOR_029', cards: [] })
        render(<DeckSelectScreen onPlay={vi.fn()} />)
        const panel = await screen.findByTestId('opponent-generation-panel')
        expect(within(panel).getByTestId('opponent-leader-select')).toBeEnabled()

        await user.selectOptions(screen.getByTestId('opponent-deck-select'), theirs.id)
        expect(within(panel).getByTestId('opponent-leader-select')).toBeDisabled()
        expect(within(panel).getByTestId('opponent-aspect-select')).toBeDisabled()
      })
    })
  })

  /**
   * Which pool each generator builds from. The two are chosen independently, so "an HMW deck against
   * an ASH opponent" is something you can ask for, and both start on the newest set rather than on
   * whichever set happens to have the most cards cached.
   */
  describe('choosing the set each generator builds from', () => {
    it('defaults both generators to the newest set, and offers every set', async () => {
      withCache(SETS)
      render(<DeckSelectScreen onPlay={vi.fn()} />)

      const player = await screen.findByTestId('player-set-select') as HTMLSelectElement
      const opponent = screen.getByTestId('opponent-set-select') as HTMLSelectElement
      expect(player.value).toBe('HMW')
      expect(opponent.value).toBe('HMW')
      expect(within(player).getAllByRole('option').map(o => (o as HTMLOptionElement).value))
        .toEqual(SET_PROGRESS.map(s => s.code))
    })

    /** Both controls exist before anything is cached, each side saying what its own set is doing. */
    it('offers the controls with nothing cached, saying so per side', async () => {
      vi.mocked(importSet).mockImplementationOnce(() => new Promise(() => { /* still caching */ }))
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      expect(await screen.findByTestId('player-set-select')).toBeInTheDocument()
      expect(screen.getByTestId('opponent-pool-summary')).toHaveTextContent('Caching HMW')
    })

    it('picks the player and opponent sets independently, each line naming its own set', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await user.selectOptions(await screen.findByTestId('player-set-select'), 'ASH')

      expect((screen.getByTestId('player-set-select') as HTMLSelectElement).value).toBe('ASH')
      expect((screen.getByTestId('opponent-set-select') as HTMLSelectElement).value).toBe('HMW')
      await waitFor(() => expect(screen.getByTestId('generated-deck-subtitle'))
        .toHaveTextContent(`Built from ASH (${SETS.ASH.length} cards cached)`))
      expect(screen.getByTestId('opponent-pool-summary'))
        .toHaveTextContent(`Built from HMW (${SETS.HMW.length} cards cached)`)
    })

    it('builds each side from its own set at play time', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      const onPlay = vi.fn()
      render(<DeckSelectScreen onPlay={onPlay} />)
      await user.selectOptions(await screen.findByTestId('opponent-set-select'), 'ASH')
      await waitFor(() => expect(screen.getByTestId('opponent-pool-summary')).toHaveTextContent('Built from ASH'))

      await user.click(screen.getByTestId('generate-deck-button'))
      await user.click(screen.getByTestId('play-generated-button'))

      const [mine, theirs] = onPlay.mock.calls[0]
      const ids = (deck: { cards: { id: string }[] }) => deck.cards.map(c => c.id)
      expect(mine.leader).toMatch(/^HMW_/)
      expect(ids(mine).length).toBeGreaterThan(0)
      expect(ids(mine).filter((id: string) => !id.startsWith('HMW_'))).toEqual([])
      expect(theirs.leader).toMatch(/^ASH_/)
      expect(ids(theirs).length).toBeGreaterThan(0)
      expect(ids(theirs).filter((id: string) => !id.startsWith('ASH_'))).toEqual([])
    })

    /** Choosing a set nobody has imported caches it, which is the only way a first set gets there. */
    it('caches a chosen set that is not cached yet', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await user.selectOptions(await screen.findByTestId('opponent-set-select'), 'LOF')

      expect(importSet).toHaveBeenCalledWith('LOF', expect.anything())
      // Reported on the panel that asked for it, not in a status span in another column.
      expect(await screen.findByTestId('opponent-pool-summary')).toHaveTextContent(/264 cards cached for LOF/i)
    })

    /** While that fetch is running the panel says so, rather than telling you to go and import it. */
    it('says the set is caching while it is being cached', async () => {
      withCache(SETS)
      vi.mocked(importSet).mockImplementationOnce(() => new Promise(() => { /* still caching */ }))
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await user.selectOptions(await screen.findByTestId('opponent-set-select'), 'LOF')

      expect(screen.getByTestId('opponent-pool-summary')).toHaveTextContent('Caching LOF…')
      // The other generator is untouched: it is still on its own set.
      expect(screen.getByTestId('generated-deck-subtitle')).toHaveTextContent('Built from HMW')
    })

    it('leaves an already cached set alone', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await user.selectOptions(await screen.findByTestId('player-set-select'), 'ASH')

      expect(importSet).not.toHaveBeenCalled()
    })

    /**
     * A leader belongs to a pool, so changing the set has to drop a choice the new pool cannot
     * offer: otherwise the select shows a leader that is not in the list and the generator quietly
     * builds a random one instead.
     */
    it('resets a leader choice the newly chosen set does not offer', async () => {
      withCache(SETS)
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      const panel = await screen.findByTestId('opponent-generation-panel')
      const leaderSelect = within(panel).getByTestId('opponent-leader-select') as HTMLSelectElement
      await waitFor(() => expect(within(leaderSelect).getAllByRole('option').length).toBe(19))

      await user.selectOptions(leaderSelect, 'HMW_002')
      expect(leaderSelect.value).toBe('HMW_002')

      await user.selectOptions(within(panel).getByTestId('opponent-set-select'), 'ASH')

      await waitFor(() => expect(leaderSelect.value).toBe(''))
      expect(within(leaderSelect).queryByRole('option', { name: /Maz Kanata/ })).toBeNull()
    })

    /**
     * The two columns want the picker in two different shapes, so each call site says which it wants
     * and these pin both. In the player panel the picker shares a row with Generate and Play, so its
     * label goes beside the control: stacked, the label-plus-select is centred as one unit and the
     * select alone sits below the buttons' line. jsdom applies no CSS, so the classes that decide
     * the layout are what there is to assert on.
     */
    it('puts the player label beside the control, on the buttons\' row', async () => {
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      const select = await screen.findByTestId('player-set-select')
      const label = select.closest('label')!

      expect(label.className).toContain('flex')
      expect(label.className).toContain('items-center')
      // The margin that pushes the control onto a second line is what makes it sit low.
      expect(select.className).not.toContain('mt-1')
      // Same row as both buttons, not merely the same panel.
      const row = screen.getByTestId('generate-deck-button').parentElement
      expect(row).toBe(label.parentElement)
      expect(screen.getByTestId('play-generated-button').parentElement).toBe(row)
      // Wrapping the label text must not cost the control its accessible name.
      expect(within(screen.getByTestId('generated-deck-panel')).getByLabelText('Set')).toBe(select)
    })

    /**
     * The opponent picker sits above Leader and Base aspect, which are stacked by design, so it stays
     * stacked: inline there would start three controls at three different x positions behind labels
     * of three different widths.
     */
    it('keeps the opponent label above the control, like its leader and base aspect selects', async () => {
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      const panel = await screen.findByTestId('opponent-generation-panel')
      const select = within(panel).getByTestId('opponent-set-select')
      const label = select.closest('label')!

      expect(label.className).toContain('block')
      expect(label.className).not.toContain('flex')
      expect(select.className).toContain('mt-1')
      expect(within(panel).getByTestId('opponent-leader-select').closest('label')!.className)
        .toContain('block')
      expect(within(panel).getByLabelText('Set')).toBe(select)
    })
  })

  /**
   * Caching follows what is on the screen. There is no set-code box: each generator caches the set
   * it is pointed at, and each deck list caches the cards it names, so a completely cold cache
   * reaches a playable deck with nothing asked of the player.
   */
  describe('caching what the screen needs', () => {
    it('caches the set the generators start on, from a cold cache', async () => {
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await waitFor(() => expect(importSet).toHaveBeenCalledWith('HMW', expect.anything()))
    })

    /**
     * Both generators default to the same set. #659 dodged this by fetching nothing on open; now
     * that opening fetches, one set asked for twice must still be one fetch.
     */
    it('fetches once when both generators are on the same set', async () => {
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      // Wait for the fetch to have finished reporting, so a second one would have landed by now.
      await waitFor(() => expect(screen.getByTestId('opponent-pool-summary'))
        .toHaveTextContent('264 cards cached for HMW'))
      expect(vi.mocked(importSet).mock.calls.map(c => c[0])).toEqual(['HMW'])
    })

    /** Each generator's own set, and no other: opening the screen is not a reason to cache the shelf. */
    it('fetches each generator\'s own set and nothing else', async () => {
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await waitFor(() => expect(importSet).toHaveBeenCalledWith('HMW', expect.anything()))

      await user.selectOptions(screen.getByTestId('opponent-set-select'), 'ASH')

      await waitFor(() => expect(importSet).toHaveBeenCalledWith('ASH', expect.anything()))
      expect(vi.mocked(importSet).mock.calls.map(c => c[0])).toEqual(['HMW', 'ASH'])
    })

    it('fetches nothing when the set both generators are on is already cached', async () => {
      withCache(SETS)
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await waitFor(() => expect(screen.getByTestId('generated-deck-subtitle')).toHaveTextContent('Built from HMW'))
      expect(importSet).not.toHaveBeenCalled()
    })

    /** A failure is reported where the fetch was asked for, not swallowed into a disabled button. */
    it('reports a failed fetch on the panel that asked for it', async () => {
      vi.mocked(importSet).mockRejectedValueOnce(new Error('Set HMW could not be fetched (SWUDB 502)'))
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      expect(await screen.findByTestId('generated-deck-subtitle')).toHaveTextContent(/could not be fetched/i)
    })

    it('has no set-code import control left in the catalogue column', () => {
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      expect(screen.queryByTestId('set-import-input')).toBeNull()
      expect(screen.queryByTestId('set-import-btn')).toBeNull()
      expect(screen.queryByTestId('set-import-status')).toBeNull()
    })

    /** What the column loses is the control, not the explanation or the implementation panel. */
    it('keeps the catalogue column explaining itself, with the implementation panel', () => {
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      const catalogue = screen.getByTestId('catalogue-column')
      expect(within(catalogue).getByTestId('implemented-cards')).toBeInTheDocument()
      expect(catalogue).toHaveTextContent(/cached on this device/i)
    })

    /**
     * A deck saved in an earlier session against a cache that has since been cleared: its cards are
     * fetched because the list names them, rather than needing the whole set imported by hand.
     */
    it('caches the cards a saved deck names', async () => {
      saveDeck({ name: 'Old Deck', leader: 'SOR_010', base: 'SOR_029', cards: [{ id: 'SOR_100', count: 2 }] })
      render(<DeckSelectScreen onPlay={vi.fn()} />)

      await waitFor(() => expect(syncCatalogue).toHaveBeenCalledTimes(1))
      // Leader and base first: they carry the highest display priority.
      expect(vi.mocked(syncCatalogue).mock.calls[0][0]).toEqual([
        { set: 'SOR', number: '010' },
        { set: 'SOR', number: '029' },
        { set: 'SOR', number: '100' },
      ])
    })

    it('caches a saved deck\'s cards once, not on every render', async () => {
      withCache(SETS)
      saveDeck({ name: 'Old Deck', leader: 'SOR_010', base: 'SOR_029', cards: [{ id: 'SOR_100', count: 2 }] })
      const user = userEvent.setup()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      await waitFor(() => expect(syncCatalogue).toHaveBeenCalledTimes(1))

      await user.click(await screen.findByTestId('generate-deck-button'))

      expect(syncCatalogue).toHaveBeenCalledTimes(1)
    })
  })

  it('removes a deck', async () => {
    const user = userEvent.setup()
    saveDeck({ name: 'Doomed Deck', leader: 'SOR_010', base: 'SOR_029', cards: [] })
    render(<DeckSelectScreen onPlay={vi.fn()} />)

    const row = within(screen.getByTestId('deck-list')).getByText('Doomed Deck').closest('li')!
    await user.click(within(row).getByRole('button', { name: /remove/i }))

    expect(screen.queryByText('Doomed Deck')).not.toBeInTheDocument()
    expect(screen.getByTestId('deck-empty-state')).toBeInTheDocument()
  })
})
