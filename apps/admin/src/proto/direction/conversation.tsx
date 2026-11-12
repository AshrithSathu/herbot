// Variant 3 "Conversation" — layout axis. A three-pane master-detail shell:
// agents | the live conversation | the topic's details. The chat is home.
// Soft raised panes; the accent is Telegram's blue, from the product's domain.
import { Link } from '@tanstack/react-router'
import { ArrowUpIcon, ChevronLeftIcon, InfoIcon, PaperclipIcon, SearchIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import type { Message, Topic } from '../../api'
import { clock, compact, exact, topicStatus, type TopicStatus } from '../../format'
import { Time } from '../../ui'
import { FoldedBody, Loading, hueOf, initial, useComposite, useDraftSend, useFilter } from './data'
import { FilePreview } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

const CSS = `
.convo {
  --c-canvas: oklch(0.955 0.008 240);
  --c-pane: oklch(0.995 0.002 240);
  --c-sunken: oklch(0.972 0.006 240);
  --c-ink: oklch(0.22 0.02 245);
  --c-mute: oklch(0.5 0.022 245);
  --c-faint: oklch(0.64 0.018 245);
  --c-line: oklch(0.25 0.03 245 / 0.09);
  --c-accent: oklch(0.58 0.135 237);
  --c-accent-ink: oklch(0.99 0.003 240);
  --c-accent-soft: oklch(0.93 0.035 237);
  --c-ok: oklch(0.6 0.13 150);
  --c-warn: oklch(0.7 0.13 75);
  --c-off: oklch(0.58 0.17 25);
  --c-raised: 0 0 0 1px oklch(0.25 0.03 245 / 0.06), 0 1px 3px oklch(0.25 0.03 245 / 0.06), 0 6px 16px -6px oklch(0.25 0.03 245 / 0.08);
  background: var(--c-canvas);
  color: var(--c-ink);
  font-size: 14px;
  line-height: 1.5;
}
@media (prefers-color-scheme: dark) {
  .convo {
    --c-canvas: oklch(0.15 0.012 245);
    --c-pane: oklch(0.2 0.014 245);
    --c-sunken: oklch(0.175 0.013 245);
    --c-ink: oklch(0.94 0.006 240);
    --c-mute: oklch(0.72 0.016 240);
    --c-faint: oklch(0.58 0.016 240);
    --c-line: oklch(0.3 0.016 245);
    --c-accent: oklch(0.7 0.11 237);
    --c-accent-ink: oklch(0.16 0.02 245);
    --c-accent-soft: oklch(0.29 0.045 237);
    --c-ok: oklch(0.76 0.12 150);
    --c-warn: oklch(0.82 0.11 80);
    --c-off: oklch(0.72 0.14 25);
    --c-raised: 0 0 0 1px oklch(1 0 0 / 0.07);
  }
}
.convo .chat-markdown pre { background: var(--c-sunken); border-radius: 10px; }
.convo .bubble-me .chat-markdown pre { background: oklch(0 0 0 / 0.16); }
.convo .chat-markdown th, .convo .chat-markdown td { border-color: var(--c-line); }
.convo .bubble-me .chat-markdown a { color: inherit; }
.convo :focus-visible { outline: 2px solid var(--c-mute); outline-offset: 2px; }
`

const DOT: Record<TopicStatus['tone'], string> = {
  success: 'var(--c-ok)',
  warning: 'var(--c-warn)',
  danger: 'var(--c-off)',
  muted: 'var(--c-faint)',
}

const pane = 'rounded-2xl bg-[var(--c-pane)] shadow-[var(--c-raised)]'

export function ConversationVariant() {
  const d = useComposite()
  const [selected, setSelected] = useState(2)
  // Phones show one pane at a time: the chat, or the agents, or details.
  const [phone, setPhone] = useState<'chat' | 'agents' | 'details'>('chat')
  const [details, setDetails] = useState(true)
  const topic = d.topics.find((t) => t.id === selected) ?? d.chatTopic
  if (d.pending) return <div className="convo fixed inset-0 z-[45]"><style>{CSS}</style><Loading /></div>
  return (
    <div className="convo fixed inset-0 z-[45] flex gap-2 p-0 antialiased md:p-2">
      <style>{CSS}</style>
      <aside
        aria-label="Agents"
        className={cn(pane, 'flex w-full shrink-0 flex-col max-md:rounded-none md:w-[19rem]', phone !== 'agents' && 'max-md:hidden')}
      >
        <AgentList
          topics={d.topics}
          selected={selected}
          onSelect={(id) => {
            setSelected(id)
            setPhone('chat')
          }}
          onClose={() => setPhone('chat')}
        />
      </aside>
      <main className={cn(pane, 'flex min-w-0 flex-1 flex-col overflow-hidden max-md:rounded-none', phone !== 'chat' && 'max-md:hidden')}>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--c-line)] px-2 md:px-4">
          <button type="button" onClick={() => setPhone('agents')} aria-label="All agents" className="grid size-11 place-items-center rounded-full text-[var(--c-mute)] hover:bg-[var(--c-sunken)] md:hidden">
            <ChevronLeftIcon className="size-5" />
          </button>
          {topic && <Avatar t={topic} size="size-9" />}
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <UserText className="font-semibold">{topic?.name}</UserText>
            <span className="truncate text-[12px] text-[var(--c-mute)]">
              {topic ? `${topicStatus(topic).label} · ${compact(topic.messages)} messages` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => (window.matchMedia('(min-width: 1100px)').matches ? setDetails((v) => !v) : setPhone('details'))}
            aria-label="Topic details"
            aria-pressed={details}
            className="grid size-11 place-items-center rounded-full text-[var(--c-mute)] transition-[background-color] duration-150 hover:bg-[var(--c-sunken)]"
          >
            <InfoIcon className="size-5" />
          </button>
        </header>
        <Conversation messages={selected === 2 ? d.messages : []} topicName={topic?.name ?? ''} />
      </main>
      <aside
        aria-label="Topic details"
        className={cn(
          pane,
          'flex shrink-0 flex-col overflow-y-auto max-md:fixed max-md:inset-0 max-md:z-10 max-md:rounded-none min-[1100px]:w-[20rem]',
          phone === 'details' ? 'max-md:flex' : 'max-md:hidden',
          details ? 'min-[1100px]:flex' : 'min-[1100px]:hidden',
          'md:max-[1099px]:hidden',
        )}
      >
        <Details topic={topic} overview={d.overview} onClose={() => setPhone('chat')} />
      </aside>
    </div>
  )
}

