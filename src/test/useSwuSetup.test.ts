import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSwuSetup, filterBases, baseKey, SWU_MODES } from '../hooks/useSwuSetup'
import { useBases, Base } from '../hooks/useBases'

vi.mock('../hooks/useBases')

function makeBase(set: string, number: string, name: string, aspects: string[], hp = 30): Base {
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
  }
}

const catacombs = makeBase('SOR', '026', 'Catacombs of Cadera', ['Aggression'])
const energyLab = makeBase('SOR', '022', 'Energy Conversion Lab', ['Cunning'], 25)
const jediTemple = makeBase('LOF', '021', 'Jedi Temple', ['Command'], 28)
const starlightTemple = makeBase('LOF', '024', 'Starlight Temple', ['Command'], 28)
const templeOfDestruction = makeBase('LOF', '028', 'Temple of Destruction', ['Aggression'], 25)
const lakeCountry = makeBase('JTL', '030', 'Lake Country', [])
const coaxium = makeBase('LAW', '021', 'Coaxium Mine', ['Vigilance'], 27)
const echo = makeBase('IBH', '001', 'Echo Caverns', ['Cunning'], 20)

const mockBases = [catacombs, energyLab, jediTemple, starlightTemple, templeOfDestruction, lakeCountry, coaxium, echo]

// A working store, so a second render reads what the first one saved, as a relaunch would.
let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  vi.mocked(useBases).mockReturnValue({ bases: mockBases, loading: false, error: null, retry: vi.fn() })
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { store.set(k, v) }),
    removeItem: vi.fn((k: string) => { store.delete(k) }),
    clear: vi.fn(() => store.clear()),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSwuSetup: your base', () => {
  it('has no base the first time', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.base).toBeNull()
  })

  it('chooseBase sets the base', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.chooseBase(jediTemple))
    expect(result.current.base).toBe(jediTemple)
  })

  it('keeps the base across launches', () => {
    const first = renderHook(() => useSwuSetup(vi.fn()))
    act(() => first.result.current.chooseBase(jediTemple))
    first.unmount()
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.base).toBe(jediTemple)
  })

  it('a kept base that is no longer in the card data reads as no base', () => {
    store.set('swu_setup', JSON.stringify({ baseKey: 'XYZ-999', recentBaseKeys: [], matchType: 'casual' }))
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.base).toBeNull()
  })

  it('survives unreadable stored setup', () => {
    store.set('swu_setup', '{not json')
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.base).toBeNull()
    expect(result.current.matchType).toBe('casual')
    expect(result.current.recentBases).toEqual([])
  })

  it('exposes every base, and the loading and error state of the card data', () => {
    vi.mocked(useBases).mockReturnValue({ bases: mockBases, loading: true, error: 'offline', retry: vi.fn() })
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.bases).toBe(mockBases)
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBe('offline')
  })
})

describe('useSwuSetup: match', () => {
  it('is Casual the first time', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.matchType).toBe('casual')
  })

  it('is kept across launches', () => {
    const first = renderHook(() => useSwuSetup(vi.fn()))
    act(() => first.result.current.setMatchType('tournament'))
    first.unmount()
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.matchType).toBe('tournament')
  })

  it.each(['tournament', 'bo1', 'bo3'])('reads the older stored match preference %s as Tournament', (saved) => {
    store.set('pref_play_mode', saved)
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.matchType).toBe('tournament')
  })
})

describe('useSwuSetup: starting', () => {
  it('handleSubmit calls onConfirm with the base and the match', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useSwuSetup(onConfirm))
    act(() => result.current.chooseBase(catacombs))
    act(() => result.current.setMatchType('tournament'))
    act(() => result.current.handleSubmit())
    expect(onConfirm).toHaveBeenCalledWith(catacombs, 'tournament')
  })

  it('handleSubmit does nothing without a base', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useSwuSetup(onConfirm))
    act(() => result.current.handleSubmit())
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('useSwuSetup: recent bases', () => {
  const play = (result: { current: ReturnType<typeof useSwuSetup> }, base: Base) => {
    act(() => result.current.chooseBase(base))
    act(() => result.current.handleSubmit())
  }

  it('lists bases played, most recent first, each once', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    play(result, catacombs)
    play(result, jediTemple)
    play(result, catacombs)
    expect(result.current.recentBases).toEqual([catacombs, jediTemple])
  })

  it('a base chosen but not played is not recent', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    act(() => result.current.chooseBase(catacombs))
    expect(result.current.recentBases).toEqual([])
  })

  it('keeps the last 6 played', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    for (const b of [catacombs, energyLab, jediTemple, starlightTemple, templeOfDestruction, lakeCountry, coaxium]) play(result, b)
    expect(result.current.recentBases).toEqual([coaxium, lakeCountry, templeOfDestruction, starlightTemple, jediTemple, energyLab])
  })

  it('are kept across launches', () => {
    const first = renderHook(() => useSwuSetup(vi.fn()))
    play(first.result, energyLab)
    play(first.result, jediTemple)
    first.unmount()
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.recentBases).toEqual([jediTemple, energyLab])
  })
})

