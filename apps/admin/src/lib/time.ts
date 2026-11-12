// The panel's one way of writing a moment (docs/design/DECISIONS.md: one
// date formatter). Calendar words close to now, 24-hour times:
//   "just now", "12 min ago"          within the last hour (stamp only)
//   "Today 19:37", "Yesterday 09:10", "Tomorrow 09:00"
//   "Fri 09:00"                        within a week either way
//   "12 Nov 09:00"                     this year
//   "12 Nov 2025"                      another year
// with the full date ("Thu 12 Nov 2026, 19:37") as the tooltip.
const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Calendar words for a moment, past or future: "Today 19:37", "Fri 09:00". */
export function dayTime(iso: string, now: number): string {
  const d = new Date(iso)
  const today = new Date(now)
  const days = Math.round((startOfDay(d) - startOfDay(today)) / 86_400_000)
  if (days === 0) return `Today ${time(d)}`
  if (days === 1) return `Tomorrow ${time(d)}`
  if (days === -1) return `Yesterday ${time(d)}`
  if (Math.abs(days) < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time(d)}`
  if (d.getFullYear() === today.getFullYear()) return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time(d)}`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A past moment: relative within the hour, then calendar words. */
export function stamp(iso: string, now: number): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000)
  if (seconds >= 0 && seconds < 60) return 'just now'
  if (seconds >= 60 && seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  return dayTime(iso, now)
}

/** The full date and time, for tooltips: "Thu 12 Nov 2026, 19:37". */
export function fullDate(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${time(d)}`
}

/** The shortest form, for dense lists (agent rows), like a messenger:
 * "19:37" today, "Yesterday", "Fri", "12 Nov", "12 Nov 2025". */
export function listTime(iso: string, now: number): string {
  const d = new Date(iso)
  const today = new Date(now)
  const days = Math.round((startOfDay(d) - startOfDay(today)) / 86_400_000)
  if (days === 0) return time(d)
  if (days === -1) return 'Yesterday'
  if (Math.abs(days) < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' })
  if (d.getFullYear() === today.getFullYear()) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
