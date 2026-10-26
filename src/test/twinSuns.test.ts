import { describe, it, expect } from 'vitest'
import {
  addDamage, claim, finish, lastPhase, nextRound, placings, removeDamage, resolveDestroyed, setEpicUsed, startState, yourResult,
} from '../utils/twinSuns'

// Four players: you (0) and three opponents, every base 30 HP unless a test says otherwise.
const HP = [30, 30, 30, 30]

describe('twinSuns: starting', () => {
  it('starts at round 1 with no damage, no counters claimed and no one out', () => {
    const s = startState(4)
    expect(s.round).toBe(1)
    expect(s.damage).toEqual([0, 0, 0, 0])
    expect(s.epicUsed).toEqual([false, false, false, false])
    expect(s.initiative).toBeNull()
    expect(s.plan).toBeNull()
    expect(s.blast).toBeNull()
    expect(s.out).toEqual([false, false, false, false])
    expect(s.pending).toEqual([])
    expect(s.finished).toBe(false)
  })

  it('sizes to three players', () => {
    expect(startState(3).damage).toEqual([0, 0, 0])
  })
})

describe('twinSuns: damage', () => {
  it('adds and removes damage on one base, within 0 and its HP', () => {
    let s = addDamage(startState(4), HP, 2, 5)
    expect(s.damage).toEqual([0, 0, 5, 0])
    s = removeDamage(s, 2, 9)
    expect(s.damage).toEqual([0, 0, 0, 0])
    s = addDamage(s, HP, 1, 99)
    expect(s.damage[1]).toBe(30)
  })

  it('a base reaching its HP is out, and waits for who destroyed it', () => {
    const s = addDamage(startState(4), HP, 3, 30)
    expect(s.out).toEqual([false, false, false, true])
    expect(s.pending).toEqual([3])
  })

  it('a base that is out takes no more damage and no healing', () => {
    let s = addDamage(startState(4), HP, 3, 30)
    s = resolveDestroyed(s, null)
    expect(addDamage(s, HP, 3, 1)).toBe(s)
    expect(removeDamage(s, 3, 1)).toBe(s)
  })
})

describe('twinSuns: counters', () => {
  it('Plan sits on the base that claimed it until Round', () => {
    let s = claim(startState(4), HP, 'plan', 1)
    expect(s.plan).toBe(1)
    s = nextRound(s)
    expect(s.plan).toBeNull()
    expect(s.round).toBe(2)
  })

  it('Blast deals 1 damage to every other base at once', () => {
    const s = claim(addDamage(startState(4), HP, 0, 4), HP, 'blast', 2)
    expect(s.blast).toBe(2)
    expect(s.damage).toEqual([5, 1, 0, 1])
  })

  it('Blast passes over a base that is out', () => {
    let s = resolveDestroyed(addDamage(startState(4), HP, 3, 30), null)
    s = claim(s, HP, 'blast', 0)
    expect(s.damage).toEqual([0, 1, 1, 30])
  })

  it('Blast can destroy bases, each waiting in turn for who destroyed it', () => {
    let s = addDamage(addDamage(startState(4), HP, 1, 29), HP, 3, 29)
    s = claim(s, HP, 'blast', 0)
    expect(s.pending).toEqual([1, 3])
    s = resolveDestroyed(s, 0)
    expect(s.pending).toEqual([3])
  })

  it('Round returns Plan and Blast; initiative stays with its holder', () => {
    let s = claim(claim(claim(startState(4), HP, 'initiative', 2), HP, 'plan', 1), HP, 'blast', 3)
    s = nextRound(nextRound(s))
    expect(s.plan).toBeNull()
    expect(s.blast).toBeNull()
    expect(s.initiative).toBe(2)
    expect(s.round).toBe(3)
  })

  it('initiative moves to whoever claims it next', () => {
    const s = claim(claim(startState(4), HP, 'initiative', 2), HP, 'initiative', 0)
    expect(s.initiative).toBe(0)
  })
})

describe('twinSuns: a base destroyed', () => {
  it('the player who destroyed it heals 5, shown as healed', () => {
    let s = addDamage(addDamage(startState(4), HP, 1, 8), HP, 2, 30)
    s = resolveDestroyed(s, 1)
    expect(s.damage[1]).toBe(3)
    expect(s.healed).toBe(1)
    expect(s.pending).toEqual([])
    expect(s.out[2]).toBe(true)
  })

  it('healing never goes below no damage', () => {
    let s = addDamage(addDamage(startState(4), HP, 1, 2), HP, 2, 30)
    s = resolveDestroyed(s, 1)
    expect(s.damage[1]).toBe(0)
  })

  it('No one skips the heal', () => {
    let s = addDamage(addDamage(startState(4), HP, 1, 8), HP, 2, 30)
    s = resolveDestroyed(s, null)
    expect(s.damage[1]).toBe(8)
    expect(s.healed).toBeNull()
  })

  it('the healed mark clears with the next action', () => {
    let s = resolveDestroyed(addDamage(startState(4), HP, 2, 30), 1)
    s = addDamage(s, HP, 0, 1)
    expect(s.healed).toBeNull()
  })

  it('a base out makes it the last phase, until the game is finished', () => {
    let s = startState(4)
    expect(lastPhase(s)).toBe(false)
    s = resolveDestroyed(addDamage(s, HP, 2, 30), null)
    expect(lastPhase(s)).toBe(true)
    s = finish(s)
    expect(lastPhase(s)).toBe(false)
    expect(s.finished).toBe(true)
  })
})

describe('twinSuns: epic action', () => {
  it('marks and unmarks one base', () => {
    let s = setEpicUsed(startState(3), 1, true)
    expect(s.epicUsed).toEqual([false, true, false])
    s = setEpicUsed(s, 1, false)
    expect(s.epicUsed).toEqual([false, false, false])
  })
})

describe('twinSuns: placings', () => {
  it('ranks by HP left: 1st won, then 2nd and 3rd, a base out last', () => {
    let s = startState(4)
    s = addDamage(s, HP, 0, 16) // 14 left
    s = addDamage(s, HP, 1, 11) // 19 left
    s = addDamage(s, HP, 2, 24) // 6 left
    s = resolveDestroyed(addDamage(s, HP, 3, 30), null)
    const p = placings(finish(s), HP)
    expect(p.map(x => x.label)).toEqual(['2nd', '1st · Won', '3rd', 'Out'])
    expect(p.map(x => x.hpLeft)).toEqual([14, 19, 6, 0])
    expect(yourResult(s, HP)).toBe('lost')
  })

  it('a tie for most HP is a draw between those players', () => {
    let s = startState(3)
    s = addDamage(s, HP, 0, 10)
    s = addDamage(s, HP, 1, 10)
    s = addDamage(s, HP, 2, 12)
    const p = placings(s, HP)
    expect(p.map(x => x.label)).toEqual(['1st · Draw', '1st · Draw', '3rd'])
    expect(yourResult(s, HP)).toBe('drawn')
  })

  it('your result is a win when you alone have most HP left', () => {
    const s = addDamage(startState(3), HP, 1, 3)
    expect(yourResult(s, HP)).toBe('drawn')
    expect(yourResult(addDamage(s, HP, 2, 3), HP)).toBe('won')
  })

  it('compares HP left, not damage, when bases differ in HP', () => {
    const hp = [25, 30, 30]
    const s = addDamage(startState(3), hp, 2, 3)
    expect(placings(s, hp).map(x => x.label)).toEqual(['3rd', '1st · Won', '2nd'])
  })
})
