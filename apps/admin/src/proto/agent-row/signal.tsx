// Variant "Signal" — density axis: one line per agent, ~22 visible at once.
// Identity is the status glyph itself (filled = ready, ring = asking its
// purpose, dashed = not set up, slashed = off, turning arc = working);
// trailing tabular columns carry the message count and a short age.
// Unread shows as an accent age and a hairline bar, never a weight change.
import { Link } from '@tanstack/react-router'
import { compact, exact } from '../../format'
import { FilterBox, Frame, ListState, rowLabel, useAgentPane, type Row } from './shared'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

const ROW = 36

const CSS = `
.sig-spin { animation: sig-spin 0.9s linear infinite; transform-origin: 50% 50%; }
@keyframes sig-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .sig-spin { animation: none; } }
`

/** "8m", "7h", "3d", "5w": an age that fits a column. */
function age(iso: string | null): string {
  if (!iso) return '—'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86_400) return `${Math.round(s / 3600)}h`
  if (s < 86_400 * 14) return `${Math.round(s / 86_400)}d`
  return `${Math.round(s / (86_400 * 7))}w`
}

function Glyph({ row }: { row: Row }) {
  const common = 'size-3.5 shrink-0'
  if (row.working)
    return (
      <svg viewBox="0 0 14 14" className={cn(common, 'sig-spin text-[var(--c-accent)]')} aria-hidden>
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <path d="M7 2a5 5 0 0 1 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  const t = row.topic
  if (!t.enabled)
    return (
      <svg viewBox="0 0 14 14" className={cn(common, 'text-[var(--c-off)]')} aria-hidden>
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3.5 10.5l7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  if (t.setup_state === 'ready')
    return (
      <svg viewBox="0 0 14 14" className={cn(common, 'text-[var(--c-ok)]')} aria-hidden>
        <circle cx="7" cy="7" r="4" fill="currentColor" />
      </svg>
    )
  if (t.setup_state === 'awaiting_purpose')
    return (
      <svg viewBox="0 0 14 14" className={cn(common, 'text-[var(--c-warn)]')} aria-hidden>
        <circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  return (
    <svg viewBox="0 0 14 14" className={cn(common, 'text-[var(--c-faint)]')} aria-hidden>
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
    </svg>
  )
}

export function SignalVariant() {
  const pane = useAgentPane(ROW)
  return (
    <Frame pane={pane} label="Agents">
      <style>{CSS}</style>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--c-line)] px-4">
        <Link to="/" className="font-semibold tracking-tight">
          Herbot
        </Link>
        <span className="ml-auto text-[12px] text-[var(--c-faint)] tabular-nums">
          {pane.unreadCount > 0 && <span className="text-[var(--c-accent)]">{pane.unreadCount} new · </span>}
          {pane.all.length.toLocaleString('en-GB')}
        </span>
      </div>
      <FilterBox q={pane.q} setQ={pane.setQ} id="sig-filter" className="px-2 py-2" />
      {/* Column legend: makes the two trailing numbers self-explanatory. */}
      {pane.shown.length > 0 && (
        <div aria-hidden className="flex items-center gap-2 px-4 pb-1 text-[11px] tracking-[0.04em] text-[var(--c-faint)] uppercase">
          <span className="flex-1">Agent</span>
          <span className="w-10 text-right">Msgs</span>
          <span className="w-8 text-right">Last</span>
        </div>
      )}
      <ListState pane={pane} />
      <div ref={pane.scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-[var(--c-line)]" hidden={pane.shown.length === 0}>
        <ul className="relative w-full" style={{ height: pane.virtual.getTotalSize() }}>
          {pane.items.map((item) => {
            const t = pane.shown[item.index]
            const row = pane.row(t)
            const active = t.id === pane.selected
            return (
              <li
                key={t.id}
                data-index={item.index}
                ref={pane.virtual.measureElement}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <button
                  type="button"
                  data-agent
                  onClick={() => pane.select(t.id)}
                  aria-label={`${rowLabel(row)}, ${exact(t.messages)} messages`}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex h-9 w-full items-center gap-2 border-b border-[var(--c-line)] px-4 text-left transition-[background-color] duration-150 ease-out pointer-coarse:h-11',
                    active ? 'bg-[var(--c-accent-soft)] shadow-[inset_2px_0_0_var(--c-accent)]' : 'hover:bg-[var(--c-sunken)]',
                  )}
                >
                  <Glyph row={row} />
                  <UserText className={cn('min-w-0 flex-1', !t.enabled && 'text-[var(--c-faint)]')}>{t.name}</UserText>
                  <span className="w-10 shrink-0 text-right text-[12px] text-[var(--c-faint)] tabular-nums" title={`${exact(t.messages)} messages`}>
                    {compact(t.messages)}
                  </span>
                  <span
                    className={cn('w-8 shrink-0 text-right text-[12px] tabular-nums', row.unread ? 'font-medium text-[var(--c-accent)]' : 'text-[var(--c-faint)]')}
                  >
                    {row.unread ? '•' : ''}
                    {age(t.last_activity)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Frame>
  )
}
