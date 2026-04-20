import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AppScreenLayout from '../components/layout/AppScreenLayout'

describe('AppScreenLayout', () => {

  // --- Children ---

  it('Renders children', () => {
    render(<AppScreenLayout><p>Hello</p></AppScreenLayout>)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('Renders multiple children', () => {
    render(
      <AppScreenLayout>
        <p>First</p>
        <p>Second</p>
      </AppScreenLayout>
    )
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  // --- Content wrapper ---

  it('Content wrapper has safe-area padding on all sides', () => {
    render(<AppScreenLayout><p>content</p></AppScreenLayout>)
    const wrapper = screen.getByTestId('content-wrapper')
    expect(wrapper).toHaveStyle({
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
    })
  })

})