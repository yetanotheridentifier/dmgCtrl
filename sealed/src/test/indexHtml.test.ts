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

  /**
   * As the PWA's page has it. With the default style, the installed app's page starts below the
   * status bar, which iOS then tints from whatever covered the top last (a full-screen deck view left
   * it the sheet colour). Translucent, the page runs under the status bar and the starfield shows.
   */
  it('runs the installed app under a translucent status bar', () => {
    expect(html).toMatch(/<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" \/>/)
  })

  // iOS reads the status bar style only for a page that declares itself a web app, as the PWA's does.
  it.each(['apple-mobile-web-app-capable', 'mobile-web-app-capable'])('declares itself a web app (%s)', name => {
    expect(html).toContain(`<meta name="${name}" content="yes" />`)
  })
})
