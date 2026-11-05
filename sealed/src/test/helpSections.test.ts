import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import userGuideHtml from '../../docs/userGuide.md'
import { parseGuide, OPENS_AT, SHARING_HELP_SECTION } from '../utils/helpSections'

const guide = parseGuide(userGuideHtml)
const section = (title: string) => guide.sections.find(s => s.title === title)!

describe('help sections', () => {
  describe('parseGuide', () => {
    it('splits a page into its h2 sections, and a section into its h3 topics', () => {
      const page = parseGuide('<h1>Title</h1>\n<p>gone</p>\n<h2>One</h2>\n<p>a</p>\n<h2>Two</h2>\n<p>b</p>\n<h3>Topic &amp; more</h3>\n<p>c</p>\n<h3>Last</h3>\n<p>d</p>\n')

      expect(page.title).toBe('Title')
      expect(page.sections.map(s => s.title)).toEqual(['One', 'Two'])
      expect(page.sections[0]).toMatchObject({ html: '<h2>One</h2>\n<p>a</p>\n', topics: [] })
      expect(page.sections[1].html).toBe('<h2>Two</h2>\n<p>b</p>\n')
      expect(page.sections[1].topics).toEqual([
        { title: 'Topic & more', html: '<p>c</p>\n' },
        { title: 'Last', html: '<p>d</p>\n' },
      ])
    })
  })

  describe('the guide', () => {
    it('is titled Sealed help', () => {
      expect(guide.title).toBe('Sealed help')
    })

    it('has the six sections of the design, in order, and no Settings section', () => {
      expect(guide.sections.map(s => s.title)).toEqual(['Decks', 'Opponent', 'Playing', 'The board', 'Prompts', 'After the game'])
    })

    it('splits The board into its tap-to-open topics, and no other section', () => {
      expect(section('The board').topics.map(t => t.title)).toEqual([
        'Arenas, bases and leaders',
        'Damage, tokens and badges',
        'Target colours',
        'The Force and Credit tokens',
        'Seeing a card and the log',
      ])
      for (const s of guide.sections.filter(s => s.title !== 'The board')) {
        expect(s.topics, s.title).toEqual([])
      }
    })

    /** The disclaimer is the app help page's, which covers Sealed's cards too. */
    it('carries no disclaimer, which the app help page holds', () => {
      expect(userGuideHtml).not.toMatch(/unofficial fan site/i)
      const appHelp = readFileSync(new URL('../../../docs/appHelp.md', import.meta.url), 'utf8')
      expect(appHelp).toMatch(/unofficial fan site/)
      expect(appHelp).toContain('Star Wars: Unlimited cards')
    })

    it('opens at a section the guide has, from each screen and from the link on sharing games', () => {
      const titles = guide.sections.map(s => s.title)
      expect(OPENS_AT).toEqual({ decks: 'Decks', game: 'Playing' })
      expect(titles).toContain(SHARING_HELP_SECTION)
      expect(section(SHARING_HELP_SECTION).html).toContain('What is sent')
    })
  })
})
