// Variant "In place" — axis: feedback lives where the content would be,
// sized like the filled state; no toasts, no glyphs; plain, direct copy.
import { useState } from 'react'
import { CheckIcon, PlusIcon, RotateCwIcon } from 'lucide-react'
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
  useHarnessState,
  useStress,
  type Stress,
} from './frame'

const button =
  'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-[background-color,scale] duration-150 ease-out active:scale-[0.96] pointer-coarse:h-11'
const primary = `${button} bg-[var(--c-accent)] text-[var(--c-accent-ink)]`
const quiet = `${button} bg-[var(--c-sunken)] hover:bg-[color-mix(in_oklab,var(--c-sunken)_88%,var(--c-ink))]`
const textButton =
  'relative font-medium text-[var(--c-accent)] underline-offset-4 before:absolute before:-inset-x-2 before:-inset-y-3 hover:underline'

export function InPlace() {
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
      <div className="flex flex-1 flex-col gap-3 px-4 pt-6">
        <h2 className="text-sm font-semibold">No agents yet</h2>
        <p className="text-sm text-[var(--c-mute)]">Each agent is a Telegram topic with its own purpose. Start one and tell it what it’s for.</p>
        <button type="button" className={cn(primary, 'self-start')}>
          <PlusIcon className="size-4" aria-hidden />
          New agent
        </button>
      </div>
    )
  }
  if (state === 'loading') {
    return (
      <div className="flex flex-1 flex-col px-2" aria-busy="true" aria-label="Loading agents">
        <div className="px-1 pb-2">
          <div className="k5-skel h-10" />
        </div>
        {Array.from({ length: 11 }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-3 px-2">
            <div className="k5-skel size-4" />
            <div className="k5-skel h-3.5 flex-1" style={{ maxWidth: `${55 + ((i * 37) % 40)}%` }} />
            <div className="k5-skel h-3 w-8" />
          </div>
        ))}
      </div>
    )
  }
  const shown = q ? s.topics.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())) : s.topics
  return (
    <>
      <FilterField value={q} onChange={setQ} />
      {shown.length === 0 ? (
        <div className="px-5 pt-3 text-sm">
          <p className="text-[var(--c-mute)]">
            No agent named “<UserText className="inline text-[var(--c-ink)]">{q}</UserText>”.
          </p>
          <button type="button" onClick={() => setQ('')} className={cn(textButton, 'mt-2')}>
            Clear search
          </button>
        </div>
      ) : (
        <AgentRows topics={shown} />
      )}
    </>
  )
}

