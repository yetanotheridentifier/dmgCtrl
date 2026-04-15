import { useState, useEffect } from 'react'

const PROXY_URL = 'https://swu-proxy.dmgctrl.workers.dev'
const SWUAPI_URL = 'https://api.swuapi.com'
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

interface SwuApiCard {
  uuid: string
  name: string
  set_code: string
  variant_type: string
  variant_of_uuid: string | null
  front_image_url: string
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

        // Fetch swu-db.com (card text, epic action, subtitle) and
        // swuapi.com (hyperspace image URLs) in parallel
        const [swuDbResponse, swuApiResponse] = await Promise.all([
          fetch(`${PROXY_URL}/cards/search?q=type:base`),
          fetch(`${SWUAPI_URL}/cards?type=Base&variant=all`),
        ])

        if (!swuDbResponse.ok) throw new Error('Failed to fetch bases')

        const swuDbJson = await swuDbResponse.json()
        const swuApiJson = swuApiResponse.ok
          ? await swuApiResponse.json()
          : { cards: [] }

        const swuApiCards: SwuApiCard[] = swuApiJson.cards ?? []

        // Build uuid lookup for Standard cards: "name|set_code" → uuid
        const standardUuidMap = new Map<string, string>()
        for (const card of swuApiCards) {
          if (card.variant_type === 'Standard') {
            const key = `${card.name}|${card.set_code}`
            standardUuidMap.set(key, card.uuid)
          }
        }

        // Build hyperspace lookup: variant_of_uuid → front_image_url
        const hyperspaceMap = new Map<string, string>()
        for (const card of swuApiCards) {
          if (card.variant_type === 'Hyperspace' && card.variant_of_uuid) {
            hyperspaceMap.set(card.variant_of_uuid, card.front_image_url)
          }
        }

        // Normalise swu-db.com bases and attach hyperspace art
        const normalisedBases = swuDbJson.data
          .filter((card: Record<string, unknown>) => card.VariantType === 'Normal')
          .map((card: Record<string, unknown>): Base => {
            const base = normaliseBase(card)
            const lookupKey = `${base.name}|${base.set}`
            const standardUuid = standardUuidMap.get(lookupKey)
            if (standardUuid) {
              const hyperspaceArt = hyperspaceMap.get(standardUuid)
              if (hyperspaceArt) {
                base.hyperspaceArt = hyperspaceArt
              }
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