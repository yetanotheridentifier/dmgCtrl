import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

describe('sealed index.html', () => {
  /**
   * Without viewport-fit=cover, iOS letterboxes the page in landscape and the starfield stops short
   * of the notch. The layouts pad by the safe-area insets (the --edge-* tokens), which are 0 unless
   * the page covers the screen, so content stays clear of the notch either way.
   */
  it('draws into the notch and the home indicator', () => {
    const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? ''
    expect(viewport.split(',').map(s => s.trim())).toContain('viewport-fit=cover')
  })
})
