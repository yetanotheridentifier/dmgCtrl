import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HelpScreen from '../components/helpScreen'
import { makeMatchMediaMock } from './setup'
import { RELEASE } from '../buildIdentity'

type Source = Parameters<typeof HelpScreen>[0]['source']

const sectionLinks = () => within(screen.getByRole('navigation', { name: 'Sections' })).getAllByRole('button')
const currentSection = () => sectionLinks().filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)

describe('HelpScreen', () => {

  // --- Which page and section opens from each screen ---

  it.each<[Source, string, string]>([
    ['setup', 'SWU help', 'Setup'],
    ['game', 'SWU help', 'Game'],
    ['tournament', 'SWU help', 'Tournament'],
    ['xwingSetup', 'X-Wing help', 'Setup'],
    ['xwingLists', 'X-Wing help', 'Squad lists'],
    ['xwing', 'X-Wing help', 'Game'],
    ['gameSelect', 'Help', 'Starting the app'],
  ])('opened from %s: the %s page at %s', (source, title, section) => {
    render(<HelpScreen onBack={vi.fn()} source={source} />)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(currentSection()).toEqual([section])
  })

  it.each<[Source, string[]]>([
    ['game', ['Setup', 'Game', 'Tournament', 'Rules']],
    ['xwing', ['Setup', 'Squad lists', 'Game', 'Tournament', 'Rules']],
    ['gameSelect', ['Starting the app', 'Install', 'About']],
  ])('the page opened from %s has the sections %j, each a heading in the content', (source, sections) => {
    render(<HelpScreen onBack={vi.fn()} source={source} />)
    expect(sectionLinks().map(b => b.textContent)).toEqual(sections)
    const content = screen.getByTestId('help-content')
    expect(within(content).getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(sections)
  })

  it('has one h1: the markdown title is not repeated in the content', () => {
    render(<HelpScreen onBack={vi.fn()} source="game" />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('a section link marks that section as the current one', async () => {
    const user = userEvent.setup()
    render(<HelpScreen onBack={vi.fn()} source="game" />)
    await user.click(within(screen.getByRole('navigation', { name: 'Sections' })).getByRole('button', { name: 'Rules' }))
    expect(currentSection()).toEqual(['Rules'])
  })

  // --- Content ---

  it('the game pages carry no settings table: each setting explains itself', () => {
    for (const source of ['game', 'xwing'] as const) {
      const { unmount } = render(<HelpScreen onBack={vi.fn()} source={source} />)
      expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
      expect(screen.queryByRole('table', { name: /setting/i })).not.toBeInTheDocument()
      expect(screen.getByTestId('help-content').textContent).not.toMatch(/\| Setting \|/)
      unmount()
    }
  })

  it('the app page holds the disclaimer for both games', () => {
    render(<HelpScreen onBack={vi.fn()} source="gameSelect" />)
    const text = screen.getByTestId('help-content').textContent ?? ''
    expect(text).toMatch(/unofficial fan site/)
    expect(text).toMatch(/Fantasy Flight Games/)
    expect(text).toMatch(/Atomic Mass Games/)
  })

  // --- Layout ---

  it('the content scrolls', () => {
    render(<HelpScreen onBack={vi.fn()} source="game" />)
    expect(screen.getByTestId('help-content')).toHaveStyle({ overflowY: 'auto' })
  })

  it('the content has no fill of its own: each section is a block of its own on the surface fill', () => {
    render(<HelpScreen onBack={vi.fn()} source="game" />)
    const content = screen.getByTestId('help-content')
    expect(content.style.background).toBe('')
    const blocks = within(content).getAllByRole('region')
    expect(blocks.map(b => b.getAttribute('aria-label'))).toEqual(['Setup', 'Game', 'Tournament', 'Rules'])
    for (const block of blocks) {
      expect(block.style).toMatchObject({ background: 'var(--color-surface)' })
      expect(within(block).getAllByRole('heading', { level: 2 })).toHaveLength(1)
    }
  })

  // jsdom has no layout: four 300px blocks with 12px gaps (tops 0, 312, 624, 936) in a 200px view.
  const layOut = () => {
    const content = screen.getByTestId('help-content')
    within(content).getAllByRole('region').forEach((block, i) => {
      Object.defineProperty(block, 'offsetTop', { configurable: true, value: i * 312 })
      Object.defineProperty(block, 'offsetHeight', { configurable: true, value: 300 })
    })
    Object.defineProperty(content, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 1236 })
    return content
  }
  const scrollTo = (content: HTMLElement, top: number) => {
    content.scrollTop = top
    fireEvent.scroll(content)
  }

  it.each<[string, number, string]>([
    ['at the top of the first section, only the bottom fades', 0, 'bottom'],
    ['mid-section at both edges, both fade', 150, 'top bottom'],
    ['the bottom edge in the gap between sections, only the top fades', 106, 'top'],
    ['the top edge at the top of a section, only the bottom fades', 312, 'bottom'],
    ['at the bottom of the last section, only the top fades', 1036, 'top'],
  ])('%s', (_, top, fade) => {
    render(<HelpScreen onBack={vi.fn()} source="game" />)
    const content = layOut()
    scrollTo(content, top)
    expect(content.getAttribute('data-fade')).toBe(fade)
  })

  it('with every section whole in view, nothing fades', () => {
    render(<HelpScreen onBack={vi.fn()} source="game" />)
    const content = layOut()
    Object.defineProperty(content, 'clientHeight', { configurable: true, value: 1236 })
    scrollTo(content, 0)
    expect(content.getAttribute('data-fade')).toBe('')
  })

  it('section links are a column in landscape', () => {
    render(<HelpScreen onBack={vi.fn()} source="game" />)
    expect(screen.getByRole('navigation', { name: 'Sections' })).toHaveStyle({ flexDirection: 'column' })
  })

  it.each<[Source, number]>([
    ['game', 2],
    ['xwing', 3],
    ['gameSelect', 2],
  ])('in portrait, the links from %s sit in two rows across the top (%i columns), with no sideways scroll', (source, columns) => {
    makeMatchMediaMock(true)
    render(<HelpScreen onBack={vi.fn()} source={source} />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    expect(nav).toHaveStyle({ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` })
    expect(nav.style.overflowX).toBe('')
  })

  it.each<Source>(['game', 'xwing', 'gameSelect'])('opened from %s, the foot of the content shows the build release, so a player can quote it', source => {
    render(<HelpScreen onBack={vi.fn()} source={source} />)
    const content = screen.getByTestId('help-content')
    const tag = within(content).getByTestId('build-tag')
    expect(tag).toHaveTextContent(RELEASE)
    expect(content.lastElementChild).toBe(tag)
  })

  it('Back calls onBack', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<HelpScreen onBack={onBack} source="setup" />)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  // --- Files ---

  it('only the three help pages exist and are imported', () => {
    const helpFiles = Object.keys(import.meta.glob('../../docs/*Help.md')).map(p => p.split('/').pop()).sort()
    expect(helpFiles).toEqual(['appHelp.md', 'swuHelp.md', 'xwingHelp.md'])
    const source = Object.values(import.meta.glob<string>('../components/helpScreen.tsx', { query: '?raw', import: 'default', eager: true }))[0]
    const imported = [...source.matchAll(/docs\/(\w+Help)\.md/g)].map(m => m[1]).sort()
    expect(imported).toEqual(['appHelp', 'swuHelp', 'xwingHelp'])
  })

})
