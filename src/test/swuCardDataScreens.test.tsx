import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SwuSplash, SwuOffline } from '../components/swuCardDataScreens'

describe('SwuSplash', () => {

  it('shows the app name and says it is getting SWU card data', () => {
    render(<SwuSplash />)
    expect(screen.getByText('dmgCtrl')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Loading card data' })).toBeInTheDocument()
    expect(screen.getByText('Getting SWU card data')).toBeInTheDocument()
  })

})

describe('SwuOffline', () => {

  const show = (props: Partial<React.ComponentProps<typeof SwuOffline>> = {}) =>
    render(<SwuOffline onRetry={vi.fn()} onPlayXwing={vi.fn()} onBack={vi.fn()} {...props} />)

  it('says SWU needs a connection the first time, and that X-Wing does not', () => {
    show()
    expect(screen.getByRole('heading', { name: 'SWU needs a connection the first time' })).toBeInTheDocument()
    expect(screen.getByText(/X-Wing works without a connection/)).toBeInTheDocument()
  })

  it('Try again, Play X-Wing and Back each call their handler', async () => {
    const onRetry = vi.fn()
    const onPlayXwing = vi.fn()
    const onBack = vi.fn()
    show({ onRetry, onPlayXwing, onBack })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await userEvent.click(screen.getByRole('button', { name: 'Play X-Wing' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back to game select' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onPlayXwing).toHaveBeenCalledOnce()
    expect(onBack).toHaveBeenCalledOnce()
  })

})
