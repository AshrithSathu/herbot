// The three-pane shell (docs/design/DECISIONS.md, Stage 1 + "Navigation"):
// an icon rail outside the panes; the agents pane; the main pane; an
// optional details pane. Three panes from 68.75rem, two below (details
// opens over the main pane), one on phones with a bottom tab bar
// (Agents, Overview, Search, Tasks, More). A strip on top carries
// system-wide state. ⌘K opens the palette.
import { useMedia } from './use-media'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Dialog } from 'radix-ui'
import { Link, useLocation, useMatchRoute } from '@tanstack/react-router'
import { LogOutIcon, MessageCircleIcon, MoreHorizontalIcon, type LucideIcon } from 'lucide-react'
import type { Topic } from '../../api'
import { cn } from '@/lib/utils'
import { CommandPalette, usePaletteHotkey, type PaletteAction } from './command-palette'
import { PAGES, PHONE_TABS, type Page } from './pages'

type PhonePane = 'agents' | 'main'

type ShellContextValue = {
  phonePane: PhonePane
  showAgents: () => void
  showMain: () => void
  /** Opens ⌘K, optionally with a query typed in. */
  openPalette: (query?: string) => void
  detailsOpen: boolean
  /** Shows or hides the details pane; on wide screens the choice is remembered. */
  setDetailsOpen: (open: boolean) => void
  /** Whether the system strip (Telegram off, offline) is showing, so a page
   * doesn't say the same thing again in its own copy. */
  stripShown: boolean
  /** Internal: <ShellDetails> registers here. */
  registerDetails: (defaultOpen: boolean) => () => void
  detailsTarget: HTMLElement | null
}

const ShellContext = createContext<ShellContextValue | null>(null)

/** Inside the shell: switch phone panes, open ⌘K, toggle the details pane. */
export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used inside <Shell>')
  return ctx
}

type ShellProps = {
  /** The agents pane's content (usually <AgentList>). */
  agents: ReactNode
  /** The details pane's content, when it's fixed (pages usually render
   * <ShellDetails> instead, which portals into the pane). */
  details?: ReactNode
  /** System-wide state (Telegram off, offline): <StatusStrip>. */
  strip?: ReactNode
  onSignOut: () => void
  signingOut?: boolean
  /** Agents for ⌘K. */
  topics?: Topic[]
  actions?: PaletteAction[]
  children: ReactNode
}

const PANE = 'flex min-h-0 min-w-0 flex-col bg-pane md:rounded-2xl md:shadow-raised'

const WIDE = '(min-width: 68.75rem)'
const DETAILS_KEY = 'herbot.details-pane'

function readDetailsPref(fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(DETAILS_KEY)
    return v === null ? fallback : v === 'open'
  } catch {
    return fallback
  }
}

