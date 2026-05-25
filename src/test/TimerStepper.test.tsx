import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TimerStepper from '../components/shared/TimerStepper'

const defaultProps = {
  label: 'Game Timer',
  value: 75,
  min: 30,
  max: 90,
  step: 5,
  onChange: vi.fn(),
  testId: 'game-timer-stepper',
}

describe('TimerStepper', () => {

  // --- Rendering ---

  it('renders the label', () => {
    render(<TimerStepper {...defaultProps} />)
    expect(screen.getByText('Game Timer')).toBeInTheDocument()
  })

  it('renders the current value', () => {
    render(<TimerStepper {...defaultProps} />)
    expect(screen.getByTestId('game-timer-stepper')).toHaveTextContent('75')
  })

  it('renders + and − buttons', () => {
    render(<TimerStepper {...defaultProps} />)
    expect(screen.getByRole('button', { name: '+' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '−' })).toBeInTheDocument()
  })

  // --- Interactions ---

  it('clicking + calls onChange with value + step', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TimerStepper {...defaultProps} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '+' }))
    expect(onChange).toHaveBeenCalledWith(80)
  })

  it('clicking − calls onChange with value − step', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TimerStepper {...defaultProps} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '−' }))
    expect(onChange).toHaveBeenCalledWith(70)
  })

  // --- Boundary clamping ---

  it('+ is disabled at max', () => {
    render(<TimerStepper {...defaultProps} value={90} />)
    expect(screen.getByRole('button', { name: '+' })).toBeDisabled()
  })

  it('− is disabled at min', () => {
    render(<TimerStepper {...defaultProps} value={30} />)
    expect(screen.getByRole('button', { name: '−' })).toBeDisabled()
  })

  it('+ is enabled below max', () => {
    render(<TimerStepper {...defaultProps} value={85} />)
    expect(screen.getByRole('button', { name: '+' })).not.toBeDisabled()
  })

  it('− is enabled above min', () => {
    render(<TimerStepper {...defaultProps} value={35} />)
    expect(screen.getByRole('button', { name: '−' })).not.toBeDisabled()
  })

})
