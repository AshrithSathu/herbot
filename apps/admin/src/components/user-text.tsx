// Text that came from people or agents: topic names, purposes, memories,
// task titles, error messages. It can be any script, any direction, empty,
// thousands of characters with no spaces, or stacked with combining marks.
// Everything that shows such text goes through here, so none of it can
// break a layout.
import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from 'react'
import { cn } from '@/lib/utils'

/** Stacks of more than three combining marks on one letter (Zalgo) are cut
 * to three for display: real scripts (Vietnamese, Thai, Arabic harakat) use
 * at most three, and longer stacks paint over the lines around them. The
 * full text stays in `title`. */
function tame(text: string): string {
  return text.replace(/(\p{M}{3})\p{M}+/gu, '$1')
}

/**
 * Whether an element's content is clipped (a line clamp or a fixed height
 * hides some of it), measured from the rendered box, not guessed from a
 * character count: show "Show all" only when this is true.
 */
export function useOverflows<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [over, setOver] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  })
  return [ref, over]
}

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
 * - One line aligns with what's around it (`text-align: match-parent`), so
 *   an Arabic name in a left-aligned row starts at the left like its
 *   neighbours instead of jumping right; its letters still run right to left.
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
        lines === 1 && 'block truncate [text-align:match-parent]',
        lines === 2 && 'line-clamp-2',
        lines === 3 && 'line-clamp-3',
        lines === 'all' && 'whitespace-pre-wrap',
        className,
      )}
    >
      {lines === 'all' ? text : tame(text)}
    </Tag>
  )
}