function Avatar({ t, size = 'size-10' }: { t: Topic; size?: string }) {
  const hue = hueOf(t.id)
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full text-[15px] font-semibold select-none', size)}
      style={{ background: `oklch(0.9 0.05 ${hue})`, color: `oklch(0.38 0.08 ${hue})` }}
    >
      {t.is_general ? '★' : initial(t.name)}
    </span>
  )
}

function AgentList({ topics, selected, onSelect, onClose }: { topics: Topic[]; selected: number; onSelect: (id: number) => void; onClose: () => void }) {
  const f = useFilter(topics)
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <span className="font-semibold tracking-tight">Herbot</span>
        <span className="text-[12px] text-[var(--c-faint)] tabular-nums">{topics.length} agents</span>
        <button type="button" onClick={onClose} aria-label="Back to chat" className="ml-auto grid size-11 place-items-center md:hidden">
          <XIcon className="size-5" />
        </button>
      </div>
      <div className="relative px-3 pb-2">
        <label htmlFor="c-filter" className="sr-only">
          Search agents
        </label>
        <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-[calc(50%+4px)] text-[var(--c-faint)]" />
        <input
          id="c-filter"
          type="search"
          value={f.q}
          onChange={(e) => f.setQ(e.target.value)}
          placeholder="Search agents"
          className="h-10 w-full rounded-full bg-[var(--c-sunken)] pr-3 pl-9 text-base outline-none placeholder:text-[var(--c-faint)] focus-visible:shadow-[0_0_0_2px_var(--c-accent)] md:text-[14px]"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {f.shown.map((t) => {
          const s = topicStatus(t)
          const on = t.id === selected
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-[background-color] duration-150',
                  on ? 'bg-[var(--c-accent-soft)]' : 'hover:bg-[var(--c-sunken)]',
                )}
              >
                <span className="relative">
                  <Avatar t={t} />
                  <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-[var(--c-pane)]" style={{ background: DOT[s.tone] }} aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <UserText className={cn('min-w-0 flex-1 font-medium', !t.enabled && 'text-[var(--c-faint)]')}>{t.name}</UserText>
                    <span className="shrink-0 text-[11px] text-[var(--c-faint)] tabular-nums">
                      <Time iso={t.last_activity} relative />
                    </span>
                  </span>
                  <UserText fallback={s.label} className="text-[13px] text-[var(--c-mute)]">
                    {t.purpose}
                  </UserText>
                </span>
                <span className="sr-only">{s.label}</span>
              </button>
            </li>
          )
        })}
        {f.shown.length === 0 && <li className="px-3 py-2 text-[var(--c-mute)]">No agent matches.</li>}
      </ul>
    </>
  )
}

