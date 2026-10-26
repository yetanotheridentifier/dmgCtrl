import { useState, useMemo } from 'react'
import { useBases, Base } from './useBases'
import { SetupMode } from '../utils/playMode'
import type { Format } from '../utils/formatFilter'

const STORAGE_KEY = 'swu_setup'
const RECENT_LIMIT = 6

// Older preferences that setup no longer reads: dropped on the next save.
const RETIRED_KEYS = ['pref_format', 'pref_selection_mode', 'pref_play_mode']

// The formats a tournament is started in, on the start sheet.
export type TournamentFormat = Extract<Format, 'premier' | 'eternal' | 'limited'>
export const TOURNAMENT_FORMATS: TournamentFormat[] = ['premier', 'eternal', 'limited']

// What the start sheet settles, fixed once round 1 starts.
export interface TournamentSettings {
  format: TournamentFormat
  playMode: 'bo1' | 'bo3'
  totalRounds: number
}

// Who is playing: you alone, you and them with a base each, or Twin Suns, with up to three opponents
// seated round the table. A new mode is one more entry here.
export type SwuMode = '1p' | '2p' | 'twin-suns'
export const SWU_MODES: { value: SwuMode; label: string }[] = [
  { value: '1p', label: '1 player' },
  { value: '2p', label: '2 players' },
  { value: 'twin-suns', label: 'Twin Suns' },
]

// Twin Suns seats: the cells of the 2x2 grid after yours (top left), in reading order. A base keeps
// its seat once placed, so the grid is where each opponent sits.
export const TWIN_SUNS_SEATS = ['top right', 'bottom left', 'bottom right'] as const
// Your base and at least two opponents'.
export const TWIN_SUNS_MIN_OPPONENTS = 2
const NO_SEATS: (string | null)[] = TWIN_SUNS_SEATS.map(() => null)

interface PersistedSetup {
  // Your base rarely changes between games, so it is kept, across launches too.
  baseKey?: string
  // The last bases played (Go to game), most recent first. Yours only: their base never enters it.
  recentBaseKeys: string[]
  matchType: SetupMode
  // The format of the last tournament started, offered first next time.
  format: TournamentFormat
  mode: SwuMode
  // Their base in 2 players, kept like yours.
  theirBaseKey?: string
  // Their base in the last 2-player game, so setup can say their base is the same as then.
  lastTheirBaseKey?: string
  // Twin Suns opponents' bases by seat (TWIN_SUNS_SEATS), null for an empty seat. Kept like yours.
  seatKeys: (string | null)[]
  // Bases played for other players (their base, opponents' bases), most recent first.
  otherRecentBaseKeys: string[]
}

export const baseKey = (b: Base): string => `${b.set}-${b.number}`

const asTournamentFormat = (v: unknown): TournamentFormat | null =>
  TOURNAMENT_FORMATS.find(f => f === v) ?? null

const asMode = (v: unknown): SwuMode => SWU_MODES.find(m => m.value === v)?.value ?? '1p'

const asKey = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined

const asKeys = (v: unknown): string[] => Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []

const asSeatKeys = (v: unknown): (string | null)[] =>
  Array.isArray(v) ? NO_SEATS.map((_, i) => asKey(v[i]) ?? null) : NO_SEATS

const FRESH = { recentBaseKeys: [], seatKeys: NO_SEATS, otherRecentBaseKeys: [] }

function legacyMatchType(): SetupMode {
  const saved = localStorage.getItem('pref_play_mode')
  return saved === 'tournament' || saved === 'bo1' || saved === 'bo3' ? 'tournament' : 'casual'
}

// Setup once kept the format on its own; it is taken up until the first save drops it.
const legacyFormat = (): TournamentFormat => asTournamentFormat(localStorage.getItem('pref_format')) ?? 'premier'

function load(): PersistedSetup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...FRESH, matchType: legacyMatchType(), format: legacyFormat(), mode: '1p' }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      baseKey: asKey(parsed.baseKey),
      recentBaseKeys: asKeys(parsed.recentBaseKeys),
      matchType: parsed.matchType === 'tournament' ? 'tournament' : 'casual',
      format: asTournamentFormat(parsed.format) ?? legacyFormat(),
      mode: asMode(parsed.mode),
      theirBaseKey: asKey(parsed.theirBaseKey),
      lastTheirBaseKey: asKey(parsed.lastTheirBaseKey),
      seatKeys: asSeatKeys(parsed.seatKeys),
      otherRecentBaseKeys: asKeys(parsed.otherRecentBaseKeys),
    }
  } catch {
    return { ...FRESH, matchType: 'casual', format: 'premier', mode: '1p' }
  }
}

function save(setup: PersistedSetup): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(setup))
  RETIRED_KEYS.forEach(k => localStorage.removeItem(k))
}

