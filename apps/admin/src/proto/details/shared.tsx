// Shared, real-data scaffolding for the details-pane prototype (throwaway).
// Edits are simulated locally so every control works without touching the
// stress database; the server's own rules (purpose validation, token-like
// strings) decide what fails.
import { useMemo, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { AlertDialog as AD } from 'radix-ui'
import { ChevronLeftIcon, InfoIcon } from 'lucide-react'
import type { Topic, TopicDetail } from '../../api'
import { charCount, compact, exact, purposeProblem, topicStatus } from '../../format'
import { messagesQuery, topicQuery, topicsQuery } from '../../queries'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import '../tokens.css'

/** Worst cases, in order: HTML name + 8,000-char purpose + 9.9M messages;
 * Arabic name and purpose; Markdown name + unbroken purpose + 9.9M; Chinese
 * name asking its purpose; emoji name switched off; General. */
export const PICKS = [5, 2, 6, 3, 4, 1]

export const MODES = [
  ['fast', 'Fast', 'Quick answers, light reasoning'],
  ['auto', 'Auto', 'Thinks as hard as the question needs'],
  ['expert', 'Expert', 'Thinks carefully before every answer'],
  ['heavy', 'Heavy', 'Several sub-agents, best answer wins'],
] as const

export const VOICES = [
  ['alloy', 'Balanced'], ['ash', 'Grounded'], ['ballad', 'Expressive'], ['coral', 'Warm'],
  ['echo', 'Clear'], ['fable', 'Storytelling'], ['onyx', 'Deep'], ['nova', 'Bright'],
  ['sage', 'Calm'], ['shimmer', 'Gentle'], ['verse', 'Versatile'], ['marin', 'Conversational'], ['cedar', 'Steady'],
] as const

export const modeLabel = (m: string) => MODES.find(([v]) => v === m)?.[1] ?? m
export const voiceLabel = (v: string) => VOICES.find(([k]) => k === v)?.[1] ?? v

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const TOKENISH = /\b(sk-[A-Za-z0-9]{8,}|\d{8,10}:AA[\w-]{20,}|hb_[a-f0-9]{16,})/

/** The topic as the pane shows it: real data, plus local edits. */
export type Sim = Topic & { agents_md: string | null; agents_md_path: string | null; thread_id: string | null }
export type Actions = {
  setPurpose: (p: string) => Promise<void>
  setMode: (m: string) => Promise<void>
  setVoiceReplies: (on: boolean) => Promise<void>
  setVoice: (v: string) => Promise<void>
  setEnabled: (on: boolean) => Promise<void>
  cleanSlate: () => Promise<void>
  forget: () => Promise<void>
}

export function useSimTopic(id: number): { topic: Sim | null; error: Error | null; actions: Actions } {
  const detail = useQuery({ ...topicQuery(id), refetchInterval: false })
  const [edits, setEdits] = useState<Record<number, Partial<Sim>>>({})
  const base = detail.data as TopicDetail | undefined
  const topic = useMemo<Sim | null>(
    () =>
      base
        ? { ...base.conversation, agents_md: base.agents_md, agents_md_path: base.agents_md_path, thread_id: base.thread_id, ...edits[id] }
        : null,
    [base, edits, id],
  )
  const patch = (p: Partial<Sim>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...p } }))
  const actions: Actions = {
    async setPurpose(p) {
      const problem = purposeProblem(p)
      await wait(650)
      if (problem) throw new Error(problem)
      if (TOKENISH.test(p)) throw new Error('E-4107: secrets and token-like strings can’t be stored in a purpose.')
      patch({ purpose: p.trim(), setup_state: 'ready' })
    },
    async setMode(m) {
      await wait(450)
      patch({ mode: m })
    },
    async setVoiceReplies(on) {
      await wait(450)
      patch({ voice_replies: on })
    },
    async setVoice(v) {
      await wait(450)
      patch({ voice: v })
    },
    async setEnabled(on) {
      await wait(500)
      patch({ enabled: on })
    },
    async cleanSlate() {
      await wait(900)
      patch({ messages: 0, last_activity: null, thread_link: null, thread_id: null })
    },
    async forget() {
      await wait(900)
      patch({ messages: 0, last_activity: null, thread_link: null, thread_id: null, purpose: null, setup_state: 'new', agents_md: null })
    },
  }
  return { topic, error: detail.error, actions }
}