function Bubble({ m }: { m: Message }) {
  const me = !m.from_bot
  return (
    <div
      className={cn(
        'flex max-w-[min(68ch,88%)] min-w-0 flex-col gap-1 rounded-[20px] px-3.5 py-2 [overflow:clip] [overflow-clip-margin:0.2em]',
        me ? 'bubble-me self-end rounded-br-md bg-[var(--c-accent)] text-[var(--c-accent-ink)]' : 'self-start rounded-bl-md bg-[var(--c-sunken)]',
        m.attachments.length > 0 && 'w-[min(24rem,100%)]',
      )}
    >
      {m.body.trim() && <FoldedBody body={m.body} toggleClassName="text-[13px]" />}
      {m.attachments.length > 0 && (
        <ul className="grid gap-1.5">
          {m.attachments.slice(0, 4).map((f, i) => (
            <li key={i} className="min-w-0 text-[var(--c-ink)]">
              <FilePreview file={f} className="bg-[var(--c-pane)]" />
            </li>
          ))}
        </ul>
      )}
      <time className={cn('self-end text-[11px] tabular-nums', me ? 'opacity-75' : 'text-[var(--c-faint)]')}>{clock(m.sent_at)}</time>
    </div>
  )
}

function Conversation({ messages, topicName }: { messages: Message[]; topicName: string }) {
  const c = useDraftSend()
  const [mode, setMode] = useState('Auto')
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-4 md:px-6">
        {messages.length === 0 && c.sent.length === 0 ? (
          <div className="m-auto max-w-xs text-center text-[var(--c-mute)]">
            <p className="font-medium text-[var(--c-ink)]">Nothing here yet</p>
            <p className="text-[13px]">
              Messages with <UserText>{topicName}</UserText> show up here. Write the first one below.
            </p>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
        {c.sent.map((text, i) => (
          <div key={i} className="bubble-me max-w-[88%] self-end rounded-[20px] rounded-br-md bg-[var(--c-accent)] px-3.5 py-2 text-[var(--c-accent-ink)]">
            <UserText lines="all">{text}</UserText>
            <span className="block text-right text-[11px] opacity-75">Prototype: not sent</span>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-[var(--c-line)] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:p-3">
        <div className="flex items-end gap-2">
          <button type="button" aria-label="Attach files" className="grid size-11 shrink-0 place-items-center rounded-full text-[var(--c-mute)] transition-[background-color] duration-150 hover:bg-[var(--c-sunken)]">
            <PaperclipIcon className="size-5" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col rounded-[22px] bg-[var(--c-sunken)] focus-within:shadow-[0_0_0_2px_var(--c-accent)]">
            <label htmlFor="c-compose" className="sr-only">
              Message
            </label>
            <textarea
              id="c-compose"
              rows={1}
              value={c.draft}
              onChange={(e) => c.setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  c.send()
                }
              }}
              placeholder="Message"
              className="block max-h-40 min-h-11 w-full resize-none bg-transparent px-4 py-2.5 text-base outline-none [field-sizing:content] placeholder:text-[var(--c-faint)]"
            />
            <div role="radiogroup" aria-label="Mode" className="flex gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {['Auto', 'Fast', 'Think', 'Heavy', 'DeepSearch'].map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    'h-7 shrink-0 rounded-full px-2.5 text-[12px] font-medium transition-[background-color,color] duration-150 pointer-coarse:h-9',
                    mode === m ? 'bg-[var(--c-accent)] text-[var(--c-accent-ink)]' : 'text-[var(--c-mute)] hover:bg-[var(--c-pane)]',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={c.send}
            disabled={!c.draft.trim()}
            aria-label="Send message"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--c-accent)] text-[var(--c-accent-ink)] transition-[opacity,scale] duration-150 active:scale-[0.96] disabled:opacity-40"
          >
            <ArrowUpIcon className="size-5" />
          </button>
        </div>
      </div>
    </>
  )
}

