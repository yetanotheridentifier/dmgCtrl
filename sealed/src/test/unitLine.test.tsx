// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { UnitLine } from '../components/gameScreen'
import type { UnitInteraction } from '../components/gameScreen'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE, TOKEN_EXPERIENCE, TOKEN_WEAKNESS, TOKEN_CARDS } from '../engine/tokenUpgrades'
import { effectivePower, effectiveHp } from '../engine/stats'
import { PILL_W, TOKEN_H, TOKEN_SHADOW, TOKEN_SPEC, TOKEN_FIGURE_WEIGHT, TOKEN_FIGURE_LAYOUT } from '../components/tokens'
import type { TokenKind } from '../components/tokens'
import { addLastingEffect } from '../engine/types'
import type { GameState, LeaderState } from '../engine/types'
import '../engine/cardDefinitions' // registers ASH_010's aura for the aura-token test

const noInteract: UnitInteraction = { actionable: false, selected: false, isTarget: false }

/** The power and HP figures of a stat pill, in order. */
const figures = (token: HTMLElement) => [token.querySelector('[data-stat="power"]'), token.querySelector('[data-stat="hp"]')] as HTMLElement[]

/** What a pill reads: a stat pill's two figures as ASCII ("-3 -3"), otherwise its label text. */
function shown(token: HTMLElement): string {
  const [p, h] = figures(token)
  if (!p || !h) return token.textContent ?? ''
  return [p, h].map(f => (f.dataset.value ?? '').replace('−', '-')).join(' ')
}

function boardWith(id: string): GameState {
  return state({ cards: { ...CARDS, [id]: card({ id, type: 'unit', power: 3, hp: 4 }) } })
}

