import { describe, it, expect } from 'vitest'
import { loadReport, replayUpTo } from './helpers/replayReport'
import { resolve } from '../engine/resolve'
import type { GameState } from '../engine/types'
import '../engine/cardDefinitions'

/**
 * **#529, on the board it was reported from.**
 *
 * Playing Anakin Skywalker (unique, cost 5) triggers two of the player's abilities at once: Anakin's
 * own "When Played: Give a Shield token to another friendly unit", and Grogu's leader trigger "when you
 * play a Unique unit costing 4 or more, you may deploy him". The reporter deployed Grogu first and was
 * then offered only the Alamite Hunter for the Shield.
 *
 * Grogu is a friendly unit by the time Anakin's ability resolves, so he is a legal target for it
 * (CR 7.6.12: the first ability resolves fully before the next begins). The engine fired both effects
 * at once instead, so Anakin's target list was computed while Grogu was still in the base zone.
 *
 * The report's own move list stops being replayable at the fix, because ordering the batch is a
 * question the reporter was never asked. It is driven by hand from the play instead.
 */
const ANAKIN = 'ASH_255'
const GROGU = 'ASH_018'
/** The move index of `playUnit` Anakin: the last decision before the batch. */
const ANAKIN_PLAYED = 44

const report = loadReport('nestedDeployShieldTarget')
const played = (): GameState => replayUpTo(report, ANAKIN_PLAYED)

const choice = (s: GameState, kind: string) => (s.pendingChoices ?? []).find(c => c.kind === kind)

describe('#529: deploying Grogu mid-batch makes him a Shield target', () => {
  it('replays to Anakin entering play', () => {
    const board = played()
    expect(board.winner).toBeNull()
    expect(board.players.player.units.find(u => u.instanceId === 'u10')?.cardId).toBe(ANAKIN)
    expect(board.players.player.leader.deployed, 'Grogu is still in the base zone').toBe(false)
  })

  /** Two abilities on the player's own cards, triggered by the same event: their order, their call. */
  it('offers the order of the two abilities rather than resolving both', () => {
    const ask = choice(played(), 'chooseNextTrigger')
    expect(ask).toBeDefined()
    const sources = (ask as { candidates: { cardId: string }[] }).candidates.map(c => c.cardId)
    expect(sources).toEqual(expect.arrayContaining([ANAKIN, GROGU]))
  })

  /** The defect, stated as what must no longer happen: Anakin picks its targets before Grogu lands. */
  it('has not raised the Shield choice before the order is settled', () => {
    expect(choice(played(), 'mayGiveTokens')).toBeUndefined()
  })

  describe('taking Grogu\'s deploy first', () => {
    const deployed = (): GameState => {
      const board = played()
      const ask = choice(board, 'chooseNextTrigger')!
      const candidates = (ask as { candidates: { cardId: string }[] }).candidates
      const picked = resolve(board, { type: 'acceptChoice', choiceId: ask.id, optionIndex: candidates.findIndex(c => c.cardId === GROGU) })
      return resolve(picked, { type: 'acceptChoice', choiceId: choice(picked, 'mayDeployLeader')!.id })
    }

    it('puts Grogu on the board', () => {
      const board = deployed()
      expect(board.players.player.leader.deployed).toBe(true)
      expect(board.players.player.units.some(u => u.isLeader && u.cardId === GROGU)).toBe(true)
    })

    it('then offers him as a target for Anakin\'s Shield', () => {
      const board = deployed()
      const shield = choice(board, 'mayGiveTokens')
      expect(shield, "Anakin's When Played resolves after the deploy").toBeDefined()
      const grogu = board.players.player.units.find(u => u.isLeader && u.cardId === GROGU)!
      expect((shield as { targets: string[] }).targets).toContain(grogu.instanceId)
    })

    it('and the Shield actually attaches to him', () => {
      const board = deployed()
      const shield = choice(board, 'mayGiveTokens')!
      const grogu = board.players.player.units.find(u => u.isLeader && u.cardId === GROGU)!
      const given = resolve(board, { type: 'acceptChoice', choiceId: shield.id, targetInstanceId: grogu.instanceId })
      const after = given.players.player.units.find(u => u.instanceId === grogu.instanceId)!
      expect(after.upgrades.map(u => u.cardId)).toContain('TOKEN_SHIELD')
    })
  })
})
