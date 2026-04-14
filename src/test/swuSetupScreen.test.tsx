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
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('The > button is present', () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    expect(screen.getByText('>')).toBeInTheDocument()
  })

  it('Select defaults to unselected state', () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('')
})

  it('Select contains all valid health options', () => {
    render(<SwuSetupScreen onConfirm={vi.fn()} />)
    const select = screen.getByRole('combobox')
    const options = Array.from(select.querySelectorAll('option'))
        .filter(o => !o.disabled)
        .map(o => parseInt(o.value, 10))
    expect(options).toEqual([20, 25, 26, 27, 28, 30, 33, 34, 35])
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
    await user.selectOptions(screen.getByRole('combobox'), '20')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(20)
  })

  it('Submitting 28 calls onConfirm with 28', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} />)
    await user.selectOptions(screen.getByRole('combobox'), '28')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(28)
  })

  it('Submitting 35 calls onConfirm with 35', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<SwuSetupScreen onConfirm={onConfirm} />)
    await user.selectOptions(screen.getByRole('combobox'), '35')
    await user.click(screen.getByText('>'))
    expect(onConfirm).toHaveBeenCalledWith(35)
  })

})