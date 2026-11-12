// Variant "Strip" — axis: system state lives in one status strip under the
// pane header (a glyph, a terse status line, its actions); content stays
// quiet underneath. Copy reads like a status report.
import { useState, type ReactNode } from 'react'
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, ClockIcon, ListChecksIcon, LoaderIcon, SearchXIcon, UndoIcon, WifiOffIcon } from 'lucide-react'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import {
  AgentRows,
  Bubbles,
  Composer,
  ErrorId,
  FilterField,
  Loading,
  PaneHeader,
  Shell,
  StateBar,
  TopicLedger,
  fakeCall,
  useCountdown,
  useHarnessState,
  useStress,
  type Stress,
} from './frame'

type Tone = 'info' | 'ok' | 'warn' | 'fail'

const TONE: Record<Tone, string> = {
  info: 'bg-[var(--c-sunken)] text-[var(--c-ink)]',
  ok: 'bg-[color-mix(in_oklab,var(--c-ok)_12%,var(--c-pane))] text-[var(--c-ink)]',
  warn: 'bg-[color-mix(in_oklab,var(--c-warn)_16%,var(--c-pane))] text-[var(--c-ink)]',
  fail: 'bg-[color-mix(in_oklab,var(--c-off)_12%,var(--c-pane))] text-[var(--c-ink)]',
}
const GLYPH_TONE: Record<Tone, string> = {
  info: 'text-[var(--c-mute)]',
  ok: 'text-[var(--c-ok)]',
  warn: 'text-[var(--c-warn)]',
  fail: 'text-[var(--c-off)]',
}

const action =
  'relative shrink-0 font-medium underline-offset-4 before:absolute before:-inset-x-1.5 before:-inset-y-3 hover:underline disabled:opacity-50'

function Strip({ tone, icon: Icon, children, actions, detail, live = 'polite' }: {
  tone: Tone
  icon: typeof ClockIcon
  children: ReactNode
  actions?: ReactNode
  detail?: ReactNode
  live?: 'polite' | 'assertive'
}) {
  const [open, setOpen] = useState(false)
  return (
    <div role={live === 'assertive' ? 'alert' : 'status'} className={cn('shrink-0 border-b-[length:var(--hair)] border-[var(--c-line)] text-sm', TONE[tone])}>
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 pl-12 md:pl-5">
        <Icon className={cn('size-4 shrink-0', GLYPH_TONE[tone])} aria-hidden />
        <span className="min-w-0 flex-1">{children}</span>
        <span className="flex items-center gap-3">
          {actions}
          {detail && (
            <button type="button" className={cn(action, 'inline-flex items-center gap-1')} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              Details
              <ChevronDownIcon className={cn('size-3.5 transition-transform duration-150', open && 'rotate-180')} aria-hidden />
            </button>
          )}
        </span>
      </div>
      {detail && open && <div className="px-5 pb-3 md:pl-12">{detail}</div>}
    </div>
  )
}

export function StripVariant() {
  const s = useStress()
  const [state, setState] = useHarnessState()
  if (!s.ready) return <Loading />
  return (
    <Shell
      key={state}
      agents={<Agents state={state} s={s} />}
      main={<Main state={state} s={s} />}
      below={<StateBar state={state} onState={setState} />}
    />
  )
}

function Agents({ state, s }: { state: string; s: Stress }) {
  const [q, setQ] = useState(state === 'no-results' ? 'zzqx' : '')
  if (state === 'first-run') {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex h-11 items-center justify-between px-4 text-sm text-[var(--c-mute)]">
          <span className="tabular-nums">0 agents</span>
          <button type="button" className={cn(action, 'text-[var(--c-accent)]')}>
            New agent
          </button>
        </div>
        <ul aria-hidden className="flex flex-col px-4 opacity-60">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-12 border-b-[length:var(--hair)] border-dashed border-[var(--c-line)]" />
          ))}
        </ul>
      </div>
    )
  }
  if (state === 'loading') {
    return (
      <div className="flex flex-1 flex-col" aria-busy="true" aria-label="Loading agents">
        <div className="k5-progress mx-3 mb-2 rounded-full bg-[var(--c-sunken)]" />
        <div className="flex-1 px-4 opacity-50">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="flex h-12 items-center border-b-[length:var(--hair)] border-[var(--c-line)]">
              <div className="h-3 rounded bg-[var(--c-sunken)]" style={{ width: `${45 + ((i * 29) % 45)}%` }} />
            </div>
          ))}
        </div>
      </div>
    )
  }
  const shown = q ? s.topics.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())) : s.topics
  return (
    <>
      <FilterField value={q} onChange={setQ} />
      {shown.length === 0 ? (
        <div role="status" className="mx-3 flex min-h-11 items-center gap-2 rounded-lg bg-[var(--c-sunken)] px-3 text-sm">
          <SearchXIcon className="size-4 shrink-0 text-[var(--c-mute)]" aria-hidden />
          <span className="flex-1 tabular-nums">0 / {s.topics.length} match</span>
          <button type="button" className={action} onClick={() => setQ('')}>
            Clear
          </button>
        </div>
      ) : (
        <AgentRows topics={shown} />
      )}
    </>
  )
}

