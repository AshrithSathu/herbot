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
