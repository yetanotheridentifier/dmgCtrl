// @vitest-environment node
import { describe, it, expect } from 'vitest'

// The Grafana dashboards under grafana/ are served both privately and as public (externally
// shared) dashboards. Public dashboards do not substitute variables, so a filter on '$env' alone
// compares against the literal text "$env" and every panel comes back empty. Each env filter
// falls back to production when the variable is left unsubstituted.
const ENV_FALLBACK = "CASE WHEN '$env' LIKE '$%' THEN 'production' ELSE '$env' END"

const dashboards = import.meta.glob<Record<string, unknown>>('../../grafana/*.json', { eager: true, import: 'default' })

// Every event the app can send, read from the one place that sends them.
const analyticsSource = Object.values(import.meta.glob<string>('../services/analytics.ts', { eager: true, query: '?raw', import: 'default' }))[0]
const sentEvents = new Set([...analyticsSource.matchAll(/sendEvent\('([a-z_]+)'/g)].map(m => m[1]))

// Every `game` the two apps tag their events with. The core dashboard splits games by it, and a value
// it does not name falls into another game's figures without any error.
const senders = import.meta.glob<string>(['../services/analytics.ts', '../../sealed/src/data/analytics.ts'], { eager: true, query: '?raw', import: 'default' })
const sentGames = new Set(Object.values(senders).flatMap(source => [...source.matchAll(/\bgame: '([a-z]+)'/g)].map(m => m[1])))

// The event names a query compares the event column against: `event = 'x'` and `event IN ('x', 'y')`.
function queriedEvents(sql: string): string[] {
  const names = [...sql.matchAll(/\bevent\s*=\s*'([a-z_]+)'/g)].map(m => m[1])
  for (const [, list] of sql.matchAll(/\bevent\s+IN\s*\(([^)]*)\)/gi)) names.push(...[...list.matchAll(/'([a-z_]+)'/g)].map(m => m[1]))
  return names
}
function rawSqls(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(rawSqls)
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      key === 'rawSql' && typeof value === 'string' ? [value] : rawSqls(value))
  }
  return []
}

// The Business Charts country maps: each dashboard has one, and all of them run one script, so a
// fix to the country names or the colouring lands everywhere. Only the query differs.
function countryMapScripts(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(countryMapScripts)
  if (node && typeof node === 'object') {
    const { group, spec } = node as { group?: unknown; spec?: { options?: { getOption?: unknown } } }
    if (group === 'volkovlabs-echarts-panel' && typeof spec?.options?.getOption === 'string') return [spec.options.getOption]
    return Object.values(node).flatMap(countryMapScripts)
  }
  return []
}

describe('Grafana dashboards', () => {
  it('finds the dashboards', () => {
    expect(Object.keys(dashboards).length).toBeGreaterThanOrEqual(3)
  })

  it('names every game the apps send in each core panel that splits games', () => {
    const core = Object.entries(dashboards).find(([file]) => file.endsWith('/dmgctrl-dashboard.json'))![1]
    const splits = rawSqls(core).filter(sql => /\bgame = '/.test(sql))
    expect([...sentGames].sort()).toEqual(['sealed', 'swu', 'xwing'])
    expect(splits.length).toBeGreaterThanOrEqual(2)
    for (const sql of splits) {
      expect([...sentGames].filter(game => !sql.includes(`game = '${game}'`))).toEqual([])
    }
  })

  it('shades countries with the same map script on every dashboard', () => {
    const perDashboard = Object.values(dashboards).map(countryMapScripts)
    expect(perDashboard.map(scripts => scripts.length)).toEqual(perDashboard.map(() => 1))
    expect(new Set(perDashboard.flat()).size).toBe(1)
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

      it('queries only events the app still sends', () => {
        const stale = [...new Set(queries.flatMap(queriedEvents))].filter(name => !sentEvents.has(name))
        expect(stale).toEqual([])
      })    })
  }
})
