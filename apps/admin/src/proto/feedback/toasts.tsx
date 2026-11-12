// Variant "Toasts" — axis: system feedback arrives as toasts with their
// actions (retry, undo, copy the error id); the page keeps its last good data
// or shows a small monochrome glyph. Copy is warm and speaks as Herbot.
import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangleIcon, CheckIcon, ClockIcon, InfoIcon, ListTodoIcon, BrainIcon, MessageCircleIcon, SearchIcon, UndoIcon, WifiOffIcon, XIcon } from 'lucide-react'
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
  useToasts,
  type Stress,
  type Toast,
} from './frame'

type Push = ReturnType<typeof useToasts>['push']

const pill =
  'inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition-[background-color,scale] duration-150 ease-out active:scale-[0.96] pointer-coarse:h-11'

export function ToastsVariant() {
  const s = useStress()
  const [state, setState] = useHarnessState()
  const toasts = useToasts()
  if (!s.ready) return <Loading />
  return (
    <Shell
      key={state}
      agents={<Agents state={state} s={s} />}
      main={<Main state={state} s={s} push={toasts.push} dismiss={toasts.dismiss} />}
      below={<StateBar state={state} onState={(next) => {
        toasts.toasts.forEach((t) => toasts.dismiss(t.id))
        setState(next)
      }} />}
      overlay={<Stack {...toasts} />}
    />
  )
}

/** A glyph in a soft circle: monochrome, one icon set, never an emoji. */
function Glyph({ icon: Icon }: { icon: typeof InfoIcon }) {
  return (
    <span aria-hidden className="grid size-12 place-items-center rounded-full bg-[var(--c-sunken)] text-[var(--c-mute)] select-none">
      <Icon className="size-5" strokeWidth={1.75} />
    </span>
  )
}

function Agents({ state, s }: { state: string; s: Stress }) {
  const [q, setQ] = useState(state === 'no-results' ? 'zzqx' : '')
  if (state === 'first-run') {
    return (
      <div className="flex flex-1 flex-col items-center gap-3 px-6 pt-12 text-center">
        <Glyph icon={MessageCircleIcon} />
        <p className="font-medium">Your agents will live here</p>
        <p className="text-sm text-[var(--c-mute)]">Start one and tell it what it’s for. It gets its own topic in your Telegram group.</p>
        <button type="button" className={cn(pill, 'mt-1 bg-[var(--c-accent)] text-[var(--c-accent-ink)]')}>
          Start an agent
        </button>
      </div>
    )
  }
  if (state === 'loading') {
    return (
      <div className="flex flex-1 flex-col gap-1 px-2" aria-busy="true" aria-label="Loading agents">
        <div className="k5-skel mx-1 mb-2 h-10 rounded-lg" />
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="k5-skel mx-1 h-11 rounded-lg" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    )
  }
  const shown = q ? s.topics.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())) : s.topics
  return (
    <>
      <FilterField value={q} onChange={setQ} />
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 pt-8 text-center">
          <Glyph icon={SearchIcon} />
          <p className="text-sm">
            Nothing called “<UserText className="inline font-medium">{q}</UserText>”.
          </p>
          <button type="button" className={cn(pill, 'bg-[var(--c-sunken)]')} onClick={() => setQ('')}>
            Show every agent
          </button>
        </div>
      ) : (
        <AgentRows topics={shown} />
      )}
    </>
  )
}

