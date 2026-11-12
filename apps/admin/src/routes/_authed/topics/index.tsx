// Topics (docs/design/DECISIONS.md, "Topics"): managing every agent. The
// agents pane is for picking one; this page is for managing them: filter,
// state and sort (all in the URL), a select column with a bulk bar (switch
// on/off with Undo), a per-row switch, and New agent.
import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { setEnabled, type Topic } from '../../../api'
import { ago, compact, exact } from '../../../format'
import { keys, topicsQuery } from '../../../queries'
import { fold } from '@/components/hb/agent-list'
import { Button, SearchInput, Segmented, type Choice } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton, notify } from '@/components/hb/feedback'
import { LedgerTable, QuietAction, STRETCH, type Column } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { StatusDot, topicTone } from '@/components/hb/status'
import { openNewAgent } from '@/components/new-agent'
import { UserText } from '@/components/user-text'

const STATES = ['all', 'ready', 'setup', 'off'] as const
type StateFilter = (typeof STATES)[number]
const SORT_VALUES = ['made', 'recent', 'busiest'] as const
type SortBy = (typeof SORT_VALUES)[number]

type Search = { q?: string; status?: Exclude<StateFilter, 'all'>; sort?: Exclude<SortBy, 'made'> }

export const Route = createFileRoute('/_authed/topics/')({
  // Filters live in the URL: shareable, and Back restores them.
  validateSearch: (raw: Record<string, unknown>): Search => ({
    q: typeof raw.q === 'string' && raw.q.trim() ? raw.q.slice(0, 200) : undefined,
    status: raw.status === 'ready' || raw.status === 'setup' || raw.status === 'off' ? raw.status : undefined,
    // "active" was this sort's name before the redesign.
    sort: raw.sort === 'recent' || raw.sort === 'active' ? 'recent' : raw.sort === 'busiest' ? 'busiest' : undefined,
  }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(topicsQuery)
  },
  staticData: { crumb: 'Topics', shell: 'page' },
  head: () => ({ meta: [{ title: 'Topics · Herbot admin' }] }),
  component: TopicsPage,
})

function stateOf(t: Topic): Exclude<StateFilter, 'all'> {
  if (!t.enabled) return 'off'
  return t.setup_state === 'ready' ? 'ready' : 'setup'
}

const SORTS: Choice<SortBy>[] = [
  { value: 'made', label: 'Order made', hint: 'General first, then the order you made them' },
  { value: 'recent', label: 'Recently active', hint: 'The agents you talked to last come first' },
  { value: 'busiest', label: 'Most messages', hint: 'The longest histories first' },
]

function stateChoices(all: Topic[]): Choice<StateFilter>[] {
  const n = (s: StateFilter) => exact(s === 'all' ? all.length : all.filter((t) => stateOf(t) === s).length)
  return [
    { value: 'all', label: `All ${n('all')}` },
    { value: 'ready', label: `Ready ${n('ready')}`, hint: 'Switched on and set up: they answer' },
    { value: 'setup', label: `Needs setup ${n('setup')}`, hint: 'Waiting for you to say what they’re for' },
    { value: 'off', label: `Off ${n('off')}`, hint: 'Messages there are ignored until you switch them on' },
  ]
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)

/** True from 75rem: wide enough for every column beside the agents pane. */
/** Whether the table itself is wide enough for the "Active" column: its own
 * width decides, not the window's (the agents and details panes take a
 * varying share of it). */