export function Shell({ agents, details, strip, onSignOut, signingOut = false, topics = [], actions, children }: ShellProps) {
  const [phonePane, setPhonePane] = useState<PhonePane>('main')
  const [palette, setPalette] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [more, setMore] = useState(false)
  const [detailsOpen, setDetailsOpenState] = useState(false)
  const [registered, setRegistered] = useState(0)
  const [detailsTarget, setDetailsTarget] = useState<HTMLElement | null>(null)
  const pathname = useLocation({ select: (l) => l.pathname })
  usePaletteHotkey(
    useCallback(() => {
      setPaletteQuery('')
      setPalette((o) => !o)
    }, []),
  )

  // Wide screens remember the pane (a permanent third pane, open by
  // default); narrower ones open it on demand and forget.
  const setDetailsOpen = useCallback((open: boolean) => {
    setDetailsOpenState(open)
    if (matchMedia(WIDE).matches) {
      try {
        localStorage.setItem(DETAILS_KEY, open ? 'open' : 'closed')
      } catch {
        /* storage blocked: the pane still works, it just won't remember */
      }
    }
  }, [])
  // Crossing 68.75rem re-derives the pane: wide restores the remembered
  // choice, narrow closes the overlay (it opens on demand there). So the
  // state never says "closed" while an overlay shows, or the reverse.
  const wide = useMedia(WIDE, true)
  const defaultRef = useRef(true)
  useEffect(() => {
    if (registered === 0) return
    setDetailsOpenState(wide ? readDetailsPref(defaultRef.current) : false)
  }, [wide, registered])
  const registerDetails = useCallback((defaultOpen: boolean) => {
    defaultRef.current = defaultOpen
    setRegistered((n) => n + 1)
    setDetailsOpenState(matchMedia(WIDE).matches ? readDetailsPref(defaultOpen) : false)
    return () => {
      setRegistered((n) => n - 1)
      setDetailsOpenState(false)
    }
  }, [])

  // A new page (or agent) shows the main pane on phones and closes the
  // details overlay.
  useEffect(() => {
    setPhonePane('main')
    setMore(false)
  }, [pathname])

  const value: ShellContextValue = {
    phonePane,
    showAgents: useCallback(() => setPhonePane('agents'), []),
    showMain: useCallback(() => setPhonePane('main'), []),
    openPalette: useCallback((query?: string) => {
      setPaletteQuery(query ?? '')
      setPalette(true)
    }, []),
    detailsOpen,
    setDetailsOpen,
    stripShown: Boolean(strip),
    registerDetails,
    detailsTarget,
  }
  const hasDetails = Boolean(details) || registered > 0
  // Below 68.75rem the open details pane covers the page: what's behind it
  // leaves the tab order and the accessibility tree until it closes.
  const covered = hasDetails && detailsOpen && !wide

  return (
    <ShellContext.Provider value={value}>
      <div className="flex h-dvh flex-col bg-canvas text-ink antialiased">
        <a
          href="#content"
          className="sr-only rounded-md bg-pane px-3 py-2 shadow-raised focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60]"
        >
          Skip to content
        </a>
        <div inert={covered || undefined} className="contents">
          {strip}
        </div>
        <div className="flex min-h-0 flex-1 md:gap-2 md:py-2 md:pr-2">
          <div inert={covered || undefined} className="contents">
            <Rail onSignOut={onSignOut} signingOut={signingOut} />

            <aside aria-label="Agents" className={cn(PANE, 'md:w-[19rem] md:shrink-0', phonePane === 'agents' ? 'max-md:flex-1' : 'max-md:hidden')}>
              {agents}
            </aside>

            <main id="content" tabIndex={-1} className={cn(PANE, 'flex-1 outline-none', phonePane === 'agents' && 'max-md:hidden')}>
              {children}
            </main>
          </div>

          {hasDetails && (
            <DetailsSlot open={detailsOpen} modal={!wide} onClose={() => setDetailsOpen(false)}>
              {details ?? <div ref={setDetailsTarget} className="flex min-h-0 flex-1 flex-col" />}
            </DetailsSlot>
          )}
        </div>
        <div inert={covered || undefined} className="contents">
          <TabBar onMore={() => setMore(true)} />
        </div>
        <MoreSheet open={more} onOpenChange={setMore} onSignOut={onSignOut} />
        <CommandPalette open={palette} onOpenChange={setPalette} topics={topics} actions={actions} initialQuery={paletteQuery} />
      </div>
    </ShellContext.Provider>
  )
}

/**
 * A page's details pane content (the topic's details, a memory, a call),
 * rendered into the shell's third pane. Open by default on wide screens
 * (remembered after you hide it); on demand below 68.75rem. Toggle it with
 * useShell().setDetailsOpen.
 */
export function ShellDetails({ children, defaultOpen = true }: { children: ReactNode; defaultOpen?: boolean }) {
  const { registerDetails, detailsTarget } = useShell()
  useLayoutEffect(() => registerDetails(defaultOpen), [registerDetails, defaultOpen])
  return detailsTarget ? createPortal(children, detailsTarget) : null
}

/** Three panes from 68.75rem: the details pane sits beside the main pane.
 * Below that it opens over the main pane (full screen on phones) as a modal:
 * labelled, focus moved in and kept in, Escape closes, and focus goes back to
 * whatever opened it. Everything behind is `inert` meanwhile (see Shell). */
