// Variant 2 "Thread" — two-line list rows, like a mail or messages list:
// the name and its key figure on line one, the content preview on line two.
// Actions stay out of sight until a row is hovered or focused (on touch
// screens they're always shown), and the meta they cover steps aside.
import { Link } from '@tanstack/react-router'
import { CopyIcon, PauseIcon, PlayIcon, PowerIcon, Trash2Icon, ZapIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { compact, exact, topicStatus } from '../../format'
import { Time } from '../../ui'
import {
  Frame, PageTitle, Section, TASK_TONE, TONE, VirtualList, describeCron, firstLine, schedule, useLists, useLocalActions,
} from './data'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

/** Row shell: the dot column, two lines, and a hover/focus action tray. */
function Row({ tone, title, meta, preview, actions, muted }: {
  tone: keyof typeof TONE
  title: ReactNode
  meta: ReactNode
  preview: ReactNode
  actions: ReactNode
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'group relative grid grid-cols-[10px_minmax(0,1fr)] gap-x-3 border-b border-[var(--c-line)] px-3 py-2.5 focus-within:bg-[var(--c-sunken)] [@media(hover:hover)]:hover:bg-[var(--c-sunken)]',
        muted && 'text-[var(--c-mute)]',
      )}
    >
      <span aria-hidden className="mt-[7px] size-2 rounded-full" style={{ background: TONE[tone] }} />
      <div className="flex min-w-0 items-baseline gap-3">
        <div className="min-w-0 flex-1 text-[15px] leading-snug font-medium">{title}</div>
        <div className="shrink-0 text-[13px] text-[var(--c-mute)] tabular-nums transition-opacity duration-150 ease-out [@media(hover:hover)]:group-focus-within:opacity-0 [@media(hover:hover)]:group-hover:opacity-0 pointer-coarse:hidden">
          {meta}
        </div>
      </div>
      <div className="col-start-2 mt-0.5 min-w-0 text-[13px] leading-snug text-[var(--c-mute)]">{preview}</div>
      {/* Desktop: a tray over the meta, shown on hover or keyboard focus.
          Touch: a row of buttons under the preview, always there. */}
      <div
        className={cn(
          'col-start-2 mt-1.5 flex gap-1',
          '[@media(hover:hover)_and_(pointer:fine)]:absolute [@media(hover:hover)_and_(pointer:fine)]:top-1.5 [@media(hover:hover)_and_(pointer:fine)]:right-2 [@media(hover:hover)_and_(pointer:fine)]:mt-0',
          '[@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:transition-opacity [@media(hover:hover)_and_(pointer:fine)]:duration-150 [@media(hover:hover)_and_(pointer:fine)]:ease-out',
          '[@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-focus-within:opacity-100',
        )}
      >
        {actions}
      </div>
    </div>
  )
}

function Act({ label, icon: Icon, onClick, danger }: { label: string; icon: typeof CopyIcon; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-8 place-items-center rounded-md bg-[var(--c-pane)] text-[var(--c-mute)] shadow-[0_0_0_var(--hair)_var(--c-line)] transition-[color,background-color,scale] duration-150 ease-out active:scale-[0.96] pointer-coarse:size-11',
        '[@media(hover:hover)]:hover:text-[var(--c-ink)] focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]/40 focus-visible:outline-none',
        danger && 'text-[var(--c-off)] [@media(hover:hover)]:hover:text-[var(--c-off)]',
      )}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  )
}

