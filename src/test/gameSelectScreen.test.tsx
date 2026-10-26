import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GameSelectScreen from '../components/gameSelectScreen'

const show = (props: Partial<React.ComponentProps<typeof GameSelectScreen>> = {}) =>
  render(<GameSelectScreen lastGame={null} onSelectSwu={vi.fn()} onSelectXwing={vi.fn()} onHelp={vi.fn()} onSettings={vi.fn()} {...props} />)

describe('GameSelectScreen', () => {

  it('is headed dmgCtrl, with the app icon', () => {
    show()
    expect(screen.getByRole('heading', { level: 1, name: 'dmgCtrl' })).toBeInTheDocument()
    expect(screen.getByTestId('app-icon')).toBeInTheDocument()
  })

  it('shows a tile for each game, with its logo', () => {
    show()
    expect(screen.getByRole('button', { name: 'Star Wars: Unlimited' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'X-Wing' })).toBeInTheDocument()
    expect(screen.getByAltText('Star Wars Unlimited')).toBeInTheDocument()
    expect(screen.getByAltText('Star Wars X-Wing')).toBeInTheDocument()
  })

  it('marks no tile Last played before a game has been played', () => {
    show()
    expect(screen.queryByText(/last played/i)).not.toBeInTheDocument()
  })

  it('marks the game played last', () => {
    show({ lastGame: 'xwing' })
    expect(screen.getByRole('button', { name: 'X-Wing, last played' })).toHaveTextContent(/last played/i)
    expect(screen.getByRole('button', { name: 'Star Wars: Unlimited' })).not.toHaveTextContent(/last played/i)
  })

  it('opens each game from its tile', async () => {
    const onSelectSwu = vi.fn()
    const onSelectXwing = vi.fn()
    show({ onSelectSwu, onSelectXwing, lastGame: 'swu' })
    await userEvent.click(screen.getByRole('button', { name: 'Star Wars: Unlimited, last played' }))
    await userEvent.click(screen.getByRole('button', { name: 'X-Wing' }))
    expect(onSelectSwu).toHaveBeenCalledOnce()
    expect(onSelectXwing).toHaveBeenCalledOnce()
  })

  it('has Help and Settings as worded buttons in the header', async () => {
    const onHelp = vi.fn()
    const onSettings = vi.fn()
    show({ onHelp, onSettings })
    await userEvent.click(screen.getByRole('button', { name: 'Help' }))
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('button', { name: 'Help' })).toHaveTextContent('Help')
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveTextContent('Settings')
    expect(onHelp).toHaveBeenCalledOnce()
    expect(onSettings).toHaveBeenCalledOnce()
  })

  it('shows the install banner it is given, under the tiles', () => {
    show({ banner: <div data-testid="banner" /> })
    expect(screen.getByTestId('banner')).toBeInTheDocument()
  })

})
