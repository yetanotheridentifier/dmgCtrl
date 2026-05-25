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

// ---------------------------------------------------------------------------
// values list mode (non-uniform steps, e.g. X-Wing test value)
// ---------------------------------------------------------------------------

describe('TimerStepper with values list', () => {

  const listProps = {
    label: 'Game Timer',
    value: 30,
    values: [5.5, 30, 35, 75, 90] as number[],
    onChange: vi.fn(),
    testId: 'game-timer-stepper',
  }

  it('renders the current value using default format', () => {
    render(<TimerStepper {...listProps} />)
    expect(screen.getByTestId('game-timer-stepper')).toHaveTextContent('30 min')
  })

  it('renders a custom formatted value when formatValue is provided', () => {
    const formatValue = (v: number) => v === 5.5 ? '5:30 (test)' : `${v} min`
    render(<TimerStepper {...listProps} value={5.5} formatValue={formatValue} />)
    expect(screen.getByTestId('game-timer-stepper')).toHaveTextContent('5:30 (test)')
  })

  it('clicking + calls onChange with the next value in the list', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TimerStepper {...listProps} value={30} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '+' }))
    expect(onChange).toHaveBeenCalledWith(35)
  })

  it('clicking − calls onChange with the previous value in the list', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TimerStepper {...listProps} value={30} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: '−' }))
    expect(onChange).toHaveBeenCalledWith(5.5)
  })

  it('stepping down from non-uniform gap reaches correct value', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TimerStepper {...listProps} value={5.5} onChange={onChange} />)
    // 5.5 is first in list — − is disabled, + goes to 30
    await user.click(screen.getByRole('button', { name: '+' }))
    expect(onChange).toHaveBeenCalledWith(30)
  })

  it('+ is disabled at the last value in the list', () => {
    render(<TimerStepper {...listProps} value={90} />)
    expect(screen.getByRole('button', { name: '+' })).toBeDisabled()
  })

  it('− is disabled at the first value in the list', () => {
    render(<TimerStepper {...listProps} value={5.5} />)
    expect(screen.getByRole('button', { name: '−' })).toBeDisabled()
  })

  it('+ is enabled when not at the last value', () => {
    render(<TimerStepper {...listProps} value={30} />)
    expect(screen.getByRole('button', { name: '+' })).not.toBeDisabled()
  })

  it('− is enabled when not at the first value', () => {
    render(<TimerStepper {...listProps} value={30} />)
    expect(screen.getByRole('button', { name: '−' })).not.toBeDisabled()
  })

})
