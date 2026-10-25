import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, IconButton, SegmentedControl, SelectButton, Stepper, Sheet } from '../components/shared/controls'

const mockOrientation = { isPortrait: false, vmin: 390 }
vi.mock('../hooks/useOrientation', () => ({
  useOrientation: () => mockOrientation,
}))

beforeEach(() => {
  mockOrientation.isPortrait = false
})

describe('Button', () => {
  it('is a button that calls onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go to game</Button>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go to game' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not call onClick when disabled', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick} disabled>Go to game</Button>)
    const button = screen.getByRole('button', { name: 'Go to game' })
    expect(button).toBeDisabled()
    await userEvent.setup().click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('is at least 44px tall', () => {
    render(<Button>Change list</Button>)
    expect(screen.getByRole('button')).toHaveStyle({ minHeight: '44px' })
  })

  it('fills primary with the accent and secondary with the tonal colour', () => {
    render(<><Button variant="primary">Primary</Button><Button>Secondary</Button></>)
    expect(screen.getByRole('button', { name: 'Primary' })).toHaveStyle({ background: 'var(--color-accent)' })
    expect(screen.getByRole('button', { name: 'Secondary' })).toHaveStyle({ background: 'var(--color-tonal)' })
  })

  it('does not submit a surrounding form', () => {
    render(<Button>Go</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })
})

describe('IconButton', () => {
  it('is named by its label', async () => {
    const onClick = vi.fn()
    render(<IconButton label="Back" onClick={onClick}><svg aria-hidden="true" /></IconButton>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is a 44px square', () => {
    render(<IconButton label="Log"><svg aria-hidden="true" /></IconButton>)
    expect(screen.getByRole('button', { name: 'Log' })).toHaveStyle({ width: '44px', height: '44px' })
  })
})

describe('SegmentedControl', () => {
  const options = [{ value: 'Casual', label: 'Casual' }, { value: 'Tournament', label: 'Tournament' }]

  it('is a labelled group with the selected option pressed', () => {
    render(<SegmentedControl label="Match" options={options} value="Casual" onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Match' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Casual' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Tournament' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports the tapped option', async () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Match" options={options} value="Casual" onChange={onChange} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tournament' }))
    expect(onChange).toHaveBeenCalledWith('Tournament')
  })

  it('can have nothing selected', () => {
    render(<SegmentedControl label="Initiative" options={options} value={null} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Casual' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Tournament' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('SelectButton', () => {
  it('shows the value and is named by label and value', () => {
    render(<SelectButton label="Scenario" value="Chance Engagement" onClick={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Scenario: Chance Engagement' })
    expect(button).toHaveTextContent('Chance Engagement')
  })

  it('says it opens a dialog, and opens it on tap', async () => {
    const onClick = vi.fn()
    render(<SelectButton label="Scenario" value="None" onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Scenario: None' })
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    await userEvent.setup().click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('Stepper', () => {
  it('shows the label and value', () => {
    render(<Stepper label="Deficit" value={2} min={0} max={4} onChange={vi.fn()} />)
    expect(screen.getByText('Deficit')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows the value in the primary text colour, whatever the page colour', () => {
    render(<Stepper label="Rounds" value={6} min={2} max={10} onChange={vi.fn()} />)
    expect(screen.getByText('6')).toHaveStyle({ color: 'var(--color-text-primary)' })
  })

  it('steps down and up by one', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Stepper label="Deficit" value={2} min={0} max={4} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Decrease deficit' }))
    await user.click(screen.getByRole('button', { name: 'Increase deficit' }))
    expect(onChange.mock.calls).toEqual([[1], [3]])
  })

  it('steps by the given step', async () => {
    const onChange = vi.fn()
    render(<Stepper label="Rounds" value={6} min={2} max={10} step={2} onChange={onChange} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Increase rounds' }))
    expect(onChange).toHaveBeenCalledWith(8)
  })

  it('disables the buttons at the limits', () => {
    const { rerender } = render(<Stepper label="Deficit" value={0} min={0} max={4} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Decrease deficit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Increase deficit' })).toBeEnabled()
    rerender(<Stepper label="Deficit" value={4} min={0} max={4} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Increase deficit' })).toBeDisabled()
  })
})

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    render(<Sheet open={false} title="Opponent's list" onClose={vi.fn()}>content</Sheet>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is a modal dialog named by its title, with its content', () => {
    render(<Sheet open title="Opponent's list" onClose={vi.fn()}><p>Resistance aces</p></Sheet>)
    const dialog = screen.getByRole('dialog', { name: "Opponent's list" })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('Resistance aces')
  })

  it('closes from its close button', async () => {
    const onClose = vi.fn()
    render(<Sheet open title="More" onClose={onClose}>content</Sheet>)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes when the backdrop is tapped', async () => {
    const onClose = vi.fn()
    render(<Sheet open title="More" onClose={onClose}>content</Sheet>)
    await userEvent.setup().click(screen.getByTestId('sheet-backdrop'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Sheet open title="More" onClose={onClose}>content</Sheet>)
    await userEvent.setup().keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not close when its content is tapped', async () => {
    const onClose = vi.fn()
    render(<Sheet open title="More" onClose={onClose}><p>Help</p></Sheet>)
    await userEvent.setup().click(screen.getByText('Help'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('comes in from the side in landscape and from the bottom in portrait', () => {
    const { rerender } = render(<Sheet open title="More" onClose={vi.fn()}>content</Sheet>)
    expect(screen.getByRole('dialog')).toHaveAttribute('data-placement', 'side')
    mockOrientation.isPortrait = true
    rerender(<Sheet open title="More" onClose={vi.fn()}>content</Sheet>)
    expect(screen.getByRole('dialog')).toHaveAttribute('data-placement', 'bottom')
  })

  it('a wide sheet fills the screen in landscape and still comes from the bottom in portrait', () => {
    const { rerender } = render(<Sheet open wide title="Choose your base" onClose={vi.fn()}>content</Sheet>)
    expect(screen.getByRole('dialog')).toHaveAttribute('data-placement', 'full')
    mockOrientation.isPortrait = true
    rerender(<Sheet open wide title="Choose your base" onClose={vi.fn()}>content</Sheet>)
    expect(screen.getByRole('dialog')).toHaveAttribute('data-placement', 'bottom')
  })
})
