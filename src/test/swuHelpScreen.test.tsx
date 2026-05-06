import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuHelpScreen from '../components/swuHelpScreen'

describe('SwuHelpScreen', () => {

  // --- Rendering ---

  it('Renders a Help heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    expect(screen.getByRole('heading', { name: /help/i })).toBeInTheDocument()
  })

  it('Markdown h1 title is not duplicated in the scrollable content', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    // The JSX header provides the h1; the markdown h1 should be stripped before rendering
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('Renders the About section heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    expect(screen.getByRole('heading', { level: 2, name: 'About' })).toBeInTheDocument()
  })

  it('Renders the Getting Started section heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Getting Started' })).toBeInTheDocument()
  })

  it('Renders the During a Game section heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="game" />)
    expect(screen.getByRole('heading', { level: 2, name: 'During a Game' })).toBeInTheDocument()
  })

  it('Renders the Settings section heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument()
  })

  it('Renders the Formats and Base Selection section heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Formats and Base Selection' })).toBeInTheDocument()
  })

  it('Renders the Troubleshooting section heading', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Troubleshooting' })).toBeInTheDocument()
  })

  it('Renders the app icon in the header', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    expect(screen.getByAltText('dmgCtrl')).toBeInTheDocument()
  })

  it('Renders a back button', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  // --- Scrolling ---

  it('Content area permits scrolling', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    const content = screen.getByTestId('help-content')
    expect(content).toHaveStyle({ overflowY: 'auto' })
  })

  // --- Navigation ---

  it('Calls onBack when back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<SwuHelpScreen onBack={onBack} source="setup" />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  // --- Source-specific content (setup vs game) ---

  it('source="setup" does not render the During a Game section', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    expect(screen.queryByRole('heading', { level: 2, name: 'During a Game' })).not.toBeInTheDocument()
  })

  it('source="setup" renders the Getting Started section', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="setup" />)
    expect(screen.getByRole('heading', { level: 2, name: 'Getting Started' })).toBeInTheDocument()
  })

  it('source="game" does not render the Getting Started section', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="game" />)
    expect(screen.queryByRole('heading', { level: 2, name: 'Getting Started' })).not.toBeInTheDocument()
  })

  it('source="game" renders the During a Game section', () => {
    render(<SwuHelpScreen onBack={vi.fn()} source="game" />)
    expect(screen.getByRole('heading', { level: 2, name: 'During a Game' })).toBeInTheDocument()
  })


})