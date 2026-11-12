// Variant 3 "Glyph" — state as an icon in its colour, with the word in a
// tooltip (hover or keyboard focus) and for screen readers. Big numbers in
// serif numerals with the unit (M, /220) set small and apart.
import {
  ArrowUpIcon, AudioLinesIcon, BotIcon, CircleAlertIcon, CircleCheckIcon, CircleDashedIcon, CirclePauseIcon,
  CirclePlayIcon, CircleXIcon, CheckCheckIcon, DatabaseIcon, HourglassIcon, LoaderCircleIcon,
  MessageCircleQuestionIcon, PanelsTopLeftIcon, PowerOffIcon, RadioTowerIcon, SendIcon, TimerIcon, TriangleAlertIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { compact, exact } from '../../format'
import { ACTIVITY, TASK_STATES, TONE_VAR, TOPIC_STATES, type ActivityKey, type TaskStateKey, type Tone, type TopicStateKey } from './data'
import { Showcase, type Language } from './showcase'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type Icon = typeof CircleCheckIcon

const TOPIC_ICON: Record<TopicStateKey, Icon> = {
  ready: CircleCheckIcon,
  asking: MessageCircleQuestionIcon,
  waiting: HourglassIcon,
  unset: CircleDashedIcon,
  off: PowerOffIcon,
}
const TASK_ICON: Record<TaskStateKey, Icon> = {
  active: CirclePlayIcon,
  paused: CirclePauseIcon,
  done: CheckCheckIcon,
  cancelled: CircleXIcon,
}
const ACTIVITY_ICON: Record<ActivityKey, Icon> = {
  idle: CircleDashedIcon,
  working: LoaderCircleIcon,
  transcribing: AudioLinesIcon,
  sending: ArrowUpIcon,
  failed: CircleAlertIcon,
}

/** A kind's family, from its prefix ("turn.db", "agent.timeout", …). */
function kindIcon(kind: string): Icon {
  const k = kind.toLowerCase()
  if (k.includes('db')) return DatabaseIcon
  if (k.includes('timeout')) return TimerIcon
  if (k.includes('telegram')) return SendIcon
  if (k.startsWith('panel')) return PanelsTopLeftIcon
  if (k.startsWith('agent')) return BotIcon
  if (k.startsWith('x.')) return RadioTowerIcon
  return TriangleAlertIcon
}

/** An icon with its word in a tooltip. `interactive` makes it focusable so
 * keyboards reach the tooltip; inside a link it stays inert (the link's
 * own label carries the word). */
function Glyph({ icon: I, tone, label, interactive = true, spin }: { icon: Icon; tone: Tone; label: string; interactive?: boolean; spin?: boolean }) {
  const glyph = <I className={cn('size-4 shrink-0', spin && 'motion-safe:animate-spin')} style={{ color: TONE_VAR[tone] }} aria-hidden />
  if (!interactive) {
    return (
      <span className="grid size-5 shrink-0 place-items-center" title={label}>
        {glyph}
        <span className="sr-only">{label}</span>
      </span>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="relative grid size-6 shrink-0 place-items-center rounded-md outline-none before:absolute before:-inset-2.5 focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]/40"
        >
          {glyph}
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  )
}

function Num({ value, unitClass, children }: { value: string; unitClass?: string; children?: ReactNode }) {
  // "19.8M" → numeral "19.8", unit "M" set small.
  const m = value.match(/^([\d.,]+)([A-Za-z]*)$/)
  return (
    <>
      <span>{m ? m[1] : value}</span>
      {m?.[2] && <span className={cn('ml-0.5 font-sans text-[18px] font-medium tracking-normal text-[var(--c-mute)]', unitClass)}>{m[2]}</span>}
      {children}
    </>
  )
}

const lang: Language = {
  name: 'Glyph',
  blurb: 'An icon in the state’s colour; the word appears on hover or keyboard focus, and is always read to screen readers.',
  TopicState: ({ state, compact: inRow }) => (
    <Glyph icon={TOPIC_ICON[state]} tone={TOPIC_STATES[state].tone} label={TOPIC_STATES[state].label} interactive={!inRow} />
  ),
  TaskState: ({ state }) => <Glyph icon={TASK_ICON[state]} tone={TASK_STATES[state].tone} label={TASK_STATES[state].label} />,
  Kind: ({ kind }) => (
    <span className="flex min-w-0 items-center gap-2">
      <Glyph icon={kindIcon(kind)} tone="danger" label={kind} />
      <span className="sr-only">{kind}</span>
    </span>
  ),
  Activity: ({ state, compact: inRow }) => (
    <Glyph
      icon={ACTIVITY_ICON[state]}
      tone={ACTIVITY[state].tone}
      label={ACTIVITY[state].label}
      interactive={!inRow}
      spin={state === 'working'}
    />
  ),
  Unread: ({ n }) => (
    <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[var(--c-accent)] px-1 text-[11px] font-semibold text-[var(--c-accent-ink)] tabular-nums" aria-label={`${n} unread`}>
      {n > 99 ? '99+' : n}
    </span>
  ),
  Figure: ({ label, value, of, alarm }) => (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[13px] text-[var(--c-mute)]">{label}</dt>
      <dd className={cn('serif flex items-baseline text-[42px] leading-none font-semibold tracking-[-0.02em] tabular-nums', alarm && 'text-[var(--c-off)]')} title={exact(value)}>
        <Num value={compact(value)}>
          {of != null && <span className="ml-1 font-sans text-[18px] font-medium tracking-normal text-[var(--c-faint)]">/{exact(of)}</span>}
        </Num>
      </dd>
    </div>
  ),
}

export function GlyphVariant() {
  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <Showcase lang={lang} />
    </TooltipProvider>
  )
}
