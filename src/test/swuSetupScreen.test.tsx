import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuSetupScreen from '../components/swuSetupScreen'
import { Base } from '../hooks/useBases'

const mockBases: Base[] = [
  {
    set: 'SOR',
    number: '026',
    name: 'Catacombs of Cadera',
    subtitle: 'Jedha',
    hp: 30,
    frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png',
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
    epicAction: '',
    aspects: ['Cunning'],
    rarity: 'Common',
  },
]

const mockApiResponse = {
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

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockApiResponse),
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

  it('Renders the Select Base heading', () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    expect(screen.getByText('Select Base')).toBeInTheDocument()
  })

  it('Shows loading state initially', () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    expect(screen.getByText('Loading bases...')).toBeInTheDocument()
  })

  it('Shows three selectors after loading', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
  })

  it('Renders Set and Aspect labels', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    expect(screen.getByText('Set', { selector: 'label' })).toBeInTheDocument()
    expect(screen.getByText('Aspect', { selector: 'label' })).toBeInTheDocument()
  })

  it('Set selector contains all available sets', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    const setSelect = screen.getAllByRole('combobox')[0]
    const options = Array.from(setSelect.querySelectorAll('option'))
      .filter(o => !o.disabled)
      .map(o => o.value)
    expect(options).toContain('SOR')
    expect(options).toContain('JTL')
    expect(options).toContain('LAW')
    expect(options).toContain('IBH')
  })

  it('Aspect selector is disabled before set is selected', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    expect(screen.getAllByRole('combobox')[1]).toBeDisabled()
  })

  it('Base selector is disabled before aspect is selected', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    expect(screen.getAllByRole('combobox')[2]).toBeDisabled()
  })

  it('Submit button is disabled before base is selected', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    expect(screen.getByText('>')).toBeDisabled()
  })

  // --- Cascading selection ---

  it('Aspect selector enables after set is selected', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    expect(screen.getAllByRole('combobox')[1]).not.toBeDisabled()
  })

  it('Aspect selector shows correct aspects for selected set', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    const aspectSelect = screen.getAllByRole('combobox')[1]
    const options = Array.from(aspectSelect.querySelectorAll('option'))
      .filter(o => !o.disabled)
      .map(o => o.value)
    expect(options).toContain('Aggression')
    expect(options).toContain('Cunning')
    expect(options).not.toContain('Vigilance')
  })

  it('JTL aspect selector includes None for aspectless bases', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'JTL')
    const aspectSelect = screen.getAllByRole('combobox')[1]
    const options = Array.from(aspectSelect.querySelectorAll('option'))
      .filter(o => !o.disabled)
      .map(o => o.value)
    expect(options).toContain('None')
  })

  it('Auto-selects aspect when only one option available', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'JTL')
    await waitFor(() => {
      expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('None')
    })
  })

  it('Auto-selects base when only one option available', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'JTL')
    await waitFor(() => {
      expect((screen.getAllByRole('combobox')[2] as HTMLSelectElement).value).toBe('JTL-030')
    })
  })

  it('Base selector enables after aspect is selected', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    expect(screen.getAllByRole('combobox')[2]).not.toBeDisabled()
  })

  it('Base selector shows only bases matching set and aspect', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    const baseSelect = screen.getAllByRole('combobox')[2]
    const options = Array.from(baseSelect.querySelectorAll('option'))
      .filter(o => !o.disabled)
      .map(o => o.value)
    expect(options).toContain('SOR-026')
    expect(options).not.toContain('SOR-022')
  })

  it('Changing set resets aspect and base selections', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'LAW')
    // LAW has only one aspect (Vigilance) and one base (LAW-021) so both auto-select
    await waitFor(() => {
      expect((screen.getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('Vigilance')
      expect((screen.getAllByRole('combobox')[2] as HTMLSelectElement).value).toBe('LAW-021')
    })
  })

  it('Changing aspect resets base selection', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-026')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Cunning')
    // SOR Cunning only has one base so it auto-selects
    await waitFor(() => {
      expect((screen.getAllByRole('combobox')[2] as HTMLSelectElement).value).toBe('SOR-022')
    })
  })

  // --- Submission ---

  it('Submit button enables after base is selected', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-026')
    expect(screen.getByText('>')).not.toBeDisabled()
  })

  it('Calls onConfirm with correct base when submitted', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-026')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      set: 'SOR',
      number: '026',
      name: 'Catacombs of Cadera',
      hp: 30,
    }))
  })

  it('Does not call onConfirm when no base selected', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.click(screen.getByText('>'))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Calls onConfirm with correct hp for non-default base', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Cunning')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-022')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ hp: 25 }))
  })

  it('Auto-selected base can be submitted without manual selection', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'JTL')
    await waitFor(() => expect(screen.getByText('>')).not.toBeDisabled())
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      set: 'JTL',
      number: '030',
    }))
  })

  // --- Base preview ---

  it('Shows base preview image after base is selected', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-026')
    expect(screen.getByAltText('Catacombs of Cadera')).toBeInTheDocument()
  })

  it('Shows fallback text when base image fails to load', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'LAW')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Vigilance')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'LAW-021')
    const img = screen.getByAltText('Coaxium Mine')
    img.dispatchEvent(new Event('error'))
    await waitFor(() => expect(screen.getByText('Coaxium Mine — Kessel')).toBeInTheDocument())
  })

  it('Shows epic action in fallback when image fails', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'LAW')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Vigilance')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'LAW-021')
    const img = screen.getByAltText('Coaxium Mine')
    img.dispatchEvent(new Event('error'))
    await waitFor(() => expect(screen.getByText(mockBases[3].epicAction)).toBeInTheDocument())
  })

  it('Does not show base preview before base is selected', async () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

})