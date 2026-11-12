// Variant 2 "Signal" — colour lives only in a small dot; the word is plain
// text. Dense rows keep just the dot. Big numbers in tabular sans, with
// small uppercase labels.
import { compact, exact } from '../../format'
import { ACTIVITY, TASK_STATES, TONE_VAR, TOPIC_STATES, type Tone } from './data'
import { Showcase, type Language } from './showcase'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

function Dot({ tone, pulse, size = 'size-2' }: { tone: Tone; pulse?: boolean; size?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-block shrink-0 rounded-full', size)} style={{ background: TONE_VAR[tone] }}>
      {pulse && <span className="absolute inset-0 rounded-full motion-safe:animate-ping" style={{ background: TONE_VAR[tone], opacity: 0.45 }} />}
    </span>
  )
}

function Signal({ tone, label, pulse, danger }: { tone: Tone; label: string; pulse?: boolean; danger?: boolean }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2 text-[13px] whitespace-nowrap', danger ? 'text-[var(--c-off)]' : 'text-[var(--c-mute)]')}>
      <Dot tone={tone} pulse={pulse} />
      <span className="truncate">{label}</span>
    </span>
  )
}

const lang: Language = {
  name: 'Signal',
  blurb: 'Colour only in a small dot; the word stays plain text. Dense rows keep the dot alone. Numbers in tabular sans.',
  TopicState: ({ state, compact: small }) => {
    const s = TOPIC_STATES[state]
    if (small) {
      return (
        <span className="grid size-5 shrink-0 place-items-center" title={s.label}>
          <Dot tone={s.tone} />
          <span className="sr-only">{s.label}</span>
        </span>
      )
    }
    return <Signal tone={s.tone} label={s.label} />
  },
  TaskState: ({ state }) => <Signal tone={TASK_STATES[state].tone} label={TASK_STATES[state].label} />,
  Kind: ({ kind }) => <UserText className="font-mono text-[12px] text-[var(--c-mute)]">{kind}</UserText>,
  Activity: ({ state, compact: small }) => {
    const a = ACTIVITY[state]
    if (state === 'idle') return <Signal tone="muted" label="Idle" />
    return (
      <span className={cn(small && '[&>span]:text-[12px]')}>
        <Signal tone={a.tone} label={a.label} pulse={state === 'working' || state === 'transcribing'} danger={state === 'failed'} />
      </span>
    )
  },
  Unread: ({ n }) => (
    <span className="shrink-0 text-[12px] font-semibold text-[var(--c-accent)] tabular-nums" aria-label={`${n} unread`}>
      {n > 99 ? '99+' : n}
    </span>
  ),
  Figure: ({ label, value, of, alarm }) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt className="text-[11px] font-medium tracking-[0.06em] text-[var(--c-faint)] uppercase">{label}</dt>
      <dd className="flex items-baseline gap-1" title={exact(value)}>
        <span className={cn('text-[32px] leading-none font-semibold tracking-[-0.025em] tabular-nums', alarm && 'text-[var(--c-off)]')}>
          {compact(value)}
        </span>
        {of != null && <span className="text-[15px] font-medium text-[var(--c-faint)] tabular-nums">/{exact(of)}</span>}
      </dd>
    </div>
  ),
}

export function SignalVariant() {
  return <Showcase lang={lang} />
}
