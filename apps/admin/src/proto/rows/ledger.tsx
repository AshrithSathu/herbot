// Variant 1 "Ledger" — a column table. Every row is one line in aligned
// columns with tabular figures; actions are always visible as quiet text
// buttons in the last column. Phones fold each row to two lines.
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { compact, exact, topicStatus } from '../../format'
import { Time } from '../../ui'
import {
  Frame, PageTitle, Section, Status, TASK_TONE, VirtualList, describeCron, firstLine, schedule, useLists, useLocalActions,
} from './data'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

// Column templates: fixed numeric columns, flexible text columns.
const TOPIC_COLS = 'md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_72px_88px_150px_112px]'
const ERROR_COLS = 'md:grid-cols-[76px_minmax(0,0.9fr)_minmax(0,2.4fr)_96px_64px]'
const TASK_COLS = 'md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_84px_92px_176px]'

const rowBase =
  'grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 border-b border-[var(--c-line)] px-2 py-2 text-[14px] md:min-h-10 md:py-0'

function Head({ cols, children }: { cols: string; children: ReactNode }) {
  return (
    <div
      role="row"
      className={cn(
        'hidden h-8 items-center gap-x-4 border-b border-[var(--c-line)] px-2 text-[11px] font-medium tracking-[0.06em] text-[var(--c-faint)] uppercase md:grid',
        cols,
      )}
    >
      {children}
    </div>
  )
}

function Quiet({ children, onClick, danger, label }: { children: ReactNode; onClick: () => void; danger?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'relative h-8 rounded-md px-2 text-[13px] text-[var(--c-mute)] transition-[color,background-color] duration-150 ease-out before:absolute before:-inset-y-1.5 active:scale-[0.96] pointer-coarse:h-11',
        '[@media(hover:hover)]:hover:bg-[var(--c-sunken)] [@media(hover:hover)]:hover:text-[var(--c-ink)] focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]/40 focus-visible:outline-none',
        danger && 'text-[var(--c-off)] [@media(hover:hover)]:hover:text-[var(--c-off)]',
      )}
    >
      {children}
    </button>
  )
}

const num = 'text-right tabular-nums'

