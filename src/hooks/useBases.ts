import { useState, useEffect } from 'react'

const PROXY_URL = 'https://swu-proxy.dmgctrl.workers.dev'
const SWUAPI_URL = 'https://api.swuapi.com'
const SWU_DB_CDN = 'https://cdn.swu-db.com/images/cards'
const CACHE_KEY = 'swu_bases_cache'
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000

export interface Base {
  set: string
  number: string
  name: string
  subtitle: string
  hp: number
  frontArt: string | null
  frontArtLowRes: string | null
  hyperspaceArtHiRes: string | null
  hyperspaceArt: string | null
  epicAction: string
  aspects: string[]
  rarity: string
}

interface CacheEntry {
  lastChecked: number
  data: Base[]
}

// ---------------------------------------------------------------------------
// Static hyperspace card number map for sets no longer in swuapi.com
// (SOR, SHD, TWI rotated out of Premier format but remain valid in other formats)
//
// Each set uses a different offset — verified against cdn.swu-db.com:
//   SOR: standard + 266  (019→285 … 030→296)
//   SHD: standard + 278  (019→297 … 026→304)
//   TWI: standard + 275  (019→294 … 027→303), then 029→518, 030→519
// ---------------------------------------------------------------------------
const STATIC_HYPERSPACE_SETS: Record<string, { number: string; name: string; hyperspaceNumber: string }[]> = {
  SOR: [
    { number: '019', name: 'Security Complex',       hyperspaceNumber: '285' },
    { number: '020', name: 'Capital City',            hyperspaceNumber: '286' },
    { number: '021', name: 'Dagobah Swamp',           hyperspaceNumber: '287' },
    { number: '022', name: 'Energy Conversion Lab',   hyperspaceNumber: '288' },
    { number: '023', name: 'Command Center',          hyperspaceNumber: '289' },
    { number: '024', name: 'Echo Base',               hyperspaceNumber: '290' },
    { number: '025', name: 'Tarkintown',              hyperspaceNumber: '291' },
    { number: '026', name: 'Catacombs of Cadera',     hyperspaceNumber: '292' },
    { number: '027', name: 'Kestro City',             hyperspaceNumber: '293' },
    { number: '028', name: 'Jedha City',              hyperspaceNumber: '294' },
    { number: '029', name: "Administrator's Tower",   hyperspaceNumber: '295' },
    { number: '030', name: 'Chopper Base',            hyperspaceNumber: '296' },
  ],
  SHD: [
    { number: '019', name: 'Remnant Science Facility', hyperspaceNumber: '297' },
    { number: '020', name: 'Remote Village',            hyperspaceNumber: '298' },
    { number: '021', name: "Maz Kanata's Castle",       hyperspaceNumber: '299' },
    { number: '022', name: 'Nevarro City',              hyperspaceNumber: '300' },
    { number: '023', name: 'Death Watch Hideout',       hyperspaceNumber: '301' },
    { number: '024', name: 'Spice Mines',               hyperspaceNumber: '302' },
    { number: '025', name: 'Coronet City',              hyperspaceNumber: '303' },
    { number: '026', name: "Jabba's Palace",            hyperspaceNumber: '304' },
  ],
  TWI: [
    { number: '019', name: 'Pau City',                hyperspaceNumber: '294' },
    { number: '020', name: 'Sundari',                 hyperspaceNumber: '295' },
    { number: '021', name: 'The Crystal City',        hyperspaceNumber: '296' },
    { number: '022', name: 'Droid Manufactory',       hyperspaceNumber: '297' },
    { number: '023', name: 'Lair of Grievous',        hyperspaceNumber: '298' },
    { number: '024', name: 'Tipoca City',             hyperspaceNumber: '299' },
    { number: '025', name: 'Shadow Collective Camp',  hyperspaceNumber: '300' },
    { number: '026', name: 'KCM Mining Facility',     hyperspaceNumber: '301' },
    { number: '027', name: 'The Nest',                hyperspaceNumber: '302' },
    { number: '028', name: 'Petranaki Arena',         hyperspaceNumber: '303' },
    { number: '029', name: 'Level 1313',              hyperspaceNumber: '518' },
    { number: '030', name: 'Pyke Palace',             hyperspaceNumber: '519' },
  ],
}

function buildStaticHyperspaceMap(): Map<string, string> {
  const map = new Map<string, string>()
  for (const [setCode, cards] of Object.entries(STATIC_HYPERSPACE_SETS)) {
    for (const card of cards) {
      map.set(`${card.name}|${setCode}`, `${SWU_DB_CDN}/${setCode}/${card.hyperspaceNumber}.png`)
    }
  }
  return map
}

interface SwuApiCard {
  uuid: string
  name: string
  subtitle?: string | null
  set_code: string
  card_number: number
  hp: number
  aspects: string[]
  rarity: string
  variant_type: string
  variant_of_uuid: string | null
  front_image_url: string
  epic_action?: string | null
}

interface SwuApiResponse {
  cards: SwuApiCard[]
  pagination: { limit: number; next_cursor: string | null }
}

async function fetchAllSwuApiCards(): Promise<SwuApiCard[]> {
  const allCards: SwuApiCard[] = []
  let cursor: string | null = null

  do {
    const url = cursor
      ? `${SWUAPI_URL}/cards?type=Base&variant=all&limit=100&after=${cursor}`
      : `${SWUAPI_URL}/cards?type=Base&variant=all&limit=100`

    const res = await fetch(url)
    if (!res.ok) throw new Error(`swuapi.com fetch failed: ${res.status}`)
    const json: SwuApiResponse = await res.json()
    allCards.push(...json.cards)
    cursor = json.pagination?.next_cursor ?? null
  } while (cursor)

  return allCards
}

