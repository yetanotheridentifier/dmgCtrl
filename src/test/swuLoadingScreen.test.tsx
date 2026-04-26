import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import SwuLoadingScreen from '../components/swuLoadingScreen'

describe('SwuLoadingScreen', () => {

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('Renders LOADING text', () => {
    render(<SwuLoadingScreen loading={false} onReady={vi.fn()} />)
    expect(screen.getByText('LOADING')).toBeInTheDocument()
  })

  it('Renders the app icon', () => {
    render(<SwuLoadingScreen loading={false} onReady={vi.fn()} />)
    expect(screen.getByAltText('dmgCtrl')).toBeInTheDocument()
  })

  it('Does not call onReady while loading is true', () => {
    const onReady = vi.fn()
    render(<SwuLoadingScreen loading={true} onReady={onReady} />)
    expect(onReady).not.toHaveBeenCalled()
  })

  it('Does not call onReady before 2 seconds even if data is ready', () => {
    const onReady = vi.fn()
    render(<SwuLoadingScreen loading={false} onReady={onReady} />)
    act(() => { vi.advanceTimersByTime(1999) })
    expect(onReady).not.toHaveBeenCalled()
  })

  it('Calls onReady after 2 seconds when data is already ready', () => {
    const onReady = vi.fn()
    render(<SwuLoadingScreen loading={false} onReady={onReady} />)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('Does not call onReady after 2 seconds if loading is still true', () => {
    const onReady = vi.fn()
    render(<SwuLoadingScreen loading={true} onReady={onReady} />)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(onReady).not.toHaveBeenCalled()
  })

  it('Calls onReady when loading becomes false after 2 seconds have elapsed', () => {
    const onReady = vi.fn()
    const { rerender } = render(<SwuLoadingScreen loading={true} onReady={onReady} />)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(onReady).not.toHaveBeenCalled()
    rerender(<SwuLoadingScreen loading={false} onReady={onReady} />)
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('Calls onReady when 2 seconds elapse after loading becomes false', () => {
    const onReady = vi.fn()
    const { rerender } = render(<SwuLoadingScreen loading={true} onReady={onReady} />)
    act(() => { vi.advanceTimersByTime(1000) })
    rerender(<SwuLoadingScreen loading={false} onReady={onReady} />)
    expect(onReady).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(onReady).toHaveBeenCalledOnce()
  })

})