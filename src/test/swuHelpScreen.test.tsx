import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuHelpScreen from '../components/swuHelpScreen'

describe('SwuHelpScreen', () => {

  // --- Rendering ---

  it('Renders a Help heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /help/i })).toBeInTheDocument()
  })

  it('Renders the Getting Started section heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} />)
    expect(screen.getByText('Getting Started')).toBeInTheDocument()
  })

  it('Renders the During a Game section heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} />)
    expect(screen.getByText('During a Game')).toBeInTheDocument()
  })

  it('Renders the Hyperspace Variant section heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} />)
    expect(screen.getByText('Hyperspace Variant')).toBeInTheDocument()
  })

  it('Renders the Formats and Base Selection section heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} />)
    expect(screen.getByText('Formats and Base Selection')).toBeInTheDocument()
  })

  it('Renders the Troubleshooting section heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} />)
    expect(screen.getByText('Troubleshooting')).toBeInTheDocument()
  })

  it('Renders a back button', () => {
    render(<SwuHelpScreen onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: '<' })).toBeInTheDocument()
  })

  // --- Scrolling ---

  it('Content area permits scrolling', () => {
    render(<SwuHelpScreen onBack={vi.fn()} />)
    const content = screen.getByTestId('help-content')
    expect(content).toHaveStyle({ overflowY: 'auto' })
  })

  // --- Navigation ---

  it('Calls onBack when back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<SwuHelpScreen onBack={onBack} />)
    await user.click(screen.getByRole('button', { name: '<' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

})