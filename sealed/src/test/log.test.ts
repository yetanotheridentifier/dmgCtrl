import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { logger, getLogs, clearLogs } from '../data/log'

describe('logger', () => {
  beforeEach(() => {
    clearLogs()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records entries with level, message, and detail', () => {
    logger.error('card fetch failed', { id: 'ASH_020', status: 502 })
    const logs = getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      level: 'error',
      message: 'card fetch failed',
      detail: { id: 'ASH_020', status: 502 },
    })
    expect(logs[0].at).toBeGreaterThan(0)
  })

  it('mirrors to the console with the sealed prefix', () => {
    logger.warn('slow hydration')
    expect(console.warn).toHaveBeenCalledWith('[sealed]', 'slow hydration', '')
  })

  it('caps the buffer at 200 entries, dropping the oldest', () => {
    for (let i = 0; i < 210; i++) logger.info(`entry ${i}`)
    const logs = getLogs()
    expect(logs).toHaveLength(200)
    expect(logs[0].message).toBe('entry 10')
    expect(logs[199].message).toBe('entry 209')
  })

  it('is reachable from the console for support (window.__sealedLogs)', () => {
    logger.info('hello')
    expect((window as unknown as { __sealedLogs: () => unknown[] }).__sealedLogs()).toHaveLength(1)
  })
})
