// Variant 3 "Index cards" — compact cards in a responsive grid (one column
// on phones, up to three on wide panes). Each card shows more of its
// content (three lines); its actions live in one "…" menu per card.
import { Link, useNavigate } from '@tanstack/react-router'
import { MoreHorizontalIcon } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { compact, exact, topicStatus } from '../../format'
import { Time } from '../../ui'
import {
  Frame, PageTitle, Section, Status, TASK_TONE, VirtualList, describeCron, firstLine, schedule, useLists, useLocalActions,
} from './data'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

/** Columns that fit the pane: a card is never narrower than 280px. */
function useColumns() {
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(3)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setCols(Math.max(1, Math.min(3, Math.floor((e.contentRect.width + 12) / 292)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, cols }
}

function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

type MenuItem = { label: string; onSelect: () => void; danger?: boolean } | 'separator'

function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        className="relative -mt-1 -mr-1.5 grid size-8 shrink-0 place-items-center rounded-md text-[var(--c-mute)] transition-[color,background-color] duration-150 ease-out outline-none before:absolute before:-inset-1.5 focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]/40 data-[state=open]:bg-[var(--c-sunken)] data-[state=open]:text-[var(--c-ink)] pointer-coarse:size-11 [@media(hover:hover)]:hover:bg-[var(--c-sunken)] [@media(hover:hover)]:hover:text-[var(--c-ink)]"
      >
        <MoreHorizontalIcon className="size-4" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className="hb z-[60] min-w-44 origin-(--radix-dropdown-menu-content-transform-origin) rounded-lg bg-[var(--c-pane)] p-1 text-[14px] shadow-[var(--c-raised)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:duration-150"
        >
          {items.map((it, i) =>
            it === 'separator' ? (
              <DropdownMenu.Separator key={`s${i}`} className="my-1 h-[var(--hair)] bg-[var(--c-line)]" />
            ) : (
              <DropdownMenu.Item
                key={it.label}
                onSelect={it.onSelect}
                className={cn(
                  'flex h-8 cursor-default items-center rounded-md px-2.5 outline-none select-none data-[highlighted]:bg-[var(--c-sunken)] pointer-coarse:h-11',
                  it.danger && 'text-[var(--c-off)]',
                )}
              >
                {it.label}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function Card({ head, menu, body, foot, muted }: { head: ReactNode; menu: ReactNode; body: ReactNode; foot: ReactNode; muted?: boolean }) {
  return (
    <article
      className={cn(
        'flex h-full min-w-0 flex-col gap-2 rounded-xl bg-[var(--c-pane)] p-3.5 shadow-[0_0_0_var(--hair)_var(--c-line)] focus-within:shadow-[0_0_0_1px_var(--c-accent)]',
        muted && 'text-[var(--c-mute)]',
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1 text-[15px] leading-snug font-medium">{head}</div>
        {menu}
      </div>
      <div className="min-w-0 flex-1 text-[13px] leading-[1.5] text-[var(--c-mute)]">{body}</div>
      <div className="flex min-w-0 items-center justify-between gap-3 border-t border-[var(--c-line)] pt-2 text-[12px] text-[var(--c-mute)] tabular-nums">{foot}</div>
    </article>
  )
}

function Grid<T>({ items, render, label, onEnd, done, getKey }: {
  items: T[]
  render: (item: T) => ReactNode
  label: string
  onEnd?: () => void
  done?: boolean
  getKey: (item: T) => string | number
}) {
  const { ref, cols } = useColumns()
  const rows = useMemo(() => chunk(items, cols), [items, cols])
  return (
    <div ref={ref}>
      <VirtualList
        label={label}
        items={rows}
        estimate={156}
        onEnd={onEnd}
        done={done}
        height="h-[min(540px,70vh)]"
        getKey={(r) => `${cols}:${getKey(r[0])}`}
        className="-mx-1 px-1"
        render={(row) => (
          <div className="grid gap-3 pt-1 pb-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {row.map((it) => (
              <div key={getKey(it)} className="min-w-0">{render(it)}</div>
            ))}
          </div>
        )}
      />
    </div>
  )
}

export function CardsVariant() {
  const d = useLists()
  const a = useLocalActions()
  const navigate = useNavigate()
  return (
    <Frame note={a.note}>
      <PageTitle sub="A card per item with three lines of content. Every action is in the card’s “…” menu.">Lists</PageTitle>
      {d.failed && <p className="mb-6 text-sm text-[var(--c-off)]">Couldn’t load: {d.failed.message}</p>}

      <Section id="c-topics" title="Topics" count={exact(d.topics.length)}>
        <Grid
          label="Topics"
          items={d.topics}
          getKey={(t) => t.id}
          render={(t) => {
            const off = a.isOff(t)
            const s = off ? { label: 'Off', tone: 'danger' as const } : topicStatus({ ...t, enabled: true })
            return (
              <Card
                muted={off}
                head={
                  <Link to="/topics/$id" params={{ id: t.id }} className="block min-w-0 outline-none focus-visible:underline">
                    <UserText>{t.name}</UserText>
                  </Link>
                }
                menu={
                  <RowMenu
                    label={`Actions for ${t.name.trim() || 'this topic'}`}
                    items={[
                      { label: 'Open chat', onSelect: () => void navigate({ to: '/topics/$id', params: { id: t.id } }) },
                      { label: off ? 'Switch on' : 'Switch off', onSelect: () => a.toggleTopic(t) },
                    ]}
                  />
                }
                body={<UserText lines={3} fallback="No purpose yet">{t.purpose}</UserText>}
                foot={
                  <>
                    <Status label={s.label} tone={s.tone} className="text-[12px]" />
                    <span className="truncate" title={`${exact(t.messages)} messages`}>
                      {compact(t.messages)} msgs · <Time iso={t.last_activity} relative />
                    </span>
                  </>
                }
              />
            )
          }}
        />
      </Section>

      <Section id="c-errors" title="Errors" count={`${exact(d.errors.length)}${d.errorsDone ? '' : '+'}`} hint="Older errors load as you scroll">
        <Grid
          label="Errors"
          items={d.errors}
          getKey={(e) => e.id}
          onEnd={d.moreErrors}
          done={d.errorsDone}
          render={(e) => (
            <Card
              head={
                <Link to="/logs/$id" params={{ id: e.error_id }} className="font-mono text-[13px] tabular-nums outline-none focus-visible:underline">
                  {e.error_id}
                </Link>
              }
              menu={
                <RowMenu
                  label={`Actions for ${e.error_id}`}
                  items={[
                    { label: 'Open details', onSelect: () => void navigate({ to: '/logs/$id', params: { id: e.error_id } }) },
                    { label: 'Copy ID', onSelect: () => void a.copy(e.error_id) },
                  ]}
                />
              }
              body={<UserText lines={3} className="font-mono text-[12px] leading-[1.5] text-[var(--c-ink)]/80">{e.message}</UserText>}
              foot={
                <>
                  <UserText className="min-w-0 font-mono">{e.kind}</UserText>
                  <span className="shrink-0"><Time iso={e.created_at} relative /></span>
                </>
              }
            />
          )}
        />
      </Section>

      <Section id="c-tasks" title="Tasks" count={`${exact(d.tasks.length)}${d.tasksDone ? '' : '+'}`}>
        <Grid
          label="Tasks"
          items={d.tasks}
          getKey={(t) => t.id}
          onEnd={d.moreTasks}
          done={d.tasksDone}
          render={(t) => {
            const status = a.taskStatus(t)
            const st = TASK_TONE[status]
            const sch = schedule(t, describeCron)
            const live = status === 'active' || status === 'paused'
            const items: MenuItem[] = []
            if (live) {
              items.push({ label: status === 'paused' ? 'Resume' : 'Pause', onSelect: () => a.togglePause(t) })
              items.push({ label: 'Run now', onSelect: () => a.runNow(t) })
            }
            items.push({ label: 'Open topic', onSelect: () => void navigate({ to: '/topics/$id', params: { id: t.conversation_id } }) })
            if (status !== 'cancelled') {
              items.push('separator')
              items.push({
                label: 'Delete…',
                danger: true,
                onSelect: () => window.confirm(`Delete task #${t.id}? It stops running and can’t be undone.`) && a.remove(t),
              })
            }
            return (
              <Card
                muted={status === 'cancelled'}
                head={<UserText>{t.title || firstLine(t.prompt)}</UserText>}
                menu={<RowMenu label={`Actions for task #${t.id}`} items={items} />}
                body={
                  <span className="flex flex-col gap-0.5">
                    <span className="truncate text-[var(--c-ink)]/80" title={sch.raw ?? undefined}>{sch.words}</span>
                    {sch.raw && <span className="truncate font-mono text-[12px]">{sch.raw}</span>}
                    <UserText className="text-[13px]">{d.topicName(t.conversation_id)}</UserText>
                  </span>
                }
                foot={
                  <>
                    <Status label={st.label} tone={st.tone} className="text-[12px]" />
                    <span className="truncate">{t.next_run_at && live ? <>next <Time iso={t.next_run_at} relative /></> : `${exact(t.run_count)} runs`}</span>
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