describe('useSwuSetup: older stored preferences', () => {
  it('takes up the stored format as the tournament format, then drops the old key on the next save', () => {
    store.set('pref_format', 'eternal')
    store.set('pref_selection_mode', 'swudb-import')
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.format).toBe('eternal')
    act(() => result.current.chooseBase(catacombs))
    expect(store.has('pref_format')).toBe(false)
    expect(store.has('pref_selection_mode')).toBe(false)
    expect(JSON.parse(store.get('swu_setup')!).format).toBe('eternal')
  })

  it('an old Twin Suns format is not a tournament format: Premier instead', () => {
    store.set('pref_format', 'twin-suns')
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.format).toBe('premier')
  })
})

describe('useSwuSetup: tournament format', () => {
  it('is Premier the first time', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.format).toBe('premier')
  })

  it('is kept across launches', () => {
    const first = renderHook(() => useSwuSetup(vi.fn()))
    act(() => first.result.current.setFormat('limited'))
    first.unmount()
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.format).toBe('limited')
  })

  it('an unreadable stored format reads as Premier', () => {
    store.set('swu_setup', JSON.stringify({ recentBaseKeys: [], matchType: 'tournament', format: 'nonsense' }))
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.format).toBe('premier')
  })
})

describe('useSwuSetup: mode', () => {
  it('is 1 player the first time', () => {
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.mode).toBe('1p')
  })

  it('offers 1 player and 2 players', () => {
    expect(SWU_MODES.map(m => m.label)).toEqual(['1 player', '2 players'])
  })

  it('is kept across launches', () => {
    const first = renderHook(() => useSwuSetup(vi.fn()))
    act(() => first.result.current.setMode('2p'))
    first.unmount()
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.mode).toBe('2p')
  })

  it('an unreadable stored mode reads as 1 player', () => {
    store.set('swu_setup', JSON.stringify({ recentBaseKeys: [], matchType: 'casual', mode: 'nonsense' }))
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.mode).toBe('1p')
  })
})

describe('useSwuSetup: their base', () => {
  const twoPlayers = () => {
    const hook = renderHook(() => useSwuSetup(vi.fn()))
    act(() => hook.result.current.setMode('2p'))
    return hook
  }

  it('has no base for them the first time', () => {
    const { result } = twoPlayers()
    expect(result.current.theirBase).toBeNull()
  })

  it('chooseTheirBase sets their base, leaving yours as it was', () => {
    const { result } = twoPlayers()
    act(() => result.current.chooseBase(jediTemple))
    act(() => result.current.chooseTheirBase(catacombs))
    expect(result.current.theirBase).toBe(catacombs)
    expect(result.current.base).toBe(jediTemple)
  })

  it('is kept across launches', () => {
    const first = twoPlayers()
    act(() => first.result.current.chooseTheirBase(catacombs))
    first.unmount()
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.theirBase).toBe(catacombs)
  })

  it('is from the last game once a 2-player game is played with it, not before', () => {
    const { result } = twoPlayers()
    act(() => result.current.chooseBase(jediTemple))
    act(() => result.current.chooseTheirBase(catacombs))
    expect(result.current.theirBaseFromLastGame).toBe(false)
    act(() => result.current.handleSubmit())
    expect(result.current.theirBaseFromLastGame).toBe(true)
    act(() => result.current.chooseTheirBase(echo))
    expect(result.current.theirBaseFromLastGame).toBe(false)
  })

  it('is kept from the last 2-player game across launches', () => {
    const first = twoPlayers()
    act(() => first.result.current.chooseBase(jediTemple))
    act(() => first.result.current.chooseTheirBase(catacombs))
    act(() => first.result.current.handleSubmit())
    first.unmount()
    const { result } = renderHook(() => useSwuSetup(vi.fn()))
    expect(result.current.theirBase).toBe(catacombs)
    expect(result.current.theirBaseFromLastGame).toBe(true)
  })

  it('a 1-player game leaves their base as it was', () => {
    const { result } = twoPlayers()
    act(() => result.current.chooseBase(jediTemple))
    act(() => result.current.chooseTheirBase(catacombs))
    act(() => result.current.handleSubmit())
    act(() => result.current.setMode('1p'))
    act(() => result.current.handleSubmit())
    act(() => result.current.setMode('2p'))
    expect(result.current.theirBase).toBe(catacombs)
    expect(result.current.theirBaseFromLastGame).toBe(true)
  })

  it('does not enter the recent bases', () => {
    const { result } = twoPlayers()
    act(() => result.current.chooseBase(jediTemple))
    act(() => result.current.chooseTheirBase(catacombs))
    act(() => result.current.handleSubmit())
    expect(result.current.recentBases).toEqual([jediTemple])
  })
})

