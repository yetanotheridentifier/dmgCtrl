import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { makeMatchMediaMock } from './setup'

const iosUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const androidUserAgent = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const desktopUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const originalUserAgent = navigator.userAgent

function dispatchInstallPrompt() {
  const mockPromptFn = vi.fn().mockResolvedValue(undefined)
  const event = new Event('beforeinstallprompt')
  Object.assign(event, { prompt: mockPromptFn, preventDefault: vi.fn() })
  window.dispatchEvent(event)
  return mockPromptFn
}

describe('useInstallPrompt', () => {
  beforeEach(() => {
    sessionStorage.removeItem('install_banner_dismissed')
    Object.defineProperty(window.navigator, 'standalone', { value: undefined, configurable: true })
    Object.defineProperty(window.navigator, 'userAgent', { value: desktopUserAgent, configurable: true })
    makeMatchMediaMock()
  })

  afterEach(() => {
    sessionStorage.removeItem('install_banner_dismissed')
    Object.defineProperty(window.navigator, 'userAgent', { value: originalUserAgent, configurable: true })
    Object.defineProperty(window.navigator, 'standalone', { value: undefined, configurable: true })
  })

  // ── Standalone detection ──────────────────────────────────────────────────

  it('showBanner is false when standalone via matchMedia', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true, configurable: true,
      value: (query: string) => ({
        matches: query === '(display-mode: standalone)',
        media: query, addEventListener: () => {}, removeEventListener: () => {},
      }),
    })
    Object.defineProperty(window.navigator, 'userAgent', { value: iosUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.showBanner).toBe(false)
  })

  it('showBanner is false when standalone via navigator.standalone', () => {
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true })
    Object.defineProperty(window.navigator, 'userAgent', { value: iosUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.showBanner).toBe(false)
  })

  // ── iOS ───────────────────────────────────────────────────────────────────

  it('showBanner is true for iOS non-standalone', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: iosUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.showBanner).toBe(true)
  })

  it('platform is "ios" for iOS user agent', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: iosUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.platform).toBe('ios')
  })

  it('showBanner is false after dismiss on iOS', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: iosUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    act(() => result.current.onDismiss())
    expect(result.current.showBanner).toBe(false)
  })

  // ── Android ───────────────────────────────────────────────────────────────

  it('showBanner is false on Android before beforeinstallprompt fires', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: androidUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.showBanner).toBe(false)
  })

  it('showBanner is true on Android after beforeinstallprompt fires', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: androidUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    act(() => { dispatchInstallPrompt() })
    expect(result.current.showBanner).toBe(true)
  })

  it('platform is "android" for Android user agent', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: androidUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.platform).toBe('android')
  })

  it('onInstall calls deferredPrompt.prompt()', async () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: androidUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    const mockPromptFn = vi.fn().mockResolvedValue(undefined)
    act(() => {
      const event = new Event('beforeinstallprompt')
      Object.assign(event, { prompt: mockPromptFn, preventDefault: vi.fn() })
      window.dispatchEvent(event)
    })
    await act(async () => { result.current.onInstall() })
    expect(mockPromptFn).toHaveBeenCalledOnce()
  })

  it('showBanner is false after install on Android', async () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: androidUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    act(() => { dispatchInstallPrompt() })
    await act(async () => { result.current.onInstall() })
    expect(result.current.showBanner).toBe(false)
  })

  it('showBanner is false after dismiss on Android', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: androidUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    act(() => { dispatchInstallPrompt() })
    act(() => result.current.onDismiss())
    expect(result.current.showBanner).toBe(false)
  })

  // ── Pre-mount capture ─────────────────────────────────────────────────────

  it('showBanner is true on Android when beforeinstallprompt was captured before mount', () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: androidUserAgent, configurable: true })
    const mockPromptFn = vi.fn().mockResolvedValue(undefined)
    const event = new Event('beforeinstallprompt')
    Object.assign(event, { prompt: mockPromptFn, preventDefault: vi.fn() })
    ;(window as unknown as Record<string, unknown>).__dmgInstallPrompt = event
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.showBanner).toBe(true)
    delete (window as unknown as Record<string, unknown>).__dmgInstallPrompt
  })

  // ── Session persistence ───────────────────────────────────────────────────

  it('showBanner is false on iOS when already dismissed in sessionStorage', () => {
    sessionStorage.setItem('install_banner_dismissed', '1')
    Object.defineProperty(window.navigator, 'userAgent', { value: iosUserAgent, configurable: true })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.showBanner).toBe(false)
  })

  // ── Non-mobile ────────────────────────────────────────────────────────────

  it('showBanner is false on desktop even after beforeinstallprompt fires', () => {
    const { result } = renderHook(() => useInstallPrompt())
    act(() => { dispatchInstallPrompt() })
    expect(result.current.showBanner).toBe(false)
  })

  it('platform is null for desktop user agent', () => {
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.platform).toBe(null)
  })
})
