import { describe, it, expect } from 'vitest'
import { resolveXwsName } from '../utils/resolveXwsName'

const map: Record<string, string> = {
  sabinewren: 'Sabine Wren',
  rz1awing: 'RZ-1 A-wing',
  bluesquadronescort: 'Blue Squadron Escort',
}

describe('resolveXwsName', () => {
  it('returns the display name for a known slug', () => {
    expect(resolveXwsName('sabinewren', map)).toBe('Sabine Wren')
  })

  it('returns the display name for a known ship slug', () => {
    expect(resolveXwsName('rz1awing', map)).toBe('RZ-1 A-wing')
  })

  it('falls back to the raw slug when not in the map', () => {
    expect(resolveXwsName('unknownpilot', map)).toBe('unknownpilot')
  })

  it('falls back gracefully for empty slug', () => {
    expect(resolveXwsName('', map)).toBe('')
  })
})
