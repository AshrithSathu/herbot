// ⌘K / Ctrl+K: jump to a page, an agent, a message, or run an action. An
// accelerator: the rail stays the visible way around (docs/design/
// DECISIONS.md, "Navigation"; "Search" adds message search with "See every
// match"). The Shell owns the one hotkey; pages open it through
// useShell().openPalette(query). It opens dozens of times a day, so it
// doesn't animate.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CornerDownLeftIcon, HashIcon, MessageCircleIcon, MessageSquareTextIcon, SearchIcon, type LucideIcon } from 'lucide-react'
import { searchMessages, type SearchHit, type Topic } from '../../api'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { fold } from './agent-list'
import { PAGES, type PagePath } from './pages'

export type PaletteAction = { id: string; label: string; icon: LucideIcon; run: () => void }

type Item =
  | { kind: 'page'; id: string; label: string; icon: LucideIcon; to: PagePath }
  | { kind: 'agent'; id: string; label: string; topic: Topic }
  | { kind: 'message'; id: string; label: string; hit: SearchHit }
  | { kind: 'all'; id: string; label: string; q: string }
  | { kind: 'action'; id: string; label: string; icon: LucideIcon; run: () => void }

const GROUP: Record<Item['kind'], string> = { page: 'Pages', action: 'Actions', agent: 'Agents', message: 'Messages', all: 'Messages' }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  topics: Topic[]
  actions?: PaletteAction[]
  /** Text to start with (a page opening the palette with its query). */
  initialQuery?: string
}

/** The one ⌘K (macOS) / Ctrl+K (elsewhere) listener, owned by the Shell. */
export function usePaletteHotkey(toggle: () => void) {
  const ref = useRef(toggle)
  ref.current = toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        ref.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}

/** "…the ⟦match⟧ here…" (the API's highlight markers) as plain text. */
function plain(snippet: string): string {
  return snippet.replace(/[⟦⟧]/g, '')
}

const MESSAGE_HITS = 6

