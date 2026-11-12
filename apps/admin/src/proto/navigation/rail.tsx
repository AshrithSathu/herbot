// Variant "Rail" — placement axis: a slim icon rail outside the panes
// (Slack/Linear style). Every page is one click away and always visible; the
// agents pane is untouched. Phones get a bottom tab bar with the four most
// used destinations and a "More" sheet for the rest.
import { useState } from 'react'
import { Dialog } from 'radix-ui'
import { ChevronLeftIcon, MessageCircleIcon, MoreHorizontalIcon } from 'lucide-react'
import { AgentList, Body, FOCUS_CSS, FRAME, PAGES, PANE, SIGN_OUT, SignedOut, useNav, type Nav, type PageId } from './shared'
import { cn } from '@/lib/utils'

const CSS = `${FOCUS_CSS}
.rail-tip { position: absolute; left: calc(100% + 10px); top: 50%; translate: 0 -50%; white-space: nowrap; pointer-events: none;
  opacity: 0; scale: 0.97; transform-origin: left center; transition: opacity 120ms ease-out, scale 120ms ease-out; }
.rail-item:hover .rail-tip, .rail-item:focus-visible .rail-tip { opacity: 1; scale: 1; transition-delay: 300ms; }
@media (prefers-reduced-motion: reduce) { .rail-tip { transition: none; scale: 1; } }
`

/** On phones: Agents, the three most used pages, and More. */
const TABS: PageId[] = ['overview', 'topics', 'tasks']

export function RailVariant() {
  const nav = useNav()
  // Phone only: the Agents tab shows the list until an agent is picked.
  const [phoneTab, setPhoneTab] = useState<'agents' | 'body'>('body')
  const [more, setMore] = useState(false)
  const isPage = (id: PageId) => nav.view.kind === 'page' && nav.view.page === id
  return (
    <div className={cn(FRAME, 'flex-col md:flex-row md:gap-2 md:py-2 md:pr-2')}>
      <style>{CSS}</style>
      {/* Desktop rail */}
      <nav aria-label="Pages" className="hidden w-[60px] shrink-0 flex-col items-center gap-1 py-2 md:flex">
        <button
          type="button"
          onClick={() => nav.setView({ kind: 'page', page: 'overview' })}
          aria-label="Herbot overview"
          className="serif mb-3 grid size-10 place-items-center rounded-xl bg-[var(--c-ink)] text-[19px] font-semibold text-[var(--c-pane)]"
        >
          H
        </button>
        {PAGES.map((p, i) => (
          <div key={p.id} className="contents">
            {i > 0 && PAGES[i - 1].group !== p.group && <span aria-hidden className="my-1.5 h-px w-6 bg-[var(--c-line)]" />}
            <RailButton label={p.label} icon={p.icon} active={isPage(p.id)} onClick={() => nav.setView({ kind: 'page', page: p.id })} />
          </div>
        ))}
        <div className="mt-auto">
          <RailButton label={SIGN_OUT.label} icon={SIGN_OUT.icon} active={false} onClick={nav.signOut} />
        </div>
      </nav>

      <aside aria-label="Agents" className={cn(PANE, 'flex min-h-0 flex-col md:w-[19rem] md:shrink-0', phoneTab === 'agents' ? 'max-md:flex-1' : 'max-md:hidden')}>
        <AgentList
          nav={nav}
          onPicked={() => setPhoneTab('body')}
          header={
            <div className="flex h-14 shrink-0 items-center gap-2 px-4">
              <span className="font-semibold">Agents</span>
            </div>
          }
        />
      </aside>

      <main className={cn(PANE, 'flex min-h-0 min-w-0 flex-1 flex-col', phoneTab === 'agents' && 'max-md:hidden')}>
        <Body
          nav={nav}
          back={
            nav.view.kind === 'agent' ? (
              <button type="button" onClick={() => setPhoneTab('agents')} aria-label="All agents" className="grid size-11 place-items-center rounded-lg text-[var(--c-accent)] md:hidden">
                <ChevronLeftIcon className="size-5" aria-hidden />
              </button>
            ) : undefined
          }
        />
      </main>

      {/* Phone tab bar */}
      <nav aria-label="Pages" className="flex shrink-0 border-t border-[var(--c-line)] bg-[var(--c-pane)] pb-[env(safe-area-inset-bottom)] md:hidden">
        <TabButton label="Agents" icon={MessageCircleIcon} active={phoneTab === 'agents' || nav.view.kind === 'agent'} onClick={() => setPhoneTab('agents')} />
        {TABS.map((id) => {
          const p = PAGES.find((x) => x.id === id)!
          return (
            <TabButton
              key={id}
              label={p.label}
              icon={p.icon}
              active={phoneTab === 'body' && isPage(id)}
              onClick={() => {
                nav.setView({ kind: 'page', page: id })
                setPhoneTab('body')
              }}
            />
          )
        })}
        <TabButton
          label="More"
          icon={MoreHorizontalIcon}
          active={phoneTab === 'body' && nav.view.kind === 'page' && !TABS.includes(nav.view.page)}
          onClick={() => setMore(true)}
        />
      </nav>

      <MoreSheet
        open={more}
        onOpenChange={setMore}
        nav={nav}
        onPick={(id) => {
          nav.setView({ kind: 'page', page: id })
          setPhoneTab('body')
          setMore(false)
        }}
      />
      <SignedOut nav={nav} />
    </div>
  )
}

