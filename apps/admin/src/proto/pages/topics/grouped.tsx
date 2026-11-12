// Topics variant 2, "Grouped" — axis: sections by state. What needs you
// (setup) first, then what's off, then everything answering. Each section
// has the columns that matter for it and one section-wide action; sections
// collapse. No selection: you act per row or per section.
import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDownIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react'
import type { Topic } from '../../../api'
import { ago, compact, exact } from '../../../format'
import { topicsQuery } from '../../../queries'
import { Button, TextInput } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { LedgerTable, QuietAction, STRETCH, type Column } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { Dot, StatusDot, topicTone, type Tone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { Frame, useNewAgent } from '../overview/frame'
import { topicGroup } from '../overview/data'
import { useBulkSwitch, useTopicFilter } from './tools'
import { BulkBar } from './ledger'

export function Grouped() {
  return (
    <Frame>
      <GroupedPage />
    </Frame>
  )
}

function GroupedPage() {
  const topics = useQuery(topicsQuery)
  const all = topics.data ?? []
  const { text, setText, shown, filtering } = useTopicFilter(all, 'all', 'recent')
  const bulk = useBulkSwitch()
  const newAgent = useNewAgent()
  const setup = shown.filter((t) => topicGroup(t) === 'setup')
  const off = shown.filter((t) => topicGroup(t) === 'off')
  const ready = shown.filter((t) => topicGroup(t) === 'ready')

  const name: Column<Topic> = {
    id: 'name',
    header: 'Name',
    width: 'minmax(9rem,1.2fr)',
    phone: 'title',
    cell: (t) => (
      <Link to="/topics/$id" params={{ id: t.id }} className={cn('block min-w-0 font-medium outline-none focus-visible:underline', STRETCH)}>
        <UserText>{t.name}</UserText>
      </Link>
    ),
  }
  const purpose: Column<Topic> = { id: 'purpose', header: 'Purpose', width: 'minmax(9rem,2fr)', phone: 'below', cell: (t) => <UserText className="text-mute" fallback="No purpose yet">{t.purpose}</UserText> }
  const messages: Column<Topic> = { id: 'messages', header: 'Messages', width: '5.5rem', numeric: true, phone: 'hide', cell: (t) => <span title={exact(t.messages)}>{compact(t.messages)}</span> }
  const active: Column<Topic> = { id: 'active', header: 'Active', width: '6rem', phone: 'aside', cell: (t) => <span className="text-mute" suppressHydrationWarning>{ago(t.last_activity)}</span> }
  const toggle = (label: string): Column<Topic> => ({
    id: 'switch',
    header: <span className="sr-only">Switch</span>,
    width: '6rem',
    align: 'end',
    phone: 'below',
    cell: (t) => (
      <QuietAction pending={bulk.isPending && bulk.variables?.ids.length === 1 && bulk.variables.ids[0] === t.id} onClick={() => bulk.mutate({ ids: [t.id], enabled: !t.enabled })}>
        {label}
      </QuietAction>
    ),
  })

  return (
    <ShellPage
      wide
      title="Topics"
      description="Grouped by what each one needs from you."
      back={<BackToAgents />}
      actions={
        <Button variant="primary" onClick={newAgent}>
          <PlusIcon aria-hidden />
          New agent
        </Button>
      }
    >
      <div className="relative max-w-xl">
        <label htmlFor="grouped-filter" className="sr-only">
          Filter topics by name or purpose
        </label>
        <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <TextInput
          id="grouped-filter"
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

      {topics.error ? (
        <InPlaceError title="Couldn’t load topics" error={topics.error} onRetry={() => topics.refetch()} />
      ) : topics.isPending ? (
        <ListSkeleton lines={1} />
      ) : shown.length === 0 ? (
        <InPlaceEmpty title={filtering ? `No topic matches “${text.trim()}”` : 'No topics yet'} action={filtering ? <Button onClick={() => setText('')}>Clear filter</Button> : <Button variant="primary" onClick={newAgent}>New agent</Button>}>
          {filtering ? 'Names and purposes are searched, ignoring case and accents.' : 'Each topic in the Herbot group is its own agent.'}
        </InPlaceEmpty>
      ) : (
        <div className="flex flex-col gap-8">
          <Group id="setup" tone="warn" title="Needs setup" note="They answer once you tell them what they’re for." rows={setup}>
            <LedgerTable label="Topics that need setup" rows={setup} rowKey={(t) => t.id} columns={[name, { id: 'state', header: 'State', width: '9.5rem', phone: 'aside', cell: (t) => <StatusDot status={topicTone(t)} dense /> }, messages, { ...active, phone: 'below' }]} />
          </Group>
          <Group
            id="off"
            tone="off"
            title="Switched off"
            note="Messages there are ignored."
            rows={off}
            action={
              <Button size="sm" pending={bulk.isPending && (bulk.variables?.ids.length ?? 0) > 1} disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: off.map((t) => t.id), enabled: true })}>
                Switch all {exact(off.length)} on
              </Button>
            }
          >
            <LedgerTable label="Switched-off topics" rows={off} rowKey={(t) => t.id} columns={[name, purpose, active, toggle('Switch on')]} />
          </Group>
          <Group id="ready" tone="ok" title="Answering" note="Most recently active first." rows={ready} defaultOpen={!filtering ? ready.length <= 60 || setup.length + off.length === 0 : true}>
            <LedgerTable label="Answering topics" rows={ready} rowKey={(t) => t.id} columns={[name, purpose, messages, active, toggle('Switch off')]} />
          </Group>
        </div>
      )}
      <BulkBar bulk={bulk} all={all} />
    </ShellPage>
  )
}

function Group({ id, tone, title, note, rows, action, defaultOpen = true, children }: { id: string; tone: Tone; title: string; note: string; rows: Topic[]; action?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  if (rows.length === 0) return null
  return (
    <section aria-labelledby={`group-${id}`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={`group-${id}`} className="min-w-0">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`group-${id}-rows`}
            onClick={() => setOpen((o) => !o)}
            className="-ml-2 flex min-h-10 items-center gap-2 rounded-md px-2 text-[15px] font-semibold hover:bg-sunken pointer-coarse:min-h-11"
          >
            <ChevronDownIcon aria-hidden className={cn('size-4 text-mute transition-transform duration-150 ease-out', !open && '-rotate-90')} />
            <Dot tone={tone} />
            {title}
            <span className="font-normal text-mute tabular-nums">{exact(rows.length)}</span>
          </button>
        </h2>
        <p className="hidden text-[13px] text-mute sm:block">{note}</p>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div id={`group-${id}-rows`} hidden={!open}>
        {open && children}
      </div>
    </section>
  )
}
