import { describe, it, expect } from 'vitest'
import { normaliseSwudbUrl, isValidSwudbUrl } from '../utils/swudbUrl'

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