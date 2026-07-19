import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { NameCardOverlay } from '../components/gameScreen'

/** The "name a card" text-input overlay for Ryder Azadi (#355). */
describe('NameCardOverlay', () => {
  const NAMES = ['Darth Vader', 'Luke Skywalker', 'Han Solo', 'Boba Fett']

  it('lists every nameable card and reports the picked name', () => {
    const onPick = vi.fn()
    render(<NameCardOverlay names={NAMES} onPick={onPick} />)
    const overlay = screen.getByTestId('name-card-overlay')
    expect(within(overlay).getAllByRole('button')).toHaveLength(NAMES.length)
    fireEvent.click(screen.getByText('Han Solo'))
    expect(onPick).toHaveBeenCalledWith('Han Solo')
  })

  it('filters the list by a case-insensitive substring as you type', () => {
    render(<NameCardOverlay names={NAMES} onPick={vi.fn()} />)
    fireEvent.change(screen.getByTestId('name-card-input'), { target: { value: 'sky' } })
    const overlay = screen.getByTestId('name-card-overlay')
    expect(within(overlay).getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText('Luke Skywalker')).toBeInTheDocument()
    expect(screen.queryByText('Darth Vader')).toBeNull()
  })

  it('shows a "no match" message when nothing matches', () => {
    render(<NameCardOverlay names={NAMES} onPick={vi.fn()} />)
    fireEvent.change(screen.getByTestId('name-card-input'), { target: { value: 'zzz' } })
    expect(screen.getByText('No match')).toBeInTheDocument()
  })
})
