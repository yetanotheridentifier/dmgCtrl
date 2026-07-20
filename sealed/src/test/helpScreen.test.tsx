import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Render as production, so the build tag belongs at the foot of the Help page.
vi.mock('../env', () => ({ isDev: () => false }))

import HelpScreen from '../components/helpScreen'
import { BUILD_TAG } from '../buildTag'

describe('HelpScreen', () => {
  it('renders the user guide content', () => {
    render(<HelpScreen onBack={vi.fn()} />)
    const content = screen.getByTestId('help-content')
    expect(content.innerHTML).toContain('Importing a deck')
    expect(content.innerHTML).toContain('Playing a game')
  })

  it('shows the fan-content disclaimer at the bottom', () => {
    render(<HelpScreen onBack={vi.fn()} />)
    expect(within(screen.getByTestId('help-screen')).getByText(/unofficial fan site/i)).toBeInTheDocument()
  })

  it('shows the build tag at the foot of the page in prod', () => {
    render(<HelpScreen onBack={vi.fn()} />)
    expect(screen.getByTestId('build-tag')).toHaveTextContent(BUILD_TAG)
  })

  it('back button returns to the previous screen', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<HelpScreen onBack={onBack} />)
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
