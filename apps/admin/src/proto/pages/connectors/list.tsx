// Variant "List" (axis: a plain page of its own). Two ledger tables: the MCP
// servers your agents can reach, then Herbot's own tools and who may use them.
import { LedgerTable, type Column } from '@/components/hb/rows'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { UserText } from '@/components/user-text'
import { Frame } from '../companions/shared'
import { TOOL_DOES, reach, useConnectors, type Server, type Tool } from './shared'

const SERVER_COLUMNS: Column<Server>[] = [
  { id: 'name', header: 'Server', width: 'minmax(8rem,1fr)', phone: 'title', cell: (s) => <UserText className="font-medium">{s.name}</UserText> },
  { id: 'kind', header: 'Runs', width: '5.5rem', phone: 'aside', cell: (s) => <span className="text-mute">{reach(s).kind}</span> },
  {
    id: 'where',
    header: 'Command or address',
    width: 'minmax(10rem,2fr)',
    phone: 'below',
    cell: (s) => <UserText className="font-mono text-[12.5px] text-mute">{reach(s).where}</UserText>,
  },
  { id: 'source', header: 'From', width: '6rem', phone: 'below', cell: (s) => <span className="text-mute">{s.source}</span> },
]

const TOOL_COLUMNS: Column<Tool>[] = [
  { id: 'name', header: 'Tool', width: 'minmax(9rem,12rem)', phone: 'title', cell: (t) => <code className="font-mono text-[13px]">{t.name}</code> },
  { id: 'does', header: 'What it does', width: 'minmax(10rem,1fr)', phone: 'below', cell: (t) => <span className="text-mute">{TOOL_DOES[t.name] ?? '—'}</span> },
  {
    id: 'scope',
    header: 'Who can use it',
    width: '8.5rem',
    phone: 'aside',
    cell: (t) => <span className={t.scope === 'every topic' ? 'text-mute' : 'text-ink'}>{t.scope === 'every topic' ? 'Every topic' : t.scope}</span>,
  },
]

export function List() {
  const q = useConnectors()
  return (
    <Frame>
      <ShellPage
        wide
        back={<BackToAgents />}
        title="Connectors"
        description="What your agents can reach besides the live web: MCP servers from Codex’s and Herbot’s configuration, and Herbot’s own tools."
      >
        {q.isPending ? (
          <ListSkeleton rows={6} lines={1} />
        ) : q.isError ? (
          <InPlaceError title="Couldn’t read the connectors" error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />
        ) : (
          <>
            <section aria-labelledby="servers" className="flex flex-col gap-3">
              <h2 id="servers" className="text-[15px] font-semibold">
                MCP servers <span className="font-normal text-faint tabular-nums">{q.data.servers.length}</span>
              </h2>
              {q.data.servers.length === 0 ? (
                <InPlaceEmpty title="No MCP servers configured">
                  Add one under <code className="font-mono text-[12.5px]">[mcp_servers]</code> in <code className="font-mono text-[12.5px]">~/.codex/config.toml</code>; every topic’s agent can then use it.
                </InPlaceEmpty>
              ) : (
                <LedgerTable label="MCP servers" rows={q.data.servers} columns={SERVER_COLUMNS} rowKey={(s) => `${s.source}:${s.name}`} />
              )}
            </section>
            <section aria-labelledby="tools" className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 id="tools" className="text-[15px] font-semibold">
                  Herbot’s own tools <span className="font-normal text-faint tabular-nums">{q.data.tools.length}</span>
                </h2>
                <p className="text-[13.5px] text-mute">Built in, through the herbot MCP server. An agent sees only its own topic unless it’s General.</p>
              </div>
              <LedgerTable label="Herbot’s tools" rows={q.data.tools} columns={TOOL_COLUMNS} rowKey={(t) => t.name} />
            </section>
          </>
        )}
      </ShellPage>
    </Frame>
  )
}
