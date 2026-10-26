import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InstallBanner from '../components/installBanner'

const show = (platform: 'ios' | 'android', props: Partial<React.ComponentProps<typeof InstallBanner>> = {}) =>
  render(<InstallBanner platform={platform} onInstall={vi.fn()} onDismiss={vi.fn()} {...props} />)

describe('InstallBanner', () => {

  it('is a region named Install dmgCtrl', () => {
    show('android')
    expect(screen.getByRole('region', { name: 'Install dmgCtrl' })).toBeInTheDocument()
  })

  // ── iPhone ────────────────────────────────────────────────────────────────

  it('iPhone: shows the Safari steps in one list, in order', () => {
    show('ios')
    expect(screen.getByText('Install dmgCtrl from Safari')).toBeInTheDocument()
    const steps = within(screen.getByRole('list')).getAllByRole('listitem').map(li => li.textContent)
    expect(steps).toEqual(['Tap', 'Share', 'View More', 'Add to Home Screen'])
    expect(screen.getByTestId('share-icon')).toBeInTheDocument()
  })

  it('iPhone: has no Install button, only Not now', () => {
    show('ios')
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
  })

  // ── Android ───────────────────────────────────────────────────────────────

  it('Android: says what installing gives, with Not now and Install', () => {
    show('android')
    expect(screen.getByText('Install dmgCtrl')).toBeInTheDocument()
    expect(screen.getByText(/works offline/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()
    expect(screen.queryByTestId('share-icon')).not.toBeInTheDocument()
  })

  // ── Interactions ──────────────────────────────────────────────────────────

  it('Not now calls onDismiss', async () => {
    const onDismiss = vi.fn()
    show('ios', { onDismiss })
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('Install calls onInstall on Android', async () => {
    const onInstall = vi.fn()
    show('android', { onInstall })
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(onInstall).toHaveBeenCalledOnce()
  })

})
