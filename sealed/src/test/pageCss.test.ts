import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESKTOP_QUERY } from '../hooks/useMediaQuery'

// Read as written: jsdom applies no stylesheet, and the behaviour these pin is the installed iPhone
// app's, which no test can render.
const SEALED = fileURLToPath(new URL('../../', import.meta.url))
const css = readFileSync(join(SEALED, 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of every rule whose selector list is exactly `selector`, inside `within` if given. */
function rule(selector: string, within = css): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...within.matchAll(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map(m => m[1]).join(';')
}

/** The body of the `@media <query>` block. */
function media(query: string): string {
  const start = css.indexOf(`@media ${query}`)
  if (start < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  return ''
}

const squash = (s: string) => s.replace(/\s+/g, ' ')

describe('sealed index.css', () => {
  /**
   * Under the translucent status bar, the installed app's page is drawn from the top of the screen
   * but iOS still reports the window short by the top inset (793 of an 852pt screen in portrait), and
   * nothing below a page that tall is drawn: a plain strip at the bottom. The PWA's stylesheet makes
   * the page taller by that inset; this is the same rule.
   */
  it('makes the page taller by the top inset, as the PWA does', () => {
    expect(squash(rule('html'))).toContain('min-height: calc(100% + env(safe-area-inset-top))')
  })

  /**
   * The taller page would scroll by the inset, so on a phone, where every screen is pinned to the
   * window and scrolls inside itself, the page does not scroll, as the PWA's does not. A desktop
   * setup grows with its content and scrolls the page, so it is left alone.
   */
  it('stops the page scrolling on a phone only', () => {
    // Not the setup screen's desktop layout, by the same query.
    const phone = media(`not all and ${DESKTOP_QUERY}`)
    expect(squash(rule('html, body', phone))).toContain('overflow: hidden')
    expect(rule('html, body', css.replace(phone, ''))).not.toContain('overflow')
  })
})
