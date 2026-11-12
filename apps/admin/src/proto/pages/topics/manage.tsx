// Topics variant 3, "Manage" — axis: no separate page. The agents pane has
// a Manage mode: rows gain a checkbox and an on/off switch, the pane gets a
// state filter and a bulk bar at its foot. The main pane shows the topic
// you last picked (or how to start).
import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { PlusIcon, SearchIcon, XIcon } from 'lucide-react'
import type { Topic } from '../../../api'
import { ago, compact, exact } from '../../../format'
import { topicsQuery } from '../../../queries'
import { AgentList } from '@/components/hb/agent-list'
import { Button, Segmented, TextInput, type Choice } from '@/components/hb/controls'
import { DetailRow, DetailsSection } from '@/components/hb/details-pane'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { BackToAgents, ShellPage, useShell } from '@/components/hb/shell'
import { StatusDot, topicTone } from '@/components/hb/status'
import { Switch } from '@/components/ui/switch'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { Frame, useNewAgent, useWorking } from '../overview/frame'
import { topicGroup } from '../overview/data'
import { BulkBar, Check } from './ledger'
import { useBulkSwitch, useSelection, useTopicFilter, type StateFilter } from './tools'

export function Manage() {
  const [managing, setManaging] = useState(true)
  const [picked, setPicked] = useState<number | null>(null)
  return (
    <Frame agents={<ManagePane managing={managing} onManaging={setManaging} picked={picked} onPick={setPicked} />}>
      <PickedTopic id={picked} managing={managing} />
    </Frame>
  )
}

const SHORT_STATES: Choice<StateFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready', hint: 'Switched on and set up' },
  { value: 'setup', label: 'Setup', hint: 'Waiting for a purpose' },
  { value: 'off', label: 'Off', hint: 'Switched off: messages are ignored' },
]

function ManagePane({ managing, onManaging, picked, onPick }: { managing: boolean; onManaging: (on: boolean) => void; picked: number | null; onPick: (id: number) => void }) {
  const topics = useQuery(topicsQuery)
  const working = useWorking()
  const { showMain } = useShell()
  const newAgent = useNewAgent()
  const header = (
    <div className="flex h-14 shrink-0 items-center gap-2 px-4 pt-[env(safe-area-inset-top)]">
      <span className="font-serif text-[19px] leading-none font-semibold">{managing ? 'Manage' : 'Herbot'}</span>
      {topics.data && <span className="text-[12px] text-faint tabular-nums">{exact(topics.data.length)} agents</span>}
      <div className="ml-auto flex items-center gap-1">
        {managing && (
          <Button size="icon" variant="ghost" aria-label="New agent" onClick={() => { newAgent(); showMain() }}>
            <PlusIcon aria-hidden />
          </Button>
        )}
        <Button size="sm" variant={managing ? 'primary' : 'ghost'} onClick={() => onManaging(!managing)} aria-pressed={managing}>
          {managing ? 'Done' : 'Manage'}
        </Button>
      </div>
    </div>
  )
  if (!managing) {
    return (
      <AgentList
        topics={topics.data}
        pending={topics.isPending}
        error={topics.error}
        onRetry={() => topics.refetch()}
        activeId={picked ?? undefined}
        isUnread={(t) => t.unread > 0}
        isWorking={(t) => working.has(t.id)}
        onSelect={(id) => { onPick(id); showMain() }}
        header={header}
      />
    )
  }
  return <ManageList header={header} picked={picked} onPick={(id) => { onPick(id); showMain() }} />
}

