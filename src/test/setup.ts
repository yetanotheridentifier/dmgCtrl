import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'

function makeMatchMediaMock(isPortrait = false) {
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

export { makeMatchMediaMock }
