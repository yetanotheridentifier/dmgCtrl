// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeckSelectScreen from '../components/deckSelectScreen'
import { TOTAL_PROGRESS, SET_PROGRESS, CARD_TYPES } from '../data/implementedCards'
import { saveDeck } from '../data/deckStore'
import { syncCatalogue } from '../data/catalogueSync'
import { importSet, largestCachedSet } from '../data/setImport'
import ashSet from './fixtures/ashSet.json'
import type { SwuCard } from '../data/cards'

vi.mock('../data/catalogueSync', () => ({
  syncCatalogue: vi.fn().mockResolvedValue({ hydrated: 0, skipped: 0, failed: 0 }),
}))

vi.mock('../data/setImport', () => ({
  importSet: vi.fn().mockResolvedValue({ cached: 264, total: 264 }),
  cachedSetCount: vi.fn().mockResolvedValue(0),
  // No cached set by default, which is the state a fresh install is in: the generated-deck panel
  // has to work before anyone has imported anything.
  largestCachedSet: vi.fn().mockResolvedValue(null),
}))

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
    vi.mocked(largestCachedSet).mockResolvedValue(null)
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
    expect(codes[0]).toBe('ASH') // most recent at the top

    // Sets are blocked by legality, with the two non-current blocks labelled.
    expect(within(panel).getByTestId('set-group-rotation')).toBeInTheDocument()
    expect(within(within(panel).getByTestId('set-group-retired')).getByText(/rotated out/i)).toBeInTheDocument()
    expect(within(within(panel).getByTestId('set-group-out-of-cycle')).getByText(/other sets/i)).toBeInTheDocument()

    // Only the newest set is expanded.
    expect((within(panel).getByTestId('set-progress-ASH') as HTMLDetailsElement).open).toBe(true)
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

    expect(syncCatalogue).toHaveBeenCalledTimes(1)
    const refs = vi.mocked(syncCatalogue).mock.calls[0][0]
    // leader + base + 30 deck cards
    expect(refs).toHaveLength(32)
    expect(refs[0]).toEqual({ set: 'SOR', number: '010' })
  })

  it('plays a selected deck against a random opponent deck by default', async () => {
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

  it('defaults the opponent selector to Random deck', () => {
    saveDeck({ name: 'One', leader: 'SOR_010', base: 'SOR_029', cards: [] })
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    expect((screen.getByTestId('opponent-deck-select') as HTMLSelectElement).value).toBe('random')
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
    const withPool = () => vi.mocked(largestCachedSet).mockResolvedValue({
      set: 'ASH', cards: ashSet as unknown as SwuCard[],
    })

    it('offers nothing to generate until a set is cached', async () => {
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      expect(await screen.findByTestId('generated-deck-subtitle'))
        .toHaveTextContent('Import a set below to generate decks')
      expect(screen.getByTestId('generate-deck-button')).toBeDisabled()
      expect(screen.getByTestId('play-generated-button')).toBeDisabled()
    })

    it('names the set it would build from once one is cached', async () => {
      withPool()
      render(<DeckSelectScreen onPlay={vi.fn()} />)
      expect(await screen.findByTestId('generated-deck-subtitle')).toHaveTextContent('Built from ASH')
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
      expect(list.textContent).not.toMatch(/ASH_\d/)
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
      expect(subtitle.textContent).not.toMatch(/ASH_\d/)
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
  })

  it('imports a full card set and reports the count', async () => {
    const user = userEvent.setup()
    render(<DeckSelectScreen onPlay={vi.fn()} />)

    await user.type(screen.getByTestId('set-import-input'), 'ash')
    await user.click(screen.getByTestId('set-import-btn'))

    expect(importSet).toHaveBeenCalledWith('ash', expect.anything())
    expect(await screen.findByTestId('set-import-status')).toHaveTextContent(/264 cards cached for ASH/i)
  })

  it('shows a set-import failure with its detail', async () => {
    vi.mocked(importSet).mockRejectedValueOnce(new Error('Set ZZZ could not be fetched (SWUDB 502)'))
    const user = userEvent.setup()
    render(<DeckSelectScreen onPlay={vi.fn()} />)

    await user.type(screen.getByTestId('set-import-input'), 'zzz')
    await user.click(screen.getByTestId('set-import-btn'))

    expect(await screen.findByTestId('set-import-status')).toHaveTextContent(/could not be fetched/i)
  })

  it('disables the set import button until a set code is entered', () => {
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    expect(screen.getByTestId('set-import-btn')).toBeDisabled()
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
