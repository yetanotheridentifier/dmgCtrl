// Regenerate the bundled printing map for a set (#389): every printing (Normal, Hyperspace, foil,
// prestige, showcase…) mapped to its Normal (canonical) id, via the same Type|Name|Subtitle join
// `data/printings.ts` uses at runtime. Bundling this means a known card's id resolves instantly,
// offline, with no IndexedDB/network race: the actual #389 mechanism was an incomplete browser
// cache silently short-circuiting the dynamic fallback before it ever reached the network.
//
// `search?q=set:X` (what the app uses at runtime) returns Normal printings only. The plain set
// listing, `/cards/<SET>` with no query, returns every printing, which is what this script needs.
//
// Run when a new set gets card-ability support, or FFG ships a new print run for one already
// bundled:
//   node scripts/generatePrintingMap.mjs ASH
import { writeFileSync, mkdirSync } from 'node:fs'

const SET = (process.argv[2] ?? 'ASH').toUpperCase()
const API = 'https://worker.dmgctrl.app'

const printingKey = c => [c.Type ?? '', c.Name ?? '', c.Subtitle ?? ''].join('|').toLowerCase()
const isNormal = c => c.VariantType == null || c.VariantType === 'Normal'

const res = await fetch(`${API}/cards/${SET}`)
if (!res.ok) {
  console.error(`generatePrintingMap: fetch failed (HTTP ${res.status})`)
  process.exit(1)
}
const payload = await res.json()
const rows = payload.data
if (!Array.isArray(rows) || rows.length === 0) {
  console.error('generatePrintingMap: no rows returned')
  process.exit(1)
}
if (payload.total_cards != null && rows.length !== payload.total_cards) {
  console.error(`generatePrintingMap: expected ${payload.total_cards} rows, got ${rows.length}`)
  process.exit(1)
}

const normals = rows.filter(isNormal)
const byKey = new Map(normals.map(c => [printingKey(c), `${c.Set}_${c.Number}`]))

const map = {}
const unmatched = []
for (const c of rows) {
  const id = `${c.Set}_${c.Number}`
  const normalId = byKey.get(printingKey(c))
  if (normalId) map[id] = normalId
  else unmatched.push(id)
}

if (unmatched.length > 0) {
  // Left out of the map entirely: `canonicaliseCards` falls back to its dynamic cache/network path
  // for anything not bundled, so an unjoinable printing degrades gracefully rather than getting a
  // wrong or fabricated mapping.
  console.warn(`generatePrintingMap: ${unmatched.length} printing(s) did not join to a Normal row, omitted:`, unmatched)
}

const sorted = Object.fromEntries(Object.keys(map).sort().map(k => [k, map[k]]))
const dir = new URL('../src/data/printingMaps/', import.meta.url)
mkdirSync(dir, { recursive: true })
writeFileSync(new URL(`${SET.toLowerCase()}.json`, dir), `${JSON.stringify(sorted, null, 2)}\n`)

console.log(`generatePrintingMap: wrote ${Object.keys(sorted).length} printings for ${SET} (${normals.length} Normal, ${rows.length - normals.length} variant, ${unmatched.length} unmatched)`)
