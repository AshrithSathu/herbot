// Variant 1 "Pills" — tinted pill badges: a soft wash of the state's colour
// with a dot and the word. Big numbers in serif numerals with the unit set
// small beside them.
import type { ReactNode } from 'react'
import { compact, exact } from '../../format'
import { ACTIVITY, TASK_STATES, TONE_VAR, TOPIC_STATES, type Tone } from './data'
import { Showcase, type Language } from './showcase'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

function Pill({ tone, children, small, pulse }: { tone: Tone; children: ReactNode; small?: boolean; pulse?: boolean }) {
  const c = TONE_VAR[tone]
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
        small ? 'h-5 px-2 text-[11px]' : 'h-6 px-2.5 text-[12px]',
      )}
      style={{ background: `color-mix(in oklch, ${c} 15%, var(--c-pane))`, color: `color-mix(in oklch, ${c} 72%, var(--c-ink))` }}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', pulse && 'motion-safe:animate-pulse')} style={{ background: c }} />
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Short words for dense rows; the full label stays for screen readers. */
const SHORT: Record<string, string> = {
  'Asking its purpose': 'Asking',
  'Waiting for a new purpose': 'New purpose',
  'Not set up': 'New',
}

const lang: Language = {
  name: 'Pills',
  blurb: 'Tinted pills: a soft wash of the state’s colour, a dot and the word. Numbers in serif numerals.',
  TopicState: ({ state, compact: small }) => {
    const s = TOPIC_STATES[state]
    return (
      <Pill tone={s.tone} small={small}>
        {small ? (
          <>
            <span aria-hidden>{SHORT[s.label] ?? s.label}</span>
            <span className="sr-only">{s.label}</span>
          </>
        ) : (
          s.label
        )}
      </Pill>
    )
  },
  TaskState: ({ state }) => <Pill tone={TASK_STATES[state].tone}>{TASK_STATES[state].label}</Pill>,
  Kind: ({ kind }) => (
    <span className="inline-flex h-6 max-w-full items-center rounded-full bg-[var(--c-sunken)] px-2.5 font-mono text-[12px] text-[var(--c-mute)]">
      <UserText>{kind}</UserText>
    </span>
  ),
  Activity: ({ state, compact: small }) => {
    const a = ACTIVITY[state]
    if (state === 'idle') return <span className="text-[13px] text-[var(--c-faint)]">Idle</span>
    return <Pill tone={a.tone} small={small} pulse={state === 'working' || state === 'transcribing'}>{a.label}</Pill>
  },
  Unread: ({ n }) => (
    <span
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--c-accent)] px-1.5 text-[11px] font-semibold text-[var(--c-accent-ink)] tabular-nums"
      aria-label={`${n} unread`}
    >
      {n > 99 ? '99+' : n}
    </span>
  ),
  Figure: ({ label, value, of, alarm }) => (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-[13px] text-[var(--c-mute)]">{label}</dt>
      <dd className="flex items-baseline gap-1.5" title={exact(value)}>
        <span className={cn('serif text-[40px] leading-none font-semibold tracking-[-0.02em] tabular-nums', alarm && 'text-[var(--c-off)]')}>
          {compact(value)}
        </span>
        {of != null && <span className="text-[13px] text-[var(--c-mute)] tabular-nums">of {exact(of)}</span>}
      </dd>
    </div>
  ),
}

export function PillsVariant() {
  return <Showcase lang={lang} />
}
