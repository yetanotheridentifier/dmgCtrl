import { describe, it, expect, beforeEach } from 'vitest'
import { gameFromPath, launchScreen, readLastGame, recordLastGame, recordLaunch, launchCount } from '../utils/appStart'

beforeEach(() => localStorage.clear())

describe('gameFromPath', () => {

  it('reads /swu and /xwing, with or without a trailing slash', () => {
    expect(gameFromPath('/swu', '/')).toBe('swu')
    expect(gameFromPath('/swu/', '/')).toBe('swu')
    expect(gameFromPath('/xwing', '/')).toBe('xwing')
    expect(gameFromPath('/xwing/index.html', '/')).toBe('xwing')
  })

  it('reads the game under a base path', () => {
    expect(gameFromPath('/dmgCtrl/xwing/', '/dmgCtrl/')).toBe('xwing')
  })

  it('names no game for the root or any other address', () => {
    expect(gameFromPath('/', '/')).toBeNull()
    expect(gameFromPath('/index.html', '/')).toBeNull()
    expect(gameFromPath('/sealed/', '/')).toBeNull()
    expect(gameFromPath('/swuniverse', '/')).toBeNull()
  })

})

describe('launchScreen: the first that applies', () => {

  const none = { tournamentInProgress: false, route: null, startScreen: 'lastGame', lastGame: null } as const

  it('a tournament in progress opens the tournament, whatever else applies', () => {
    expect(launchScreen({ ...none, tournamentInProgress: true, route: 'xwing', startScreen: 'xwing', lastGame: 'xwing' })).toBe('tournament')
  })

  it('an X-Wing tournament in progress opens it, unless an SWU one is in progress too', () => {
    expect(launchScreen({ ...none, xwingTournamentInProgress: true, route: 'swu', startScreen: 'swu', lastGame: 'swu' })).toBe('xwingTournament')
    expect(launchScreen({ ...none, tournamentInProgress: true, xwingTournamentInProgress: true })).toBe('tournament')
  })

  it('/swu or /xwing opens that game’s setup ahead of the start screen', () => {
    expect(launchScreen({ ...none, route: 'swu', startScreen: 'xwing', lastGame: 'xwing' })).toBe('setup')
    expect(launchScreen({ ...none, route: 'xwing', startScreen: 'gameSelect' })).toBe('xwingSetup')
  })

  it('Last game played opens the setup of the game played last', () => {
    expect(launchScreen({ ...none, lastGame: 'xwing' })).toBe('xwingSetup')
    expect(launchScreen({ ...none, lastGame: 'swu' })).toBe('setup')
  })

  it('Last game played with no game played yet opens game select', () => {
    expect(launchScreen(none)).toBe('gameSelect')
  })

  it('SWU or X-Wing opens that setup, whichever was played last', () => {
    expect(launchScreen({ ...none, startScreen: 'swu', lastGame: 'xwing' })).toBe('setup')
    expect(launchScreen({ ...none, startScreen: 'xwing', lastGame: 'swu' })).toBe('xwingSetup')
  })

  it('Game select opens game select, whichever was played last', () => {
    expect(launchScreen({ ...none, startScreen: 'gameSelect', lastGame: 'xwing' })).toBe('gameSelect')
  })

})

describe('the last game played', () => {

  it('is none until a game is recorded', () => {
    expect(readLastGame()).toBeNull()
  })

  it('is remembered once recorded, and the latest wins', () => {
    recordLastGame('xwing')
    expect(readLastGame()).toBe('xwing')
    recordLastGame('swu')
    expect(readLastGame()).toBe('swu')
  })

  it('ignores a stored value that is not a game', () => {
    localStorage.setItem('last_game', 'chess')
    expect(readLastGame()).toBeNull()
  })

})

describe('launches', () => {

  it('counts each launch', () => {
    expect(launchCount()).toBe(0)
    recordLaunch()
    expect(launchCount()).toBe(1)
    recordLaunch()
    expect(launchCount()).toBe(2)
  })

})