function Main({ state, s }: { state: string; s: Stress }) {
  const [draft, setDraft] = useState('')
  const topic = s.topics.find((t) => t.id === 2)
  const header = <PaneHeader title={<UserText>{topic?.name}</UserText>} meta="Ready · 6,000 messages" />

  if (state === 'first-run') {
    return (
      <div className="scroller flex-1 overflow-y-auto">
        <PaneHeader title="Overview" meta="Nothing set up yet" />
        <div className="flex max-w-2xl flex-col gap-8 px-5 py-6">
          {[
            { title: 'Topics', line: 'No agents yet. New agent creates a topic in your Telegram group.', action: 'New agent' },
            { title: 'Tasks', line: 'No tasks. Ask any agent “remind me every morning…”, or add one here.', action: 'Add a task' },
            { title: 'Memory', line: 'Nothing remembered. Agents save facts when you say “remember…”.', action: 'Add a memory' },
          ].map((b) => (
            <section key={b.title} aria-labelledby={`fr-${b.title}`} className="flex flex-col gap-2">
              <h2 id={`fr-${b.title}`} className="serif text-xl font-semibold">
                {b.title}
              </h2>
              <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-y-[length:var(--hair)] border-[var(--c-line)] py-3">
                <p className="text-sm text-[var(--c-mute)]">{b.line}</p>
                <button type="button" className={textButton}>
                  {b.action}
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>
    )
  }

  if (state === 'no-results') return <NoResultsMain s={s} />

  if (state === 'loading') {
    return (
      <>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b-[length:var(--hair)] border-[var(--c-line)] pl-12 md:pl-5">
          <div className="flex flex-col gap-1.5">
            <div className="k5-skel h-3.5 w-48" />
            <div className="k5-skel h-3 w-28" />
          </div>
        </header>
        <div className="flex flex-1 flex-col justify-end gap-2 overflow-hidden p-5" aria-busy="true" aria-label="Loading the conversation">
          {[56, 92, 40, 120, 64, 48].map((h, i) => (
            <div key={i} className={cn('k5-skel rounded-2xl', i % 2 ? 'self-start' : 'self-end')} style={{ height: h, width: `${40 + ((i * 23) % 35)}%` }} />
          ))}
        </div>
        <Composer disabled value="" onChange={() => {}} onSend={() => {}} />
      </>
    )
  }

  if (state === 'failed') return <FailedMain s={s} header={header} />

  if (state === 'toasts') return <ActionsMain s={s} />

  const offline = state === 'offline'
  return (
    <>
      {header}
      <div className="scroller flex flex-1 flex-col overflow-y-auto p-5">
        {state === 'stale' && (
          <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--c-mute)]">
            <span className="size-1.5 rounded-full bg-[var(--c-warn)]" aria-hidden />
            Showing what was here 2 min ago. Couldn’t refresh.
            <button type="button" className={textButton}>
              Retry
            </button>
          </p>
        )}
        <div className="mt-auto">
          <Bubbles messages={s.messages} />
        </div>
      </div>
      <Composer
        disabled={offline}
        value={draft}
        onChange={setDraft}
        onSend={() => setDraft('')}
        note={
          offline && (
            <p className="mb-2 flex items-start gap-2 px-1 text-sm text-[var(--c-mute)]">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--c-warn)]" aria-hidden />
              Telegram isn’t connected, so this agent can’t hear you. Your draft stays here until it’s back.
            </p>
          )
        }
      />
    </>
  )
}

function NoResultsMain({ s }: { s: Stress }) {
  const [q, setQ] = useState('zzqx')
  const shown = q ? s.topics.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())) : s.topics
  return (
    <div className="scroller flex-1 overflow-y-auto">
      <PaneHeader title="Topics" meta={`${s.topics.length.toLocaleString('en-GB')} topics`} />
      <div className="flex max-w-3xl flex-col gap-3 py-4">
        <FilterField value={q} onChange={setQ} placeholder="Filter topics" />
        <div className="px-5">
          {shown.length === 0 ? (
            <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-y-[length:var(--hair)] border-[var(--c-line)] py-3 text-sm">
              <p className="min-w-0 text-[var(--c-mute)]">
                Nothing matches “<UserText className="inline text-[var(--c-ink)]">{q}</UserText>” in {s.topics.length} topics.
              </p>
              <button type="button" onClick={() => setQ('')} className={textButton}>
                Clear filter
              </button>
            </div>
          ) : (
            <TopicLedger topics={shown} />
          )}
        </div>
      </div>
    </div>
  )
}

