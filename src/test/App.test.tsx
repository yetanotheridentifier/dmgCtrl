import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { Base } from '../hooks/useBases'

const mockBases: Base[] = [
  {
    set: 'SOR',
    number: '026',
    name: 'Catacombs of Cadera',
    subtitle: 'Jedha',
    hp: 30,
    frontArt: 'https://cdn.swu-db.com/images/cards/SOR/026.png',
    hyperspaceArt: 'https://cdn.swu-db.com/images/cards/SOR/292.png',
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
]

const mockApiResponse = {
  total_cards: 2,
  data: mockBases.map(b => ({
    Set: b.set,
    Number: b.number,
    Name: b.name,
    Subtitle: b.subtitle,
    HP: String(b.hp),
    FrontArt: b.frontArt,
    HyperspaceArt: b.hyperspaceArt ?? null,
    FrontText: b.epicAction,
    Aspects: b.aspects,
    Rarity: b.rarity,
    VariantType: 'Normal',
  }))
}

beforeEach(() => {
  const swuApiCards = [
    {
      uuid: 'uuid-catacombs-standard',
      name: 'Catacombs of Cadera',
      set_code: 'SOR',
      variant_type: 'Standard',
      variant_of_uuid: null,
      front_image_url: 'https://cdn.starwarsunlimited.com/catacombs.png',
    },
    {
      uuid: 'uuid-catacombs-hyperspace',
      name: 'Catacombs of Cadera',
      set_code: 'SOR',
      variant_type: 'Hyperspace',
      variant_of_uuid: 'uuid-catacombs-standard',
      front_image_url: 'https://cdn.swu-db.com/images/cards/SOR/292.png',
    },
  ]

  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('swuapi.com')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ cards: swuApiCards }),
      })
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockApiResponse),
    })
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

describe('App', () => {

  it('Renders the setup screen on load', () => {
    render(<App />)
    expect(screen.getByText('Select Base')).toBeInTheDocument()
  })

  it('Does not render the game screen on load', () => {
    render(<App />)
    expect(screen.queryByText(/Remaining:/)).not.toBeInTheDocument()
  })

  it('Setup screen does not show game screen elements on load', () => {
    render(<App />)
    expect(screen.queryByText('+')).not.toBeInTheDocument()
    expect(screen.queryByText('−')).not.toBeInTheDocument()
  })

  it('Navigates to game screen after selecting a base', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-026')
    await user.click(screen.getByText('>'))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Game screen reflects the selected base health', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Cunning')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-022')
    await user.click(screen.getByText('>'))
    expect(screen.getByText('Remaining: 25')).toBeInTheDocument()
  })

  it('Does not navigate to game screen if no base is selected', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.click(screen.getByText('>'))
    expect(screen.getByText('Select Base')).toBeInTheDocument()
    expect(screen.queryByText(/Remaining:/)).not.toBeInTheDocument()
  })

  it('Clicking back from game screen returns to setup screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-026')
    await user.click(screen.getByText('>'))
    await user.click(screen.getByText('<'))
    expect(screen.getByText('Select Base')).toBeInTheDocument()
  })

  // --- Help navigation ---

  it('Help button is visible on setup screen', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('Clicking help on setup screen shows the help screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.click(screen.getByText('?'))
    expect(screen.getByText('Getting Started')).toBeInTheDocument()
  })

  it('Help button is visible on game screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-026')
    await user.click(screen.getByText('>'))
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('Clicking help on game screen shows the help screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-026')
    await user.click(screen.getByText('>'))
    await user.click(screen.getByText('?'))
    expect(screen.getByText('Getting Started')).toBeInTheDocument()
  })

  it('Clicking back from help returns to setup when help was opened from setup', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.click(screen.getByText('?'))
    await user.click(screen.getByRole('button', { name: '<' }))
    expect(screen.getByText('Select Base')).toBeInTheDocument()
  })

  it('Clicking back from help returns to game when help was opened from game', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-026')
    await user.click(screen.getByText('>'))
    await user.click(screen.getByText('?'))
    await user.click(screen.getByRole('button', { name: '<' }))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Passes hyperspace preference through to game screen', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockImplementation((key: string) => {
        if (key === 'pref_hyperspace') return 'true'
        return null
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
    render(<App />)
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'SOR')
    await user.selectOptions(screen.getAllByRole('combobox')[1], 'Aggression')
    await user.selectOptions(screen.getAllByRole('combobox')[2], 'SOR-026')
    await user.click(screen.getByText('>'))
    const img = screen.getByAltText('Catacombs of Cadera')
    expect(img).toHaveAttribute('src', 'https://cdn.swu-db.com/images/cards/SOR/292.png')
  })

})