function ManageList({ header, picked, onPick }: { header: React.ReactNode; picked: number | null; onPick: (id: number) => void }) {
  const topics = useQuery(topicsQuery)
  const all = topics.data ?? []
  const [state, setState] = useState<StateFilter>('all')
  const { text, setText, shown } = useTopicFilter(all, state, 'made')
  const selection = useSelection()
  const bulk = useBulkSwitch()
  const scroller = useRef<HTMLDivElement>(null)
  const rows = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => (typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 68 : 58),
    // While the pane is hidden (phones show one pane) rows measure 0 px; keeping
    // those would make the list jump when the pane appears.
    measureElement: (el, _entry, instance) => el.getBoundingClientRect().height || instance.options.estimateSize(0),
    overscan: 8,
    initialRect: { width: 300, height: 700 },
  })
  const shownIds = useMemo(() => shown.map((t) => t.id), [shown])
  const allSelected = shown.length > 0 && shownIds.every(selection.has)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="flex flex-col gap-2 px-3 pb-2">
        <div className="relative">
          <label htmlFor="manage-filter" className="sr-only">
            Filter agents
          </label>
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <TextInput
            id="manage-filter"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setText('')}
            placeholder={`Filter ${exact(all.length)} agents`}
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
        <Segmented label="State" value={state} options={SHORT_STATES} onValueChange={setState} />
        <div className="flex items-center gap-2 text-[12.5px] text-mute">
          <Check label={allSelected ? 'Clear selection' : `Select all ${exact(shown.length)} shown`} checked={allSelected} onChange={() => selection.setMany(shownIds, !allSelected)} />
          <span className="tabular-nums">{selection.ids.size > 0 ? `${exact(selection.ids.size)} selected` : `${exact(shown.length)} shown`}</span>
        </div>
      </div>
      <div ref={scroller} className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line">
        {topics.error ? (
          <div className="p-3">
            <InPlaceError title="Couldn’t load agents" error={topics.error} onRetry={() => topics.refetch()} />
          </div>
        ) : topics.isPending ? (
          <ListSkeleton rows={8} />
        ) : shown.length === 0 ? (
          <div className="p-3">
            <InPlaceEmpty title="No agent matches" action={<Button size="sm" onClick={() => { setText(''); setState('all') }}>Show all</Button>}>
              Names and purposes are searched.
            </InPlaceEmpty>
          </div>
        ) : (
          <ul aria-label="Agents to manage" className="relative w-full" style={{ height: rows.getTotalSize() }}>
            {rows.getVirtualItems().map((row) => {
              const t = shown[row.index]
              return (
                <li key={t.id} data-index={row.index} ref={rows.measureElement} className="absolute inset-x-0 top-0" style={{ transform: `translateY(${row.start}px)` }}>
                  <ManageRow
                    topic={t}
                    selected={selection.has(t.id)}
                    active={picked === t.id}
                    onSelect={() => selection.toggle(t.id)}
                    onPick={() => onPick(t.id)}
                    switching={bulk.isPending && (bulk.variables?.ids.includes(t.id) ?? false)}
                    onSwitch={(on) => bulk.mutate({ ids: [t.id], enabled: on })}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="px-2 pb-2 empty:hidden">
        <BulkBar selection={selection} bulk={bulk} all={all} />
      </div>
    </div>
  )
}

function ManageRow({ topic: t, selected, active, onSelect, onPick, switching, onSwitch }: { topic: Topic; selected: boolean; active: boolean; onSelect: () => void; onPick: () => void; switching: boolean; onSwitch: (on: boolean) => void }) {
  const status = topicTone(t)
  return (
    <div className={cn('relative flex min-h-[58px] items-center gap-2 border-b border-line pr-3 pl-2 pointer-coarse:min-h-[68px]', active ? 'bg-accent-soft' : selected ? 'bg-sunken' : 'hover:bg-sunken')}>
      <Check label={`Select ${t.name || 'Untitled'}`} checked={selected} onChange={onSelect} />
      <button type="button" onClick={onPick} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-2 text-left outline-none after:absolute after:inset-0 focus-visible:underline">
        <UserText className={cn('w-full text-[14px] font-medium', !t.enabled && 'text-mute')}>{t.name}</UserText>
        <span className="flex w-full min-w-0 items-center gap-2 text-[12.5px] text-mute">
          <StatusDot status={status} dense />
          <span aria-hidden>·</span>
          <span className="tabular-nums">{compact(t.messages)}</span>
        </span>
      </button>
      <Switch
        checked={t.enabled}
        disabled={switching}
        onCheckedChange={onSwitch}
        aria-label={`${t.name || 'Untitled'}: ${t.enabled ? 'on' : 'off'}`}
        className="relative z-[1] shrink-0"
      />
    </div>
  )
}

function PickedTopic({ id, managing }: { id: number | null; managing: boolean }) {
  const topics = useQuery(topicsQuery)
  const { showAgents } = useShell()
  const t = id === null ? undefined : topics.data?.find((x) => x.id === id)
  const counts = useMemo(() => {
    const all = topics.data ?? []
    return { ready: all.filter((x) => topicGroup(x) === 'ready').length, setup: all.filter((x) => topicGroup(x) === 'setup').length, off: all.filter((x) => topicGroup(x) === 'off').length }
  }, [topics.data])
  if (!t) {
    return (
      <ShellPage title="Topics" description="Managed from the agents list: press Manage to select several, switch them on or off, or add one." back={<BackToAgents />}>
        <dl className="grid grid-cols-3 gap-4 border-y border-line py-4 text-[14px]">
          {(
            [
              ['Answering', counts.ready, 'ready'],
              ['Need setup', counts.setup, 'setup'],
              ['Off', counts.off, 'off'],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="flex flex-col gap-1">
              <dt className="text-[11px] font-medium tracking-[0.06em] text-mute uppercase">{label}</dt>
              <dd className="font-serif text-[28px] leading-none font-semibold tabular-nums">{exact(n)}</dd>
            </div>
          ))}
        </dl>
        <InPlaceEmpty title={managing ? 'Pick a topic in the list' : 'Press Manage in the agents list'} action={<Button className="md:hidden" onClick={showAgents}>Open the agents list</Button>}>
          {managing ? 'Tick several to switch them together; the switch on each row works on its own.' : 'The list then shows checkboxes, on/off switches and a state filter.'}
        </InPlaceEmpty>
      </ShellPage>
    )
  }
  return (
    <ShellPage title={<UserText>{t.name}</UserText>} description={<StatusDot status={topicTone(t)} />} back={<BackToAgents />} actions={<Button asChild><Link to="/topics/$id" params={{ id: t.id }}>Open chat</Link></Button>}>
      <DetailsSection title="About">
        <DetailRow label="Purpose" block value={<UserText lines={3} as="p" fallback="No purpose yet">{t.purpose}</UserText>} />
        <DetailRow label="Messages" value={<span className="tabular-nums" title={exact(t.messages)}>{compact(t.messages)}</span>} />
        <DetailRow label="Last active" value={<span suppressHydrationWarning>{ago(t.last_activity)}</span>} />
        <DetailRow label="Mode" value={<span className="capitalize">{t.mode}</span>} />
        <DetailRow label="Language" value={<UserText>{t.language}</UserText>} />
        <DetailRow label="Group" value={<UserText className="text-mute">{t.group}</UserText>} />
      </DetailsSection>
    </ShellPage>
  )
}