describe('UnitLine — on-card damage overlay', () => {
  it('overlays a damaged unit’s damage as a red token with white text', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { damage: 2 })} interact={noInteract} />)
    const token = screen.getByTestId('board-unit-damage-u1')
    expect(token).toHaveTextContent('2')
    expect(token).toHaveStyle({ background: 'var(--color-red)', color: 'var(--color-ink)' })
  })

  it('shows no damage overlay at 0 damage', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { damage: 0 })} interact={noInteract} />)
    expect(screen.queryByTestId('board-unit-damage-u1')).toBeNull()
  })

  it('keeps the damage overlay outside the rotatable card face so it stays upright when exhausted', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { damage: 3, exhausted: true })} interact={noInteract} />)
    const face = screen.getByTestId('card-face')
    // The exhausted card face is rotated 90°; the damage number must not live inside it.
    expect(within(face).queryByTestId('board-unit-damage-u1')).toBeNull()
    expect(screen.getByTestId('board-unit-damage-u1')).toBeInTheDocument()
  })

  it('zooms the card to full size on Shift+hover of the unit card, and removes it on leave', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { exhausted: true })} interact={noInteract} />)
    // The zoom lives on the unit card itself, not the whole tile (dead padding
    // under attached upgrades must not zoom).
    const unitCard = within(screen.getByTestId('board-unit-u1')).getByTestId('card-face').parentElement!

    fireEvent.pointerEnter(unitCard, { pointerType: 'mouse' })
    expect(screen.queryByTestId('card-zoom')).toBeNull() // hover alone: no zoom

    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    const zoom = screen.getByTestId('card-zoom')
    // Full size and upright even though the source unit is exhausted (rotated).
    expect(within(zoom).getByTestId('card-face')).toHaveStyle({ width: '240px' })
    expect(within(zoom).getByTestId('card-face')).toHaveAttribute('data-orientation', 'portrait')

    fireEvent.pointerLeave(unitCard, { pointerType: 'mouse' })
    expect(screen.queryByTestId('card-zoom')).toBeNull()
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false })
  })

  const two = (cardId: string) => [{ cardId, owner: 'player' as const }, { cardId, owner: 'player' as const }]

  it.each([
    // kind, token, label, theme colour
    ['advantage', TOKEN_ADVANTAGE, 'Adv. 2', 'var(--color-token-advantage)'],
    ['shield', TOKEN_SHIELD, 'Shd. 2', 'var(--color-token-shield)'],
    ['experience', TOKEN_EXPERIENCE, '+2 +2', 'var(--color-token-experience)'],
    ['weakness', TOKEN_WEAKNESS, '-2 -2', 'var(--color-token-weakness)'],
  ])('shows two %s tokens as one labelled pill', (kind, cardId, label, colour) => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { upgrades: two(cardId) })} interact={noInteract} />)
    const token = screen.getByTestId(`board-unit-${kind}-u1`)
    expect(shown(token)).toBe(label)
    expect(token).not.toHaveTextContent('/')
    expect(token).toHaveStyle({ background: colour, width: `${PILL_W}px`, height: `${TOKEN_H}px`, boxShadow: TOKEN_SHADOW })
  })

  it('lays a stat pill’s figures out diagonally, power top-left and HP bottom-right, from the spec', () => {
    const u = unit('u1', 'TST_D', { upgrades: [{ cardId: TOKEN_WEAKNESS, owner: 'player' }, { cardId: TOKEN_WEAKNESS, owner: 'player' }, { cardId: TOKEN_WEAKNESS, owner: 'player' }] })
    render(<UnitLine state={boardWith('TST_D')} unit={u} interact={noInteract} />)
    const [p, h] = figures(screen.getByTestId('board-unit-weakness-u1'))
    const { power, hp, fontSize } = TOKEN_FIGURE_LAYOUT
    expect(p).toHaveStyle({ position: 'absolute', top: `${power.top}px`, left: `${power.left}px`, fontSize: `${fontSize}px` })
    expect(h).toHaveStyle({ position: 'absolute', bottom: `${hp.bottom}px`, right: `${hp.right}px`, fontSize: `${fontSize}px` })
    // The two rows fit the pill's height with the insets the old badge used.
    expect(power.top + 2 * fontSize + hp.bottom).toBeLessThanOrEqual(TOKEN_H)
  })

  it('draws each sign as its own element, centred on the digits, and records the value with a true minus', () => {
    const s = addLastingEffect(boardWith('TST_D'), { targetInstanceId: 'u1', power: 2, hp: -1 })
    render(<UnitLine state={s} unit={unit('u1', 'TST_D')} interact={noInteract} />)
    const [bp] = figures(screen.getByTestId('board-unit-mod-u1'))
    const [dp, dh] = figures(screen.getByTestId('board-unit-debuff-u1'))
    expect(bp.dataset.value).toBe('+2')
    expect(dp.dataset.value).toBe('−0') // U+2212 MINUS SIGN, not a hyphen
    expect(dh.dataset.value).toBe('−1')
    expect(bp.querySelector('[data-sign]')).toHaveAttribute('data-sign', 'plus')
    expect(dh.querySelector('[data-sign]')).toHaveAttribute('data-sign', 'minus')
    // The digits are the figure's only text; the sign is drawn, so it cannot sit on the baseline.
    expect(dh.textContent).toBe('1')
  })

  it.each([
    // kind, power figure colour, HP figure colour
    ['mod', 'var(--color-red)', 'var(--color-token-hp)'], // the white buff keeps the physical token's red and blue
    ['debuff', 'var(--color-ink)', 'var(--color-ink)'],
    ['experience', 'var(--color-ink)', 'var(--color-ink)'],
    ['weakness', 'var(--color-ink)', 'var(--color-ink)'],
  ])('prints the %s pill’s figures in bold, coloured from its spec, with the shared shadow', (kind, power, hp) => {
    const s = addLastingEffect(boardWith('TST_D'), { targetInstanceId: 'u1', power: 2, hp: -1 })
    const u = unit('u1', 'TST_D', { upgrades: [{ cardId: TOKEN_EXPERIENCE, owner: 'player' }, { cardId: TOKEN_WEAKNESS, owner: 'player' }] })
    render(<UnitLine state={s} unit={u} interact={noInteract} />)
    const token = screen.getByTestId(`board-unit-${kind}-u1`)
    const [p, h] = figures(token)
    expect(TOKEN_SPEC[kind as TokenKind].figures).toEqual({ power, hp })
    expect(p).toHaveStyle({ color: power, fontWeight: String(TOKEN_FIGURE_WEIGHT) })
    expect(h).toHaveStyle({ color: hp, fontWeight: String(TOKEN_FIGURE_WEIGHT) })
    expect(TOKEN_FIGURE_WEIGHT).toBeGreaterThanOrEqual(700) // bold
    expect(token).toHaveStyle({ boxShadow: TOKEN_SHADOW })
  })

  it('tells Experience from Advantage by colour (they were both gold)', () => {
    const u = unit('u1', 'TST_D', { upgrades: [{ cardId: TOKEN_EXPERIENCE, owner: 'player' }, { cardId: TOKEN_ADVANTAGE, owner: 'player' }] })
    render(<UnitLine state={boardWith('TST_D')} unit={u} interact={noInteract} />)
    expect(screen.getByTestId('board-unit-experience-u1').style.background).not.toBe(screen.getByTestId('board-unit-advantage-u1').style.background)
  })

  it('shows every kind of token at once on a unit carrying all six', () => {
    const tokens = [TOKEN_SHIELD, TOKEN_EXPERIENCE, TOKEN_ADVANTAGE, TOKEN_WEAKNESS].map(cardId => ({ cardId, owner: 'player' as const }))
    const s = addLastingEffect(boardWith('TST_D'), { targetInstanceId: 'u1', power: 1 })
    render(<UnitLine state={s} unit={unit('u1', 'TST_D', { damage: 1, upgrades: tokens })} interact={noInteract} />)
    for (const kind of ['damage', 'mod', 'shield', 'experience', 'advantage', 'weakness']) {
      expect(screen.getByTestId(`board-unit-${kind}-u1`)).toBeInTheDocument()
    }
  })

  it('shows a white +X/+Y buff pill for a unit with a "this phase" buff', () => {
    let s = boardWith('TST_D')
    s = addLastingEffect(s, { targetInstanceId: 'u1', power: 2, hp: 2 })
    render(<UnitLine state={s} unit={unit('u1', 'TST_D')} interact={noInteract} />)
    const token = screen.getByTestId('board-unit-mod-u1')
    expect(shown(token)).toBe('+2 +2')
    expect(token).toHaveStyle({ background: 'var(--color-token-buff)', width: `${PILL_W}px` })
    expect(screen.queryByTestId('board-unit-debuff-u1')).toBeNull()
  })

  it('shows a dark grey -X/-Y debuff pill for a unit with a "this phase" debuff', () => {
    const s = addLastingEffect(boardWith('TST_D'), { targetInstanceId: 'u1', power: -1, hp: -1 })
    render(<UnitLine state={s} unit={unit('u1', 'TST_D')} interact={noInteract} />)
    const token = screen.getByTestId('board-unit-debuff-u1')
    expect(shown(token)).toBe('-1 -1')
    expect(token).toHaveStyle({ background: 'var(--color-token-debuff)' })
    expect(screen.queryByTestId('board-unit-mod-u1')).toBeNull()
  })

  it('splits a mixed modifier into a buff pill and a debuff pill', () => {
    const s = addLastingEffect(boardWith('TST_D'), { targetInstanceId: 'u1', power: 2, hp: -1 })
    render(<UnitLine state={s} unit={unit('u1', 'TST_D')} interact={noInteract} />)
    expect(shown(screen.getByTestId('board-unit-mod-u1'))).toBe('+2 +0')
    expect(shown(screen.getByTestId('board-unit-debuff-u1'))).toBe('-0 -1') // a debuff's zero takes the debuff's sign
  })

  it('shows Clone Combat Squadron’s +1/+1 for each other friendly space unit', () => {
    const s = state({
      cards: {
        ...CARDS,
        JTL_115: card({ id: 'JTL_115', type: 'unit', arena: 'space', power: 2, hp: 2 }),
        WING: card({ id: 'WING', type: 'unit', arena: 'space', power: 1, hp: 1 }),
      },
      players: {
        player: player({ units: [unit('c1', 'JTL_115', { arena: 'space' }), unit('w1', 'WING', { arena: 'space' }), unit('w2', 'WING', { arena: 'space' })] }),
        opponent: player(),
      },
    })
    const clone = s.players.player.units[0]
    expect(effectivePower(s, clone)).toBe(4) // the engine already applies it
    render(<UnitLine state={s} unit={clone} interact={noInteract} />)
    expect(shown(screen.getByTestId('board-unit-mod-c1'))).toBe('+2 +2')
  })

  it('shows a conditional debuff from the unit’s own card (D’Qar Cargo Frigate)', () => {
    const s = state({ cards: { ...CARDS, JTL_052: card({ id: 'JTL_052', type: 'unit', arena: 'space', power: 8, hp: 9 }) } })
    render(<UnitLine state={s} unit={unit('d1', 'JTL_052', { arena: 'space', damage: 3 })} interact={noInteract} />)
    expect(shown(screen.getByTestId('board-unit-debuff-d1'))).toBe('-3 -0')
  })

  it('shows exactly the off-card part of the stats pipeline, for every kind of source', () => {
    // Printed + upgrades is what the card art and the attached upgrade cards already show; every
    // other contribution to the unit's power and HP must appear on a buff or debuff pill.
    const deployedBoKatan: LeaderState = { cardId: 'ASH_010', deployed: true, epicActionUsed: true, exhausted: false }
    let s = state({
      cards: {
        ...CARDS,
        ASH_010: card({ id: 'ASH_010', type: 'leader', power: 4, hp: 7 }),
        JTL_115: card({ id: 'JTL_115', type: 'unit', arena: 'space', power: 2, hp: 2, traits: ['Mandalorian'] }),
        JTL_052: card({ id: 'JTL_052', type: 'unit', arena: 'space', power: 8, hp: 9 }),
        SHD_056: card({ id: 'SHD_056', type: 'unit', power: 2, hp: 2 }),
        TST_UP: card({ id: 'TST_UP', type: 'upgrade', power: 1, hp: 1 }),
      },
      players: {
        player: player({
          leader: deployedBoKatan,
          units: [
            unit('L', 'ASH_010', { isLeader: true }),
            unit('c1', 'JTL_115', { arena: 'space' }),
            unit('d1', 'JTL_052', { arena: 'space', damage: 2 }),
            unit('f1', 'SHD_056', { upgrades: [{ cardId: 'TST_UP', owner: 'player' }, { cardId: TOKEN_EXPERIENCE, owner: 'player' }] }),
          ],
        }),
        opponent: player(),
      },
    })
    s = addLastingEffect(s, { targetInstanceId: 'd1', power: 3, hp: -2 })
    const pill = (kind: string, id: string): [number, number] => {
      const token = screen.queryByTestId(`board-unit-${kind}-${id}`)
      if (!token) return [0, 0]
      const [p, h] = shown(token).split(' ').map(Number)
      return [p, h]
    }
    for (const u of s.players.player.units.filter(x => !x.isLeader)) {
      const { unmount } = render(<UnitLine state={s} unit={u} interact={noInteract} />)
      const [bp, bh] = pill('mod', u.instanceId)
      const [dp, dh] = pill('debuff', u.instanceId)
      const onCard = (stat: 'power' | 'hp') =>
        (s.cards[u.cardId][stat] ?? 0) + u.upgrades.reduce((n, up) => n + (s.cards[up.cardId]?.[stat] ?? TOKEN_CARDS[up.cardId]?.[stat] ?? 0), 0)
      expect(onCard('power') + bp + dp, `${u.instanceId} power`).toBe(effectivePower(s, u))
      expect(onCard('hp') + bh + dh, `${u.instanceId} hp`).toBe(effectiveHp(s, u))
      unmount()
    }
  })

  it('includes an aura buff in the +X/+Y token', () => {
    // Deployed Bo-Katan gives other friendly Mandalorian units +1/+0 — the aura should token too.
    const deployedBoKatan: LeaderState = { cardId: 'ASH_010', deployed: true, epicActionUsed: true, exhausted: false }
    const s = state({
      cards: {
        ...CARDS,
        ASH_010: card({ id: 'ASH_010', type: 'leader', power: 4, hp: 7 }),
        MANDO: card({ id: 'MANDO', type: 'unit', arena: 'ground', power: 2, hp: 2, traits: ['Mandalorian'] }),
      },
      players: {
        player: player({ leader: deployedBoKatan, units: [unit('L', 'ASH_010', { isLeader: true }), unit('m1', 'MANDO')] }),
        opponent: player(),
      },
    })
    render(<UnitLine state={s} unit={s.players.player.units.find(u => u.instanceId === 'm1')!} interact={noInteract} />)
    expect(shown(screen.getByTestId('board-unit-mod-m1'))).toBe('+1 +0')
  })

  it('shows +2/+0 when only power is buffed, and no token with no modifier', () => {
    let s = boardWith('TST_D')
    s = addLastingEffect(s, { targetInstanceId: 'u1', power: 2 })
    const { rerender } = render(<UnitLine state={s} unit={unit('u1', 'TST_D')} interact={noInteract} />)
    expect(shown(screen.getByTestId('board-unit-mod-u1'))).toBe('+2 +0')

    rerender(<UnitLine state={boardWith('TST_D')} unit={unit('u2', 'TST_D')} interact={noInteract} />)
    expect(screen.queryByTestId('board-unit-mod-u2')).toBeNull()
  })

  it('does not render the old bottom power/health line for a unit with art-backed stats', () => {
    // A card WITH art renders no textual fallback; the board tile should carry no
    // "power/health" readout of its own any more — that lives on the card art.
    const s = state({ cards: { ...CARDS, TST_A: card({ id: 'TST_A', type: 'unit', power: 3, hp: 4, frontArt: 'https://cdn.swu-db.com/images/cards/TST/A.png' }) } })
    render(<UnitLine state={s} unit={unit('u1', 'TST_A', { damage: 0 })} interact={noInteract} />)
    expect(screen.getByTestId('board-unit-u1')).not.toHaveTextContent('3/4')
  })
})

