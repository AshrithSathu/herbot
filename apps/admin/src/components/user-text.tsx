// Text that came from people or agents: topic names, purposes, memories,
// task titles, error messages. It can be any script, any direction, empty,
// thousands of characters with no spaces, or stacked with combining marks.
// Everything that shows such text goes through here, so none of it can
// break a layout.
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Props = Omit<HTMLAttributes<HTMLElement>, 'children' | 'dir'> & {
  children: string | null | undefined
  /** One line with an ellipsis (default), N lines, or the whole text. */
  lines?: 1 | 2 | 3 | 'all'
  /** Shown when the text is empty or only spaces. */
  fallback?: ReactNode
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
 * - Other attributes (`id`, `aria-*`) pass through, so a dialog title or a
 *   label can point at it.
 */
export function UserText({ children, lines = 1, fallback = 'Untitled', className, as: Tag = 'span', ...rest }: Props) {
  const text = (children ?? '').trim()
  if (!text) {
    return (
      <Tag {...rest} className={cn('text-mute italic', lines === 1 && 'block truncate', className)}>
        {fallback}
      </Tag>
    )
  }
  return (
    <Tag
      title={lines === 'all' ? undefined : text}
      {...rest}
      dir="auto"
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
