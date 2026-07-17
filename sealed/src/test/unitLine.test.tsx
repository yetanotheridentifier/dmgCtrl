import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { UnitLine } from '../components/gameScreen'
import type { UnitInteraction } from '../components/gameScreen'
import { state, player, unit, card, CARDS } from './helpers/engineFixtures'
import { TOKEN_SHIELD, TOKEN_ADVANTAGE } from '../engine/tokenUpgrades'
import { addLastingEffect } from '../engine/types'
import type { GameState, LeaderState } from '../engine/types'
import '../engine/cardDefinitions' // registers ASH_010's aura for the aura-token test

const noInteract: UnitInteraction = { actionable: false, selected: false, isTarget: false }

function boardWith(id: string): GameState {
  return state({ cards: { ...CARDS, [id]: card({ id, type: 'unit', power: 3, hp: 4 }) } })
}

describe('UnitLine — on-card damage overlay (#326)', () => {
  it('overlays a damaged unit’s damage as a red token with white text', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { damage: 2 })} interact={noInteract} />)
    const token = screen.getByTestId('board-unit-damage-u1')
    expect(token).toHaveTextContent('2')
    expect(token).toHaveStyle({ background: 'var(--color-red)', color: '#fff' })
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

  it('zooms the card to full size on Shift+hover of the unit card, and removes it on leave (#321)', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { exhausted: true })} interact={noInteract} />)
    // The zoom lives on the unit card itself, not the whole tile (dead padding
    // under attached upgrades must not zoom) (#336).
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

  it('labels an Advantage token "adv. N" with the token count', () => {
    const u = unit('u1', 'TST_D', { upgrades: [{ cardId: TOKEN_ADVANTAGE, owner: 'player' }, { cardId: TOKEN_ADVANTAGE, owner: 'player' }] })
    render(<UnitLine state={boardWith('TST_D')} unit={u} interact={noInteract} />)
    const token = screen.getByTestId('board-unit-advantage-u1')
    expect(token).toHaveTextContent(/adv\./i)
    expect(token).toHaveTextContent('2')
  })

  it('shows a +X/+Y modifier token for a unit with a "this phase" buff (#347)', () => {
    let s = boardWith('TST_D')
    s = addLastingEffect(s, { targetInstanceId: 'u1', power: 2, hp: 2 })
    render(<UnitLine state={s} unit={unit('u1', 'TST_D')} interact={noInteract} />)
    const token = screen.getByTestId('board-unit-mod-u1')
    expect(token).toHaveTextContent('+2+2')
    // Power delta in red, HP delta in blue (mirrors the physical token).
    const parts = within(token).getAllByText(/\+2/)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toHaveStyle({ color: 'var(--color-red)' })
    expect(parts[1]).toHaveStyle({ color: '#2563eb' })
  })

  it('includes an aura buff in the +X/+Y token (#348)', () => {
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
    expect(screen.getByTestId('board-unit-mod-m1')).toHaveTextContent('+1+0')
  })

  it('shows +2/+0 when only power is buffed, and no token with no modifier (#347)', () => {
    let s = boardWith('TST_D')
    s = addLastingEffect(s, { targetInstanceId: 'u1', power: 2 })
    const { rerender } = render(<UnitLine state={s} unit={unit('u1', 'TST_D')} interact={noInteract} />)
    expect(screen.getByTestId('board-unit-mod-u1')).toHaveTextContent('+2+0')

    rerender(<UnitLine state={boardWith('TST_D')} unit={unit('u2', 'TST_D')} interact={noInteract} />)
    expect(screen.queryByTestId('board-unit-mod-u2')).toBeNull()
  })

  it('does not render the old bottom power/health line for a unit with art-backed stats', () => {
    // A card WITH art renders no textual fallback; the board tile should carry no
    // "power/health" readout of its own any more — that lives on the card art (#326).
    const s = state({ cards: { ...CARDS, TST_A: card({ id: 'TST_A', type: 'unit', power: 3, hp: 4, frontArt: 'https://cdn.swu-db.com/images/cards/TST/A.png' }) } })
    render(<UnitLine state={s} unit={unit('u1', 'TST_A', { damage: 0 })} interact={noInteract} />)
    expect(screen.getByTestId('board-unit-u1')).not.toHaveTextContent('3/4')
  })
})

describe('UnitLine — attached upgrades (#336)', () => {
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

  it('zooms an attached upgrade from its exposed strip on Shift+hover (#336)', () => {
    const u = unit('u1', 'TST_U', { upgrades: [up()] })
    render(<UnitLine state={boardWithUpgrade()} unit={u} interact={noInteract} />)
    const stack = screen.getByTestId('board-unit-upgrades-u1')
    const upgradeCard = within(stack).getByTestId('card-face').parentElement!
    fireEvent.pointerEnter(upgradeCard, { pointerType: 'mouse' })
    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
    expect(screen.getByTestId('card-zoom')).toBeInTheDocument()
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false })
  })

  it('shows a Hidden badge on a hidden unit (#334)', () => {
    render(<UnitLine state={boardWith('TST_D')} unit={unit('u1', 'TST_D', { hidden: true })} interact={noInteract} />)
    expect(screen.getByTestId('board-unit-hidden-u1')).toHaveTextContent(/hidden/i)
  })

  it('hides the Hidden badge when the unit also has Sentinel — Sentinel overrides Hidden (#348)', () => {
    const s = state({ cards: { ...CARDS, TST_HS: card({ id: 'TST_HS', type: 'unit', power: 2, hp: 2, keywords: [{ name: 'Sentinel' }] }) } })
    render(<UnitLine state={s} unit={unit('u1', 'TST_HS', { hidden: true })} interact={noInteract} />)
    expect(screen.queryByTestId('board-unit-hidden-u1')).toBeNull() // no Hidden badge
    expect(screen.getByTestId('board-unit-sentinel-u1')).toBeInTheDocument()
  })

  it('shows a Sentinel badge on a unit with the Sentinel keyword, and none without (#334)', () => {
    const s = state({ cards: { ...CARDS, TST_S: card({ id: 'TST_S', type: 'unit', power: 2, hp: 2, keywords: [{ name: 'Sentinel' }] }) } })
    render(<UnitLine state={s} unit={unit('u1', 'TST_S')} interact={noInteract} />)
    expect(screen.getByTestId('board-unit-sentinel-u1')).toHaveTextContent(/sentinel/i)

    render(<UnitLine state={boardWith('TST_D')} unit={unit('u2', 'TST_D')} interact={noInteract} />)
    expect(screen.queryByTestId('board-unit-sentinel-u2')).toBeNull()
  })

  it('renders a shield token as an on-card overlay, not a behind-card upgrade (#334)', () => {
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
