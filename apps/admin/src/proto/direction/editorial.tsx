// Variant 4 "Editorial" — personality axis. A system serif display face,
// warm paper neutrals, generous rhythm, large headings, quiet chrome. The
// agents are an index; the transcript reads like a printed interview.
import { Link } from '@tanstack/react-router'
import { ArrowUpIcon, PaperclipIcon } from 'lucide-react'
import { useState } from 'react'
import type { Message, Topic } from '../../api'
import { clock, compact, dayLabel, exact, topicStatus } from '../../format'
import { Time } from '../../ui'
import { FoldedBody, Loading, useComposite, useDraftSend, useFilter } from './data'
import { FilePreview } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

const CSS = `
.edit {
  --e-paper: oklch(0.975 0.009 85);
  --e-leaf: oklch(0.99 0.006 85);
  --e-ink: oklch(0.24 0.014 60);
  --e-mute: oklch(0.47 0.016 65);
  --e-faint: oklch(0.6 0.014 70);
  --e-rule: oklch(0.3 0.03 60 / 0.14);
  --e-accent: oklch(0.47 0.13 28);
  --e-accent-ink: oklch(0.98 0.008 85);
  --e-warn: oklch(0.55 0.11 70);
  --e-ok: oklch(0.5 0.09 150);
  --e-serif: ui-serif, "New York", "Iowan Old Style", Georgia, "Times New Roman", serif;
  background: var(--e-paper);
  color: var(--e-ink);
  font-size: 15px;
  line-height: 1.6;
}
@media (prefers-color-scheme: dark) {
  .edit {
    --e-paper: oklch(0.19 0.01 60);
    --e-leaf: oklch(0.22 0.011 60);
    --e-ink: oklch(0.92 0.012 80);
    --e-mute: oklch(0.72 0.014 75);
    --e-faint: oklch(0.58 0.012 70);
    --e-rule: oklch(0.34 0.014 60);
    --e-accent: oklch(0.72 0.11 30);
    --e-accent-ink: oklch(0.19 0.01 60);
    --e-warn: oklch(0.8 0.1 75);
    --e-ok: oklch(0.76 0.1 150);
  }
}
.edit .serif { font-family: var(--e-serif); }
.edit .smallcaps { font-variant-caps: all-small-caps; letter-spacing: 0.06em; }
.edit .chat-markdown { line-height: 1.7; }
.edit .chat-markdown pre { background: var(--e-leaf); border: 1px solid var(--e-rule); border-radius: 6px; }
.edit .chat-markdown th, .edit .chat-markdown td { border-color: var(--e-rule); }
.edit .chat-markdown a { color: var(--e-accent); }
.edit :focus-visible { outline: 2px solid var(--e-mute); outline-offset: 2px; }
`

const PAGES = [
  ['Overview', '/'],
  ['Topics', '/topics'],
  ['Search', '/search'],
  ['Tasks', '/tasks'],
  ['Memory', '/memory'],
  ['Personalize', '/personalize'],
  ['Companions', '/companions'],
  ['Connectors', '/connectors'],
  ['Logs', '/logs'],
] as const

function tone(t: Topic): string {
  const s = topicStatus(t)
  return s.tone === 'success' ? 'var(--e-ok)' : s.tone === 'warning' ? 'var(--e-warn)' : s.tone === 'danger' ? 'var(--e-accent)' : 'var(--e-faint)'
}

