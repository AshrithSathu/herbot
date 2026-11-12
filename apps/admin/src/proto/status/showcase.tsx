// The one screen every status variant renders (throwaway prototype code):
// same contexts, same data; only the "language" passed in differs.
import { Link } from '@tanstack/react-router'
import { HashIcon, MessageCircleIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { exact } from '../../format'
import { Time } from '../../ui'
import { Frame, PageTitle } from '../rows/data'
import {
  ACTIVITY, TASK_STATES, TOPIC_STATES, useActivityCycle, useSample,
  type ActivityKey, type TaskStateKey, type TopicStateKey,
} from './data'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

export type Language = {
  name: string
  blurb: string
  /** `compact`: inside a dense row (the agent list). */
  TopicState: (p: { state: TopicStateKey; compact?: boolean }) => ReactNode
  TaskState: (p: { state: TaskStateKey }) => ReactNode
  Kind: (p: { kind: string }) => ReactNode
  Activity: (p: { state: ActivityKey; compact?: boolean }) => ReactNode
  Unread: (p: { n: number }) => ReactNode
  Figure: (p: { label: string; value: number; of?: number; alarm?: boolean }) => ReactNode
}

function H2({ id, children, note }: { id: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-[15px] font-semibold tracking-tight">{children}</h2>
      {note && <span className="text-xs text-[var(--c-faint)]">{note}</span>}
    </div>
  )
}

const panel = 'rounded-xl bg-[var(--c-pane)] shadow-[0_0_0_var(--hair)_var(--c-line)]'

export function Showcase({ lang }: { lang: Language }) {
  const d = useSample()
  const cycle = useActivityCycle()
  const L = lang
  const header = d.topics[0]
  return (
    <Frame>
      <PageTitle sub={L.blurb}>Status language</PageTitle>
      {d.failed && <p className="mb-6 text-sm text-[var(--c-off)]">Couldn’t load: {d.failed.message}</p>}

      <section aria-labelledby="s-figures" className="mb-10">
        <H2 id="s-figures">Overview figures</H2>
        {d.overview ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-[var(--c-line)] py-5 md:grid-cols-4">
            <L.Figure label="Answering" value={d.overview.answering} of={d.overview.total} />
            <L.Figure label="T3 threads" value={d.overview.threads} />
            <L.Figure label="Messages" value={d.overview.messages} />
            <L.Figure label="Errors · 24 h" value={d.overview.errors} alarm={d.overview.errors > 0} />
          </dl>
        ) : (
          <div className="h-24 animate-pulse rounded-xl bg-[var(--c-sunken)]" />
        )}
      </section>

      <div className="mb-10 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section aria-labelledby="s-agents">
          <H2 id="s-agents" note="unread · activity · state">Agent list</H2>
          <ul className={cn(panel, 'p-1.5')}>
            {d.topics.map((t) => {
              const Icon = t.is_general ? MessageCircleIcon : HashIcon
              return (
                <li key={`${t.id}-${t.state}`}>
                  <Link
                    to="/topics/$id"
                    params={{ id: t.id }}
                    className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]/40 [@media(hover:hover)]:hover:bg-[var(--c-sunken)]"
                  >
                    <Icon className="size-4 shrink-0 text-[var(--c-faint)]" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <UserText className={cn(t.state === 'off' && 'text-[var(--c-mute)]')}>{t.name}</UserText>
                      {t.activity !== 'idle' && <span className="block"><L.Activity state={t.activity} compact /></span>}
                    </span>
                    {t.unread > 0 && <L.Unread n={t.unread} />}
                    <L.TopicState state={t.state} compact />
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>

        <section aria-labelledby="s-header" className="min-w-0">
          <H2 id="s-header" note="live activity cycles every 1.6 s">Topic header</H2>
          {header && (
            <div className={cn(panel, 'mb-8 p-5')}>
              <h3 className="serif text-[26px] leading-[1.15] font-semibold tracking-[-0.01em]">
                <UserText>{header.name}</UserText>
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[var(--c-mute)]">
                <L.TopicState state={header.state} />
                <span aria-hidden>·</span>
                <span className="tabular-nums" title={`${exact(header.messages)} messages`}>{exact(header.messages)} messages</span>
                <span aria-hidden>·</span>
                <span>active <Time iso={header.last_activity} relative /></span>
              </div>
              <div className="mt-5 flex min-h-11 flex-wrap items-center gap-3 border-t border-[var(--c-line)] pt-4">
                <span aria-live="polite" className="min-w-0 flex-1"><L.Activity state={cycle.activity} /></span>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={cycle.toggle}
                    className="h-8 rounded-md bg-[var(--c-sunken)] px-3 text-[13px] font-medium transition-[background-color,scale] duration-150 ease-out active:scale-[0.96] pointer-coarse:h-11 focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]/40 focus-visible:outline-none"
                  >
                    {cycle.running ? 'Stop cycling' : 'Cycle states'}
                  </button>
                  {cycle.order.map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={cycle.activity === k}
                      onClick={() => cycle.set(k)}
                      className="h-8 rounded-md px-2.5 text-[13px] text-[var(--c-mute)] transition-[color,background-color,scale] duration-150 ease-out active:scale-[0.96] aria-pressed:bg-[var(--c-accent-soft)] aria-pressed:text-[var(--c-ink)] pointer-coarse:h-11 focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]/40 focus-visible:outline-none [@media(hover:hover)]:hover:text-[var(--c-ink)]"
                    >
                      {ACTIVITY[k].label.replace('…', '')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <H2 id="s-tasks">Tasks</H2>
          <ul className={cn(panel, 'mb-8 divide-y divide-[var(--c-line)]')}>
            {d.tasks.map((t) => (
              <li key={t.id} className="flex min-h-12 min-w-0 items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <UserText className="text-[14px] font-medium">{t.title || t.prompt}</UserText>
                  <UserText className="text-[13px] text-[var(--c-mute)]">{t.topicName}</UserText>
                </span>
                <L.TaskState state={t.status} />
              </li>
            ))}
          </ul>

          <H2 id="s-errors">Error kinds</H2>
          <ul className={cn(panel, 'divide-y divide-[var(--c-line)]')}>
            {d.errors.map((e) => (
              <li key={e.id} className="flex min-h-12 min-w-0 items-center gap-3 px-4 py-2.5">
                <Link to="/logs/$id" params={{ id: e.error_id }} className="shrink-0 font-mono text-[13px] tabular-nums outline-none focus-visible:underline">
                  {e.error_id}
                </Link>
                <span className="min-w-0 flex-1"><L.Kind kind={e.kind} /></span>
                <span className="shrink-0 text-[13px] text-[var(--c-mute)]"><Time iso={e.created_at} relative /></span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="s-legend">
        <H2 id="s-legend">Every state</H2>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-3">
          <Legend title="Topics">
            {(Object.keys(TOPIC_STATES) as TopicStateKey[]).map((k) => (
              <LegendRow key={k} meaning={TOPIC_STATES[k].meaning}><L.TopicState state={k} /></LegendRow>
            ))}
          </Legend>
          <Legend title="Tasks">
            {(Object.keys(TASK_STATES) as TaskStateKey[]).map((k) => (
              <LegendRow key={k} meaning={TASK_STATES[k].meaning}><L.TaskState state={k} /></LegendRow>
            ))}
          </Legend>
          <Legend title="Activity and unread">
            {(Object.keys(ACTIVITY) as ActivityKey[]).map((k) => (
              <LegendRow key={k} meaning={ACTIVITY[k].meaning}><L.Activity state={k} /></LegendRow>
            ))}
            <LegendRow meaning="Unread replies; over 99 shows 99+."><span className="flex gap-1.5"><L.Unread n={3} /><L.Unread n={128} /></span></LegendRow>
          </Legend>
        </div>
      </section>
    </Frame>
  )
}

function Legend({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-[11px] font-medium tracking-[0.06em] text-[var(--c-faint)] uppercase">{title}</h3>
      <dl className="flex flex-col divide-y divide-[var(--c-line)] border-y border-[var(--c-line)]">{children}</dl>
    </div>
  )
}

function LegendRow({ children, meaning }: { children: ReactNode; meaning: string }) {
  return (
    <div className="flex min-h-11 flex-col justify-center gap-1 py-2">
      <dt className="min-w-0">{children}</dt>
      <dd className="text-[13px] text-[var(--c-mute)] text-pretty">{meaning}</dd>
    </div>
  )
}
