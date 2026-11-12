// Overview (docs/design/DECISIONS.md, "Overview"): four serif figures, then
// "Needs you" naming the first few items of each kind with one action each,
// then the last error. Figures are the glance; Needs you is where you act.
import { useMemo, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate, type LinkProps } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { changeTask, setEnabled, type ErrorSummary, type Task, type Topic } from '../../api'
import { ago, exact } from '../../format'
import { errorSearchQuery, keys, overviewQuery, tasksQuery, topicsQuery } from '../../queries'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton, notify } from '@/components/hb/feedback'
import { QuietAction } from '@/components/hb/rows'
import { BackToAgents, ShellPage, useShell } from '@/components/hb/shell'
import { BigNumber, Dot, MetaLine, type Tone } from '@/components/hb/status'
import { openNewAgent } from '@/components/new-agent'
import { UserText } from '@/components/user-text'

export const Route = createFileRoute('/_authed/')({
  loader: ({ context }) => {
    // Warm, don't block: the page shows its own skeleton and errors.
    void context.queryClient.prefetchQuery(overviewQuery)
  },
  staticData: { crumb: 'Overview', shell: 'page' },
  head: () => ({ meta: [{ title: 'Overview · Herbot admin' }] }),
  component: OverviewPage,
})

const DAY = 24 * 60 * 60 * 1000
/** How many items of each kind "Needs you" names before "Show all". */
const NAMED = 3

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)

/** The first line of an error message (panics run to thousands of characters). */
function firstLine(text: string): string {
  return text.split('\n', 1)[0].trim()
}

function OverviewPage() {
  const overview = useQuery(overviewQuery)
  const topics = useQuery(topicsQuery)
  const tasks = useInfiniteQuery(tasksQuery)
  const errors = useInfiniteQuery(errorSearchQuery(''))
  const o = overview.data

  const needs = useMemo(() => {
    const all = topics.data ?? []
    const now = Date.now()
    return {
      byId: new Map(all.map((t) => [t.id, t])),
      unread: all.filter((t) => t.unread > 0).sort((a, b) => time(b.last_activity) - time(a.last_activity)),
      setup: all.filter((t) => t.enabled && t.setup_state !== 'ready'),
      off: all.filter((t) => !t.enabled),
      // Failed on its last run, and not deleted since.
      failed: (tasks.data?.pages ?? []).flat().filter((t) => t.last_error && t.status !== 'cancelled'),
      errors: (errors.data?.pages[0] ?? []).filter((e) => now - time(e.created_at) < DAY),
    }
  }, [topics.data, tasks.data, errors.data])

  const error = overview.error ?? topics.error
  const nothing =
    needs.unread.length + needs.setup.length + needs.off.length + needs.failed.length + (o?.errors_last_24h ?? 0) === 0

  return (
    <ShellPage
      title="Overview"
      back={<BackToAgents />}
      description={
        o ? (
          <>
            {o.bot ? (
              <>
                Telegram connected as <UserText>{`@${o.bot}`}</UserText>
              </>
            ) : (
              'Telegram isn’t connected'
            )}{' '}
            · agents run on <span className="font-mono text-[0.92em]">{o.agent}</span>
          </>
        ) : undefined
      }
      actions={
        <Button variant="primary" onClick={openNewAgent}>
          <PlusIcon aria-hidden />
          New agent
        </Button>
      }
    >
      {error && !o ? (
        <InPlaceError
          title="Couldn’t load the overview"
          error={error}
          retrying={overview.isFetching}
          onRetry={() => {
            void overview.refetch()
            void topics.refetch()
          }}
        />
      ) : !o ? (
        <>
          <div aria-hidden className="grid h-[6.5rem] grid-cols-2 gap-6 border-y border-line md:grid-cols-4" />
          <ListSkeleton rows={4} />
        </>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-line py-5 md:grid-cols-4">
            <FigureLink to="/topics">
              <BigNumber label="Answering" value={o.enabled_conversations} of={o.conversations} />
            </FigureLink>
            <BigNumber label="Threads" value={o.active_threads} />
            <FigureLink to="/search">
              <BigNumber label="Messages" value={o.messages} />
            </FigureLink>
            <FigureLink to="/logs">
              <BigNumber label="Errors · 24 h" value={o.errors_last_24h} alarm={o.errors_last_24h > 0} />
            </FigureLink>
          </dl>

          <section aria-labelledby="needs-you" className="flex flex-col gap-3">
            <h2 id="needs-you" className="text-[15px] font-semibold">
              Needs you
            </h2>
            {topics.isPending ? (
              <ListSkeleton rows={3} />
            ) : nothing ? (
              <InPlaceEmpty title="Nothing needs you">
                Every agent is set up and answering, and nothing failed in the last day.
              </InPlaceEmpty>
            ) : (
              <div className="flex flex-col gap-6">
                <UnreadGroup topics={needs.unread} />
                <SetupGroup topics={needs.setup} />
                <FailedGroup tasks={needs.failed} more={tasks.hasNextPage} topics={needs.byId} />
                <ErrorsGroup errors={needs.errors} total={o.errors_last_24h} />
                <OffGroup topics={needs.off} />
              </div>
            )}
          </section>

          <section aria-labelledby="last-error" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="last-error" className="text-[15px] font-semibold">
                Last error
              </h2>
              <Link to="/logs" className="relative text-[13px] font-medium text-accent-strong before:absolute before:-inset-x-2 before:-inset-y-3 hover:underline">
                All logs
              </Link>
            </div>
            {o.last_error ? (
              <article className="relative flex flex-col gap-1.5 border-y border-line py-3 hover:bg-sunken/60">
                <div className="flex min-w-0 items-baseline gap-3 text-[13px]">
                  <Link
                    to="/logs/$id"
                    params={{ id: o.last_error.error_id }}
                    className="shrink-0 font-mono font-medium tabular-nums outline-none after:absolute after:inset-0 focus-visible:underline"
                  >
                    {o.last_error.error_id}
                  </Link>
                  <UserText className="min-w-0 font-mono text-mute">{o.last_error.kind}</UserText>
                  <span className="ml-auto shrink-0 text-faint" suppressHydrationWarning>
                    {ago(o.last_error.created_at)}
                  </span>
                </div>
                <UserText lines={3} as="p" className="font-mono text-[12.5px] leading-relaxed text-mute">
                  {o.last_error.message}
                </UserText>
              </article>
            ) : (
              <p className="border-y border-line py-3 text-[14px] text-mute">No errors recorded.</p>
            )}
          </section>
        </>
      )}
    </ShellPage>
  )
}

