// Variant 2 "Ledger" — density axis. Monochrome neutrals, one restrained
// ledger-green accent, hairline rules instead of cards, tabular figures,
// tight rows, small precise type. A transcript, not bubbles.
import { Link } from '@tanstack/react-router'
import { ArrowUpIcon, MenuIcon, PaperclipIcon, SearchIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import type { Message, Topic } from '../../api'
import { clock, compact, exact, topicStatus, type TopicStatus } from '../../format'
import { Time } from '../../ui'
import { FoldedBody, Loading, useComposite, useDraftSend, useFilter } from './data'
import { FilePreview } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

const CSS = `
.ledger {
  --l-bg: oklch(0.99 0 0);
  --l-rail: oklch(0.975 0.002 260);
  --l-ink: oklch(0.2 0.006 260);
  --l-mute: oklch(0.47 0.008 260);
  --l-faint: oklch(0.62 0.006 260);
  --l-rule: oklch(0.2 0.01 260 / 0.11);
  --l-row: oklch(0.2 0.01 260 / 0.04);
  --l-accent: oklch(0.47 0.095 160);
  --l-accent-ink: oklch(0.99 0 0);
  --l-warn: oklch(0.58 0.12 70);
  --l-off: oklch(0.55 0.17 27);
  --l-hair: 1px;
  background: var(--l-bg);
  color: var(--l-ink);
  font-size: 13px;
  line-height: 1.45;
}
@media (min-resolution: 2dppx) { .ledger { --l-hair: 0.5px; } }
@media (prefers-color-scheme: dark) {
  .ledger {
    --l-bg: oklch(0.17 0.004 260);
    --l-rail: oklch(0.145 0.004 260);
    --l-ink: oklch(0.93 0.004 260);
    --l-mute: oklch(0.7 0.006 260);
    --l-faint: oklch(0.56 0.006 260);
    --l-rule: oklch(0.32 0.006 260);
    --l-row: oklch(1 0 0 / 0.035);
    --l-accent: oklch(0.74 0.09 160);
    --l-accent-ink: oklch(0.17 0.004 260);
    --l-warn: oklch(0.8 0.1 75);
    --l-off: oklch(0.72 0.13 27);
  }
}
.ledger .chat-markdown { line-height: 1.6; font-size: 13.5px; }
.ledger .chat-markdown pre { background: var(--l-row); border: var(--l-hair) solid var(--l-rule); border-radius: 4px; }
.ledger .chat-markdown th, .ledger .chat-markdown td { border-color: var(--l-rule); padding: .3em .6em; }
.ledger .l-rb { border-bottom: var(--l-hair) solid var(--l-rule); }
.ledger .l-rt { border-top: var(--l-hair) solid var(--l-rule); }
.ledger .l-rr { border-right: var(--l-hair) solid var(--l-rule); }
.ledger .l-ry { border-block: var(--l-hair) solid var(--l-rule); }
@media (min-width: 640px) { .ledger .l-fig + .l-fig { border-left: var(--l-hair) solid var(--l-rule); } }
.ledger :focus-visible { outline: 2px solid var(--l-mute); outline-offset: 1px; }
`

const STATUS: Record<TopicStatus['tone'], string> = {
  success: 'var(--l-accent)',
  warning: 'var(--l-warn)',
  danger: 'var(--l-off)',
  muted: 'var(--l-faint)',
}

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


export function LedgerVariant() {
  const d = useComposite()
  const [menu, setMenu] = useState(false)
  return (
    <div className="ledger fixed inset-0 z-[45] flex antialiased">
      <style>{CSS}</style>
      {/* Rail: page links, then every agent. A drawer on phones. */}
      <aside
        className={cn(
          'flex w-60 shrink-0 flex-col bg-[var(--l-rail)] max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-10 max-md:shadow-[0_0_0_var(--l-hair)_var(--l-rule)]',
          'l-rr',
          !menu && 'max-md:invisible',
        )}
        aria-label="Navigation"
      >
        <div className={cn('flex h-11 items-center justify-between px-4 font-semibold tracking-tight', 'l-rb')}>
          <span>Herbot</span>
          <button type="button" onClick={() => setMenu(false)} aria-label="Close menu" className="grid size-11 place-items-center md:hidden">
            <XIcon className="size-4" />
          </button>
        </div>
        <nav className="flex flex-col py-2">
          {PAGES.map(([label, to]) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'mx-2 flex h-7 items-center rounded px-2 text-[13px] text-[var(--l-mute)] transition-[background-color,color] duration-150 hover:bg-[var(--l-row)] hover:text-[var(--l-ink)] pointer-coarse:h-11',
                label === 'Overview' && 'bg-[var(--l-row)] text-[var(--l-ink)]',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <AgentRail topics={d.topics} />
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <header className={cn('sticky top-0 z-[5] flex h-11 items-center gap-3 bg-[var(--l-bg)] px-3 md:px-6', 'l-rb')}>
          <button type="button" onClick={() => setMenu(true)} aria-label="Open menu" className="-ml-1 grid size-11 place-items-center md:hidden">
            <MenuIcon className="size-4" />
          </button>
          <span className="text-[var(--l-mute)]">Workspace</span>
          <span className="text-[var(--l-faint)]">/</span>
          <span className="font-medium">Overview</span>
          <span className="ml-auto hidden items-center gap-2 text-[var(--l-faint)] sm:flex">
            <SearchIcon className="size-3.5" aria-hidden />
            <Link to="/search" className="hover:text-[var(--l-ink)]">
              Search messages
            </Link>
          </span>
        </header>
        {d.pending ? (
          <Loading />
        ) : (
          <div className="mx-auto flex max-w-[64rem] flex-col gap-8 px-4 pt-6 pb-28 md:px-6">
            <div className="flex flex-col gap-1">
              <h1 className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">Overview</h1>
              <p className="text-[var(--l-mute)]">
                {d.overview?.bot ? `@${d.overview.bot}` : 'Telegram not connected'} · <span className="font-mono text-[12px]">{d.overview?.agent}</span>
              </p>
            </div>
            {d.overview && (
              <dl className={cn('grid grid-cols-2 sm:grid-cols-4', 'l-ry')}>
                <Figure label="Answering" value={`${d.overview.enabled_conversations}`} sub={`of ${exact(d.overview.conversations)}`} />
                <Figure label="T3 threads" value={compact(d.overview.active_threads)} />
                <Figure label="Messages" value={compact(d.overview.messages)} title={exact(d.overview.messages)} />
                <Figure label="Errors · 24 h" value={exact(d.overview.errors_last_24h)} alarm={d.overview.errors_last_24h > 0} to="/logs" />
              </dl>
            )}
            <section aria-labelledby="l-topics" className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h2 id="l-topics" className="text-[11px] font-medium tracking-[0.06em] text-[var(--l-mute)] uppercase">
                  Topics
                </h2>
                <Link to="/topics" className="text-[var(--l-accent)] hover:underline">
                  All {exact(d.topics.length)}
                </Link>
              </div>
              <div role="table" aria-label="Topics" className={cn('l-rt')}>
                <div role="row" className={cn('hidden h-7 items-center gap-4 text-[11px] tracking-[0.06em] text-[var(--l-faint)] uppercase md:grid', COLS, 'l-rb')}>
                  <span role="columnheader">Name</span>
                  <span role="columnheader">Purpose</span>
                  <span role="columnheader" className="text-right">
                    Msgs
                  </span>
                  <span role="columnheader">Active</span>
                  <span role="columnheader">State</span>
                </div>
                {d.excerpt.map((t) => (
                  <TopicRow key={t.id} t={t} />
                ))}
              </div>
            </section>
            <section aria-labelledby="l-chat" className="flex flex-col gap-2">
              <h2 id="l-chat" className="flex min-w-0 items-baseline gap-2 text-[11px] font-medium tracking-[0.06em] text-[var(--l-mute)] uppercase">
                <span className="shrink-0">Transcript</span>
                <UserText className="min-w-0 normal-case tracking-normal">{d.chatTopic?.name}</UserText>
              </h2>
              <Transcript messages={d.messages} />
            </section>
          </div>
        )}
      </main>
      {menu && <button type="button" aria-label="Close menu" onClick={() => setMenu(false)} className="fixed inset-0 z-[9] bg-black/30 md:hidden" />}
    </div>
  )
}

const COLS = 'md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_4.5rem_6.5rem_7.5rem]'

function Figure({ label, value, sub, alarm, title, to }: { label: string; value: string; sub?: string; alarm?: boolean; title?: string; to?: string }) {
  const body = (
    <>
      <dt className="text-[11px] tracking-[0.06em] text-[var(--l-faint)] uppercase">{label}</dt>
      <dd className={cn('text-[22px] leading-none font-medium tabular-nums', alarm && 'text-[var(--l-off)]')} title={title}>
        {value}
        {sub && <span className="ml-1.5 text-[12px] font-normal text-[var(--l-faint)]">{sub}</span>}
      </dd>
    </>
  )
  const cls = 'l-fig flex flex-col gap-2 py-3 sm:px-3 sm:first:pl-0'
  return to ? (
    <Link to={to} className={cn(cls, 'transition-[background-color] duration-150 hover:bg-[var(--l-row)]')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function StateText({ t }: { t: Topic }) {
  const s = topicStatus(t)
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[var(--l-mute)]">
      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: STATUS[s.tone] }} aria-hidden />
      <span className="truncate">{s.label}</span>
    </span>
  )
}

function TopicRow({ t }: { t: Topic }) {
  return (
    <div role="row" className={cn('group relative grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-1.5 transition-[background-color] duration-150 hover:bg-[var(--l-row)] md:py-0', COLS, 'l-rb')}>
      <span role="cell" className="min-w-0">
        <Link to="/topics/$id" params={{ id: t.id }} className="block min-w-0 font-medium after:absolute after:inset-0">
          <UserText className={cn(!t.enabled && 'text-[var(--l-faint)]')}>{t.name}</UserText>
        </Link>
      </span>
      <span role="cell" className="col-span-2 min-w-0 text-[var(--l-mute)] max-md:order-3 md:col-span-1">
        <UserText fallback="No purpose">{t.purpose}</UserText>
      </span>
      <span role="cell" className="hidden text-right tabular-nums md:block" title={exact(t.messages)}>
        {compact(t.messages)}
      </span>
      <span role="cell" className="hidden text-[var(--l-mute)] tabular-nums md:block">
        <Time iso={t.last_activity} relative />
      </span>
      <span role="cell" className="min-w-0">
        <StateText t={t} />
      </span>
    </div>
  )
}

function AgentRail({ topics }: { topics: Topic[] }) {
  const f = useFilter(topics)
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', 'l-rt')}>
      <div className="flex items-baseline justify-between px-4 pt-3 pb-1.5 text-[11px] tracking-[0.06em] text-[var(--l-faint)] uppercase">
        <span>Agents</span>
        <span className="tabular-nums">{topics.length}</span>
      </div>
      <div className="px-3 pb-2">
        <label htmlFor="l-filter" className="sr-only">
          Filter agents
        </label>
        <input
          id="l-filter"
          type="search"
          value={f.q}
          onChange={(e) => f.setQ(e.target.value)}
          placeholder="Filter"
          className="h-7 w-full rounded border-[length:var(--l-hair)] border-[var(--l-rule)] bg-[var(--l-bg)] px-2 text-base outline-none placeholder:text-[var(--l-faint)] md:text-[13px] pointer-coarse:h-11"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {f.shown.map((t) => {
          const s = topicStatus(t)
          return (
            <li key={t.id}>
              <Link
                to="/topics/$id"
                params={{ id: t.id }}
                className="flex h-7 items-center gap-2 rounded px-2 text-[13px] transition-[background-color] duration-150 hover:bg-[var(--l-row)] pointer-coarse:h-11"
              >
                <span className="size-1.5 shrink-0 rounded-[1px]" style={{ background: STATUS[s.tone] }} aria-hidden />
                <UserText className={cn('min-w-0 flex-1', !t.enabled && 'text-[var(--l-faint)]')}>{t.name}</UserText>
                <span className="text-[11px] text-[var(--l-faint)] tabular-nums">{compact(t.messages)}</span>
                <span className="sr-only">{s.label}</span>
              </Link>
            </li>
          )
        })}
        {f.shown.length === 0 && <li className="px-2 py-1 text-[var(--l-faint)]">No agent matches.</li>}
      </ul>
    </div>
  )
}

function Turn({ m }: { m: Message }) {
  return (
    <div className={cn('grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 py-2.5 sm:grid-cols-[4.5rem_minmax(0,1fr)_3rem]', 'l-rb')}>
      <span className={cn('pt-px text-[11px] font-medium tracking-[0.04em] uppercase', m.from_bot ? 'text-[var(--l-accent)]' : 'text-[var(--l-mute)]')}>{m.from_bot ? 'Herbot' : 'You'}</span>
      <div className="min-w-0 [overflow:clip] [overflow-clip-margin:0.2em]">
        {m.body.trim() && <FoldedBody body={m.body} toggleClassName="text-[13px] text-[var(--l-accent)]" />}
        {m.attachments.length > 0 && (
          <ul className="mt-1.5 grid max-w-md gap-1">
            {m.attachments.slice(0, 4).map((f, i) => (
              <li key={i}>
                <FilePreview file={f} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <time className="hidden text-right text-[11px] text-[var(--l-faint)] tabular-nums sm:block">{clock(m.sent_at)}</time>
    </div>
  )
}

function Transcript({ messages }: { messages: Message[] }) {
  const c = useDraftSend()
  const [mode, setMode] = useState('Auto')
  return (
    <div className="flex flex-col">
      <div className={cn('l-rt')}>
        {messages.map((m) => (
          <Turn key={m.id} m={m} />
        ))}
        {c.sent.map((text, i) => (
          <div key={i} className={cn('grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 py-2.5 sm:grid-cols-[4.5rem_minmax(0,1fr)_3rem]', 'l-rb')}>
            <span className="text-[11px] font-medium tracking-[0.04em] text-[var(--l-mute)] uppercase">You</span>
            <UserText lines="all">{text}</UserText>
            <span className="hidden text-right text-[11px] text-[var(--l-faint)] sm:block">queued</span>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-md border-[length:var(--l-hair)] border-[var(--l-rule)] bg-[var(--l-bg)] focus-within:border-[var(--l-mute)]">
        <label htmlFor="l-compose" className="sr-only">
          Message this agent
        </label>
        <textarea
          id="l-compose"
          rows={2}
          value={c.draft}
          onChange={(e) => c.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) c.send()
          }}
          placeholder="Message this agent  (⌘↵ to send)"
          className="block w-full resize-none bg-transparent px-3 pt-2.5 text-base outline-none placeholder:text-[var(--l-faint)] md:text-[13.5px]"
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <button type="button" aria-label="Attach files" className="grid size-8 place-items-center rounded text-[var(--l-mute)] hover:bg-[var(--l-row)] pointer-coarse:size-11">
            <PaperclipIcon className="size-3.5" />
          </button>
          <div role="radiogroup" aria-label="Mode" className="flex min-w-0 items-center overflow-x-auto">
            {['Auto', 'Fast', 'Think', 'Heavy', 'DeepSearch'].map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn('h-7 rounded px-2 text-[12px] transition-[background-color,color] duration-150 hover:text-[var(--l-ink)] pointer-coarse:h-11', mode === m ? 'bg-[var(--l-row)] text-[var(--l-ink)]' : 'text-[var(--l-faint)]')}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={c.send}
            disabled={!c.draft.trim()}
            aria-label="Send message"
            className="ml-auto grid size-8 place-items-center rounded bg-[var(--l-accent)] text-[var(--l-accent-ink)] transition-[opacity,scale] duration-150 active:scale-[0.96] disabled:opacity-35 pointer-coarse:size-11"
          >
            <ArrowUpIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
