import { useState, useEffect } from 'react'

const PROXY_URL = 'https://swu-proxy.dmgctrl.workers.dev'
const CACHE_KEY = 'swu_bases_cache'
const CACHE_TTL = 24 * 60 * 60 * 1000

export interface Base {
  set: string
  number: string
  name: string
  subtitle: string
  hp: number
  frontArt: string
  hyperspaceArt?: string
  epicAction: string
  aspects: string[]
  rarity: string
}

interface CacheEntry {
  timestamp: number
  data: Base[]
}

function normaliseBase(raw: Record<string, unknown>): Base {
  return {
    set: raw.Set as string,
    number: raw.Number as string,
    name: raw.Name as string,
    subtitle: raw.Subtitle as string,
    hp: parseInt(raw.HP as string, 10),
    frontArt: raw.FrontArt as string,
    epicAction: (raw.FrontText as string) ?? '',
    aspects: raw.Aspects as string[],
    rarity: raw.Rarity as string,
  }
}

export function useBases() {
  const [bases, setBases] = useState<Base[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchBases() {
      try {
        // Check cache first
        const cached = localStorage.getItem(CACHE_KEY)
        if (cached) {
          const entry: CacheEntry = JSON.parse(cached)
          if (Date.now() - entry.timestamp < CACHE_TTL) {
            setBases(entry.data)
            setLoading(false)
            return
          }
        }

        // Fetch normal and hyperspace bases in parallel
        const [normalResponse, hyperspaceResponse] = await Promise.all([
          fetch(`${PROXY_URL}/cards/search?q=type:base`),
          fetch(`${PROXY_URL}/cards/search?q=type:base+variant:hyperspace`),
        ])

        if (!normalResponse.ok) throw new Error('Failed to fetch bases')

        const normalJson = await normalResponse.json()
        const hyperspaceJson = hyperspaceResponse.ok
          ? await hyperspaceResponse.json()
          : { data: [] }

        // Build a lookup map of hyperspace bases keyed by name+subtitle+set
        const hyperspaceMap = new Map<string, string>()
        for (const card of hyperspaceJson.data ?? []) {
          if (card.VariantType === 'Hyperspace') {
            const key = `${card.Name}|${card.Subtitle}|${card.Set}`
            hyperspaceMap.set(key, card.FrontArt as string)
          }
        }

        // Normalise normal bases and attach hyperspace art where available
        const normalisedBases = normalJson.data
          .filter((card: Record<string, unknown>) => card.VariantType === 'Normal')
          .map((card: Record<string, unknown>): Base => {
            const base = normaliseBase(card)
            const key = `${base.name}|${base.subtitle}|${base.set}`
            const hyperspaceArt = hyperspaceMap.get(key)
            if (hyperspaceArt) {
              base.hyperspaceArt = hyperspaceArt
            }
            return base
          })
          .sort((a: Base, b: Base) =>
            a.name.localeCompare(b.name) || a.set.localeCompare(b.set)
          )

        // Store in cache
        const entry: CacheEntry = {
          timestamp: Date.now(),
          data: normalisedBases,
        }
        localStorage.setItem(CACHE_KEY, JSON.stringify(entry))

        setBases(normalisedBases)
      } catch (err) {
        setError('Could not load bases. Please check your connection.')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchBases()
  }, [])

  return { bases, loading, error }
}