function DetailsSlot({ open, modal, onClose, children }: { open: boolean; modal: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const overlay = open && modal
  // A layout effect, so the opener is read before focus moves into the pane.
  useLayoutEffect(() => {
    if (!overlay) return
    const active = document.activeElement
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null
    ref.current?.focus()
    return () => {
      const back = opener.current
      opener.current = null
      // The pane has closed (or gone wide): return focus if it was inside.
      requestAnimationFrame(() => {
        if (back?.isConnected && (!document.activeElement || document.activeElement === document.body || ref.current?.contains(document.activeElement))) back.focus()
      })
    }
  }, [overlay])
  // A native listener: the pane's content arrives through a React portal
  // from the page, so React's synthetic keydown never bubbles to this aside;
  // the DOM event does.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const el = ref.current
    if (!el) return
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        // Only as an overlay: on wide screens the pane is part of the page.
        if (!overlay) return
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      // Keep Tab inside while it covers the page.
      if (!overlay || e.key !== 'Tab' || !el) return
      const focusable = [...el.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((n) => n.offsetParent !== null)
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [overlay])
  return (
    <>
      {overlay && (
        <button type="button" tabIndex={-1} aria-hidden onClick={onClose} className="fixed inset-0 z-40 hidden bg-[oklch(0_0_0/0.3)] md:block" />
      )}
      <aside
        ref={ref}
        tabIndex={-1}
        aria-label="Details"
        role={overlay ? 'dialog' : undefined}
        aria-modal={overlay || undefined}
        className={cn(
          PANE,
          'outline-none',
          open ? 'flex' : 'hidden',
          'max-wide:fixed max-wide:inset-0 max-wide:z-50 md:max-wide:inset-y-2 md:max-wide:right-2 md:max-wide:left-auto md:max-wide:w-[24rem]',
          'wide:w-[22rem] wide:shrink-0',
        )}
      >
        {children}
      </aside>
    </>
  )
}

function useActive() {
  const match = useMatchRoute()
  return (p: Page) => Boolean(match({ to: p.to, fuzzy: !p.exact }))
}

/** Desktop: a slim icon rail outside the panes, grouped, with tooltips. */
function Rail({ onSignOut, signingOut }: { onSignOut: () => void; signingOut: boolean }) {
  const active = useActive()
  // Tooltips wait 300 ms the first time, then open at once while you move
  // along the rail ("warm"), cooling 300 ms after the pointer leaves.
  const [warm, setWarm] = useState(false)
  const cool = useRef<ReturnType<typeof setTimeout>>(undefined)
  return (
    <nav
      aria-label="Pages"
      data-warm={warm || undefined}
      onPointerEnter={() => {
        clearTimeout(cool.current)
        cool.current = setTimeout(() => setWarm(true), 300)
      }}
      onPointerLeave={() => {
        clearTimeout(cool.current)
        cool.current = setTimeout(() => setWarm(false), 300)
      }}
      className="group/rail hidden w-[60px] shrink-0 flex-col items-center gap-1 py-1 md:flex"
    >
      <Link to="/" aria-label="Herbot overview" className="mb-3 grid size-10 place-items-center rounded-xl bg-ink font-serif text-[19px] font-semibold text-pane">
        H
      </Link>
      {PAGES.map((p, i) => (
        <div key={p.to} className="contents">
          {i > 0 && PAGES[i - 1].group !== p.group && <span aria-hidden className="my-1.5 h-px w-6 bg-line" />}
          <RailItem label={p.label} icon={p.icon} active={active(p)} to={p.to} />
        </div>
      ))}
      <div className="mt-auto">
        <RailItem label={signingOut ? 'Signing out…' : 'Sign out'} icon={LogOutIcon} onClick={onSignOut} disabled={signingOut} />
      </div>
    </nav>
  )
}

const RAIL_ITEM =
  'relative grid size-10 place-items-center rounded-xl outline-none transition-[background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring'

const TIP =
  'pointer-events-none absolute top-1/2 left-[calc(100%+10px)] z-30 -translate-y-1/2 scale-[0.97] rounded-md bg-ink px-2 py-1 text-[12px] font-medium whitespace-nowrap text-pane opacity-0 transition-[opacity,scale] duration-150 ease-out [transform-origin:left_center] group-hover/item:scale-100 group-hover/item:opacity-100 group-hover/item:delay-300 group-focus-visible/item:scale-100 group-focus-visible/item:opacity-100 group-data-[warm]/rail:delay-0 motion-reduce:scale-100 motion-reduce:transition-none'

function RailItem({ label, icon: Icon, active = false, to, onClick, disabled }: { label: string; icon: LucideIcon; active?: boolean; to?: Page['to']; onClick?: () => void; disabled?: boolean }) {
  const cls = cn(RAIL_ITEM, 'group/item', active ? 'bg-accent-soft text-accent-strong' : 'text-mute hover:bg-pane hover:text-ink')
  const inner = (
    <>
      <Icon className="size-[18px]" aria-hidden />
      <span className={TIP} aria-hidden>
        {label}
      </span>
    </>
  )
  return to ? (
    <Link to={to} aria-label={label} aria-current={active ? 'page' : undefined} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className={cn(cls, 'disabled:text-faint')}>
      {inner}
    </button>
  )
}

/** Phones: Agents, the most used pages, and More. */
function TabBar({ onMore }: { onMore: () => void }) {
  const { phonePane, showAgents, showMain } = useShell()
  const active = useActive()
  const tabs = PHONE_TABS.map((to) => PAGES.find((p) => p.to === to)!)
  const onAgent = Boolean(useMatchRoute()({ to: '/topics/$id' }))
  const inMore = PAGES.some((p) => !PHONE_TABS.includes(p.to) && active(p))
  return (
    <nav aria-label="Pages" className="flex shrink-0 border-t border-line bg-pane pb-[env(safe-area-inset-bottom)] md:hidden">
      <TabButton label="Agents" icon={MessageCircleIcon} active={phonePane === 'agents' || onAgent} onClick={showAgents} />
      {tabs.map((p) => (
        <Link
          key={p.to}
          to={p.to}
          // Tapping the tab you're already on (from the agents list) changes
          // no URL, so show the page here rather than waiting for one.
          onClick={showMain}
          aria-current={phonePane === 'main' && active(p) ? 'page' : undefined}
          className={cn('flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', phonePane === 'main' && active(p) ? 'text-accent-strong' : 'text-mute')}
        >
          <p.icon className="size-5" aria-hidden />
          {p.label}
        </Link>
      ))}
      <TabButton label="More" icon={MoreHorizontalIcon} active={phonePane === 'main' && inMore} onClick={onMore} />
    </nav>
  )
}

function TabButton({ label, icon: Icon, active, onClick }: { label: string; icon: LucideIcon; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn('flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', active ? 'text-accent-strong' : 'text-mute')}
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </button>
  )
}

