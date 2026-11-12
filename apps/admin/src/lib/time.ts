// Calendar words for a moment close to now: "Today 19:37", "Tomorrow 09:00",
// "Fri 09:00", "12 Nov 09:00", "12 Nov 2027". Times are 24-hour, as in the
// rest of the panel.
const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function dayTime(iso: string, now: number): string {
  const d = new Date(iso)
  const today = new Date(now)
  const days = Math.round((startOfDay(d) - startOfDay(today)) / 86_400_000)
  if (days === 0) return `Today ${time(d)}`
  if (days === 1) return `Tomorrow ${time(d)}`
  if (days === -1) return `Yesterday ${time(d)}`
  if (days > 1 && days < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${time(d)}`
  if (d.getFullYear() === today.getFullYear()) return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time(d)}`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
