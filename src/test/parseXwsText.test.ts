// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseXwsText } from '../utils/parseXwsText'

const VALID_LIST = JSON.stringify({
  faction: 'scumandvillainy',
  name: 'Finding Your Fear Charming',
  pilots: [
    { name: 'asajjventress', ship: 'lancerclasspursuitcraft', points: 15 },
    { name: 'bobafett-armedanddangerous', ship: 'firesprayclasspatrolcraft', points: 18 },
    { name: 'bossk', ship: 'yv666lightfreighter', points: 17 },
    { name: 'nashtahpup', ship: 'z95af4headhunter', points: 0 },
  ],
  points: 50,
  version: '50P-2.0',
  ruleset: 'XWA',
})

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('parseXwsText — valid input', () => {
  it('returns ok:true with the pilots of a well-formed list', () => {
    const result = parseXwsText(VALID_LIST)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pilots).toHaveLength(4)
  })

  it('extracts name, ship, and points for each pilot', () => {
    const result = parseXwsText(VALID_LIST)
    if (!result.ok) throw new Error('expected ok')
    expect(result.pilots[0]).toEqual({ name: 'asajjventress', ship: 'lancerclasspursuitcraft', points: 15 })
    expect(result.pilots[1]).toEqual({ name: 'bobafett-armedanddangerous', ship: 'firesprayclasspatrolcraft', points: 18 })
  })

  it('includes zero-cost ships in the pilots array', () => {
    const result = parseXwsText(VALID_LIST)
    if (!result.ok) throw new Error('expected ok')
    expect(result.pilots.find(p => p.name === 'nashtahpup')).toBeDefined()
    expect(result.pilots.find(p => p.name === 'nashtahpup')?.points).toBe(0)
  })

  it('extracts the squad name from the top-level name field', () => {
    const result = parseXwsText(VALID_LIST)
    if (!result.ok) throw new Error('expected ok')
    expect(result.name).toBe('Finding Your Fear Charming')
  })

  it('returns undefined for name when the name field is absent', () => {
    const obj = JSON.parse(VALID_LIST)
    delete obj.name
    const result = parseXwsText(JSON.stringify(obj))
    if (!result.ok) throw new Error('expected ok')
    expect(result.name).toBeUndefined()
  })

  it('extracts the faction from the top-level faction field', () => {
    const result = parseXwsText(VALID_LIST)
    if (!result.ok) throw new Error('expected ok')
    expect(result.faction).toBe('scumandvillainy')
  })

  it('returns undefined for faction when the faction field is absent', () => {
    const obj = JSON.parse(VALID_LIST)
    delete obj.faction
    const result = parseXwsText(JSON.stringify(obj))
    if (!result.ok) throw new Error('expected ok')
    expect(result.faction).toBeUndefined()
  })

  it('ignores extra top-level fields (vendor, etc.)', () => {
    expect(parseXwsText(VALID_LIST).ok).toBe(true)
  })
})

// ─── Left to the list check ──────────────────────────────────────────────────
// Ship count and points are judged on the pilots at today's costs (listProblems), so a list that
// breaks them still reads, and can be fixed in the builder.

describe('parseXwsText — reads lists the rules would reject', () => {
  it('reads a list of 2 ships', () => {
    const text = JSON.stringify({ pilots: [{ name: 'a', ship: 'x', points: 25 }, { name: 'b', ship: 'x', points: 25 }], points: 50 })
    expect(parseXwsText(text)).toMatchObject({ ok: true, pilots: [{ name: 'a' }, { name: 'b' }] })
  })

  it('reads a list of 9 ships', () => {
    const pilots = Array.from({ length: 9 }, (_, i) => ({ name: `pilot${i}`, ship: `ship${i}`, points: 6 }))
    expect(parseXwsText(JSON.stringify({ pilots, points: 54 }))).toMatchObject({ ok: true })
  })

  it('reads a list whose own total is out of range, or missing', () => {
    const pilots = [{ name: 'a', ship: 'x', points: 17 }, { name: 'b', ship: 'x', points: 17 }, { name: 'c', ship: 'x', points: 17 }]
    expect(parseXwsText(JSON.stringify({ pilots, points: 51 }))).toMatchObject({ ok: true })
    expect(parseXwsText(JSON.stringify({ pilots }))).toMatchObject({ ok: true })
  })
})

// ─── invalid-format ──────────────────────────────────────────────────────────

describe('parseXwsText — invalid-format', () => {
  it('returns invalid-format for an empty string', () => {
    expect(parseXwsText('')).toEqual({ ok: false, error: 'invalid-format' })
  })

  it('returns invalid-format for non-JSON text', () => {
    expect(parseXwsText('this is not json')).toEqual({ ok: false, error: 'invalid-format' })
  })

  it('returns invalid-format when pilots field is missing', () => {
    expect(parseXwsText(JSON.stringify({ points: 50 }))).toEqual({ ok: false, error: 'invalid-format' })
  })

  it('returns invalid-format when pilots is not an array', () => {
    expect(parseXwsText(JSON.stringify({ pilots: 'invalid', points: 50 }))).toEqual({ ok: false, error: 'invalid-format' })
  })

  it('returns invalid-format when a pilot entry is missing required fields', () => {
    const text = JSON.stringify({
      pilots: [
        { name: 'a', ship: 'x', points: 17 },
        { name: 'b', ship: 'x' }, // missing points
        { name: 'c', ship: 'x', points: 16 },
      ],
      points: 50,
    })
    expect(parseXwsText(text)).toEqual({ ok: false, error: 'invalid-format' })
  })
})