export function ThreadVariant() {
  const d = useLists()
  const a = useLocalActions()
  return (
    <Frame note={a.note}>
      <PageTitle sub="Two lines a row: what it is, then what it says. Actions appear when you point at or tab into a row.">Lists</PageTitle>
      {d.failed && <p className="mb-6 text-sm text-[var(--c-off)]">Couldn’t load: {d.failed.message}</p>}

      <Section id="t-topics" title="Topics" count={exact(d.topics.length)}>
        <VirtualList
          label="Topics"
          items={d.topics}
          estimate={64}
          getKey={(t) => t.id}
          className="rounded-xl shadow-[0_0_0_var(--hair)_var(--c-line)]"
          render={(t) => {
            const off = a.isOff(t)
            const s = off ? { label: 'Off', tone: 'danger' as const } : topicStatus({ ...t, enabled: true })
            return (
              <Row
                tone={s.tone}
                muted={off}
                title={
                  <Link to="/topics/$id" params={{ id: t.id }} className="block min-w-0 outline-none focus-visible:underline">
                    <UserText>{t.name}</UserText>
                    <span className="sr-only">, {s.label}</span>
                  </Link>
                }
                meta={<span title={`${exact(t.messages)} messages`}>{compact(t.messages)} · <Time iso={t.last_activity} relative /></span>}
                preview={<UserText fallback="No purpose yet">{t.purpose}</UserText>}
                actions={<Act label={off ? 'Switch on' : 'Switch off'} icon={PowerIcon} onClick={() => a.toggleTopic(t)} />}
              />
            )
          }}
        />
      </Section>

      <Section id="t-errors" title="Errors" count={`${exact(d.errors.length)}${d.errorsDone ? '' : '+'}`} hint="Older errors load as you scroll">
        <VirtualList
          label="Errors"
          items={d.errors}
          estimate={64}
          getKey={(e) => e.id}
          onEnd={d.moreErrors}
          done={d.errorsDone}
          className="rounded-xl shadow-[0_0_0_var(--hair)_var(--c-line)]"
          render={(e) => (
            <Row
              tone="danger"
              title={
                <span className="flex min-w-0 items-baseline gap-2">
                  <Link to="/logs/$id" params={{ id: e.error_id }} className="shrink-0 font-mono text-[13px] tabular-nums outline-none focus-visible:underline">
                    {e.error_id}
                  </Link>
                  <UserText className="min-w-0 font-mono text-[12px] font-normal text-[var(--c-mute)]">{e.kind}</UserText>
                </span>
              }
              meta={<Time iso={e.created_at} relative />}
              preview={<UserText className="text-[var(--c-ink)]/80">{firstLine(e.message)}</UserText>}
              actions={<Act label={`Copy ${e.error_id}`} icon={CopyIcon} onClick={() => void a.copy(e.error_id)} />}
            />
          )}
        />
      </Section>

      <Section id="t-tasks" title="Tasks" count={`${exact(d.tasks.length)}${d.tasksDone ? '' : '+'}`}>
        <VirtualList
          label="Tasks"
          items={d.tasks}
          estimate={64}
          getKey={(t) => t.id}
          onEnd={d.moreTasks}
          done={d.tasksDone}
          className="rounded-xl shadow-[0_0_0_var(--hair)_var(--c-line)]"
          render={(t) => {
            const status = a.taskStatus(t)
            const st = TASK_TONE[status]
            const sch = schedule(t, describeCron)
            const live = status === 'active' || status === 'paused'
            return (
              <Row
                tone={st.tone}
                muted={status === 'cancelled'}
                title={
                  <span className="block min-w-0">
                    <UserText>{t.title || firstLine(t.prompt)}</UserText>
                    <span className="sr-only">, {st.label}</span>
                  </span>
                }
                meta={<>{st.label} · {t.next_run_at && live ? <Time iso={t.next_run_at} relative /> : '—'}</>}
                preview={
                  <span className="flex min-w-0 gap-1.5">
                    <span className="shrink-0" title={sch.raw ?? undefined}>{sch.words}</span>
                    <span aria-hidden>·</span>
                    <Link to="/topics/$id" params={{ id: t.conversation_id }} className="min-w-0 outline-none hover:text-[var(--c-ink)] focus-visible:underline">
                      <UserText>{d.topicName(t.conversation_id)}</UserText>
                    </Link>
                  </span>
                }
                actions={
                  <>
                    {live && <Act label={status === 'paused' ? 'Resume' : 'Pause'} icon={status === 'paused' ? PlayIcon : PauseIcon} onClick={() => a.togglePause(t)} />}
                    {live && <Act label="Run now" icon={ZapIcon} onClick={() => a.runNow(t)} />}
                    {status !== 'cancelled' && (
                      <Act
                        danger
                        label="Delete"
                        icon={Trash2Icon}
                        onClick={() => window.confirm(`Delete task #${t.id}? It stops running and can’t be undone.`) && a.remove(t)}
                      />
                    )}
                  </>
                }
              />
            )
          }}
        />
      </Section>
    </Frame>
  )
}