/** Phones: every page not in the tab bar, and Sign out. */
function MoreSheet({ open, onOpenChange, onSignOut }: { open: boolean; onOpenChange: (o: boolean) => void; onSignOut: () => void }) {
  const rest = PAGES.filter((p) => !PHONE_TABS.includes(p.to))
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[oklch(0_0_0/0.4)] ease-[cubic-bezier(0.32,0.72,0,1)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-250 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-180" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl bg-pane pb-[max(12px,env(safe-area-inset-bottom))] text-ink outline-none ease-[cubic-bezier(0.32,0.72,0,1)] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-250 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-180"
        >
          <Dialog.Title className="px-5 pt-5 pb-1 text-[13px] font-semibold text-mute">More</Dialog.Title>
          <ul className="flex flex-col px-2">
            {rest.map((p) => (
              <li key={p.to}>
                <Link to={p.to} onClick={() => onOpenChange(false)} className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] hover:bg-sunken">
                  <p.icon className="size-5 text-mute" aria-hidden />
                  {p.label}
                </Link>
              </li>
            ))}
            <li className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  onSignOut()
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-destructive hover:bg-sunken"
              >
                <LogOutIcon className="size-5" aria-hidden />
                Sign out
              </button>
            </li>
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** A page in the main pane: its own scroll, a capped column, a serif title. */
export function ShellPage({ title, description, actions, back, children, wide = false }: {
  title: ReactNode
  description?: ReactNode
  /** Right of the title: the page's one primary action. */
  actions?: ReactNode
  /** Above the title on phones (e.g. "‹ Agents"). */
  back?: ReactNode
  /** Tables can use the whole pane width. */
  wide?: boolean
  children: ReactNode
}) {
  // Bottom-tab pages are destinations of their own on phones: no "‹ Agents".
  const pathname = useLocation({ select: (l) => l.pathname })
  const isTab = (PHONE_TABS as string[]).includes(pathname)
  // One left edge for every page: the column is always the same width and
  // centred; narrow pages cap their content inside it, starting at its edge.
  return (
    <div data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className={cn('mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-6 pb-[max(3rem,env(safe-area-inset-bottom))] md:px-8 md:pt-8', !wide && '[&>*]:max-w-3xl')}>
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col items-start gap-1">
            {!isTab && back}
            <div className="flex min-w-0 flex-col gap-1.5">
              <h1 className="font-serif text-[30px] leading-[1.1] font-semibold tracking-[-0.015em] text-balance md:text-[34px]">{title}</h1>
              {description && <p className="max-w-[60ch] text-[14px] text-mute text-pretty">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  )
}

/** Phones only: back to the agents pane. */
export function BackToAgents({ label = 'Agents' }: { label?: string }) {
  const { showAgents } = useShell()
  return (
    <button type="button" onClick={showAgents} className="-ml-2 grid h-11 shrink-0 place-items-center rounded-lg px-2 text-[14px] font-medium text-accent-strong md:hidden">
      ‹ {label}
    </button>
  )
}

/** The agents pane's header row: title, count, ⌘K hint and an action. */
export function AgentsHeader({ count, action }: { count?: number; action?: ReactNode }) {
  const { openPalette } = useShell()
  const [mod, setMod] = useState('Ctrl')
  useEffect(() => setMod(/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'), [])
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 px-4 pt-[env(safe-area-inset-top)]">
      <span className="font-serif text-[19px] leading-none font-semibold">Herbot</span>
      {count !== undefined && <span className="text-[12px] text-faint tabular-nums">{count.toLocaleString('en-GB')} agents</span>}
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => openPalette()}
        className="relative hidden h-7 items-center rounded-md px-2 text-[11.5px] text-mute shadow-[inset_0_0_0_var(--hair)_var(--line)] before:absolute before:-inset-x-1 before:-inset-y-1.5 before:content-[''] hover:text-ink md:inline-flex"
        aria-label="Open the command palette"
      >
        {mod} K
      </button>
      {action}
    </div>
  )
}
