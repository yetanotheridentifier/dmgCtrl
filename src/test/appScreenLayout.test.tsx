import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AppScreenLayout from '../components/layout/appScreenLayout'

describe('AppScreenLayout', () => {
  it('Renders children', () => {
    render(<AppScreenLayout><p>Hello</p></AppScreenLayout>)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('Pads the content by the safe area, with the top clearance at the top', () => {
    render(<AppScreenLayout><p>content</p></AppScreenLayout>)
    expect(screen.getByTestId('content-wrapper')).toHaveStyle({
      paddingTop: 'var(--top-clearance)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
    })
  })
})

describe('the top clearance', () => {
  // On iPhone, iOS fades the top of the installed app below the status bar, so content clears
  // the top inset by --top-clearance (index.css). One value to tune: no component reads the inset.
  const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../test/**', '!../**/*.test.*'], { query: '?raw', import: 'default', eager: true })

  it('is the only way components reach the top inset', () => {
    const direct = Object.entries(sources).filter(([, text]) => String(text).includes('safe-area-inset-top')).map(([file]) => file)
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    expect(direct).toEqual([])
  })
})
