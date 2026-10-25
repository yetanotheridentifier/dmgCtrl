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

interface PersistedSetup {
  // Your base rarely changes between games, so it is kept, across launches too.
  baseKey?: string
  // The last bases played (Go to game), most recent first.
  recentBaseKeys: string[]
  matchType: SetupMode
  // The format of the last tournament started, offered first next time.
  format: TournamentFormat
}

export const baseKey = (b: Base): string => `${b.set}-${b.number}`

const asTournamentFormat = (v: unknown): TournamentFormat | null =>
  TOURNAMENT_FORMATS.find(f => f === v) ?? null

function legacyMatchType(): SetupMode {
  const saved = localStorage.getItem('pref_play_mode')
  return saved === 'tournament' || saved === 'bo1' || saved === 'bo3' ? 'tournament' : 'casual'
}

// Setup once kept the format on its own; it is taken up until the first save drops it.
const legacyFormat = (): TournamentFormat => asTournamentFormat(localStorage.getItem('pref_format')) ?? 'premier'

function load(): PersistedSetup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { recentBaseKeys: [], matchType: legacyMatchType(), format: legacyFormat() }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      baseKey: typeof parsed.baseKey === 'string' ? parsed.baseKey : undefined,
      recentBaseKeys: Array.isArray(parsed.recentBaseKeys) ? parsed.recentBaseKeys.filter((k): k is string => typeof k === 'string') : [],
      matchType: parsed.matchType === 'tournament' ? 'tournament' : 'casual',
      format: asTournamentFormat(parsed.format) ?? legacyFormat(),
    }
  } catch {
    return { recentBaseKeys: [], matchType: 'casual', format: 'premier' }
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
  onConfirm: (base: Base, mode: SetupMode) => void,
  onStartTournament?: (base: Base, settings: TournamentSettings) => void,
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

  // A base played (a game or a tournament started) goes to the front of the recent bases.
  const rememberPlayed = (b: Base) => {
    const key = baseKey(b)
    update({ recentBaseKeys: [key, ...persisted.recentBaseKeys.filter(k => k !== key)].slice(0, RECENT_LIMIT) })
  }

  const handleSubmit = () => {
    if (!base) return
    rememberPlayed(base)
    onConfirm(base, persisted.matchType)
  }

  const handleStartTournament = (settings: TournamentSettings) => {
    if (!base) return
    rememberPlayed(base)
    onStartTournament?.(base, settings)
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
    handleSubmit,
    handleStartTournament,
  }
}
