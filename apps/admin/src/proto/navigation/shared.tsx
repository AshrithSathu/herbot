// Shared parts of the navigation prototype (throwaway): the page list, a real
// Overview body, a plain agents list and the conversation placeholder. The
// variants differ only in how you get between them.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlarmClockIcon,
  BrainIcon,
  LayoutGridIcon,
  LogOutIcon,
  MessagesSquareIcon,
  PlugIcon,
  ScrollTextIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import type { Topic } from '../../api'
import { compact, exact, topicStatus } from '../../format'
import { overviewQuery, topicsQuery } from '../../queries'
import { Time } from '../../ui'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import '@/proto/tokens.css'

export type PageId = 'overview' | 'topics' | 'search' | 'tasks' | 'memory' | 'personalize' | 'companions' | 'connectors' | 'logs'
export type Page = { id: PageId; label: string; icon: LucideIcon; group: 'Workspace' | 'Shared' | 'System'; hint: string }

export const PAGES: Page[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGridIcon, group: 'Workspace', hint: 'Health of every agent at a glance' },
  { id: 'topics', label: 'Topics', icon: MessagesSquareIcon, group: 'Workspace', hint: 'Every agent, filterable, with New agent' },
  { id: 'search', label: 'Search', icon: SearchIcon, group: 'Workspace', hint: 'Every message in every topic' },
  { id: 'tasks', label: 'Tasks', icon: AlarmClockIcon, group: 'Workspace', hint: 'Reminders and recurring prompts' },
  { id: 'memory', label: 'Memory', icon: BrainIcon, group: 'Shared', hint: 'Facts every agent can recall' },
  { id: 'personalize', label: 'Personalize', icon: SlidersHorizontalIcon, group: 'Shared', hint: 'Custom instructions and about you' },
  { id: 'companions', label: 'Companions', icon: SparklesIcon, group: 'Shared', hint: 'Voice chat with a character' },
  { id: 'connectors', label: 'Connectors', icon: PlugIcon, group: 'Shared', hint: 'MCP servers and Herbot’s tools' },
  { id: 'logs', label: 'Logs', icon: ScrollTextIcon, group: 'System', hint: 'Every recorded error, by E-id' },
]
export const SIGN_OUT = { label: 'Sign out', icon: LogOutIcon }

export type View = { kind: 'page'; page: PageId } | { kind: 'agent'; id: number }

export function useNav() {
  const [view, setView] = useState<View>({ kind: 'page', page: 'overview' })
  // Prototype-only: signing out here only says what would happen.
  const [signedOut, setSignedOut] = useState(false)
  return { view, setView, signedOut, signOut: () => setSignedOut(true), undoSignOut: () => setSignedOut(false) }
}
export type Nav = ReturnType<typeof useNav>

export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

const DOT = { success: 'var(--c-ok)', warning: 'var(--c-warn)', danger: 'var(--c-off)', muted: 'var(--c-faint)' } as const

/** The agents list every variant shows (a neutral design: the row itself
 * is decided in /proto/agent-row). */
