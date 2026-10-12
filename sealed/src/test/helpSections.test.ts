import { describe, it, expect } from 'vitest'
import userGuideHtml from '../../docs/userGuide.md'
import { splitSections, helpContentFor, helpSectionContent, HELP_SECTIONS, SHARING_HELP_SECTION } from '../utils/helpSections'
import type { HelpContext } from '../utils/helpSections'

const CONTEXTS: HelpContext[] = ['decks', 'game']

describe('help sections', () => {
  describe('splitSections', () => {
    const { preamble, sections, footer } = splitSections(userGuideHtml)

    it('finds the guide’s top-level sections, in order', () => {
      expect(sections.map(s => s.title)).toEqual([
        'Importing a deck',
        'Caching a full set',
        'Choosing an opponent',
        'Improving the bot',
        'Playing a game',
        'After the game',
      ])
    })

    it('keeps a section’s subsections with it rather than splitting on them', () => {
      const playing = sections.find(s => s.title === 'Playing a game')!
      expect(playing.html).toContain('Turn structure')
      expect(playing.html).toContain('Keywords, upgrades &amp; card abilities')
    })

    it('takes the opening paragraph as a preamble, without the title', () => {
      expect(preamble).toContain('against an AI opponent')
      expect(preamble).not.toContain('<h1')
    })

    /** The disclaimer trails the last section but belongs to no section. */
    it('separates the trailing footer from the last section', () => {
      expect(footer).toContain('unofficial fan site')
      expect(sections.find(s => s.title === 'After the game')!.html).not.toContain('unofficial fan site')
    })
  })

  describe('the context map', () => {
    /**
     * The guide is the single source and is sliced by heading, so a renamed or newly added
     * section would silently vanish from the help rather than failing a build. These two
     * assertions are what make that loud.
     */
    it('claims every section of the guide exactly once', () => {
      const claimed = CONTEXTS.flatMap(c => HELP_SECTIONS[c])
      const inGuide = splitSections(userGuideHtml).sections.map(s => s.title)

      expect([...claimed].sort()).toEqual([...inGuide].sort())
      expect(new Set(claimed).size).toBe(claimed.length)
    })

    it('names no section the guide does not have', () => {
      const inGuide = new Set(splitSections(userGuideHtml).sections.map(s => s.title))
      for (const context of CONTEXTS) {
        for (const title of HELP_SECTIONS[context]) {
          expect(inGuide.has(title), `${context} names a missing section: ${title}`).toBe(true)
        }
      }
    })
  })

  describe('helpContentFor', () => {
    it('gives the deck screen importing and opponent choice, not how to play', () => {
      const html = helpContentFor('decks')
      expect(html).toContain('Importing a deck')
      expect(html).toContain('Choosing an opponent')
      expect(html).not.toContain('Turn structure')
      expect(html).not.toContain('After the game')
    })

    it('gives the game screen play and not deck importing', () => {
      const html = helpContentFor('game')
      expect(html).toContain('Playing a game')
      expect(html).toContain('Turn structure')
      expect(html).toContain('After the game')
      expect(html).not.toContain('Importing a deck')
    })

    /** Both are legal notices or orientation: they belong wherever help is opened. */
    it('carries the preamble and the disclaimer into every context', () => {
      for (const context of CONTEXTS) {
        expect(helpContentFor(context)).toContain('against an AI opponent')
        expect(helpContentFor(context)).toContain('unofficial fan site')
      }
    })

    it('never renders the guide’s own title', () => {
      for (const context of CONTEXTS) {
        expect(helpContentFor(context)).not.toContain('<h1')
      }
    })

    /** The notice and the pill are on the deck screen, so that is where its help belongs. */
    it('gives the deck screen the section on sharing games', () => {
      expect(HELP_SECTIONS.decks).toContain(SHARING_HELP_SECTION)
      expect(helpContentFor('decks')).toContain('Improving the bot')
      expect(helpContentFor('game')).not.toContain('Improving the bot')
    })
  })

  /**
   * Settings links straight to one section, and Settings opens in a game as well, where the
   * game's help does not carry it. So one section can be asked for by name, from either screen.
   */
  describe('helpSectionContent', () => {
    it('gives that section alone, with the disclaimer', () => {
      const html = helpSectionContent(SHARING_HELP_SECTION)

      expect(html).toContain('Improving the bot')
      expect(html).toContain('What is sent')
      expect(html).toContain('does not recall games already sent')
      expect(html).toContain('unofficial fan site')
      expect(html).not.toContain('Importing a deck')
      expect(html).not.toContain('Turn structure')
      expect(html).not.toContain('<h1')
    })

    it('gives nothing for a section the guide does not have', () => {
      expect(helpSectionContent('No such section')).toBe('')
    })
  })
})
