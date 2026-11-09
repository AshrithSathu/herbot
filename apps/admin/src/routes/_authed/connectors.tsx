import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { getConnectors } from '../../api'
import { EmptyState, ErrorNote, PageHeader } from '../../ui'
export const Route = createFileRoute('/_authed/connectors')({
  component: ConnectorsPage,
  staticData: { crumb: 'Connectors' },
})
function ConnectorsPage() {
  const query = useQuery({
    queryKey: ['connectors'],
    queryFn: () => getConnectors(),
  })
  return (
    <>
      <PageHeader
        title="Connectors"
        description="The tools available to your agents through Codex. Configuration is read-only here."
      />
      {query.isError && <ErrorNote title="Couldn’t read connectors">{query.error.message}</ErrorNote>}
      {query.isPending && <p role="status">Reading connectors…</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {query.data?.servers.map((s, i) => (
          <article key={i} className="rounded-xl border bg-card p-5">
            <h2 className="font-medium">{s.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{s.source}</p>
            <p className="mt-3 font-mono text-sm wrap-anywhere">{s.command || s.url || 'Configured server'}</p>
          </article>
        ))}
      </div>
      {query.data && !query.data.servers.length && (
        <EmptyState title="No external connectors">
          Add MCP servers to Codex’s configuration to make them available to your agents.
        </EmptyState>
      )}
      {query.data && (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-medium">Herbot tools</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {query.data.tools.map((tool) => (
              <li key={tool}>{tool}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
