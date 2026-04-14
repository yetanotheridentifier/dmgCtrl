import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

describe('App', () => {

  it('Renders with an initial counter value of zero', () => {
    render(<App />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('Renders a + button and a − button', () => {
    render(<App />)
    expect(screen.getByText('+')).toBeInTheDocument()
    expect(screen.getByText('−')).toBeInTheDocument()
  })

  it('Increments the counter when + is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByText('+'))
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('Decrements the counter when − is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('+'))
    await user.click(screen.getByText('−'))
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('Can not decrement below zero', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByText('−'))
    await user.click(screen.getByText('−'))
    expect(screen.getByText('0')).toBeInTheDocument()
  })

})