function Details({ topic, overview, onClose }: { topic?: Topic; overview?: ReturnType<typeof useComposite>['overview']; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-6 p-5">
      <div className="flex items-center justify-between md:hidden">
        <span className="font-semibold">Details</span>
        <button type="button" onClick={onClose} aria-label="Back to chat" className="-mr-2 grid size-11 place-items-center">
          <XIcon className="size-5" />
        </button>
      </div>
      {topic && (
        <section aria-labelledby="c-topic" className="flex flex-col items-center gap-2 text-center">
          <Avatar t={topic} size="size-16 text-2xl" />
          <h2 id="c-topic" className="w-full text-[17px] font-semibold">
            <UserText>{topic.name}</UserText>
          </h2>
          <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--c-mute)]">
            <span className="size-2 rounded-full" style={{ background: DOT[topicStatus(topic).tone] }} aria-hidden />
            {topicStatus(topic).label}
          </span>
        </section>
      )}
      {topic && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[13px]">
          <dt className="text-[var(--c-mute)]">Purpose</dt>
          <dd>
            <UserText lines={3} fallback="Not set yet">
              {topic.purpose}
            </UserText>
          </dd>
          <dt className="text-[var(--c-mute)]">Mode</dt>
          <dd className="capitalize">{topic.mode}</dd>
          <dt className="text-[var(--c-mute)]">Voice</dt>
          <dd>{topic.voice_replies ? `On · ${topic.voice}` : 'Off'}</dd>
          <dt className="text-[var(--c-mute)]">Messages</dt>
          <dd className="tabular-nums" title={exact(topic.messages)}>
            {exact(topic.messages)}
          </dd>
        </dl>
      )}
      {topic && (
        <Link to="/topics/$id" params={{ id: topic.id }} className="flex h-11 items-center justify-center rounded-full bg-[var(--c-sunken)] text-[13px] font-medium transition-[background-color] duration-150 hover:bg-[var(--c-accent-soft)]">
          Open topic settings
        </Link>
      )}
      {overview && (
        <section aria-labelledby="c-ws" className="flex flex-col gap-2 border-t border-[var(--c-line)] pt-5">
          <h2 id="c-ws" className="text-[12px] font-medium text-[var(--c-mute)]">
            Workspace
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Answering', `${overview.enabled_conversations}/${overview.conversations}`, false],
              ['Threads', compact(overview.active_threads), false],
              ['Messages', compact(overview.messages), false],
              ['Errors · 24 h', exact(overview.errors_last_24h), overview.errors_last_24h > 0],
            ].map(([label, value, alarm]) => (
              <Link key={String(label)} to={label === 'Errors · 24 h' ? '/logs' : '/'} className="flex flex-col gap-0.5 rounded-xl bg-[var(--c-sunken)] px-3 py-2.5 transition-[background-color] duration-150 hover:bg-[var(--c-accent-soft)]">
                <span className="text-[11px] text-[var(--c-mute)]">{label}</span>
                <span className={cn('text-[17px] font-semibold tabular-nums', alarm && 'text-[var(--c-off)]')}>{value}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
