// The agents pane: a filter and every agent as a Brief row, virtualized so
// hundreds of topics render only the rows in view.
import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SearchIcon, XIcon } from 'lucide-react'
import type { Topic } from '../../api'
import { cn } from '@/lib/utils'
import { AGENT_ROW_CSS, AgentRow } from './agent-row'
import { Button } from './controls'
import { ListSkeleton } from './feedback'

/** Case- and accent-insensitive: "cafe" finds "Café". */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

type AgentListProps = {
  topics: Topic[] | undefined
  pending?: boolean
  error?: Error | null
  onRetry?: () => void
  activeId?: number
  isUnread?: (topic: Topic) => boolean
  isWorking?: (topic: Topic) => boolean
  onSelect?: (id: number) => void
  /** The pane's own header row (title, ⌘K hint, New agent). */
  header?: ReactNode
  className?: string
}

export function AgentList({ topics, pending = false, error, onRetry, activeId, isUnread, isWorking, onSelect, header, className }: AgentListProps) {
  const all = topics ?? []
  const [q, setQ] = useState('')
  const deferred = useDeferredValue(q)
  const shown = useMemo(() => {
    const wanted = fold(deferred.trim())
    return wanted ? all.filter((t) => fold(t.name).includes(wanted)) : all
  }, [all, deferred])
  const input = useRef<HTMLInputElement>(null)

  const scroller = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 58,
    overscan: 8,
    initialRect: { width: 304, height: 700 },
  })

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <style>{AGENT_ROW_CSS}</style>
      {header}
      <div className="px-3 pb-3">
        <div className="relative">
          <label htmlFor="hb-agent-filter" className="sr-only">
            Filter agents
          </label>
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            ref={input}
            id="hb-agent-filter"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            placeholder={all.length > 0 ? `Filter ${all.length.toLocaleString('en-GB')} agents` : 'Filter agents'}
            autoComplete="off"
            spellCheck={false}
            className="h-10 w-full rounded-lg bg-sunken pr-10 pl-9 text-base text-ink outline-none placeholder:text-faint focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] md:text-[14px] [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ('')
                input.current?.focus()
              }}
              aria-label="Clear filter"
              className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-faint hover:text-ink pointer-coarse:size-11"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {pending ? (
        <ListSkeleton rows={9} className="px-3" />
      ) : error ? (
        <div className="flex flex-col items-start gap-2 px-4 py-3 text-[13px]">
          <p className="text-destructive">Couldn’t load agents. {error.message}</p>
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
        <div ref={scroller} className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line">
          <ul aria-label="Agents" className="relative w-full" style={{ height: virtual.getTotalSize() }}>
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
                  />
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
