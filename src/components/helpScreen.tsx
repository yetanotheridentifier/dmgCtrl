import { useLayoutEffect, useRef, useState } from 'react'
import swuHelpHtml from '../../docs/swuHelp.md'
import xwingHelpHtml from '../../docs/xwingHelp.md'
import appHelpHtml from '../../docs/appHelp.md'
import AppScreenLayout from './layout/appScreenLayout'
import { useOrientation } from '../hooks/useOrientation'
import { BackIcon } from './icons'
import { IconButton, OptionRow } from './shared/controls'

// One page per game plus a short app page. Each `##` in a page's markdown is a section, listed in
// the section links; help opens at the section for the screen it was opened from.
export type HelpSource = 'setup' | 'game' | 'tournament' | 'xwing' | 'xwingSetup' | 'xwingLists' | 'gameSelect'

const OPENS_AT: Record<HelpSource,{ html: string; section: string }> = {
  setup: { html: swuHelpHtml, section: 'Setup' },
  game: { html: swuHelpHtml, section: 'Game' },
  tournament: { html: swuHelpHtml, section: 'Tournament' },
  xwingSetup: { html: xwingHelpHtml, section: 'Setup' },
  xwingLists: { html: xwingHelpHtml, section: 'Squad lists' },
  xwing: { html: xwingHelpHtml, section: 'Game' },
  gameSelect: { html: appHelpHtml, section: 'Starting the app' },
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').trim()

// The page title is the markdown's h1; the sections are what follows each h2.
function parsePage(html: string) {
  const title = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? 'Help')
  const sections = html.replace(/^[\s\S]*?<\/h1>\n?/, '').split(/(?=<h2[^>]*>)/)
    .filter(chunk => chunk.startsWith('<h2'))
    .map(chunk => ({ title: stripTags(chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? ''), html: chunk }))
  return { title, sections }
}

interface Props {
  onBack: () => void
  source?: HelpSource
}

function HelpScreen({ onBack, source = 'setup' }: Props) {
  const { html, section } = OPENS_AT[source]
  const { title, sections } = parsePage(html)
  const { isPortrait } = useOrientation()
  const contentRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])
  const opensAt = Math.max(0, sections.findIndex(s => s.title === section))
  const [current, setCurrent] = useState(opensAt)
  // The section asked for (opened at, or tapped). A short last section can't scroll to the top, so
  // while the content sits at its end the one asked for stays current.
  const askedFor = useRef(opensAt)

  // A section's scroll position: the first section's is 0, so each heading lands below the padding.
  const offsetOf = (i: number) => (sectionRefs.current[i]?.offsetTop ?? 0) - (sectionRefs.current[0]?.offsetTop ?? 0)

  const scrollTo = (i: number) => {
    askedFor.current = i
    setCurrent(i)
    if (contentRef.current) contentRef.current.scrollTop = offsetOf(i)
  }

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = offsetOf(opensAt)
  }, [opensAt])

  const onScroll = () => {
    const content = contentRef.current
    if (!content) return
    const top = content.scrollTop + 8
    const passed = sections.filter((_, i) => offsetOf(i) <= top).length - 1
    const atEnd = content.scrollTop + content.clientHeight >= content.scrollHeight - 2
    setCurrent(atEnd && askedFor.current > passed ? askedFor.current : Math.max(0, passed))
    if (!atEnd) askedFor.current = Math.max(0, passed)
  }

  return (
    <AppScreenLayout>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 300, letterSpacing: '0.12em', color: 'var(--color-text-primary)' }}>
            {title}
          </h1>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: isPortrait ? '12px' : '16px' }}>
          <nav
            aria-label="Sections"
            style={{
              display: 'flex',
              flexDirection: isPortrait ? 'row' : 'column',
              gap: '6px',
              flexShrink: 0,
              width: isPortrait ? undefined : '180px',
              overflowX: isPortrait ? 'auto' : undefined,
              overflowY: isPortrait ? undefined : 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            {sections.map((s, i) => (
              <OptionRow key={s.title} title={s.title} selected={i === current} onClick={() => scrollTo(i)} />
            ))}
          </nav>

          <div
            ref={contentRef}
            data-testid="help-content"
            className="help-content"
            onScroll={onScroll}
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              overflowY: 'auto',
              background: 'var(--color-sheet)',
              borderRadius: '16px',
              padding: '14px 18px',
              boxSizing: 'border-box',
              fontSize: '15px',
            }}
          >
            {sections.map((s, i) => (
              <section
                key={s.title}
                ref={el => { sectionRefs.current[i] = el }}
                dangerouslySetInnerHTML={{ __html: s.html }}
              />
            ))}
          </div>
        </div>
      </div>
    </AppScreenLayout>
  )
}

export default HelpScreen
