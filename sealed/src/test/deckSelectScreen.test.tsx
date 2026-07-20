import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeckSelectScreen from '../components/deckSelectScreen'
import { IMPLEMENTED_LEADERS, IMPLEMENTED_UPGRADES, TOTAL_PROGRESS, UNIT_GROUPS } from '../data/implementedCards'
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
    // Each leader row shows a ✓ (implemented) or · (not yet) per side — the flag counts across
    // the table track the manifest's front/back booleans (derived so this stays true as sides land).
    const implementedFlags = IMPLEMENTED_LEADERS.reduce((n, l) => n + (l.front ? 1 : 0) + (l.back ? 1 : 0), 0)
    const notYetFlags = IMPLEMENTED_LEADERS.length * 2 - implementedFlags
    expect(within(leaders).getAllByLabelText('implemented')).toHaveLength(implementedFlags)
    if (notYetFlags > 0) expect(within(leaders).getAllByLabelText('not yet')).toHaveLength(notYetFlags)
    else expect(within(leaders).queryByLabelText('not yet')).toBeNull()
    // A fully-implemented leader shows ✓ for both sides.
    const cadBane = within(leaders).getByText('Cad Bane').closest('tr')!
    expect(within(cadBane).getAllByLabelText('implemented')).toHaveLength(2) // front + back

    const upgrades = screen.getByTestId('implemented-upgrades')
    expect(within(upgrades).getAllByRole('listitem')).toHaveLength(IMPLEMENTED_UPGRADES.length)
    expect(within(upgrades).getByText('Camtono')).toBeInTheDocument()
    // Spot-check a leader name renders too.
    expect(IMPLEMENTED_LEADERS.some(l => l.name === 'Baylan Skoll')).toBe(true)
  })

  it('shows a total implementation progress bar (whole set, tokens included)', () => {
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    const bar = screen.getByTestId('implementation-progress')
    expect(within(bar).getByText(`${TOTAL_PROGRESS.done} / ${TOTAL_PROGRESS.total} cards`)).toBeInTheDocument()
    const pct = Math.round((TOTAL_PROGRESS.done / TOTAL_PROGRESS.total) * 100)
    expect(within(bar).getByLabelText(`${pct}% implemented`)).toBeInTheDocument()
    expect(within(bar).getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(pct))
  })

  it('rolls up the completed Leaders and Upgrades into sections collapsed by default', () => {
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    const leadersDetails = screen.getByTestId('implemented-leaders').closest('details') as HTMLDetailsElement
    expect(leadersDetails).not.toBeNull()
    expect(leadersDetails.open).toBe(false)
    const upgradesDetails = screen.getByTestId('implemented-upgrades').closest('details') as HTMLDetailsElement
    expect(upgradesDetails.open).toBe(false)
  })

  it('shows unit groups as collapsible sections, expanding the first not-yet-done group', () => {
    render(<DeckSelectScreen onPlay={vi.fn()} />)
    const groups = screen.getByTestId('implemented-unit-groups')
    const done = within(groups).getByTestId('unit-group-keyword') as HTMLDetailsElement // playable as printed
    expect(done.open).toBe(false) // done → collapsed
    expect(within(done).getByText(/done/i)).toBeInTheDocument()

    // Which group is "next up" changes as tiers get cleared — and once every unit is built there
    // is no blocked group left at all, which is the state we're in now (#357).
    const nextGroup = UNIT_GROUPS.find(g => g.status !== 'done')
    if (nextGroup) {
      const next = within(groups).getByTestId(`unit-group-${nextGroup.id}`) as HTMLDetailsElement
      expect(next.open).toBe(true) // next up → expanded
      expect(within(next).getByText(/in progress/i)).toBeInTheDocument()
      expect(within(next).getAllByRole('listitem').length).toBeGreaterThan(0)
    } else {
      // All units implemented: every section is done and collapsed, and the built group lists them.
      const built = within(groups).getByTestId('unit-group-built') as HTMLDetailsElement
      expect(built.open).toBe(false)
      expect(within(built).getAllByRole('listitem').length).toBeGreaterThan(0)
    }
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
