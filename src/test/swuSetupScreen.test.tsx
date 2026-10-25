import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuSetupScreen from '../components/swuSetupScreen'
import { useBases, Base } from '../hooks/useBases'
import type { FavouriteBase } from '../hooks/useFavourites'
import { makeMatchMediaMock } from './setup'

const mockOnFavouriteAdded = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnFavouriteRemoved = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnDeckImportSuccess = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOnDeckImportFailure = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../services/analytics', () => ({
  onFavouriteAdded: mockOnFavouriteAdded,
  onFavouriteRemoved: mockOnFavouriteRemoved,
  onDeckImportSuccess: mockOnDeckImportSuccess,
  onDeckImportFailure: mockOnDeckImportFailure,
  onImageLoadFailed: vi.fn(),
}))

const mockUserSettings = vi.hoisted(() => ({
  useHyperspace: true,
  // Setup ignores both: the star and Match always show.
  enableFavourites: false,
  enableCompetitiveMode: false,
}))
vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))

const mockFavourites = vi.hoisted(() => ({
  favourites: [] as FavouriteBase[],
  addFavourite: vi.fn(),
  removeFavourite: vi.fn(),
  clearFavourites: vi.fn(),
}))
vi.mock('../hooks/useFavourites', () => ({
  useFavourites: () => mockFavourites,
}))

vi.mock('../hooks/useBases', () => ({ useBases: vi.fn() }))

function makeBase(set: string, number: string, name: string, aspects: string[], hp = 30, extra: Partial<Base> = {}): Base {
  return {
    set,
    number,
    name,
    subtitle: '',
    hp,
    frontArt: `https://cdn.swu-db.com/images/cards/${set}/${number}.png`,
    frontArtLowRes: null,
    hyperspaceArtHiRes: null,
    hyperspaceArt: null,
    epicAction: '',
    aspects,
    rarity: 'Common',
    ...extra,
  }
}

const catacombs = makeBase('SOR', '026', 'Catacombs of Cadera', ['Aggression'], 30, {
  hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/292.png',
})
const jediTemple = makeBase('LOF', '021', 'Jedi Temple', ['Command'], 28)
const starlightTemple = makeBase('LOF', '024', 'Starlight Temple', ['Command'], 28)
const templeOfDestruction = makeBase('LOF', '028', 'Temple of Destruction', ['Aggression'], 25)
const lakeCountry = makeBase('JTL', '030', 'Lake Country', [])
const coaxium = makeBase('LAW', '021', 'Coaxium Mine', ['Vigilance'], 27)
const echo = makeBase('IBH', '001', 'Echo Caverns', ['Cunning'], 20)

const mockBases = [catacombs, jediTemple, starlightTemple, templeOfDestruction, lakeCountry, coaxium, echo]

const fav = (b: Base): FavouriteBase => ({
  key: `${b.set}-${b.number}`, set: b.set, name: b.name, hp: b.hp, aspect: b.aspects[0] ?? 'None', cardNumber: parseInt(b.number, 10),
})

// SWUDB deck response: its base, JTL-030, is Lake Country above
const deckFound = {
  deckName: '[dmgCtrl test - Do Not Delete] Unlisted deck',
  base: { defaultExpansionAbbreviation: 'JTL', defaultCardNumber: '030' },
}

let store: Map<string, string>
let deckResponse: () => Promise<unknown>

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  })
  deckResponse = () => Promise.resolve({ ok: true, json: () => Promise.resolve(deckFound) })
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => deckResponse()))
  vi.mocked(useBases).mockReturnValue({ bases: mockBases, loading: false, error: null })
  mockUserSettings.useHyperspace = true
  mockUserSettings.enableFavourites = false
  mockUserSettings.enableCompetitiveMode = false
  mockFavourites.favourites = []
  mockFavourites.addFavourite.mockReset()
  mockFavourites.removeFavourite.mockReset()
  mockOnFavouriteAdded.mockClear()
  mockOnFavouriteRemoved.mockClear()
  mockOnDeckImportSuccess.mockClear()
  mockOnDeckImportFailure.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Props = Partial<React.ComponentProps<typeof SwuSetupScreen>>

function renderSetup(props: Props = {}) {
  return render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} onBack={vi.fn()} onSettings={vi.fn()} {...props} />)
}

// A base kept from an earlier game, as a relaunch finds it.
function keep(base: Base, recent: Base[] = [], matchType = 'casual') {
  store.set('swu_setup', JSON.stringify({
    baseKey: `${base.set}-${base.number}`,
    recentBaseKeys: recent.map(b => `${b.set}-${b.number}`),
    matchType,
  }))
}

const baseCard = () => screen.getByTestId('base-card')
const sheet = () => screen.getByRole('dialog', { name: 'Choose your base' })
const group = (name: string) => within(sheet()).getByRole('group', { name })
const tile = (name: string, scope: HTMLElement = sheet()) => within(scope).getByRole('button', { name: new RegExp(`^${name}`) })
const primary = (name: 'Go to game' | 'Go to tournament' | 'Start tournament') => screen.getByRole('button', { name })