export function useBases() {
  const [bases, setBases] = useState<Base[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchBases() {
      // Check cache first
      const cached = localStorage.getItem(CACHE_KEY)
      let staleCache: Base[] | null = null

      if (cached) {
        const entry: CacheEntry = JSON.parse(cached)
        if (Date.now() - entry.lastChecked < CACHE_TTL) {
          setBases(entry.data)
          setLoading(false)
          return
        }
        staleCache = entry.data
      }

      try {
        // Fetch both sources in parallel (swuapi.com needs pagination)
        const [swuDbResponse, swuApiCards] = await Promise.all([
          fetch(`${PROXY_URL}/cards/search?q=type:base`),
          fetchAllSwuApiCards(),
        ])

        if (!swuDbResponse.ok) throw new Error('swu-db proxy fetch failed')

        const swuDbJson = await swuDbResponse.json()
        const swuDbCards: Record<string, string>[] = swuDbJson.data.filter(
          (c: Record<string, unknown>) => c.VariantType === 'Normal'
        )

        const staticHyperspaceMap = buildStaticHyperspaceMap()

        // Split swuapi cards into standard and hyperspace.
        // Deduplicate standard cards by set_code+card_number — the API occasionally
        // returns multiple Standard entries for the same collector number (e.g. showcase
        // reprints). Keep only the first occurrence.
        const _swuApiStandardAll = swuApiCards.filter(c => c.variant_type === 'Standard')
        const _standardSeen = new Set<string>()
        const swuApiStandard = _swuApiStandardAll.filter(c => {
          const key = `${c.set_code}|${c.card_number}`
          if (_standardSeen.has(key)) return false
          _standardSeen.add(key)
          return true
        })
        const swuApiHyperspace = swuApiCards.filter(c => c.variant_type === 'Hyperspace')

        // Build lookup maps
        const swuDbByNameSet = new Map(swuDbCards.map(c => [`${c.Name}|${c.Set}`, c]))
        const swuApiHyperspaceByParentUuid = new Map(
          swuApiHyperspace
            .filter(c => c.variant_of_uuid)
            .map(c => [c.variant_of_uuid!, c])
        )

        const mergedBases: Base[] = []
        const swuApiSetCodes = new Set(swuApiStandard.map(c => c.set_code))

        // --- swuapi-sourced bases ---
        for (const standard of swuApiStandard) {
          const key = `${standard.name}|${standard.set_code}`
          const swuDbMatch = swuDbByNameSet.get(key)
          const hyperspaceCard = swuApiHyperspaceByParentUuid.get(standard.uuid)

          const cardNumber = String(standard.card_number).padStart(3, '0')
          const hyperspaceNumber = hyperspaceCard
            ? String(hyperspaceCard.card_number).padStart(3, '0')
            : null

          mergedBases.push({
            set: standard.set_code,
            number: cardNumber,
            name: standard.name,
            subtitle: swuDbMatch?.Subtitle ?? standard.subtitle ?? '',
            hp: standard.hp,
            aspects: standard.aspects ?? swuDbMatch?.Aspects ?? [],
            rarity: standard.rarity ?? swuDbMatch?.Rarity ?? '',
            epicAction: swuDbMatch?.FrontText ?? standard.epic_action ?? '',
            frontArt: swuDbMatch
              ? `${SWU_DB_CDN}/${standard.set_code}/${cardNumber}.png`
              : null,
            frontArtLowRes: standard.front_image_url,
            hyperspaceArtHiRes: hyperspaceNumber
              ? `${SWU_DB_CDN}/${standard.set_code}/${hyperspaceNumber}.png`
              : null,
            hyperspaceArt: hyperspaceCard?.front_image_url ?? null,
          })
        }

        // --- swu-db-only bases (SOR, SHD, TWI) not present in swuapi.com ---
        for (const card of swuDbCards) {
          if (swuApiSetCodes.has(card.Set)) continue

          const key = `${card.Name}|${card.Set}`
          mergedBases.push({
            set: card.Set,
            number: card.Number,
            name: card.Name,
            subtitle: card.Subtitle ?? '',
            hp: parseInt(card.HP, 10),
            aspects: (card.Aspects as unknown as string[]) ?? [],
            rarity: card.Rarity ?? '',
            epicAction: card.FrontText ?? '',
            frontArt: card.FrontArt,
            frontArtLowRes: null,
            hyperspaceArtHiRes: staticHyperspaceMap.get(key) ?? null,
            hyperspaceArt: null,
          })
        }

        mergedBases.sort((a, b) => a.name.localeCompare(b.name) || a.set.localeCompare(b.set))

        const entry: CacheEntry = { lastChecked: Date.now(), data: mergedBases }
        localStorage.setItem(CACHE_KEY, JSON.stringify(entry))

        setBases(mergedBases)
      } catch (err) {
        console.error(err)
        if (staleCache) {
          // Serve stale data rather than an error when a cache exists
          setBases(staleCache)
        } else {
          setError('Could not load bases. Please check your connection.')
        }
      } finally {
        setLoading(false)
      }
    }

    fetchBases()
  }, [])

  return { bases, loading, error }
}