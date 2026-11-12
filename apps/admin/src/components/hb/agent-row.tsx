// An agent in the agents pane (docs/design/DECISIONS.md, "Agent row"):
// Brief as the base (no avatar: the name is the identity; a "New" pill for
// unread; a thin running rule under a working agent), with Monogram's quiet
// purpose preview as the second line while the agent is fine. The second
// line turns into facts in colour only when the agent needs you.
import type { MouseEvent } from 'react'
import { Link } from '@tanstack/react-router'
import type { Topic } from '../../api'
import { compact, exact } from '../../format'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { topicModeLabel } from './modes'
import { MetaLine, topicTone } from './status'
import { When } from './when'

export const AGENT_ROW_CSS = `
.hb-working { position: absolute; inset-inline: 0; bottom: 0; height: 2px; overflow: hidden; pointer-events: none; }
.hb-working::before { content: ''; position: absolute; inset-block: 0; width: 30%; background: var(--accent-strong);
  animation: hb-working 1.4s cubic-bezier(0.45, 0, 0.55, 1) infinite; }
@keyframes hb-working { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
@media (prefers-reduced-motion: reduce) { .hb-working::before { animation: none; width: 100%; opacity: 0.5; } }
`

type AgentRowProps = {
  topic: Topic
  active?: boolean
  /** New messages since you last opened it. */
  unread?: boolean
  /** A turn is running now. */
  working?: boolean
  /** Called on click, before navigating. Call `event.preventDefault()` to
   * stay where you are (a picker, a management mode). */
  onSelect?: (id: number, event: MouseEvent<HTMLAnchorElement>) => void
  /** Roving focus: only one row is in the Tab order (AgentList sets it). */
  tabIndex?: number
  onFocus?: () => void
}

/** The row's accessible name: just the facts, never the whole purpose. */
function rowLabel(topic: Topic, label: string, working: boolean, unread: boolean): string {
  const name = topic.name.trim() || 'Untitled'
  return `${name}, ${label}${working ? ', working' : ''}${unread ? ', new messages' : ''}`
}

export function AgentRow({ topic: t, active = false, unread = false, working = false, onSelect, tabIndex, onFocus }: AgentRowProps) {
  const status = topicTone(t)
  const needsYou = status.tone !== 'ok'
  return (
    <Link
      to="/topics/$id"
      params={{ id: t.id }}
      onClick={(e) => onSelect?.(t.id, e)}
      tabIndex={tabIndex}
      onFocus={onFocus}
      data-agent-id={t.id}
      aria-label={rowLabel(t, status.label, working, unread)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex w-full flex-col gap-0.5 border-b border-line px-4 py-2.5 text-left outline-none transition-[background-color] duration-150 ease-out focus-visible:shadow-[inset_0_0_0_2px_var(--ring)] pointer-coarse:py-3',
        active ? 'bg-sunken shadow-[inset_3px_0_0_var(--ink)]' : 'hover:bg-sunken',
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <UserText className={cn('min-w-0 flex-1 text-[14px] font-medium', !t.enabled && 'text-faint')}>{t.name}</UserText>
        {unread ? (
          <span className="shrink-0 self-center rounded-full bg-accent-strong px-1.5 text-[10.5px] leading-4 font-semibold text-accent-ink">New</span>
        ) : (
          t.last_activity && <When iso={t.last_activity} format="list" className="shrink-0 text-[11.5px] text-faint" />
        )}
      </span>
      {working ? (
        <span className="truncate text-[12.5px] font-medium text-accent-strong">Working on a reply…</span>
      ) : needsYou ? (
        <MetaLine className="text-[12.5px] text-mute">
          {[
            <span key="s" className={cn(status.tone === 'warn' ? 'text-warning' : status.tone === 'off' ? 'text-destructive' : 'text-mute')}>
              {status.label}
            </span>,
            <span key="m">{topicModeLabel(t.mode)}</span>,
            <span key="n" className="tabular-nums" title={`${exact(t.messages)} messages`}>
              {compact(t.messages)} messages
            </span>,
          ]}
        </MetaLine>
      ) : (
        <UserText className="text-[12.5px] text-mute" fallback="No purpose yet">
          {t.purpose}
        </UserText>
      )}
      {working && <span className="hb-working" aria-hidden />}
    </Link>
  )
}
