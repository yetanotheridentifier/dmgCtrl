import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuInstallBanner from '../components/swuInstallBanner'

describe('SwuInstallBanner', () => {

  // ── iOS layout ────────────────────────────────────────────────────────────

  it('shows Add to Home Screen instruction for iOS', () => {
    render(<SwuInstallBanner platform="ios" onInstall={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument()
  })

  it('shows share icon for iOS', () => {
    render(<SwuInstallBanner platform="ios" onInstall={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByTestId('share-icon')).toBeInTheDocument()
  })

  it('does not show an Install button for iOS', () => {
    render(<SwuInstallBanner platform="ios" onInstall={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument()
  })

  // ── Android layout ────────────────────────────────────────────────────────

  it('shows Install button for Android', () => {
    render(<SwuInstallBanner platform="android" onInstall={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByRole('button', { name: /install/i })).toBeInTheDocument()
  })

  it('does not show share icon for Android', () => {
    render(<SwuInstallBanner platform="android" onInstall={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.queryByTestId('share-icon')).not.toBeInTheDocument()
  })

  // ── Interactions ──────────────────────────────────────────────────────────

  it('calls onDismiss when dismiss button is clicked', async () => {
    const onDismiss = vi.fn()
    const user = userEvent.setup()
    render(<SwuInstallBanner platform="ios" onInstall={vi.fn()} onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('calls onInstall when Install button is clicked on Android', async () => {
    const onInstall = vi.fn()
    const user = userEvent.setup()
    render(<SwuInstallBanner platform="android" onInstall={onInstall} onDismiss={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /install/i }))
    expect(onInstall).toHaveBeenCalledOnce()
  })

})