/** `value`, once it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return settled
}

export function CommandPalette({ open, onOpenChange, topics, actions = [], initialQuery = '' }: Props) {
  const navigate = useNavigate()
  const [q, setQ] = useState(initialQuery)
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (open) setQ(initialQuery)
  }, [open, initialQuery])

  // Messages once there's something to search: 300 ms after typing stops, and
  // only from two characters (one letter matches everything). Pages, agents
  // and actions filter locally on every keystroke.
  const typed = useDebounced(q.trim(), 300)
  const messages = useQuery({
    queryKey: ['palette-search', typed],
    queryFn: () => searchMessages({ data: { q: typed } }),
    enabled: open && typed.length >= 2,
    staleTime: 30_000,
    // One quick retry, then say it failed (not seconds of backoff).
    retry: 1,
  })

  const items = useMemo<Item[]>(() => {
    const w = fold(q.trim())
    const match = (s: string) => !w || fold(s).includes(w)
    const pages: Item[] = PAGES.filter((p) => match(p.label)).map((p) => ({ kind: 'page', id: `page-${p.to}`, label: p.label, icon: p.icon, to: p.to }))
    const acts: Item[] = actions.filter((a) => match(a.label)).map((a) => ({ kind: 'action', ...a, id: `action-${a.id}` }))
    // Agents only once you type: 220 names would bury the pages.
    const agents: Item[] = w
      ? topics
          .filter((t) => match(t.name))
          .slice(0, 50)
          .map((t) => ({ kind: 'agent', id: `agent-${t.id}`, label: t.name, topic: t }))
      : []
    const hits: Item[] =
      typed.length >= 2 && messages.data
        ? [
            ...messages.data.slice(0, MESSAGE_HITS).map((hit): Item => ({ kind: 'message', id: `message-${hit.id}`, label: plain(hit.snippet), hit })),
            ...(messages.data.length > 0 ? [{ kind: 'all', id: 'all', label: 'See every match', q: typed } as Item] : []),
          ]
        : []
    return [...pages, ...acts, ...agents, ...hits]
  }, [q, typed, topics, actions, messages.data])

  useEffect(() => setIndex(0), [q])
  useEffect(() => {
    // Keep the highlighted option in view (no smooth scroll: keyboard speed).
    // Statement body: scrollIntoView may return a promise, never return it.
    list.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  function run(item: Item | undefined) {
    if (!item) return
    onOpenChange(false)
    if (item.kind === 'page') void navigate({ to: item.to })
    else if (item.kind === 'agent') void navigate({ to: '/topics/$id', params: { id: item.topic.id } })
    else if (item.kind === 'message') void navigate({ to: '/topics/$id', params: { id: item.hit.conversation_id }, search: { message: item.hit.id } })
    else if (item.kind === 'all') void navigate({ to: '/search', search: { q: item.q } })
    else item.run()
  }

  const active = items[index]
  const wantsMessages = q.trim().length >= 2
  const settling = wantsMessages && q.trim() !== typed
  const searching = wantsMessages && (settling || (messages.isFetching && !messages.data))
  const failed = wantsMessages && !settling && messages.isError
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[oklch(0_0_0/0.35)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 top-0 z-50 flex max-h-[100dvh] flex-col bg-pane text-ink shadow-raised outline-none md:top-[12vh] md:left-1/2 md:w-[min(36rem,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-2xl"
        >
          <Dialog.Title className="sr-only">Go to a page, an agent, a message or an action</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-line px-4 pt-[env(safe-area-inset-top)]">
            <SearchIcon aria-hidden className="size-4 shrink-0 text-faint" />
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls="hb-palette-list"
              aria-activedescendant={active ? `hb-palette-${active.id}` : undefined}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setIndex((i) => Math.min(i + 1, items.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setIndex((i) => Math.max(i - 1, 0))
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  run(active)
                }
              }}
              placeholder="Pages, agents, messages, actions"
              autoComplete="off"
              spellCheck={false}
              dir="auto"
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint pointer-fine:text-[15px]"
            />
            <kbd className="hidden rounded border border-line px-1.5 font-sans text-[11px] text-mute md:inline">Esc</kbd>
          </div>
          <ul id="hb-palette-list" ref={list} role="listbox" aria-label="Results" aria-busy={searching || undefined} className="scroller min-h-0 flex-1 overflow-y-auto p-1.5 md:max-h-[55vh]">
            {items.length === 0 && !searching && !failed && <li className="px-3 py-6 text-center text-[13.5px] text-mute">Nothing matches that.</li>}
            {items.map((item, i) => {
              const Icon =
                item.kind === 'agent'
                  ? item.topic.is_general
                    ? MessageCircleIcon
                    : HashIcon
                  : item.kind === 'message' || item.kind === 'all'
                    ? MessageSquareTextIcon
                    : item.icon
              const prev = items[i - 1]
              const showGroup = !prev || GROUP[prev.kind] !== GROUP[item.kind]
              return (
                <li key={item.id} role="presentation">
                  {showGroup && <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-[0.06em] text-mute uppercase">{GROUP[item.kind]}</p>}
                  <div
                    id={`hb-palette-${item.id}`}
                    role="option"
                    aria-selected={i === index}
                    data-i={i}
                    onPointerMove={() => setIndex(i)}
                    onClick={() => run(item)}
                    className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-[14px]', i === index && 'bg-sunken')}
                  >
                    <Icon aria-hidden className="size-4 shrink-0 text-mute" />
                    {item.kind === 'agent' ? (
                      <UserText className="min-w-0 flex-1">{item.label}</UserText>
                    ) : item.kind === 'message' ? (
                      <span className="flex min-w-0 flex-1 flex-col">
                        <UserText className="text-[12px] text-mute">{item.hit.name}</UserText>
                        <UserText className="min-w-0">{item.label}</UserText>
                      </span>
                    ) : (
                      <span className={cn('min-w-0 flex-1 truncate', item.kind === 'all' && 'font-medium text-accent-strong')}>{item.label}</span>
                    )}
                    {i === index && <CornerDownLeftIcon aria-hidden className="size-3.5 shrink-0 text-faint" />}
                  </div>
                </li>
              )
            })}
            {searching && <li className="px-3 py-2 text-[12.5px] text-mute">Searching messages…</li>}
          </ul>
          {/* A failed message search never reads as "nothing matches": it says
              so, keeps the page and agent results above, and offers Retry. */}
          {failed && (
            <div role="alert" className="flex min-h-11 items-center justify-between gap-3 border-t border-line px-4 py-1.5 text-[13px] text-mute">
              <span className="min-w-0">Couldn’t search messages.</span>
              <button
                type="button"
                onClick={() => void messages.refetch()}
                className="h-9 shrink-0 rounded-md px-2.5 font-medium text-ink hover:bg-sunken pointer-coarse:h-11"
              >
                Retry
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
