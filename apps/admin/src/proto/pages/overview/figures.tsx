// Overview variant 1, "Figures" — axis: figures first. Four serif numbers
// lead; a short "Needs you" list of counts that link to filtered views; the
// last error underneath.
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from 'lucide-react'
import { ago, plural } from '../../../format'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { BigNumber, Dot, type Tone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { firstLine, useOverviewData } from './data'
import { Frame, useNewAgent } from './frame'

export function Figures() {
  return (
    <Frame>
      <FiguresPage />
    </Frame>
  )
}

function FiguresPage() {
  const d = useOverviewData()
  const o = d.overview.data
  const newAgent = useNewAgent()
  return (
    <ShellPage
      title="Overview"
      description={o ? `${o.bot ? `Telegram connected as @${o.bot}` : 'Telegram isn’t connected'} · agents run on ${o.agent}` : undefined}
      back={<BackToAgents />}
      actions={<Button onClick={newAgent}>New agent</Button>}
    >
      {d.error ? (
        <InPlaceError title="Couldn’t load the overview" error={d.error} onRetry={d.retry} />
      ) : !o ? (
        <ListSkeleton rows={3} lines={1} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-y border-line py-5 md:grid-cols-4">
            <BigNumber label="Answering" value={o.enabled_conversations} of={o.conversations} />
            <BigNumber label="Threads" value={o.active_threads} />
            <BigNumber label="Messages" value={o.messages} />
            <BigNumber label="Errors · 24 h" value={o.errors_last_24h} alarm={o.errors_last_24h > 0} />
          </dl>

          <section aria-labelledby="fig-needs" className="flex flex-col gap-2">
            <h2 id="fig-needs" className="text-[15px] font-semibold">
              Needs you
            </h2>
            {d.unread.length + d.setup.length + d.off.length + d.failed.length === 0 ? (
              <InPlaceEmpty title="Nothing needs you">Every agent is set up and answering.</InPlaceEmpty>
            ) : (
              <ul className="flex flex-col border-t border-line">
                {d.unread.length > 0 && (
                  <Need tone="active" to="/topics" search={{ status: 'unread' }} title={`${plural(d.unread.length, 'agent')} replied since you last looked`}>
                    <span className="shrink-0">Newest:</span>
                    <UserText className="min-w-0">{d.unread[0].name}</UserText>
                  </Need>
                )}
                {d.setup.length > 0 && (
                  <Need tone="warn" to="/topics" search={{ status: 'setup' }} title={`${plural(d.setup.length, 'topic')} waiting for a purpose`}>
                    They answer once you tell them what they’re for.
                  </Need>
                )}
                {d.failed.length > 0 && (
                  <Need tone="off" to="/tasks" title={`${plural(d.failed.length, 'task')} failed on the last run`}>
                    <UserText>{firstLine(d.failed[0].last_error ?? '')}</UserText>
                  </Need>
                )}
                {d.off.length > 0 && (
                  <Need tone="idle" to="/topics" search={{ status: 'off' }} title={`${plural(d.off.length, 'topic')} switched off`}>
                    Messages there are ignored until you switch them on.
                  </Need>
                )}
              </ul>
            )}
          </section>

          <section aria-labelledby="fig-error" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="fig-error" className="text-[15px] font-semibold">
                Last error
              </h2>
              <Link to="/logs" className="text-[13px] font-medium text-accent-strong hover:underline">
                All logs
              </Link>
            </div>
            {o.last_error ? (
              <article className="relative flex flex-col gap-1.5 border-y border-line py-3">
                <div className="flex items-baseline gap-3 text-[13px]">
                  <Link to="/logs/$id" params={{ id: o.last_error.error_id }} className="font-mono font-medium tabular-nums after:absolute after:inset-0 hover:underline">
                    {o.last_error.error_id}
                  </Link>
                  <UserText className="min-w-0 font-mono text-mute">{o.last_error.kind}</UserText>
                  <span className="ml-auto shrink-0 text-faint" suppressHydrationWarning>
                    {ago(o.last_error.created_at)}
                  </span>
                </div>
                <UserText lines={3} as="p" className="font-mono text-[12.5px] leading-relaxed text-mute">
                  {o.last_error.message}
                </UserText>
              </article>
            ) : (
              <p className="border-y border-line py-3 text-[14px] text-mute">No errors recorded.</p>
            )}
          </section>
        </>
      )}
    </ShellPage>
  )
}

function Need({ tone, to, search, title, children }: { tone: Tone; to: '/topics' | '/tasks'; search?: Record<string, string>; title: string; children: React.ReactNode }) {
  return (
    <li className="relative flex min-h-14 items-center gap-3 border-b border-line py-2.5 hover:bg-sunken">
      <Dot tone={tone} className="ml-1" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link to={to} search={search as never} className="text-[14px] font-medium outline-none after:absolute after:inset-0 focus-visible:underline">
          {title}
        </Link>
        <span className="flex min-w-0 items-baseline gap-1 truncate text-[13px] text-mute">{children}</span>
      </div>
      <ChevronRightIcon className="mr-1 size-4 shrink-0 text-faint" aria-hidden />
    </li>
  )
}
