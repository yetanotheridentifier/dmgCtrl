import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSwuGame } from '../hooks/useSwuGame'

describe('useSwuGame', () => {

  // --- Initial state ---

  it('Counter starts at zero', () => {
    const { result } = renderHook(() => useSwuGame())
    expect(result.current.count).toBe(0)
  })

  it('imageLoaded starts as false', () => {
    const { result } = renderHook(() => useSwuGame())
    expect(result.current.imageLoaded).toBe(false)
  })

  it('imageError starts as false', () => {
    const { result } = renderHook(() => useSwuGame())
    expect(result.current.imageError).toBe(false)
  })

  // --- Counter ---

  it('increment increases count by 1', () => {
    const { result } = renderHook(() => useSwuGame())
    act(() => result.current.increment())
    expect(result.current.count).toBe(1)
  })

  it('increment can be called multiple times', () => {
    const { result } = renderHook(() => useSwuGame())
    act(() => {
      result.current.increment()
      result.current.increment()
      result.current.increment()
    })
    expect(result.current.count).toBe(3)
  })

  it('decrement decreases count by 1', () => {
    const { result } = renderHook(() => useSwuGame())
    act(() => result.current.increment())
    act(() => result.current.increment())
    act(() => result.current.decrement())
    expect(result.current.count).toBe(1)
  })

  it('decrement does not go below zero', () => {
    const { result } = renderHook(() => useSwuGame())
    act(() => result.current.decrement())
    act(() => result.current.decrement())
    expect(result.current.count).toBe(0)
  })

  // --- Image state ---

  it('handleImageLoad sets imageLoaded to true', () => {
    const { result } = renderHook(() => useSwuGame())
    act(() => result.current.handleImageLoad())
    expect(result.current.imageLoaded).toBe(true)
  })

  it('handleImageError sets imageError to true when no imageSrcs provided', () => {
    const { result } = renderHook(() => useSwuGame())
    act(() => result.current.handleImageError())
    expect(result.current.imageError).toBe(true)
  })

  // --- Image src fallback ---

  it('currentImageSrc is empty string when no imageSrcs provided', () => {
    const { result } = renderHook(() => useSwuGame())
    expect(result.current.currentImageSrc).toBe('')
  })

  it('currentImageSrc returns the first URL', () => {
    const { result } = renderHook(() => useSwuGame(['url1', 'url2']))
    expect(result.current.currentImageSrc).toBe('url1')
  })

  it('handleImageError advances to the next URL when more are available', () => {
    const { result } = renderHook(() => useSwuGame(['url1', 'url2']))
    act(() => result.current.handleImageError())
    expect(result.current.currentImageSrc).toBe('url2')
  })

  it('handleImageError does not set imageError when advancing to next URL', () => {
    const { result } = renderHook(() => useSwuGame(['url1', 'url2']))
    act(() => result.current.handleImageError())
    expect(result.current.imageError).toBe(false)
  })

  it('handleImageError resets imageLoaded when advancing to next URL', () => {
    const { result } = renderHook(() => useSwuGame(['url1', 'url2']))
    act(() => result.current.handleImageLoad())
    act(() => result.current.handleImageError())
    expect(result.current.imageLoaded).toBe(false)
  })

  it('handleImageError sets imageError when all URLs are exhausted', () => {
    const { result } = renderHook(() => useSwuGame(['url1']))
    act(() => result.current.handleImageError())
    expect(result.current.imageError).toBe(true)
  })

  it('handleImageError steps through all URLs before setting imageError', () => {
    const { result } = renderHook(() => useSwuGame(['url1', 'url2', 'url3']))
    act(() => result.current.handleImageError())
    act(() => result.current.handleImageError())
    expect(result.current.currentImageSrc).toBe('url3')
    expect(result.current.imageError).toBe(false)
    act(() => result.current.handleImageError())
    expect(result.current.imageError).toBe(true)
  })

})