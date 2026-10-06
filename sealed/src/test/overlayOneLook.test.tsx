// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import {
  ButtonChoiceOverlay, CardChoiceOverlay, CardSelectOverlay, GameOverOverlay, NameCardOverlay, NextTriggerOverlay,
  TriggerOrderOverlay,
} from '../components/gameScreen'
import { OVERLAY_TITLE, PANEL_BUTTON, PANEL_PRIMARY } from '../components/overlayShell'
import { CARDS, card, state } from './helpers/engineFixtures'
import type { PendingTrigger } from '../engine/types'

/**
 * Every centre-screen overlay has one appearance: the game-over screen's. The title, the prompt, the
 * buttons and any explanatory line come from the shared pieces in `overlayShell`, so the overlays cannot
 * drift apart one restyled copy at a time.
 *
 * jsdom does not paint, so these pin the structure (which shared piece each overlay is built from), not
 * the pixels.
 */

const cards = {
  ...CARDS,
  A: card({ id: 'A', name: 'Fleet Lieutenant' }),
  C: card({ id: 'C', name: 'Admiral Ackbar' }),
}
const trigger = (id: string, cardId: string, controller: 'player' | 'opponent'): PendingTrigger =>
  ({ id, cardId, controller, point: 'whenPlayed', abilityIndex: 0, layer: 0 })
const s = state({ cards, pendingTriggers: [trigger('t1', 'A', 'player'), trigger('t2', 'C', 'player'), trigger('t3', 'A', 'opponent')] })
const noop = vi.fn()

const overlays: [string, ReactElement][] = [
  ['game over', <GameOverOverlay winner="player" concededBy="opponent" onRematch={noop} onExit={noop} />],
  ['button choice', <ButtonChoiceOverlay state={s} prompt={['choose one']} actions={[{ type: 'skipTrigger' }]} onPick={noop} onDismiss={noop} dismissLabel="Cancel" />],
  ['who resolves first', <TriggerOrderOverlay state={s} mine={s.pendingTriggers!.slice(0, 2)} theirs={s.pendingTriggers!.slice(2)} onPick={noop} onDismiss={noop} />],
  ['which resolves next', <NextTriggerOverlay state={s} candidates={[{ triggerId: 't1', cardId: 'A' }, { triggerId: 't2', cardId: 'C' }]} onPick={noop} onDismiss={noop} />],
  ['name a card', <NameCardOverlay names={['Fleet Lieutenant', 'Admiral Ackbar']} onPick={noop} onDismiss={noop} />],
  ['select a card', <CardSelectOverlay state={s} prompt="Choose an upgrade to defeat" items={[{ cardId: 'A', optionIndex: 0 }]} onPick={noop} onCancel={noop} onDismiss={noop} />],
  ['look at a card', <CardChoiceOverlay card={cards.A} cardId="A" prompt="Look at the top card of your deck"><button className={PANEL_PRIMARY}>Leave it</button></CardChoiceOverlay>],
]

/** The overlay's own content: the panel without the cards it shows, whose faces have their own type. */
function ownContent(panel: HTMLElement): Element[] {
  return [...panel.querySelectorAll('*')].filter(el => !el.closest('[data-testid$="-overlay-content"]'))
}

describe('every overlay shares one appearance', () => {
  it.each(overlays)('%s: one title, in the shared header', (_, overlay) => {
    render(overlay)
    const panel = document.body.querySelector('section[data-size]') as HTMLElement
    const titles = panel.querySelectorAll('[data-overlay-part="title"]')
    expect(titles).toHaveLength(1)
  })

  it.each(overlays)('%s: every button is a panel button', (_, overlay) => {
    render(overlay)
    const panel = document.body.querySelector('section[data-size]') as HTMLElement
    const buttons = ownContent(panel).filter((el): el is HTMLButtonElement =>
      el.tagName === 'BUTTON' && el.getAttribute('data-testid') !== 'overlay-dismiss')
    expect(buttons.length).toBeGreaterThan(0)
    for (const b of buttons) expect(b.className.startsWith(PANEL_BUTTON), b.textContent ?? '').toBe(true)
  })

  it.each(overlays)('%s: no small-caps or extra-small text of its own', (_, overlay) => {
    render(overlay)
    const panel = document.body.querySelector('section[data-size]') as HTMLElement
    const odd = ownContent(panel).filter(el => el.classList.contains('uppercase') || el.classList.contains('text-xs'))
    expect(odd.map(el => el.textContent)).toEqual([])
  })

  it('the choice overlays title their question in the button choice prompt type', () => {
    for (const [name, overlay] of overlays.slice(1)) {
      const { unmount } = render(overlay)
      const title = document.body.querySelector('[data-overlay-part="title"]')!
      expect(title.className, name).toBe(OVERLAY_TITLE)
      unmount()
    }
  })

  it('who resolves first: the waiting abilities are listed, not drawn as boxes that read as buttons', () => {
    render(overlays[2][1])
    const listed = within(screen.getByTestId('trigger-order-overlay')).getAllByRole('listitem')
    expect(listed.length).toBe(3)
    for (const li of listed) expect(li.className).not.toMatch(/\bborder\b/)
  })
})
