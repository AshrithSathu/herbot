// List rows (docs/design/DECISIONS.md, "List rows"):
// - LedgerTable: one line, aligned columns, tabular figures, for lists you
//   scan and compare (topics, logs). On phones each row folds to a title
//   line plus a line underneath.
// - ThreadList: two lines (what it is, then what it says), for lists you
//   read (tasks, memories), with quiet actions that are always visible.
// Both virtualize against the pane that scrolls them ([data-hb-scroll]).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { LoaderIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Put on a row's main link to make the whole row clickable while other
 * controls in the row stay reachable (they sit above it). */
export const STRETCH = "after:absolute after:inset-0 after:content-['']"

/** Finds the element that scrolls this list (the shell's pane, or the page). */
function useScrollParent<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [margin, setMargin] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const parent = (el.parentElement?.closest('[data-hb-scroll]') as HTMLElement | null) ?? document.scrollingElement
    if (!(parent instanceof HTMLElement)) return
    setScroller(parent)
    const measure = () => {
      const top = el.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop
      setMargin(parent === document.scrollingElement ? el.getBoundingClientRect().top + window.scrollY : top)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])
  return { ref, scroller, margin }
}

export type Column<T> = {
  id: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** A CSS grid track: "minmax(10rem,1.4fr)", "6rem", "auto". */
  width: string
  align?: 'start' | 'end'
  /** Figures: tabular and right-aligned. */
  numeric?: boolean
  /** On phones: part of the first line ("title"), its right end ("aside"),
   * the line underneath ("below"), or hidden. */
  phone?: 'title' | 'aside' | 'below' | 'hide'
}

type LedgerProps<T> = {
  label: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  /** Estimated row height on desktop, for the virtualizer. */
  estimate?: number
  /** Renders after the last row (a "loading older" line, a sentinel). */
  footer?: ReactNode
  /** Called when the last rows come into view (for infinite loading). */
  onEndReached?: () => void
  className?: string
}

