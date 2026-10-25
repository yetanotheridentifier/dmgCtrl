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

// Who is playing: you alone, or you and them with a base each. A new mode is one more entry here.
export type SwuMode = '1p' | '2p'
export const SWU_MODES: { value: SwuMode; label: string }[] = [
  { value: '1p', label: '1 player' },
  { value: '2p', label: '2 players' },
]

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
}

export const baseKey = (b: Base): string => `${b.set}-${b.number}`

const asTournamentFormat = (v: unknown): TournamentFormat | null =>
  TOURNAMENT_FORMATS.find(f => f === v) ?? null

const asMode = (v: unknown): SwuMode => SWU_MODES.find(m => m.value === v)?.value ?? '1p'

const asKey = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined

function legacyMatchType(): SetupMode {
  const saved = localStorage.getItem('pref_play_mode')
  return saved === 'tournament' || saved === 'bo1' || saved === 'bo3' ? 'tournament' : 'casual'
}

// Setup once kept the format on its own; it is taken up until the first save drops it.
const legacyFormat = (): TournamentFormat => asTournamentFormat(localStorage.getItem('pref_format')) ?? 'premier'

function load(): PersistedSetup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { recentBaseKeys: [], matchType: legacyMatchType(), format: legacyFormat(), mode: '1p' }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      baseKey: asKey(parsed.baseKey),
      recentBaseKeys: Array.isArray(parsed.recentBaseKeys) ? parsed.recentBaseKeys.filter((k): k is string => typeof k === 'string') : [],
      matchType: parsed.matchType === 'tournament' ? 'tournament' : 'casual',
      format: asTournamentFormat(parsed.format) ?? legacyFormat(),
      mode: asMode(parsed.mode),
      theirBaseKey: asKey(parsed.theirBaseKey),
      lastTheirBaseKey: asKey(parsed.lastTheirBaseKey),
    }
  } catch {
    return { recentBaseKeys: [], matchType: 'casual', format: 'premier', mode: '1p' }
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
  // Their base comes only in 2 players.
  onConfirm: (base: Base, mode: SetupMode, theirBase?: Base) => void,
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

  const theirBase = persisted.theirBaseKey ? byKey.get(persisted.theirBaseKey) ?? null : null
  const twoPlayers = persisted.mode === '2p'
  // Ready to play: your base, and theirs in 2 players.
  const ready = base !== null && (!twoPlayers || theirBase !== null)

  // A game or a tournament started: your base goes to the front of the recent bases, and in
  // 2 players their base is remembered as the one from the last game.
  const rememberPlayed = (b: Base) => {
    const key = baseKey(b)
    update({
      recentBaseKeys: [key, ...persisted.recentBaseKeys.filter(k => k !== key)].slice(0, RECENT_LIMIT),
      ...(twoPlayers ? { lastTheirBaseKey: persisted.theirBaseKey } : {}),
    })
  }

  const handleSubmit = () => {
    if (!ready) return
    rememberPlayed(base)
    if (twoPlayers && theirBase) onConfirm(base, persisted.matchType, theirBase)
    else onConfirm(base, persisted.matchType)
  }

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
    ready,
    handleSubmit,
    handleStartTournament,
  }
}