// The base sheet's search: by name (ignoring case) and by one aspect, over every base, sorted by name.
export function filterBases(bases: Base[], query: string, aspect: string | null): Base[] {
  const q = query.trim().toLowerCase()
  return bases
    .filter(b => (q === '' || b.name.toLowerCase().includes(q)) && (aspect === null || b.aspects.includes(aspect)))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function useSwuSetup(
  // Their base comes only in 2 players; the seats, by TWIN_SUNS_SEATS, only in Twin Suns.
  onConfirm: (base: Base, mode: SetupMode, theirBase?: Base, seats?: (Base | null)[]) => void,
  onStartTournament?: (base: Base, settings: TournamentSettings, theirBase?: Base) => void,
) {
  const { bases, loading, error } = useBases()
  const [persisted, setPersisted] = useState<PersistedSetup>(load)

  const update = (patch: Partial<PersistedSetup>) => {
    setPersisted(prev => {
      const next = { ...prev, ...patch }
      save(next)
      return next
    })
  }

  const byKey = useMemo(() => new Map(bases.map(b => [baseKey(b), b])), [bases])

  // A kept base missing from the card data reads as no base, so the player chooses again.
  const base = persisted.baseKey ? byKey.get(persisted.baseKey) ?? null : null

  const recentBases = useMemo(
    () => persisted.recentBaseKeys.map(k => byKey.get(k)).filter((b): b is Base => b !== undefined),
    [persisted.recentBaseKeys, byKey],
  )

  const otherPlayersBases = useMemo(
    () => persisted.otherRecentBaseKeys.map(k => byKey.get(k)).filter((b): b is Base => b !== undefined),
    [persisted.otherRecentBaseKeys, byKey],
  )

  const theirBase = persisted.theirBaseKey ? byKey.get(persisted.theirBaseKey) ?? null : null
  const twoPlayers = persisted.mode === '2p'
  const twinSuns = persisted.mode === 'twin-suns'
  // A seat whose base is missing from the card data reads as empty.
  const seats = useMemo(
    () => persisted.seatKeys.map(k => (k ? byKey.get(k) ?? null : null)),
    [persisted.seatKeys, byKey],
  )
  const opponents = seats.filter((b): b is Base => b !== null)
  // Ready to play: your base, and theirs in 2 players, or at least two opponents' in Twin Suns.
  const ready = base !== null
    && (!twoPlayers || theirBase !== null)
    && (!twinSuns || opponents.length >= TWIN_SUNS_MIN_OPPONENTS)

  // A game or a tournament started: your base goes to the front of your recent bases, and the
  // other players' to the front of theirs. In 2 players their base is remembered as the one from
  // the last game.
  const rememberPlayed = (b: Base) => {
    const key = baseKey(b)
    const others = (twoPlayers && theirBase ? [theirBase] : twinSuns ? opponents : []).map(baseKey)
    update({
      recentBaseKeys: [key, ...persisted.recentBaseKeys.filter(k => k !== key)].slice(0, RECENT_LIMIT),
      otherRecentBaseKeys: [...new Set([...others, ...persisted.otherRecentBaseKeys])].slice(0, RECENT_LIMIT),
      ...(twoPlayers ? { lastTheirBaseKey: persisted.theirBaseKey } : {}),
    })
  }

  const handleSubmit = () => {
    if (!ready) return
    rememberPlayed(base)
    if (twoPlayers && theirBase) onConfirm(base, persisted.matchType, theirBase)
    else if (twinSuns) onConfirm(base, persisted.matchType, undefined, seats)
    else onConfirm(base, persisted.matchType)
  }

  const setSeat = (seat: number, key: string | null) =>
    update({ seatKeys: persisted.seatKeys.map((k, i) => (i === seat ? key : k)) })

  const handleStartTournament = (settings: TournamentSettings) => {
    if (!ready) return
    rememberPlayed(base)
    if (twoPlayers && theirBase) onStartTournament?.(base, settings, theirBase)
    else onStartTournament?.(base, settings)
  }

  return {
    loading,
    error,
    bases,
    base,
    chooseBase: (b: Base) => update({ baseKey: baseKey(b) }),
    recentBases,
    matchType: persisted.matchType,
    setMatchType: (m: SetupMode) => update({ matchType: m }),
    format: persisted.format,
    setFormat: (f: TournamentFormat) => update({ format: f }),
    mode: persisted.mode,
    setMode: (m: SwuMode) => update({ mode: m }),
    theirBase,
    chooseTheirBase: (b: Base) => update({ theirBaseKey: baseKey(b) }),
    theirBaseFromLastGame: theirBase !== null && persisted.theirBaseKey === persisted.lastTheirBaseKey,
    seats,
    chooseSeatBase: (seat: number, b: Base) => setSeat(seat, baseKey(b)),
    removeSeatBase: (seat: number) => setSeat(seat, null),
    otherPlayersBases,
    ready,
    handleSubmit,
    handleStartTournament,
  }
}
