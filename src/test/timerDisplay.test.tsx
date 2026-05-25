import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TimerDisplay from '../components/shared/timerDisplay'

describe('TimerDisplay', () => {

  // --- Content ---

  it('renders the formatted time', () => {
    render(<TimerDisplay remaining={300} />)
    expect(screen.getByTestId('timer-display')).toHaveTextContent('5:00')
  })

  it('uses the provided testId', () => {
    render(<TimerDisplay remaining={300} testId="score-timer" />)
    expect(screen.getByTestId('score-timer')).toBeInTheDocument()
  })

  it('applies style overrides', () => {
    render(<TimerDisplay remaining={400} style={{ fontSize: '10vmin' }} />)
    expect(screen.getByTestId('timer-display')).toHaveStyle({ fontSize: '10vmin' })
  })

  // --- Colour thresholds ---

  it('colour is --color-text-muted above 300 seconds (301)', () => {
    render(<TimerDisplay remaining={301} />)
    expect(screen.getByTestId('timer-display')).toHaveStyle({ color: 'var(--color-text-muted)' })
  })

  it('colour is --color-warning at exactly 300 seconds', () => {
    render(<TimerDisplay remaining={300} />)
    expect(screen.getByTestId('timer-display')).toHaveStyle({ color: 'var(--color-warning)' })
  })

  it('colour is --color-warning between 61 and 299 seconds (150)', () => {
    render(<TimerDisplay remaining={150} />)
    expect(screen.getByTestId('timer-display')).toHaveStyle({ color: 'var(--color-warning)' })
  })

  it('colour is --color-warning at exactly 61 seconds', () => {
    render(<TimerDisplay remaining={61} />)
    expect(screen.getByTestId('timer-display')).toHaveStyle({ color: 'var(--color-warning)' })
  })

  it('colour is --color-error at exactly 60 seconds', () => {
    render(<TimerDisplay remaining={60} />)
    expect(screen.getByTestId('timer-display')).toHaveStyle({ color: 'var(--color-error)' })
  })

  it('colour is --color-error below 60 seconds (30)', () => {
    render(<TimerDisplay remaining={30} />)
    expect(screen.getByTestId('timer-display')).toHaveStyle({ color: 'var(--color-error)' })
  })

  it('colour is --color-error at 0 seconds', () => {
    render(<TimerDisplay remaining={0} />)
    expect(screen.getByTestId('timer-display')).toHaveStyle({ color: 'var(--color-error)' })
  })

})
