import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWakeLock } from '../hooks/useWakeLock'

const mockRelease = vi.fn().mockResolvedValue(undefined)
const mockRequest = vi.fn().mockResolvedValue({ release: mockRelease })

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request: mockRequest },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  Object.defineProperty(navigator, 'wakeLock', {
    value: undefined,
    configurable: true,
    writable: true,
  })
})

describe('useWakeLock', () => {

  it('acquires wake lock on mount when enabled', async () => {
    renderHook(() => useWakeLock(true))
    await act(async () => {})
    expect(mockRequest).toHaveBeenCalledWith('screen')
  })

  it('releases wake lock on unmount', async () => {
    const { unmount } = renderHook(() => useWakeLock(true))
    await act(async () => {})
    unmount()
    expect(mockRelease).toHaveBeenCalled()
  })

  it('does not acquire wake lock when disabled', async () => {
    renderHook(() => useWakeLock(false))
    await act(async () => {})
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('does not acquire when Wake Lock API is not available', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    renderHook(() => useWakeLock(true))
    await act(async () => {})
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it('reacquires wake lock when page becomes visible', async () => {
    renderHook(() => useWakeLock(true))
    await act(async () => {})
    expect(mockRequest).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockRequest).toHaveBeenCalledTimes(2)
  })

  it('does not reacquire when page becomes hidden', async () => {
    renderHook(() => useWakeLock(true))
    await act(async () => {})
    expect(mockRequest).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockRequest).toHaveBeenCalledTimes(1)
  })

  it('handles rejection from wakeLock.request gracefully without throwing', async () => {
    mockRequest.mockRejectedValueOnce(new DOMException('Battery saver', 'NotAllowedError'))
    const { unmount } = renderHook(() => useWakeLock(true))
    await act(async () => {})
    unmount()
    expect(mockRequest).toHaveBeenCalledWith('screen')
    expect(mockRelease).not.toHaveBeenCalled()
  })

})