describe('UnitLine — attached upgrades', () => {
  function boardWithUpgrade(): GameState {
    return state({
      cards: {
        ...CARDS,
        TST_U: card({ id: 'TST_U', type: 'unit', power: 3, hp: 4 }),
        TST_UP: card({ id: 'TST_UP', type: 'upgrade', power: 2, hp: 2 }),
      },
    })
  }
  const up = (owner: 'player' | 'opponent' = 'player') => ({ cardId: 'TST_UP', owner })

  it('renders a card face per attached upgrade, stacked behind the unit', () => {
    const u = unit('u1', 'TST_U', { upgrades: [up(), up()] })
    render(<UnitLine state={boardWithUpgrade()} unit={u} interact={noInteract} />)
    const stack = screen.getByTestId('board-unit-upgrades-u1')
    expect(within(stack).getAllByTestId('card-face')).toHaveLength(2)
  })

  it('renders no upgrade stack for a unit with no upgrades', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D')} interact={noInteract} />)
    expect(screen.queryByTestId('board-unit-upgrades-u1')).toBeNull()
  })

  it('zooms an attached upgrade from its exposed strip on Shift+hover', () => {
    const u = unit('u1', 'TST_U', { upgrades: [up()] })
    render(<UnitLine state={boardWithUpgrade()} unit={u} interact={noInteract} />)
    const stack = screen.getByTestId('board-unit-upgrades-u1')
    const upgradeCard = within(stack).getByTestId('card-face').parentElement!
    fireEvent.pointerEnter(upgradeCard, { pointerType: 'mouse' })
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    expect(screen.getByTestId('card-zoom')).toBeInTheDocument()
    // The upgrade's popover renders inside its anchor, so it must still measure — a
    // present-but-hidden popover is the production failure this guards.
    expect(screen.getByTestId('card-zoom').style.visibility).not.toBe('hidden')
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false })
  })

  it('stacks captured cards behind the unit, turned and dimmed', () => {
    const s = state({ cards: { ...CARDS, TST_U: card({ id: 'TST_U', type: 'unit', power: 3, hp: 4 }), TST_C: card({ id: 'TST_C', type: 'unit', power: 1, hp: 1 }) } })
    render(<UnitLine state={s} unit={unit('u1', 'TST_U', { captured: [{ cardId: 'TST_C', owner: 'player' }] })} interact={noInteract} />)
    const stack = screen.getByTestId('board-unit-captured-u1')
    const face = within(stack).getByTestId('card-face')
    // Turned (as if exhausted) and dimmed beyond the normal exhausted brightness — it's out of play.
    expect(face).toHaveAttribute('data-orientation', 'landscape')
    expect(face.className).toMatch(/brightness-\[0\.6\]/)
  })

  it('renders no captured stack for a unit holding nothing', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D')} interact={noInteract} />)
    expect(screen.queryByTestId('board-unit-captured-u1')).toBeNull()
  })

  it('keeps captured cards visible below an exhausted capturing unit', () => {
    const s = state({ cards: { ...CARDS, TST_U: card({ id: 'TST_U', type: 'unit', power: 3, hp: 4 }), TST_C: card({ id: 'TST_C', type: 'unit', power: 1, hp: 1 }) } })
    render(<UnitLine state={s} unit={unit('u1', 'TST_U', { exhausted: true, captured: [{ cardId: 'TST_C', owner: 'player' }] })} interact={noInteract} />)
    const captured = screen.getByTestId('captured-card')
    // Offset clear of the unit card so the exhausted (rotated) captor doesn't hide it.
    expect(Number.parseInt(captured.style.top, 10)).toBeGreaterThan(0)
  })

  it('shows a Hidden badge on a hidden unit', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { hidden: true })} interact={noInteract} />)
    expect(screen.getByTestId('board-unit-hidden-u1')).toHaveTextContent(/hidden/i)
  })

  it('hides the Hidden badge when the unit also has Sentinel — Sentinel overrides Hidden', () => {
    const s = state({ cards: { ...CARDS, TST_HS: card({ id: 'TST_HS', type: 'unit', power: 2, hp: 2, keywords: [{ name: 'Sentinel' }] }) } })
    render(<UnitLine state={s} unit={unit('u1', 'TST_HS', { hidden: true })} interact={noInteract} />)
    expect(screen.queryByTestId('board-unit-hidden-u1')).toBeNull() // no Hidden badge
    expect(screen.getByTestId('board-unit-sentinel-u1')).toBeInTheDocument()
  })

  it('shows a Sentinel badge on a unit with the Sentinel keyword, and none without', () => {
    const s = state({ cards: { ...CARDS, TST_S: card({ id: 'TST_S', type: 'unit', power: 2, hp: 2, keywords: [{ name: 'Sentinel' }] }) } })
    render(<UnitLine state={s} unit={unit('u1', 'TST_S')} interact={noInteract} />)
    expect(screen.getByTestId('board-unit-sentinel-u1')).toHaveTextContent(/sentinel/i)

    render(<UnitLine state={boardWith('TST_D')} unit={unit('u2', 'TST_D')} interact={noInteract} />)
    expect(screen.queryByTestId('board-unit-sentinel-u2')).toBeNull()
  })

  it('renders a shield token as an on-card overlay, not a behind-card upgrade', () => {
    const u = unit('u1', 'TST_D', { upgrades: [{ cardId: TOKEN_SHIELD, owner: 'player' }] })
    render(<UnitLine state={boardWith('TST_D')} unit={u} interact={noInteract} />)
    expect(screen.getByTestId('board-unit-shield-u1')).toBeInTheDocument()
    expect(screen.queryByTestId('board-unit-upgrades-u1')).toBeNull() // tokens aren't stacked as cards
  })

  it('marks a unit as an upgrade target: green highlight and clickable', () => {
    const onClick = vi.fn()
    render(
      <UnitLine
        state={boardWith('TST_D')}
        unit={unit('u1', 'TST_D')}
        interact={{ actionable: false, selected: false, isTarget: false, isUpgradeTarget: true, onClick }}
      />,
    )
    const tile = screen.getByTestId('board-unit-u1')
    expect(tile).toHaveAttribute('data-upgrade-target', 'true')
    expect(within(tile).getByTestId('card-face')).toHaveAttribute('data-highlight', 'green')
    fireEvent.click(tile)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
