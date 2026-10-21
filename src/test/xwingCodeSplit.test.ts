// @vitest-environment node
import { describe, it, expect } from 'vitest'
import app from '../App.tsx?raw'

// The X-Wing screens pull in the XWA card table, so they load as their own chunk when a player
// enters X-Wing instead of riding in the main bundle every SWU player downloads. A static import
// anywhere in App would fold them back in, so App must only reach them through import().

describe('X-Wing code split', () => {
  for (const screen of ['xwingSetupScreen', 'xwingGameScreen', 'xwingListsScreen']) {
    it(`App loads ${screen} with a dynamic import`, () => {
      expect(app).not.toMatch(new RegExp(`^import [^\\n]* from '\\./components/${screen}'`, 'm'))
      expect(app).toContain(`import('./components/${screen}')`)
    })
  }
})
