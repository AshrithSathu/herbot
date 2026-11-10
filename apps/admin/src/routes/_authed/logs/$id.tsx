import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { exact, when } from '../../../format'
import { errorQuery, topicsQuery } from '../../../queries'
import { CopyButton, Section, Time } from '../../../ui'
import { UserText } from '@/components/user-text'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_authed/logs/$id')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(errorQuery(params.id)),
  staticData: {
    crumbParent: { label: 'Logs', to: '/logs' },
    crumb: (data) => (data as { error_id?: string } | undefined)?.error_id,
  },
  head: ({ params }) => ({ meta: [{ title: `${params.id} · Herbot admin` }] }),
  component: ErrorPage,
})

/** A message longer than this is cut on screen; Copy still takes all of it. */
const SHOWN_MESSAGE = 20_000

function ErrorPage() {
  const { id } = Route.useParams()
  const { data: e } = useSuspenseQuery(errorQuery(id))
  const topics = useQuery(topicsQuery)
  const context = JSON.stringify(e.context, null, 2)
  const conversationId = typeof e.context.conversation_id === 'number' ? e.context.conversation_id : null
  const topic = conversationId == null ? null : topics.data?.find((t) => t.id === conversationId)
  const message = e.message.length > SHOWN_MESSAGE ? `${e.message.slice(0, SHOWN_MESSAGE)}\n…` : e.message

  return (
    <>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="font-mono text-2xl leading-tight font-semibold tracking-tight tabular-nums">{e.error_id}</h1>
          <nav aria-label="Other errors" className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild className="min-h-11 text-muted-foreground md:min-h-9">
              <Link to="/logs">
                <ArrowLeftIcon aria-hidden />
                All logs
              </Link>
            </Button>
            <Neighbour id={e.id - 1} label="Older error" />
            <Neighbour id={e.id + 1} label="Newer error" newer />
          </nav>
        </div>
        <dl className="grid max-w-full grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Kind</dt>
          <dd className="min-w-0 font-mono">
            <UserText lines="all" fallback="unknown kind">
              {e.kind}
            </UserText>
          </dd>
          <dt className="text-muted-foreground">When</dt>
          <dd className="tabular-nums">
            <time dateTime={e.created_at} suppressHydrationWarning>
              {when(e.created_at)}
            </time>{' '}
            <span className="text-muted-foreground">
              (<Time iso={e.created_at} relative />)
            </span>
          </dd>
          {conversationId != null && (
            <>
              <dt className="text-muted-foreground">Topic</dt>
              <dd className="min-w-0">
                {topic ? (
                  <Link to="/topics/$id" params={{ id: topic.id }} className="inline-flex max-w-full">
                    <UserText>{topic.name}</UserText>
                  </Link>
                ) : (
                  <span className="text-muted-foreground tabular-nums">#{exact(conversationId)} (no longer exists)</span>
                )}
              </dd>
            </>
          )}
        </dl>
      </header>

      <Section id="message" title="Message" action={<CopyButton text={e.message} label="Copy message" />}>
        <pre
          tabIndex={0}
          aria-label="Error message"
          dir="auto"
          className="scroller max-h-[32rem] overflow-auto rounded-xl border bg-card px-4 py-3.5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap shadow-xs wrap-anywhere"
        >
          {message.trim() || '(no message)'}
        </pre>
      </Section>

      <Section id="context" title="Context" action={<CopyButton text={context} label="Copy JSON" />}>
        {context === '{}' ? (
          <p className="text-sm text-muted-foreground">Nothing else was recorded with this error.</p>
        ) : (
          <pre
            tabIndex={0}
            aria-label="Error context as JSON"
            className="scroller max-h-[32rem] overflow-auto rounded-xl border bg-muted/40 px-4 py-3.5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap wrap-anywhere"
          >
            {context}
          </pre>
        )}
        <p className="text-sm text-muted-foreground">
          The herbot-core logs have the full trace: search them for{' '}
          <span className="font-mono text-foreground">{e.error_id}</span>.
        </p>
      </Section>
    </>
  )
}

/** Step to the error recorded just before or after this one (ids are
 * consecutive; a missing one, if any, shows the page's not-found state). */
function Neighbour({ id, label, newer = false }: { id: number; label: string; newer?: boolean }) {
  if (id < 1) return null
  const Icon = newer ? ChevronRightIcon : ChevronLeftIcon
  return (
    <Button variant="ghost" size="icon" asChild className="size-11 text-muted-foreground md:size-9">
      <Link to="/logs/$id" params={{ id: `E-${id}` }} aria-label={label} title={label}>
        <Icon aria-hidden />
      </Link>
    </Button>
  )
}
