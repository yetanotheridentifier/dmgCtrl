import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

describe('App shell', () => {
  it('renders the app title', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /dmgctrl · sealed/i })).toBeInTheDocument()
  })

  it('shows the dmgCtrl icon left of the title', () => {
    render(<App />)
    const icon = screen.getByRole('img', { name: /dmgctrl/i })
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('src', expect.stringContaining('dmgCtrl-icon-192.png'))
  })

  it('shows the deck selection screen initially', () => {
    render(<App />)
    expect(screen.getByTestId('deck-select-screen')).toBeInTheDocument()
  })

  it('does not show the game screen initially', () => {
    render(<App />)
    expect(screen.queryByTestId('game-screen')).not.toBeInTheDocument()
  })

  it('opens help from the header and returns to the previous screen', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /help/i }))
    expect(screen.getByTestId('help-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('deck-select-screen')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(screen.getByTestId('deck-select-screen')).toBeInTheDocument()
  })
})