function FailedMain({ s, header }: { s: Stress; header: React.ReactNode }) {
  const [phase, setPhase] = useState<'failed' | 'retrying' | 'loaded'>('failed')
  const [expanded, setExpanded] = useState(false)
  const error = s.error ?? { id: 'E-4005', message: 'Panel operation failed' }
  return (
    <>
      {header}
      <div className="scroller flex flex-1 flex-col overflow-y-auto p-5">
        {phase === 'loaded' ? (
          <div className="mt-auto">
            <Bubbles messages={s.messages} />
          </div>
        ) : (
          <section aria-live="polite" className="my-auto flex max-w-xl flex-col gap-3 self-center" aria-labelledby="ip-failed">
            <h2 id="ip-failed" className="text-base font-semibold">
              Couldn’t load this conversation
            </h2>
            <pre
              className={cn(
                'scroller rounded-lg bg-[var(--c-sunken)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-[var(--c-mute)] [overflow-wrap:anywhere]',
                expanded && 'max-h-72 overflow-auto',
              )}
            >
              <span className={expanded ? undefined : 'line-clamp-3'}>{error.message}</span>
            </pre>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={phase === 'retrying'} onClick={async () => {
                setPhase('retrying')
                await fakeCall(null, 1100)
                setPhase('loaded')
              }} className={primary}>
                <RotateCwIcon className={cn('size-4', phase === 'retrying' && 'motion-safe:animate-spin')} aria-hidden />
                {phase === 'retrying' ? 'Retrying…' : 'Retry'}
              </button>
              <button type="button" onClick={() => setExpanded((e) => !e)} className={quiet} aria-expanded={expanded}>
                {expanded ? 'Show less' : 'Show full error'}
              </button>
              <ErrorId id={error.id} className="text-[var(--c-mute)]" />
            </div>
          </section>
        )}
      </div>
      <Composer value="" onChange={() => {}} onSend={() => {}} />
    </>
  )
}

/** Outcomes of actions, each shown at the control that caused it. */
function ActionsMain({ s }: { s: Stress }) {
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [wipe, setWipe] = useState<'idle' | 'working' | 'failed'>('idle')
  const [forgotten, setForgotten] = useState(false)
  return (
    <div className="scroller flex-1 overflow-y-auto">
      <PaneHeader title="Outcomes" meta="Each result appears at the control that caused it" />
      <div className="flex max-w-2xl flex-col gap-8 px-5 py-6">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Save the purpose</h2>
          <div className="flex items-center gap-3">
            <button type="button" disabled={saved === 'saving'} className={primary} onClick={async () => {
              setSaved('saving')
              await fakeCall(null, 700)
              setSaved('saved')
              setTimeout(() => setSaved('idle'), 1800)
            }}>
              {saved === 'saving' ? 'Saving…' : 'Save purpose'}
            </button>
            {saved === 'saved' && (
              <span role="status" className="flex items-center gap-1.5 text-sm text-[var(--c-ok)]">
                <CheckIcon className="size-4" aria-hidden /> Saved
              </span>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Clean slate</h2>
          <div>
            <button type="button" disabled={wipe === 'working'} className={quiet} onClick={async () => {
              setWipe('working')
              await fakeCall(null, 900)
              setWipe('failed')
            }}>
              {wipe === 'working' ? 'Wiping…' : 'Start a clean slate'}
            </button>
          </div>
          {wipe === 'failed' && (
            <div role="alert" className="flex flex-col gap-1.5 border-l-2 border-[var(--c-off)] pl-3 text-sm">
              <p>
                Couldn’t wipe <UserText className="inline font-medium">{s.hostile?.name}</UserText>. Nothing was deleted.
              </p>
              <p className="text-[var(--c-mute)]">
                T3 refused to remove the project: it holds a thread Herbot didn’t start.
              </p>
              <div className="flex items-center gap-2">
                <button type="button" className={textButton} onClick={() => setWipe('idle')}>
                  Try again
                </button>
                <ErrorId id={s.error?.id ?? 'E-4005'} className="text-[var(--c-mute)]" />
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Forget a memory</h2>
          <div className="border-y-[length:var(--hair)] border-[var(--c-line)] py-3">
            {forgotten ? (
              <p role="status" className="flex min-h-[4.5rem] flex-wrap items-center gap-x-3 text-sm text-[var(--c-mute)]">
                Forgotten. Agents won’t recall it any more.
                <button type="button" className={textButton} onClick={() => setForgotten(false)}>
                  Undo
                </button>
              </p>
            ) : (
              <div className="flex min-h-[4.5rem] items-start gap-3">
                <UserText lines={3} as="p" className="min-w-0 flex-1 text-sm">
                  {s.longMemory?.content}
                </UserText>
                <button type="button" className={quiet} onClick={() => setForgotten(true)}>
                  Forget
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
