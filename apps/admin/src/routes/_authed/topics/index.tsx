import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { MessagesSquareIcon } from 'lucide-react'
import { compact, exact } from '../../../format'
import { topicsQuery } from '../../../queries'
import { EmptyState, PageHeader, StaleWarning, Time, TopicState } from '../../../ui'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const Route = createFileRoute('/_authed/topics/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(topicsQuery),
  staticData: { crumb: 'Topics' },
  head: () => ({ meta: [{ title: 'Topics · Herbot admin' }] }),
  component: TopicsPage,
})

function TopicsPage() {
  const { data: topics, error } = useSuspenseQuery(topicsQuery)
  return (
    <>
      <PageHeader
        title="Topics"
        description="General first, then each forum topic in the order you made them. Each one is its own agent."
      />
      <StaleWarning error={error} />
      {topics.length === 0 ? (
        <EmptyState icon={MessagesSquareIcon} title="No topics yet">
          Send a message in your Herbot group’s General, or create a topic there. It shows up here as soon as the bot
          sees it.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <Table>
            <TableHeader className="bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">Topic</TableHead>
                <TableHead className="hidden md:table-cell">Purpose</TableHead>
                <TableHead className="text-right">Messages</TableHead>
                <TableHead className="hidden sm:table-cell">Last active</TableHead>
                <TableHead className="pr-4">State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topics.map((t) => (
                <TableRow key={t.id}>
                  <TableHead scope="row" className="max-w-[18rem] min-w-[8rem] pl-4 font-medium whitespace-normal text-foreground">
                    <Link to="/topics/$id" params={{ id: t.id }} className="whitespace-normal wrap-anywhere">
                      {t.place}
                    </Link>
                  </TableHead>
                  <TableCell className="hidden max-w-[44ch] whitespace-normal text-muted-foreground md:table-cell">
                    <span className="line-clamp-2 wrap-anywhere">{t.purpose ?? '—'}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums" title={exact(t.messages)}>
                    {compact(t.messages)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    <Time iso={t.last_activity} relative />
                  </TableCell>
                  <TableCell className="pr-4">
                    <TopicState topic={t} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
