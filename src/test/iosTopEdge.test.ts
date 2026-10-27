import { describe, it, expect } from 'vitest'
import html from '../../index.html?raw'

const doc = new DOMParser().parseFromString(html, 'text/html')
const meta = (name: string) => doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content')
const styles = [...doc.head.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n')

/** The declarations of `.ios-top-edge` inside the standalone-only media block. */
function standaloneRule(): Record<string, string> {
  const body = styles.match(/@media \(display-mode: standalone\) \{\s*\.ios-top-edge \{([^}]*)\}/)?.[1] ?? ''
  return Object.fromEntries(
    body.split(';').map((d: string) => d.split(':').map((s: string) => s.trim())).filter(([k, v]) => k && v),
  )
}

describe('the page draws under the status bar', () => {
  it('keeps viewport-fit=cover and the translucent status bar', () => {
    expect(meta('viewport')).toContain('viewport-fit=cover')
    expect(meta('apple-mobile-web-app-status-bar-style')).toBe('black-translucent')
  })
})

describe('the top-edge strip that iOS samples', () => {
  const strip = doc.querySelector('body > .ios-top-edge')

  it('is in the page from the first frame, hidden from assistive tech', () => {
    expect(strip).not.toBeNull()
    expect(strip?.getAttribute('aria-hidden')).toBe('true')
  })

  it('is hidden outside an installed app', () => {
    expect(styles).toMatch(/^\s*\.ios-top-edge \{ display: none; \}/m)
  })

  it('covers the top edge as WebKit requires: fixed, full width, taller than 10px', () => {
    const rule = standaloneRule()
    expect(rule).toMatchObject({ display: 'block', position: 'fixed', top: '0', left: '0', right: '0' })
    expect(parseInt(rule.height, 10)).toBeGreaterThan(10)
  })

  it('has the page colour to sample but paints nothing, and takes no input', () => {
    const rule = standaloneRule()
    expect(rule['background-color']).toBe('#000510')
    expect(rule['background-clip']).toBe('text')
    expect(rule['-webkit-background-clip']).toBe('text')
    expect(rule['pointer-events']).toBe('none')
  })
})