/** A figure that opens the page behind it. */
function FigureLink({ to, children }: { to: LinkProps['to']; children: ReactNode }) {
  return (
    <Link to={to} className="-m-2 block rounded-lg p-2 outline-none hover:bg-sunken/70 focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </Link>
  )
}

/** One kind of thing that needs you: a headline with its count, the first
 * few items named with an action each, then "Show all". Hidden when empty. */
function Group<T>({ tone, title, items, count, more = false, all, itemKey, row }: {
  tone: Tone
  title: (n: string) => string
  items: T[]
  /** The real total when it's known beyond the items (e.g. errors). */
  count?: number
  /** More may exist than were loaded. */
  more?: boolean
  /** Where "Show all" goes; without it the list expands in place. */
  all?: LinkProps
  itemKey: (item: T) => string | number
  row: (item: T) => ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const total = count ?? items.length
  if (total === 0) return null
  const shown = expanded ? items : items.slice(0, NAMED)
  const label = `${exact(total)}${more ? '+' : ''}`
  return (
    <section className="flex flex-col">
      <div className="flex min-h-10 items-center gap-3">
        <Dot tone={tone} />
        <h3 className="min-w-0 flex-1 text-[14px] font-medium">{title(label)}</h3>
        {total > NAMED &&
          (all ? (
            <Link {...all} className="relative shrink-0 text-[13px] font-medium text-accent-strong before:absolute before:-inset-x-2 before:-inset-y-3 hover:underline">
              Show all {label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="relative shrink-0 text-[13px] font-medium text-accent-strong before:absolute before:-inset-x-2 before:-inset-y-3 hover:underline"
            >
              {expanded ? 'Show fewer' : `Show all ${label}`}
            </button>
          ))}
      </div>
      {shown.length > 0 && (
        <ul className="flex flex-col border-t border-line">
          {shown.map((item) => (
            <li key={itemKey(item)} className="flex min-h-14 items-center gap-3 border-b border-line py-2 pl-5">
              {row(item)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** The text side of a needs-you row: what it is, then one quiet line. */
function Item({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="min-w-0 text-[14px]">{title}</div>
      {children && <div className="min-w-0 text-[13px] text-mute">{children}</div>}
    </div>
  )
}

function useOpenTopic() {
  const navigate = useNavigate()
  const { showMain } = useShell()
  return (id: number) => {
    showMain()
    void navigate({ to: '/topics/$id', params: { id } })
  }
}

function UnreadGroup({ topics }: { topics: Topic[] }) {
  const open = useOpenTopic()
  return (
    <Group
      tone="active"
      title={(n) => `${n === '1' ? 'One agent' : `${n} agents`} replied since you last looked`}
      items={topics}
      itemKey={(t) => t.id}
      row={(t) => (
        <>
          <Item title={<UserText className="font-medium">{t.name}</UserText>}>
            <MetaLine>
              {[
                <span key="n" className="font-medium text-accent-strong tabular-nums">
                  {t.unread >= 99 ? '99+' : exact(t.unread)} new
                </span>,
                <span key="a" suppressHydrationWarning>
                  active {ago(t.last_activity)}
                </span>,
              ]}
            </MetaLine>
          </Item>
          <QuietAction onClick={() => open(t.id)} aria-label={`Open ${t.name || 'Untitled'}`}>
            Open
          </QuietAction>
        </>
      )}
    />
  )
}

function SetupGroup({ topics }: { topics: Topic[] }) {
  const open = useOpenTopic()
  return (
    <Group
      tone="warn"
      title={(n) => `${n === '1' ? 'One topic is' : `${n} topics are`} waiting for a purpose`}
      items={topics}
      all={{ to: '/topics', search: { status: 'setup' } as never }}
      itemKey={(t) => t.id}
      row={(t) => (
        <>
          <Item title={<UserText className="font-medium">{t.name}</UserText>}>
            {t.setup_state === 'awaiting_purpose' ? 'Asked what it’s for; your next message there is its purpose.' : 'Not set up yet.'}
          </Item>
          <QuietAction onClick={() => open(t.id)} aria-label={`Set the purpose of ${t.name || 'Untitled'}`}>
            Set its purpose
          </QuietAction>
        </>
      )}
    />
  )
}

function OffGroup({ topics }: { topics: Topic[] }) {
  const client = useQueryClient()
  const [failed, setFailed] = useState<Record<number, string>>({})
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => setEnabled({ data: { id, enabled } }),
    onMutate: ({ id }) => setFailed(({ [id]: _, ...rest }) => rest),
    onSuccess: async (_t, { id, enabled }) => {
      await client.invalidateQueries({ queryKey: keys.topics })
      if (enabled) notify('Switched on. It answers again.', { run: () => toggle.mutate({ id, enabled: false }) })
    },
    onError: (e, { id }) => setFailed((all) => ({ ...all, [id]: e.message })),
  })
  return (
    <Group
      tone="idle"
      title={(n) => `${n === '1' ? 'One topic is' : `${n} topics are`} switched off`}
      items={topics}
      all={{ to: '/topics', search: { status: 'off' } as never }}
      itemKey={(t) => t.id}
      row={(t) => (
        <>
          <Item title={<UserText className="font-medium">{t.name}</UserText>}>
            {failed[t.id] ? (
              <span role="alert" className="text-destructive">
                Couldn’t switch it on. <UserText>{failed[t.id]}</UserText>
              </span>
            ) : (
              'Messages there are ignored until you switch it on.'
            )}
          </Item>
          <QuietAction
            pending={toggle.isPending && toggle.variables?.id === t.id}
            onClick={() => toggle.mutate({ id: t.id, enabled: true })}
            aria-label={`Switch on ${t.name || 'Untitled'}`}
          >
            Switch on
          </QuietAction>
        </>
      )}
    />
  )
}

function FailedGroup({ tasks, more, topics }: { tasks: Task[]; more: boolean; topics: Map<number, Topic> }) {
  const client = useQueryClient()
  const [failed, setFailed] = useState<Record<number, string>>({})
  const run = useMutation({
    mutationFn: (id: number) => changeTask({ data: { id, action: 'run' } }),
    onMutate: (id) => setFailed(({ [id]: _, ...rest }) => rest),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['tasks'] })
      notify('It runs again in a moment; the answer arrives in its topic.')
    },
    onError: (e, id) => setFailed((all) => ({ ...all, [id]: e.message })),
  })
  return (
    <Group
      tone="off"
      title={(n) => `${n === '1' ? 'One task' : `${n} tasks`} failed on the last run`}
      items={tasks}
      more={more}
      all={{ to: '/tasks' }}
      itemKey={(t) => t.id}
      row={(t) => (
        <>
          <Item title={<UserText className="font-medium">{t.title ?? firstLine(t.prompt)}</UserText>}>
            {failed[t.id] ? (
              <span role="alert" className="text-destructive">
                Couldn’t run it again. <UserText>{failed[t.id]}</UserText>
              </span>
            ) : (
              <MetaLine>
                {[
                  <UserText key="topic" className="max-w-[14rem]">
                    {topics.get(t.conversation_id)?.name ?? `Topic ${t.conversation_id}`}
                  </UserText>,
                  <UserText key="err" className="min-w-0 font-mono text-[12.5px]">
                    {firstLine(t.last_error ?? '')}
                  </UserText>,
                ]}
              </MetaLine>
            )}
          </Item>
          <QuietAction pending={run.isPending && run.variables === t.id} onClick={() => run.mutate(t.id)}>
            Run again
          </QuietAction>
        </>
      )}
    />
  )
}

function ErrorsGroup({ errors, total }: { errors: ErrorSummary[]; total: number }) {
  const navigate = useNavigate()
  return (
    <Group
      tone="off"
      title={(n) => `${n === '1' ? 'One error' : `${n} errors`} in the last day`}
      items={errors}
      count={total}
      all={{ to: '/logs' }}
      itemKey={(e) => e.id}
      row={(e) => (
        <>
          <Item
            title={
              <span className="flex min-w-0 items-baseline gap-2 font-mono text-[13px]">
                <span className="shrink-0 font-medium tabular-nums">{e.error_id}</span>
                <UserText className="min-w-0 text-mute">{e.kind}</UserText>
              </span>
            }
          >
            <UserText className="font-mono text-[12.5px]">{firstLine(e.message)}</UserText>
          </Item>
          <QuietAction onClick={() => void navigate({ to: '/logs/$id', params: { id: e.error_id } })} aria-label={`Read ${e.error_id}`}>
            Read it
          </QuietAction>
        </>
      )}
    />
  )
}
