// Variant "Monogram" — identity axis: a tinted monogram per agent with the
// status on its corner, two lines (name + time, then the purpose), like a
// messenger's chat list. Unread is a filled accent pip; working replaces
// the preview with "Working" and three breathing dots.
import type React from 'react'
import { Link } from '@tanstack/react-router'
import type { Topic } from '../../api'
import { Time } from '../../ui'
import { FilterBox, Frame, ListState, hueOf, initial, rowLabel, useAgentPane, type Row } from './shared'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

const ROW = 64

const CSS = `
.mono-dots span { animation: mono-dot 1.2s ease-in-out infinite; }
.mono-dots span:nth-child(2) { animation-delay: 0.15s; }
.mono-dots span:nth-child(3) { animation-delay: 0.3s; }
@keyframes mono-dot { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .mono-dots span { animation: none; opacity: 0.7; } }
.mono-av { background: oklch(0.9 0.045 var(--h)); color: oklch(0.38 0.07 var(--h)); }
@media (prefers-color-scheme: dark) { .mono-av { background: oklch(0.34 0.04 var(--h)); color: oklch(0.88 0.05 var(--h)); } }
`

const DOT = { success: 'var(--c-ok)', warning: 'var(--c-warn)', danger: 'var(--c-off)', muted: 'var(--c-faint)' } as const

export function MonogramVariant() {
  const pane = useAgentPane(ROW)
  return (
    <Frame pane={pane} label="Agents">
      <style>{CSS}</style>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <Link to="/" className="font-semibold tracking-tight">
          Herbot
        </Link>
        <span className="text-[12px] text-[var(--c-faint)] tabular-nums">{pane.all.length.toLocaleString('en-GB')} agents</span>
        {pane.unreadCount > 0 && (
          <span className="ml-auto rounded-full bg-[var(--c-accent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--c-accent-ink)] tabular-nums">
            {pane.unreadCount} new
          </span>
        )}
      </div>
      <FilterBox q={pane.q} setQ={pane.setQ} id="mono-filter" className="px-3 pb-2" />
      <ListState pane={pane} />
      <div ref={pane.scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2" hidden={pane.shown.length === 0}>
        <ul className="relative w-full" style={{ height: pane.virtual.getTotalSize() }}>
          {pane.items.map((item) => {
            const t = pane.shown[item.index]
            return (
              <li
                key={t.id}
                data-index={item.index}
                ref={pane.virtual.measureElement}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <AgentButton row={pane.row(t)} active={t.id === pane.selected} onSelect={() => pane.select(t.id)} />
              </li>
            )
          })}
        </ul>
      </div>
    </Frame>
  )
}

function Avatar({ t }: { t: Topic }) {
  const hue = hueOf(t.id)
  return (
    <span
      aria-hidden
      className="mono-av grid size-10 shrink-0 place-items-center rounded-full text-[15px] font-semibold select-none"
      style={{ '--h': hue } as React.CSSProperties}
    >
      {t.is_general ? '★' : initial(t.name)}
    </span>
  )
}

function AgentButton({ row, active, onSelect }: { row: Row; active: boolean; onSelect: () => void }) {
  const t = row.topic
  return (
    <button
      type="button"
      data-agent
      onClick={onSelect}
      aria-label={rowLabel(row)}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-[background-color] duration-150 ease-out',
        active ? 'bg-[var(--c-accent-soft)]' : 'hover:bg-[var(--c-sunken)]',
      )}
    >
      <span className="relative">
        <Avatar t={t} />
        <span
          className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-[var(--c-pane)]"
          style={{ background: DOT[row.status.tone] }}
          aria-hidden
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <UserText className={cn('min-w-0 flex-1 font-medium', !t.enabled && 'text-[var(--c-faint)]')}>
            {t.name}
          </UserText>
          <span className={cn('shrink-0 text-[11px] tabular-nums', row.unread ? 'text-[var(--c-accent)]' : 'text-[var(--c-faint)]')}>
            <Time iso={t.last_activity} relative />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {row.working ? (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-[var(--c-accent)]">
              Working
              <span className="mono-dots flex gap-0.5" aria-hidden>
                <span className="size-1 rounded-full bg-current" />
                <span className="size-1 rounded-full bg-current" />
                <span className="size-1 rounded-full bg-current" />
              </span>
            </span>
          ) : (
            <UserText fallback={row.status.label} className="min-w-0 flex-1 text-[13px] text-[var(--c-mute)]">
              {t.purpose}
            </UserText>
          )}
          {row.unread && <span className="size-2.5 shrink-0 rounded-full bg-[var(--c-accent)]" aria-hidden />}
        </span>
      </span>
    </button>
  )
}
