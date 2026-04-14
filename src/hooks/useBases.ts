import { useState, useEffect } from 'react'

const PROXY_URL = 'https://swu-proxy.dmgctrl.workers.dev'
const CACHE_KEY = 'swu_bases_cache'
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

export interface Base {
  set: string
  number: string
  name: string
  subtitle: string
  hp: number
  frontArt: string
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

        // Fetch fresh
        const response = await fetch(
          `${PROXY_URL}/cards/search?q=type:base`
        )
        if (!response.ok) throw new Error('Failed to fetch bases')

        const json = await response.json()
        const normalisedBases = json.data
          .filter((card: Record<string, unknown>) => card.VariantType === 'Normal')
          .map(normaliseBase)
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