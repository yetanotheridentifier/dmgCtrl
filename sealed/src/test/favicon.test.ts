import { describe, it, expect, beforeEach } from 'vitest'
import { faviconHref, applyFavicon } from '../favicon'

describe('faviconHref', () => {
  it('uses the white dmgCtrl icon in dev (to tell the dev tab apart)', () => {
    expect(faviconHref(true, '/sealed/')).toBe('/sealed/dmgctrl-icon-192-white.svg')
  })

  it('uses the standard blue dmgCtrl icon in prod', () => {
    expect(faviconHref(false, '/sealed/')).toBe('/sealed/dmgCtrl-icon-192.png')
  })
})

describe('applyFavicon', () => {
  beforeEach(() => {
    document.head.innerHTML = '<link id="favicon" rel="icon" href="/sealed/dmgCtrl-icon-192.png" />'
  })

  it('swaps the favicon to the white icon in dev', () => {
    applyFavicon(true, '/sealed/')
    expect(document.getElementById('favicon')!.getAttribute('href')).toBe('/sealed/dmgctrl-icon-192-white.svg')
  })

  it('keeps the blue icon in prod', () => {
    applyFavicon(false, '/sealed/')
    expect(document.getElementById('favicon')!.getAttribute('href')).toBe('/sealed/dmgCtrl-icon-192.png')
  })

  it('no-ops safely when there is no favicon link', () => {
    document.head.innerHTML = ''
    expect(() => applyFavicon(true, '/sealed/')).not.toThrow()
  })
})
