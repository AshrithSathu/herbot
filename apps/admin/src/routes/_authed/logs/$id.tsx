import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { errorQuery } from '../../../queries'
import { CopyButton, PageHeader, Section, Time } from '../../../ui'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/_authed/logs/$id')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(errorQuery(params.id)),
  staticData: {
    crumbParent: { label: 'Logs', to: '/logs' },
    crumb: (data) => (data as { error_id?: string } | undefined)?.error_id,
  },
  head: ({ params }) => ({ meta: [{ title: `${params.id} · Herbot admin` }] }),
  component: ErrorPage,
})

function ErrorPage() {
  const { id } = Route.useParams()
  const { data: e } = useSuspenseQuery(errorQuery(id))
  const context = JSON.stringify(e.context, null, 2)
  return (
    <>
      <PageHeader title={<span className="font-mono">{e.error_id}</span>}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
          <Badge variant="danger">{e.kind}</Badge>
          <Time iso={e.created_at} />
          <span>
            (<Time iso={e.created_at} relative />)
          </span>
          <CopyButton text={e.error_id} label="Copy id" />
        </div>
      </PageHeader>
      <p className="max-w-[65ch] text-base">{e.message}</p>
      <Section id="context" title="Context" action={<CopyButton text={context} label="Copy JSON" />}>
        <pre
          tabIndex={0}
          aria-label="Error context as JSON"
          className="scroller max-h-[28rem] overflow-auto rounded-xl border bg-muted/50 px-4 py-3.5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap"
        >
          {context}
        </pre>
        <p className="text-sm text-muted-foreground">
          Search the herbot-core logs for <span className="font-mono">{e.error_id}</span> to see the full trace.
        </p>
      </Section>
    </>
  )
}
