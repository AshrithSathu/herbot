// Variant 3 "Palette" — entry-point axis: search has no page of its own. It
// lives in ⌘K, which already finds pages and agents; typing there also finds
// messages, and "See every match" opens the full results in the main pane.
// The Search page is only a door to the palette plus those full results.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CornerDownLeftIcon, HashIcon, ListIcon, MessageCircleIcon, MessageSquareTextIcon, SearchIcon } from 'lucide-react'
import type { Topic } from '../../../api'
import { topicsQuery } from '../../../queries'
import { fold } from '@/components/hb/agent-list'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { PAGES, type Page } from '@/components/hb/pages'
import { STRETCH, ThreadList } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { PageFrame } from '../logs/frame'
import { JumpLink, MAX_QUERY, ResultsFooter, Snippet, TopicLabel, useSearch, useTopicNames, type SearchHit } from './shared'

type Item =
  | { kind: 'message'; id: string; hit: SearchHit }
  | { kind: 'agent'; id: string; topic: Topic }
  | { kind: 'page'; id: string; page: Page }
  | { kind: 'all'; id: string }

export function PaletteVariant() {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState('')
  // ?q= shows full results after a reload.
  useEffect(() => {
    setResults(new URLSearchParams(location.search).get('q')?.trim() ?? '')
  }, [])
  // ⌘K / Ctrl+K opens this palette. Captured on window so the shell's own
  // palette (same key) doesn't open as well.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  function showAll(q: string) {
    setResults(q)
    const url = new URL(location.href)
    url.searchParams.set('q', q)
    history.replaceState(history.state, '', url)
  }

  return (
    <PageFrame>
      <ShellPage
        title="Search"
        description="Search lives in ⌘K with pages and agents. Type there; “See every match” lands here."
        back={<BackToAgents />}
      >
        <LauncherField onOpen={() => setOpen(true)} q={results} />
        {results ? <FullResults q={results} onEdit={() => setOpen(true)} /> : <Recent onPick={(q) => showAll(q)} />}
      </ShellPage>
      <SearchPalette open={open} onOpenChange={setOpen} initial={results} onShowAll={showAll} />
    </PageFrame>
  )
}

/** Looks like a search box; opens the palette. */
function LauncherField({ onOpen, q }: { onOpen: () => void; q: string }) {
  const [mod, setMod] = useState('Ctrl')
  useEffect(() => setMod(/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'), [])
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="flex h-11 w-full items-center gap-2 rounded-lg bg-sunken px-3 text-left text-base text-faint outline-none hover:text-mute focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] md:h-10 md:text-[14px]"
    >
      <SearchIcon aria-hidden className="size-4 shrink-0" />
      {q ? <UserText className="min-w-0 flex-1 text-ink">{q}</UserText> : <span className="min-w-0 flex-1 truncate">Search messages, agents and pages</span>}
      <kbd className="hidden shrink-0 rounded border border-line px-1.5 font-sans text-[11px] text-mute md:inline">{mod} K</kbd>
    </button>
  )
}

/** With no query: example searches, one tap each. */
function Recent({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col gap-2 px-1">
      <p className="text-[13px] text-mute">Try</p>
      <div className="flex flex-wrap gap-1.5">
        {['timeout', '"duplicate key"', 'paragraph', 'نص'].map((q) => (
          <Button key={q} size="sm" onClick={() => onPick(q)}>
            <UserText>{q}</UserText>
          </Button>
        ))}
      </div>
    </div>
  )
}

function FullResults({ q, onEdit }: { q: string; onEdit: () => void }) {
  const { query, hits } = useSearch(q)
  const names = useTopicNames()
  if (query.isPending) return <ListSkeleton rows={8} />
  if (query.isError) return <InPlaceError title="Search failed" error={query.error} onRetry={() => query.refetch()} retrying={query.isRefetching} />
  if (hits.length === 0)
    return (
      <InPlaceEmpty title={`Nothing matches “${q}”`} action={<Button onClick={onEdit}>Search again</Button>}>
        Search matches whole words. Try fewer words, or another spelling.
      </InPlaceEmpty>
    )
  return (
    <div className="flex flex-col gap-2">
      <p className="px-1 text-[13px] text-mute tabular-nums" aria-live="polite">
        {hits.length.toLocaleString('en-GB')}
        {query.hasNextPage ? '+' : ''} {hits.length === 1 ? 'match' : 'matches'} for <UserText className="inline text-ink">{q}</UserText>
      </p>
      <ThreadList
        label="Matches"
        items={hits}
        itemKey={(h) => h.id}
        estimate={104}
        title={(h) => (
          <JumpLink hit={h} className={cn('block min-w-0 outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset', STRETCH)}>
            <TopicLabel topic={names.get(h.conversation_id)} fallback={h.name || `Topic #${h.conversation_id}`} className="text-[14px] font-medium" />
          </JumpLink>
        )}
        body={(h) => <Snippet text={h.snippet} />}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError && query.fetchNextPage()}
        footer={<ResultsFooter query={query} count={hits.length} />}
      />
    </div>
  )
}

/** The ⌘K palette with messages in it: pages and agents as before, plus the
 * newest matching messages and a way to every match. Same look as the kit's
 * CommandPalette; it opens many times a day, so it doesn't animate. */
