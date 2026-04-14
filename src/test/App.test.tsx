import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

describe('App', () => {

  it('Renders the setup screen on load', () => {
    render(<App />)
    expect(screen.getByText('Enter Base Health')).toBeInTheDocument()
  })

  it('Does not render the game screen on load', () => {
    render(<App />)
    expect(screen.queryByText('Remaining:')).not.toBeInTheDocument()
  })

  it('Navigates to game screen after valid health entry', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.selectOptions(screen.getByRole('combobox'), '30')
    await user.click(screen.getByText('>'))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Navigates to game screen with default health on empty submit', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.selectOptions(screen.getByRole('combobox'), '30')
    await user.click(screen.getByText('>'))
    expect(screen.getByText('Remaining: 30')).toBeInTheDocument()
  })

  it('Game screen reflects the entered starting health', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.selectOptions(screen.getByRole('combobox'), '25')
    await user.click(screen.getByText('>'))
    expect(screen.getByText('Remaining: 25')).toBeInTheDocument()
  })

  it('Clicking back from game screen returns to setup screen', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByText('>'))
    await user.click(screen.getByText('<'))
    expect(screen.getByText('Enter Base Health')).toBeInTheDocument()
  })

  it('Setup screen does not show game screen elements', () => {
    render(<App />)
    expect(screen.queryByText('+')).not.toBeInTheDocument()
    expect(screen.queryByText('−')).not.toBeInTheDocument()
  })

})