function useRoomy(): [(el: HTMLDivElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [roomy, setRoomy] = useState(true)
  useEffect(() => {
    if (!el) return
    // 46rem fits name, purpose, messages, active, state and the switch.
    const measure = () => setRoomy(el.clientWidth >= 46 * parseFloat(getComputedStyle(document.documentElement).fontSize))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  return [setEl, roomy]
}

function TopicsPage() {
  const topics = useQuery(topicsQuery)
  const all = topics.data ?? []
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const state: StateFilter = search.status ?? 'all'
  const sort: SortBy = search.sort ?? 'made'

  // Typing stays instant; the URL and the filtering catch up.
  const [text, setText] = useState(search.q ?? '')
  const deferred = useDeferredValue(text)
  // The q this page last wrote; a different q in the URL came from outside
  // (Back, a link), so it replaces what's in the box.
  const wrote = useRef(search.q)
  useEffect(() => {
    if (search.q !== wrote.current) {
      wrote.current = search.q
      setText(search.q ?? '')
    }
  }, [search.q])
  useEffect(() => {
    const q = deferred.trim() || undefined
    if (q !== wrote.current) {
      wrote.current = q
      void navigate({ search: (s) => ({ ...s, q }), replace: true })
    }
  }, [deferred, navigate])

  const shown = useMemo(() => {
    const wanted = fold(deferred.trim())
    const byState = state === 'all' ? all : all.filter((t) => stateOf(t) === state)
    const byText = wanted ? byState.filter((t) => fold(t.name).includes(wanted) || fold(t.purpose ?? '').includes(wanted)) : byState
    if (sort === 'made') return byText
    return [...byText].sort((a, b) => (sort === 'recent' ? time(b.last_activity) - time(a.last_activity) : b.messages - a.messages))
  }, [all, deferred, state, sort])

  const selection = useSelection()
  const bulk = useBulkSwitch()
  const [tableRef, roomy] = useRoomy()
  const shownIds = shown.map((t) => t.id)
  const allShownSelected = shown.length > 0 && shownIds.every(selection.has)
  const filtering = deferred.trim() !== ''

  const columns: Column<Topic>[] = [
    {
      id: 'select',
      header: (
        <Check
          label={allShownSelected ? 'Clear the selection' : `Select all ${exact(shown.length)} shown`}
          checked={allShownSelected}
          onChange={() => selection.setMany(shownIds, !allShownSelected)}
        />
      ),
      width: '2.75rem',
      noShrink: true,
      // Phones: the checkbox moves into the name cell.
      phone: 'hide',
      cell: (t) => <Check label={`Select ${t.name || 'Untitled'}`} checked={selection.has(t.id)} onChange={() => selection.toggle(t.id)} />,
    },
    {
      id: 'name',
      header: 'Name',
      width: 'minmax(7rem,1.2fr)',
      phone: 'title',
      cell: (t) => (
        <span className="flex min-w-0 items-center gap-3">
          <span className="md:hidden">
            <Check label={`Select ${t.name || 'Untitled'}`} checked={selection.has(t.id)} onChange={() => selection.toggle(t.id)} />
          </span>
          <Link to="/topics/$id" params={{ id: t.id }} className={`block min-w-0 font-medium outline-none focus-visible:underline ${STRETCH}`}>
            <UserText>{t.name}</UserText>
          </Link>
        </span>
      ),
    },
    {
      id: 'purpose',
      header: 'Purpose',
      width: 'minmax(0,2fr)',
      phone: 'below',
      cell: (t) => (
        <UserText className="text-mute" fallback="No purpose yet">
          {t.purpose}
        </UserText>
      ),
    },
    {
      id: 'messages',
      header: 'Messages',
      width: '5.5rem',
      numeric: true,
      phone: 'hide',
      cell: (t) => <span title={`${exact(t.messages)} messages`}>{compact(t.messages)}</span>,
    },
    // Beside the agents pane below 75rem, seven columns don't fit: "Active" goes.
    ...(roomy
      ? [
          {
            id: 'active',
            header: 'Active',
            width: '6.5rem',
            phone: 'hide' as const,
            cell: (t: Topic) => (
              <span className="text-mute" suppressHydrationWarning>
                {ago(t.last_activity)}
              </span>
            ),
          },
        ]
      : []),
    { id: 'state', header: 'State', width: '7.5rem', phone: 'aside', cell: (t) => <StatusDot status={topicTone(t)} dense /> },
    {
      id: 'switch',
      header: <span className="sr-only">Switch on or off</span>,
      width: '5.75rem',
      align: 'end',
      phone: 'hide',
      cell: (t) => (
        <QuietAction
          pending={bulk.isPending && bulk.variables?.ids.length === 1 && bulk.variables.ids[0] === t.id}
          onClick={() => bulk.mutate({ ids: [t.id], enabled: !t.enabled })}
          aria-label={`${t.enabled ? 'Switch off' : 'Switch on'} ${t.name || 'Untitled'}`}
        >
          {t.enabled ? 'Switch off' : 'Switch on'}
        </QuietAction>
      ),
    },
  ]

  const setSearch = (patch: Partial<Search>) => void navigate({ search: (s) => ({ ...s, ...patch }), replace: true })

  return (
    <ShellPage
      wide
      title="Topics"
      description="Every agent in the group. Pick one in the agents list to talk to it; manage them here."
      back={<BackToAgents />}
      actions={
        <Button variant="primary" onClick={openNewAgent}>
          <PlusIcon aria-hidden />
          New agent
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <SearchInput
          label="Filter topics by name or purpose"
          placeholder="Filter by name or purpose"
          value={text}
          onValueChange={setText}
          className="max-w-xl"
        />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Segmented
            label="State"
            value={state}
            options={stateChoices(all)}
            onValueChange={(v) => setSearch({ status: v === 'all' ? undefined : v })}
          />
          <Segmented label="Sort" value={sort} options={SORTS} onValueChange={(v) => setSearch({ sort: v === 'made' ? undefined : v })} />
        </div>
      </div>

      {topics.error && !topics.data ? (
        <InPlaceError title="Couldn’t load topics" error={topics.error} retrying={topics.isFetching} onRetry={() => void topics.refetch()} />
      ) : topics.isPending ? (
        <ListSkeleton lines={1} />
      ) : all.length === 0 ? (
        <InPlaceEmpty
          title="No agents yet"
          action={
            <Button variant="primary" onClick={openNewAgent}>
              New agent
            </Button>
          }
        >
          Each agent is a topic in the Herbot group with its own purpose. General appears once the bot sees the group.
        </InPlaceEmpty>
      ) : shown.length === 0 ? (
        <InPlaceEmpty
          title={filtering ? `No topic matches “${deferred.trim()}”` : 'No topics in this state'}
          action={
            <Button
              onClick={() => {
                setText('')
                setSearch({ status: undefined })
              }}
            >
              Show all topics
            </Button>
          }
        >
          Names and purposes are searched, ignoring case and accents.
        </InPlaceEmpty>
      ) : (
        <div ref={tableRef} className="flex min-w-0 flex-col gap-2">
          <p className="text-[13px] text-mute tabular-nums" aria-live="polite">
            {shown.length === all.length ? `${exact(all.length)} topics` : `${exact(shown.length)} of ${exact(all.length)} topics`}
          </p>
          <LedgerTable label="Topics" rows={shown} columns={columns} rowKey={(t) => t.id} />
        </div>
      )}

      <BulkBar selection={selection} bulk={bulk} all={all} />
    </ShellPage>
  )
}

/** A checkbox with a 40px hit area (44px on touch) around a visible 16px box. */
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="relative z-[1] -m-2 grid size-10 shrink-0 cursor-pointer place-items-center pointer-coarse:size-11">
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="size-4 cursor-pointer accent-[var(--accent)]" />
    </label>
  )
}

/** A set of selected topic ids. */
function useSelection() {
  const [ids, setIds] = useState<Set<number>>(() => new Set())
  return {
    ids,
    has: (id: number) => ids.has(id),
    toggle: (id: number) =>
      setIds((s) => {
        const next = new Set(s)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    setMany: (list: number[], on: boolean) =>
      setIds((s) => {
        const next = new Set(s)
        for (const id of list) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      }),
    clear: () => setIds(new Set()),
  }
}

/** Switches topics on or off, six requests at a time. Failures stay on
 * screen with their E-ids; success is a toast with Undo. */
function useBulkSwitch() {
  const client = useQueryClient()
  const [failed, setFailed] = useState<{ id: number; error: string }[]>([])
  const run = async (ids: number[], enabled: boolean) => {
    const errors: { id: number; error: string }[] = []
    for (let i = 0; i < ids.length; i += 6) {
      const batch = ids.slice(i, i + 6)
      const results = await Promise.allSettled(batch.map((id) => setEnabled({ data: { id, enabled } })))
      results.forEach((r, j) => r.status === 'rejected' && errors.push({ id: batch[j], error: (r.reason as Error).message }))
    }
    await client.invalidateQueries({ queryKey: keys.topics })
    return errors
  }
  const mutation = useMutation({
    mutationFn: ({ ids, enabled }: { ids: number[]; enabled: boolean }) => run(ids, enabled),
    onMutate: () => setFailed([]),
    onSuccess: (errors, { ids, enabled }) => {
      setFailed(errors)
      const done = ids.filter((id) => !errors.some((e) => e.id === id))
      if (done.length > 0) {
        const what = `${exact(done.length)} ${done.length === 1 ? 'topic' : 'topics'}`
        notify(`Switched ${enabled ? 'on' : 'off'} ${what}.`, { run: () => mutation.mutate({ ids: done, enabled: !enabled }) })
      }
    },
    onError: (e, { ids }) => setFailed(ids.map((id) => ({ id, error: e.message }))),
  })
  return { ...mutation, failed, dismiss: () => setFailed([]) }
}

/** The selection's actions, and any failures with Try again. */
function BulkBar({ selection, bulk, all }: { selection: ReturnType<typeof useSelection>; bulk: ReturnType<typeof useBulkSwitch>; all: Topic[] }) {
  const ids = [...selection.ids]
  if (ids.length === 0 && bulk.failed.length === 0) return null
  const failedNames = bulk.failed.map((f) => all.find((t) => t.id === f.id)?.name || `Topic ${f.id}`)
  const retryEnabled = !(all.find((t) => t.id === bulk.failed[0]?.id)?.enabled ?? true)
  return (
    <div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 flex flex-col gap-2 rounded-xl bg-pane p-2 shadow-raised">
      {ids.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2 text-[14px] font-medium tabular-nums" aria-live="polite">
            {exact(ids.length)} selected
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              pending={bulk.isPending && bulk.variables?.enabled === true}
              disabled={bulk.isPending}
              onClick={() => bulk.mutate({ ids, enabled: true }, { onSuccess: selection.clear })}
            >
              Switch on
            </Button>
            <Button
              size="sm"
              pending={bulk.isPending && bulk.variables?.enabled === false}
              disabled={bulk.isPending}
              onClick={() => bulk.mutate({ ids, enabled: false }, { onSuccess: selection.clear })}
            >
              Switch off
            </Button>
            <Button size="sm" variant="ghost" onClick={selection.clear}>
              Clear
            </Button>
          </div>
        </div>
      )}
      {bulk.failed.length > 0 && (
        <div role="alert" className="flex flex-col gap-1 rounded-lg bg-destructive-soft px-3 py-2 text-[13px]">
          <p className="font-medium text-destructive">
            {exact(bulk.failed.length)} {bulk.failed.length === 1 ? 'topic' : 'topics'} couldn’t be switched
          </p>
          <UserText lines={2} as="p" className="text-ink/80">
            {`${failedNames.slice(0, 3).join(', ')}${failedNames.length > 3 ? ` and ${failedNames.length - 3} more` : ''}: ${bulk.failed[0].error}`}
          </UserText>
          <div className="flex gap-2">
            <QuietAction onClick={() => bulk.mutate({ ids: bulk.failed.map((f) => f.id), enabled: retryEnabled })}>Try again</QuietAction>
            <QuietAction onClick={bulk.dismiss}>Dismiss</QuietAction>
          </div>
        </div>
      )}
    </div>
  )
}
