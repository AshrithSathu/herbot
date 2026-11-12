// K5 dialog prototype: the page the actions live on, the New agent form and
// the consequences copy, shared by every variant (throwaway). Variants differ
// in how the confirmation is presented and how the destructive act is guarded.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createTopic } from '../../api'
import { charCount, PURPOSE_MAX, purposeProblem } from '../../format'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { AgentRows, PaneHeader, Shell, fakeCall, useStress, ErrorId, type Stress } from '../feedback/frame'

export { useStress, Loading, ErrorId, fakeCall } from '../feedback/frame'
export type { Stress } from '../feedback/frame'

export const NAME_MAX = 128

export function useIsPhone() {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const mq = matchMedia('(max-width: 767px)')
    const update = () => setPhone(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return phone
}

export const isTouch = () => typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches

export type Kind = 'clean-slate' | 'forget-topic' | 'forget-memory'

/** What each destructive action does, said once and reused by every variant. */
export const ACTS: Record<Kind, { verb: string; title: string; done: string; consequences: string[]; keeps: string }> = {
  'clean-slate': {
    verb: 'Start a clean slate',
    title: 'Start a clean slate?',
    done: 'Clean slate done. The next message starts a fresh thread.',
    consequences: ['Deletes this topic’s message history in Herbot', 'Deletes its Codex threads in T3'],
    keeps: 'Keeps the purpose, the Telegram topic and shared memories.',
  },
  'forget-topic': {
    verb: 'Forget this topic',
    title: 'Forget this topic?',
    done: 'Forgotten. The Telegram topic is still there; its next message starts setup again.',
    consequences: ['Deletes the history, the threads and the purpose', 'Removes its tasks'],
    keeps: 'Keeps the Telegram topic and shared memories.',
  },
  'forget-memory': {
    verb: 'Forget',
    title: 'Forget this memory?',
    done: 'Forgotten. Agents won’t recall it any more.',
    consequences: ['Every agent stops recalling it'],
    keeps: 'Nothing else changes.',
  },
}

/** The thing being destroyed, quoted so there's no doubt which. */
export function Subject({ kind, s }: { kind: Kind; s: Stress }) {
  if (kind === 'forget-memory') {
    return (
      <blockquote className="scroller max-h-40 overflow-y-auto rounded-lg bg-[var(--c-sunken)] px-3 py-2.5 text-sm leading-relaxed">
        <UserText lines="all" as="p">
          {s.longMemory?.content}
        </UserText>
      </blockquote>
    )
  }
  return (
    <p className="rounded-lg bg-[var(--c-sunken)] px-3 py-2.5 text-sm">
      <UserText lines={2} as="span" className="font-medium">
        {s.hostile?.name}
      </UserText>
    </p>
  )
}

export function Consequences({ kind }: { kind: Kind }) {
  const act = ACTS[kind]
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <ul className="flex flex-col gap-1">
        {act.consequences.map((c) => (
          <li key={c} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--c-off)]" aria-hidden />
            {c}
          </li>
        ))}
      </ul>
      <p className="text-[var(--c-mute)]">{act.keeps}</p>
    </div>
  )
}

/** A fake destructive call: the prototype never deletes stress data. */
export function useAct() {
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle')
  return {
    phase,
    run: async () => {
      setPhase('working')
      await fakeCall(null, 900)
      setPhase('done')
    },
    reset: () => setPhase('idle'),
  }
}

// ---------------------------------------------------------------------------
// New agent: one form, three presentations. Real create call: with Telegram
// off in the stress environment it fails with a real error id.

function nameProblem(name: string): string | null {
  const t = name.trim()
  if (!t) return 'Give it a name, like “Trip planner”.'
  if (charCount(t) > NAME_MAX) return `Keep the name under ${NAME_MAX} characters (it’s ${charCount(t)}).`
  return null
}