function Main({ state, s }: { state: string; s: Stress }) {
  const topic = s.topics.find((t) => t.id === 2)
  const header = <PaneHeader title={<UserText>{topic?.name}</UserText>} meta="Ready · 6,000 messages" />
  switch (state) {
    case 'first-run':
      return (
        <>
          <PaneHeader title="Overview" />
          <Strip tone="info" icon={ListChecksIcon} actions={<button type="button" className={cn(action, 'text-[var(--c-accent)]')}>New agent</button>}>
            Setup 0 of 3 · agent · task · memory
          </Strip>
          <Placeholder lines={['Topics', 'Tasks', 'Memory']} />
        </>
      )
    case 'no-results':
      return <NoResults s={s} />
    case 'loading':
      return (
        <>
          {header}
          <div className="k5-progress bg-[var(--c-sunken)]" role="progressbar" aria-label="Loading the conversation" />
          <Strip tone="info" icon={LoaderIcon}>
            Loading conversation…
          </Strip>
          <div className="flex-1" />
          <Composer disabled value="" onChange={() => {}} onSend={() => {}} />
        </>
      )
    case 'failed':
      return <Failed s={s} header={header} />
    case 'stale':
      return <Stale s={s} header={header} />
    case 'offline':
      return <Offline s={s} header={header} />
    default:
      return <Outcomes s={s} />
  }
}

function Placeholder({ lines }: { lines: string[] }) {
  return (
    <div className="flex flex-col gap-6 px-5 py-6" aria-hidden>
      {lines.map((l) => (
        <div key={l} className="flex flex-col gap-2">
          <span className="text-xs font-medium tracking-wide text-[var(--c-faint)] uppercase">{l}</span>
          <div className="h-12 border-y-[length:var(--hair)] border-dashed border-[var(--c-line)]" />
        </div>
      ))}
    </div>
  )
}

function NoResults({ s }: { s: Stress }) {
  const [q, setQ] = useState('zzqx')
  const shown = q ? s.topics.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())) : s.topics
  return (
    <>
      <PaneHeader title="Topics" meta={`${s.topics.length} topics`} />
      <div className="pt-3">
        <FilterField value={q} onChange={setQ} placeholder="Filter topics" />
      </div>
      {shown.length === 0 && (
        <Strip tone="info" icon={SearchXIcon} actions={<button type="button" className={action} onClick={() => setQ('')}>Clear filter</button>}>
          <span className="tabular-nums">0 of {s.topics.length}</span> topics match “<UserText className="inline">{q}</UserText>”
        </Strip>
      )}
      <div className="scroller flex-1 overflow-y-auto px-5 py-3">{shown.length > 0 && <TopicLedger topics={shown} />}</div>
    </>
  )
}

function Failed({ s, header }: { s: Stress; header: ReactNode }) {
  const [phase, setPhase] = useState<'failed' | 'retrying' | 'loaded'>('failed')
  const error = s.error ?? { id: 'E-4005', message: 'Panel operation failed' }
  return (
    <>
      {header}
      {phase !== 'loaded' && (
        <Strip
          tone="fail"
          icon={AlertTriangleIcon}
          live="assertive"
          actions={
            <>
              <ErrorId id={error.id} />
              <button type="button" className={action} disabled={phase === 'retrying'} onClick={async () => {
                setPhase('retrying')
                await fakeCall(null, 1100)
                setPhase('loaded')
              }}>
                {phase === 'retrying' ? 'Retrying…' : 'Retry'}
              </button>
            </>
          }
          detail={
            <pre className="scroller max-h-56 overflow-auto rounded-md bg-[var(--c-pane)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--c-mute)] [overflow-wrap:anywhere]">
              {error.message}
            </pre>
          }
        >
          Load failed · conversation history
        </Strip>
      )}
      <div className="scroller flex flex-1 flex-col overflow-y-auto p-5">
        {phase === 'loaded' ? (
          <div className="mt-auto">
            <Bubbles messages={s.messages} />
          </div>
        ) : (
          <p className="m-auto text-sm text-[var(--c-faint)]">Conversation unavailable</p>
        )}
      </div>
      <Composer value="" onChange={() => {}} onSend={() => {}} />
    </>
  )
}

