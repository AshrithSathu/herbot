// Variant "Command" — interaction-model axis: no permanent navigation at all.
// The agents pane keeps every pixel for agents; pages live behind a compact
// "Herbot" menu in its header and a ⌘K palette that finds pages, agents and
// actions by typing (Raycast / Linear style). On phones the same palette
// opens full screen from the header. Keyboard-first, so nothing animates
// except the palette's own short entrance.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DropdownMenu } from 'radix-ui'
import { ChevronDownIcon, ChevronLeftIcon, CornerDownLeftIcon, HashIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { topicsQuery } from '../../queries'
import { AgentList, Body, FOCUS_CSS, FRAME, PAGES, PANE, SIGN_OUT, SignedOut, fold, useNav, type Nav } from './shared'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

const isMac = () => typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)

export function CommandVariant() {
  const nav = useNav()
  const [palette, setPalette] = useState(false)
  const [phoneHome, setPhoneHome] = useState(true)
  const [mod, setMod] = useState('Ctrl')
  // Where focus lands after the palette closes (it may have no trigger).
  const main = useRef<HTMLElement>(null)
  useEffect(() => setMod(isMac() ? '⌘' : 'Ctrl'), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={cn(FRAME, 'md:gap-2 md:p-2')}>
      <style>{FOCUS_CSS}</style>
      <aside aria-label="Agents" className={cn(PANE, 'flex min-h-0 w-full flex-col md:w-[19rem] md:shrink-0', !phoneHome && 'max-md:hidden')}>
        <AgentList
          nav={nav}
          onPicked={() => setPhoneHome(false)}
          header={
            <div className="flex h-14 shrink-0 items-center gap-1 px-2">
              <HerbotMenu nav={nav} onPicked={() => setPhoneHome(false)} />
              <button
                type="button"
                onClick={() => setPalette(true)}
                aria-label="Go to anything"
                aria-keyshortcuts="Meta+K Control+K"
                className="ml-auto flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] text-[var(--c-mute)] transition-[background-color,color] duration-150 hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] pointer-coarse:size-11 pointer-coarse:justify-center pointer-coarse:px-0"
              >
                <SearchIcon className="size-4" aria-hidden />
                <kbd className="rounded border border-[var(--c-line)] px-1 font-sans text-[11px] text-[var(--c-faint)] pointer-coarse:hidden">{mod} K</kbd>
              </button>
            </div>
          }
        />
      </aside>
      <main ref={main} tabIndex={-1} className={cn(PANE, 'flex min-h-0 min-w-0 flex-1 flex-col outline-none', phoneHome && 'max-md:hidden')}>
        <Body
          nav={nav}
          back={
            <button type="button" onClick={() => setPhoneHome(true)} aria-label="Back to agents" className="grid size-11 place-items-center rounded-lg text-[var(--c-accent)] md:hidden">
              <ChevronLeftIcon className="size-5" aria-hidden />
            </button>
          }
        />
      </main>
      <Palette open={palette} onOpenChange={setPalette} nav={nav} onPicked={() => setPhoneHome(false)} onClosed={() => main.current?.focus()} />
      <SignedOut nav={nav} />
    </div>
  )
}

