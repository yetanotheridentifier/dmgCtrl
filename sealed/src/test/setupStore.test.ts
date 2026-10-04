// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { loadSetup, saveSetup, defaultSetup, STORAGE_KEY } from '../data/setupStore'
import type { Setup } from '../data/setupStore'
import { SET_PROGRESS } from '../data/implementedCards'

const NEWEST = SET_PROGRESS[0].code
const OLDER = SET_PROGRESS[SET_PROGRESS.length - 1].code

describe('setupStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('defaults', () => {
    /** The newest set is the one a player most likely wants, and a sealed deck comes from one set. */
    it('starts both generators on the newest set, linked', () => {
      expect(defaultSetup()).toMatchObject({ playerSet: NEWEST, opponentSet: NEWEST, linkSets: true })
    })

    it('plays a random generated opponent built around a random leader and base aspect', () => {
      expect(defaultSetup()).toMatchObject({ opponentChoice: 'generated', opponentLeader: '', opponentAspect: '' })
    })
  })

  describe('loadSetup', () => {
    it('returns the defaults when nothing is stored', () => {
      expect(loadSetup()).toEqual(defaultSetup())
    })

    it('does not write to storage', () => {
      loadSetup()
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('reads back what was saved', () => {
      const setup: Setup = {
        playerSet: OLDER,
        opponentSet: NEWEST,
        linkSets: false,
        opponentChoice: 'some-deck-id',
        opponentLeader: 'HMW_002',
        opponentAspect: 'Command',
      }
      saveSetup(setup)
      expect(loadSetup()).toEqual(setup)
    })

    it('falls back to the defaults when the stored blob is corrupt', () => {
      localStorage.setItem(STORAGE_KEY, 'not json {')
      expect(loadSetup()).toEqual(defaultSetup())
    })

    it('falls back to the defaults when the stored blob is not an object', () => {
      localStorage.setItem(STORAGE_KEY, '"a string"')
      expect(loadSetup()).toEqual(defaultSetup())
    })

    /** A set dropped from the manifest, or a code typed by hand, is not a set the screen can offer. */
    it('replaces an unknown set with the default, keeping the rest', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ playerSet: 'NOPE', opponentSet: OLDER, linkSets: false }))
      expect(loadSetup()).toEqual({ ...defaultSetup(), opponentSet: OLDER, linkSets: false })
    })

    it('replaces a wrongly typed value with that field’s default', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ linkSets: 'yes', opponentChoice: 7, opponentLeader: null }))
      expect(loadSetup()).toEqual(defaultSetup())
    })
  })
})