function Stale({ s, header }: { s: Stress; header: ReactNode }) {
  const [phase, setPhase] = useState<'stale' | 'retrying' | 'fresh'>('stale')
  return (
    <>
      {header}
      {phase !== 'fresh' && (
        <Strip
          tone="info"
          icon={ClockIcon}
          actions={
            <button type="button" className={action} disabled={phase === 'retrying'} onClick={async () => {
              setPhase('retrying')
              await fakeCall(null, 900)
              setPhase('fresh')
            }}>
              {phase === 'retrying' ? 'Refreshing…' : 'Retry'}
            </button>
          }
        >
          Updated 2 min ago · refresh failed
        </Strip>
      )}
      <div className="scroller flex flex-1 flex-col overflow-y-auto p-5">
        <div className="mt-auto">
          <Bubbles messages={s.messages} />
        </div>
      </div>
      <Composer value="" onChange={() => {}} onSend={() => {}} />
    </>
  )
}

function Offline({ s, header }: { s: Stress; header: ReactNode }) {
  const [draft, setDraft] = useState('')
  const [queued, setQueued] = useState(0)
  const [checking, setChecking] = useState(false)
  const left = useCountdown(12, () => {})
  return (
    <>
      {header}
      <Strip
        tone="warn"
        icon={WifiOffIcon}
        actions={
          <button type="button" className={action} disabled={checking} onClick={async () => {
            setChecking(true)
            await fakeCall(null, 900)
            setChecking(false)
          }}>
            {checking ? 'Checking…' : 'Retry now'}
          </button>
        }
      >
        Telegram disconnected · retrying in <span className="tabular-nums">{left}s</span>
        {queued > 0 && <span className="tabular-nums"> · {queued} queued</span>}
      </Strip>
      <div className="scroller flex flex-1 flex-col overflow-y-auto p-5">
        <div className="mt-auto">
          <Bubbles messages={s.messages} />
        </div>
      </div>
      <Composer value={draft} onChange={setDraft} onSend={() => {
        if (!draft.trim()) return
        setQueued((n) => n + 1)
        setDraft('')
      }} />
    </>
  )
}

type Event = { tone: Tone; icon: typeof ClockIcon; text: ReactNode; actions?: ReactNode }

/** Outcomes replace each other in the strip, newest first. */
function Outcomes({ s }: { s: Stress }) {
  const [event, setEvent] = useState<Event | null>(null)
  const [busy, setBusy] = useState(false)
  const errorId = s.error?.id ?? 'E-4005'
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PaneHeader title="Outcomes" meta="Each result replaces the last one in the strip" />
      {event ? (
        <Strip key={String(event.text)} tone={event.tone} icon={event.icon} actions={event.actions} live={event.tone === 'fail' ? 'assertive' : 'polite'}>
          {event.text}
        </Strip>
      ) : (
        <Strip tone="info" icon={ClockIcon}>
          No recent actions
        </Strip>
      )}
      <div className="flex max-w-xl flex-wrap gap-2 px-5 py-6">
        <button type="button" disabled={busy} className="h-10 rounded-lg bg-[var(--c-accent)] px-4 text-sm font-medium text-[var(--c-accent-ink)] active:scale-[0.96] pointer-coarse:h-11" onClick={() => run(async () => {
          await fakeCall(null, 600)
          setEvent({ tone: 'ok', icon: CheckIcon, text: 'Purpose saved · just now' })
        })}>
          Save purpose
        </button>
        <button type="button" disabled={busy} className="h-10 rounded-lg bg-[var(--c-sunken)] px-4 text-sm font-medium active:scale-[0.96] pointer-coarse:h-11" onClick={() => run(async () => {
          await fakeCall(null, 900)
          setEvent({
            tone: 'fail',
            icon: AlertTriangleIcon,
            text: (
              <>
                Clean slate failed · <UserText className="inline">{s.hostile?.name}</UserText> unchanged
              </>
            ),
            actions: (
              <>
                <ErrorId id={errorId} />
                <button type="button" className={action} onClick={() => setEvent(null)}>
                  Retry
                </button>
              </>
            ),
          })
        })}>
          Start a clean slate
        </button>
        <button type="button" disabled={busy} className="h-10 rounded-lg bg-[var(--c-sunken)] px-4 text-sm font-medium active:scale-[0.96] pointer-coarse:h-11" onClick={() => setEvent({
          tone: 'info',
          icon: UndoIcon,
          text: 'Forgot 1 memory',
          actions: (
            <button type="button" className={action} onClick={() => setEvent({ tone: 'ok', icon: CheckIcon, text: 'Memory restored' })}>
              Undo
            </button>
          ),
        })}>
          Forget memory
        </button>
      </div>
    </>
  )
}
