// Variant 1 "Current": the panel as it ships today, assembled from the real
// production sidebar, header and component classes. Baseline for comparison.
import { Link } from '@tanstack/react-router'
import { ArrowRightIcon, ArrowUpIcon, PaperclipIcon } from 'lucide-react'
import { useState } from 'react'
import type { Message, Topic } from '../../api'
import { compact, exact, plural, clock } from '../../format'
import { PageHeader, Section, Time, TopicState } from '../../ui'
import { FoldedBody, Loading, useComposite, useDraftSend } from './data'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { FilePreview } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { Button } from '@/components/ui/button'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

const COLUMNS = 'md:grid md:grid-cols-[minmax(0,1fr)_6.5rem_8.5rem_11rem] md:items-center md:gap-x-6'

export function CurrentVariant() {
  const d = useComposite()
  return (
    <div className="fixed inset-0 z-[45] overflow-y-auto bg-sidebar">
      <SidebarProvider defaultOpen>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <SiteHeader />
          {d.pending ? (
            <Loading />
          ) : (
            <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-8 px-4 pt-6 pb-32 md:px-8 md:pt-8">
              <PageHeader
                title="Overview"
                description={
                  <>
                    {d.overview?.bot ? `@${d.overview.bot}` : 'Telegram isn’t connected'} · agents run on{' '}
                    <span className="font-mono text-[0.93em]">{d.overview?.agent}</span>
                  </>
                }
              />
              {d.overview && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label="Topics answering" value={d.overview.enabled_conversations} of={d.overview.conversations} />
                  <Stat label="Active T3 threads" value={d.overview.active_threads} />
                  <Stat label="Messages stored" value={d.overview.messages} />
                  <Stat label="Errors in the last 24 h" value={d.overview.errors_last_24h} alarm={d.overview.errors_last_24h > 0} />
                </div>
              )}
              <Section
                id="cur-topics"
                title="Topics"
                action={
                  <Button variant="ghost" size="sm" className="-mr-2 pr-2 text-muted-foreground" asChild>
                    <Link to="/topics">
                      All topics <ArrowRightIcon aria-hidden />
                    </Link>
                  </Button>
                }
              >
                <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
                  {d.excerpt.map((t, i) => (
                    <TopicRow key={t.id} topic={t} last={i === d.excerpt.length - 1} />
                  ))}
                </div>
              </Section>
              <Section id="cur-chat" title={d.chatTopic?.name ?? 'Chat'}>
                <Chat messages={d.messages} />
              </Section>
            </div>
          )}
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}

function Stat({ label, value, of, alarm }: { label: string; value: number; of?: number; alarm?: boolean }) {
  return (
    <div className="relative flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card px-4 py-4 shadow-xs sm:px-5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <p title={exact(value)} className={cn('text-2xl leading-none font-semibold tracking-tight tabular-nums sm:text-3xl', alarm && 'text-destructive')}>
        {compact(value)}
      </p>
      {of !== undefined && <p className="text-xs text-muted-foreground tabular-nums">of {plural(of, 'topic')}</p>}
    </div>
  )
}

function TopicRow({ topic: t, last }: { topic: Topic; last: boolean }) {
  return (
    <div className={cn('group relative flex flex-col gap-1 px-4 py-3 transition-[background-color] duration-150 ease-out hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50', !last && 'border-b', COLUMNS)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Link
            to="/topics/$id"
            params={{ id: t.id }}
            className="min-w-0 font-medium outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring/60 focus-visible:after:ring-inset"
          >
            <UserText className={cn(!t.enabled && 'text-muted-foreground')}>{t.name}</UserText>
          </Link>
          <span className="shrink-0 md:hidden">
            <TopicState topic={t} />
          </span>
        </div>
        <UserText lines={2} fallback="No purpose yet" className="max-w-[70ch] text-sm text-muted-foreground">
          {t.purpose}
        </UserText>
        <p className="text-xs text-muted-foreground tabular-nums md:hidden">
          {compact(t.messages)} messages · <Time iso={t.last_activity} relative />
        </p>
      </div>
      <span className="hidden text-right text-sm tabular-nums md:block" title={exact(t.messages)}>
        {compact(t.messages)}
      </span>
      <span className="hidden truncate text-sm text-muted-foreground md:block">
        <Time iso={t.last_activity} relative />
      </span>
      <span className="hidden md:block">
        <TopicState topic={t} />
      </span>
    </div>
  )
}

function Bubble({ m }: { m: Message }) {
  return (
    <div
      className={cn(
        'flex max-w-[min(72ch,92%)] min-w-0 flex-col gap-1.5 rounded-2xl px-3.5 py-2 text-[15px] [overflow:clip] [overflow-clip-margin:0.2em] sm:max-w-[min(72ch,85%)]',
        m.from_bot ? 'self-start rounded-bl-md border bg-card' : 'self-end rounded-br-md bg-accent text-accent-foreground',
        m.attachments.length > 0 && 'w-[min(24rem,100%)]',
      )}
    >
      {m.body.trim() && <FoldedBody body={m.body} toggleClassName="text-foreground/80" />}
      {m.attachments.length > 0 && (
        <ul className="grid gap-1.5 pt-0.5">
          {m.attachments.slice(0, 4).map((f, i) => (
            <li key={`${f.path}-${i}`} className="min-w-0">
              <FilePreview file={f} className="bg-background/60" />
            </li>
          ))}
        </ul>
      )}
      <time className="self-end text-[11px] text-muted-foreground tabular-nums">{clock(m.sent_at)}</time>
    </div>
  )
}

function Chat({ messages }: { messages: Message[] }) {
  const c = useDraftSend()
  const [mode, setMode] = useState('auto')
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {c.sent.map((text, i) => (
          <div key={i} className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[15px] text-accent-foreground">
            <UserText lines="all">{text}</UserText>
            <span className="mt-1 block text-right text-[11px] text-muted-foreground">Prototype: not sent</span>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card shadow-xs transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
        <label htmlFor="cur-compose" className="sr-only">
          Message this agent
        </label>
        <textarea
          id="cur-compose"
          value={c.draft}
          onChange={(e) => c.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) c.send()
          }}
          placeholder="Message this agent…"
          className="block min-h-14 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 p-1.5 pt-1">
          <Button variant="ghost" size="icon" aria-label="Attach files" className="size-11 rounded-full text-muted-foreground">
            <PaperclipIcon />
          </Button>
          <label htmlFor="cur-mode" className="sr-only">
            Mode for this message
          </label>
          <select
            id="cur-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="h-9 rounded-full border border-input bg-background px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            {['auto', 'fast', 'think', 'heavy', 'deepsearch'].map((v) => (
              <option key={v} value={v}>
                {v === 'deepsearch' ? 'DeepSearch' : v[0].toUpperCase() + v.slice(1)}
              </option>
            ))}
          </select>
          <Button size="icon" aria-label="Send message" disabled={!c.draft.trim()} onClick={c.send} className="ml-auto size-11 rounded-full active:scale-[0.96]">
            <ArrowUpIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
