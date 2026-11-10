import { queryOptions, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { GlobeIcon, PlugIcon, TerminalIcon } from 'lucide-react'
import { getConnectors } from '../../api'
import { EmptyState, ErrorNote, PageHeader } from '../../ui'
import { UserText } from '@/components/user-text'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const connectorsQuery = queryOptions({ queryKey: ['connectors'], queryFn: () => getConnectors(), staleTime: 60_000 })

export const Route = createFileRoute('/_authed/connectors')({
  // Warm the cache so the page paints filled; a failure is shown in the page.
  loader: ({ context }) => context.queryClient.prefetchQuery(connectorsQuery),
  staticData: { crumb: 'Connectors' },
  head: () => ({ meta: [{ title: 'Connectors · Herbot admin' }] }),
  component: ConnectorsPage,
})

function ConnectorsPage() {
  const query = useQuery(connectorsQuery)
  return (
    <>
      <PageHeader
        title="Connectors"
        description="Tools your agents can call. They come from Codex’s configuration (~/.codex/config.toml), so they’re read-only here."
      />

      {query.isError && (
        <ErrorNote title="Couldn’t read the connectors">
          {query.error.message}{' '}
          <Button variant="link" className="align-baseline" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </ErrorNote>
      )}

      <section aria-labelledby="servers" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="servers" className="text-base font-semibold tracking-tight">
            MCP servers
          </h2>
          {query.data && (
            <span className="text-sm text-muted-foreground tabular-nums">{query.data.servers.length}</span>
          )}
        </div>
        {query.isPending ? (
          <ul className="divide-y rounded-xl border bg-card" aria-busy="true" aria-label="Loading connectors">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 p-4">
                <Skeleton className="size-8 rounded-md" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3.5 w-56" />
                </div>
              </li>
            ))}
          </ul>
        ) : query.data && query.data.servers.length === 0 ? (
          <EmptyState icon={PlugIcon} title="No MCP servers">
            Add one under <code className="font-mono text-[0.9em]">[mcp_servers]</code> in Codex’s config and it shows up
            here for every agent.
          </EmptyState>
        ) : query.data ? (
          <ul className="divide-y rounded-xl border bg-card">
            {query.data.servers.map((s, i, all) => {
              // Where it's configured only says something when they differ.
              const mixedSources = all.some((o) => o.source !== all[0].source)
              const remote = Boolean(s.url)
              const Icon = remote ? GlobeIcon : TerminalIcon
              const target = s.url || s.command
              return (
                <li key={`${s.name}-${i}`} className="flex items-start gap-3 p-4 sm:px-5">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <UserText className="min-w-0 font-medium">{s.name}</UserText>
                      <span className="shrink-0 text-xs text-muted-foreground">{remote ? 'Remote' : 'Local command'}</span>
                    </div>
                    {target ? (
                      <UserText className="font-mono text-xs text-muted-foreground">{target}</UserText>
                    ) : (
                      <span className="text-xs text-muted-foreground">No command or URL in the config</span>
                    )}
                  </div>
                  {mixedSources && <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">from {s.source}</span>}
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      {query.data && (
        <section aria-labelledby="herbot-tools" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="herbot-tools" className="text-base font-semibold tracking-tight">
              Herbot’s own tools
            </h2>
            <p className="text-sm text-muted-foreground">Built in, through the herbot MCP server.</p>
          </div>
          <ul className="grid gap-x-6 gap-y-2 rounded-xl border bg-card p-4 sm:grid-cols-2 sm:px-5">
            {query.data.tools.map((tool) => (
              <li key={tool.name} className="flex min-w-0 items-baseline gap-2">
                <code className="truncate font-mono text-sm">{tool.name}</code>
                {tool.scope !== 'every topic' && (
                  <span className="shrink-0 text-xs text-muted-foreground">{tool.scope}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
