// Text that came from people or agents: topic names, purposes, memories,
// task titles, error messages. It can be any script, any direction, empty,
// thousands of characters with no spaces, or stacked with combining marks.
// Everything that shows such text goes through here, so none of it can
// break a layout.
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  children: string | null | undefined
  /** One line with an ellipsis (default), N lines, or the whole text. */
  lines?: 1 | 2 | 3 | 'all'
  /** Shown when the text is empty or only spaces. */
  fallback?: ReactNode
  className?: string
  /** Element to render; inline by default. */
  as?: 'span' | 'p' | 'div'
}

/**
 * - `dir="auto"` + `unicode-bidi: isolate`: an Arabic name lays itself out
 *   right to left without reordering the UI around it.
 * - `overflow-wrap: anywhere`: a 2,000-character word wraps instead of
 *   widening the page.
 * - `overflow: clip` on a fixed line box: combining marks (Zalgo) can't paint
 *   over the rows above and below.
 * - Truncated text keeps its full value in `title`.
 */
export function UserText({ children, lines = 1, fallback = 'Untitled', className, as: Tag = 'span' }: Props) {
  const text = (children ?? '').trim()
  if (!text) {
    return <Tag className={cn('text-muted-foreground italic', lines === 1 && 'block truncate', className)}>{fallback}</Tag>
  }
  return (
    <Tag
      dir="auto"
      title={lines === 'all' ? undefined : text}
      className={cn(
        'user-text',
        lines === 1 && 'block truncate',
        lines === 2 && 'line-clamp-2',
        lines === 3 && 'line-clamp-3',
        lines === 'all' && 'whitespace-pre-wrap',
        className,
      )}
    >
      {text}
    </Tag>
  )
}