export function LedgerVariant() {
  const d = useLists()
  const a = useLocalActions()
  return (
    <Frame note={a.note}>
      <PageTitle sub="One line per row in aligned columns. Figures line up; actions sit in the last column, always there.">Lists</PageTitle>
      {d.failed && <p className="mb-6 text-sm text-[var(--c-off)]">Couldn’t load: {d.failed.message}</p>}

      <Section id="l-topics" title="Topics" count={exact(d.topics.length)}>
        <Head cols={TOPIC_COLS}>
          <span>Name</span>
          <span>Purpose</span>
          <span className={num}>Msgs</span>
          <span>Active</span>
          <span>State</span>
          <span className="sr-only">Actions</span>
        </Head>
        <VirtualList
          label="Topics"
          items={d.topics}
          estimate={41}
          getKey={(t) => t.id}
          render={(t) => {
            const off = a.isOff(t)
            const s = off ? { label: 'Off', tone: 'danger' as const } : topicStatus({ ...t, enabled: true })
            return (
              <div className={cn(rowBase, TOPIC_COLS, '[@media(hover:hover)]:hover:bg-[var(--c-sunken)]')}>
                <Link to="/topics/$id" params={{ id: t.id }} className="min-w-0 font-medium outline-none focus-visible:underline">
                  <UserText className={cn(off && 'text-[var(--c-mute)]')}>{t.name}</UserText>
                </Link>
                <UserText className="col-span-2 row-start-2 text-[13px] text-[var(--c-mute)] md:col-span-1 md:row-start-auto" fallback="No purpose">
                  {t.purpose}
                </UserText>
                <span className={cn(num, 'hidden md:block')} title={exact(t.messages)}>{compact(t.messages)}</span>
                <span className="hidden text-[13px] text-[var(--c-mute)] md:block"><Time iso={t.last_activity} relative /></span>
                <Status className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto" label={s.label} tone={s.tone} />
                <span className="col-span-2 -ml-2 flex md:col-span-1 md:ml-0 md:justify-end">
                  <Quiet onClick={() => a.toggleTopic(t)}>{off ? 'Switch on' : 'Switch off'}</Quiet>
                </span>
              </div>
            )
          }}
        />
      </Section>

      <Section id="l-errors" title="Errors" count={`${exact(d.errors.length)}${d.errorsDone ? '' : '+'}`} hint="Older errors load as you scroll">
        <Head cols={ERROR_COLS}>
          <span>ID</span>
          <span>Kind</span>
          <span>Message</span>
          <span>When</span>
          <span className="sr-only">Actions</span>
        </Head>
        <VirtualList
          label="Errors"
          items={d.errors}
          estimate={41}
          getKey={(e) => e.id}
          onEnd={d.moreErrors}
          done={d.errorsDone}
          render={(e) => (
            <div className={cn(rowBase, ERROR_COLS, '[@media(hover:hover)]:hover:bg-[var(--c-sunken)]')}>
              <Link to="/logs/$id" params={{ id: e.error_id }} className="font-mono text-[13px] tabular-nums outline-none focus-visible:underline">
                {e.error_id}
              </Link>
              <UserText className="hidden font-mono text-[12px] text-[var(--c-mute)] md:block">{e.kind}</UserText>
              <UserText className="col-span-2 row-start-2 text-[13px] md:col-span-1 md:row-start-auto">{firstLine(e.message)}</UserText>
              <span className="col-start-2 row-start-1 text-[13px] whitespace-nowrap text-[var(--c-mute)] md:col-start-auto md:row-start-auto"><Time iso={e.created_at} relative /></span>
              <span className="hidden md:flex md:justify-end">
                <Quiet onClick={() => void a.copy(e.error_id)} label={`Copy ${e.error_id}`}>Copy</Quiet>
              </span>
            </div>
          )}
        />
      </Section>

      <Section id="l-tasks" title="Tasks" count={`${exact(d.tasks.length)}${d.tasksDone ? '' : '+'}`}>
        <Head cols={TASK_COLS}>
          <span>Task</span>
          <span>Topic</span>
          <span>Schedule</span>
          <span>Next</span>
          <span>State</span>
          <span className="sr-only">Actions</span>
        </Head>
        <VirtualList
          label="Tasks"
          items={d.tasks}
          estimate={41}
          getKey={(t) => t.id}
          onEnd={d.moreTasks}
          done={d.tasksDone}
          render={(t) => {
            const status = a.taskStatus(t)
            const st = TASK_TONE[status]
            const sch = schedule(t, describeCron)
            const live = status === 'active' || status === 'paused'
            return (
              <div className={cn(rowBase, TASK_COLS, '[@media(hover:hover)]:hover:bg-[var(--c-sunken)]', status === 'cancelled' && 'text-[var(--c-mute)]')}>
                <UserText className="font-medium">{t.title || firstLine(t.prompt)}</UserText>
                <Link to="/topics/$id" params={{ id: t.conversation_id }} className="hidden min-w-0 text-[13px] text-[var(--c-mute)] outline-none hover:text-[var(--c-ink)] focus-visible:underline md:block">
                  <UserText>{d.topicName(t.conversation_id)}</UserText>
                </Link>
                <span className="col-span-2 row-start-2 min-w-0 text-[13px] text-[var(--c-mute)] md:col-span-1 md:row-start-auto" title={sch.raw ?? undefined}>
                  <span className="block truncate">{sch.words}</span>
                </span>
                <span className="hidden text-[13px] tabular-nums text-[var(--c-mute)] md:block">{t.next_run_at && live ? <Time iso={t.next_run_at} relative /> : '—'}</span>
                <Status className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto" label={st.label} tone={st.tone} />
                <span className="col-span-2 -ml-2 flex gap-0.5 md:col-span-1 md:ml-0 md:justify-end">
                  {live && <Quiet onClick={() => a.togglePause(t)}>{status === 'paused' ? 'Resume' : 'Pause'}</Quiet>}
                  {live && <Quiet onClick={() => a.runNow(t)}>Run</Quiet>}
                  {status !== 'cancelled' && (
                    <Quiet danger onClick={() => window.confirm(`Delete task #${t.id}? It stops running and can’t be undone.`) && a.remove(t)}>
                      Delete
                    </Quiet>
                  )}
                </span>
              </div>
            )
          }}
        />
      </Section>
    </Frame>
  )
}
