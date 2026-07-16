import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeckSelectScreen from '../components/deckSelectScreen'
import { IMPLEMENTED_LEADERS, IMPLEMENTED_UPGRADES } from '../data/implementedCards'
import { saveDeck } from '../data/deckStore'
import { syncCatalogue } from '../data/catalogueSync'
import { importSet } from '../data/setImport'

vi.mock('../data/catalogueSync', () => ({
  syncCatalogue: vi.fn().mockResolvedValue({ hydrated: 0, skipped: 0, failed: 0 }),
}))

vi.mock('../data/setImport', () => ({
  importSet: vi.fn().mockResolvedValue({ cached: 264, total: 264 }),
  cachedSetCount: vi.fn().mockResolvedValue(0),
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
  })

  it('shows an empty state when no decks are saved', () => {
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    expect(screen.getByTestId('deck-empty-state')).toBeInTheDocument()
  })

  it('shows the implemented-cards reference: leaders with front/back and every upgrade', () => {
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    const leaders = screen.getByTestId('implemented-leaders')
    // A fully-implemented leader shows ✓ for both sides; a partial one shows ✓ and ·.
    const cadBane = within(leaders).getByText('Cad Bane').closest('tr')!
    expect(within(cadBane).getAllByLabelText('implemented')).toHaveLength(2) // front + back
    const partial = within(leaders).getByText('Fennec Shand').closest('tr')! // front done, back pending
    expect(within(partial).getByLabelText('implemented')).toBeInTheDocument() // front
    expect(within(partial).getByLabelText('not yet')).toBeInTheDocument() // back pending

    const upgrades = screen.getByTestId('implemented-upgrades')
    expect(within(upgrades).getAllByRole('listitem')).toHaveLength(IMPLEMENTED_UPGRADES.length)
    expect(within(upgrades).getByText('Camtono')).toBeInTheDocument()
    // Spot-check a leader name renders too.
    expect(IMPLEMENTED_LEADERS.some(l => l.name === 'Baylan Skoll')).toBe(true)
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
