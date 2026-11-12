// ⌘K / Ctrl+K: jump to a page, an agent, or run an action. An accelerator:
// the rail stays the visible way around (docs/design/DECISIONS.md,
// "Navigation"). It opens dozens of times a day, so it doesn't animate.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { useNavigate } from '@tanstack/react-router'
import { CornerDownLeftIcon, HashIcon, MessageCircleIcon, SearchIcon, type LucideIcon } from 'lucide-react'
import type { Topic } from '../../api'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { fold } from './agent-list'
import { PAGES, type PagePath } from './pages'

export type PaletteAction = { id: string; label: string; icon: LucideIcon; run: () => void }

type Item =
  | { kind: 'page'; id: string; label: string; icon: LucideIcon; to: PagePath }
  | { kind: 'agent'; id: string; label: string; topic: Topic }
  | { kind: 'action'; id: string; label: string; icon: LucideIcon; run: () => void }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  topics: Topic[]
  actions?: PaletteAction[]
}

/** Opens the palette on ⌘K (macOS) or Ctrl+K (elsewhere). */
export function usePaletteHotkey(setOpen: (fn: (open: boolean) => boolean) => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setOpen])
}

export function CommandPalette({ open, onOpenChange, topics, actions = [] }: Props) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLUListElement>(null)

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
    return [...pages, ...acts, ...agents]
  }, [q, topics, actions])

  useEffect(() => setIndex(0), [q])
  useEffect(() => {
    if (!open) setQ('')
  }, [open])
  useEffect(() => {
    // Keep the highlighted option in view (no smooth scroll: keyboard speed).
    const el = list.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  function run(item: Item | undefined) {
    if (!item) return
    onOpenChange(false)
    if (item.kind === 'page') void navigate({ to: item.to })
    else if (item.kind === 'agent') void navigate({ to: '/topics/$id', params: { id: item.topic.id } })
    else item.run()
  }

  const active = items[index]
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[oklch(0_0_0/0.35)]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 top-0 z-50 flex max-h-[100dvh] flex-col bg-pane text-ink shadow-raised outline-none md:top-[12vh] md:left-1/2 md:w-[min(36rem,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-2xl"
        >
          <Dialog.Title className="sr-only">Go to a page, an agent or an action</Dialog.Title>
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
              placeholder="Go to a page, an agent or an action"
              autoComplete="off"
              spellCheck={false}
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint md:text-[15px]"
            />
            <kbd className="hidden rounded border border-line px-1.5 font-sans text-[11px] text-mute md:inline">Esc</kbd>
          </div>
          <ul id="hb-palette-list" ref={list} role="listbox" aria-label="Results" className="scroller min-h-0 flex-1 overflow-y-auto p-1.5 md:max-h-[50vh]">
            {items.length === 0 && <li className="px-3 py-6 text-center text-[13.5px] text-mute">Nothing matches that.</li>}
            {items.map((item, i) => {
              const Icon = item.kind === 'agent' ? (item.topic.is_general ? MessageCircleIcon : HashIcon) : item.icon
              const group = item.kind === 'page' ? 'Pages' : item.kind === 'action' ? 'Actions' : 'Agents'
              const prev = items[i - 1]
              const showGroup = !prev || prev.kind !== item.kind
              return (
                <li key={item.id} role="presentation">
                  {showGroup && <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-[0.06em] text-mute uppercase">{group}</p>}
                  <div
                    id={`hb-palette-${item.id}`}
                    role="option"
                    aria-selected={i === index}
                    data-i={i}
                    onPointerMove={() => setIndex(i)}
                    onClick={() => run(item)}
                    className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-[14px]', i === index && 'bg-sunken')}
                  >
                    <Icon aria-hidden className="size-4 shrink-0 text-mute" />
                    {item.kind === 'agent' ? <UserText className="min-w-0 flex-1">{item.label}</UserText> : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                    {i === index && <CornerDownLeftIcon aria-hidden className="size-3.5 shrink-0 text-faint" />}
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
