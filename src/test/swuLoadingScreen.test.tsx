import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SwuLoadingScreen from '../components/swuLoadingScreen'

describe('SwuLoadingScreen', () => {

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

  it('Calls onReady when loading is already false', () => {
    const onReady = vi.fn()
    render(<SwuLoadingScreen loading={false} onReady={onReady} />)
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('Calls onReady when loading becomes false', () => {
    const onReady = vi.fn()
    const { rerender } = render(<SwuLoadingScreen loading={true} onReady={onReady} />)
    expect(onReady).not.toHaveBeenCalled()
    rerender(<SwuLoadingScreen loading={false} onReady={onReady} />)
    expect(onReady).toHaveBeenCalledOnce()
  })

})
