/**
 * check-influxdb-usage.mjs
 *
 * Reports row count and earliest/latest event timestamps from the dmgctrl
 * InfluxDB bucket. Useful for periodically checking data volume against the
 * free-tier 5GB limit.
 *
 * Requires INFLUXDB_URL, INFLUXDB_ORG, and INFLUXDB_READ to be set.
 *
 * Usage:
 *   node scripts/check-influxdb-usage.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const envFile = readFileSync(resolve(root, '.env.influxdb'), 'utf8')
for (const line of envFile.split('\n')) {
  const [key, ...rest] = line.trim().split('=')
  if (key && rest.length) process.env[key] = rest.join('=')
}

const { INFLUXDB_URL, INFLUXDB_ORG, INFLUXDB_READ } = process.env

if (!INFLUXDB_URL || !INFLUXDB_ORG || !INFLUXDB_READ) {
  console.error('Could not load required variables from .env.influxdb')
  process.exit(1)
}

async function flux(query) {
  const res = await fetch(`${INFLUXDB_URL}/api/v2/query?org=${INFLUXDB_ORG}`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${INFLUXDB_READ}`,
      'Content-Type': 'application/vnd.flux',
      'Accept': 'application/csv',
    },
    body: query,
  })
  if (!res.ok) throw new Error(`Query failed: ${res.status} ${await res.text()}`)
  return res.text()
}

function parseFirstValue(csv) {
  const lines = csv.trim().split('\n').filter(l => l && !l.startsWith('#'))
  if (lines.length < 2) return null
  const values = lines[1].split(',')
  return values[values.length - 1]?.trim() ?? null
}

const rowCsv = await flux(`from(bucket: "dmgctrl")
  |> range(start: 0)
  |> count()
  |> group()
  |> sum(column: "_value")`)

const rows = parseInt(parseFirstValue(rowCsv) ?? '0', 10)

// Rough size estimate: analytics events average ~400 bytes each
const estimatedMB = ((rows * 400) / 1_000_000).toFixed(2)
const limitMB = 5_000
const pct = ((estimatedMB / limitMB) * 100).toFixed(2)

console.log(`
InfluxDB dmgctrl bucket
───────────────────────
  Rows:        ${rows.toLocaleString()}
  Est. size:   ~${estimatedMB} MB / ${limitMB} MB free tier limit (${pct}%)
  Checked:     ${new Date().toISOString()}
`)
