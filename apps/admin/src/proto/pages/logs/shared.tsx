// What every logs variant shares: the paged error list, one error's detail,
// copy buttons. Variants differ only in how list and detail are arranged.
import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, HashIcon, MessageCircleIcon } from 'lucide-react'
import type { ErrorSummary } from '../../../api'
import { ago, exact, when } from '../../../format'
import { errorQuery, errorSearchQuery, topicsQuery } from '../../../queries'
import { Button } from '@/components/hb/controls'
import { InPlaceError } from '@/components/hb/feedback'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

/** "E-3999", "e3999", "3999" → 3999 when the query is just an error id. */
export function errorIdIn(q: string): number | null {
  const m = /^e?-?(\d{1,12})$/i.exec(q.trim())
  return m ? Number(m[1]) : null
}

/** The first line with text in it (panics start with a useful one). */
export function firstLine(message: string): string {
  return message.split('\n').find((l) => l.trim())?.trim() ?? ''
}

/** Newest first, 50 per page; the next page loads as the end comes into view. */
export function useErrorList(q: string) {
  const query = useInfiniteQuery(errorSearchQuery(q))
  const rows = useMemo(() => query.data?.pages.flat() ?? [], [query.data])
  return { query, rows }
}

/** Under a list: loading older, every error shown, or a retry. */
export function ListFooter({ query, count, noun }: {
  query: ReturnType<typeof useErrorList>['query']
  count: number
  noun: string
}) {
  if (query.isFetchNextPageError)
    return (
      <div className="flex items-center gap-3 px-3 py-4 text-[13px] text-destructive">
        Couldn’t load older {noun}.
        <Button size="sm" onClick={() => query.fetchNextPage()}>
          Try again
        </Button>
      </div>
    )
  if (query.hasNextPage)
    return (
      <div className="flex items-center gap-3 px-3 py-4 text-[13px] text-mute">
        {query.isFetchingNextPage ? `Loading older ${noun}…` : `${exact(count)} loaded`}
        {!query.isFetchingNextPage && (
          <Button size="sm" variant="ghost" onClick={() => query.fetchNextPage()}>
            Load older
          </Button>
        )}
      </div>
    )
  return <p className="px-3 py-4 text-[13px] text-faint">That’s every {noun.replace(/s$/, '')}: {exact(count)}.</p>
}

export function Kind({ kind, className }: { kind: string; className?: string }) {
  return <UserText className={cn('font-mono text-[12.5px] text-mute', className)}>{kind}</UserText>
}

export function When({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} title={when(iso)} className={cn('text-[13px] whitespace-nowrap text-mute tabular-nums', className)} suppressHydrationWarning>
      {ago(iso)}
    </time>
  )
}

/** Copies a value; says so for 1.5 s (and to screen readers). */
export function CopyButton({ value, label, children, className }: { value: string; label: string; children?: React.ReactNode; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={children ? undefined : label}
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setState('copied')
          setTimeout(() => setState('idle'), 1500)
        } catch {
          setState('failed')
        }
      }}
    >
      {state === 'copied' ? <CheckIcon aria-hidden className="text-ok" /> : <CopyIcon aria-hidden />}
      {children}
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Couldn’t copy' : ''}
      </span>
    </Button>
  )
}

/** The topic an error's context names, as a link (when it still exists). */
export function RelatedTopic({ context }: { context: Record<string, unknown> }) {
  const topics = useQuery(topicsQuery)
  const id = typeof context.conversation_id === 'number' ? context.conversation_id : null
  if (id === null) return null
  const topic = topics.data?.find((t) => t.id === id)
  if (!topic) return <span className="text-[13px] text-faint">Topic #{id} (gone)</span>
  const Icon = topic.is_general ? MessageCircleIcon : HashIcon
  return (
    <Link to="/topics/$id" params={{ id: topic.id }} className="relative inline-flex max-w-full min-w-0 items-center gap-1.5 text-[13.5px] text-accent-strong before:absolute before:-inset-x-1 before:-inset-y-3 hover:underline">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <UserText className="min-w-0">{topic.name}</UserText>
    </Link>
  )
}

