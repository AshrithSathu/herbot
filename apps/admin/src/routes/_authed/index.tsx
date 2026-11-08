import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRightIcon, CircleCheckIcon } from 'lucide-react'
import { plural } from '../../format'
import { overviewQuery } from '../../queries'
import { EmptyState, PageHeader, Section, StaleWarning, Time } from '../../ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
            {o.bot ?? 'Telegram isn’t connected'} · agents run on <span className="font-mono text-[0.93em]">{o.agent}</span>
          </>
        }
      />
      <StaleWarning error={error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Topics answering" value={o.enabled_conversations} of={o.conversations} />
        <Stat label="Active T3 threads" value={o.active_threads} />
        <Stat label="Messages stored" value={o.messages} />
        <Stat label="Errors in the last 24 h" value={o.errors_last_24h} alarm={o.errors_last_24h > 0} />
      </div>

      <Section
        id="last-error"
        title="Last error"
        action={
          <Button variant="ghost" size="sm" className="text-muted-foreground" asChild>
            <Link to="/logs">
              All logs <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        }
      >
        {o.last_error ? (
          <Card className="gap-2 py-5 shadow-xs">
            <CardHeader>
              <CardTitle className="font-mono">
                <Link to="/logs/$id" params={{ id: o.last_error.error_id }}>
                  {o.last_error.error_id}
                </Link>
              </CardTitle>
              <CardDescription className="max-w-[65ch] text-base text-foreground">{o.last_error.message}</CardDescription>
              <CardAction className="flex flex-col items-end gap-1.5">
                <Badge variant="danger">{o.last_error.kind}</Badge>
                <span className="text-xs text-muted-foreground">
                  <Time iso={o.last_error.created_at} relative />
                </span>
              </CardAction>
            </CardHeader>
          </Card>
        ) : (
          <EmptyState icon={CircleCheckIcon} title="No errors recorded">
            When a turn fails, it lands here with its E-number.
          </EmptyState>
        )}
      </Section>
    </>
  )
}

/** shadcn's dashboard stat card: label as description, number as title. */
function Stat({ label, value, of, alarm }: { label: string; value: number; of?: number; alarm?: boolean }) {
  return (
    <Card data-testid="stat" className="gap-1.5 py-5 shadow-xs">
      <CardHeader className="gap-1.5 px-5">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn('text-3xl font-semibold tracking-tight tabular-nums', alarm && 'text-destructive')}>
          {value.toLocaleString('en-GB')}
          {of !== undefined && ' '}
          {of !== undefined && (
            <span className="text-sm font-normal tracking-normal text-muted-foreground">of {plural(of, 'topic')}</span>
          )}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}
