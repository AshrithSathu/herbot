// Status and count language (docs/design/DECISIONS.md, "Status language"):
// colour lives in a small dot, the word stays plain text; dense rows keep a
// short word (a dot alone fails colour-blind readers); overview figures use
// serif numerals.
import type { ComponentProps, ReactNode } from 'react'
import { compact, exact, topicStatus } from '../../format'
import { cn } from '@/lib/utils'

export type Tone = 'ok' | 'warn' | 'off' | 'idle' | 'active'

const DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  off: 'bg-off',
  idle: 'bg-faint',
  active: 'bg-accent-strong',
}

/** Words that need you are coloured too; calm ones stay muted. */
const WORD: Record<Tone, string> = {
  ok: 'text-mute',
  warn: 'text-warning',
  off: 'text-destructive',
  idle: 'text-mute',
  active: 'text-accent-strong',
}

export type Status = { tone: Tone; label: string; short: string }

/** A topic's status as one value: label, short word for dense rows, tone. */
export function topicTone(topic: Parameters<typeof topicStatus>[0]): Status {
  const { label, tone } = topicStatus(topic)
  const short =
    label === 'Waiting for a new purpose' ? 'New purpose' : label === 'Asking its purpose' ? 'Asking' : label
  return { label, short, tone: tone === 'success' ? 'ok' : tone === 'warning' ? 'warn' : tone === 'danger' ? 'off' : 'idle' }
}

/** Task lifecycle (tasks.status) in the same language. */
export function taskTone(status: string): Status {
  switch (status) {
    case 'active':
      return { tone: 'ok', label: 'Active', short: 'Active' }
    case 'paused':
      return { tone: 'warn', label: 'Paused', short: 'Paused' }
    case 'done':
      return { tone: 'idle', label: 'Done', short: 'Done' }
    case 'cancelled':
      return { tone: 'off', label: 'Deleted', short: 'Deleted' }
    default:
      return { tone: 'idle', label: status, short: status }
  }
}

type StatusDotProps = ComponentProps<'span'> & {
  status: Status
  /** Dense rows show the short word; the full label stays in the title. */
  dense?: boolean
}

export function StatusDot({ status, dense = false, className, ...props }: StatusDotProps) {
  return (
    <span
      title={dense && status.short !== status.label ? status.label : undefined}
      className={cn('inline-flex min-w-0 items-center gap-1.5 text-[13px]', WORD[status.tone], className)}
      {...props}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[status.tone])} />
      <span className="truncate">{dense ? status.short : status.label}</span>
      {dense && status.short !== status.label && <span className="sr-only">({status.label})</span>}
    </span>
  )
}

/** Just the dot, for places with their own words (tabs, the rail). */
export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', DOT[tone], className)} />
}

type BigNumberProps = {
  label: ReactNode
  value: number
  /** "of 220". */
  of?: number
  /** Colours the figure when it needs attention (errors). */
  alarm?: boolean
  /** Exact up to 99,999, then 120K / 19.8M (exact on hover). */
  compactAbove?: boolean
  className?: string
}

/** An overview figure: small uppercase label, serif numerals. */
export function BigNumber({ label, value, of, alarm = false, compactAbove = true, className }: BigNumberProps) {
  const shown = compactAbove ? compact(value) : exact(value)
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <dt className="truncate text-[11px] font-medium tracking-[0.06em] text-mute uppercase">{label}</dt>
      <dd className="flex min-w-0 items-baseline gap-1.5">
        <span
          title={shown !== exact(value) ? exact(value) : undefined}
          className={cn('font-serif text-[34px] leading-none font-semibold tracking-[-0.02em] tabular-nums', alarm && 'text-destructive')}
        >
          {shown}
        </span>
        {of !== undefined && <span className="truncate text-[13px] text-mute tabular-nums">of {exact(of)}</span>}
      </dd>
    </div>
  )
}

/**
 * Small facts joined by "·", wrapping without a dangling separator: each item
 * carries its separator in front, and the line's first separator is clipped
 * (the inner row is pulled left by one separator's width inside a clipping
 * box), so a wrap never leaves "·" at the end or the start of a line.
 */
export function MetaLine({ children, className }: { children: ReactNode[]; className?: string }) {
  const items = children.filter((c) => c !== null && c !== undefined && c !== false && c !== '')
  return (
    <div className={cn('min-w-0 overflow-hidden', className)}>
      <div className="-ml-[1.1em] flex min-w-0 flex-wrap items-baseline">
        {items.map((item, i) => (
          <span key={i} className="inline-flex min-w-0 items-baseline before:w-[1.1em] before:shrink-0 before:text-center before:text-faint before:content-['·']">
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}
