import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, type LinkProps } from '@tanstack/react-router'
import { ArrowRightIcon, ChevronRightIcon, CircleCheckIcon } from 'lucide-react'
import { UserText } from '../../components/user-text'
import { compact, exact, plural } from '../../format'
import { overviewQuery, topicsQuery } from '../../queries'
import { EmptyState, PageHeader, Section, StaleWarning, Time } from '../../ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery),
  staticData: { crumb: 'Overview' },
  component: OverviewPage,
})

function OverviewPage() {
  const { data: o, error } = useSuspenseQuery(overviewQuery)
  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>
            {o.bot ? <>Telegram: <UserText>{o.bot}</UserText></> : 'Telegram isn’t connected'} · agents run on{' '}
            <span className="font-mono text-[0.93em]">{o.agent}</span>
          </>
        }
      />
      <StaleWarning error={error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Topics answering" value={o.enabled_conversations} of={o.conversations} to="/topics" />
        <Stat label="Active T3 threads" value={o.active_threads} />
        <Stat label="Messages stored" value={o.messages} to="/search" />
        <Stat
          label={'Errors in the last 24 h'}
          value={o.errors_last_24h}
          alarm={o.errors_last_24h > 0}
          to="/logs"
        />
      </div>

      <NeedsYou />

      <Section
        id="last-error"
        title="Last error"
        action={
          <Button variant="ghost" size="sm" className="-mr-2 pr-2 text-muted-foreground" asChild>
            <Link to="/logs">
              All logs <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        }
      >
        {o.last_error ? (
          <article className="group relative flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs transition-[background-color] duration-150 ease-out hover:bg-muted/40 sm:p-5">
            <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <Link
                to="/logs/$id"
                params={{ id: o.last_error.error_id }}
                className="font-mono text-sm font-semibold outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
              >
                {o.last_error.error_id}
              </Link>
              <Badge variant="danger" className="max-w-full min-w-0 sm:max-w-[24rem]">
                <UserText>{o.last_error.kind}</UserText>
              </Badge>
              <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
                <Time iso={o.last_error.created_at} relative />
              </span>
            </header>
            <UserText as="p" lines={3} className="max-w-[75ch] font-mono text-[13px] leading-relaxed text-foreground/90">
              {o.last_error.message}
            </UserText>
          </article>
        ) : (
          <EmptyState icon={CircleCheckIcon} title="No errors recorded" className="min-h-40">
            When a turn fails, it shows up here with its E-number.
          </EmptyState>
        )}
      </Section>
    </>
  )
}

/** A number that has to fit a small box: compact on screen, exact on hover. */
function Stat({
  label,
  value,
  of,
  alarm,
  to,
}: {
  label: string
  value: number
  of?: number
  alarm?: boolean
  to?: LinkProps['to']
}) {
  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card px-4 py-4 shadow-xs sm:px-5',
        to && 'transition-[background-color] duration-150 ease-out hover:bg-muted/40',
      )}
    >
      {to ? (
        <Link
          to={to}
          className="text-sm text-muted-foreground outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring/60"
        >
          {label}
        </Link>
      ) : (
        <span className="text-sm text-muted-foreground">{label}</span>
      )}
      <p
        title={exact(value)}
        className={cn('text-2xl leading-none font-semibold tracking-tight tabular-nums sm:text-3xl', alarm && 'text-destructive')}
      >
        {compact(value)}
      </p>
      {of !== undefined && (
        <p className="text-xs text-muted-foreground tabular-nums" title={exact(of)}>
          of {of < 100_000 ? plural(of, 'topic') : `${compact(of)} topics`}
        </p>
      )}
    </div>
  )
}

/** Topics that can't answer until you act. Hidden when there are none. */
function NeedsYou() {
  const { data: topics } = useQuery(topicsQuery)
  if (!topics) return null
  const setup = topics.filter((t) => t.enabled && t.setup_state !== 'ready').length
  const off = topics.filter((t) => !t.enabled).length
  if (setup === 0 && off === 0) return null
  return (
    <Section id="needs-you" title="Needs you">
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
        {setup > 0 && (
          <Attention
            search={{ status: 'setup' }}
            dot="bg-warning"
            text={`${plural(setup, 'topic')} ${setup === 1 ? 'is' : 'are'} waiting for a purpose`}
            hint="They answer once you tell them what they’re for."
          />
        )}
        {off > 0 && (
          <Attention
            search={{ status: 'off' }}
            dot="bg-destructive"
            text={`${plural(off, 'topic')} ${off === 1 ? 'is' : 'are'} switched off`}
            hint="Messages there are ignored until you switch them back on."
          />
        )}
      </ul>
    </Section>
  )
}

function Attention({
  search,
  dot,
  text,
  hint,
}: {
  search: { status: 'setup' | 'off' }
  dot: string
  text: string
  hint: string
}) {
  return (
    <li className="relative flex items-center gap-3 px-4 py-3 transition-[background-color] duration-150 ease-out hover:bg-muted/40 sm:px-5">
      <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          to="/topics"
          search={search}
          className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring/60 focus-visible:after:ring-inset"
        >
          {text}
        </Link>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </div>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </li>
  )
}
