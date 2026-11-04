// @vitest-environment node
import { readFileSync } from 'fs'
import { describe, it, expect, vi } from 'vitest'
import semver from 'semver'
import {
  WATCHES_FILE,
  WORKFLOW_FILE,
  accepts,
  latestPeerRange,
  ticketTitle,
  ticketBody,
  run,
} from '../../scripts/upstream-watch.mjs'

const TS7 = { package: 'typescript-eslint', peer: 'typescript', version: '7.0.0', blocks: 991 }
const VITEST6 = { package: '@cloudflare/vitest-plugin', peer: 'vitest', version: '6.0.0', blocks: 42 }

// Resolves registry URLs against a map of package name to peerDependencies; a number is a failing status.
function stubRegistry(peersByPackage) {
  return vi.fn(async url => {
    const name = Object.keys(peersByPackage).find(n => url === `https://registry.npmjs.org/${n.replace('/', '%2F')}/latest`)
    const value = name === undefined ? 404 : peersByPackage[name]
    if (typeof value === 'number') return { ok: false, status: value, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ name, version: '1.0.0', peerDependencies: value }) }
  })
}

// Records every gh call; `issue list` answers with the titles given.
function stubGh(existingTitles = []) {
  return vi.fn(async args => (args[0] === 'issue' && args[1] === 'list' ? existingTitles.join('\n') : ''))
}

const callsTo = (gh, ...prefix) => gh.mock.calls.map(([args]) => args).filter(args => prefix.every((p, i) => args[i] === p))

describe('upstream watch', () => {
  describe('accepts', () => {
    it('is false while the range stops short of the version', () => {
      expect(accepts('>=4.8.4 <6.1.0', '7.0.0')).toBe(false)
    })

    it('is true once a release widens the range to take it', () => {
      expect(accepts('>=4.8.4 <7.1.0', '7.0.0')).toBe(true)
      expect(accepts('^4.1.0 || ^5.0.0', '5.0.0')).toBe(true)
    })

    it('is false when the package declares no such peer', () => {
      expect(accepts(undefined, '7.0.0')).toBe(false)
    })
  })

  describe('latestPeerRange', () => {
    it("reads the peer range from the package's latest release", async () => {
      const fetchImpl = stubRegistry({ 'typescript-eslint': { typescript: '>=4.8.4 <6.1.0', eslint: '^9.0.0' } })
      expect(await latestPeerRange('typescript-eslint', 'typescript', fetchImpl)).toBe('>=4.8.4 <6.1.0')
    })

    it('escapes a scoped name for the registry', async () => {
      const fetchImpl = stubRegistry({ '@cloudflare/vitest-plugin': { vitest: '^4.1.0 || ^5.0.0' } })
      expect(await latestPeerRange('@cloudflare/vitest-plugin', 'vitest', fetchImpl)).toBe('^4.1.0 || ^5.0.0')
    })

    it('is undefined when the release has no such peer', async () => {
      const fetchImpl = stubRegistry({ 'typescript-eslint': { eslint: '^9.0.0' } })
      expect(await latestPeerRange('typescript-eslint', 'typescript', fetchImpl)).toBeUndefined()
    })

    it('fails loudly when the registry does not answer', async () => {
      await expect(latestPeerRange('typescript-eslint', 'typescript', stubRegistry({}))).rejects.toThrow(/404/)
    })
  })

  describe('the ticket it raises', () => {
    it('names the package, the version now accepted and the ticket it unblocks', () => {
      expect(ticketTitle(TS7)).toBe('chore/upstream-watch: typescript-eslint now accepts typescript 7.0.0 (unblocks #991)')
    })

    it("links the blocked ticket and quotes the range that satisfied it", () => {
      const body = ticketBody(TS7, '>=4.8.4 <7.1.0')
      expect(body).toContain('#991')
      expect(body).toContain('>=4.8.4 <7.1.0')
    })
  })

  describe('run', () => {
    it('raises nothing and stays enabled while the blocker holds', async () => {
      const gh = stubGh()
      const result = await run({ watches: [TS7], fetchImpl: stubRegistry({ 'typescript-eslint': { typescript: '>=4.8.4 <6.1.0' } }), gh })
      expect(callsTo(gh, 'issue', 'create')).toEqual([])
      expect(callsTo(gh, 'workflow', 'disable')).toEqual([])
      expect(result.raised).toEqual([])
      expect(result.disabled).toBe(false)
    })

    it('raises a ticket once the blocker clears, and disables itself when that was the last watch', async () => {
      const gh = stubGh()
      const result = await run({ watches: [TS7], fetchImpl: stubRegistry({ 'typescript-eslint': { typescript: '>=4.8.4 <7.1.0' } }), gh })
      const created = callsTo(gh, 'issue', 'create')
      expect(created).toHaveLength(1)
      expect(created[0]).toEqual(expect.arrayContaining(['--title', ticketTitle(TS7)]))
      expect(callsTo(gh, 'workflow', 'disable', WORKFLOW_FILE)).toHaveLength(1)
      expect(result).toMatchObject({ raised: [ticketTitle(TS7)], disabled: true })
    })

    it('does not raise the same ticket twice', async () => {
      const gh = stubGh([ticketTitle(TS7)])
      await run({ watches: [TS7], fetchImpl: stubRegistry({ 'typescript-eslint': { typescript: '>=4.8.4 <7.1.0' } }), gh })
      expect(callsTo(gh, 'issue', 'create')).toEqual([])
    })

    it('raises for the cleared watch and stays enabled for the one still blocked', async () => {
      const gh = stubGh()
      const fetchImpl = stubRegistry({
        'typescript-eslint': { typescript: '>=4.8.4 <7.1.0' },
        '@cloudflare/vitest-plugin': { vitest: '^4.1.0 || ^5.0.0' },
      })
      const result = await run({ watches: [TS7, VITEST6], fetchImpl, gh })
      expect(result.raised).toEqual([ticketTitle(TS7)])
      expect(result.disabled).toBe(false)
    })

    it('raises nothing when a check fails, so a registry outage never reads as cleared', async () => {
      const gh = stubGh()
      await expect(run({ watches: [TS7], fetchImpl: stubRegistry({}), gh })).rejects.toThrow()
      expect(callsTo(gh, 'issue', 'create')).toEqual([])
      expect(callsTo(gh, 'workflow', 'disable')).toEqual([])
    })
  })

  describe('the watch list', () => {
    const watches = JSON.parse(readFileSync(WATCHES_FILE, 'utf8'))

    it('describes each watch fully', () => {
      for (const w of watches) {
        expect(Object.keys(w).sort()).toEqual(['blocks', 'package', 'peer', 'version'])
        expect(semver.valid(w.version)).toBe(w.version)
        expect(Number.isInteger(w.blocks)).toBe(true)
      }
    })

    it('watches typescript-eslint for TypeScript 7, for #991', () => {
      expect(watches).toContainEqual(TS7)
    })
  })
})
