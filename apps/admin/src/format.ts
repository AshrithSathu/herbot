export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export function stateLabel(state: 'new' | 'awaiting_purpose' | 'ready'): string {
  return { new: 'Not set up', awaiting_purpose: 'Asking its purpose', ready: 'Ready' }[state]
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
}

/** Same rules herbot-core applies (`setup::validate_purpose`), checked early
 * so the form can say what's wrong next to the field. */
export const PURPOSE_MAX = 8000

export function purposeProblem(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.split(/\s+/).filter(Boolean).length < 3) {
    return 'Describe the purpose in at least 3 words, like “Help me plan trips”.'
  }
  const chars = charCount(trimmed)
  if (chars > PURPOSE_MAX) {
    return `Keep it under ${PURPOSE_MAX.toLocaleString('en-GB')} characters. It’s ${chars.toLocaleString('en-GB')} now.`
  }
  return null
}

/** Counts characters the way Rust does (code points, not UTF-16 units). */
export function charCount(text: string): number {
  return Array.from(text).length
}

/** Exact count with separators: 1,234,567. */
export function exact(n: number): string {
  return n.toLocaleString('en-GB')
}

/** Counts that must fit a small box: exact up to 99,999, then 120K / 1.2M. */
export function compact(n: number): string {
  if (Math.abs(n) < 100_000) return exact(n)
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** Time of day for a chat bubble: 14:05. */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** Local calendar day, for grouping: 2026-11-09. */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** "Today", "Yesterday", or "Mon 3 Nov 2026". */
export function dayLabel(iso: string, now = new Date()): string {
  const key = dayKey(iso)
  if (key === dayKey(now.toISOString())) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (key === dayKey(yesterday.toISOString())) return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

/** Shortens text for a label, keeping whole characters (not UTF-16 halves). */
export function clip(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text
}
