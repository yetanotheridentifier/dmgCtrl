import { describe, it, expect, vi, afterEach } from 'vitest'
import { normaliseSwudbUrl, isValidSwudbUrl, fetchSwudbDeck } from '../utils/swudbUrl'

describe('normaliseSwudbUrl', () => {

  it('converts a deck/edit URL to a deck URL', () => {
    expect(normaliseSwudbUrl('https://swudb.com/deck/edit/ILRtEGjuCQY'))
      .toBe('https://swudb.com/deck/ILRtEGjuCQY')
  })

  it('leaves an already-normalised deck URL unchanged', () => {
    expect(normaliseSwudbUrl('https://swudb.com/deck/ILRtEGjuCQY'))
      .toBe('https://swudb.com/deck/ILRtEGjuCQY')
  })

})

describe('isValidSwudbUrl', () => {

  it('returns true for a known valid 11-char deck URL', () => {
    expect(isValidSwudbUrl('https://swudb.com/deck/ILRtEGjuCQY')).toBe(true)
  })

  it('returns true for a known valid 10-char deck URL', () => {
    expect(isValidSwudbUrl('https://swudb.com/deck/tLSGgxCAjX')).toBe(true)
  })

  it('returns true for a short (9-char) alphanumeric ID', () => {
    expect(isValidSwudbUrl('https://swudb.com/deck/AbCdEfGhI')).toBe(true)
  })

  it('returns true for a long (13-char) alphanumeric ID', () => {
    expect(isValidSwudbUrl('https://swudb.com/deck/AbCdEfGhIjKlM')).toBe(true)
  })

  it('returns true for a normalised edit URL', () => {
    expect(isValidSwudbUrl(normaliseSwudbUrl('https://swudb.com/deck/edit/ILRtEGjuCQY'))).toBe(true)
  })

  it('returns false for an edit URL before normalisation', () => {
    expect(isValidSwudbUrl('https://swudb.com/deck/edit/ILRtEGjuCQY')).toBe(false)
  })

  it('returns false when the ID contains non-alphanumeric characters', () => {
    expect(isValidSwudbUrl('https://swudb.com/deck/ILRtEG-uCQY')).toBe(false)
  })

  it('returns false for the wrong domain', () => {
    expect(isValidSwudbUrl('https://swudb.net/deck/ILRtEGjuCQY')).toBe(false)
  })

  it('returns false for a URL missing the deck path', () => {
    expect(isValidSwudbUrl('https://swudb.com/ILRtEGjuCQY')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isValidSwudbUrl('')).toBe(false)
  })

  it('returns false for an empty deck ID', () => {
    expect(isValidSwudbUrl('https://swudb.com/deck/')).toBe(false)
  })

  it('returns false for plain text', () => {
    expect(isValidSwudbUrl('not a url')).toBe(false)
  })

})

describe('fetchSwudbDeck', () => {

  afterEach(() => vi.unstubAllGlobals())

  it('returns deckName and baseKey from a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        deckName: 'Test Deck',
        base: { defaultExpansionAbbreviation: 'JTL', defaultCardNumber: '031' },
      }),
    }))
    const result = await fetchSwudbDeck('ILRtEGjuCQY')
    expect(result).toEqual({ deckName: 'Test Deck', baseKey: 'JTL-031' })
  })

  it('calls the correct proxy URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        deckName: 'Test',
        base: { defaultExpansionAbbreviation: 'JTL', defaultCardNumber: '031' },
      }),
    })
    vi.stubGlobal('fetch', mockFetch)
    await fetchSwudbDeck('ILRtEGjuCQY')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://swu-proxy.dmgctrl.workers.dev/swudb/deck/ILRtEGjuCQY'
    )
  })

  it('throws Deck not accessible on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(fetchSwudbDeck('tLSGgxCAjX')).rejects.toThrow('Deck not accessible')
  })

  it('throws Deck not accessible on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))
    await expect(fetchSwudbDeck('ILRtEGjuCQY')).rejects.toThrow('Deck not accessible')
  })

})