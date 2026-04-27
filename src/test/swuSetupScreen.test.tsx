import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeMatchMediaMock } from './setup'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuSetupScreen from '../components/swuSetupScreen'
import { Base } from '../hooks/useBases'

const featureUserSettings = vi.hoisted(() => ({ value: false }))
vi.mock('../flags', () => ({
  get FEATURE_USER_SETTINGS() { return featureUserSettings.value },
}))

const mockUserSettings = vi.hoisted(() => ({
  useHyperspace: true,
  enableForceToken: true,
  enableEpicActions: true,
  enableWakeLock: true,
  setUseHyperspace: vi.fn(),
  setEnableForceToken: vi.fn(),
  setEnableEpicActions: vi.fn(),
  setEnableWakeLock: vi.fn(),
}))
vi.mock('../hooks/useUserSettings', () => ({
  useUserSettings: () => mockUserSettings,
}))


const mockBases: Base[] = [
  {
    set: 'SOR',
    number: '026',
    name: 'Catacombs of Cadera',
    subtitle: 'Jedha',
    hp: 30,
    frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png',
    frontArtLowRes: null,
    hyperspaceArt: null,
    hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/292.png',
    epicAction: '',
    aspects: ['Aggression'],
    rarity: 'Common',
  },
  {
    set: 'SOR',
    number: '022',
    name: 'Energy Conversion Lab',
    subtitle: 'Eadu',
    hp: 25,
    frontArt: 'https://cdn.swu-db.com/images/cards/SOR/022.png',
    frontArtLowRes: null,
    hyperspaceArt: null,
    hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/288.png',
    epicAction: 'Epic Action: Play a unit that costs 6 or less.',
    aspects: ['Cunning'],
    rarity: 'Rare',
  },
  {
    set: 'JTL',
    number: '030',
    name: 'Lake Country',
    subtitle: 'Naboo',
    hp: 30,
    frontArt: 'https://cdn.swu-db.com/images/cards/JTL/030.png',
    frontArtLowRes: 'https://cdn.starwarsunlimited.com/jtl-lake-country.png',
    hyperspaceArt: null,
    hyperspaceArtHiRes: null,
    epicAction: '',
    aspects: [],
    rarity: 'Common',
  },
  {
    set: 'LAW',
    number: '021',
    name: 'Coaxium Mine',
    subtitle: 'Kessel',
    hp: 27,
    frontArt: 'https://cdn.swu-db.com/images/cards/LAW/021.png',
    frontArtLowRes: 'https://cdn.starwarsunlimited.com/coaxium-mine.png',
    hyperspaceArt: null,
    hyperspaceArtHiRes: null,
    epicAction: 'Epic Action: Play a card from your hand, ignoring 1 of its aspect penalties.',
    aspects: ['Vigilance'],
    rarity: 'Common',
  },
  {
    set: 'IBH',
    number: '001',
    name: 'Echo Caverns',
    subtitle: 'Hoth',
    hp: 20,
    frontArt: 'https://cdn.swu-db.com/images/cards/IBH/001.png',
    frontArtLowRes: 'https://cdn.starwarsunlimited.com/ibh-echo-caverns.png',
    hyperspaceArt: null,
    hyperspaceArtHiRes: null,
    epicAction: '',
    aspects: ['Cunning'],
    rarity: 'Common',
  },
]

// swu-db.com response shaped to match the mockBases above
const mockSwuDbResponse = {
  total_cards: mockBases.length,
  data: mockBases.map(b => ({
    Set: b.set,
    Number: b.number,
    Name: b.name,
    Subtitle: b.subtitle,
    HP: String(b.hp),
    FrontArt: b.frontArt,
    FrontText: b.epicAction,
    Aspects: b.aspects,
    Rarity: b.rarity,
    VariantType: 'Normal',
  }))
}

// SWUDB deck response — base JTL-030 matches mockBases above
const mockSwudbDeckSuccess = {
  deckName: '[dmgCtrl test - Do Not Delete] Unlisted deck',
  base: {
    defaultExpansionAbbreviation: 'JTL',
    defaultCardNumber: '030',
  },
}

