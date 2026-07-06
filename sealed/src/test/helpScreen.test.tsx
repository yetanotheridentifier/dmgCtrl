import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HelpScreen from '../components/helpScreen'

describe('HelpScreen', () => {
  it('renders the user guide content', () => {
    render(<HelpScreen onBack={vi.fn()} />)
    const content = screen.getByTestId('help-content')
    expect(content.innerHTML).toContain('Importing a deck')
    expect(content.innerHTML).toContain('Playing a game')
  })

  it('back button returns to the previous screen', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<HelpScreen onBack={onBack} />)
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
