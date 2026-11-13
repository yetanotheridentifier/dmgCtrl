import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'

/**
 * This file is the suite-wide setup, so it also runs for a file that opted into the `node`
 * environment with a `@vitest-environment` docblock. Those have no `window`, and a setup that
 * assumed one failed them before they reached their first test.
 */
const hasDom = typeof window !== 'undefined'

function makeMatchMediaMock(isPortrait = false) {
  if (!hasDom) return
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: isPortrait && query === '(orientation: portrait)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

makeMatchMediaMock()
beforeEach(() => makeMatchMediaMock())

// The app keeps some choices for the session (X-Wing setup's, the screen across an update reload),
// and jsdom's sessionStorage lasts the whole file, so each test starts a fresh session.
beforeEach(() => { if (hasDom) sessionStorage.clear() })

export { makeMatchMediaMock }
