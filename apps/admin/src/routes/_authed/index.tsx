import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { plural } from '../../format'
import { overviewQuery } from '../../queries'
import { Empty, PageHeader, Section, StaleWarning, Time } from '../../ui'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery),
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
            {o.bot ?? 'Telegram isn’t connected'} · agents run on <span className="font-mono text-[0.93em]">{o.agent}</span>
          </>
        }
      />
      <StaleWarning error={error} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Numbers">
        <Stat label="Topics answering" value={o.enabled_conversations} of={o.conversations} />
        <Stat label="Active T3 threads" value={o.active_threads} />
        <Stat label="Messages stored" value={o.messages} />
        <Stat label="Errors in the last 24 h" value={o.errors_last_24h} alarm={o.errors_last_24h > 0} />
      </dl>

      <Section
        id="last-error"
        title="Last error"
        action={
          <Link to="/logs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            All logs <ArrowRightIcon className="size-3.5" aria-hidden />
          </Link>
        }
      >
        {o.last_error ? (
          <Card className="gap-2 px-5 py-4 shadow-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Link to="/logs/$id" params={{ id: o.last_error.error_id }} className="font-mono text-sm font-medium">
                {o.last_error.error_id}
              </Link>
              <Badge variant="danger">{o.last_error.kind}</Badge>
              <span className="text-sm text-muted-foreground">
                <Time iso={o.last_error.created_at} relative />
              </span>
            </div>
            <p className="max-w-[65ch]">{o.last_error.message}</p>
          </Card>
        ) : (
          <Empty>No errors recorded. When a turn fails, it lands here with its E-number.</Empty>
        )}
      </Section>
    </>
  )
}

function Stat({ label, value, of, alarm }: { label: string; value: number; of?: number; alarm?: boolean }) {
  return (
    <Card data-testid="stat" className="flex-col-reverse justify-end gap-1 px-4 py-4 shadow-xs">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn('text-3xl leading-none font-semibold tracking-tight tabular-nums', alarm && 'text-destructive')}>
        {value.toLocaleString('en-GB')}
        {of !== undefined && ' '}
        {of !== undefined && (
          <span className="ml-0.5 text-sm font-normal tracking-normal text-muted-foreground">of {plural(of, 'topic')}</span>
        )}
      </dd>
    </Card>
  )
}
