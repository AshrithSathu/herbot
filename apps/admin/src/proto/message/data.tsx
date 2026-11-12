// Throwaway prototype data (emil-prototype): one real message from each of
// topic 2's twenty stress blocks (the seed stores every kind of hostile body
// as a block of 300 ids), so every variant meets the same worst content.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { getMessages, type Message } from '../../api'
import { topicsQuery } from '../../queries'

export const TOPIC = 2
const BLOCK = 300

export type Entry =
  | { kind: 'message'; message: Message }
  | { kind: 'failed'; id: string; body: string; error: string; sentAt: string }
  | { kind: 'thinking'; id: string; since: number }

export function useWorstConversation() {
  const topics = useQuery(topicsQuery)
  const topic = (topics.data ?? []).find((t) => t.id === TOPIC)
  const blocks = topic ? Math.min(Math.ceil(topic.messages / BLOCK), 20) : 0
  const pages = useQueries({
    queries: Array.from({ length: blocks }, (_, k) => ({
      queryKey: ['proto-message-block', TOPIC, k],
      queryFn: () => getMessages({ data: { id: TOPIC, before: BLOCK * (k + 1) + 1, limit: 1 } }),
      staleTime: Infinity,
    })),
  })
  const messages = useMemo(
    () => pages.flatMap((p) => p.data?.messages ?? []).sort((a, b) => a.id - b.id),
    [pages],
  )
  // Two local states every variant must design: a send that failed, and an
  // agent still thinking (its timer starts when the page mounts).
  const [since] = useState(() => Date.now())
  const entries = useMemo<Entry[]>(() => {
    const last = messages.at(-1)?.sent_at ?? new Date().toISOString()
    return [
      ...messages.map((message) => ({ kind: 'message' as const, message })),
      {
        kind: 'failed',
        id: 'failed-1',
        body: 'Can you summarise the last three answers in one table, with sources? مع المصادر من فضلك.',
        error: 'E-4005: Telegram is disabled; chat and topic creation need the running bot',
        sentAt: last,
      },
      { kind: 'thinking', id: 'thinking-1', since },
    ]
  }, [messages, since])
  return {
    topic,
    entries,
    pending: topics.isPending || pages.some((p) => p.isPending),
    error: topics.error ?? pages.find((p) => p.error)?.error ?? null,
  }
}

/** Seconds since `since`, ticking once a second; frozen while the tab is hidden. */
export function useElapsed(since: number): string {
  const [now, setNow] = useState(() => Date.now())
  const id = useRef<ReturnType<typeof setInterval>>(undefined)
  useEffect(() => {
    const start = () => {
      clearInterval(id.current)
      id.current = setInterval(() => setNow(Date.now()), 1000)
    }
    const onVisibility = () => (document.hidden ? clearInterval(id.current) : start())
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(id.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** Long enough to fold: many characters or many lines. */
export function isLong(body: string, chars = 1200, lines = 16): boolean {
  return body.length > chars || body.split('\n').length > lines
}

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
