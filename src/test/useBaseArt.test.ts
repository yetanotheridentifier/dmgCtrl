import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useBaseArt } from '../hooks/useBaseArt'
import { getRotationFromHyperspaceUrl } from '../constants/rotatedCards'
import { Base } from '../hooks/useBases'

// All four art URLs present
const fullBase: Base = {
  set: 'LAW', number: '021', name: 'Coaxium Mine', subtitle: 'Kessel', hp: 27,
  frontArt: 'https://cdn/LAW/021.png',
  frontArtLowRes: 'https://swuapi/coaxium.png',
  hyperspaceArtHiRes: 'https://cdn/LAW/285.png',
  hyperspaceArt: 'https://swuapi/coaxium-hs.png',
  epicAction: '', aspects: ['Vigilance'], rarity: 'Common',
}

// frontArt only — no low-res, no hyperspace
const sparseBase: Base = {
  set: 'SOR', number: '021', name: 'Dagobah Swamp', subtitle: 'Dagobah', hp: 30,
  frontArt: 'https://cdn/SOR/021.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: null,
  hyperspaceArt: null,
  epicAction: '', aspects: ['Vigilance'], rarity: 'Common',
}

// frontArt + hyperspaceArtHiRes only (typical SOR base)
const hyperspaceBase: Base = {
  set: 'SOR', number: '026', name: 'Catacombs of Cadera', subtitle: 'Jedha', hp: 30,
  frontArt: 'https://cdn/SOR/026.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: 'https://cdn/SOR/292.png',
  hyperspaceArt: null,
  epicAction: '', aspects: ['Aggression'], rarity: 'Common',
}

const otherBase: Base = {
  set: 'SOR', number: '022', name: 'Energy Conversion Lab', subtitle: 'Eadu', hp: 25,
  frontArt: 'https://cdn/SOR/022.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: 'https://cdn/SOR/288.png',
  hyperspaceArt: null,
  epicAction: '', aspects: ['Cunning'], rarity: 'Rare',
}

// Known rotated card: SOR Security Complex, hyperspaceNumber 285
const rotatedBase: Base = {
  set: 'SOR', number: '019', name: 'Security Complex', subtitle: 'Scarif', hp: 30,
  frontArt: 'https://cdn.swu-db.com/images/cards/SOR/019.png',
  frontArtLowRes: null,
  hyperspaceArtHiRes: 'https://cdn.swu-db.com/images/cards/SOR/285.png',
  hyperspaceArt: null,
  epicAction: '', aspects: ['Vigilance'], rarity: 'Common',
}

