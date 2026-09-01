import userGuideHtml from '../../docs/userGuide.md'

/** Which screen the help was opened from. */
export type HelpContext = 'decks' | 'game'

/**
 * Which of the guide's top-level sections each screen shows, by heading text.
 *
 * The guide stays one file: it is the single owner of player-facing behaviour and is imported
 * at build time, so slicing it here beats splitting it into per-screen files that drift apart
 * and each need their own copy of the disclaimer. The cost is that this map is keyed on prose,
 * which `helpSections.test.ts` guards: every section must be claimed exactly once, so a renamed
 * or newly added heading fails the suite rather than quietly disappearing from the help.
 */
export const HELP_SECTIONS: Record<HelpContext, string[]> = {
  decks: ['Importing a deck', 'Caching a full set', 'Choosing an opponent'],
  game: ['Playing a game', 'After the game'],
}

export interface HelpSection {
  title: string
  html: string
}

export interface GuideParts {
  /** Everything after the title and before the first section: what the app is. */
  preamble: string
  sections: HelpSection[]
  /** The trailing block after the final rule: the fan-content disclaimer. */
  footer: string
}

const H1 = /^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/
const H2 = /<h2[^>]*>([\s\S]*?)<\/h2>/g
/** The last rule in the document opens the footer. */
const FOOTER = /<hr[^>]*>(?![\s\S]*<hr[^>]*>)/

/**
 * Break the rendered guide into its preamble, its `<h2>` sections and its trailing footer.
 * Splitting on `<h2>` only, so a section keeps its own subsections.
 */
export function splitSections(html: string): GuideParts {
  const withoutTitle = html.replace(H1, '')

  const footerMatch = FOOTER.exec(withoutTitle)
  const body = footerMatch ? withoutTitle.slice(0, footerMatch.index) : withoutTitle
  const footer = footerMatch ? withoutTitle.slice(footerMatch.index + footerMatch[0].length) : ''

  const starts: { title: string; at: number }[] = []
  for (const match of body.matchAll(H2)) {
    starts.push({ title: match[1].trim(), at: match.index })
  }

  const preamble = body.slice(0, starts.length > 0 ? starts[0].at : body.length)
  const sections = starts.map((start, i) => ({
    title: start.title,
    html: body.slice(start.at, i + 1 < starts.length ? starts[i + 1].at : body.length),
  }))

  return { preamble: preamble.trim(), sections, footer: footer.trim() }
}

/**
 * The help content for one screen: the preamble, that screen's sections in the guide's own
 * order, then the footer. A section named in the map but absent from the guide is skipped
 * rather than throwing, so a mismatch costs a failing test rather than a blank help page in
 * someone's hands.
 */
export function helpContentFor(context: HelpContext): string {
  const { preamble, sections, footer } = splitSections(userGuideHtml)
  const wanted = new Set(HELP_SECTIONS[context])
  const chosen = sections.filter(s => wanted.has(s.title)).map(s => s.html)
  return [preamble, ...chosen, footer].filter(part => part.length > 0).join('\n')
}