export function LedgerTable<T>({ label, rows, columns, rowKey, estimate = 44, footer, onEndReached, className }: LedgerProps<T>) {
  const { ref, scroller, margin } = useScrollParent<HTMLDivElement>()
  const grid = columns.map((c) => c.width).join(' ')
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => estimate,
    overscan: 10,
    scrollMargin: margin,
    initialRect: { width: 1000, height: 800 },
  })
  const items = virtual.getVirtualItems()
  const last = items.at(-1)?.index ?? -1
  const endRef = useRef(onEndReached)
  endRef.current = onEndReached
  useLayoutEffect(() => {
    if (last >= rows.length - 5 && rows.length > 0) endRef.current?.()
  }, [last, rows.length])

  const title = columns.filter((c) => c.phone === 'title')
  const aside = columns.filter((c) => c.phone === 'aside')
  const below = columns.filter((c) => c.phone === 'below')

  return (
    <div ref={ref} role="table" aria-label={label} aria-rowcount={rows.length + 1} className={cn('min-w-0', className)}>
      <div role="rowgroup" className="hidden md:block">
        <div
          role="row"
          className="grid items-end gap-x-4 border-b border-line px-3 pb-2 text-[11px] font-medium tracking-[0.06em] text-mute uppercase"
          style={{ gridTemplateColumns: grid }}
        >
          {columns.map((c) => (
            <span key={c.id} role="columnheader" className={cn('truncate', (c.align === 'end' || c.numeric) && 'text-right')}>
              {c.header}
            </span>
          ))}
        </div>
      </div>
      <div role="rowgroup" className="relative" style={{ height: virtual.getTotalSize() }}>
        {items.map((item) => {
          const row = rows[item.index]
          return (
            <div
              key={rowKey(row)}
              role="row"
              aria-rowindex={item.index + 2}
              data-index={item.index}
              ref={virtual.measureElement}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${item.start - virtual.options.scrollMargin}px)` }}
            >
              {/* Desktop: aligned columns. */}
              <div
                className="relative hidden min-h-11 items-center gap-x-4 border-b border-line px-3 py-2 transition-[background-color] duration-150 ease-out hover:bg-sunken md:grid"
                style={{ gridTemplateColumns: grid }}
              >
                {columns.map((c) => (
                  <div
                    key={c.id}
                    role="cell"
                    className={cn('min-w-0 text-[14px]', (c.align === 'end' || c.numeric) && 'text-right', c.numeric && 'tabular-nums')}
                  >
                    {c.cell(row)}
                  </div>
                ))}
              </div>
              {/* Phones: the title line with its aside, then one line below. */}
              <div className="relative flex flex-col gap-1 border-b border-line px-1 py-3 md:hidden">
                <div className="flex min-w-0 items-baseline gap-3">
                  <div className="flex min-w-0 flex-1 items-baseline gap-2 text-[15px]">
                    {title.map((c) => (
                      <div key={c.id} role="cell" className="min-w-0">
                        {c.cell(row)}
                      </div>
                    ))}
                  </div>
                  {aside.map((c) => (
                    <div key={c.id} role="cell" className={cn('shrink-0 text-[13px]', c.numeric && 'tabular-nums')}>
                      {c.cell(row)}
                    </div>
                  ))}
                </div>
                {below.length > 0 && (
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] text-mute">
                    {below.map((c, i) => (
                      <div key={c.id} role="cell" className={cn('flex min-w-0 items-baseline gap-2', c.numeric && 'tabular-nums', i === 0 && 'min-w-0 flex-1 basis-full')}>
                        {c.cell(row)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {footer}
    </div>
  )
}

type ThreadProps<T> = {
  label: string
  items: T[]
  itemKey: (item: T) => string | number
  /** First line: what it is. */
  title: (item: T) => ReactNode
  /** First line, right end: status or a figure. */
  aside?: (item: T) => ReactNode
  /** Second line: what it says (clamp it in the renderer). */
  body?: (item: T) => ReactNode
  /** Small facts under the body. */
  meta?: (item: T) => ReactNode
  /** Quiet text buttons, always visible. */
  actions?: (item: T) => ReactNode
  estimate?: number
  footer?: ReactNode
  onEndReached?: () => void
  className?: string
}

export function ThreadList<T>({ label, items, itemKey, title, aside, body, meta, actions, estimate = 96, footer, onEndReached, className }: ThreadProps<T>) {
  const { ref, scroller, margin } = useScrollParent<HTMLUListElement>()
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: () => estimate,
    overscan: 6,
    scrollMargin: margin,
    initialRect: { width: 800, height: 800 },
  })
  const virtualItems = virtual.getVirtualItems()
  const last = virtualItems.at(-1)?.index ?? -1
  const endRef = useRef(onEndReached)
  endRef.current = onEndReached
  useLayoutEffect(() => {
    if (last >= items.length - 3 && items.length > 0) endRef.current?.()
  }, [last, items.length])

  return (
    <div className={cn('min-w-0', className)}>
      <ul ref={ref} aria-label={label} className="relative" style={{ height: virtual.getTotalSize() }}>
        {virtualItems.map((v) => {
          const item = items[v.index]
          return (
            <li
              key={itemKey(item)}
              data-index={v.index}
              ref={virtual.measureElement}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${v.start - virtual.options.scrollMargin}px)` }}
            >
              <article className="relative flex flex-col gap-1.5 border-b border-line px-1 py-3.5 md:px-3">
                <div className="flex min-w-0 items-baseline gap-3">
                  <div className="min-w-0 flex-1 text-[15px] font-medium">{title(item)}</div>
                  {aside && <div className="shrink-0">{aside(item)}</div>}
                </div>
                {body && <div className="min-w-0 text-[14px] text-mute">{body(item)}</div>}
                {meta && <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[12.5px] text-faint">{meta(item)}</div>}
                {actions && <div className="relative z-[1] -mx-2 mt-0.5 flex flex-wrap items-center gap-1">{actions(item)}</div>}
              </article>
            </li>
          )
        })}
      </ul>
      {footer}
    </div>
  )
}

type QuietActionProps = {
  children: ReactNode
  onClick: () => void
  pending?: boolean
  tone?: 'default' | 'danger'
  disabled?: boolean
  'aria-label'?: string
}

/** A row action: quiet text, always visible, 44px tall on touch. */
export function QuietAction({ children, onClick, pending = false, tone = 'default', disabled, ...rest }: QuietActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      aria-label={rest['aria-label']}
      className={cn(
        'relative z-[1] inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] disabled:opacity-50 pointer-coarse:h-11 [&_svg]:size-3.5',
        tone === 'danger' ? 'text-destructive hover:bg-destructive-soft' : 'text-mute hover:bg-sunken hover:text-ink',
      )}
    >
      {pending && <LoaderIcon aria-hidden className="motion-safe:animate-spin" />}
      {children}
    </button>
  )
}