function RailButton({ label, icon: Icon, active, onClick }: { label: string; icon: typeof ChevronLeftIcon; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rail-item relative grid size-10 place-items-center rounded-xl transition-[background-color,color] duration-150 ease-out',
        active ? 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]' : 'text-[var(--c-mute)] hover:bg-[var(--c-pane)] hover:text-[var(--c-ink)]',
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
      <span className="rail-tip z-10 rounded-md bg-[var(--c-ink)] px-2 py-1 text-[12px] font-medium text-[var(--c-pane)]">{label}</span>
    </button>
  )
}

function TabButton({ label, icon: Icon, active, onClick }: { label: string; icon: typeof ChevronLeftIcon; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn('flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', active ? 'text-[var(--c-accent)]' : 'text-[var(--c-mute)]')}
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </button>
  )
}

function MoreSheet({ open, onOpenChange, nav, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; nav: Nav; onPick: (id: PageId) => void }) {
  const rest = PAGES.filter((p) => !TABS.includes(p.id))
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="hb fixed inset-0 z-[60] bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:duration-200 data-[state=open]:duration-250" style={{ background: 'oklch(0 0 0 / 0.4)' }} />
        <Dialog.Content
          aria-describedby={undefined}
          className="hb fixed inset-x-0 bottom-0 z-[61] flex flex-col rounded-t-2xl bg-[var(--c-pane)] pb-[max(12px,env(safe-area-inset-bottom))] outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-250"
        >
          <style>{FOCUS_CSS}</style>
          <div aria-hidden className="mx-auto mt-2 h-1 w-9 rounded-full bg-[var(--c-line)]" />
          <Dialog.Title className="px-5 pt-3 pb-1 text-[13px] font-semibold text-[var(--c-mute)]">More</Dialog.Title>
          <ul className="flex flex-col px-2">
            {rest.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onPick(p.id)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] hover:bg-[var(--c-sunken)]">
                  <p.icon className="size-5 text-[var(--c-mute)]" aria-hidden />
                  <span className="flex-1">{p.label}</span>
                </button>
              </li>
            ))}
            <li className="mt-1 border-t border-[var(--c-line)] pt-1">
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false)
                  nav.signOut()
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-[var(--c-off)] hover:bg-[var(--c-sunken)]"
              >
                <SIGN_OUT.icon className="size-5" aria-hidden />
                {SIGN_OUT.label}
              </button>
            </li>
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