export function AgentList({ nav, header, onPicked }: { nav: Nav; header?: ReactNode; onPicked?: () => void }) {
  const topics = useQuery(topicsQuery)
  const all = topics.data ?? []
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const w = fold(q.trim())
    return w ? all.filter((t) => fold(t.name).includes(w)) : all
  }, [all, q])
  const scroller = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 40,
    overscan: 6,
    initialRect: { width: 300, height: 600 },
  })
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="px-3 pb-2">
        <div className="relative">
          <label htmlFor="nav-agent-filter" className="sr-only">
            Filter agents
          </label>
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--c-faint)]" />
          <input
            id="nav-agent-filter"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            placeholder={`Filter ${all.length.toLocaleString('en-GB')} agents`}
            autoComplete="off"
            className="h-10 w-full rounded-lg bg-[var(--c-sunken)] pr-10 pl-9 text-base outline-none placeholder:text-[var(--c-faint)] focus-visible:shadow-[0_0_0_2px_var(--c-mute)] md:text-[14px] [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Clear filter" className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-[var(--c-faint)] hover:text-[var(--c-ink)]">
              <XIcon className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </div>
      {topics.isError ? (
        <p className="px-4 text-[13px] text-[var(--c-off)]">Couldn’t load agents. {topics.error.message}</p>
      ) : shown.length === 0 && !topics.isPending ? (
        <p className="px-4 text-[13px] text-[var(--c-mute)]">No agent matches that name.</p>
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
          <ul className="relative" style={{ height: v.getTotalSize() }}>
            {v.getVirtualItems().map((item) => {
              const t = shown[item.index]
              const s = topicStatus(t)
              const on = nav.view.kind === 'agent' && nav.view.id === t.id
              return (
                <li key={t.id} data-index={item.index} ref={v.measureElement} className="absolute inset-x-0 top-0" style={{ transform: `translateY(${item.start}px)` }}>
                  <button
                    type="button"
                    onClick={() => {
                      nav.setView({ kind: 'agent', id: t.id })
                      onPicked?.()
                    }}
                    aria-current={on ? 'true' : undefined}
                    aria-label={`${t.name.trim() || 'Untitled'}, ${s.label}`}
                    className={cn(
                      'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-[background-color] duration-150 ease-out pointer-coarse:h-11',
                      on ? 'bg-[var(--c-accent-soft)]' : 'hover:bg-[var(--c-sunken)]',
                    )}
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ background: DOT[s.tone] }} aria-hidden />
                    <UserText className={cn('min-w-0 flex-1', !t.enabled && 'text-[var(--c-faint)]')}>{t.name}</UserText>
                    <span className="shrink-0 text-[11px] text-[var(--c-faint)] tabular-nums">{compact(t.messages)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The main pane's content for the current view. */
export function Body({ nav, back }: { nav: Nav; back?: ReactNode }) {
  const topics = useQuery(topicsQuery)
  if (nav.view.kind === 'agent') {
    const id = nav.view.id
    const t = (topics.data ?? []).find((x) => x.id === id)
    return <AgentPlaceholder topic={t} back={back} />
  }
  const page = PAGES.find((p) => p.id === (nav.view as { page: PageId }).page) ?? PAGES[0]
  if (page.id === 'overview') return <OverviewBody nav={nav} back={back} />
  return <PagePlaceholder page={page} back={back} />
}

function PaneHeader({ title, back, children }: { title: ReactNode; back?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--c-line)] px-2 md:px-5">
      {back}
      <div className="min-w-0 flex-1 truncate font-semibold">{title}</div>
      {children}
    </header>
  )
}

function OverviewBody({ nav, back }: { nav: Nav; back?: ReactNode }) {
  const overview = useQuery(overviewQuery)
  const topics = useQuery(topicsQuery)
  const all = topics.data ?? []
  const setup = all.filter((t) => t.enabled && t.setup_state !== 'ready').length
  const off = all.filter((t) => !t.enabled).length
  const o = overview.data
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title="Overview" back={back} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <div className="flex flex-col gap-1">
            <h1 className="serif text-[34px] leading-[1.1] font-semibold tracking-[-0.015em] text-balance">Overview</h1>
            <p className="text-[13px] text-[var(--c-mute)]">{o ? `${o.bot ? `@${o.bot}` : 'Telegram not connected'} · agents run on ${o.agent}` : 'Loading…'}</p>
          </div>
          {overview.isError ? (
            <p className="text-[13px] text-[var(--c-off)]">Couldn’t load the overview. {overview.error.message}</p>
          ) : (
            <dl className="grid grid-cols-2 border-y border-[var(--c-line)] sm:grid-cols-4">
              {[
                ['Answering', o ? `${exact(o.enabled_conversations)}` : '—', o ? `of ${exact(o.conversations)}` : '', false],
                ['Threads', o ? exact(o.active_threads) : '—', '', false],
                ['Messages', o ? compact(o.messages) : '—', '', false],
                ['Errors · 24 h', o ? exact(o.errors_last_24h) : '—', '', (o?.errors_last_24h ?? 0) > 0],
              ].map(([label, value, sub, alarm], i) => (
                <div key={label as string} className={cn('flex flex-col gap-1 py-4 pr-3', i % 2 === 1 && 'pl-4 sm:pl-0', i > 0 && 'sm:border-l sm:border-[var(--c-line)] sm:pl-4', i > 1 && 'max-sm:border-t max-sm:border-[var(--c-line)]', i % 2 === 1 && 'max-sm:border-l max-sm:border-[var(--c-line)]')}>
                  <dt className="text-[11px] tracking-[0.06em] text-[var(--c-faint)] uppercase">{label}</dt>
                  <dd className={cn('serif text-[30px] leading-none font-semibold tabular-nums', alarm && 'text-[var(--c-off)]')}>
                    {value}
                    {sub && <span className="ml-1.5 font-sans text-[12px] font-normal text-[var(--c-mute)]">{sub}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <section aria-labelledby="needs" className="flex flex-col gap-2">
            <h2 id="needs" className="text-[13px] font-semibold">
              Needs you
            </h2>
            <ul className="flex flex-col border-t border-[var(--c-line)]">
              {[
                [setup, `${setup} topics are waiting for a purpose`, 'var(--c-warn)'],
                [off, `${off} topics are switched off`, 'var(--c-off)'],
              ]
                .filter(([n]) => (n as number) > 0)
                .map(([, text, color]) => (
                  <li key={text as string}>
                    <button type="button" onClick={() => nav.setView({ kind: 'page', page: 'topics' })} className="flex min-h-11 w-full items-center gap-3 border-b border-[var(--c-line)] py-2 text-left hover:bg-[var(--c-sunken)]">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: color as string }} aria-hidden />
                      <span className="flex-1">{text}</span>
                      <span aria-hidden className="pr-2 text-[var(--c-faint)]">›</span>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
          {o?.last_error && (
            <section aria-labelledby="last-error" className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="last-error" className="text-[13px] font-semibold">
                  Last error
                </h2>
                <button type="button" onClick={() => nav.setView({ kind: 'page', page: 'logs' })} className="relative text-[13px] text-[var(--c-accent)] before:absolute before:-inset-3 hover:underline">
                  All logs
                </button>
              </div>
              <div className="flex flex-col gap-1 border-t border-[var(--c-line)] pt-3">
                <p className="flex items-baseline gap-2 text-[13px]">
                  <span className="font-mono font-medium">E-{o.last_error.id}</span>
                  <span className="truncate text-[var(--c-mute)]">{o.last_error.kind}</span>
                  <span className="ml-auto shrink-0 text-[12px] text-[var(--c-faint)]">
                    <Time iso={o.last_error.created_at} relative />
                  </span>
                </p>
                <UserText lines={2} as="p" className="font-mono text-[12.5px] text-[var(--c-mute)]">
                  {o.last_error.message}
                </UserText>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function PagePlaceholder({ page, back }: { page: Page; back?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title={page.label} back={back} />
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="flex max-w-[44ch] flex-col items-center gap-2">
          <page.icon className="size-6 text-[var(--c-faint)]" aria-hidden />
          <h1 className="serif text-[26px] leading-tight font-semibold">{page.label}</h1>
          <p className="text-[13px] text-[var(--c-mute)]">{page.hint}. This page is prototyped separately; here it shows where navigation lands.</p>
        </div>
      </div>
    </div>
  )
}

function AgentPlaceholder({ topic, back }: { topic?: Topic; back?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title={<UserText>{topic?.name}</UserText>} back={back}>
        {topic && <span className="shrink-0 text-[12px] text-[var(--c-mute)] tabular-nums">{compact(topic.messages)} messages</span>}
      </PaneHeader>
      <div className="grid flex-1 place-items-center p-6 text-center text-[13px] text-[var(--c-faint)]">
        <p className="max-w-[40ch]">The conversation with this agent goes here (prototyped separately).</p>
      </div>
    </div>
  )
}

/** Shown after "Sign out" in the prototype instead of really signing out. */
export function SignedOut({ nav }: { nav: Nav }) {
  if (!nav.signedOut) return null
  return (
    <div role="status" className="fixed inset-x-0 bottom-20 z-50 mx-auto flex w-fit items-center gap-3 rounded-xl bg-[var(--c-ink)] px-4 py-2.5 text-[13px] text-[var(--c-pane)] shadow-[var(--c-raised)]">
      This would sign you out (prototype).
      <button type="button" onClick={nav.undoSignOut} className="font-medium underline underline-offset-2">
        OK
      </button>
    </div>
  )
}

export const FRAME = 'hb fixed inset-0 z-[45] flex text-[14px] leading-normal antialiased'
export const PANE = 'bg-[var(--c-pane)] md:rounded-2xl md:shadow-[var(--c-raised)]'
export const FOCUS_CSS = `.hb :focus-visible { outline: 2px solid var(--c-mute); outline-offset: 2px; }`
