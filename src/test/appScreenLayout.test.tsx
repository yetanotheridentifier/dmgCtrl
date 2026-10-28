import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AppScreenLayout from '../components/layout/appScreenLayout'

const indexCss = String(Object.values(import.meta.glob('../index.css', { query: '?raw', import: 'default', eager: true }))[0])

describe('AppScreenLayout', () => {
  it('Renders children', () => {
    render(<AppScreenLayout><p>Hello</p></AppScreenLayout>)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('Pads the content to the edge tokens', () => {
    render(<AppScreenLayout><p>content</p></AppScreenLayout>)
    expect(screen.getByTestId('content-wrapper')).toHaveStyle({
      paddingTop: 'var(--edge-top)',
      paddingBottom: 'var(--edge-bottom)',
      paddingLeft: 'var(--edge-left)',
      paddingRight: 'var(--edge-right)',
    })
  })
})

describe('the edge tokens', () => {
  // Content keeps clear of the screen's rounded corners: each edge is the safe-area inset or the edge
  // margin, whichever is larger (never the two added), and the top is the top clearance (index.css)
  // or the margin. One place to tune: no component reads an inset itself.
  const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../test/**', '!../**/*.test.*'], { query: '?raw', import: 'default', eager: true })
  const declared = (name: string) => indexCss.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()

  it('are the larger of the inset and a 16px margin on every edge', () => {
    expect(declared('edge-margin')).toBe('16px')
    for (const side of ['left', 'right', 'bottom']) {
      expect(declared(`screen-edge-${side}`)).toBe(`max(env(safe-area-inset-${side}, 0px), var(--edge-margin))`)
    }
    expect(declared('screen-edge-top')).toBe('max(var(--top-clearance), var(--edge-margin))')
  })

  // A screen turned against the phone (layout/fixedOrientation.tsx) points each edge token at the
  // screen edge its side lies along; everywhere else each token is its own screen edge.
  it('are the screen edges, and only the turned frame points them elsewhere', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) expect(declared(`edge-${side}`)).toBe(`var(--screen-edge-${side})`)
    const readers = Object.entries(sources)
      .filter(([, text]) => /--screen-edge-/.test(String(text)))
      .map(([file]) => file)
    expect(readers).toEqual(['../components/layout/fixedOrientation.tsx'])
  })

  it('are the only way components reach the screen edges', () => {
    const direct = Object.entries(sources)
      .filter(([, text]) => /safe-area-inset-|--top-clearance/.test(String(text)))
      .map(([file]) => file)
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    expect(direct).toEqual([])
  })
})

describe('the app font', () => {
  // Set once on body, so a sheet or overlay outside a screen's layout wrapper still has it rather
  // than the browser's serif default.
  const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../test/**', '!../**/*.test.*'], { query: '?raw', import: 'default', eager: true })

  it('is declared once, on body', () => {
    expect(indexCss.match(/body\s*\{[^}]*font-family:\s*([^;]+);/)?.[1].trim()).toBe("'Segoe UI', system-ui, sans-serif")
    expect(indexCss.match(/Segoe UI/g)).toHaveLength(1)
  })

  it('is set by no component', () => {
    const setters = Object.entries(sources)
      .filter(([, text]) => /Segoe UI/.test(String(text)))
      .map(([file]) => file)
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    expect(setters).toEqual([])
  })
})