export const STATUS_DOT = {
  danger: 'bg-[var(--c-off)]',
  success: 'bg-[var(--c-ok)]',
  warning: 'bg-[var(--c-warn)]',
  muted: 'bg-[var(--c-faint)]',
} as const

export function Status({ topic, className }: { topic: Pick<Topic, 'enabled' | 'setup_state' | 'purpose'>; className?: string }) {
  const s = topicStatus(topic)
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px] text-[var(--c-mute)]', className)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[s.tone])} aria-hidden />
      {s.label}
    </span>
  )
}

/** A quiet monogram: first letter of the name, or # when it has none. */
export function Monogram({ name, size = 40 }: { name: string; size?: number }) {
  const first = Array.from(name.normalize('NFC').replace(/[\p{M}\s<>*`#[\]()]/gu, ''))[0] ?? '#'
  return (
    <span
      aria-hidden
      dir="auto"
      className="grid shrink-0 place-items-center overflow-clip rounded-full bg-[var(--c-sunken)] font-medium text-[var(--c-mute)] shadow-[inset_0_0_0_var(--hair)_var(--c-line)] select-none"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {first}
    </span>
  )
}

export function count(n: number) {
  return <span className="tabular-nums" title={exact(n)}>{compact(n)}</span>
}

export { charCount, exact }

/** The three-pane shell the pane is judged in: a curated agent list, the
 * conversation (real recent messages), and the variant's details pane. On a
 * phone one pane shows at a time: details by default, with a way back. */
export function Frame({ selected, onSelect, pane }: { selected: number; onSelect: (id: number) => void; pane: ReactNode }) {
  const topics = useQuery(topicsQuery)
  const picks = PICKS.map((id) => topics.data?.find((t) => t.id === id)).filter((t): t is Topic => Boolean(t))
  const current = picks.find((t) => t.id === selected)
  const [phoneView, setPhoneView] = useState<'details' | 'chat'>('details')

  return (
    <div className="hb fixed inset-0 z-[45] antialiased md:grid md:grid-cols-[minmax(0,1fr)_340px] md:gap-2 md:p-2 min-[68.75rem]:grid-cols-[260px_minmax(0,1fr)_360px]">
      <nav aria-label="Agents" className="hidden min-h-0 flex-col overflow-hidden rounded-xl bg-[var(--c-pane)] shadow-[var(--c-raised)] min-[68.75rem]:flex">
        <p className="px-4 pt-4 pb-2 text-[13px] font-medium text-[var(--c-mute)]">Agents · worst cases</p>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {picks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t.id)}
                aria-current={t.id === selected ? 'true' : undefined}
                className={cn(
                  'flex h-14 w-full min-w-0 items-center gap-3 rounded-lg px-2 text-left transition-[background-color] duration-150 ease-out',
                  t.id === selected ? 'bg-[var(--c-accent-soft)]' : 'hover:bg-[var(--c-sunken)]',
                )}
              >
                <Monogram name={t.name} size={36} />
                <span className="grid min-w-0 grid-cols-[minmax(0,1fr)] flex-1 gap-0.5">
                  <UserText className="text-[14px] font-medium">{t.name}</UserText>
                  <Status topic={t} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section
        aria-label="Conversation"
        className={cn('min-h-0 flex-col overflow-hidden bg-[var(--c-pane)] md:flex md:rounded-xl md:shadow-[var(--c-raised)]', phoneView === 'chat' ? 'flex h-dvh md:h-auto' : 'hidden')}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--c-line)] px-4">
          <UserText className="min-w-0 flex-1 text-[15px] font-semibold">{current?.name}</UserText>
          <button
            type="button"
            onClick={() => setPhoneView('details')}
            aria-label="Topic details"
            className="-mr-2 grid size-11 place-items-center rounded-full text-[var(--c-mute)] hover:bg-[var(--c-sunken)] md:hidden"
          >
            <InfoIcon className="size-5" aria-hidden />
          </button>
        </header>
        <Recent id={selected} />
        <SwitchTopic picks={picks} selected={selected} onSelect={onSelect} />
      </section>

      <aside
        aria-label="Topic details"
        className={cn('min-h-0 flex-col overflow-hidden bg-[var(--c-pane)] md:flex md:rounded-xl md:shadow-[var(--c-raised)]', phoneView === 'details' ? 'flex h-dvh md:h-auto' : 'hidden')}
      >
        <div className="flex h-12 shrink-0 items-center border-b border-[var(--c-line)] px-1 md:hidden">
          <button
            type="button"
            onClick={() => setPhoneView('chat')}
            className="flex h-11 items-center gap-1 rounded-lg pr-3 pl-1 text-[15px] text-[var(--c-accent)]"
          >
            <ChevronLeftIcon className="size-5" aria-hidden />
            Chat
          </button>
        </div>
        {pane}
      </aside>
    </div>
  )
}

/** Below the wide breakpoint the agent list is hidden; switch worst cases here. */
function SwitchTopic({ picks, selected, onSelect }: { picks: Topic[]; selected: number; onSelect: (id: number) => void }) {
  return (
    <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-[var(--c-line)] p-2 min-[68.75rem]:hidden">
      {picks.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          aria-pressed={t.id === selected}
          className={cn(
            'h-11 max-w-40 shrink-0 rounded-full px-3 text-[13px]',
            t.id === selected ? 'bg-[var(--c-accent-soft)] text-[var(--c-ink)]' : 'text-[var(--c-mute)] hover:bg-[var(--c-sunken)]',
          )}
        >
          <UserText>{t.name}</UserText>
        </button>
      ))}
    </div>
  )
}

function Recent({ id }: { id: number }) {
  const q = useInfiniteQuery({ ...messagesQuery(id), select: (d) => d.pages[0]?.messages.slice(-6) ?? [] })
  const messages = q.data ?? []
  return (
    <ol className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-y-auto p-4">
      {q.isPending && <li className="text-[13px] text-[var(--c-faint)]">Loading the conversation…</li>}
      {!q.isPending && messages.length === 0 && (
        <li className="m-auto text-center text-[14px] text-[var(--c-mute)]">No messages in this topic yet.</li>
      )}
      {messages.map((m) => (
        <li
          key={m.id}
          className={cn(
            'max-w-[80%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed',
            m.from_bot ? 'self-start bg-[var(--c-sunken)]' : 'self-end bg-[var(--c-accent)] text-[var(--c-accent-ink)]',
          )}
        >
          <UserText lines={3} as="p" fallback="(attachment)">{m.body}</UserText>
        </li>
      ))}
    </ol>
  )
}

/** A Radix alert dialog in the prototype's materials (portalled, so it
 * carries .hb itself). */
export function Confirm({ open, onOpenChange, title, body, action, pending, error, onConfirm }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  body: ReactNode
  action: string
  pending: boolean
  error: string | null
  onConfirm: () => void
}) {
  return (
    <AD.Root open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 motion-reduce:animate-none" />
        <AD.Content className="hb fixed top-1/2 left-1/2 z-50 grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl bg-[var(--c-pane)] p-6 shadow-[var(--c-raised)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:duration-200 motion-reduce:animate-none">
          <AD.Title className="text-[17px] font-semibold">{title}</AD.Title>
          <AD.Description className="text-[14px] leading-relaxed text-[var(--c-mute)]">{body}</AD.Description>
          {error && <p role="alert" className="text-[14px] text-[var(--c-off)]">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AD.Cancel disabled={pending} className="h-11 rounded-lg px-4 text-[14px] font-medium hover:bg-[var(--c-sunken)] sm:h-9">
              Cancel
            </AD.Cancel>
            <button
              type="button"
              disabled={pending}
              onClick={onConfirm}
              className="h-11 rounded-lg bg-[var(--c-off)] px-4 text-[14px] font-medium text-white transition-[scale] duration-150 ease-out active:scale-[0.97] disabled:opacity-70 sm:h-9"
            >
              {pending ? 'Working…' : action}
            </button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  )
}

/** One async action's lifecycle: idle → pending → done | failed. */
export function useAction() {
  const [state, setState] = useState<{ pending: boolean; error: string | null; done: boolean }>({ pending: false, error: null, done: false })
  async function run(fn: () => Promise<void>) {
    setState({ pending: true, error: null, done: false })
    try {
      await fn()
      setState({ pending: false, error: null, done: true })
      return true
    } catch (e) {
      setState({ pending: false, error: e instanceof Error ? e.message : String(e), done: false })
      return false
    }
  }
  return { ...state, run, reset: () => setState({ pending: false, error: null, done: false }) }
}
