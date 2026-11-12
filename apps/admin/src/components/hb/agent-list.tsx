// The agents pane: a filter and every agent as a Brief row, virtualized so
// hundreds of topics render only the rows in view.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import type { Topic } from '../../api'
import { cn } from '@/lib/utils'
import { AGENT_ROW_CSS, AgentRow } from './agent-row'
import { Button, SearchInput } from './controls'
import { ErrorText, ListSkeleton, StaleNote } from './feedback'
import { measureNonZero } from './rows'

/** Case- and accent-insensitive: "cafe" finds "Café". */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

type AgentListProps = {
  topics: Topic[] | undefined
  pending?: boolean
  /** A failed load or refresh. With agents already loaded, the list stays
   * and a quiet "Couldn't refresh" note shows; the full error is only for
   * when there's nothing to show. */
  error?: Error | null
  onRetry?: () => void
  /** A retry is running (the note says so). */
  retrying?: boolean
  activeId?: number
  isUnread?: (topic: Topic) => boolean
  isWorking?: (topic: Topic) => boolean
  /** On a row click; `event.preventDefault()` keeps you in place. */
  onSelect?: (id: number, event: MouseEvent<HTMLAnchorElement>) => void
  /** The pane's own header row (title, ⌘K hint, New agent). */
  header?: ReactNode
  className?: string
}

export function AgentList({ topics, pending = false, error, onRetry, retrying = false, activeId, isUnread, isWorking, onSelect, header, className }: AgentListProps) {
  const all = topics ?? []
  const [q, setQ] = useState('')
  const deferred = useDeferredValue(q)
  const shown = useMemo(() => {
    const wanted = fold(deferred.trim())
    return wanted ? all.filter((t) => fold(t.name).includes(wanted)) : all
  }, [all, deferred])

  const activeIndex = activeId === undefined ? -1 : shown.findIndex((t) => t.id === activeId)

  // Roving focus: the list is one Tab stop. ↑/↓/Home/End move between rows,
  // Enter opens (it's a link). The row that holds the stop starts as the
  // active topic, and stays mounted even when scrolled out of view, so
  // focus never lands on a row that isn't there.
  const [focusId, setFocusId] = useState<number | null>(null)
  const stopIndex = (() => {
    const i = focusId === null ? -1 : shown.findIndex((t) => t.id === focusId)
    if (i >= 0) return i
    return activeIndex >= 0 ? activeIndex : 0
  })()

  // State, not a ref: the list mounts after the agents load, and revealing the
  // active row has to wait for it.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const virtual = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroller,
    getItemKey: (i) => shown[i].id,
    estimateSize: () => 58,
    measureElement: measureNonZero,
    overscan: 8,
    initialRect: { width: 304, height: 700 },
    rangeExtractor: useCallback(
      (range: Range) => {
        const indexes = defaultRangeExtractor(range)
        return stopIndex >= 0 && stopIndex < range.count && !indexes.includes(stopIndex)
          ? [...indexes, stopIndex].sort((a, b) => a - b)
          : indexes
      },
      [stopIndex],
    ),
  })

  // Opening a topic by link (or from ⌘K, Search, Overview) reveals its row.
  // Only when the active topic changes, never while you scroll the list.
  const revealed = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!scroller || activeId === undefined || activeIndex < 0 || revealed.current === activeId) return
    revealed.current = activeId
    setFocusId(null)
    // Centred, so the row is in view with room around it even when rows
    // measure taller than the estimate.
    virtual.scrollToIndex(activeIndex, { align: 'center' })
  }, [scroller, activeId, activeIndex, virtual])

  // After an arrow key, focus the new row once it's mounted.
  const pendingFocus = useRef<number | null>(null)
  useEffect(() => {
    const id = pendingFocus.current
    if (id === null) return
    const row = scroller?.querySelector<HTMLElement>(`[data-agent-id="${id}"]`)
    if (row) {
      pendingFocus.current = null
      row.focus({ preventScroll: true })
    }
  })

  function onListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || shown.length === 0) return
    const last = shown.length - 1
    const next =
      e.key === 'ArrowDown' ? Math.min(stopIndex + 1, last)
      : e.key === 'ArrowUp' ? Math.max(stopIndex - 1, 0)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null
    if (next === null) return
    e.preventDefault()
    const id = shown[next].id
    setFocusId(id)
    pendingFocus.current = id
    virtual.scrollToIndex(next, { align: 'auto' })
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <style>{AGENT_ROW_CSS}</style>
      {header}
      <div className="px-3 pb-3">
        <SearchInput
          id="hb-agent-filter"
          label="Filter agents"
          value={q}
          onValueChange={setQ}
          placeholder={all.length > 0 ? `Filter ${all.length.toLocaleString('en-GB')} agents` : 'Filter agents'}
        />
      </div>

      {error && topics && (
        <StaleNote onRetry={onRetry} retrying={retrying} className="px-4 pb-2">
          Couldn’t refresh the agents
        </StaleNote>
      )}
      {pending ? (
        <ListSkeleton rows={9} className="px-3" />
      ) : error && !topics ? (
        <div className="flex flex-col items-start gap-2 px-4 py-3 text-[13px]">
          {/* A sentence for people; the server's own words as a quiet detail. */}
          <p className="font-medium text-ink">Couldn’t load the agents.</p>
          <p className="text-mute">
            <ErrorText error={error} lines={2} />
          </p>
          {onRetry && (
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-4 py-3 text-[13px] text-mute">
          <p>{all.length === 0 ? 'No agents yet. Every topic you make in the Herbot group becomes one.' : 'No agent matches that name.'}</p>
          {q && (
            <Button size="sm" onClick={() => setQ('')}>
              Clear filter
            </Button>
          )}
        </div>
      ) : (
        <div ref={setScroller} className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line">
          <ul
            data-hb-list
            aria-label="Agents"
            aria-describedby="hb-agents-keys"
            onKeyDown={onListKeyDown}
            className="relative w-full"
            style={{ height: virtual.getTotalSize() }}
          >
            {virtual.getVirtualItems().map((item) => {
              const t = shown[item.index]
              return (
                <li
                  key={t.id}
                  data-index={item.index}
                  ref={virtual.measureElement}
                  className="absolute inset-x-0 top-0"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <AgentRow
                    topic={t}
                    active={t.id === activeId}
                    unread={t.id !== activeId && (isUnread?.(t) ?? false)}
                    working={isWorking?.(t) ?? false}
                    onSelect={onSelect}
                    tabIndex={item.index === stopIndex ? 0 : -1}
                    onFocus={() => setFocusId(t.id)}
                  />
                </li>
              )
            })}
          </ul>
          <p id="hb-agents-keys" className="sr-only">
            Use the up and down arrow keys to move between agents, and Enter to open one.
          </p>
        </div>
      )}
    </div>
  )
}
