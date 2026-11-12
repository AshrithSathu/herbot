// Connectors (docs/design/DECISIONS.md, "Connectors": List). A plain
// reference page: the MCP servers your agents can reach (from Codex's and
// Herbot's configuration), then Herbot's own 13 tools and who may use them.
// Read-only: both come from config files, so they change there.
import { queryOptions, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { getConnectors } from '../../api'
import { InPlaceEmpty, InPlaceError, ListSkeleton, StaleNote } from '@/components/hb/feedback'
import { LedgerTable, type Column } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { UserText } from '@/components/user-text'

const connectorsQuery = queryOptions({ queryKey: ['connectors'], queryFn: () => getConnectors(), staleTime: 60_000 })

export const Route = createFileRoute('/_authed/connectors')({
  // Warm the cache so the page paints filled; a failure is shown in the page.
  loader: ({ context }) => context.queryClient.prefetchQuery(connectorsQuery),
  staticData: { crumb: 'Connectors', shell: 'page' },
  head: () => ({ meta: [{ title: 'Connectors · Herbot admin' }] }),
  component: ConnectorsPage,
})

type Server = { name: string; source: string; command: string | null; url: string | null }
type Tool = { name: string; scope: string }

/** One line on what each herbot-mcp tool does (its tool docs in herbot-mcp). */
const TOOL_DOES: Record<string, string> = {
  list_topics: 'Lists the topics it can see',
  search_messages: 'Searches stored history',
  read_topic: 'Reads a topic’s recent messages',
  ask_topic: 'Asks another topic’s agent and waits for the answer',
  post_to_topic: 'Posts a message into another topic',
  remember: 'Saves a shared memory',
  recall: 'Finds shared memories',
  forget: 'Forgets a shared memory',
  schedule_task: 'Schedules a one-off or recurring prompt',
  list_tasks: 'Lists scheduled tasks',
  pause_task: 'Pauses a task',
  resume_task: 'Resumes a paused task',
  cancel_task: 'Cancels a task',
}

/** Where a server runs: a URL is remote; a command runs on this machine. */
function reach(s: Server): { kind: 'Remote' | 'Local'; where: string } {
  if (s.url) return { kind: 'Remote', where: s.url }
  return { kind: 'Local', where: s.command ?? 'Command not shown' }
}

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
  {
    id: 'does',
    header: 'What it does',
    width: 'minmax(10rem,1fr)',
    phone: 'below',
    cell: (t) => <span className="text-mute">{TOOL_DOES[t.name] ?? 'Not described yet'}</span>,
  },
  {
    id: 'scope',
    header: 'Who can use it',
    width: '8.5rem',
    phone: 'aside',
    cell: (t) => <span className={t.scope === 'every topic' ? 'text-mute' : 'text-ink'}>{t.scope === 'every topic' ? 'Every topic' : t.scope}</span>,
  },
]

function ConnectorsPage() {
  const q = useQuery(connectorsQuery)
  return (
    <ShellPage
      wide
      back={<BackToAgents />}
      title="Connectors"
      description="What your agents can reach besides the live web: MCP servers from Codex’s and Herbot’s configuration, and Herbot’s own tools. Read-only here; they change in the config files."
    >
      {q.isPending ? (
        <ListSkeleton rows={6} lines={1} />
      ) : q.isError && !q.data ? (
        <InPlaceError title="Couldn’t read the connectors" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : (
        <>
          {q.isError && <StaleNote onRetry={() => void q.refetch()} retrying={q.isFetching} />}
          <section aria-labelledby="servers" className="flex flex-col gap-3">
            <h2 id="servers" className="text-[15px] font-semibold">
              MCP servers <span className="font-normal text-faint tabular-nums">{q.data.servers.length}</span>
            </h2>
            {q.data.servers.length === 0 ? (
              <InPlaceEmpty title="No MCP servers configured">
                Add one under <code className="font-mono text-[12.5px]">[mcp_servers]</code> in{' '}
                <code className="font-mono text-[12.5px]">~/.codex/config.toml</code>; every topic’s agent can then use it.
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
              <p className="text-[13.5px] text-mute">
                Built in, through the herbot MCP server. A topic’s agent sees only its own topic; General sees the whole group.
              </p>
            </div>
            <LedgerTable label="Herbot’s tools" rows={q.data.tools} columns={TOOL_COLUMNS} rowKey={(t) => t.name} />
          </section>
        </>
      )}
    </ShellPage>
  )
}