export function EditorialVariant() {
  const d = useComposite()
  const [contents, setContents] = useState(false)
  return (
    <div className="edit fixed inset-0 z-[45] overflow-y-auto antialiased">
      <style>{CSS}</style>
      <header className="sticky top-0 z-[5] border-b border-[var(--e-rule)] bg-[var(--e-paper)]">
        <div className="mx-auto flex h-14 max-w-[76rem] items-center gap-6 px-5 md:px-8">
          <Link to="/" className="serif text-[22px] leading-none font-semibold tracking-[-0.01em]">
            Herbot
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-4 text-[14px] text-[var(--e-mute)] lg:flex">
            {PAGES.map(([label, to]) => (
              <Link key={to} to={to} className={cn('transition-[color] duration-150 hover:text-[var(--e-ink)]', label === 'Overview' && 'text-[var(--e-ink)] underline decoration-[var(--e-accent)] decoration-2 underline-offset-[6px]')}>
                {label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setContents((v) => !v)}
            aria-expanded={contents}
            className="ml-auto h-11 rounded-full px-3 text-[14px] text-[var(--e-mute)] hover:text-[var(--e-ink)] lg:hidden"
          >
            {contents ? 'Close' : 'Menu'}
          </button>
        </div>
      </header>
      {d.pending ? (
        <Loading />
      ) : (
        <div className="mx-auto grid max-w-[76rem] gap-12 px-5 pt-10 pb-32 md:px-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside aria-label="Agents index" className={cn('lg:sticky lg:top-24 lg:block lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto', !contents && 'max-lg:hidden')}>
            <nav aria-label="Pages" className="mb-8 grid grid-cols-2 gap-x-4 lg:hidden">
              {PAGES.map(([label, to]) => (
                <Link key={to} to={to} className="flex h-11 items-center text-[15px] text-[var(--e-mute)] hover:text-[var(--e-ink)]">
                  {label}
                </Link>
              ))}
            </nav>
            <AgentIndex topics={d.topics} />
          </aside>
          <main className="flex min-w-0 flex-col gap-14">
            <div className="flex flex-col gap-3">
              <p className="smallcaps text-[13px] text-[var(--e-mute)]">
                {d.overview?.bot ? `@${d.overview.bot}` : 'Telegram not connected'} · {d.overview?.agent}
              </p>
              <h1 className="serif max-w-[18ch] text-[44px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance md:text-[56px]">Overview</h1>
            </div>
            {d.overview && (
              <dl className="grid grid-cols-2 gap-x-8 gap-y-6 border-y border-[var(--e-rule)] py-6 md:grid-cols-4">
                <Numeral label="Answering" value={`${d.overview.enabled_conversations}`} sub={`of ${exact(d.overview.conversations)} topics`} />
                <Numeral label="Threads" value={compact(d.overview.active_threads)} />
                <Numeral label="Messages" value={compact(d.overview.messages)} title={exact(d.overview.messages)} />
                <Numeral label="Errors today" value={exact(d.overview.errors_last_24h)} alarm={d.overview.errors_last_24h > 0} to="/logs" />
              </dl>
            )}
            <section aria-labelledby="e-topics" className="flex flex-col gap-5">
              <div className="flex items-baseline justify-between gap-4 border-b border-[var(--e-rule)] pb-3">
                <h2 id="e-topics" className="serif text-[28px] leading-tight font-semibold tracking-[-0.01em]">
                  Topics
                </h2>
                <Link to="/topics" className="text-[14px] text-[var(--e-accent)] hover:underline">
                  All {exact(d.topics.length)} →
                </Link>
              </div>
              <ol className="flex flex-col">
                {d.excerpt.map((t) => (
                  <TopicEntry key={t.id} t={t} />
                ))}
              </ol>
            </section>
            <section aria-labelledby="e-chat" className="flex flex-col gap-5">
              <div className="flex flex-col gap-1 border-b border-[var(--e-rule)] pb-3">
                <p className="smallcaps text-[13px] text-[var(--e-mute)]">Transcript</p>
                <h2 id="e-chat" className="serif text-[28px] leading-tight font-semibold tracking-[-0.01em]">
                  <UserText>{d.chatTopic?.name}</UserText>
                </h2>
              </div>
              <Transcript messages={d.messages} />
            </section>
          </main>
        </div>
      )}
    </div>
  )
}

function Numeral({ label, value, sub, alarm, title, to }: { label: string; value: string; sub?: string; alarm?: boolean; title?: string; to?: string }) {
  const inner = (
    <>
      <dt className="smallcaps text-[13px] text-[var(--e-mute)]">{label}</dt>
      <dd className={cn('serif text-[40px] leading-none font-semibold tracking-[-0.02em] tabular-nums', alarm && 'text-[var(--e-accent)]')} title={title}>
        {value}
      </dd>
      {sub && <dd className="text-[13px] text-[var(--e-faint)]">{sub}</dd>}
    </>
  )
  return to ? (
    <Link to={to} className="flex flex-col gap-2 transition-[opacity] duration-150 hover:opacity-80">
      {inner}
    </Link>
  ) : (
    <div className="flex flex-col gap-2">{inner}</div>
  )
}

function TopicEntry({ t }: { t: Topic }) {
  const s = topicStatus(t)
  return (
    <li className="group relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 border-b border-[var(--e-rule)] py-4">
      <Link to="/topics/$id" params={{ id: t.id }} className="serif min-w-0 text-[20px] leading-snug font-semibold after:absolute after:inset-0 group-hover:text-[var(--e-accent)]">
        <UserText className={cn(!t.enabled && 'text-[var(--e-faint)]')}>{t.name}</UserText>
      </Link>
      <span className="row-span-2 self-start pt-1.5 text-right text-[13px] text-[var(--e-mute)] tabular-nums">
        <span title={exact(t.messages)}>{compact(t.messages)}</span>
        <span className="block text-[12px] text-[var(--e-faint)]">
          <Time iso={t.last_activity} relative />
        </span>
      </span>
      <UserText as="p" lines={2} fallback="No purpose yet" className="max-w-[62ch] text-[15px] text-[var(--e-mute)]">
        {t.purpose}
      </UserText>
      <span className="smallcaps col-span-2 inline-flex items-center gap-2 text-[13px]" style={{ color: tone(t) }}>
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        {s.label}
      </span>
    </li>
  )
}

function AgentIndex({ topics }: { topics: Topic[] }) {
  const f = useFilter(topics)
  return (
    <div className="flex flex-col gap-3">
      <p className="smallcaps text-[13px] text-[var(--e-mute)]">Index of agents · {topics.length}</p>
      <label htmlFor="e-filter" className="sr-only">
        Find an agent
      </label>
      <input
        id="e-filter"
        type="search"
        value={f.q}
        onChange={(e) => f.setQ(e.target.value)}
        placeholder="Find an agent"
        className="h-10 border-b border-[var(--e-rule)] bg-transparent text-base outline-none placeholder:text-[var(--e-faint)] focus-visible:border-[var(--e-ink)] md:text-[14px]"
      />
      <ol className="flex flex-col">
        {f.shown.map((t) => (
          <li key={t.id}>
            <Link to="/topics/$id" params={{ id: t.id }} className="grid min-h-9 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 text-[14px] transition-[color] duration-150 hover:text-[var(--e-accent)] pointer-coarse:min-h-11">
              <span className="text-[12px] text-[var(--e-faint)] tabular-nums">{t.id}</span>
              <UserText className={cn(!t.enabled && 'text-[var(--e-faint)]')}>{t.name}</UserText>
              <span className="size-1.5 rounded-full" style={{ background: tone(t) }} aria-hidden />
            </Link>
          </li>
        ))}
        {f.shown.length === 0 && <li className="text-[14px] text-[var(--e-mute)]">No agent by that name.</li>}
      </ol>
    </div>
  )
}

function Turn({ m }: { m: Message }) {
  return (
    <article className={cn('flex min-w-0 flex-col gap-1.5 [overflow:clip] [overflow-clip-margin:0.2em]', !m.from_bot && 'border-l-2 border-[var(--e-accent)] pl-5')}>
      <header className="smallcaps flex items-baseline gap-3 text-[13px] text-[var(--e-mute)]">
        <span className="text-[var(--e-ink)]">{m.from_bot ? 'Herbot' : 'You'}</span>
        <time className="tabular-nums">
          {dayLabel(m.sent_at)}, {clock(m.sent_at)}
        </time>
      </header>
      {m.body.trim() && <FoldedBody body={m.body} className="max-w-[68ch]" toggleClassName="text-[14px] text-[var(--e-accent)]" />}
      {m.attachments.length > 0 && (
        <ul className="grid max-w-md gap-1.5">
          {m.attachments.slice(0, 4).map((f, i) => (
            <li key={i}>
              <FilePreview file={f} />
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function Transcript({ messages }: { messages: Message[] }) {
  const c = useDraftSend()
  const [mode, setMode] = useState('Auto')
  return (
    <div className="flex flex-col gap-8">
      {messages.map((m) => (
        <Turn key={m.id} m={m} />
      ))}
      {c.sent.map((text, i) => (
        <article key={i} className="flex flex-col gap-1.5 border-l-2 border-[var(--e-accent)] pl-5">
          <span className="smallcaps text-[13px] text-[var(--e-mute)]">You · prototype, not sent</span>
          <UserText lines="all">{text}</UserText>
        </article>
      ))}
      <div className="flex flex-col gap-2 rounded-xl bg-[var(--e-leaf)] p-4 shadow-[0_0_0_1px_var(--e-rule)] focus-within:shadow-[0_0_0_1.5px_var(--e-mute)]">
        <label htmlFor="e-compose" className="smallcaps text-[13px] text-[var(--e-mute)]">
          Write to this agent
        </label>
        <textarea
          id="e-compose"
          rows={3}
          value={c.draft}
          onChange={(e) => c.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) c.send()
          }}
          className="serif w-full resize-none bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-[var(--e-faint)]"
          placeholder="Ask anything…"
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" aria-label="Attach files" className="grid size-11 place-items-center rounded-full text-[var(--e-mute)] transition-[color] duration-150 hover:text-[var(--e-ink)]">
            <PaperclipIcon className="size-4.5" />
          </button>
          <div role="radiogroup" aria-label="Mode" className="flex flex-wrap items-center gap-x-3 text-[14px]">
            {['Auto', 'Fast', 'Think', 'Heavy', 'DeepSearch'].map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn('h-11 transition-[color] duration-150', mode === m ? 'text-[var(--e-ink)] underline decoration-[var(--e-accent)] decoration-2 underline-offset-[6px]' : 'text-[var(--e-faint)] hover:text-[var(--e-ink)]')}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={c.send}
            disabled={!c.draft.trim()}
            className="ml-auto inline-flex h-11 items-center gap-2 rounded-full bg-[var(--e-accent)] pr-4 pl-5 text-[14px] font-medium text-[var(--e-accent-ink)] transition-[opacity,scale] duration-150 active:scale-[0.96] disabled:opacity-40"
          >
            Send <ArrowUpIcon className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}
