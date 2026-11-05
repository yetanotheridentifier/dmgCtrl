import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { IconButton, OptionRow } from '@pwa-shared/controls'
import userGuideHtml from '../../docs/userGuide.md'
import { RELEASE } from '../buildIdentity'
import { isDev } from '../env'
import { PORTRAIT_QUERY, useMediaQuery } from '../hooks/useMediaQuery'
import { OPENS_AT, parseGuide } from '../utils/helpSections'
import type { HelpContext, HelpSection } from '../utils/helpSections'
import { Disclosure } from './disclosure'
import { BackIcon } from './icons'

const { title, sections } = parseGuide(userGuideHtml)

// The depth of the fade at an edge of the help content that cuts through a section.
const FADE = '40px'

const fadeMask = (top: boolean, bottom: boolean) => {
  const image = `linear-gradient(to bottom, ${top ? `transparent, black ${FADE}` : 'black'}, ${bottom ? `black calc(100% - ${FADE}), transparent` : 'black'})`
  return { maskImage: image, WebkitMaskImage: image }
}

/** A section's text, then its topics, each opening on a tap, one at a time. */
function SectionBody({ section }: { section: HelpSection }) {
  const [openTopic, setOpenTopic] = useState<string | null>(null)
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: section.html }} />
      {section.topics.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
          {section.topics.map(topic => (
            <Disclosure
              key={topic.title}
              open={openTopic === topic.title}
              onToggle={() => setOpenTopic(t => (t === topic.title ? null : topic.title))}
              summary={<span>{topic.title}</span>}
            >
              <div dangerouslySetInnerHTML={{ __html: topic.html }} />
            </Disclosure>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Sealed's help: one page, the user guide's sections listed as links, opening at the section for
 * the screen it came from, or the one a link asked for. A copy of the PWA's help screen
 * (src/components/helpScreen.tsx) in shape and behaviour, with a section's `###` topics opening on
 * a tap; copied rather than imported, as only the PWA's shared controls cross into Sealed.
 *
 * It covers the screen rather than replacing it: routing away unmounts `GameScreen`, and the game
 * lives entirely in `useGame`'s state and refs, so over the board nothing unmounts and closing
 * help returns to the game where it was left.
 */
export function HelpPage({ context, section, onClose }: { context: HelpContext; section?: string; onClose: () => void }) {
  const isPortrait = useMediaQuery(PORTRAIT_QUERY)
  const contentRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])
  const opensAt = Math.max(0, sections.findIndex(s => s.title === (section ?? OPENS_AT[context])))
  const [current, setCurrent] = useState(opensAt)
  // The section asked for (opened at, or chosen from the links). A short last section can't scroll to the top, so
  // while the content sits at its end the one asked for stays current.
  const askedFor = useRef(opensAt)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    // Above the board, the card zoom and the settings sheet, so help opened from a link in the sheet
    // covers it and closing help returns there.
    <div
      data-testid="help-page"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        boxSizing: 'border-box',
        paddingTop: 'var(--edge-top)',
        paddingRight: 'var(--edge-right)',
        paddingBottom: 'var(--edge-bottom)',
        paddingLeft: 'var(--edge-left)',
        background: 'var(--color-bg-deep)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <IconButton label={context === 'game' ? 'Back to the game' : 'Back to setup'} onClick={onClose}><BackIcon /></IconButton>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 300, letterSpacing: '0.12em', color: 'var(--color-text-primary)' }}>
          {title}
        </h1>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isPortrait ? 'column' : 'row', gap: isPortrait ? '12px' : '16px' }}>
        {/* Portrait has two rows of links across the top, so every one is in reach without
            scrolling sideways; a label too long for its third of the row wraps rather than
            running out of its link. */}
        <nav
          aria-label="Sections"
          style={{
            gap: '6px',
            flexShrink: 0,
            ...(isPortrait
              ? { display: 'grid', gridTemplateColumns: `repeat(${Math.ceil(sections.length / 2)}, minmax(0, 1fr))` }
              : { display: 'flex', flexDirection: 'column', width: '180px', overflowY: 'auto', whiteSpace: 'nowrap' }),
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
          {/* Each section is a block of its own, as the section links are, so the link marked
              current matches a block on the page. */}
          {sections.map((s, i) => (
            <section
              key={s.title}
              aria-label={s.title}
              ref={el => { sectionRefs.current[i] = el }}
              style={{ background: 'var(--color-sheet)', borderRadius: '16px', padding: '14px 18px' }}
            >
              <SectionBody section={s} />
            </section>
          ))}
          {/* Build marker lives here in prod; in dev it's a corner badge. */}
          {!isDev() && (
            <p data-testid="build-tag" style={{ margin: '12px 0 0', fontSize: '10px', color: 'var(--color-text-disabled)' }}>
              {RELEASE}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