describe('useBaseArt', () => {

  // --- Null base ---

  it('src is null when base is null', () => {
    const { result } = renderHook(() => useBaseArt(null, false))
    expect(result.current.src).toBeNull()
  })

  it('allFailed is true when base is null', () => {
    const { result } = renderHook(() => useBaseArt(null, false))
    expect(result.current.allFailed).toBe(true)
  })

  // --- Initial state: normal preferred ---

  it('src is frontArt initially when useHyperspace is false', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    expect(result.current.src).toBe(fullBase.frontArt)
  })

  it('isHyperspace is false initially when useHyperspace is false', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    expect(result.current.isHyperspace).toBe(false)
  })

  it('allFailed is false initially', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    expect(result.current.allFailed).toBe(false)
  })

  it('normalFailed is false initially', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    expect(result.current.normalFailed).toBe(false)
  })

  it('hyperspaceFailed is false initially', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    expect(result.current.hyperspaceFailed).toBe(false)
  })

  // --- Initial state: hyperspace preferred ---

  it('src is hyperspaceArtHiRes initially when useHyperspace is true', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, true))
    expect(result.current.src).toBe(fullBase.hyperspaceArtHiRes)
  })

  it('isHyperspace is true initially when useHyperspace is true', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, true))
    expect(result.current.isHyperspace).toBe(true)
  })

  it('falls back to frontArt when useHyperspace is true but no hyperspace URLs exist', () => {
    const { result } = renderHook(() => useBaseArt(sparseBase, true))
    expect(result.current.src).toBe(sparseBase.frontArt)
  })

  // --- Normal-preferred fallback chain ---

  it('advances to frontArtLowRes after one error (normal preferred)', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    act(() => result.current.onError())
    expect(result.current.src).toBe(fullBase.frontArtLowRes)
  })

  it('advances to hyperspaceArtHiRes after two errors (normal preferred)', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    act(() => result.current.onError())
    act(() => result.current.onError())
    expect(result.current.src).toBe(fullBase.hyperspaceArtHiRes)
  })

  it('advances to hyperspaceArt after three errors (normal preferred)', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    act(() => result.current.onError())
    act(() => result.current.onError())
    act(() => result.current.onError())
    expect(result.current.src).toBe(fullBase.hyperspaceArt)
  })

  it('allFailed is true after all four URLs error (normal preferred)', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    act(() => result.current.onError())
    act(() => result.current.onError())
    act(() => result.current.onError())
    act(() => result.current.onError())
    expect(result.current.allFailed).toBe(true)
  })

  it('allFailed is true after one error on a base with only frontArt', () => {
    const { result } = renderHook(() => useBaseArt(sparseBase, false))
    act(() => result.current.onError())
    expect(result.current.allFailed).toBe(true)
  })

  // --- Hyperspace-preferred fallback chain ---

  it('advances to hyperspaceArt after one error (hyperspace preferred)', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, true))
    act(() => result.current.onError())
    expect(result.current.src).toBe(fullBase.hyperspaceArt)
  })

  it('advances to frontArt after two errors (hyperspace preferred)', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, true))
    act(() => result.current.onError())
    act(() => result.current.onError())
    expect(result.current.src).toBe(fullBase.frontArt)
  })

  it('advances to frontArtLowRes after three errors (hyperspace preferred)', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, true))
    act(() => result.current.onError())
    act(() => result.current.onError())
    act(() => result.current.onError())
    expect(result.current.src).toBe(fullBase.frontArtLowRes)
  })

  it('allFailed is true after all four URLs error (hyperspace preferred)', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, true))
    act(() => result.current.onError())
    act(() => result.current.onError())
    act(() => result.current.onError())
    act(() => result.current.onError())
    expect(result.current.allFailed).toBe(true)
  })

  // --- isHyperspace transitions ---

  it('isHyperspace becomes true when normal art exhausted and fallback shows hyperspace', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    act(() => result.current.onError())
    act(() => result.current.onError())
    expect(result.current.isHyperspace).toBe(true)
  })

  it('isHyperspace becomes false when hyperspace art exhausted and fallback shows normal', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, true))
    act(() => result.current.onError())
    act(() => result.current.onError())
    expect(result.current.isHyperspace).toBe(false)
  })

  // --- normalFailed and hyperspaceFailed ---

  it('normalFailed becomes true once all normal URLs are exhausted', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    act(() => result.current.onError())
    expect(result.current.normalFailed).toBe(false)
    act(() => result.current.onError())
    expect(result.current.normalFailed).toBe(true)
  })

  it('hyperspaceFailed becomes true once all hyperspace URLs are exhausted', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    act(() => result.current.onError())
    act(() => result.current.onError())
    act(() => result.current.onError())
    expect(result.current.hyperspaceFailed).toBe(false)
    act(() => result.current.onError())
    expect(result.current.hyperspaceFailed).toBe(true)
  })

  it('normalFailed is false for a base with no normal URLs', () => {
    const hyperOnly: Base = {
      set: 'SOR', number: '026', name: 'Test', subtitle: '', hp: 30,
      frontArt: null, frontArtLowRes: null,
      hyperspaceArtHiRes: 'https://cdn/SOR/292.png', hyperspaceArt: null,
      epicAction: '', aspects: [], rarity: 'Common',
    }
    const { result } = renderHook(() => useBaseArt(hyperOnly, false))
    act(() => result.current.onError())
    expect(result.current.normalFailed).toBe(false)
  })

  // --- imageLoaded ---

  it('imageLoaded starts false', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    expect(result.current.imageLoaded).toBe(false)
  })

  it('imageLoaded becomes true after onLoad', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    act(() => result.current.onLoad())
    expect(result.current.imageLoaded).toBe(true)
  })

  it('imageLoaded resets to false after onError advances to next URL', () => {
    const { result } = renderHook(() => useBaseArt(fullBase, false))
    act(() => result.current.onLoad())
    act(() => result.current.onError())
    expect(result.current.imageLoaded).toBe(false)
  })

  // --- Reset on base change ---

  it('resets to first URL when base changes', () => {
    let currentBase: Base = hyperspaceBase
    const { result, rerender } = renderHook(() => useBaseArt(currentBase, false))
    act(() => result.current.onError())
    expect(result.current.src).toBe(hyperspaceBase.hyperspaceArtHiRes)
    currentBase = otherBase
    rerender()
    expect(result.current.src).toBe(otherBase.frontArt)
  })

  it('resets imageLoaded when base changes', () => {
    let currentBase: Base = hyperspaceBase
    const { result, rerender } = renderHook(() => useBaseArt(currentBase, false))
    act(() => result.current.onLoad())
    currentBase = otherBase
    rerender()
    expect(result.current.imageLoaded).toBe(false)
  })

  // --- Reset on useHyperspace change ---

  it('resets to first URL when useHyperspace changes', () => {
    let hs = false
    const { result, rerender } = renderHook(() => useBaseArt(fullBase, hs))
    act(() => result.current.onError())
    expect(result.current.src).toBe(fullBase.frontArtLowRes)
    hs = true
    rerender()
    expect(result.current.src).toBe(fullBase.hyperspaceArtHiRes)
  })

  it('resets imageLoaded when useHyperspace changes', () => {
    let hs = false
    const { result, rerender } = renderHook(() => useBaseArt(fullBase, hs))
    act(() => result.current.onLoad())
    expect(result.current.imageLoaded).toBe(true)
    hs = true
    rerender()
    expect(result.current.imageLoaded).toBe(false)
  })

    // --- Rotation correction ---

  it('rotationDeg is 0 for a non-rotated base', () => {
    const { result } = renderHook(() => useBaseArt(hyperspaceBase, true))
    expect(result.current.rotationDeg).toBe(0)
  })

  it('rotationDeg is 90 for a known rotated hyperspace hi-res image', () => {
    const { result } = renderHook(() => useBaseArt(rotatedBase, true))
    expect(result.current.rotationDeg).toBe(90)
  })

  it('rotationDeg is 0 when showing the normal art of a rotated base', () => {
    const { result } = renderHook(() => useBaseArt(rotatedBase, false))
    expect(result.current.rotationDeg).toBe(0)
  })

  it('rotationDeg is 0 when rotated base falls back to normal art after hyperspace fails', () => {
    const { result } = renderHook(() => useBaseArt(rotatedBase, true))
    act(() => result.current.onError())
    expect(result.current.rotationDeg).toBe(0)
  })

  it('rotationDeg is 0 when base is null', () => {
    const { result } = renderHook(() => useBaseArt(null, false))
    expect(result.current.rotationDeg).toBe(0)
  })

})

describe('getRotationFromHyperspaceUrl', () => {

  it('returns 90 for a known rotated card URL', () => {
    expect(getRotationFromHyperspaceUrl('https://cdn.swu-db.com/images/cards/SOR/285.png')).toBe(90)
  })

  it('returns 0 for a non-rotated card URL', () => {
    expect(getRotationFromHyperspaceUrl('https://cdn.swu-db.com/images/cards/SOR/292.png')).toBe(0)
  })

  it('returns 0 for a non-cdn URL (swuapi fallback)', () => {
    expect(getRotationFromHyperspaceUrl('https://swuapi.com/some-card.png')).toBe(0)
  })

  it('returns 90 for all five known rotated cards', () => {
    const rotated = [
      'https://cdn.swu-db.com/images/cards/SOR/285.png',
      'https://cdn.swu-db.com/images/cards/TWI/294.png',
      'https://cdn.swu-db.com/images/cards/TWI/297.png',
      'https://cdn.swu-db.com/images/cards/TWI/301.png',
      'https://cdn.swu-db.com/images/cards/TWI/303.png',
    ]
    for (const url of rotated) {
      expect(getRotationFromHyperspaceUrl(url)).toBe(90)
    }
  })

})