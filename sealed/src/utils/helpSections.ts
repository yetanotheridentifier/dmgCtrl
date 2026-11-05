/** Which screen the help was opened from. */
export type HelpContext = 'decks' | 'game'

/** The section help opens at, for the screen it was opened from. */
export const OPENS_AT: Record<HelpContext, string> = { decks: 'Decks', game: 'Playing' }

/** The section that says what sharing games sends, which Settings links to by name. */
export const SHARING_HELP_SECTION = 'After the game'

/** A tap-to-open topic within a section: one `###` and what follows it. */
export interface HelpTopic {
  title: string
  html: string
}

/** One `##` of the guide: its heading and text up to its first topic, then its topics. */
export interface HelpSection {
  title: string
  html: string
  topics: HelpTopic[]
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').trim()

/** Turns the few entities markdown writes into heading text back into characters, for labels. */
const decode = (text: string) =>
  text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

const headingText = (html: string, level: 1 | 2 | 3) =>
  decode(stripTags(html.match(new RegExp(`<h${level}[^>]*>([\\s\\S]*?)</h${level}>`))?.[1] ?? ''))

/**
 * The rendered guide as a page: its `#` is the page title, each `##` a section, and each `###`
 * within a section a topic that opens on a tap. Anything before the first section is not shown.
 * The split follows the PWA's `parsePage` (src/components/helpScreen.tsx), with topics added.
 */
export function parseGuide(html: string): { title: string; sections: HelpSection[] } {
  const title = headingText(html, 1) || 'Help'
  const sections = html.split(/(?=<h2[^>]*>)/)
    .filter(chunk => chunk.startsWith('<h2'))
    .map(chunk => {
      const [intro, ...rest] = chunk.split(/(?=<h3[^>]*>)/)
      const topics = rest.map(topic => ({ title: headingText(topic, 3), html: topic.replace(/^<h3[^>]*>[\s\S]*?<\/h3>\n?/, '') }))
      return { title: headingText(chunk, 2), html: intro, topics }
    })
  return { title, sections }
}