// Helper: the mode selector is the first combobox; slice past it to get
// [set-select, aspect-select, base-select].
const getBaseSelectors = () => screen.getAllByRole('combobox').slice(1)

beforeEach(() => {
  // swuapi.com no longer returns SOR/SHD/TWI bases (rotated out of Premier format).
  // All bases in this test come from the swu-db.com proxy; hyperspace art for SOR
  // is resolved via the static card-number offset map (+266) inside useBases.
  const swuApiResponse = {
    cards: [],
    pagination: { limit: 100, next_cursor: null },
  }

  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('swuapi.com')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(swuApiResponse) })
    }
    if (url.includes('/swudb/deck/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSwudbDeckSuccess) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSwuDbResponse) })
  }))

  vi.stubGlobal('localStorage', {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SwuSetupScreen', () => {

  // --- Rendering ---

  it('Renders the app title and mode selector', () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText('dmgCtrl')).toBeInTheDocument()
    expect(screen.getByText('Input Mode:')).toBeInTheDocument()
  })

  it('Renders the app icon alongside the title', () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByAltText('dmgCtrl')).toBeInTheDocument()
  })

  it('Shows three base selectors after loading', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
  })

  it('Renders Set and Aspect labels', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    expect(screen.getByText('Set', { selector: 'label' })).toBeInTheDocument()
    expect(screen.getByText('Aspect', { selector: 'label' })).toBeInTheDocument()
  })

  it('Set selector contains all available sets', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    const setSelect = getBaseSelectors()[0]
    const options = Array.from(setSelect.querySelectorAll('option'))
      .filter(o => !o.disabled)
      .map(o => o.value)
    expect(options).toContain('SOR')
    expect(options).toContain('JTL')
    expect(options).toContain('LAW')
    expect(options).toContain('IBH')
  })

  it('Aspect selector is disabled before set is selected', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    expect(getBaseSelectors()[1]).toBeDisabled()
  })

  it('Base selector is disabled before aspect is selected', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    expect(getBaseSelectors()[2]).toBeDisabled()
  })

  it('Submit button is disabled before base is selected', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    expect(screen.getByText('>')).toBeDisabled()
  })

  // --- Cascading selection ---

  it('Aspect selector enables after set is selected', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    expect(getBaseSelectors()[1]).not.toBeDisabled()
  })

  it('Aspect selector shows correct aspects for selected set', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    const aspectSelect = getBaseSelectors()[1]
    const options = Array.from(aspectSelect.querySelectorAll('option'))
      .filter(o => !o.disabled)
      .map(o => o.value)
    expect(options).toContain('Aggression')
    expect(options).toContain('Cunning')
    expect(options).not.toContain('Vigilance')
  })

  it('JTL aspect selector includes None for aspectless bases', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'JTL')
    const aspectSelect = getBaseSelectors()[1]
    const options = Array.from(aspectSelect.querySelectorAll('option'))
      .filter(o => !o.disabled)
      .map(o => o.value)
    expect(options).toContain('None')
  })

  it('Auto-selects aspect when only one option available', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'JTL')
    await waitFor(() => {
      expect((getBaseSelectors()[1] as HTMLSelectElement).value).toBe('None')
    })
  })

  it('Auto-selects base when only one option available', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'JTL')
    await waitFor(() => {
      expect((getBaseSelectors()[2] as HTMLSelectElement).value).toBe('JTL-030')
    })
  })

  it('Base selector enables after aspect is selected', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    expect(getBaseSelectors()[2]).not.toBeDisabled()
  })

  it('Base selector shows only bases matching set and aspect', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    const baseSelect = getBaseSelectors()[2]
    const options = Array.from(baseSelect.querySelectorAll('option'))
      .filter(o => !o.disabled)
      .map(o => o.value)
    expect(options).toContain('SOR-026')
    expect(options).not.toContain('SOR-022')
  })

  it('Changing set resets aspect and base selections', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[0], 'LAW')
    await waitFor(() => {
      expect((getBaseSelectors()[1] as HTMLSelectElement).value).toBe('Vigilance')
      expect((getBaseSelectors()[2] as HTMLSelectElement).value).toBe('LAW-021')
    })
  })

  it('Changing aspect resets base selection', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.selectOptions(getBaseSelectors()[1], 'Cunning')
    await waitFor(() => {
      expect((getBaseSelectors()[2] as HTMLSelectElement).value).toBe('SOR-022')
    })
  })

  // --- Submission ---

  it('Submit button enables after base is selected', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    expect(screen.getByText('>')).not.toBeDisabled()
  })

  it('Calls onConfirm with correct base when submitted', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      set: 'SOR',
      number: '026',
      name: 'Catacombs of Cadera',
      hp: 30,
    }), false)
  })

  it('Does not call onConfirm when no base selected', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.click(screen.getByText('>'))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Calls onConfirm with correct hp for non-default base', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Cunning')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-022')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ hp: 25 }), false)
  })

  it('Auto-selected base can be submitted without manual selection', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'JTL')
    await waitFor(() => expect(screen.getByText('>')).not.toBeDisabled())
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      set: 'JTL',
      number: '030',
    }), false)
  })

  // --- Base preview ---

  it('Shows base preview image after base is selected', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    expect(screen.getByAltText('Catacombs of Cadera')).toBeInTheDocument()
  })

  it('Does not show base preview before base is selected', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    // Only the title icon is present; no base preview image
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  // --- Base option format ---

  it('Base options show name and HP but not subtitle', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    const baseSelect = getBaseSelectors()[2]
    const option = Array.from(baseSelect.querySelectorAll('option')).find(o => o.value === 'SOR-026')
    expect(option?.textContent).toBe('Catacombs of Cadera — 30HP')
    expect(option?.textContent).not.toContain('Jedha')
  })

  // --- Portrait layout ---

  it('Shows portrait layout with title and selectors in portrait orientation', async () => {
    makeMatchMediaMock(true)
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText('dmgCtrl')).toBeInTheDocument()
    expect(screen.getByText('Input Mode:')).toBeInTheDocument()
  })

  it('Portrait base options also exclude subtitle', async () => {
    makeMatchMediaMock(true)
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Cunning')
    const baseSelect = getBaseSelectors()[2]
    const option = Array.from(baseSelect.querySelectorAll('option')).find(o => o.value === 'SOR-022')
    expect(option?.textContent).toBe('Energy Conversion Lab — 25HP')
    expect(option?.textContent).not.toContain('Eadu')
  })

  // --- Help button ---

  it('Renders a help button', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('Calls onHelp when help button is clicked', async () => {
    const user = userEvent.setup()
    const onHelp = vi.fn()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={onHelp} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.click(screen.getByText('?'))
    expect(onHelp).toHaveBeenCalledOnce()
  })

  // --- Mode selector ---

  it('Mode selector renders with Base Selector and Import from SWUDB options', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    const modeSelect = screen.getByTestId('mode-select') as HTMLSelectElement
    const options = Array.from(modeSelect.querySelectorAll('option')).map(o => o.textContent)
    expect(options).toContain('Base Selector')
    expect(options).toContain('SWUDB Import')
  })

  it('Mode selector defaults to Base Selector', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    const modeSelect = screen.getByTestId('mode-select') as HTMLSelectElement
    expect(modeSelect.value).toBe('base-selector')
  })

  it('Switching to SWUDB mode hides the base dropdowns', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(screen.getByTestId('mode-select'), 'swudb-import')
    expect(getBaseSelectors()).toHaveLength(0)
  })

  it('Switching to SWUDB mode shows the URL input', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(screen.getByTestId('mode-select'), 'swudb-import')
    expect(screen.getByPlaceholderText('Paste SWUDB link')).toBeInTheDocument()
  })

  it('Switching back to Base Selector restores the dropdowns', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(screen.getByTestId('mode-select'), 'swudb-import')
    await user.selectOptions(screen.getByTestId('mode-select'), 'base-selector')
    expect(getBaseSelectors()).toHaveLength(3)
  })

  it('Mode preference is saved to localStorage when changed', async () => {
    const setItemMock = vi.fn()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: setItemMock,
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(screen.getByTestId('mode-select'), 'swudb-import')
    expect(setItemMock).toHaveBeenCalledWith('pref_selection_mode', 'swudb-import')
  })

  it('Mode preference is restored from localStorage on mount', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockImplementation((key: string) => {
        if (key === 'pref_selection_mode') return 'swudb-import'
        return null
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(screen.getByPlaceholderText('Paste SWUDB link')).toBeInTheDocument())
    expect(getBaseSelectors()).toHaveLength(0)
  })

  // --- SWUDB import UI ---

  const switchToSwudbMode = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(screen.getByTestId('mode-select'), 'swudb-import')
  }

  const inputUrl = (input: HTMLElement, text: string) => {
    fireEvent.change(input, { target: { value: text } })
  }

  it('Load button renders in SWUDB mode and is initially disabled', async () => {
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    expect(screen.getByTestId('swudb-load-button')).toBeDisabled()
  })

  it('Entering a valid URL enables the Load button', async () => {
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/AbCdEf123456')
    expect(screen.getByTestId('swudb-load-button')).not.toBeDisabled()
  })

  it('Entering an invalid URL disables the Load button', async () => {
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://example.com/not-a-deck')
    expect(screen.getByTestId('swudb-load-button')).toBeDisabled()
  })

  it('Entering an invalid URL shows Invalid deck URL error', async () => {
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://example.com/not-a-deck')
    expect(screen.getByText('Invalid deck URL')).toBeInTheDocument()
  })

  it('Entering a valid edit URL auto-normalises and enables the Load button', async () => {
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/edit/AbCdEf123456')
    expect(screen.getByTestId('swudb-load-button')).not.toBeDisabled()
  })

  it('Entering a valid edit URL shows no error', async () => {
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/edit/AbCdEf123456')
    expect(screen.queryByText('Invalid deck URL')).not.toBeInTheDocument()
  })

  it('Clicking Load shows the deck name', async () => {
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(screen.getByTestId('swudb-load-button'))
    await waitFor(() => expect(screen.getByText('[dmgCtrl test - Do Not Delete] Unlisted deck')).toBeInTheDocument())
  })

  it('Clicking Load shows the submit button', async () => {
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(screen.getByTestId('swudb-load-button'))
    await waitFor(() => expect(screen.getByText('>')).toBeInTheDocument())
  })

  it('Load button shows ... while loading', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('/swudb/deck/')) return new Promise(() => {})
      if (url.includes('swuapi.com')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ cards: [], pagination: { limit: 100, next_cursor: null } }) } as any)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSwuDbResponse) } as any)
    })
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/ILRtEGjuCQY')
    user.click(screen.getByTestId('swudb-load-button'))
    await waitFor(() => expect(screen.getByTestId('swudb-load-button')).toHaveTextContent('...'))
  })

  it('Clicking Load on an inaccessible deck shows Deck not accessible', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('/swudb/deck/')) return Promise.resolve({ ok: false, status: 404 } as any)
      if (url.includes('swuapi.com')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ cards: [], pagination: { limit: 100, next_cursor: null } }) } as any)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSwuDbResponse) } as any)
    })
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(screen.getByTestId('swudb-load-button'))
    await waitFor(() => expect(screen.getByText('Deck not accessible')).toBeInTheDocument())
  })

  it('Clicking Load shows Base not recognised when base is not in database', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('/swudb/deck/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ deckName: 'Future Deck', base: { defaultExpansionAbbreviation: 'NEW', defaultCardNumber: '001' } }) } as any)
      if (url.includes('swuapi.com')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ cards: [], pagination: { limit: 100, next_cursor: null } }) } as any)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSwuDbResponse) } as any)
    })
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(screen.getByTestId('swudb-load-button'))
    await waitFor(() => expect(screen.getByText('Base not recognised')).toBeInTheDocument())
  })

  it('Deck name is still shown when base is not recognised', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('/swudb/deck/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ deckName: 'Future Deck', base: { defaultExpansionAbbreviation: 'NEW', defaultCardNumber: '001' } }) } as any)
      if (url.includes('swuapi.com')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ cards: [], pagination: { limit: 100, next_cursor: null } }) } as any)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSwuDbResponse) } as any)
    })
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(screen.getByTestId('swudb-load-button'))
    await waitFor(() => expect(screen.getByText('Future Deck')).toBeInTheDocument())
  })

  it('Submit button is disabled when base is not recognised', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = input.toString()
      if (url.includes('/swudb/deck/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ deckName: 'Future Deck', base: { defaultExpansionAbbreviation: 'NEW', defaultCardNumber: '001' } }) } as any)
      if (url.includes('swuapi.com')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ cards: [], pagination: { limit: 100, next_cursor: null } }) } as any)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSwuDbResponse) } as any)
    })
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(screen.getByTestId('swudb-load-button'))
    await waitFor(() => expect(screen.getByText('>')).toBeInTheDocument())
    expect(screen.getByText('>')).toBeDisabled()
  })

  it('Clicking > after successful load calls onConfirm with the correct base', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={onConfirm} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(screen.getByTestId('mode-select'), 'swudb-import')
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(screen.getByTestId('swudb-load-button'))
    await waitFor(() => expect(screen.getByText('>')).not.toBeDisabled())
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ set: 'JTL', number: '030' }), false)
  })

  it('Changing the URL after a load clears the deck name and submit button', async () => {
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/ILRtEGjuCQY')
    await user.click(screen.getByTestId('swudb-load-button'))
    await waitFor(() => expect(screen.getByText('[dmgCtrl test - Do Not Delete] Unlisted deck')).toBeInTheDocument())
    inputUrl(screen.getByPlaceholderText('Paste SWUDB link'), 'https://swudb.com/deck/ILRtEGjuCQYx')
    expect(screen.queryByText('[dmgCtrl test - Do Not Delete] Unlisted deck')).not.toBeInTheDocument()
    expect(screen.queryByText('>')).not.toBeInTheDocument()
  })

  it('Focusing the input after an error clears the error but keeps the text', async () => {
    const user = userEvent.setup()
    await switchToSwudbMode(user)
    const input = screen.getByPlaceholderText('Paste SWUDB link')
    inputUrl(input, 'not-valid')
    expect(screen.getByText('Invalid deck URL')).toBeInTheDocument()
    await user.click(input)
    expect(screen.queryByText('Invalid deck URL')).not.toBeInTheDocument()
    expect((input as HTMLInputElement).value).toBe('not-valid')
  })

  // --- Hyperspace (via settings) ---

  it('Hyperspace toggle never appears on the setup screen', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    fireEvent.load(screen.getByAltText('Catacombs of Cadera'))
    expect(screen.queryByLabelText('Hyperspace variant')).not.toBeInTheDocument()
  })

  it('Calls onConfirm with useHyperspace=true when user settings preference is true', async () => {
    mockUserSettings.useHyperspace = true
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ set: 'SOR', number: '026' }), true)
  })

  it('Calls onConfirm with useHyperspace=false when user settings preference is false', async () => {
    mockUserSettings.useHyperspace = false
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} onHelp={vi.fn()} />)
    await waitFor(() => expect(getBaseSelectors()).toHaveLength(3))
    await user.selectOptions(getBaseSelectors()[0], 'SOR')
    await user.selectOptions(getBaseSelectors()[1], 'Aggression')
    await user.selectOptions(getBaseSelectors()[2], 'SOR-026')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ set: 'SOR', number: '026' }), false)
  })

  // --- Settings button ---

  it('Settings button is not visible when FEATURE_USER_SETTINGS is false', () => {
    featureUserSettings.value = false
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} onSettings={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '⚙' })).not.toBeInTheDocument()
  })

  it('Settings button is visible when FEATURE_USER_SETTINGS is true', () => {
    featureUserSettings.value = true
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} onSettings={vi.fn()} />)
    expect(screen.getByRole('button', { name: '⚙' })).toBeInTheDocument()
    featureUserSettings.value = false
  })

  it('Settings button calls onSettings when clicked', async () => {
    featureUserSettings.value = true
    const user = userEvent.setup()
    const onSettings = vi.fn()
    render(<SwuSetupScreen onConfirm={vi.fn()} onHelp={vi.fn()} onSettings={onSettings} />)
    await user.click(screen.getByRole('button', { name: '⚙' }))
    expect(onSettings).toHaveBeenCalledOnce()
    featureUserSettings.value = false
  })

})