function Main({ state, s, push, dismiss }: { state: string; s: Stress; push: Push; dismiss: (id: number) => void }) {
  const topic = s.topics.find((t) => t.id === 2)
  const header = <PaneHeader title={<UserText>{topic?.name}</UserText>} meta="Ready · 6,000 messages" />
  const errorId = s.error?.id ?? 'E-4005'

  if (state === 'first-run') {
    return (
      <div className="scroller flex-1 overflow-y-auto">
        <PaneHeader title="Overview" meta="A fresh start" />
        <ul className="mx-auto grid max-w-3xl gap-4 px-5 py-8 sm:grid-cols-3">
          {[
            { icon: MessageCircleIcon, title: 'No agents yet', line: 'Each one is a topic with its own purpose.', act: 'Start an agent' },
            { icon: ListTodoIcon, title: 'No tasks yet', line: 'Tell any agent “remind me every morning…”.', act: 'Add a task' },
            { icon: BrainIcon, title: 'Nothing remembered', line: 'Say “remember…” and every agent will know.', act: 'Add a memory' },
          ].map((c) => (
            <li key={c.title} className="flex flex-col items-start gap-3 rounded-xl p-4 shadow-[var(--c-raised)]">
              <Glyph icon={c.icon} />
              <div>
                <p className="font-medium">{c.title}</p>
                <p className="text-sm text-[var(--c-mute)]">{c.line}</p>
              </div>
              <button type="button" className={cn(pill, 'bg-[var(--c-sunken)]')}>
                {c.act}
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (state === 'no-results') return <NoResults s={s} />
  if (state === 'loading') return <LoadingMain header={header} push={push} />
  if (state === 'failed') return <Failed s={s} header={header} push={push} dismiss={dismiss} errorId={errorId} />
  if (state === 'stale') return <Stale s={s} header={header} push={push} dismiss={dismiss} />
  if (state === 'offline') return <Offline s={s} header={header} push={push} dismiss={dismiss} />
  return <Outcomes s={s} push={push} errorId={errorId} />
}

function NoResults({ s }: { s: Stress }) {
  const [q, setQ] = useState('zzqx')
  const shown = q ? s.topics.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())) : s.topics
  return (
    <div className="scroller flex-1 overflow-y-auto">
      <PaneHeader title="Topics" meta={`${s.topics.length} topics`} />
      <div className="pt-3">
        <FilterField value={q} onChange={setQ} placeholder="Filter topics" />
      </div>
      <div className="px-5 py-3">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Glyph icon={SearchIcon} />
            <p className="max-w-sm text-sm">
              None of your {s.topics.length} topics match “<UserText className="inline font-medium">{q}</UserText>”. Try fewer letters?
            </p>
            <button type="button" className={cn(pill, 'bg-[var(--c-sunken)]')} onClick={() => setQ('')}>
              Clear the filter
            </button>
          </div>
        ) : (
          <TopicLedger topics={shown} />
        )}
      </div>
    </div>
  )
}

function LoadingMain({ header, push }: { header: ReactNode; push: Push }) {
  useEffect(() => {
    const id = setTimeout(() => push({ tone: 'info', title: 'Still loading', body: 'This conversation is long. Hang on a moment.' }), 2500)
    return () => clearTimeout(id)
  }, [push])
  return (
    <>
      {header}
      <div className="flex flex-1 flex-col justify-end gap-2 overflow-hidden p-5" aria-busy="true" aria-label="Loading the conversation">
        {[56, 92, 40, 120, 64, 48].map((h, i) => (
          <div key={i} className={cn('k5-skel rounded-2xl', i % 2 ? 'self-start' : 'self-end')} style={{ height: h, width: `${40 + ((i * 23) % 35)}%` }} />
        ))}
      </div>
      <Composer disabled value="" onChange={() => {}} onSend={() => {}} />
    </>
  )
}

function Failed({ s, header, push, dismiss, errorId }: { s: Stress; header: ReactNode; push: Push; dismiss: (id: number) => void; errorId: string }) {
  const [loaded, setLoaded] = useState(false)
  // Primitive deps: useStress builds a new error object every render.
  const first = (s.error?.message ?? 'Panel operation failed').split('\n')[0]
  useEffect(() => {
    let id = 0
    const retry = async () => {
      dismiss(id)
      await fakeCall(null, 1000)
      setLoaded(true)
      push({ tone: 'ok', title: 'Loaded', body: 'Sorry about that, it’s all here now.' })
    }
    id = push({ tone: 'fail', sticky: true, title: 'I couldn’t load this conversation', body: first, eid: errorId, action: { label: 'Retry', run: retry } })
    return () => dismiss(id)
  }, [first, errorId, push, dismiss])
  return (
    <>
      {header}
      <div className="scroller flex flex-1 flex-col overflow-y-auto p-5">
        {loaded ? (
          <div className="mt-auto">
            <Bubbles messages={s.messages} />
          </div>
        ) : (
          <div className="m-auto flex flex-col items-center gap-2 text-center">
            <Glyph icon={AlertTriangleIcon} />
            <p className="text-sm text-[var(--c-mute)]">This conversation didn’t load.</p>
          </div>
        )}
      </div>
      <Composer value="" onChange={() => {}} onSend={() => {}} />
    </>
  )
}

function Stale({ s, header, push, dismiss }: { s: Stress; header: ReactNode; push: Push; dismiss: (id: number) => void }) {
  useEffect(() => {
    const id = push({
      tone: 'info',
      title: 'Showing what I had 2 minutes ago',
      body: 'I couldn’t refresh just now.',
      action: { label: 'Retry', run: () => push({ tone: 'ok', title: 'Up to date' }) },
    })
    return () => dismiss(id)
  }, [push, dismiss])
  return (
    <>
      {header}
      <div className="scroller flex flex-1 flex-col overflow-y-auto p-5">
        <div className="mt-auto">
          <Bubbles messages={s.messages} />
        </div>
      </div>
      <Composer value="" onChange={() => {}} onSend={() => {}} />
    </>
  )
}

function Offline({ s, header, push, dismiss }: { s: Stress; header: ReactNode; push: Push; dismiss: (id: number) => void }) {
  const [draft, setDraft] = useState('')
  useEffect(() => {
    const id = push({ tone: 'info', sticky: true, title: 'Telegram’s offline', body: 'I’ll hold anything you send and deliver it when it reconnects.' })
    return () => dismiss(id)
  }, [push, dismiss])
  return (
    <>
      {header}
      <div className="scroller flex flex-1 flex-col overflow-y-auto p-5">
        <div className="mt-auto">
          <Bubbles messages={s.messages} />
        </div>
      </div>
      <Composer value={draft} onChange={setDraft} onSend={() => {
        if (!draft.trim()) return
        setDraft('')
        push({ tone: 'ok', title: 'Saved for later', body: 'It sends as soon as Telegram is back.' })
      }} />
    </>
  )
}

function Outcomes({ s, push, errorId }: { s: Stress; push: Push; errorId: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="scroller flex-1 overflow-y-auto">
      <PaneHeader title="Outcomes" meta="Results arrive as toasts" />
      <div className="flex max-w-xl flex-wrap gap-2 px-5 py-6">
        <button type="button" disabled={busy} className={cn(pill, 'bg-[var(--c-accent)] text-[var(--c-accent-ink)]')} onClick={async () => {
          setBusy(true)
          await fakeCall(null, 600)
          setBusy(false)
          push({ tone: 'ok', title: 'Purpose saved', body: 'The agent reads it before its next reply.' })
        }}>
          Save purpose
        </button>
        <button type="button" disabled={busy} className={cn(pill, 'bg-[var(--c-sunken)]')} onClick={async () => {
          setBusy(true)
          await fakeCall(null, 900)
          setBusy(false)
          push({ tone: 'fail', sticky: true, title: 'I couldn’t start a clean slate', body: `Nothing in “${s.hostile?.name ?? 'this topic'}” was deleted.`, eid: errorId, action: { label: 'Try again', run: () => {} } })
        }}>
          Start a clean slate
        </button>
        <button type="button" disabled={busy} className={cn(pill, 'bg-[var(--c-sunken)]')} onClick={() => push({ tone: 'info', title: 'Forgot one memory', action: { label: 'Undo', run: () => push({ tone: 'ok', title: 'Memory restored' }) } })}>
          Forget memory
        </button>
      </div>
    </div>
  )
}

const ICON: Record<Toast['tone'], typeof InfoIcon> = { ok: CheckIcon, fail: AlertTriangleIcon, info: InfoIcon }
const ICON_TONE: Record<Toast['tone'], string> = { ok: 'text-[var(--c-ok)]', fail: 'text-[var(--c-off)]', info: 'text-[var(--c-mute)]' }

function Stack({ toasts, dismiss, hover }: ReturnType<typeof useToasts>) {
  return (
    <section
      aria-label="Notifications"
      {...hover}
      className="pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+8.5rem)] z-50 flex flex-col items-stretch gap-2 bg-transparent md:inset-x-auto md:right-4 md:bottom-[7.75rem] md:w-[380px]"
    >
      {toasts.map((t) => {
        const Icon = t.title.startsWith('Telegram') ? WifiOffIcon : t.title.startsWith('Showing') ? ClockIcon : t.action?.label === 'Undo' ? UndoIcon : ICON[t.tone]
        return (
          <div
            key={t.id}
            role={t.tone === 'fail' ? 'alert' : 'status'}
            data-state={t.state}
            className="k5-enter pointer-events-auto flex gap-3 rounded-xl bg-[var(--c-pane)] p-3 pr-1 text-sm shadow-[var(--c-raised)]"
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', ICON_TONE[t.tone])} aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-medium">{t.title}</p>
              {t.body && (
                <UserText lines={2} as="p" className="text-[var(--c-mute)]">
                  {t.body}
                </UserText>
              )}
              {(t.action || t.eid) && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {t.action && (
                    <button
                      type="button"
                      onClick={() => {
                        t.action?.run()
                        dismiss(t.id)
                      }}
                      className="h-8 rounded-full bg-[var(--c-sunken)] px-3 font-medium active:scale-[0.96] pointer-coarse:h-11"
                    >
                      {t.action.label}
                    </button>
                  )}
                  {t.eid && <ErrorId id={t.eid} className="text-[var(--c-mute)]" />}
                </div>
              )}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="grid size-10 shrink-0 place-items-center self-start rounded-lg text-[var(--c-faint)] hover:text-[var(--c-ink)] pointer-coarse:size-11">
              <XIcon className="size-4" aria-hidden />
            </button>
          </div>
        )
      })}
    </section>
  )
}
