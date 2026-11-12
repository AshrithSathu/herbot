// Topics variant 1, "Ledger" — axis: one table with a toolbar. Filter,
// state and sort above; aligned columns; a select column and a bulk bar
// pinned to the bottom of the pane while anything is selected.
import { useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { PlusIcon, SearchIcon, XIcon } from 'lucide-react'
import type { Topic } from '../../../api'
import { ago, compact, exact } from '../../../format'
import { topicsQuery } from '../../../queries'
import { Button, Segmented, TextInput } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { LedgerTable, QuietAction, STRETCH, type Column } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { StatusDot, topicTone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { Frame, useNewAgent } from '../overview/frame'
import { SORTS, stateChoices, useBulkSwitch, useSelection, useTopicFilter, type SortBy, type StateFilter } from './tools'

/** True from 75rem: wide enough for every column beside the agents pane. */
function useRoomy() {
  return useSyncExternalStore(
    (on) => {
      const mq = matchMedia('(min-width: 75rem)')
      mq.addEventListener('change', on)
      return () => mq.removeEventListener('change', on)
    },
    () => matchMedia('(min-width: 75rem)').matches,
    () => true,
  )
}

export function Ledger() {
  return (
    <Frame>
      <LedgerPage />
    </Frame>
  )
}

function LedgerPage() {
  const topics = useQuery(topicsQuery)
  const all = topics.data ?? []
  const [state, setState] = useState<StateFilter>('all')
  const [sort, setSort] = useState<SortBy>('made')
  const { text, setText, shown, filtering } = useTopicFilter(all, state, sort)
  const selection = useSelection()
  const bulk = useBulkSwitch()
  const newAgent = useNewAgent()
  const roomy = useRoomy()
  const shownIds = shown.map((t) => t.id)
  const allShownSelected = shown.length > 0 && shownIds.every(selection.has)

  const columns: Column<Topic>[] = [
    {
      id: 'select',
      header: (
        <Check
          label={allShownSelected ? 'Clear selection' : `Select all ${exact(shown.length)} shown`}
          checked={allShownSelected}
          onChange={() => selection.setMany(shownIds, !allShownSelected)}
        />
      ),
      width: '2.75rem',
      // Phones: the checkbox sits in the name cell (a separate cell would shrink).
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
          <Link to="/topics/$id" params={{ id: t.id }} className={cn('block min-w-0 font-medium outline-none focus-visible:underline', STRETCH)}>
            <UserText>{t.name}</UserText>
          </Link>
        </span>
      ),
    },
    { id: 'purpose', header: 'Purpose', width: 'minmax(0,2fr)', phone: 'below', cell: (t) => <UserText className="text-mute" fallback="No purpose yet">{t.purpose}</UserText> },
    { id: 'messages', header: 'Messages', width: '5.5rem', numeric: true, phone: 'hide', cell: (t) => <span title={exact(t.messages)}>{compact(t.messages)}</span> },
    // Dropped beside the agents pane below 75rem, where seven columns don't fit.
    ...(roomy ? [{ id: 'active', header: 'Active', width: '6rem', phone: 'hide' as const, cell: (t: Topic) => <span className="text-mute" suppressHydrationWarning>{ago(t.last_activity)}</span> }] : []),
    { id: 'state', header: 'State', width: '7.5rem', phone: 'aside', cell: (t) => <StatusDot status={topicTone(t)} dense /> },
    {
      id: 'switch',
      header: <span className="sr-only">Switch</span>,
      width: '5.5rem',
      align: 'end',
      phone: 'hide',
      cell: (t) => (
        <QuietAction
          pending={bulk.isPending && bulk.variables?.ids.length === 1 && bulk.variables.ids[0] === t.id}
          onClick={() => bulk.mutate({ ids: [t.id], enabled: !t.enabled })}
        >
          {t.enabled ? 'Switch off' : 'Switch on'}
        </QuietAction>
      ),
    },
  ]

  return (
    <ShellPage
      wide
      title="Topics"
      description="Every agent in the group. Pick one in the agents list to talk to it; manage them here."
      back={<BackToAgents />}
      actions={
        <Button variant="primary" onClick={newAgent}>
          <PlusIcon aria-hidden />
          New agent
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="relative max-w-xl">
          <label htmlFor="ledger-filter" className="sr-only">
            Filter topics by name or purpose
          </label>
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <TextInput
            id="ledger-filter"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setText('')}
            placeholder="Filter by name or purpose"
            autoComplete="off"
            spellCheck={false}
            className="pr-10 pl-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {text && (
            <button type="button" aria-label="Clear filter" onClick={() => setText('')} className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-mute hover:text-ink pointer-coarse:size-11">
              <XIcon className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Segmented label="State" value={state} options={stateChoices(all)} onValueChange={setState} />
          <Segmented label="Sort" value={sort} options={SORTS} onValueChange={setSort} />
        </div>
      </div>

      {topics.error ? (
        <InPlaceError title="Couldn’t load topics" error={topics.error} onRetry={() => topics.refetch()} />
      ) : topics.isPending ? (
        <ListSkeleton lines={1} />
      ) : shown.length === 0 ? (
        <InPlaceEmpty
          title={filtering ? `No topic matches “${text.trim()}”` : 'No topics in this state'}
          action={<Button onClick={() => { setText(''); setState('all') }}>Show all topics</Button>}
        >
          Names and purposes are searched, ignoring case and accents.
        </InPlaceEmpty>
      ) : (
        <div className="flex flex-col gap-2">
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

/** A checkbox with a 44px hit area and a visible 16px box. */
export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="relative z-[1] -m-2 grid size-10 shrink-0 cursor-pointer place-items-center pointer-coarse:size-11">
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="size-4 cursor-pointer accent-[var(--accent)]" />
    </label>
  )
}

/** The selection's actions and any failures. Without a selection it only
 * reports failures (variants that act per row or per section). */
export function BulkBar({ selection, bulk, all }: { selection?: ReturnType<typeof useSelection>; bulk: ReturnType<typeof useBulkSwitch>; all: Topic[] }) {
  const ids = selection ? [...selection.ids] : []
  const failedNames = bulk.failed.map((f) => all.find((t) => t.id === f.id)?.name ?? `#${f.id}`)
  if (ids.length === 0 && bulk.failed.length === 0) return null
  return (
    <div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 flex flex-col gap-2 rounded-xl bg-pane p-2 shadow-raised">
      {ids.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2 text-[14px] font-medium tabular-nums" aria-live="polite">
            {exact(ids.length)} selected
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" pending={bulk.isPending && bulk.variables?.enabled === true} disabled={bulk.isPending} onClick={() => bulk.mutate({ ids, enabled: true }, { onSuccess: selection?.clear })}>
              Switch on
            </Button>
            <Button size="sm" pending={bulk.isPending && bulk.variables?.enabled === false} disabled={bulk.isPending} onClick={() => bulk.mutate({ ids, enabled: false }, { onSuccess: selection?.clear })}>
              Switch off
            </Button>
            <Button size="sm" variant="ghost" onClick={() => selection?.clear()}>
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
            <QuietAction onClick={() => bulk.mutate({ ids: bulk.failed.map((f) => f.id), enabled: !(all.find((t) => t.id === bulk.failed[0].id)?.enabled ?? true) })}>Try again</QuietAction>
            <QuietAction onClick={bulk.dismiss}>Dismiss</QuietAction>
          </div>
        </div>
      )}
    </div>
  )
}
