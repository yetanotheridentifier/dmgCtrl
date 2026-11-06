// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import sorSet from './fixtures/sorSet.json'
import type { SwuCard } from '../data/cards'
import { buildCardDb } from '../engine/cardDb'
import { sideOf } from '../data/matchups'
import type { Matchup } from '../data/matchups'
import { MatchupSheet } from '../components/setup/setupSheets'

/** The Matchups sheet: a table of each opposing leader and base, with the games played and the win rate. */
const CARDS = buildCardDb(sorSet as unknown as SwuCard[])

/** The fixture sets carry no art, so each card is given some to be drawn by. */
const withArt = (id: string) => ({ ...CARDS[id], frontArt: `https://art.test/${id}.png` })
const against = (leader: string, base: string, won: number, lost: number, drawn = 0): Matchup =>
  ({ opponent: sideOf(withArt(leader), withArt(base))!, record: { won, lost, drawn } })

function renderSheet(matchups: Matchup[]) {
  render(<MatchupSheet open mine={sideOf(CARDS['SOR_010'], CARDS['SOR_029'])} matchups={matchups} onClose={() => {}} />)
  return within(screen.getByRole('dialog', { name: 'Matchups' }))
}

describe('the Matchups sheet', () => {
  it('heads the columns leader, base, opponent, games and win rate, in that order', () => {
    const sheet = renderSheet([against('SOR_005', 'SOR_021', 3, 2)])
    expect(sheet.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Leader', 'Base', 'Opponent', 'Games', 'Win rate'])
  })

  it('gives each matchup a row of leader art, base art, name, games and win rate', () => {
    const sheet = renderSheet([against('SOR_005', 'SOR_021', 3, 1, 1), against('SOR_005', 'SOR_019', 0, 2)])
    const rows = sheet.getAllByTestId('matchup-row')
    expect(rows).toHaveLength(2)
    const [leader, base, name, games, rate] = within(rows[0]).getAllByRole('cell')
    expect(within(leader).getByTestId('card-face')).toBeInTheDocument()
    expect(within(leader).getByRole('img', { name: CARDS['SOR_005'].name })).toBeInTheDocument()
    expect(within(base).getByRole('img', { name: CARDS['SOR_021'].name })).toBeInTheDocument()
    expect(name).toHaveTextContent(`${CARDS['SOR_005'].name}, ${CARDS['SOR_005'].subtitle} · Vigilance base`)
    expect(games).toHaveTextContent(/^5$/)
    expect(rate).toHaveTextContent(/^60%$/)
    const second = within(rows[1]).getAllByRole('cell')
    expect(within(second[1]).getByRole('img', { name: CARDS['SOR_019'].name })).toBeInTheDocument()
    expect(second[3]).toHaveTextContent(/^2$/)
    expect(second[4]).toHaveTextContent(/^0%$/)
  })

  it('shows a grouped base by the base played in it, and names the group', () => {
    const sheet = renderSheet([against('SOR_005', 'SOR_020', 1, 0)])
    const [, base, name] = within(sheet.getByTestId('matchup-row')).getAllByRole('cell')
    expect(within(base).getByRole('img', { name: CARDS['SOR_020'].name })).toBeInTheDocument()
    expect(name).toHaveTextContent(/Vigilance base$/)
  })
})