describe('SwuSetupScreen: header', () => {
  it('shows the dmgCtrl mark and the game title', () => {
    const { container } = renderSetup()
    expect(screen.getByRole('heading', { level: 1, name: 'Star Wars: Unlimited' })).toBeInTheDocument()
    expect(container.querySelector('img[src$="dmgCtrl-icon-transparent-192.png"]')).toBeInTheDocument()
  })

  it('Back returns to game select', async () => {
    const onBack = vi.fn()
    renderSetup({ onBack })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('More opens Help and Settings, each closing the sheet first', async () => {
    const user = userEvent.setup()
    const onHelp = vi.fn()
    const onSettings = vi.fn()
    renderSetup({ onHelp, onSettings })
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Help' }))
    expect(onHelp).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('button', { name: 'Settings' }))
    expect(onSettings).toHaveBeenCalledOnce()
  })

  it('has none of the old dropdowns', () => {
    keep(jediTemple)
    renderSetup()
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.queryByText(/Format/)).not.toBeInTheDocument()
  })
})

describe('SwuSetupScreen: your base', () => {
  it('the first time, the card asks you to choose your base, and Go to game is disabled', () => {
    renderSetup()
    expect(within(baseCard()).getByText('Your base')).toBeInTheDocument()
    expect(within(baseCard()).getByRole('button', { name: /Choose your base/ })).toBeInTheDocument()
    expect(primary('Go to game')).toBeDisabled()
  })

  it('Choose your base opens the base sheet', async () => {
    renderSetup()
    await userEvent.setup().click(within(baseCard()).getByRole('button', { name: /Choose your base/ }))
    expect(sheet()).toBeInTheDocument()
  })

  it('a kept base shows its name, set and HP, and Go to game is ready', () => {
    keep(jediTemple)
    renderSetup()
    expect(within(baseCard()).getByText('Jedi Temple')).toBeInTheDocument()
    expect(within(baseCard()).getByText('LOF · 28 HP')).toBeInTheDocument()
    expect(primary('Go to game')).toBeEnabled()
  })

  it('shows the base art, hyperspace when that setting is on', () => {
    keep(catacombs)
    renderSetup()
    expect(within(baseCard()).getByAltText('Catacombs of Cadera')).toHaveAttribute('src', catacombs.hyperspaceArtHiRes)
  })

  it('shows the standard art when hyperspace is off', () => {
    mockUserSettings.useHyperspace = false
    keep(catacombs)
    renderSetup()
    expect(within(baseCard()).getByAltText('Catacombs of Cadera')).toHaveAttribute('src', catacombs.frontArt)
  })

  it('still names the base when its art cannot load', () => {
    keep(jediTemple)
    renderSetup()
    fireEvent.error(within(baseCard()).getByAltText('Jedi Temple'))
    expect(within(baseCard()).getByText('Jedi Temple')).toBeInTheDocument()
    expect(within(baseCard()).getByText('LOF · 28 HP')).toBeInTheDocument()
  })

  it('Change base opens the base sheet, and Close leaves the base as it was', async () => {
    const user = userEvent.setup()
    keep(jediTemple)
    renderSetup()
    await user.click(within(baseCard()).getByRole('button', { name: 'Change base' }))
    await user.click(within(sheet()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(baseCard()).getByText('Jedi Temple')).toBeInTheDocument()
  })

  it('Go to game starts a casual game with your base', async () => {
    const onConfirm = vi.fn()
    keep(jediTemple)
    renderSetup({ onConfirm })
    await userEvent.setup().click(primary('Go to game'))
    expect(onConfirm).toHaveBeenCalledWith(jediTemple, 'casual')
  })

  it('says when the card data could not load', () => {
    vi.mocked(useBases).mockReturnValue({ bases: [], loading: false, error: 'Could not load bases' })
    renderSetup()
    expect(screen.getByText('Could not load bases')).toBeInTheDocument()
  })
})

describe('SwuSetupScreen: favourite', () => {
  it('shows the Favourite toggle for your base even with the Favourites setting off', () => {
    keep(jediTemple)
    renderSetup()
    expect(within(baseCard()).getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('has no Favourite toggle before a base is chosen', () => {
    renderSetup()
    expect(screen.queryByRole('button', { name: 'Favourite' })).not.toBeInTheDocument()
  })

  it('is pressed for a base already in your favourites', () => {
    mockFavourites.favourites = [fav(jediTemple)]
    keep(jediTemple)
    renderSetup()
    expect(within(baseCard()).getByRole('button', { name: 'Favourite' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('adds the base to your favourites', async () => {
    keep(jediTemple)
    renderSetup()
    await userEvent.setup().click(within(baseCard()).getByRole('button', { name: 'Favourite' }))
    expect(mockFavourites.addFavourite).toHaveBeenCalledWith(fav(jediTemple))
    expect(mockOnFavouriteAdded).toHaveBeenCalledWith('LOF-021', 'LOF')
  })

  it('adds an aspectless base with the aspect None', async () => {
    keep(lakeCountry)
    renderSetup()
    await userEvent.setup().click(within(baseCard()).getByRole('button', { name: 'Favourite' }))
    expect(mockFavourites.addFavourite).toHaveBeenCalledWith(expect.objectContaining({ key: 'JTL-030', aspect: 'None' }))
  })

  it('removes a favourite', async () => {
    mockFavourites.favourites = [fav(jediTemple)]
    keep(jediTemple)
    renderSetup()
    await userEvent.setup().click(within(baseCard()).getByRole('button', { name: 'Favourite' }))
    expect(mockFavourites.removeFavourite).toHaveBeenCalledWith('LOF-021')
    expect(mockOnFavouriteRemoved).toHaveBeenCalledWith('LOF-021', 'LOF')
  })
})

describe('SwuSetupScreen: match', () => {
  it('shows Casual and Tournament even with Competitive mode off, Casual the first time', () => {
    renderSetup()
    const match = screen.getByRole('group', { name: 'Match' })
    expect(within(match).getByRole('button', { name: 'Casual' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(match).getByRole('button', { name: 'Tournament' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('Tournament makes the primary Start tournament', async () => {
    keep(jediTemple)
    renderSetup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tournament' }))
    expect(primary('Start tournament')).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Go to game' })).not.toBeInTheDocument()
  })

  it('Start tournament is disabled until a base is chosen', async () => {
    renderSetup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tournament' }))
    expect(primary('Start tournament')).toBeDisabled()
  })

  it('with a tournament already under way, the primary is Go to tournament and goes back to it', async () => {
    const onConfirm = vi.fn()
    keep(jediTemple, [], 'tournament')
    renderSetup({ onConfirm, tournamentInProgress: true })
    await userEvent.setup().click(primary('Go to tournament'))
    expect(onConfirm).toHaveBeenCalledWith(jediTemple, 'tournament')
    expect(screen.queryByRole('dialog', { name: 'Start a tournament' })).not.toBeInTheDocument()
  })

  it('is kept for the next visit', async () => {
    const first = renderSetup()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tournament' }))
    first.unmount()
    renderSetup()
    expect(screen.getByRole('button', { name: 'Tournament' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('SwuSetupScreen: start a tournament', () => {
  const startSheet = () => screen.getByRole('dialog', { name: 'Start a tournament' })
  const inSheet = () => within(startSheet())
  const option = (groupName: string, name: string) => within(inSheet().getByRole('group', { name: groupName })).getByRole('button', { name })
  const startRound1 = () => inSheet().getByRole('button', { name: 'Start round 1' })

  async function openStart(base: Base = jediTemple, extra: Record<string, unknown> = {}, props: Props = {}) {
    store.set('swu_setup', JSON.stringify({ baseKey: `${base.set}-${base.number}`, recentBaseKeys: [], matchType: 'tournament', ...extra }))
    const user = userEvent.setup()
    const view = renderSetup(props)
    await user.click(primary('Start tournament'))
    return { user, view }
  }

  it('opens a sheet with your base, Format (Premier), Match (Best of 3) and 5 rounds', async () => {
    await openStart()
    expect(inSheet().getByText('Jedi Temple')).toBeInTheDocument()
    expect(option('Format', 'Premier')).toHaveAttribute('aria-pressed', 'true')
    expect(option('Format', 'Eternal')).toHaveAttribute('aria-pressed', 'false')
    expect(option('Format', 'Limited')).toHaveAttribute('aria-pressed', 'false')
    expect(within(inSheet().getByRole('group', { name: 'Format' })).getAllByRole('button')).toHaveLength(3)
    expect(option('Match', 'Best of 3')).toHaveAttribute('aria-pressed', 'true')
    expect(option('Match', 'Best of 1')).toHaveAttribute('aria-pressed', 'false')
    expect(inSheet().getByText('5')).toBeInTheDocument()
  })

  it('says the choices are fixed once round 1 starts, and only Limited adds the base-change line', async () => {
    const { user } = await openStart()
    const limitedLine = 'In Limited you can change base between games of a match.'
    expect(inSheet().getByText('Fixed once round 1 starts.')).toBeInTheDocument()
    expect(inSheet().queryByText(limitedLine)).not.toBeInTheDocument()
    await user.click(option('Format', 'Limited'))
    expect(inSheet().getByText(limitedLine)).toBeInTheDocument()
    await user.click(option('Format', 'Eternal'))
    expect(inSheet().queryByText(limitedLine)).not.toBeInTheDocument()
    expect(inSheet().queryByText(/X-Wing/)).not.toBeInTheDocument()
  })

  it('Rounds runs from 2 to 16', async () => {
    const { user } = await openStart()
    const fewer = inSheet().getByRole('button', { name: 'Decrease rounds' })
    const more = inSheet().getByRole('button', { name: 'Increase rounds' })
    for (let i = 0; i < 3; i++) await user.click(fewer)
    expect(inSheet().getByText('2')).toBeInTheDocument()
    expect(fewer).toBeDisabled()
    for (let i = 0; i < 14; i++) await user.click(more)
    expect(inSheet().getByText('16')).toBeInTheDocument()
    expect(more).toBeDisabled()
  })

  it('Start round 1 starts the tournament with the choices made and closes the sheet', async () => {
    const onStartTournament = vi.fn()
    const { user } = await openStart(jediTemple, {}, { onStartTournament })
    await user.click(option('Format', 'Eternal'))
    await user.click(option('Match', 'Best of 1'))
    await user.click(inSheet().getByRole('button', { name: 'Increase rounds' }))
    await user.click(startRound1())
    expect(onStartTournament).toHaveBeenCalledWith(jediTemple, { format: 'eternal', playMode: 'bo1', totalRounds: 6 })
    expect(screen.queryByRole('dialog', { name: 'Start a tournament' })).not.toBeInTheDocument()
  })

  it('Cancel closes the sheet without starting', async () => {
    const onStartTournament = vi.fn()
    const { user } = await openStart(jediTemple, {}, { onStartTournament })
    await user.click(inSheet().getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Start a tournament' })).not.toBeInTheDocument()
    expect(onStartTournament).not.toHaveBeenCalled()
  })

  it('remembers the format, across launches too; Match and Rounds start from their defaults', async () => {
    const { user, view } = await openStart()
    await user.click(option('Format', 'Limited'))
    await user.click(option('Match', 'Best of 1'))
    await user.click(inSheet().getByRole('button', { name: 'Cancel' }))
    view.unmount()
    renderSetup()
    await user.click(primary('Start tournament'))
    expect(option('Format', 'Limited')).toHaveAttribute('aria-pressed', 'true')
    expect(option('Match', 'Best of 3')).toHaveAttribute('aria-pressed', 'true')
  })

  it('picks up a format stored before setup kept its own', async () => {
    store.set('pref_format', 'eternal')
    await openStart()
    expect(option('Format', 'Eternal')).toHaveAttribute('aria-pressed', 'true')
  })

  it('a base not legal in the format says so and Start round 1 waits until it is', async () => {
    const { user } = await openStart(catacombs)
    expect(inSheet().getByText('Catacombs of Cadera (SOR) isn’t legal in Premier.')).toBeInTheDocument()
    expect(startRound1()).toBeDisabled()
    await user.click(option('Format', 'Eternal'))
    expect(inSheet().queryByText(/isn’t legal/)).not.toBeInTheDocument()
    expect(startRound1()).toBeEnabled()
  })

  it('Limited rules out a Premier-only set', async () => {
    const { user } = await openStart(echo)
    expect(startRound1()).toBeEnabled()
    await user.click(option('Format', 'Limited'))
    expect(inSheet().getByText('Echo Caverns (IBH) isn’t legal in Limited.')).toBeInTheDocument()
    expect(startRound1()).toBeDisabled()
  })

  it('Change base on the warning opens the base sheet', async () => {
    const { user } = await openStart(catacombs)
    await user.click(inSheet().getByRole('button', { name: 'Change base' }))
    expect(screen.queryByRole('dialog', { name: 'Start a tournament' })).not.toBeInTheDocument()
    expect(sheet()).toBeInTheDocument()
  })
})

describe('SwuSetupScreen: base sheet in a tournament', () => {
  const openSheet = async (format: string) => {
    store.set('swu_setup', JSON.stringify({ recentBaseKeys: [], matchType: 'tournament', format }))
    const user = userEvent.setup()
    renderSetup()
    await user.click(within(baseCard()).getByRole('button', { name: /^Choose your base/ }))
    return user
  }
  const names = (label: string) => within(group(label)).getAllByRole('button').map(b => b.textContent ?? '')

  it('lists only the bases legal in the format: Premier leaves out rotated sets', async () => {
    await openSheet('premier')
    const all = names('All bases')
    expect(all.some(n => n.startsWith('Catacombs of Cadera'))).toBe(false)
    expect(all.some(n => n.startsWith('Echo Caverns'))).toBe(true)
  })

  it('Limited leaves out sets outside the standard ones', async () => {
    await openSheet('limited')
    const all = names('All bases')
    expect(all.some(n => n.startsWith('Echo Caverns'))).toBe(false)
    expect(all.some(n => n.startsWith('Catacombs of Cadera'))).toBe(true)
  })

  it('Eternal lists every base', async () => {
    await openSheet('eternal')
    expect(names('All bases')).toHaveLength(mockBases.length)
  })

  it('the search keeps to legal bases', async () => {
    const user = await openSheet('premier')
    await user.type(within(sheet()).getByRole('searchbox', { name: 'Search bases' }), 'Ca')
    const results = names('Results')
    expect(results.some(n => n.startsWith('Catacombs of Cadera'))).toBe(false)
    expect(results.some(n => n.startsWith('Echo Caverns'))).toBe(true)
  })

  it('favourites and recent bases keep to legal ones too', async () => {
    mockFavourites.favourites = [fav(catacombs), fav(jediTemple)]
    store.set('swu_setup', JSON.stringify({ recentBaseKeys: ['SOR-026', 'IBH-001'], matchType: 'tournament', format: 'premier' }))
    const user = userEvent.setup()
    renderSetup()
    await user.click(within(baseCard()).getByRole('button', { name: /^Choose your base/ }))
    expect(names('Favourites').map(n => n.split(' ')[0])).toEqual(['Jedi'])
    expect(names('Recent').map(n => n.split(' ')[0])).toEqual(['Echo'])
  })

  it('a casual game lists every base whatever format is remembered', async () => {
    store.set('swu_setup', JSON.stringify({ recentBaseKeys: [], matchType: 'casual', format: 'premier' }))
    const user = userEvent.setup()
    renderSetup()
    await user.click(within(baseCard()).getByRole('button', { name: /^Choose your base/ }))
    expect(names('All bases')).toHaveLength(mockBases.length)
  })

  it('SWUDB import says when the deck’s base is not legal, and offers no Use this base', async () => {
    deckResponse = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ deckName: 'Old deck', base: { defaultExpansionAbbreviation: 'SOR', defaultCardNumber: '026' } }) })
    const user = await openSheet('premier')
    await user.click(within(sheet()).getByRole('button', { name: 'Paste SWUDB link' }))
    fireEvent.change(within(sheet()).getByLabelText('SWUDB deck link'), { target: { value: 'https://swudb.com/deck/AbCdEf123456' } })
    await user.click(within(sheet()).getByRole('button', { name: 'Load' }))
    await waitFor(() => expect(within(sheet()).getByRole('alert')).toHaveTextContent('Catacombs of Cadera (SOR) isn’t legal in Premier.'))
    expect(within(sheet()).queryByRole('button', { name: 'Use this base' })).not.toBeInTheDocument()
  })
})

describe('SwuSetupScreen: base sheet', () => {
  const openSheet = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(baseCard()).getByRole('button', { name: /Choose your base|Change base/ }))
  }

  it('choosing a tile sets the base and closes the sheet', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openSheet(user)
    await user.click(tile('Jedi Temple'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(baseCard()).getByText('Jedi Temple')).toBeInTheDocument()
    expect(primary('Go to game')).toBeEnabled()
  })

  it('the base chosen is kept across launches', async () => {
    const user = userEvent.setup()
    const first = renderSetup()
    await openSheet(user)
    await user.click(tile('Jedi Temple'))
    first.unmount()
    renderSetup()
    expect(within(baseCard()).getByText('Jedi Temple')).toBeInTheDocument()
  })

  it('a tile shows the base name, set and HP, and its aspect icon', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openSheet(user)
    const t = tile('Jedi Temple')
    expect(t).toHaveTextContent('LOF · 28 HP')
    expect(t.querySelector('img[src$="command.png"]')).toBeInTheDocument()
  })

  it('with no favourites or recent bases yet, lists every base', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openSheet(user)
    const all = group('All bases')
    for (const b of mockBases) expect(tile(b.name, all)).toBeInTheDocument()
  })

  it('shows favourites first, then recent bases without repeating a favourite', async () => {
    const user = userEvent.setup()
    mockFavourites.favourites = [fav(jediTemple), fav(coaxium)]
    keep(echo, [echo, jediTemple, catacombs])
    renderSetup()
    await openSheet(user)
    const favourites = group('Favourites')
    const recent = group('Recent')
    expect(within(favourites).getAllByRole('button').map(b => b.textContent)).toEqual([
      expect.stringContaining('Jedi Temple'), expect.stringContaining('Coaxium Mine'),
    ])
    expect(within(recent).getAllByRole('button').map(b => b.textContent)).toEqual([
      expect.stringContaining('Echo Caverns'), expect.stringContaining('Catacombs of Cadera'),
    ])
    expect(favourites.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(sheet()).queryByRole('group', { name: 'All bases' })).not.toBeInTheDocument()
  })

  it('a favourite no longer in the card data is left out', async () => {
    const user = userEvent.setup()
    mockFavourites.favourites = [fav(jediTemple), { key: 'XYZ-999', set: 'XYZ', name: 'Gone Base', hp: 30, aspect: 'None', cardNumber: 999 }]
    renderSetup()
    await openSheet(user)
    expect(within(group('Favourites')).getAllByRole('button')).toHaveLength(1)
  })

  it('marks the current base', async () => {
    const user = userEvent.setup()
    keep(jediTemple, [jediTemple, echo])
    renderSetup()
    await openSheet(user)
    expect(tile('Jedi Temple')).toHaveAttribute('aria-pressed', 'true')
    expect(tile('Echo Caverns')).toHaveAttribute('aria-pressed', 'false')
  })

  it('Go to game adds the base to recent', async () => {
    const user = userEvent.setup()
    keep(catacombs)
    const first = renderSetup()
    await user.click(primary('Go to game'))
    first.unmount()
    renderSetup()
    await openSheet(user)
    expect(tile('Catacombs of Cadera', group('Recent'))).toBeInTheDocument()
  })

  it('searches every base by name', async () => {
    const user = userEvent.setup()
    mockFavourites.favourites = [fav(coaxium)]
    renderSetup()
    await openSheet(user)
    await user.type(within(sheet()).getByRole('searchbox', { name: 'Search bases' }), 'temple')
    const results = group('Results')
    expect(within(results).getAllByRole('button').map(b => b.textContent)).toEqual([
      expect.stringContaining('Jedi Temple'), expect.stringContaining('Starlight Temple'), expect.stringContaining('Temple of Destruction'),
    ])
    expect(within(sheet()).getByText('3 bases · “temple”')).toBeInTheDocument()
    expect(within(sheet()).queryByRole('group', { name: 'Favourites' })).not.toBeInTheDocument()
  })

  it('filters by an aspect, combined with the search, and tapping it again clears it', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openSheet(user)
    await user.type(within(sheet()).getByRole('searchbox', { name: 'Search bases' }), 'temple')
    const command = within(sheet()).getByRole('button', { name: 'Command' })
    await user.click(command)
    expect(command).toHaveAttribute('aria-pressed', 'true')
    expect(within(group('Results')).getAllByRole('button')).toHaveLength(2)
    expect(within(sheet()).getByText('2 bases · Command · “temple”')).toBeInTheDocument()
    await user.click(command)
    expect(command).toHaveAttribute('aria-pressed', 'false')
    expect(within(group('Results')).getAllByRole('button')).toHaveLength(3)
  })

  it('an aspect alone lists every base of that aspect', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openSheet(user)
    await user.click(within(sheet()).getByRole('button', { name: 'Aggression' }))
    expect(within(group('Results')).getAllByRole('button').map(b => b.textContent)).toEqual([
      expect.stringContaining('Catacombs of Cadera'), expect.stringContaining('Temple of Destruction'),
    ])
    expect(within(sheet()).getByText('2 bases · Aggression')).toBeInTheDocument()
  })

  it('picking a second aspect replaces the first', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openSheet(user)
    await user.click(within(sheet()).getByRole('button', { name: 'Aggression' }))
    await user.click(within(sheet()).getByRole('button', { name: 'Cunning' }))
    expect(within(sheet()).getByRole('button', { name: 'Aggression' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(group('Results')).getAllByRole('button')).toHaveLength(1)
  })

  it('says when nothing matches', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openSheet(user)
    await user.type(within(sheet()).getByRole('searchbox', { name: 'Search bases' }), 'zzz')
    expect(within(sheet()).getByText('0 bases · “zzz”')).toBeInTheDocument()
  })

  it('opens afresh: the search from last time is cleared', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openSheet(user)
    await user.type(within(sheet()).getByRole('searchbox', { name: 'Search bases' }), 'temple')
    await user.click(within(sheet()).getByRole('button', { name: 'Close' }))
    await openSheet(user)
    expect(within(sheet()).getByRole('searchbox', { name: 'Search bases' })).toHaveValue('')
  })

  it('the sheet fills the screen in landscape and comes from the bottom in portrait', async () => {
    const user = userEvent.setup()
    const first = renderSetup()
    await openSheet(user)
    expect(sheet()).toHaveAttribute('data-placement', 'full')
    first.unmount()
    makeMatchMediaMock(true)
    renderSetup()
    await openSheet(user)
    expect(sheet()).toHaveAttribute('data-placement', 'bottom')
  })
})

describe('SwuSetupScreen: SWUDB link', () => {
  const openImport = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(baseCard()).getByRole('button', { name: /Choose your base|Change base/ }))
    await user.click(within(sheet()).getByRole('button', { name: 'Paste SWUDB link' }))
  }
  const linkInput = () => within(sheet()).getByLabelText('SWUDB deck link')
  const enter = (text: string) => fireEvent.change(linkInput(), { target: { value: text } })
  const load = () => within(sheet()).getByRole('button', { name: /^(Load|\.\.\.)$/ })

  it('Load is disabled until a deck link is entered', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openImport(user)
    expect(load()).toBeDisabled()
    enter('https://swudb.com/deck/AbCdEf123456')
    expect(load()).toBeEnabled()
  })

  it('an edit link is accepted', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openImport(user)
    enter('https://swudb.com/deck/edit/AbCdEf123456')
    expect(load()).toBeEnabled()
    expect(within(sheet()).queryByText('Invalid deck URL')).not.toBeInTheDocument()
  })

  it('a link that is not a deck says so', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openImport(user)
    enter('https://example.com/not-a-deck')
    expect(within(sheet()).getByText('Invalid deck URL')).toBeInTheDocument()
    expect(load()).toBeDisabled()
  })

  it('focusing the link again clears the error but keeps the text', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openImport(user)
    enter('https://example.com/not-a-deck')
    fireEvent.focus(linkInput())
    expect(within(sheet()).queryByText('Invalid deck URL')).not.toBeInTheDocument()
    expect(linkInput()).toHaveValue('https://example.com/not-a-deck')
  })

  it('shows the deck and its base; Use this base sets it and closes the sheet', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openImport(user)
    enter('https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(load())
    await waitFor(() => expect(within(sheet()).getByText(deckFound.deckName)).toBeInTheDocument())
    expect(within(sheet()).getByText('Deck found · its base:')).toBeInTheDocument()
    expect(tile('Lake Country')).toBeInTheDocument()
    await user.click(within(sheet()).getByRole('button', { name: 'Use this base' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(baseCard()).getByText('Lake Country')).toBeInTheDocument()
    expect(mockOnDeckImportSuccess).toHaveBeenCalledWith('JTL-030', 'JTL')
  })

  it('the base is not changed until Use this base', async () => {
    const user = userEvent.setup()
    keep(jediTemple)
    renderSetup()
    await openImport(user)
    enter('https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(load())
    await waitFor(() => expect(within(sheet()).getByText(deckFound.deckName)).toBeInTheDocument())
    await user.click(within(sheet()).getByRole('button', { name: 'Close' }))
    expect(within(baseCard()).getByText('Jedi Temple')).toBeInTheDocument()
  })

  it('Load shows ... while the deck loads', async () => {
    deckResponse = () => new Promise(() => {})
    const user = userEvent.setup()
    renderSetup()
    await openImport(user)
    enter('https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(load())
    expect(load()).toHaveTextContent('...')
  })

  it('a private deck says the deck is not accessible', async () => {
    deckResponse = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    const user = userEvent.setup()
    renderSetup()
    await openImport(user)
    enter('https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(load())
    await waitFor(() => expect(within(sheet()).getByText('Deck not accessible')).toBeInTheDocument())
    expect(within(sheet()).queryByRole('button', { name: 'Use this base' })).not.toBeInTheDocument()
    expect(mockOnDeckImportFailure).toHaveBeenCalledWith('deck_not_accessible')
  })

  it('a deck whose base is not in the card data says so', async () => {
    deckResponse = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ...deckFound, base: { defaultExpansionAbbreviation: 'XYZ', defaultCardNumber: '999' } }) })
    const user = userEvent.setup()
    renderSetup()
    await openImport(user)
    enter('https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(load())
    await waitFor(() => expect(within(sheet()).getByText('Base not recognised')).toBeInTheDocument())
    expect(within(sheet()).getByText(deckFound.deckName)).toBeInTheDocument()
    expect(within(sheet()).queryByRole('button', { name: 'Use this base' })).not.toBeInTheDocument()
    expect(mockOnDeckImportFailure).toHaveBeenCalledWith('base_not_recognised')
  })

  it('changing the link after a load clears the deck', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openImport(user)
    enter('https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(load())
    await waitFor(() => expect(within(sheet()).getByText(deckFound.deckName)).toBeInTheDocument())
    enter('https://swudb.com/deck/Other123')
    expect(within(sheet()).queryByText(deckFound.deckName)).not.toBeInTheDocument()
    expect(within(sheet()).queryByRole('button', { name: 'Use this base' })).not.toBeInTheDocument()
  })

  it('Search instead goes back to the search', async () => {
    const user = userEvent.setup()
    renderSetup()
    await openImport(user)
    await user.click(within(sheet()).getByRole('button', { name: 'Search instead' }))
    expect(within(sheet()).getByRole('searchbox', { name: 'Search bases' })).toBeInTheDocument()
  })
})

describe('SwuSetupScreen: mode', () => {
  const mode = () => screen.getByRole('group', { name: 'Mode' })

  it('offers 1 player and 2 players, 1 player the first time', () => {
    renderSetup()
    expect(within(mode()).getAllByRole('button').map(b => b.textContent)).toEqual(['1 player', '2 players'])
    expect(within(mode()).getByRole('button', { name: '1 player' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('1 player shows your base only', () => {
    keep(jediTemple)
    renderSetup()
    expect(screen.queryByTestId('their-base-card')).not.toBeInTheDocument()
  })

  it('is kept for the next visit', async () => {
    const first = renderSetup()
    await userEvent.setup().click(screen.getByRole('button', { name: '2 players' }))
    first.unmount()
    renderSetup()
    expect(within(mode()).getByRole('button', { name: '2 players' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('SwuSetupScreen: their base', () => {
  const theirCard = () => screen.getByTestId('their-base-card')
  const theirSheet = () => screen.getByRole('dialog', { name: 'Choose their base' })
  const key = (b: Base) => `${b.set}-${b.number}`

  // Two players, with your base and theirs as an earlier visit left them.
  function keep2p(base: Base | null, extra: Record<string, unknown> = {}) {
    store.set('swu_setup', JSON.stringify({
      ...(base ? { baseKey: key(base) } : {}),
      recentBaseKeys: [],
      matchType: 'casual',
      mode: '2p',
      ...extra,
    }))
  }

  it('with no base for them, the card asks you to choose it and Go to game waits for it', () => {
    keep2p(jediTemple)
    renderSetup()
    expect(within(baseCard()).getByText('Jedi Temple')).toBeInTheDocument()
    expect(within(theirCard()).getByText('Their base')).toBeInTheDocument()
    expect(within(theirCard()).getByRole('button', { name: /Choose their base/ })).toBeInTheDocument()
    expect(primary('Go to game')).toBeDisabled()
    expect(screen.getByText('Choose their base to start.')).toBeInTheDocument()
  })

  it('Choose their base opens the base sheet for them; a tile sets their base, not yours', async () => {
    const user = userEvent.setup()
    keep2p(jediTemple)
    renderSetup()
    await user.click(within(theirCard()).getByRole('button', { name: /Choose their base/ }))
    await user.click(tile('Catacombs of Cadera', theirSheet()))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(theirCard()).getByText('Catacombs of Cadera')).toBeInTheDocument()
    expect(within(baseCard()).getByText('Jedi Temple')).toBeInTheDocument()
    expect(primary('Go to game')).toBeEnabled()
    expect(screen.queryByText('Choose their base to start.')).not.toBeInTheDocument()
  })

  it('shows their base with its name, set and HP, a Change base and no Favourite toggle', () => {
    keep2p(jediTemple, { theirBaseKey: key(catacombs) })
    renderSetup()
    expect(within(theirCard()).getByText('Catacombs of Cadera')).toBeInTheDocument()
    expect(within(theirCard()).getByText('SOR · 30 HP')).toBeInTheDocument()
    expect(within(theirCard()).getByRole('button', { name: 'Change base' })).toBeInTheDocument()
    expect(within(theirCard()).queryByRole('button', { name: /Favourite/ })).not.toBeInTheDocument()
  })

  it('Change base on their card marks their base in the sheet', async () => {
    const user = userEvent.setup()
    keep2p(jediTemple, { theirBaseKey: key(catacombs) })
    renderSetup()
    await user.click(within(theirCard()).getByRole('button', { name: 'Change base' }))
    await user.type(within(theirSheet()).getByRole('searchbox'), 'cadera')
    expect(tile('Catacombs of Cadera', theirSheet())).toHaveAttribute('aria-pressed', 'true')
  })

  it('Go to game passes both bases', async () => {
    const onConfirm = vi.fn()
    keep2p(jediTemple, { theirBaseKey: key(catacombs) })
    renderSetup({ onConfirm })
    await userEvent.setup().click(primary('Go to game'))
    expect(onConfirm).toHaveBeenCalledWith(jediTemple, 'casual', catacombs)
  })

  it('their base is kept from the last 2-player game and says so', async () => {
    const user = userEvent.setup()
    keep2p(jediTemple, { theirBaseKey: key(catacombs) })
    const first = renderSetup()
    expect(within(theirCard()).queryByText('Same as last game')).not.toBeInTheDocument()
    await user.click(primary('Go to game'))
    first.unmount()
    renderSetup()
    expect(within(theirCard()).getByText('Catacombs of Cadera')).toBeInTheDocument()
    expect(within(theirCard()).getByText('Same as last game')).toBeInTheDocument()
  })

  it('their base does not enter your recent bases', async () => {
    const user = userEvent.setup()
    keep2p(jediTemple, { theirBaseKey: key(catacombs) })
    const first = renderSetup()
    await user.click(primary('Go to game'))
    first.unmount()
    renderSetup()
    await user.click(within(theirCard()).getByRole('button', { name: 'Change base' }))
    expect(within(within(theirSheet()).getByRole('group', { name: 'Recent' })).getAllByRole('button').map(b => b.textContent)).toEqual([
      expect.stringMatching(/^Jedi Temple/),
    ])
  })

  it('outside a tournament the sheet lists every base for them', async () => {
    const user = userEvent.setup()
    keep2p(jediTemple, { format: 'premier' })
    renderSetup()
    await user.click(within(theirCard()).getByRole('button', { name: /Choose their base/ }))
    await user.type(within(theirSheet()).getByRole('searchbox'), 'cadera')
    expect(tile('Catacombs of Cadera', theirSheet())).toBeInTheDocument()
  })

  it('in a tournament the sheet lists only the bases legal in its format for them too', async () => {
    const user = userEvent.setup()
    keep2p(jediTemple, { matchType: 'tournament', format: 'premier' })
    renderSetup()
    await user.click(within(theirCard()).getByRole('button', { name: /Choose their base/ }))
    const listed = within(within(theirSheet()).getByRole('group', { name: 'All bases' })).getAllByRole('button').map(b => b.textContent ?? '')
    expect(listed.some(n => n.startsWith('Echo Caverns'))).toBe(true)
    expect(listed.some(n => n.startsWith('Catacombs of Cadera'))).toBe(false)
  })

  it('Start tournament waits for their base too', async () => {
    keep2p(jediTemple, { matchType: 'tournament' })
    renderSetup()
    expect(primary('Start tournament')).toBeDisabled()
    expect(screen.getByText('Choose their base to start.')).toBeInTheDocument()
  })

  it('back to 1 player hides their base and Go to game is ready with yours alone', async () => {
    keep2p(jediTemple)
    renderSetup()
    await userEvent.setup().click(screen.getByRole('button', { name: '1 player' }))
    expect(screen.queryByTestId('their-base-card')).not.toBeInTheDocument()
    expect(primary('Go to game')).toBeEnabled()
  })

  it('in portrait shows both cards, Mode, Match and the primary', () => {
    makeMatchMediaMock(true)
    keep2p(jediTemple, { theirBaseKey: key(catacombs) })
    renderSetup()
    expect(within(baseCard()).getByText('Jedi Temple')).toBeInTheDocument()
    expect(within(theirCard()).getByText('Catacombs of Cadera')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Mode' })).toBeInTheDocument()
    expect(primary('Go to game')).toBeEnabled()
  })
})

describe('SwuSetupScreen: portrait', () => {
  it('shows the same card, Match and primary', () => {
    makeMatchMediaMock(true)
    keep(jediTemple)
    renderSetup()
    expect(within(baseCard()).getByText('Jedi Temple')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Match' })).toBeInTheDocument()
    expect(primary('Go to game')).toBeEnabled()
  })
})
