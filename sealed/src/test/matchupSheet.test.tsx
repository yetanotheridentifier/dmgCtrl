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
  it('heads the columns opponent, games and win rate, in that order', () => {
    const sheet = renderSheet([against('SOR_005', 'SOR_021', 3, 2)])
    expect(sheet.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Opponent', 'Games', 'Win rate'])
  })

  it('gives each matchup a row of the leader and base art over the name, the games over the record, and the win rate', () => {
    const sheet = renderSheet([against('SOR_005', 'SOR_021', 3, 1, 1), against('SOR_005', 'SOR_019', 0, 2)])
    const rows = sheet.getAllByTestId('matchup-row')
    expect(rows).toHaveLength(2)
    const [opponent, games, rate] = within(rows[0]).getAllByRole('cell')
    expect(within(opponent).getAllByTestId('card-face')).toHaveLength(2)
    expect(within(opponent).getByRole('img', { name: CARDS['SOR_005'].name })).toBeInTheDocument()
    expect(within(opponent).getByRole('img', { name: CARDS['SOR_021'].name })).toBeInTheDocument()
    expect(within(opponent).getByTestId('matchup-subtitle')).toHaveTextContent(`${CARDS['SOR_005'].name}, ${CARDS['SOR_005'].subtitle} · Vigilance base`)
    expect(games.firstChild).toHaveTextContent(/^5$/)
    expect(within(games).getByTestId('matchup-subtitle')).toHaveTextContent(/^3 - 1 - 1$/)
    expect(rate).toHaveTextContent(/^60%$/)
    const second = within(rows[1]).getAllByRole('cell')
    expect(within(second[0]).getByRole('img', { name: CARDS['SOR_019'].name })).toBeInTheDocument()
    expect(second[1]).toHaveTextContent(/^20 - 2 - 0$/)
    expect(second[2]).toHaveTextContent(/^0%$/)
  })

  it('shows a grouped base by the base played in it, and names the group', () => {
    const sheet = renderSheet([against('SOR_005', 'SOR_020', 1, 0)])
    const [opponent] = within(sheet.getByTestId('matchup-row')).getAllByRole('cell')
    expect(within(opponent).getByRole('img', { name: CARDS['SOR_020'].name })).toBeInTheDocument()
    expect(within(opponent).getByTestId('matchup-subtitle')).toHaveTextContent(/Vigilance base$/)
  })

  it('sets alternate rows on the band token, with no rule between rows', () => {
    const sheet = renderSheet([against('SOR_005', 'SOR_021', 1, 0), against('SOR_005', 'SOR_019', 1, 0), against('SOR_005', 'SOR_020', 1, 0)])
    const rows = sheet.getAllByTestId('matchup-row')
    expect(rows.map(r => r.style.background)).toEqual(['var(--color-band)', '', 'var(--color-band)'])
    for (const cell of sheet.getAllByRole('cell')) expect(cell.style.borderBottom).toBe('')
  })
})