function SearchPalette({ open, onOpenChange, initial, onShowAll }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial: string
  onShowAll: (q: string) => void
}) {
  const navigate = useNavigate()
  const topics = useQuery(topicsQuery)
  const names = useTopicNames()
  const [q, setQ] = useState('')
  const [settled, setSettled] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (open) {
      setQ(initial)
      setSettled(initial)
    }
  }, [open, initial])
  useEffect(() => {
    const t = setTimeout(() => setSettled(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const { query, hits } = useSearch(open ? settled : '')
  const items = useMemo<Item[]>(() => {
    const w = fold(q.trim())
    if (!w) return PAGES.map((p) => ({ kind: 'page', id: `page-${p.to}`, page: p }))
    const pages: Item[] = PAGES.filter((p) => fold(p.label).includes(w)).map((p) => ({ kind: 'page', id: `page-${p.to}`, page: p }))
    const agents: Item[] = (topics.data ?? [])
      .filter((t) => fold(t.name).includes(w))
      .slice(0, 5)
      .map((t) => ({ kind: 'agent', id: `agent-${t.id}`, topic: t }))
    const messages: Item[] = settled ? hits.slice(0, 6).map((h) => ({ kind: 'message', id: `msg-${h.id}`, hit: h })) : []
    const all: Item[] = settled && hits.length > 0 ? [{ kind: 'all', id: 'all' }] : []
    return [...pages, ...agents, ...messages, ...all]
  }, [q, settled, hits, topics.data])

  useEffect(() => setIndex(0), [items.length, settled])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  function run(item: Item | undefined) {
    if (!item) return
    onOpenChange(false)
    if (item.kind === 'page') void navigate({ to: item.page.to })
    else if (item.kind === 'agent') void navigate({ to: '/topics/$id', params: { id: item.topic.id } })
    else if (item.kind === 'message') void navigate({ to: '/topics/$id', params: { id: item.hit.conversation_id }, search: { message: item.hit.id } })
    else onShowAll(settled)
  }

  const active = items[index]
  const searching = settled !== q.trim() || (query.isFetching && !query.isFetchingNextPage)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[oklch(0_0_0/0.35)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 top-0 z-50 flex max-h-[100dvh] flex-col bg-pane text-ink shadow-raised outline-none md:top-[12vh] md:left-1/2 md:w-[min(40rem,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-2xl"
        >
          <Dialog.Title className="sr-only">Search messages, agents and pages</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-line px-4 pt-[env(safe-area-inset-top)]">
            <SearchIcon aria-hidden className="size-4 shrink-0 text-faint" />
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls="search-palette-list"
              aria-activedescendant={active ? `search-palette-${active.id}` : undefined}
              aria-busy={searching || undefined}
              value={q}
              onChange={(e) => setQ(e.target.value.slice(0, MAX_QUERY))}
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
              placeholder="Search messages, agents and pages"
              autoComplete="off"
              spellCheck={false}
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint md:text-[15px]"
            />
            {searching && <span className="shrink-0 text-[12px] text-faint">Searching…</span>}
            <Dialog.Close className="grid size-9 shrink-0 place-items-center rounded-md text-[12px] text-mute hover:text-ink md:hidden pointer-coarse:size-11">
              Close
            </Dialog.Close>
            <kbd className="hidden rounded border border-line px-1.5 font-sans text-[11px] text-mute md:inline">Esc</kbd>
          </div>
          <ul id="search-palette-list" ref={list} role="listbox" aria-label="Results" className="scroller min-h-0 flex-1 overflow-y-auto p-1.5 md:max-h-[60vh]">
            {items.length === 0 && (
              <li className="px-3 py-6 text-center text-[13.5px] text-mute">
                {searching ? 'Searching messages…' : query.isError ? `Search failed. ${query.error.message}` : 'Nothing matches that.'}
              </li>
            )}
            {items.map((item, i) => {
              const prev = items[i - 1]
              const group = item.kind === 'page' ? 'Pages' : item.kind === 'agent' ? 'Agents' : 'Messages'
              const prevGroup = prev ? (prev.kind === 'page' ? 'Pages' : prev.kind === 'agent' ? 'Agents' : 'Messages') : null
              return (
                <li key={item.id} role="presentation">
                  {group !== prevGroup && (
                    <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-[0.06em] text-mute uppercase">
                      {group}
                      {group === 'Messages' && hits.length > 0 && (
                        <span className="ml-1.5 tracking-normal normal-case tabular-nums">
                          · newest {Math.min(6, hits.length)} of {hits.length}
                          {query.hasNextPage ? '+' : ''}
                        </span>
                      )}
                    </p>
                  )}
                  <div
                    id={`search-palette-${item.id}`}
                    role="option"
                    aria-selected={i === index}
                    data-i={i}
                    onPointerMove={() => setIndex(i)}
                    onClick={() => run(item)}
                    className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-[14px]', i === index && 'bg-sunken')}
                  >
                    {item.kind === 'page' && (
                      <>
                        <item.page.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-mute" />
                        <span className="min-w-0 flex-1 truncate">{item.page.label}</span>
                      </>
                    )}
                    {item.kind === 'agent' && (
                      <>
                        {item.topic.is_general ? <MessageCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-mute" /> : <HashIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-mute" />}
                        <UserText className="min-w-0 flex-1">{item.topic.name}</UserText>
                      </>
                    )}
                    {item.kind === 'message' && (
                      <>
                        <MessageSquareTextIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-mute" />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <TopicLabel topic={names.get(item.hit.conversation_id)} fallback={item.hit.name} className="text-[12.5px] text-mute" />
                          <Snippet text={item.hit.snippet} lines={2} className="text-[13.5px] text-ink" />
                        </span>
                      </>
                    )}
                    {item.kind === 'all' && (
                      <>
                        <ListIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-strong" />
                        <span className="min-w-0 flex-1 font-medium text-accent-strong">
                          See every match for <UserText className="inline">{settled}</UserText>
                        </span>
                      </>
                    )}
                    {i === index && <CornerDownLeftIcon aria-hidden className="mt-1 size-3.5 shrink-0 text-faint" />}
                  </div>
                </li>
              )
            })}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
