import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuGameSelectScreen from '../components/swuGameSelectScreen'

describe('SwuGameSelectScreen', () => {

  // ── Title ─────────────────────────────────────────────────────────────────

  it('renders the dmgCtrl app icon', () => {
    render(<SwuGameSelectScreen onSelectSwu={vi.fn()} onSelectXwing={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByAltText('dmgCtrl')).toBeInTheDocument()
  })

  it('renders the dmgCtrl title', () => {
    render(<SwuGameSelectScreen onSelectSwu={vi.fn()} onSelectXwing={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByText('dmgCtrl')).toBeInTheDocument()
  })

  // ── Game buttons ──────────────────────────────────────────────────────────

  it('renders the Star Wars Unlimited logo', () => {
    render(<SwuGameSelectScreen onSelectSwu={vi.fn()} onSelectXwing={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByAltText('Star Wars Unlimited')).toBeInTheDocument()
  })

  it('renders the Star Wars X-Wing logo', () => {
    render(<SwuGameSelectScreen onSelectSwu={vi.fn()} onSelectXwing={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByAltText('Star Wars X-Wing')).toBeInTheDocument()
  })

  it('Star Wars Unlimited button is enabled', () => {
    render(<SwuGameSelectScreen onSelectSwu={vi.fn()} onSelectXwing={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('button', { name: /star wars unlimited/i })).not.toBeDisabled()
  })

  it('Star Wars X-Wing button is enabled', () => {
    render(<SwuGameSelectScreen onSelectSwu={vi.fn()} onSelectXwing={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('button', { name: /star wars x-wing/i })).not.toBeDisabled()
  })

  // ── Interactions ──────────────────────────────────────────────────────────

  it('calls onSelectSwu when Star Wars Unlimited button is clicked', async () => {
    const onSelectSwu = vi.fn()
    const user = userEvent.setup()
    render(<SwuGameSelectScreen onSelectSwu={onSelectSwu} onSelectXwing={vi.fn()} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /star wars unlimited/i }))
    expect(onSelectSwu).toHaveBeenCalledOnce()
  })

  it('calls onSelectXwing when Star Wars X-Wing button is clicked', async () => {
    const onSelectXwing = vi.fn()
    const user = userEvent.setup()
    render(<SwuGameSelectScreen onSelectSwu={vi.fn()} onSelectXwing={onSelectXwing} onHelp={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /star wars x-wing/i }))
    expect(onSelectXwing).toHaveBeenCalledOnce()
  })

  // ── Help ──────────────────────────────────────────────────────────────────

  it('renders the help button', () => {
    render(<SwuGameSelectScreen onSelectSwu={vi.fn()} onSelectXwing={vi.fn()} onHelp={vi.fn()} />)
    expect(screen.getByRole('button', { name: /help/i })).toBeInTheDocument()
  })

  it('calls onHelp when help button is clicked', async () => {
    const onHelp = vi.fn()
    const user = userEvent.setup()
    render(<SwuGameSelectScreen onSelectSwu={vi.fn()} onSelectXwing={vi.fn()} onHelp={onHelp} />)
    await user.click(screen.getByRole('button', { name: /help/i }))
    expect(onHelp).toHaveBeenCalledOnce()
  })

})