export function NewAgentForm({ onCancel, onPendingChange, autoFocus = true, className }: {
  onCancel: () => void
  onPendingChange?: (pending: boolean) => void
  autoFocus?: boolean
  className?: string
}) {
  const id = useId()
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [shown, setShown] = useState({ name: false, purpose: false })
  const [phase, setPhase] = useState<'editing' | 'creating' | 'failed'>('editing')
  const [failure, setFailure] = useState<{ id: string | null; text: string } | null>(null)
  const key = useRef(crypto.randomUUID())
  const nameRef = useRef<HTMLInputElement>(null)
  const purposeRef = useRef<HTMLTextAreaElement>(null)
  const nameErr = shown.name ? nameProblem(name) : null
  const purposeErr = shown.purpose ? purposeProblem(purpose) : null

  useEffect(() => {
    if (autoFocus && !isTouch()) nameRef.current?.focus()
  }, [autoFocus])

  async function submit() {
    setShown({ name: true, purpose: true })
    if (nameProblem(name)) return nameRef.current?.focus()
    if (purposeProblem(purpose)) return purposeRef.current?.focus()
    setPhase('creating')
    onPendingChange?.(true)
    try {
      await createTopic({ data: { name: name.trim(), purpose: purpose.trim(), idempotencyKey: key.current } })
      setPhase('editing')
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      const eid = text.match(/E-\d+/)?.[0] ?? null
      setFailure({ id: eid, text: text.replace(/^E-\d+:\s*/, '') })
      setPhase('failed')
    } finally {
      onPendingChange?.(false)
    }
  }

  const creating = phase === 'creating'
  const field =
    'w-full rounded-lg bg-[var(--c-sunken)] px-3 text-base outline-none placeholder:text-[var(--c-faint)] focus-visible:ring-2 focus-visible:ring-[var(--c-ink)]/25 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-[var(--c-off)]/60 disabled:opacity-60 md:text-sm'
  return (
    <form
      noValidate
      className={cn('flex flex-col gap-4', className)}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          Name
        </label>
        <input
          ref={nameRef}
          id={`${id}-name`}
          value={name}
          disabled={creating}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name && setShown((s) => ({ ...s, name: true }))}
          aria-invalid={Boolean(nameErr)}
          aria-describedby={nameErr ? `${id}-name-err` : `${id}-name-hint`}
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore
          className={cn(field, 'h-11')}
        />
        {nameErr ? (
          <p id={`${id}-name-err`} className="text-sm text-[var(--c-off)]">
            {nameErr}
          </p>
        ) : (
          <p id={`${id}-name-hint`} className="text-xs text-[var(--c-mute)]">
            Becomes the Telegram topic’s name.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`${id}-purpose`} className="text-sm font-medium">
            Purpose
          </label>
          <span className={cn('text-xs tabular-nums text-[var(--c-faint)]', charCount(purpose) > PURPOSE_MAX && 'text-[var(--c-off)]')}>
            {charCount(purpose).toLocaleString('en-GB')} / {PURPOSE_MAX.toLocaleString('en-GB')}
          </span>
        </div>
        <textarea
          ref={purposeRef}
          id={`${id}-purpose`}
          value={purpose}
          disabled={creating}
          rows={4}
          onChange={(e) => setPurpose(e.target.value)}
          onBlur={() => purpose && setShown((s) => ({ ...s, purpose: true }))}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          aria-invalid={Boolean(purposeErr)}
          aria-describedby={purposeErr ? `${id}-purpose-err` : undefined}
          placeholder="Help me plan trips: flights, hotels, day plans."
          className={cn(field, 'scroller max-h-48 min-h-24 resize-y py-2.5 leading-relaxed')}
        />
        {purposeErr && (
          <p id={`${id}-purpose-err`} className="text-sm text-[var(--c-off)]">
            {purposeErr}
          </p>
        )}
      </div>
      {phase === 'failed' && failure && (
        <div role="alert" className="flex flex-col gap-1.5 border-l-2 border-[var(--c-off)] pl-3 text-sm">
          <p className="font-medium">Couldn’t create the agent</p>
          <UserText lines={3} as="p" className="text-[var(--c-mute)]">
            {failure.text}
          </UserText>
          {failure.id && <ErrorId id={failure.id} className="-ml-2 self-start text-[var(--c-mute)]" />}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={creating}
          className="h-10 rounded-lg px-4 text-sm font-medium transition-colors duration-150 hover:bg-[var(--c-sunken)] disabled:opacity-50 pointer-coarse:h-11"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={creating}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--c-accent)] px-4 text-sm font-medium text-[var(--c-accent-ink)] transition-[opacity,scale] duration-150 ease-out active:scale-[0.96] disabled:opacity-70 pointer-coarse:h-11"
        >
          {creating && <span className="size-3.5 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin" aria-hidden />}
          {creating ? 'Creating…' : phase === 'failed' ? 'Try again' : 'Create agent'}
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// The page every variant opens its dialogs from.

export function Stage({ s, newAgent, cleanSlate, forgetTopic, forgetMemory }: {
  s: Stress
  newAgent: ReactNode
  cleanSlate: ReactNode
  forgetTopic: ReactNode
  forgetMemory: ReactNode
}) {
  return (
    <Shell
      agents={
        <>
          <div className="flex flex-col gap-2 px-3 pb-2">
            <div className="flex items-center justify-between gap-2 px-1 text-xs font-medium tracking-wide text-[var(--c-mute)] uppercase">
              <span>
                Agents <span className="tabular-nums">{s.topics.length}</span>
              </span>
            </div>
            {newAgent}
          </div>
          <AgentRows topics={s.topics} />
        </>
      }
      main={
        <div className="scroller flex-1 overflow-y-auto">
          <PaneHeader title={<UserText>{s.hostile?.name}</UserText>} meta="Ready · 18 messages" />
          <div className="flex max-w-2xl flex-col gap-8 px-5 py-6">
            <section aria-labelledby="st-memory" className="flex flex-col gap-2">
              <h2 id="st-memory" className="text-sm font-semibold">
                A memory this topic saved
              </h2>
              <div className="border-y-[length:var(--hair)] border-[var(--c-line)] py-3">{forgetMemory}</div>
            </section>
            <section aria-labelledby="st-danger" className="flex flex-col gap-2 pt-4">
              <h2 id="st-danger" className="text-sm font-semibold text-[var(--c-off)]">
                Danger zone
              </h2>
              <div className="divide-y-[length:var(--hair)] divide-[var(--c-line)] border-y-[length:var(--hair)] border-[var(--c-line)]">
                <div className="py-3">{cleanSlate}</div>
                <div className="py-3">{forgetTopic}</div>
              </div>
            </section>
          </div>
        </div>
      }
      below={null}
    />
  )
}

/** Row copy for a destructive action, shared so variants differ only in the
 * presentation of the confirmation. */
export function ActRow({ kind, s, trigger, status }: { kind: Kind; s: Stress; trigger: ReactNode; status?: ReactNode }) {
  if (kind === 'forget-memory') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3">
          <UserText lines={3} as="p" className="min-w-0 flex-1 text-sm">
            {s.longMemory?.content}
          </UserText>
          {trigger}
        </div>
        {status}
      </div>
    )
  }
  const act = ACTS[kind]
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{act.verb}</p>
          <p className="text-sm text-[var(--c-mute)]">{act.consequences.join('; ')}.</p>
        </div>
        {trigger}
      </div>
      {status}
    </div>
  )
}

export function Done({ kind, onReset }: { kind: Kind; onReset: () => void }) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-3 text-sm text-[var(--c-mute)]">
      <span className="size-1.5 rounded-full bg-[var(--c-ok)]" aria-hidden />
      {ACTS[kind].done}
      <span className="text-[var(--c-faint)]">(Prototype: nothing was deleted.)</span>
      <button type="button" onClick={onReset} className="relative font-medium text-[var(--c-accent)] before:absolute before:-inset-2 hover:underline">
        Reset
      </button>
    </p>
  )
}

export const triggerQuiet =
  'h-10 shrink-0 rounded-lg bg-[var(--c-sunken)] px-4 text-sm font-medium transition-[background-color,scale] duration-150 ease-out active:scale-[0.96] pointer-coarse:h-11'
export const triggerDanger =
  'h-10 shrink-0 rounded-lg px-4 text-sm font-medium text-[var(--c-off)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--c-off)_35%,transparent)] transition-[background-color,scale] duration-150 ease-out hover:bg-[color-mix(in_oklch,var(--c-off)_8%,transparent)] active:scale-[0.96] pointer-coarse:h-11'
