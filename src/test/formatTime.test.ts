import { describe, it, expect } from 'vitest'
import { formatTime } from '../utils/formatTime'

describe('formatTime', () => {

  it('formats 0 as 0:00', () => {
    expect(formatTime(0)).toBe('0:00')
  })

  it('formats 59 as 0:59', () => {
    expect(formatTime(59)).toBe('0:59')
  })

  it('formats 60 as 1:00', () => {
    expect(formatTime(60)).toBe('1:00')
  })

  it('formats 61 as 1:01', () => {
    expect(formatTime(61)).toBe('1:01')
  })

  it('zero-pads single-digit seconds', () => {
    expect(formatTime(65)).toBe('1:05')
  })

  it('formats 300 as 5:00', () => {
    expect(formatTime(300)).toBe('5:00')
  })

  it('formats 301 as 5:01', () => {
    expect(formatTime(301)).toBe('5:01')
  })

  it('formats 4500 as 75:00', () => {
    expect(formatTime(4500)).toBe('75:00')
  })

  it('formats 4499 as 74:59', () => {
    expect(formatTime(4499)).toBe('74:59')
  })

})
