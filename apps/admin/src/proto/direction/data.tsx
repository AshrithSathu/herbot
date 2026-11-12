// Shared, real data for every direction variant (throwaway prototype code).
import { useMemo, useState, type ReactNode } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { getMessages, type Message, type Topic } from '../../api'
import { overviewQuery, topicsQuery } from '../../queries'
import { RichMessage } from '@/components/rich-message'
import { cn } from '@/lib/utils'

const CHAT_TOPIC = 2

/** Worst-content picks from topic 2's real history. */
const WANTED: { key: string; test: (m: Message) => boolean }[] = [
  { key: 'arabic', test: (m) => m.body.includes('مرحبا') },
  { key: 'code', test: (m) => m.body.startsWith('```typescript') },
  { key: 'table', test: (m) => m.body.startsWith('| Column') },
  { key: 'unbroken', test: (m) => /\S{1200,}/.test(m.body) && !m.body.includes(' ') },
  { key: 'attachments', test: (m) => m.attachments.length > 3 },
  { key: 'short', test: (m) => m.body.trim() === 'ok' },
  { key: 'heading', test: (m) => m.body.startsWith('# Heading') },
]

/** The topics excerpt: the first eleven (General, Arabic, Chinese, emoji,
 * HTML, Markdown, Zalgo, one letter, a 90-char word, …) plus the
 * 128-character name. */
function excerpt(all: Topic[]): Topic[] {
  const first = all.slice(0, 11)
  const longest = all.find((t) => t.name.length >= 128 && !first.includes(t))
  return longest ? [...first, longest] : first
}

export function useComposite() {
  const topics = useQuery(topicsQuery)
  const overview = useQuery(overviewQuery)
  // The stress seed stores each kind of message as a block of 300 ids, so
  // sample two from the end of every block across the topic's history.
  const topic = (topics.data ?? []).find((t) => t.id === CHAT_TOPIC)
  const blocks = topic ? Math.ceil(topic.messages / 300) : 0
  const samples = useQueries({
    queries: Array.from({ length: Math.min(blocks, 24) }, (_, k) => ({
      queryKey: ['proto-direction-sample', CHAT_TOPIC, k],
      queryFn: () => getMessages({ data: { id: CHAT_TOPIC, before: 300 * (k + 1) + 1, limit: 2 } }),
      staleTime: Infinity,
    })),
  })
  const loaded = useMemo(() => samples.flatMap((q) => q.data?.messages ?? []), [samples])
  const picks = useMemo(() => {
    const out: Message[] = []
    for (const w of WANTED) {
      const m = loaded.find(w.test)
      if (m && !out.includes(m)) out.push(m)
    }
    return out.sort((a, b) => a.id - b.id)
  }, [loaded])
  const history = { isPending: samples.some((q) => q.isPending), error: samples.find((q) => q.error)?.error ?? null }
  const all = topics.data ?? []
  return {
    topics: all,
    excerpt: excerpt(all),
    chatTopic: all.find((t) => t.id === CHAT_TOPIC),
    overview: overview.data,
    messages: picks,
    pending: topics.isPending || overview.isPending || history.isPending,
    error: topics.error ?? overview.error ?? history.error,
  }
}

/** Long bodies fold (like production), so a 120-line code block can't bury
 * the composite; the toggle shows the rest. */
export function FoldedBody({ body, className, toggleClassName }: { body: string; className?: string; toggleClassName?: string }) {
  const long = body.length > 900 || body.split('\n').length > 14
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className={cn('relative min-w-0', long && !open && 'max-h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]')}>
        <RichMessage body={body} />
      </div>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn('relative w-fit text-sm font-medium before:absolute before:-inset-x-2 before:-inset-y-3 hover:underline', toggleClassName)}
        >
          {open ? 'Show less' : `Show all ${body.length.toLocaleString('en-GB')} characters`}
        </button>
      )}
    </div>
  )
}

/** Case- and accent-insensitive filter, as in the production sidebar. */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

export function useFilter(all: Topic[]) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const w = fold(q.trim())
    return w ? all.filter((t) => fold(t.name).includes(w)) : all
  }, [all, q])
  return { q, setQ, shown }
}

/** A stable hue per topic, for monograms. */
export function hueOf(id: number): number {
  return (id * 137.508) % 360
}

/** First visible letter of a name (skips marks and spaces). */
export function initial(name: string): string {
  const ch = Array.from(name.normalize('NFC').replace(/[\p{M}\s]/gu, ''))[0]
  return (ch ?? '#').toLocaleUpperCase()
}

export function Loading({ children }: { children?: ReactNode }) {
  return <div className="grid h-dvh place-items-center text-sm opacity-70">{children ?? 'Loading the stress data…'}</div>
}

/** Prototype-only "send": shows the message as queued locally, never sends. */
export function useDraftSend() {
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState<string[]>([])
  return {
    draft,
    setDraft,
    sent,
    send: () => {
      if (!draft.trim()) return
      setSent((s) => [...s, draft.trim()])
      setDraft('')
    },
  }
}
