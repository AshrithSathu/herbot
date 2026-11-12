// Five-field cron schedules in words, for the Tasks page.

/** Weekday names, Sunday first (cron's 0). */
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_NAMES: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const isNum = (s: string) => /^\d+$/.test(s)
const pad = (n: string) => n.padStart(2, '0')

function dayNumber(token: string): number | null {
  const upper = token.toUpperCase()
  if (upper in DAY_NAMES) return DAY_NAMES[upper]
  const n = Number(token)
  return Number.isInteger(n) && n >= 0 && n <= 7 ? n % 7 : null
}

function weekdays(field: string): string | null {
  const upper = field.toUpperCase()
  if (upper === '1-5' || upper === 'MON-FRI') return 'Weekdays'
  const list = field.split(',').map(dayNumber)
  if (list.some((d) => d == null)) return null
  const days = [...new Set(list as number[])].sort()
  if (days.length === 2 && days[0] === 0 && days[1] === 6) return 'Weekends'
  if (days.length === 1) return `Every ${DAYS[days[0]]}`
  return `${days.slice(0, -1).map((d) => `${DAYS[d]}s`).join(', ')} and ${DAYS[days.at(-1)!]}s`
}

/** A five-field cron in words, or null when it doesn't read simply. */
export function describeCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [min, hour, dom, month, dow] = parts
  const every = /^\*\/(\d+)$/
  if (every.test(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const n = Number(min.match(every)![1])
    return n === 1 ? 'Every minute' : `Every ${n} minutes`
  }
  if (isNum(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') return `Every hour at :${pad(min)}`
  if (isNum(min) && every.test(hour) && dom === '*' && month === '*' && dow === '*') return `Every ${hour.match(every)![1]} hours at :${pad(min)}`
  if (!isNum(min) || !isNum(hour)) return null
  const at = `${pad(hour)}:${pad(min)}`
  if (dom === '*' && month === '*') {
    if (dow === '*') return `Every day at ${at}`
    const days = weekdays(dow)
    return days ? `${days} at ${at}` : null
  }
  if (dow !== '*') return null
  if (dom.toUpperCase() === 'L' && month === '*') return `Last day of every month at ${at}`
  if (isNum(dom) && month === '*') return `Day ${Number(dom)} of every month at ${at}`
  if (isNum(dom) && isNum(month) && Number(month) >= 1 && Number(month) <= 12) return `Every ${Number(dom)} ${MONTHS[Number(month) - 1]} at ${at}`
  return null
}
