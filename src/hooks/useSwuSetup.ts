import { useState, useMemo } from 'react'
import { useBases, Base } from './useBases'
import { SetupMode } from '../utils/playMode'

const STORAGE_KEY = 'swu_setup'
const RECENT_LIMIT = 6

// Older preferences that setup no longer reads: dropped on the next save.
const RETIRED_KEYS = ['pref_format', 'pref_selection_mode', 'pref_play_mode']

interface PersistedSetup {
  // Your base rarely changes between games, so it is kept, across launches too.
  baseKey?: string
  // The last bases played (Go to game), most recent first.
  recentBaseKeys: string[]
  matchType: SetupMode
}

export const baseKey = (b: Base): string => `${b.set}-${b.number}`

function legacyMatchType(): SetupMode {
  const saved = localStorage.getItem('pref_play_mode')
  return saved === 'tournament' || saved === 'bo1' || saved === 'bo3' ? 'tournament' : 'casual'
}

function load(): PersistedSetup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { recentBaseKeys: [], matchType: legacyMatchType() }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      baseKey: typeof parsed.baseKey === 'string' ? parsed.baseKey : undefined,
      recentBaseKeys: Array.isArray(parsed.recentBaseKeys) ? parsed.recentBaseKeys.filter((k): k is string => typeof k === 'string') : [],
      matchType: parsed.matchType === 'tournament' ? 'tournament' : 'casual',
    }
  } catch {
    return { recentBaseKeys: [], matchType: 'casual' }
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

export function useSwuSetup(onConfirm: (base: Base, mode: SetupMode) => void) {
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

  const handleSubmit = () => {
    if (!base) return
    const key = baseKey(base)
    update({ recentBaseKeys: [key, ...persisted.recentBaseKeys.filter(k => k !== key)].slice(0, RECENT_LIMIT) })
    onConfirm(base, persisted.matchType)
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
    handleSubmit,
  }
}
