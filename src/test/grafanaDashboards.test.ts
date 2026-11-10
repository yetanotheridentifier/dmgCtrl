// @vitest-environment node
import { describe, it, expect } from 'vitest'

// The Grafana dashboards under grafana/ are served both privately and as public (externally
// shared) dashboards. Public dashboards do not substitute variables, so a filter on '$env' alone
// compares against the literal text "$env" and every panel comes back empty. Each env filter
// falls back to production when the variable is left unsubstituted.
const ENV_FALLBACK = "CASE WHEN '$env' LIKE '$%' THEN 'production' ELSE '$env' END"

const dashboards = import.meta.glob<Record<string, unknown>>('../../grafana/*.json', { eager: true, import: 'default' })

function rawSqls(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(rawSqls)
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      key === 'rawSql' && typeof value === 'string' ? [value] : rawSqls(value))
  }
  return []
}

describe('Grafana dashboards', () => {
  it('finds the dashboards', () => {
    expect(Object.keys(dashboards).length).toBeGreaterThanOrEqual(3)
  })

  for (const [file, dashboard] of Object.entries(dashboards)) {
    describe(file.replace('../../', ''), () => {
      const queries = rawSqls(dashboard)

      it('has queries', () => {
        expect(queries.length).toBeGreaterThan(0)
      })

      it('falls back to production for every env filter, so the public dashboard shows data', () => {
        const unguarded = queries.filter(sql => sql.replaceAll(ENV_FALLBACK, '').includes('$env'))
        expect(unguarded).toEqual([])
      })
    })
  }
})
