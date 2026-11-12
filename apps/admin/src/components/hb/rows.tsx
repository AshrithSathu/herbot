// List rows (docs/design/DECISIONS.md, "List rows"):
// - LedgerTable: one line, aligned columns, tabular figures, for lists you
//   scan and compare (topics, logs). On phones each row folds to a title
//   line plus a line underneath.
// - ThreadList: two lines (what it is, then what it says), for lists you
//   read (tasks, memories), with quiet actions that are always visible.
// Both virtualize against the pane that scrolls them ([data-hb-scroll]) and
// carry data-hb-list, so dialogs can move focus to the next row after a
// confirmed delete removes the one that opened them (dialogs.tsx).
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { ChevronDownIcon, LoaderIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Put on a row's main link to make the whole row clickable while other
 * controls in the row stay reachable (they sit above it). */
export const STRETCH = "after:absolute after:inset-0 after:content-['']"

/**
 * Finds the element that scrolls a list (the shell's pane, or the page) and
 * where the list starts inside it. Re-measures after every render and when
 * the scroller's content resizes, so content above the list growing (a
 * second list, a banner, a loaded header) doesn't misplace its rows.
 */
export function useScrollParent<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [margin, setMargin] = useState(0)
  const measure = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const parent = (el.parentElement?.closest('[data-hb-scroll]') as HTMLElement | null) ?? document.scrollingElement
    if (!(parent instanceof HTMLElement)) return
    setScroller(parent)
    measure.current = () => {
      const page = parent === document.scrollingElement
      const top = page
        ? el.getBoundingClientRect().top + window.scrollY
        : el.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop
      // A hidden pane (phones) measures 0: keep the last real value.
      if (el.offsetParent === null && !page) return
      setMargin((m) => (Math.abs(m - top) < 0.5 ? m : top))
    }
    measure.current()
    const ro = new ResizeObserver(() => measure.current())
    ro.observe(parent)
    if (parent.firstElementChild) ro.observe(parent.firstElementChild)
    return () => ro.disconnect()
  }, [])
  // Cheap, and catches content above the list changing without a resize.
  useLayoutEffect(() => measure.current())

  return { ref, scroller, margin }
}

/**
 * The virtualizer's row measurement, ignoring 0: a row in a hidden pane
 * (phones show one pane at a time) measures nothing, and caching that
 * makes the list jump when the pane appears.
 */
export function measureNonZero<S extends Element | Window, I extends Element>(el: I, _entry: ResizeObserverEntry | undefined, instance: Virtualizer<S, I>): number {
  const height = el.getBoundingClientRect().height
  if (height > 0) return height
  const index = Number(el.getAttribute("data-index"))
  return instance.options.estimateSize(Number.isFinite(index) ? index : 0)
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
  /** Keeps its width when space is short (a checkbox beside a long name). */
  noShrink?: boolean
}

type LedgerProps<T> = {
  label: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  /** The row that's open elsewhere (a detail pane): a subtle selected state. */
  selectedKey?: string | number | null
  /** Vertical alignment of cells: centred (default) or top (multi-line cells). */
  align?: 'center' | 'top'
  /** Content under a row, for rows that expand in place; null when closed. */
  expanded?: (row: T) => ReactNode | null
  /** Estimated row height on desktop, for the virtualizer. */
  estimate?: number
  /** Renders after the last row (a "loading older" line, a sentinel). */
  footer?: ReactNode
  /** Called when the last rows come into view (for infinite loading). */
  onEndReached?: () => void
  className?: string
}