/** "Herbot ▾": every page and Sign out, one click from anywhere. */
function HerbotMenu({ nav, onPicked }: { nav: Nav; onPicked: () => void }) {
  const current = nav.view.kind === 'page' ? nav.view.page : null
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex h-9 items-center gap-1 rounded-lg px-2 font-semibold transition-[background-color] duration-150 hover:bg-[var(--c-sunken)] data-[state=open]:bg-[var(--c-sunken)] pointer-coarse:h-11">
        <span className="serif text-[19px] leading-none tracking-[-0.01em]">Herbot</span>
        <ChevronDownIcon className="size-4 text-[var(--c-mute)]" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="hb z-[70] min-w-56 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-xl bg-[var(--c-pane)] p-1 text-[14px] shadow-[var(--c-raised)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-150"
        >
          {(['Workspace', 'Shared', 'System'] as const).map((group, gi) => (
            <DropdownMenu.Group key={group}>
              {gi > 0 && <DropdownMenu.Separator className="my-1 h-px bg-[var(--c-line)]" />}
              <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-[11px] tracking-[0.06em] text-[var(--c-faint)] uppercase">{group}</DropdownMenu.Label>
              {PAGES.filter((p) => p.group === group).map((p) => (
                <DropdownMenu.Item
                  key={p.id}
                  onSelect={() => {
                    nav.setView({ kind: 'page', page: p.id })
                    onPicked()
                  }}
                  className={cn(
                    'flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2.5 outline-none select-none data-[highlighted]:bg-[var(--c-sunken)] pointer-coarse:h-11',
                    current === p.id && 'text-[var(--c-accent)]',
                  )}
                >
                  <p.icon className="size-4" aria-hidden />
                  <span className="flex-1">{p.label}</span>
                  {current === p.id && <span className="sr-only">(current)</span>}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Group>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-[var(--c-line)]" />
          <DropdownMenu.Item onSelect={nav.signOut} className="flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[var(--c-off)] outline-none select-none data-[highlighted]:bg-[var(--c-sunken)] pointer-coarse:h-11">
            <SIGN_OUT.icon className="size-4" aria-hidden />
            {SIGN_OUT.label}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

type Result = { key: string; group: 'Pages' | 'Agents' | 'Actions'; label: string; hint?: string; icon: typeof SearchIcon; run: () => void; danger?: boolean }

function Palette({ open, onOpenChange, nav, onPicked, onClosed }: { open: boolean; onOpenChange: (o: boolean) => void; nav: Nav; onPicked: () => void; onClosed: () => void }) {
  const topics = useQuery(topicsQuery)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
    }
  }, [open])

  const results = useMemo<Result[]>(() => {
    const w = fold(q.trim())
    const close = (f: () => void) => () => {
      f()
      onOpenChange(false)
    }
    const pages: Result[] = PAGES.filter((p) => !w || fold(p.label).includes(w) || fold(p.hint).includes(w)).map((p) => ({
      key: `p-${p.id}`,
      group: 'Pages',
      label: p.label,
      hint: p.hint,
      icon: p.icon,
      run: close(() => {
        nav.setView({ kind: 'page', page: p.id })
        onPicked()
      }),
    }))
    const agents: Result[] = (topics.data ?? [])
      .filter((t) => !w || fold(t.name).includes(w))
      .slice(0, w ? 8 : 4)
      .map((t) => ({
        key: `a-${t.id}`,
        group: 'Agents',
        label: t.name,
        icon: HashIcon,
        run: close(() => {
          nav.setView({ kind: 'agent', id: t.id })
          onPicked()
        }),
      }))
    const actions: Result[] = [
      { key: 'x-new', group: 'Actions' as const, label: 'New agent', hint: 'Create a topic with a purpose', icon: PlusIcon, run: close(() => {
        nav.setView({ kind: 'page', page: 'topics' })
        onPicked()
      }) },
      { key: 'x-out', group: 'Actions' as const, label: SIGN_OUT.label, icon: SIGN_OUT.icon, run: close(nav.signOut), danger: true },
    ].filter((a) => !w || fold(a.label).includes(w))
    return [...pages, ...agents, ...actions]
  }, [q, topics.data, nav, onOpenChange, onPicked])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(results.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      results[active]?.run()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150" style={{ background: 'oklch(0 0 0 / 0.35)' }} />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          // Opened by ⌘K there's no trigger to return to: land on the page you went to.
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            onClosed()
          }}
          className="hb fixed inset-0 z-[61] flex flex-col bg-[var(--c-pane)] text-[14px] outline-none md:inset-x-0 md:top-[12vh] md:bottom-auto md:mx-auto md:max-h-[min(560px,76vh)] md:w-[min(600px,calc(100vw-2rem))] md:rounded-2xl md:shadow-[var(--c-raised)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-150"
        >
          <style>{FOCUS_CSS}</style>
          <Dialog.Title className="sr-only">Go to anything</Dialog.Title>
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--c-line)] px-3 pt-[env(safe-area-inset-top)]">
            <SearchIcon className="size-4 shrink-0 text-[var(--c-faint)]" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Go to a page, an agent or an action…"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-results"
              aria-activedescendant={results[active] ? `palette-${results[active].key}` : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              // The field always has focus while the palette is open; the caret is
              // the cue. Inline, so the variant's focus-ring rule can't win.
              style={{ outline: 'none' }}
              className="h-14 min-w-0 flex-1 bg-transparent text-base placeholder:text-[var(--c-faint)] md:text-[15px]"
            />
            <Dialog.Close className="grid h-9 shrink-0 place-items-center rounded-md px-2 text-[12px] text-[var(--c-mute)] hover:bg-[var(--c-sunken)] pointer-coarse:h-11">
              <span className="md:hidden">Cancel</span>
              <kbd className="hidden font-sans md:inline">Esc</kbd>
            </Dialog.Close>
          </div>
          <ul ref={list} id="palette-results" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            {results.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-[var(--c-mute)]">Nothing matches “{q}”. Try a page name like “tasks”, or part of an agent’s name.</li>}
            {results.map((r, i) => (
              <li key={r.key} role="presentation">
                {(i === 0 || results[i - 1].group !== r.group) && (
                  <div role="presentation" className="px-2.5 pt-2 pb-1 text-[11px] tracking-[0.06em] text-[var(--c-faint)] uppercase">
                    {r.group}
                  </div>
                )}
                <div
                  id={`palette-${r.key}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={r.run}
                  className={cn('flex min-h-10 cursor-default items-center gap-3 rounded-lg px-2.5 select-none pointer-coarse:min-h-12', i === active && 'bg-[var(--c-sunken)]', r.danger && 'text-[var(--c-off)]')}
                >
                  <r.icon className={cn('size-4 shrink-0', !r.danger && 'text-[var(--c-mute)]')} aria-hidden />
                  {r.group === 'Agents' ? <UserText className="min-w-0 flex-1">{r.label}</UserText> : <span className="min-w-0 flex-1 truncate">{r.label}</span>}
                  {r.hint && <span className="hidden max-w-[45%] truncate text-[12px] text-[var(--c-faint)] sm:block">{r.hint}</span>}
                  {i === active && <CornerDownLeftIcon className="hidden size-3.5 shrink-0 text-[var(--c-faint)] md:block" aria-hidden />}
                </div>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
