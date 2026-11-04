/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, IconButton, OptionRow, SegmentedControl, SelectButton, Sheet, Stepper, Switch } from '@pwa-shared/controls'

// The PWA's shared controls, imported through the `@pwa-shared` alias. Rendering them here is what
// proves the alias resolves and that the controls run on Sealed's copy of React: a second copy
// would fail the first hook call. Their behaviour is the PWA's to test (src/test/controls.test.tsx);
// these check that Sealed gets them, styled from the shared tokens.

describe('the shared controls in Sealed', () => {
  it('Button fills primary with the accent token', async () => {
    const onClick = vi.fn()
    render(<Button variant="primary" onClick={onClick}>Play</Button>)
    const button = screen.getByRole('button', { name: 'Play' })
    expect(button.style.background).toBe('var(--color-accent)')
    await userEvent.setup().click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('IconButton is labelled and raised', () => {
    render(<IconButton label="Back">‹</IconButton>)
    expect(screen.getByRole('button', { name: 'Back' }).style.background).toBe('var(--color-surface-raised)')
  })

  it('SegmentedControl is a group with the chosen option pressed', () => {
    render(<SegmentedControl label="Opponent" options={[{ value: 'a', label: 'Easy' }, { value: 'b', label: 'Hard' }]} value="b" onChange={() => {}} />)
    expect(screen.getByRole('group', { name: 'Opponent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hard' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('SelectButton names its value', () => {
    render(<SelectButton label="Deck" value="Vader" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Deck: Vader' })).toBeInTheDocument()
  })

  it('OptionRow is a button with its title', () => {
    render(<OptionRow title="Random deck" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: /Random deck/ })).toBeInTheDocument()
  })

  it('Stepper steps within its bounds', async () => {
    const onChange = vi.fn()
    render(<Stepper label="Delay" value={1} min={1} max={3} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Decrease delay' })).toBeDisabled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Increase delay' }))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('Sheet is a modal dialog on the sheet token', () => {
    render(<Sheet open title="Choose a deck" onClose={() => {}}>Decks</Sheet>)
    const dialog = screen.getByRole('dialog', { name: 'Choose a deck' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByTestId('sheet-backdrop').style.background).toBe('var(--color-backdrop)')
  })

  it('Switch toggles and fills with the accent when on', async () => {
    const onChange = vi.fn()
    render(<Switch label="Fast AI" checked onChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: 'Fast AI' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect((toggle.firstElementChild as HTMLElement).style.background).toBe('var(--color-accent)')
    await userEvent.setup().click(toggle)
    expect(onChange).toHaveBeenCalledWith(false)
  })
})
