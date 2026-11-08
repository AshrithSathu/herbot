// Long text, cut to a number of lines, with a way to read all of it.
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function ClampedText({
  lines,
  children,
  className,
  toggleClassName,
  footer,
}: {
  lines: number
  children: ReactNode
  className?: string
  toggleClassName?: string
  /** Rendered on the toggle's row, pushed to the right (a time, a badge). */
  footer?: ReactNode
}) {
  const id = useId()
  const text = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)

  // Is anything cut off? Checked while collapsed, and again whenever the
  // width changes (a narrower window wraps into more lines).
  useLayoutEffect(() => {
    const el = text.current
    if (!el || expanded) return
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [children, expanded])

  const showToggle = clamped || expanded
  return (
    <>
      <div
        id={id}
        ref={text}
        style={expanded ? undefined : { WebkitLineClamp: lines }}
        className={cn(
          'whitespace-pre-wrap wrap-anywhere',
          !expanded && 'overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical]',
          className,
        )}
      >
        {children}
      </div>
      {(showToggle || footer) && (
        <div className="flex items-center justify-end gap-2">
          {showToggle && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={id}
              onClick={() => setExpanded((open) => !open)}
              className={cn(
                // The visible label is small; the tap area isn't.
                "relative mr-auto cursor-pointer font-medium text-foreground underline-offset-2 hover:underline after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']",
                toggleClassName,
              )}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
          {footer}
        </div>
      )}
    </>
  )
}