export function LedgerTable<T>({ label, rows, columns, rowKey, selectedKey, align = 'center', expanded, estimate = 44, footer, onEndReached, className }: LedgerProps<T>) {
  const { ref, scroller, margin } = useScrollParent<HTMLDivElement>()
  const grid = columns.map((c) => c.width).join(' ')
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => estimate,
    measureElement: measureNonZero,
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
  const itemsAlign = align === 'top' ? 'items-start' : 'items-center'

  return (
    <div ref={ref} role="table" data-hb-list aria-label={label} aria-rowcount={rows.length + 1} className={cn('min-w-0', className)}>
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
          const key = rowKey(row)
          const selected = selectedKey != null && key === selectedKey
          const more = expanded?.(row) ?? null
          return (
            <div
              key={key}
              role="row"
              aria-rowindex={item.index + 2}
              aria-selected={selectedKey !== undefined ? selected : undefined}
              aria-expanded={expanded ? more !== null : undefined}
              data-index={item.index}
              ref={virtual.measureElement}
              className={cn('absolute inset-x-0 top-0 border-b border-line', selected && 'bg-sunken shadow-[inset_3px_0_0_var(--ink)]')}
              style={{ transform: `translateY(${item.start - virtual.options.scrollMargin}px)` }}
            >
              {/* Desktop: aligned columns. */}
              <div
                className={cn(
                  'relative hidden min-h-11 gap-x-4 px-3 py-2 transition-[background-color] duration-150 ease-out md:grid',
                  itemsAlign,
                  !selected && 'hover:bg-sunken',
                )}
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
              {/* Phones: the title line with its aside, then the cells below
                  sharing lines as space allows. */}
              <div className="relative flex flex-col gap-1 px-1 py-3 md:hidden">
                <div className={cn('flex min-w-0 gap-3', align === 'top' ? 'items-start' : 'items-baseline')}>
                  <div className={cn('flex min-w-0 flex-1 gap-2 text-[15px]', align === 'top' ? 'items-start' : 'items-baseline')}>
                    {title.map((c) => (
                      <div key={c.id} role="cell" className={c.noShrink ? 'shrink-0' : 'min-w-0'}>
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
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-mute">
                    {below.map((c) => (
                      <div key={c.id} role="cell" className={cn('flex items-baseline gap-2', c.noShrink ? 'shrink-0' : 'min-w-0 max-w-full', c.numeric && 'tabular-nums')}>
                        {c.cell(row)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {more !== null && <div className="relative px-1 pb-4 md:px-3">{more}</div>}
            </div>
          )
        })}
      </div>
      {footer}
    </div>
  )
}

/** A row's expand toggle for LedgerTable's `expanded` rows. */
export function ExpandToggle({ open, onToggle, label, className }: { open: boolean; onToggle: () => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      className={cn('relative z-[1] grid size-8 place-items-center rounded-md text-mute hover:bg-sunken hover:text-ink pointer-coarse:size-11', className)}
    >
      <ChevronDownIcon aria-hidden className={cn('size-4 transition-transform duration-150 ease-out motion-reduce:transition-none', open && 'rotate-180')} />
    </button>
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
  /** Small facts under the body (use <MetaLine> from status.tsx). */
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
    measureElement: measureNonZero,
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
      <ul ref={ref} data-hb-list aria-label={label} className="relative" style={{ height: virtual.getTotalSize() }}>
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
                {meta && <div className="min-w-0 text-[12.5px] text-faint">{meta(item)}</div>}
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

type QuietActionProps = Omit<ComponentProps<'button'>, 'type'> & {
  pending?: boolean
  tone?: 'default' | 'danger'
}

/** A row action: quiet text, always visible, 44px tall on touch. Other
 * button attributes (aria-expanded, aria-controls, className) pass through. */
export function QuietAction({ children, pending = false, tone = 'default', disabled, className, ...rest }: QuietActionProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        'relative z-[1] inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] disabled:opacity-50 pointer-coarse:h-11 [&_svg]:size-3.5',
        tone === 'danger' ? 'text-destructive hover:bg-destructive-soft' : 'text-mute hover:bg-sunken hover:text-ink',
        className,
      )}
    >
      {pending && <LoaderIcon aria-hidden className="motion-safe:animate-spin" />}
      {children}
    </button>
  )
}
