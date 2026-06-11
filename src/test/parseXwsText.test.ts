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
  it('returns ok:true with pilots and total for a well-formed list', () => {
    const result = parseXwsText(VALID_LIST)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.total).toBe(50)
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

  it('accepts a list with exactly 3 ships', () => {
    const text = JSON.stringify({
      pilots: [
        { name: 'pilota', ship: 'shipa', points: 17 },
        { name: 'pilotb', ship: 'shipb', points: 17 },
        { name: 'pilotc', ship: 'shipc', points: 16 },
      ],
      points: 50,
    })
    expect(parseXwsText(text)).toMatchObject({ ok: true, total: 50 })
  })

  it('accepts a list with exactly 8 ships', () => {
    const pilots = Array.from({ length: 8 }, (_, i) => ({
      name: `pilot${i}`, ship: `ship${i}`, points: i === 0 ? 8 : 6,
    }))
    const text = JSON.stringify({ pilots, points: 50 })
    expect(parseXwsText(text)).toMatchObject({ ok: true })
  })

  it('accepts total of 46 (minimum valid)', () => {
    const text = JSON.stringify({
      pilots: [
        { name: 'a', ship: 'x', points: 16 },
        { name: 'b', ship: 'x', points: 15 },
        { name: 'c', ship: 'x', points: 15 },
      ],
      points: 46,
    })
    expect(parseXwsText(text)).toMatchObject({ ok: true, total: 46 })
  })

  it('ignores extra top-level fields (faction, name, vendor, etc.)', () => {
    expect(parseXwsText(VALID_LIST).ok).toBe(true)
  })
})

// ─── too-few-ships ───────────────────────────────────────────────────────────

describe('parseXwsText — too-few-ships', () => {
  it('returns too-few-ships for a 2-ship list', () => {
    const text = JSON.stringify({
      pilots: [
        { name: 'a', ship: 'x', points: 25 },
        { name: 'b', ship: 'x', points: 25 },
      ],
      points: 50,
    })
    expect(parseXwsText(text)).toEqual({ ok: false, error: 'too-few-ships' })
  })

  it('returns too-few-ships for a single-ship list', () => {
    const text = JSON.stringify({
      pilots: [{ name: 'a', ship: 'x', points: 50 }],
      points: 50,
    })
    expect(parseXwsText(text)).toEqual({ ok: false, error: 'too-few-ships' })
  })

  it('counts zero-cost ships toward the minimum', () => {
    const text = JSON.stringify({
      pilots: [
        { name: 'a', ship: 'x', points: 50 },
        { name: 'nashtahpup', ship: 'z95af4headhunter', points: 0 },
      ],
      points: 50,
    })
    expect(parseXwsText(text)).toEqual({ ok: false, error: 'too-few-ships' })
  })
})

// ─── too-many-ships ──────────────────────────────────────────────────────────

describe('parseXwsText — too-many-ships', () => {
  it('returns too-many-ships for a 9-ship list', () => {
    const pilots = Array.from({ length: 9 }, (_, i) => ({
      name: `pilot${i}`, ship: `ship${i}`, points: i < 5 ? 6 : 5,
    }))
    const text = JSON.stringify({ pilots, points: 50 })
    expect(parseXwsText(text)).toEqual({ ok: false, error: 'too-many-ships' })
  })

  it('counts zero-cost ships toward the maximum', () => {
    const pilots = Array.from({ length: 8 }, (_, i) => ({
      name: `pilot${i}`, ship: `ship${i}`, points: i === 0 ? 50 : 0,
    }))
    pilots.push({ name: 'extra', ship: 'shipx', points: 0 })
    const text = JSON.stringify({ pilots, points: 50 })
    expect(parseXwsText(text)).toEqual({ ok: false, error: 'too-many-ships' })
  })
})

// ─── invalid-total ───────────────────────────────────────────────────────────

describe('parseXwsText — invalid-total', () => {
  it('returns invalid-total when points is 45', () => {
    const text = JSON.stringify({
      pilots: [
        { name: 'a', ship: 'x', points: 15 },
        { name: 'b', ship: 'x', points: 15 },
        { name: 'c', ship: 'x', points: 15 },
      ],
      points: 45,
    })
    expect(parseXwsText(text)).toEqual({ ok: false, error: 'invalid-total' })
  })

  it('returns invalid-total when points is 51', () => {
    const text = JSON.stringify({
      pilots: [
        { name: 'a', ship: 'x', points: 17 },
        { name: 'b', ship: 'x', points: 17 },
        { name: 'c', ship: 'x', points: 17 },
      ],
      points: 51,
    })
    expect(parseXwsText(text)).toEqual({ ok: false, error: 'invalid-total' })
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

  it('returns invalid-format when points field is missing', () => {
    expect(parseXwsText(JSON.stringify({
      pilots: [
        { name: 'a', ship: 'x', points: 17 },
        { name: 'b', ship: 'x', points: 17 },
        { name: 'c', ship: 'x', points: 16 },
      ],
    }))).toEqual({ ok: false, error: 'invalid-format' })
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
