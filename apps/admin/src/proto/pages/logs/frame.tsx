// Prototype frame for the page stage: the real kit shell around a page body,
// covering the old production shell. Throwaway with src/proto.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SearchIcon, XIcon } from 'lucide-react'
import { activityQuery, topicsQuery } from '../../../queries'
import { AgentList } from '@/components/hb/agent-list'
import { notify } from '@/components/hb/feedback'
import { AgentsHeader, Shell } from '@/components/hb/shell'
import { cn } from '@/lib/utils'

export function PageFrame({ children, details }: { children: ReactNode; details?: ReactNode }) {
  const topics = useQuery(topicsQuery)
  const activity = useQuery(activityQuery)
  const working = useMemo(
    () => new Set((activity.data ?? []).filter((a) => a.in_progress).map((a) => a.conversation_id)),
    [activity.data],
  )
  return (
    <div className="fixed inset-0 z-[45]">
      <Shell
        topics={topics.data}
        details={details}
        onSignOut={() => notify('Signing out is off in the prototype.')}
        agents={
          <AgentList
            topics={topics.data}
            pending={topics.isPending}
            error={topics.error}
            onRetry={() => topics.refetch()}
            isUnread={(t) => t.unread > 0}
            isWorking={(t) => working.has(t.id)}
            header={<AgentsHeader count={topics.data?.length} />}
          />
        }
      >
        {children}
      </Shell>
    </div>
  )
}

/** The page's search box: the agents filter's look, at page size. */
export function SearchBox({ id, label, value, onChange, placeholder, autoFocus = false, className, busy = false, onEnter, describedBy }: {
  id: string
  /** Enter in the box (e.g. open the error an E-id names). */
  onEnter?: () => void
  describedBy?: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoFocus?: boolean
  className?: string
  busy?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  // Focus on arrival, except on touch screens (it would pop the keyboard).
  useEffect(() => {
    if (autoFocus && !matchMedia('(pointer: coarse)').matches) input.current?.focus()
  }, [autoFocus])
  return (
    <div className={cn('relative', className)} role="search">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
      <input
        ref={input}
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            onChange('')
          } else if (e.key === 'Enter' && onEnter) {
            e.preventDefault()
            onEnter()
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-busy={busy || undefined}
        aria-describedby={describedBy}
        className="h-11 w-full rounded-lg bg-sunken pr-10 pl-9 text-base text-ink outline-none placeholder:text-faint focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] md:h-10 md:text-[14px] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('')
            input.current?.focus()
          }}
          className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-faint hover:text-ink pointer-coarse:size-11"
        >
          <XIcon className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

/** Debounced text plus a URL param, so the query survives reload. */
export function useUrlQuery(param: string, ms = 300): [string, string, (v: string) => void] {
  // Empty on the server and the first client render (so they match); the
  // URL's value is applied once mounted.
  const [draft, setDraft] = useState('')
  const [settled, setSettled] = useState('')
  useLayoutEffect(() => {
    const v = new URLSearchParams(location.search).get(param) ?? ''
    setDraft(v)
    setSettled(v.trim())
  }, [param])
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  function set(v: string) {
    setDraft(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const next = v.trim()
      setSettled(next)
      const url = new URL(location.href)
      if (next) url.searchParams.set(param, next)
      else url.searchParams.delete(param)
      history.replaceState(history.state, '', url)
    }, ms)
  }
  return [draft, settled, set]
}
