import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SwuSetupScreen from '../components/swuSetupScreen'

describe('SwuSetupScreen', () => {

  it('Renders the Enter Base Health heading', () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    expect(screen.getByText('Enter Base Health')).toBeInTheDocument()
  })

  it('Input field is present', () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    expect(screen.getByPlaceholderText('30')).toBeInTheDocument()
  })

  it('The > button is present', () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    expect(screen.getByText('>')).toBeInTheDocument()
  })

  it('No error message shown on initial render', () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    expect(screen.queryByText(/Valid values/)).not.toBeInTheDocument()
  })

  it('Submitting empty input calls onConfirm with 30', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} />)
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(30)
  })

  it('Submitting empty input does not show an error', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await user.click(screen.getByText('>'))
    expect(screen.queryByText(/Valid values/)).not.toBeInTheDocument()
  })

  it('Submitting 20 calls onConfirm with 20', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} />)
    await user.type(screen.getByPlaceholderText('30'), '20')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(20)
  })

  it('Submitting 28 calls onConfirm with 28', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} />)
    await user.type(screen.getByPlaceholderText('30'), '28')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(28)
  })

  it('Submitting 35 calls onConfirm with 35', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} />)
    await user.type(screen.getByPlaceholderText('30'), '35')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(35)
  })

  it('Submitting an invalid number shows valid values error', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('30'), '21')
    await user.click(screen.getByText('>'))
    expect(screen.getByText(/Valid values/)).toBeInTheDocument()
  })

  it('Error message clears when input changes', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('30'), '21')
    await user.click(screen.getByText('>'))
    expect(screen.getByText(/Valid values/)).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('30'), '0')
    expect(screen.queryByText(/Valid values/)).not.toBeInTheDocument()
  })

  it('Pressing Enter with a valid value calls onConfirm', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} />)
    await user.type(screen.getByPlaceholderText('30'), '30{Enter}')
    expect(onConfirm).toHaveBeenCalledWith(30)
  })

  it('Pressing Enter with an invalid value shows error', async () => {
    const user = userEvent.setup()
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    await user.type(screen.getByPlaceholderText('30'), '21{Enter}')
    expect(screen.getByText(/Valid values/)).toBeInTheDocument()
  })

})