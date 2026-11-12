// Variant "Brief" — secondary-line axis: no avatar or glyph at all; the name
// is the row. The second line carries facts instead of the purpose: state
// (coloured only when it needs you), mode, message count and age. Working
// turns the facts line into "Working on a reply" with a thin indeterminate
// rule under the row. Hairline-separated, Ledger-style.
import { Link } from '@tanstack/react-router'
import { compact, exact } from '../../format'
import { Time } from '../../ui'
import { FilterBox, Frame, ListState, rowLabel, useAgentPane, type Row } from './shared'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

const ROW = 58

const CSS = `
.brief-bar { position: absolute; inset-inline: 0; bottom: 0; height: 2px; overflow: hidden; }
.brief-bar::before { content: ''; position: absolute; inset-block: 0; width: 30%; background: var(--c-accent); animation: brief-run 1.4s cubic-bezier(0.45, 0, 0.55, 1) infinite; }
@keyframes brief-run { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
@media (prefers-reduced-motion: reduce) { .brief-bar::before { animation: none; width: 100%; opacity: 0.5; } }
`

const MODE: Record<string, string> = { fast: 'Fast', auto: 'Auto', expert: 'Expert', heavy: 'Heavy' }
const TONE = { success: 'text-[var(--c-mute)]', warning: 'text-[var(--c-warn)]', danger: 'text-[var(--c-off)]', muted: 'text-[var(--c-faint)]' } as const

function Facts({ row }: { row: Row }) {
  const t = row.topic
  if (row.working) return <span className="truncate text-[12.5px] font-medium text-[var(--c-accent)]">Working on a reply…</span>
  return (
    <span className="flex min-w-0 items-baseline gap-1.5 text-[12.5px] text-[var(--c-mute)]">
      <span className={cn('shrink-0', TONE[row.status.tone])}>{row.status.label}</span>
      <span aria-hidden className="text-[var(--c-faint)]">·</span>
      <span className="shrink-0">{MODE[t.mode] ?? t.mode}</span>
      <span aria-hidden className="text-[var(--c-faint)]">·</span>
      <span className="shrink-0 tabular-nums" title={`${exact(t.messages)} messages`}>
        {compact(t.messages)}
      </span>
      <span aria-hidden className="text-[var(--c-faint)]">·</span>
      <span className="min-w-0 truncate tabular-nums">
        <Time iso={t.last_activity} relative />
      </span>
    </span>
  )
}

export function BriefVariant() {
  const pane = useAgentPane(ROW)
  return (
    <Frame pane={pane} label="Agents">
      <style>{CSS}</style>
      <div className="flex h-14 shrink-0 items-baseline gap-2 px-4 pt-[18px]">
        <Link to="/" className="serif text-[20px] leading-none font-semibold tracking-[-0.01em]">
          Herbot
        </Link>
        <span className="text-[12px] text-[var(--c-faint)] tabular-nums">
          {pane.all.length.toLocaleString('en-GB')} agents
          {pane.unreadCount > 0 && <span className="text-[var(--c-accent)]"> · {pane.unreadCount} new</span>}
        </span>
      </div>
      <FilterBox q={pane.q} setQ={pane.setQ} id="brief-filter" className="px-3 pb-3" />
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
                  aria-label={rowLabel(row)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'relative flex w-full flex-col gap-0.5 border-b border-[var(--c-line)] px-4 py-2.5 text-left transition-[background-color] duration-150 ease-out',
                    active ? 'bg-[var(--c-sunken)] shadow-[inset_3px_0_0_var(--c-ink)]' : 'hover:bg-[var(--c-sunken)]',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <UserText className={cn('min-w-0 flex-1 font-medium', !t.enabled && 'text-[var(--c-faint)]')}>{t.name}</UserText>
                    {row.unread && (
                      <span className="shrink-0 rounded-full bg-[var(--c-accent)] px-1.5 text-[10.5px] leading-[16px] font-semibold text-[var(--c-accent-ink)]">
                        New
                      </span>
                    )}
                  </span>
                  <Facts row={row} />
                  {row.working && <span className="brief-bar" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Frame>
  )
}
