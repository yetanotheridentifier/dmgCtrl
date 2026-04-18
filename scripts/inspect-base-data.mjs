/**
 * inspect-base-data.mjs
 *
 * Fetches base card data from both external APIs (same logic as useBases.ts),
 * merges it, and writes two output files:
 *
 *   docs/base-data-snapshot.json  — full merged Base[] array (all fields)
 *   docs/base-data-summary.json   — compact summary for easy browsing
 *
 * Usage:
 *   node scripts/inspect-base-data.mjs
 */

import { writeFileSync } from 'fs'

const PROXY_URL = 'https://swu-proxy.dmgctrl.workers.dev'
const SWUAPI_URL = 'https://api.swuapi.com'
const SWU_DB_CDN = 'https://cdn.swu-db.com/images/cards'

// ---------------------------------------------------------------------------
// Static hyperspace card number map for sets no longer in swuapi.com
// (SOR, SHD, TWI rotated out of Premier format but remain valid in other formats)
//
// Each set uses a different offset — verified against cdn.swu-db.com:
//   SOR: standard + 266  (019→285 … 030→296)
//   SHD: standard + 278  (019→297 … 026→304)
//   TWI: standard + 275  (019→294 … 027→302), then 028→517, 029→518, 030→519
// ---------------------------------------------------------------------------
const STATIC_HYPERSPACE_SETS = {
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
    { number: '028', name: 'Petranaki Arena',         hyperspaceNumber: '517' },
    { number: '029', name: 'Level 1313',              hyperspaceNumber: '518' },
    { number: '030', name: 'Pyke Palace',             hyperspaceNumber: '519' },
  ],
}

