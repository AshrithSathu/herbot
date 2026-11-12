// Overview variant 2, "Inbox" — axis: what needs you, as actionable rows.
// The figures shrink to one line; each kind of thing that needs you is a
// short list you can act on in place (open, set a purpose, run a failed
// task again, read an error).
import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { changeTask, type ErrorSummary, type Task, type Topic } from '../../../api'
import { ago, compact, exact, plural } from '../../../format'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton, notify } from '@/components/hb/feedback'
import { QuietAction, ThreadList } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { StatusDot, topicTone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { firstLine, useOverviewData } from './data'
import { Frame, useNewAgent } from './frame'

export function Inbox() {
  return (
    <Frame>
      <InboxPage />
    </Frame>
  )
}

const SHOWN = 5

function InboxPage() {
  const d = useOverviewData()
  const o = d.overview.data
  const navigate = useNavigate()
  const newAgent = useNewAgent()
  const open = (id: number) => navigate({ to: '/topics/$id', params: { id } })
  const nothing = d.unread.length + d.setup.length + d.failed.length + d.errorsToday.length === 0

  return (
    <ShellPage
      title="Needs you"
      back={<BackToAgents />}
      actions={<Button onClick={newAgent}>New agent</Button>}
      description={
        o ? (
          <span className="tabular-nums">
            {exact(o.enabled_conversations)} of {exact(o.conversations)} answering · {compact(o.messages)} messages ·{' '}
            <span className={o.errors_last_24h > 0 ? 'text-destructive' : undefined}>{plural(o.errors_last_24h, 'error')} in 24 h</span>
          </span>
        ) : undefined
      }
    >
      {d.error ? (
        <InPlaceError title="Couldn’t load what needs you" error={d.error} onRetry={d.retry} />
      ) : d.pending ? (
        <ListSkeleton rows={6} />
      ) : nothing ? (
        <InPlaceEmpty title="Nothing needs you">Every agent is answering and nothing failed in the last day.</InPlaceEmpty>
      ) : (
        <>
          <Section id="replies" title="New replies" count={d.unread.length} items={d.unread}>
            {(items) => (
              <ThreadList<Topic>
                label="Agents with new replies"
                items={items}
                itemKey={(t) => t.id}
                title={(t) => <UserText className="font-medium">{t.name}</UserText>}
                aside={(t) => <span className="text-[12.5px] font-medium text-accent-strong tabular-nums">{t.unread >= 99 ? '99+' : t.unread} new</span>}
                body={(t) => <UserText className="text-mute" fallback="No purpose yet">{t.purpose}</UserText>}
                meta={(t) => <span suppressHydrationWarning>active {ago(t.last_activity)}</span>}
                actions={(t) => <QuietAction onClick={() => open(t.id)}>Open</QuietAction>}
              />
            )}
          </Section>

          <Section id="setup" title="Waiting for a purpose" count={d.setup.length} items={d.setup}>
            {(items) => (
              <ThreadList<Topic>
                label="Topics waiting for a purpose"
                items={items}
                itemKey={(t) => t.id}
                title={(t) => <UserText className="font-medium">{t.name}</UserText>}
                aside={(t) => <StatusDot status={topicTone(t)} dense />}
                body={(t) => <UserText className="text-mute" fallback="No purpose yet">{t.purpose}</UserText>}
                meta={(t) => <span className="tabular-nums">{plural(t.messages, 'message')}</span>}
                actions={(t) => <QuietAction onClick={() => open(t.id)}>Set its purpose</QuietAction>}
              />
            )}
          </Section>

          <Section id="failed" title="Tasks that failed" count={d.failed.length} items={d.failed}>
            {(items) => <FailedTasks tasks={items} topics={d.byId} />}
          </Section>

          <Section id="errors" title="Errors in the last day" count={d.errorsToday.length} items={d.errorsToday} more={d.errors.hasNextPage}>
            {(items) => (
              <ThreadList<ErrorSummary>
                label="Errors in the last day"
                items={items}
                itemKey={(e) => e.id}
                title={(e) => (
                  <span className="flex min-w-0 items-baseline gap-2 font-mono text-[13px]">
                    <span className="font-medium tabular-nums">{e.error_id}</span>
                    <UserText className="min-w-0 text-mute">{e.kind}</UserText>
                  </span>
                )}
                aside={(e) => (
                  <span className="text-[12.5px] text-faint" suppressHydrationWarning>
                    {ago(e.created_at)}
                  </span>
                )}
                body={(e) => <UserText className="font-mono text-[12.5px] text-mute">{firstLine(e.message)}</UserText>}
                actions={(e) => <QuietAction onClick={() => navigate({ to: '/logs/$id', params: { id: e.error_id } })}>Read it</QuietAction>}
              />
            )}
          </Section>
        </>
      )}
    </ShellPage>
  )
}

/** A short list with its count and "Show all N"; hidden when empty. */
function Section<T>({ id, title, count, items, more = false, children }: { id: string; title: string; count: number; items: T[]; more?: boolean; children: (items: T[]) => ReactNode }) {
  const [all, setAll] = useState(false)
  if (count === 0) return null
  const shown = all ? items : items.slice(0, SHOWN)
  return (
    <section aria-labelledby={`inbox-${id}`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`inbox-${id}`} className="text-[15px] font-semibold">
          {title} <span className="font-normal text-mute tabular-nums">{exact(count)}{more ? '+' : ''}</span>
        </h2>
        {count > SHOWN && (
          <Button size="sm" variant="ghost" onClick={() => setAll((a) => !a)} aria-expanded={all} aria-controls={`inbox-${id}-list`}>
            {all ? 'Show fewer' : `Show all ${exact(count)}`}
          </Button>
        )}
      </div>
      <div id={`inbox-${id}-list`} className="border-t border-line">
        {children(shown)}
      </div>
    </section>
  )
}

function FailedTasks({ tasks, topics }: { tasks: Task[]; topics: Map<number, Topic> }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [errors, setErrors] = useState<Record<number, string>>({})
  const run = useMutation({
    mutationFn: (id: number) => changeTask({ data: { id, action: 'run' } }),
    onMutate: (id) => setErrors(({ [id]: _, ...rest }) => rest),
    onSuccess: async (_, id) => {
      await client.invalidateQueries({ queryKey: ['tasks'] })
      notify(`Task #${id} will run in a moment.`)
    },
    onError: (e, id) => setErrors((all) => ({ ...all, [id]: e.message })),
  })
  return (
    <ThreadList<Task>
      label="Tasks that failed"
      items={tasks}
      itemKey={(t) => t.id}
      title={(t) => <UserText className="font-medium">{t.title ?? firstLine(t.prompt)}</UserText>}
      aside={(t) => <UserText className="max-w-[12rem] text-[12.5px] text-mute">{topics.get(t.conversation_id)?.name ?? `Topic #${t.conversation_id}`}</UserText>}
      body={(t) => (
        <>
          <UserText lines={2} as="p" className="font-mono text-[12.5px] text-destructive">
            {t.last_error}
          </UserText>
          {errors[t.id] && (
            <p role="alert" className="mt-1 text-[12.5px] text-destructive">
              Couldn’t run it again: <UserText>{errors[t.id]}</UserText>
            </p>
          )}
        </>
      )}
      meta={(t) => <span suppressHydrationWarning>last ran {ago(t.last_run_at)}</span>}
      actions={(t) => (
        <>
          <QuietAction pending={run.isPending && run.variables === t.id} onClick={() => run.mutate(t.id)}>
            Run again
          </QuietAction>
          <QuietAction onClick={() => navigate({ to: '/tasks' })}>Open tasks</QuietAction>
        </>
      )}
    />
  )
}