/** Older/newer: looks the neighbour up (preloading it); disabled when there
 * is none. */
export function Neighbours({ id, onGo }: { id: number; onGo: (id: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      <NeighbourButton id={id - 1} label="Older error" icon="older" onGo={onGo} />
      <NeighbourButton id={id + 1} label="Newer error" icon="newer" onGo={onGo} />
    </div>
  )
}

function NeighbourButton({ id, label, icon, onGo }: { id: number; label: string; icon: 'older' | 'newer'; onGo: (id: number) => void }) {
  const n = useQuery({ ...errorQuery(`E-${id}`), enabled: id >= 1, retry: false })
  const none = id < 1 || n.isError
  const Icon = icon === 'older' ? ChevronLeftIcon : ChevronRightIcon
  return (
    <Button size="icon" variant="ghost" aria-label={none ? `${label} (none)` : label} title={label} disabled={none} onClick={() => onGo(id)}>
      <Icon aria-hidden />
    </Button>
  )
}

/** One error in full: header, message, context, related topic. */
export function ErrorDetail({ id, onGo, headerStart, compact = false }: {
  id: number
  onGo: (id: number) => void
  /** Before the E-id (a back button). */
  headerStart?: React.ReactNode
  /** Tighter spacing for a side column. */
  compact?: boolean
}) {
  const detail = useQuery(errorQuery(`E-${id}`))
  if (detail.isPending) return <DetailSkeleton />
  if (detail.isError)
    return <InPlaceError title={`Couldn’t load E-${id}`} error={detail.error} onRetry={() => detail.refetch()} retrying={detail.isRefetching} />
  const e = detail.data
  const json = JSON.stringify(e.context, null, 2)
  const empty = !e.context || Object.keys(e.context).length === 0
  return (
    <article aria-labelledby={`err-${e.id}`} className={cn('flex min-w-0 flex-col', compact ? 'gap-5' : 'gap-7')}>
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {headerStart}
          <h2 id={`err-${e.id}`} className="font-mono text-[15px] font-semibold tracking-tight tabular-nums">
            {e.error_id}
          </h2>
          <CopyButton value={e.error_id} label={`Copy ${e.error_id}`} />
          <span className="flex-1" />
          <Neighbours id={e.id} onGo={onGo} />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Kind kind={e.kind} className="max-w-full" />
          <span className="text-[13px] text-mute tabular-nums">
            {when(e.created_at)} · <When iso={e.created_at} className="text-[13px]" />
          </span>
        </div>
        <RelatedTopic context={e.context as Record<string, unknown>} />
      </header>

      <section aria-labelledby={`msg-${e.id}`} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 id={`msg-${e.id}`} className="text-[12px] font-medium tracking-[0.06em] text-mute uppercase">
            Message
          </h3>
          <CopyButton value={e.message} label="Copy message">
            Copy
          </CopyButton>
        </div>
        <pre dir="auto" className="user-text rounded-lg bg-sunken px-3.5 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)]">
          {e.message}
        </pre>
      </section>

      <section aria-labelledby={`ctx-${e.id}`} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 id={`ctx-${e.id}`} className="text-[12px] font-medium tracking-[0.06em] text-mute uppercase">
            Context
          </h3>
          {!empty && (
            <CopyButton value={json} label="Copy context JSON">
              Copy JSON
            </CopyButton>
          )}
        </div>
        {empty ? (
          <p className="text-[13.5px] text-mute">Nothing else was recorded with this error.</p>
        ) : (
          <pre className="scroller max-h-[28rem] overflow-auto rounded-lg bg-sunken px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] [overflow-wrap:anywhere] whitespace-pre-wrap">
            {json}
          </pre>
        )}
      </section>
    </article>
  )
}

function DetailSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <span className="h-5 w-32 rounded bg-sunken" />
      <span className="h-4 w-56 rounded bg-sunken" />
      <span className="h-40 rounded-lg bg-sunken" />
      <span className="h-28 rounded-lg bg-sunken" />
    </div>
  )
}

export type { ErrorSummary }