// Build static hyperspace lookup: "name|set" -> { hiRes }
function buildStaticHyperspaceMap() {
  const map = new Map()
  for (const [setCode, cards] of Object.entries(STATIC_HYPERSPACE_SETS)) {
    for (const card of cards) {
      const hiResUrl = `${SWU_DB_CDN}/${setCode}/${card.hyperspaceNumber}.png`
      map.set(`${card.name}|${setCode}`, { hiRes: hiResUrl, hyperspaceNumber: card.hyperspaceNumber })
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// Fetch all pages from swuapi.com
// ---------------------------------------------------------------------------
async function fetchAllSwuApiCards() {
  const allCards = []
  let cursor = null

  do {
    const url = cursor
      ? `${SWUAPI_URL}/cards?type=Base&variant=all&limit=100&after=${cursor}`
      : `${SWUAPI_URL}/cards?type=Base&variant=all&limit=100`

    const res = await fetch(url)
    if (!res.ok) throw new Error(`swuapi.com fetch failed: ${res.status}`)
    const json = await res.json()
    allCards.push(...json.cards)
    cursor = json.pagination?.next_cursor || null
  } while (cursor)

  return allCards
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Fetching swu-db.com (via proxy)...')
  const swuDbRes = await fetch(`${PROXY_URL}/cards/search?q=type:base`)
  if (!swuDbRes.ok) throw new Error(`swu-db proxy failed: ${swuDbRes.status}`)
  const swuDbJson = await swuDbRes.json()
  const swuDbCards = swuDbJson.data.filter(c => c.VariantType === 'Normal')
  console.log(`  swu-db.com: ${swuDbCards.length} normal bases`)

  console.log('Fetching swuapi.com (all pages)...')
  const swuApiCards = await fetchAllSwuApiCards()
  console.log(`  swuapi.com: ${swuApiCards.length} total base records`)

  // Split swuapi cards into standard and hyperspace.
  // Deduplicate standard cards by set_code+card_number — the API returns multiple
  // Standard entries for the same collector number (showcase reprints etc).
  const _swuApiStandardAll = swuApiCards.filter(c => c.variant_type === 'Standard')
  const _standardSeen = new Set()
  const swuApiStandard = _swuApiStandardAll.filter(c => {
    const key = `${c.set_code}|${c.card_number}`
    if (_standardSeen.has(key)) return false
    _standardSeen.add(key)
    return true
  })
  const swuApiHyperspace = swuApiCards.filter(c => c.variant_type === 'Hyperspace')
  const swuApiOther = swuApiCards.filter(c => !['Standard', 'Hyperspace'].includes(c.variant_type))
  const dupeCount = _swuApiStandardAll.length - swuApiStandard.length
  console.log(`    Standard: ${swuApiStandard.length} (${dupeCount} dupes removed), Hyperspace: ${swuApiHyperspace.length}, Other (foil etc): ${swuApiOther.length}`)

  // Build swuapi standard uuid map: uuid -> card
  const swuApiStandardByUuid = new Map(swuApiStandard.map(c => [c.uuid, c]))

  // Build swuapi hyperspace map: variant_of_uuid -> hyperspace card
  const swuApiHyperspaceMap = new Map()
  for (const card of swuApiHyperspace) {
    if (card.variant_of_uuid) {
      swuApiHyperspaceMap.set(card.variant_of_uuid, card)
    }
  }

  // Build static hyperspace map for rotated sets
  const staticHyperspaceMap = buildStaticHyperspaceMap()

  // ---------------------------------------------------------------------------
  // Build swuapi-sourced bases (sets: GG, IBH, JTL, LAW, LOF, P25, SEC, TS26)
  // ---------------------------------------------------------------------------
  const mergedBases = []
  const swuDbByNameSet = new Map(swuDbCards.map(c => [`${c.Name}|${c.Set}`, c]))

  for (const standard of swuApiStandard) {
    const key = `${standard.name}|${standard.set_code}`
    const swuDbMatch = swuDbByNameSet.get(key)
    const hyperspaceCard = swuApiHyperspaceMap.get(standard.uuid)

    const hyperspaceNumber = hyperspaceCard
      ? String(hyperspaceCard.card_number).padStart(3, '0')
      : undefined

    mergedBases.push({
      // Identity
      set: standard.set_code,
      number: String(standard.card_number).padStart(3, '0'),
      name: standard.name,
      subtitle: swuDbMatch?.Subtitle ?? standard.subtitle ?? '',
      // Stats
      hp: standard.hp,
      aspects: standard.aspects ?? swuDbMatch?.Aspects ?? [],
      rarity: standard.rarity ?? swuDbMatch?.Rarity ?? '',
      epicAction: swuDbMatch?.FrontText ?? standard.epic_action ?? '',
      // Art — normal
      frontArt: swuDbMatch
        ? `${SWU_DB_CDN}/${standard.set_code}/${String(standard.card_number).padStart(3, '0')}.png`
        : null,
      frontArtLowRes: standard.front_image_url,
      // Art — hyperspace
      hyperspaceArtHiRes: hyperspaceNumber
        ? `${SWU_DB_CDN}/${standard.set_code}/${hyperspaceNumber}.png`
        : null,
      hyperspaceArt: hyperspaceCard?.front_image_url ?? null,
      hyperspaceCardNumber: hyperspaceNumber ?? null,
      // Source tracking
      _sources: {
        swuApi: true,
        swuDb: !!swuDbMatch,
        staticHyperspace: false,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Add swu-db-only bases (SOR, SHD, TWI) not present in swuapi
  // ---------------------------------------------------------------------------
  const swuApiSetCodes = new Set(swuApiStandard.map(c => c.set_code))

  for (const card of swuDbCards) {
    if (swuApiSetCodes.has(card.Set)) continue // already handled above

    const key = `${card.Name}|${card.Set}`
    const staticHyperspace = staticHyperspaceMap.get(key)

    mergedBases.push({
      // Identity
      set: card.Set,
      number: card.Number,
      name: card.Name,
      subtitle: card.Subtitle ?? '',
      // Stats
      hp: parseInt(card.HP, 10),
      aspects: card.Aspects ?? [],
      rarity: card.Rarity ?? '',
      epicAction: card.FrontText ?? '',
      // Art — normal (swu-db only, no swuapi low-res available)
      frontArt: card.FrontArt,
      frontArtLowRes: null,
      // Art — hyperspace (static map only)
      hyperspaceArtHiRes: staticHyperspace?.hiRes ?? null,
      hyperspaceArt: null,  // swuapi.com no longer has these sets
      hyperspaceCardNumber: staticHyperspace?.hyperspaceNumber ?? null,
      // Source tracking
      _sources: {
        swuApi: false,
        swuDb: true,
        staticHyperspace: !!staticHyperspace,
        staticHyperspaceNote: staticHyperspace?.note,
      },
    })
  }

  // Sort: set then name
  mergedBases.sort((a, b) => a.set.localeCompare(b.set) || a.name.localeCompare(b.name))

  // ---------------------------------------------------------------------------
  // Summary view — one row per base, easy to scan
  // ---------------------------------------------------------------------------
  const summary = mergedBases.map(b => ({
    set: b.set,
    number: b.number,
    name: b.name,
    subtitle: b.subtitle,
    hp: b.hp,
    aspects: b.aspects.join(', '),
    epicAction: b.epicAction ? b.epicAction.slice(0, 60) + (b.epicAction.length > 60 ? '…' : '') : '',
    art: {
      normalHiRes:      b.frontArt      ? '✓' : '✗',
      normalLowRes:     b.frontArtLowRes ? '✓' : '✗',
      hyperspaceHiRes:  b.hyperspaceArtHiRes ? '✓' : '✗',
      hyperspaceLowRes: b.hyperspaceArt  ? '✓' : '✗',
    },
    sources: Object.entries(b._sources)
      .filter(([k, v]) => v && k !== 'staticHyperspaceNote')
      .map(([k]) => k)
      .join(', '),
    notes: b._sources.staticHyperspaceNote ?? '',
  }))

  // Stats
  const sets = [...new Set(mergedBases.map(b => b.set))].sort()
  const stats = {
    totalBases: mergedBases.length,
    bySet: Object.fromEntries(sets.map(s => [s, mergedBases.filter(b => b.set === s).length])),
    artCoverage: {
      normalHiRes:      mergedBases.filter(b => b.frontArt).length,
      normalLowRes:     mergedBases.filter(b => b.frontArtLowRes).length,
      hyperspaceHiRes:  mergedBases.filter(b => b.hyperspaceArtHiRes).length,
      hyperspaceLowRes: mergedBases.filter(b => b.hyperspaceArt).length,
      hyperspaceAny:    mergedBases.filter(b => b.hyperspaceArtHiRes || b.hyperspaceArt).length,
    },
  }

  console.log('\n=== Stats ===')
  console.log(`Total bases: ${stats.totalBases}`)
  console.log('By set:', stats.bySet)
  console.log('Art coverage:', stats.artCoverage)

  writeFileSync('docs/base-data-snapshot.json', JSON.stringify(mergedBases, null, 2))
  writeFileSync('docs/base-data-summary.json', JSON.stringify({ stats, bases: summary }, null, 2))

  console.log('\nOutput written to:')
  console.log('  docs/base-data-snapshot.json  (full data)')
  console.log('  docs/base-data-summary.json   (compact summary with art coverage)')
}

main().catch(err => { console.error(err); process.exit(1) })