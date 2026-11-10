import { useLayoutEffect, useRef, useState } from 'react'
import swuHelpHtml from '../../docs/swuHelp.md'
import xwingHelpHtml from '../../docs/xwingHelp.md'
import appHelpHtml from '../../docs/appHelp.md'
import AppScreenLayout from './layout/appScreenLayout'
import { useOrientation } from '../hooks/useOrientation'
import { BackIcon } from './icons'
import { IconButton, OptionRow } from './shared/controls'
import { RELEASE } from '../buildIdentity'

// One page per game plus a short app page. Each `##` in a page's markdown is a section, listed in
// the section links; help opens at the section for the screen it was opened from.
export type HelpSource = 'setup' | 'game' | 'tournament' | 'xwing' | 'xwingSetup' | 'xwingLists' | 'xwingTournament' | 'gameSelect'

const OPENS_AT: Record<HelpSource,{ html: string; section: string }> = {
  setup: { html: swuHelpHtml, section: 'Setup' },
  game: { html: swuHelpHtml, section: 'Game' },
  tournament: { html: swuHelpHtml, section: 'Tournament' },
  xwingSetup: { html: xwingHelpHtml, section: 'Setup' },
  xwingLists: { html: xwingHelpHtml, section: 'Squad lists' },
  xwing: { html: xwingHelpHtml, section: 'Game' },
  xwingTournament: { html: xwingHelpHtml, section: 'Tournament' },
  gameSelect: { html: appHelpHtml, section: 'Starting the app' },
}

// The depth of the fade at an edge of the help content that cuts through a section.
const FADE = '40px'

const fadeMask = (top: boolean, bottom: boolean) => {
  const image = `linear-gradient(to bottom, ${top ? `transparent, black ${FADE}` : 'black'}, ${bottom ? `black calc(100% - ${FADE}), transparent` : 'black'})`
  return { maskImage: image, WebkitMaskImage: image }
}

const stripTags =(html: string) => html.replace(/<[^>]+>/g, '').trim()

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

  // An edge of the view that cuts through a section fades the content out there, so the section
  // reads as running on past it; an edge at a section's top or bottom, or in a gap, stays crisp.
  const [fade, setFade] = useState({ top: false, bottom: false })
  const cutsASection = (y: number) => sections.some((_, i) => {
    const top = offsetOf(i)
    return top + 1 < y && y < top + (sectionRefs.current[i]?.offsetHeight ?? 0) - 1
  })
  const updateFade = () => {
    const content = contentRef.current
    if (!content) return
    const top = cutsASection(content.scrollTop)
    const bottom = cutsASection(content.scrollTop + content.clientHeight)
    if (top !== fade.top || bottom !== fade.bottom) setFade({ top, bottom })
  }

  const scrollTo = (i: number) => {
    askedFor.current = i
    setCurrent(i)
    if (contentRef.current) contentRef.current.scrollTop = offsetOf(i)
  }

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = offsetOf(opensAt)
  }, [opensAt])

  // Turning the phone changes the view's height, so the edges are measured again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(updateFade, [isPortrait])

  const onScroll = () => {
    const content = contentRef.current
    if (!content) return
    updateFade()
    const top = content.scrollTop + 8
    const passed = sections.filter((_, i) => offsetOf(i) <= top).length - 1
    const atEnd = content.scrollTop + content.clientHeight >= content.scrollHeight - 2
    setCurrent(atEnd && askedFor.current > passed ? askedFor.current : Math.max(0, passed))
    if (!atEnd) askedFor.current = Math.max(0, passed)
  }

  return (
    <AppScreenLayout>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <IconButton label="Back" onClick={onBack}><BackIcon /></IconButton>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 300, letterSpacing: '0.12em', color: 'var(--color-text-primary)' }}>
            {title}
          </h1>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: isPortrait ? '12px' : '16px' }}>
          {/* Portrait has two rows of links across the top, so every one is in reach without
              scrolling sideways. */}
          <nav
            aria-label="Sections"
            style={{
              gap: '6px',
              flexShrink: 0,
              whiteSpace: 'nowrap',
              ...(isPortrait
                ? { display: 'grid', gridTemplateColumns: `repeat(${Math.ceil(sections.length / 2)}, minmax(0, 1fr))` }
                : { display: 'flex', flexDirection: 'column', width: '180px', overflowY: 'auto' }),
            }}
          >
            {sections.map((s, i) => (
              <OptionRow key={s.title} title={s.title} selected={i === current} onClick={() => scrollTo(i)} />
            ))}
          </nav>

          <div
            ref={contentRef}
            data-testid="help-content"
            data-fade={[fade.top && 'top', fade.bottom && 'bottom'].filter(Boolean).join(' ')}
            className="help-content"
            onScroll={onScroll}
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              overflowY: 'auto',
              fontSize: '15px',
              ...((fade.top || fade.bottom) && fadeMask(fade.top, fade.bottom)),
            }}
          >
            {/* Each section is a block of its own on the surface fill, as the section links are, so
                the link marked current matches a block on the page. */}
            {sections.map((s, i) => (
              <section
                key={s.title}
                aria-label={s.title}
                ref={el => { sectionRefs.current[i] = el }}
                style={{ background: 'var(--color-surface)', borderRadius: '16px', padding: '14px 18px' }}
                dangerouslySetInnerHTML={{ __html: s.html }}
              />
            ))}
            {/* The build release, so a player can say which build they are on (Sealed's Help page
                carries its own the same way). */}
            <p data-testid="build-tag" style={{ margin: '12px 0 0', fontSize: '10px', color: 'var(--color-text-disabled)' }}>
              {RELEASE}
            </p>
          </div>
        </div>
      </div>
    </AppScreenLayout>
  )
}

export default HelpScreen
