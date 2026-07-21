import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BugReportOverlay } from '../components/bugReportOverlay'

const setup = (over: Partial<Parameters<typeof BugReportOverlay>[0]> = {}) => {
  const props = { onSubmit: vi.fn(), onCancel: vi.fn(), ...over }
  render(<BugReportOverlay {...props} />)
  return props
}

describe('BugReportOverlay', () => {
  it('asks for a title and a description', () => {
    setup()
    expect(screen.getByTestId('bug-report-title')).toBeInTheDocument()
    expect(screen.getByTestId('bug-report-description')).toBeInTheDocument()
  })

  it('cannot be submitted without a title', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    expect(screen.getByTestId('bug-report-submit')).toBeDisabled()

    await user.type(screen.getByTestId('bug-report-title'), 'Game hung')
    expect(screen.getByTestId('bug-report-submit')).toBeEnabled()
    await user.click(screen.getByTestId('bug-report-submit'))
    expect(onSubmit).toHaveBeenCalledWith('Game hung', '')
  })

  it('passes the description through', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup()
    await user.type(screen.getByTestId('bug-report-title'), 'Hang')
    await user.type(screen.getByTestId('bug-report-description'), 'After taking the initiative.')
    await user.click(screen.getByTestId('bug-report-submit'))
    expect(onSubmit).toHaveBeenCalledWith('Hang', 'After taking the initiative.')
  })

  it('cancels without submitting', async () => {
    const user = userEvent.setup()
    const { onCancel, onSubmit } = setup()
    await user.type(screen.getByTestId('bug-report-title'), 'Typed then abandoned')
    await user.click(screen.getByTestId('bug-report-cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  /**
   * The clipboard can fail (denied permission, or an insecure context), and the report is worth
   * more than the convenience — so the text is shown for manual copying rather than lost.
   */
  it('shows the report for manual copying when the clipboard was refused', () => {
    setup({ fallbackReport: '### What happened\nit broke' })
    expect(screen.getByTestId('bug-report-fallback')).toHaveValue('### What happened\nit broke')
    expect(screen.getByTestId('bug-report-error')).toHaveTextContent(/copy/i)
  })

  it('has no fallback box in the normal case', () => {
    setup()
    expect(screen.queryByTestId('bug-report-fallback')).toBeNull()
  })

  it('closes on Escape', () => {
    const { onCancel } = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
