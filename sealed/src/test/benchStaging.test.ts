import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { GET_BATCH, parseBulkGet, parseKeyList, STAGING_PREFIX, wranglerStaging } from '../bench/staging'

/**
 * Staging is read through `wrangler`, which is already signed in and is how the store is read by
 * hand. These hold the transport to the commands it may run and to what it takes from their output,
 * with a stand-in for the process: nothing here starts wrangler or reaches the network.
 */

const NAMESPACE = ['--binding', 'GAME_RECORDS', '--remote', '--config', 'proxy/wrangler.toml']

/** A stand-in for wrangler that records each call, with the keys file it was pointed at read back. */
const recorder = (answer: (args: string[]) => string = () => '[]') => {
  const calls: { args: string[]; file?: unknown }[] = []
  const files: string[] = []
  const run = (args: string[]): string => {
    const file = args[2] === 'bulk' ? args[4] : undefined
    if (file !== undefined) files.push(file)
    calls.push({ args, ...(file !== undefined && { file: JSON.parse(readFileSync(file, 'utf8')) as unknown }) })
    return answer(args)
  }
  return { calls, files, run }
}

describe('the wrangler commands staging is read with', () => {
  it('lists the keys under the staging prefix, in the remote namespace the proxy is bound to', () => {
    const { calls, run } = recorder(() => JSON.stringify([{ name: 'records/aaaaaaaaaaaaaaaa' }]))

    expect(wranglerStaging(run).list()).toEqual({ keys: ['records/aaaaaaaaaaaaaaaa'] })

    expect(calls.map(c => c.args)).toEqual([['wrangler', 'kv', 'key', 'list', '--prefix', STAGING_PREFIX, ...NAMESPACE]])
    expect(STAGING_PREFIX).toBe('records/')
  })

  it('gets values a batch of keys at a time, from a file of their names', () => {
    const keys = Array.from({ length: GET_BATCH + 5 }, (_, i) => `records/${String(i).padStart(16, '0')}`)
    const { calls, run } = recorder(args => {
      const asked = JSON.parse(readFileSync(args[4], 'utf8')) as string[]
      return JSON.stringify(Object.fromEntries(asked.map(k => [k, `value of ${k}`])))
    })

    const values = wranglerStaging(run).get(keys)

    expect(GET_BATCH).toBe(100)
    expect(calls.map(c => c.args.slice(0, 4))).toEqual([['wrangler', 'kv', 'bulk', 'get'], ['wrangler', 'kv', 'bulk', 'get']])
    expect(calls.map(c => c.args.slice(5))).toEqual([NAMESPACE, NAMESPACE])
    expect(calls.map(c => c.file)).toEqual([keys.slice(0, GET_BATCH), keys.slice(GET_BATCH)])
    expect([...values.keys()]).toEqual(keys)
    expect(values.get(keys[3])).toBe(`value of ${keys[3]}`)
  })

  it('deletes the keys it is given and no others, without a prompt to answer', () => {
    const keys = ['records/aaaaaaaaaaaaaaaa', 'records/bbbbbbbbbbbbbbbb']
    const { calls, run } = recorder(() => '')

    wranglerStaging(run).delete(keys)

    expect(calls).toEqual([{ args: ['wrangler', 'kv', 'bulk', 'delete', calls[0].args[4], '--force', ...NAMESPACE], file: keys }])
  })

  it('starts no process to get or delete nothing', () => {
    const { calls, run } = recorder()
    const staging = wranglerStaging(run)
    expect(staging.get([])).toEqual(new Map())
    staging.delete([])
    expect(calls).toEqual([])
  })

  it('leaves no file of key names behind', () => {
    const { files, run } = recorder(() => '{}')
    const staging = wranglerStaging(run)
    staging.get(['records/aaaaaaaaaaaaaaaa'])
    staging.delete(['records/aaaaaaaaaaaaaaaa'])
    expect(files).toHaveLength(2)
    expect(files.filter(existsSync)).toEqual([])
  })

  it('never writes to the namespace: list, bulk get and bulk delete are the only commands', () => {
    const { calls, run } = recorder(args => (args[2] === 'key' ? '[]' : '{}'))
    const staging = wranglerStaging(run)
    staging.list()
    staging.get(['records/aaaaaaaaaaaaaaaa'])
    staging.delete(['records/aaaaaaaaaaaaaaaa'])
    expect(calls.map(c => c.args.slice(1, 4).join(' '))).toEqual(['kv key list', 'kv bulk get', 'kv bulk delete'])
  })

  it('can be pointed at wrangler’s local store instead', () => {
    const { calls, run } = recorder()
    wranglerStaging(run, ['--local', '--persist-to', '/tmp/kv']).list()
    expect(calls[0].args).toEqual(['wrangler', 'kv', 'key', 'list', '--prefix', 'records/', '--binding', 'GAME_RECORDS', '--local', '--persist-to', '/tmp/kv', '--config', 'proxy/wrangler.toml'])
  })
})

describe('what is taken from a listing', () => {
  it('is the key names and nothing else a listing carries', () => {
    const listing = JSON.stringify([
      { name: 'records/aaaaaaaaaaaaaaaa' },
      { name: 'records/bbbbbbbbbbbbbbbb', expiration: 1760368944, metadata: { from: 'somewhere' } },
    ])
    expect(parseKeyList(listing)).toEqual(['records/aaaaaaaaaaaaaaaa', 'records/bbbbbbbbbbbbbbbb'])
  })

  it('is read past anything wrangler prints before the list', () => {
    expect(parseKeyList(' ⛅️ wrangler 4.107.0\n───────────\n[\n  { "name": "records/aaaaaaaaaaaaaaaa" }\n]\n')).toEqual(['records/aaaaaaaaaaaaaaaa'])
    expect(parseKeyList('[]\n')).toEqual([])
  })

  it('throws on output that is not a listing, quoting it', () => {
    expect(() => parseKeyList('Not logged in.')).toThrow('Not logged in.')
    expect(() => parseKeyList('{"name":"x"}')).toThrow('not a list of keys')
  })
})

describe('what is taken from a bulk get', () => {
  it('is each key’s stored text, as the remote store answers', () => {
    const out = JSON.stringify({ 'records/aaaaaaaaaaaaaaaa': '{"winner":"player"}', 'records/bbbbbbbbbbbbbbbb': null }, null, 2)
    expect([...parseBulkGet(out)]).toEqual([['records/aaaaaaaaaaaaaaaa', '{"winner":"player"}']])
  })

  it('is the same from the shape the local store answers in, less any metadata', () => {
    const out = JSON.stringify({ 'records/aaaaaaaaaaaaaaaa': { value: '{"winner":"player"}', metadata: { at: 1 } }, 'records/bbbbbbbbbbbbbbbb': { value: null } })
    expect([...parseBulkGet(out)]).toEqual([['records/aaaaaaaaaaaaaaaa', '{"winner":"player"}']])
  })

  it('throws on output that is not an answer', () => {
    expect(() => parseBulkGet('✘ [ERROR] A request to the Cloudflare API failed.')).toThrow('Cloudflare API failed')
  })
})