describe('useSwuSetup: starting with 2 players', () => {
  it('handleSubmit waits for their base', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useSwuSetup(onConfirm))
    act(() => result.current.setMode('2p'))
    act(() => result.current.chooseBase(jediTemple))
    act(() => result.current.handleSubmit())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.recentBases).toEqual([])
  })

  it('handleSubmit passes their base too', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useSwuSetup(onConfirm))
    act(() => result.current.setMode('2p'))
    act(() => result.current.chooseBase(jediTemple))
    act(() => result.current.chooseTheirBase(catacombs))
    act(() => result.current.handleSubmit())
    expect(onConfirm).toHaveBeenCalledWith(jediTemple, 'casual', catacombs)
  })

  it('in 1 player, a kept base for them is not passed', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useSwuSetup(onConfirm))
    act(() => result.current.chooseBase(jediTemple))
    act(() => result.current.chooseTheirBase(catacombs))
    act(() => result.current.handleSubmit())
    expect(onConfirm).toHaveBeenCalledWith(jediTemple, 'casual')
  })

  it('handleStartTournament waits for their base, then passes it', () => {
    const onStart = vi.fn()
    const settings = { format: 'premier' as const, playMode: 'bo3' as const, totalRounds: 5 }
    const { result } = renderHook(() => useSwuSetup(vi.fn(), onStart))
    act(() => result.current.setMode('2p'))
    act(() => result.current.chooseBase(jediTemple))
    act(() => result.current.handleStartTournament(settings))
    expect(onStart).not.toHaveBeenCalled()
    act(() => result.current.chooseTheirBase(catacombs))
    act(() => result.current.handleStartTournament(settings))
    expect(onStart).toHaveBeenCalledWith(jediTemple, settings, catacombs)
    expect(result.current.theirBaseFromLastGame).toBe(true)
  })
})

describe('baseKey', () => {
  it('is the set and the card number', () => {
    expect(baseKey(catacombs)).toBe('SOR-026')
  })
})

describe('filterBases', () => {
  const names = (bs: Base[]) => bs.map(b => b.name)

  it('with no search and no aspect lists every base, by name', () => {
    expect(names(filterBases(mockBases, '', null))).toEqual([
      'Catacombs of Cadera', 'Coaxium Mine', 'Echo Caverns', 'Energy Conversion Lab',
      'Jedi Temple', 'Lake Country', 'Starlight Temple', 'Temple of Destruction',
    ])
  })

  it('every set is listed, whatever its format', () => {
    expect(new Set(filterBases(mockBases, '', null).map(b => b.set))).toEqual(new Set(['SOR', 'LOF', 'JTL', 'LAW', 'IBH']))
  })

  it('searches by name, ignoring case and surrounding space', () => {
    expect(names(filterBases(mockBases, '  TEMPLE ', null))).toEqual(['Jedi Temple', 'Starlight Temple', 'Temple of Destruction'])
  })

  it('filters by aspect', () => {
    expect(names(filterBases(mockBases, '', 'Cunning'))).toEqual(['Echo Caverns', 'Energy Conversion Lab'])
  })

  it('combines the search and the aspect', () => {
    expect(names(filterBases(mockBases, 'temple', 'Command'))).toEqual(['Jedi Temple', 'Starlight Temple'])
  })

  it('finds an aspectless base by name', () => {
    expect(names(filterBases(mockBases, 'lake', null))).toEqual(['Lake Country'])
  })
})
