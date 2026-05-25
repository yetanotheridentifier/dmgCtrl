/**
 * Formats a duration in seconds as M:SS (e.g. 4500 → "75:00", 65 → "1:05").
 * Used by TimerDisplay and any screen that renders a countdown.
 */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
