// Variant "Sections" — containment axis: the pages live inside the agents
// pane, above the list (Telegram folders / Apple Mail mailboxes). No extra
// column; the four everyday pages are always shown, the rest fold under a
// "More" disclosure that remembers its state. On phones that pane is the
// home screen, and a page or agent pushes in with a back button.
import { useEffect, useState } from 'react'
import { ChevronDownIcon, ChevronLeftIcon } from 'lucide-react'
import { AgentList, Body, FOCUS_CSS, FRAME, PAGES, PANE, SIGN_OUT, SignedOut, useNav, type Nav } from './shared'
import { cn } from '@/lib/utils'

const MORE_KEY = 'proto.navigation.sections.more'

export function SectionsVariant() {
  const nav = useNav()
  const [phoneHome, setPhoneHome] = useState(true)
  return (
    <div className={cn(FRAME, 'md:gap-2 md:p-2')}>
      <style>{FOCUS_CSS}</style>
      <aside aria-label="Pages and agents" className={cn(PANE, 'flex min-h-0 w-full flex-col md:w-[19rem] md:shrink-0', !phoneHome && 'max-md:hidden')}>
        <AgentList nav={nav} onPicked={() => setPhoneHome(false)} header={<PageSections nav={nav} onPicked={() => setPhoneHome(false)} />} />
      </aside>
      <main className={cn(PANE, 'flex min-h-0 min-w-0 flex-1 flex-col', phoneHome && 'max-md:hidden')}>
        <Body
          nav={nav}
          back={
            <button type="button" onClick={() => setPhoneHome(true)} className="flex h-11 items-center gap-0.5 rounded-lg pr-2 text-[14px] text-[var(--c-accent)] md:hidden">
              <ChevronLeftIcon className="size-5" aria-hidden />
              Herbot
            </button>
          }
        />
      </main>
      <SignedOut nav={nav} />
    </div>
  )
}

function PageSections({ nav, onPicked }: { nav: Nav; onPicked: () => void }) {
  const [more, setMore] = useState(false)
  useEffect(() => {
    try {
      setMore(localStorage.getItem(MORE_KEY) === '1')
    } catch {
      /* storage blocked: start folded */
    }
  }, [])
  const toggle = () =>
    setMore((m) => {
      try {
        localStorage.setItem(MORE_KEY, m ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !m
    })
  const primary = PAGES.filter((p) => p.group === 'Workspace')
  const rest = PAGES.filter((p) => p.group !== 'Workspace')
  const item = (p: (typeof PAGES)[number]) => {
    const on = nav.view.kind === 'page' && nav.view.page === p.id
    return (
      <li key={p.id}>
        <button
          type="button"
          onClick={() => {
            nav.setView({ kind: 'page', page: p.id })
            onPicked()
          }}
          aria-current={on ? 'page' : undefined}
          className={cn(
            'flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-[background-color,color] duration-150 ease-out pointer-coarse:h-11',
            on ? 'bg-[var(--c-accent-soft)] text-[var(--c-ink)]' : 'text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)]',
          )}
        >
          <p.icon className={cn('size-4 shrink-0', on && 'text-[var(--c-accent)]')} aria-hidden />
          {p.label}
        </button>
      </li>
    )
  }
  return (
    <div className="flex shrink-0 flex-col">
      <div className="flex h-14 items-center px-4">
        <span className="serif text-[20px] leading-none font-semibold tracking-[-0.01em]">Herbot</span>
      </div>
      <nav aria-label="Pages" className="px-2 pb-2">
        <ul className="flex flex-col gap-px">{primary.map(item)}</ul>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={more}
          aria-controls="sections-more"
          className="mt-px flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] pointer-coarse:h-11"
        >
          <ChevronDownIcon className={cn('size-4 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none', !more && '-rotate-90')} aria-hidden />
          {more ? 'Less' : `More · ${rest.length}`}
        </button>
        <ul id="sections-more" hidden={!more} className="flex flex-col gap-px">
          {rest.map(item)}
          <li>
            <button
              type="button"
              onClick={nav.signOut}
              className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-off)] pointer-coarse:h-11"
            >
              <SIGN_OUT.icon className="size-4 shrink-0" aria-hidden />
              {SIGN_OUT.label}
            </button>
          </li>
        </ul>
      </nav>
      <div className="flex h-8 items-center border-t border-[var(--c-line)] px-4 pt-2 text-[11px] tracking-[0.06em] text-[var(--c-faint)] uppercase">Agents</div>
    </div>
  )
}
