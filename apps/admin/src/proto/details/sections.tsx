// Details variant "Sections" — axis: tabbed sections. A compact header, then
// About | Behaviour | Advanced. Behaviour's controls save the moment they
// change. The danger zone lives alone in Advanced, behind a typed
// confirmation, so it can never be hit while scanning facts.
import { useId, useState, type ReactNode } from 'react'
import { ExternalLinkIcon } from 'lucide-react'
import { PURPOSE_MAX } from '../../format'
import { Time } from '../../ui'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { MODES, Monogram, Status, VOICES, charCount, count, exact, useAction, useSimTopic, type Actions, type Sim } from './shared'
import { PaneSkeleton, Toggle } from './summary'

const TABS = ['About', 'Behaviour', 'Advanced'] as const
type Tab = (typeof TABS)[number]

export function SectionsPane({ id }: { id: number }) {
  const { topic, error, actions } = useSimTopic(id)
  const [tab, setTab] = useState<Tab>('About')
  const base = useId()
  if (error) return <p className="p-5 text-[14px] text-[var(--c-off)]">Couldn’t load this topic. {error.message}</p>
  if (!topic) return <PaneSkeleton />
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 px-5 pt-5 pb-4">
        <Monogram name={topic.name} size={40} />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
          <h2 className="text-[16px] leading-snug font-semibold"><UserText>{topic.name}</UserText></h2>
          <Status topic={topic} />
        </div>
      </header>
      <div
        role="tablist"
        aria-label="Topic details"
        className="mx-5 grid shrink-0 grid-cols-3 rounded-lg bg-[var(--c-sunken)] p-0.5"
        onKeyDown={(e) => {
          const i = TABS.indexOf(tab)
          if (e.key === 'ArrowRight') setTab(TABS[(i + 1) % 3])
          if (e.key === 'ArrowLeft') setTab(TABS[(i + 2) % 3])
        }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            id={`${base}-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`${base}-${t}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            className={cn(
              'h-11 rounded-md text-[13px] font-medium text-[var(--c-mute)] md:h-8',
              tab === t && 'bg-[var(--c-pane)] text-[var(--c-ink)] shadow-[var(--c-raised)]',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${base}-${tab}-panel`}
        aria-labelledby={`${base}-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-8"
      >
        {tab === 'About' && <About topic={topic} />}
        {tab === 'Behaviour' && <Behaviour topic={topic} actions={actions} />}
        {tab === 'Advanced' && <Advanced topic={topic} actions={actions} />}
      </div>
    </div>
  )
}

function About({ topic }: { topic: Sim }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        <Stat label="Messages" big>{count(topic.messages)}</Stat>
        <Stat label="Last active" big><Time iso={topic.last_activity} relative /></Stat>
        <Stat label="Group"><UserText>{topic.group}</UserText></Stat>
        <Stat label="Language"><span className="text-[var(--c-faint)]" title="The admin API doesn’t report it yet">Not reported</span></Stat>
      </dl>
      <section aria-labelledby="sec-purpose" className="border-t border-[var(--c-line)] pt-4">
        <h3 id="sec-purpose" className="mb-1.5 text-[13px] font-medium text-[var(--c-mute)]">Purpose</h3>
        {topic.purpose ? (
          <>
            <UserText as="p" lines={open ? 'all' : 3} className="text-[14px] leading-relaxed">{topic.purpose}</UserText>
            {topic.purpose.length > 240 && (
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="relative mt-1 text-[13px] font-medium text-[var(--c-mute)] before:absolute before:-inset-x-2 before:-inset-y-3 hover:text-[var(--c-ink)]">
                {open ? 'Show less' : 'Show all'}
              </button>
            )}
          </>
        ) : (
          <p className="text-[14px] text-[var(--c-mute)]">No purpose yet. Set one in Behaviour.</p>
        )}
      </section>
    </div>
  )
}

function Stat({ label, big, children }: { label: string; big?: boolean; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
      <dt className="text-[var(--c-mute)]">{label}</dt>
      <dd className={cn('min-w-0 truncate', big && 'text-[20px] font-semibold tracking-tight')}>{children}</dd>
    </div>
  )
}

function Behaviour({ topic, actions }: { topic: Sim; actions: Actions }) {
  const purpose = useAction()
  const mode = useAction()
  const voice = useAction()
  const toggles = useAction()
  const [draft, setDraft] = useState(topic.purpose ?? '')
  const changed = draft !== (topic.purpose ?? '')
  const n = charCount(draft.trim())
  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          void purpose.run(() => actions.setPurpose(draft))
        }}
      >
        <div className="flex items-baseline justify-between">
          <label htmlFor="sec-purpose-input" className="text-[13px] font-medium">Purpose</label>
          <span className={cn('text-[12px] tabular-nums', n > PURPOSE_MAX ? 'text-[var(--c-off)]' : 'text-[var(--c-faint)]')}>{exact(n)} / {exact(PURPOSE_MAX)}</span>
        </div>
        <textarea
          id="sec-purpose-input"
          dir="auto"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && changed) void purpose.run(() => actions.setPurpose(draft))
          }}
          aria-invalid={Boolean(purpose.error)}
          rows={5}
          className="max-h-[40dvh] min-h-32 w-full resize-y rounded-lg bg-[var(--c-sunken)] p-3 text-[16px] leading-relaxed outline-none [overflow-wrap:anywhere] focus-visible:shadow-[0_0_0_2px_var(--c-accent)] aria-[invalid=true]:shadow-[0_0_0_2px_var(--c-off)] md:text-[14px]"
        />
        <div className="flex min-h-9 items-center justify-between gap-3">
          <p className={cn('text-[12px]', purpose.error ? 'text-[var(--c-off)]' : 'text-[var(--c-faint)]')} role={purpose.error ? 'alert' : undefined}>
            {purpose.error ?? (purpose.done && !changed ? 'Saved.' : 'Saves when you press Save.')}
          </p>
          {changed && (
            <button type="submit" disabled={purpose.pending} className="h-11 shrink-0 rounded-lg bg-[var(--c-accent)] px-4 text-[14px] font-medium text-[var(--c-accent-ink)] transition-[scale] duration-150 ease-out active:scale-[0.97] disabled:opacity-70 md:h-9">
              {purpose.pending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </form>

      <div className="flex flex-col gap-1.5">
        <p id="sec-mode" className="text-[13px] font-medium">Mode</p>
        <div role="radiogroup" aria-labelledby="sec-mode" className="grid grid-cols-4 rounded-lg bg-[var(--c-sunken)] p-0.5">
          {MODES.map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={topic.mode === v}
              disabled={mode.pending}
              onClick={() => mode.run(() => actions.setMode(v))}
              className={cn('h-11 rounded-md text-[13px] font-medium text-[var(--c-mute)] md:h-8', topic.mode === v && 'bg-[var(--c-pane)] text-[var(--c-ink)] shadow-[var(--c-raised)]')}
            >
              {l}
            </button>
          ))}
        </div>
        <p className={cn('text-[12px]', mode.error ? 'text-[var(--c-off)]' : 'text-[var(--c-mute)]')}>
          {mode.error ?? (mode.pending ? 'Saving…' : MODES.find(([v]) => v === topic.mode)?.[2])}
        </p>
      </div>

      <div className="flex flex-col divide-y divide-[var(--c-line)] rounded-xl shadow-[inset_0_0_0_var(--hair)_var(--c-line)]">
        <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-4 text-[14px]">
          Spoken replies
          <Toggle on={topic.voice_replies} pending={toggles.pending} onToggle={() => toggles.run(() => actions.setVoiceReplies(!topic.voice_replies))} label="Spoken replies" />
        </label>
        <div className="flex min-h-12 items-center justify-between gap-4 px-4">
          <label htmlFor="sec-voice" className="text-[14px]">Voice</label>
          <select
            id="sec-voice"
            value={topic.voice}
            disabled={voice.pending}
            onChange={(e) => voice.run(() => actions.setVoice(e.target.value))}
            className="h-11 rounded-lg bg-transparent pr-1 text-right text-[16px] text-[var(--c-mute)] outline-none focus-visible:shadow-[0_0_0_2px_var(--c-accent)] md:h-9 md:text-[14px]"
          >
            {VOICES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>
      {(toggles.error || voice.error) && <p role="alert" className="text-[13px] text-[var(--c-off)]">{toggles.error ?? voice.error}</p>}
    </div>
  )
}

function Advanced({ topic, actions }: { topic: Sim; actions: Actions }) {
  return (
    <div className="flex flex-col gap-6">
      <dl className="flex flex-col divide-y divide-[var(--c-line)] text-[14px]">
        <div className="flex min-h-12 items-center justify-between gap-4">
          <dt className="text-[var(--c-mute)]">T3 thread</dt>
          <dd>
            {topic.thread_link ? (
              <a href={topic.thread_link} className="inline-flex items-center gap-1 text-[var(--c-accent)]">Open <ExternalLinkIcon className="size-3.5" aria-hidden /></a>
            ) : (
              <span className="text-[var(--c-faint)]">None yet</span>
            )}
          </dd>
        </div>
        <div className="flex min-h-12 items-center justify-between gap-4">
          <dt className="text-[var(--c-mute)]">AGENTS.md</dt>
          <dd className="min-w-0 truncate font-mono text-[12px] text-[var(--c-faint)]">{topic.agents_md_path ?? 'Written at setup'}</dd>
        </div>
      </dl>
      {topic.agents_md && (
        <pre className="scroller max-h-72 overflow-auto rounded-lg bg-[var(--c-sunken)] p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{topic.agents_md}</pre>
      )}
      <Danger topic={topic} actions={actions} />
    </div>
  )
}

const PHRASES = { slate: 'clean slate', forget: 'forget' } as const

function Danger({ topic, actions }: { topic: Sim; actions: Actions }) {
  const [which, setWhich] = useState<keyof typeof PHRASES>('slate')
  const [typed, setTyped] = useState('')
  const act = useAction()
  const off = useAction()
  const phrase = PHRASES[which]
  const ready = typed.trim().toLowerCase() === phrase
  return (
    <section aria-labelledby="sec-danger" className="flex flex-col gap-4 border-t border-[var(--c-line)] pt-5">
      <h3 id="sec-danger" className="text-[13px] font-medium text-[var(--c-off)]">Danger zone</h3>
      <div className="flex min-h-12 items-center justify-between gap-4">
        <span className="grid text-[14px]">
          {topic.enabled ? 'Switch off' : 'Switched off'}
          <span className="text-[12px] text-[var(--c-mute)]">{topic.enabled ? 'Messages there will be ignored.' : 'Messages there are ignored.'}</span>
        </span>
        <button
          type="button"
          disabled={off.pending}
          onClick={() => off.run(() => actions.setEnabled(!topic.enabled))}
          className="h-11 shrink-0 rounded-lg px-3 text-[14px] font-medium shadow-[inset_0_0_0_1px_var(--c-line)] hover:bg-[var(--c-sunken)] md:h-9"
        >
          {off.pending ? 'Saving…' : topic.enabled ? 'Switch off' : 'Switch on'}
        </button>
      </div>
      <form
        className="flex flex-col gap-3 rounded-xl p-4 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--c-off)_35%,transparent)]"
        onSubmit={async (e) => {
          e.preventDefault()
          if (ready && (await act.run(which === 'slate' ? actions.cleanSlate : actions.forget))) setTyped('')
        }}
      >
        <div role="radiogroup" aria-label="What to delete" className="grid grid-cols-2 gap-1 rounded-lg bg-[var(--c-sunken)] p-0.5">
          {(['slate', 'forget'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={which === k}
              onClick={() => {
                setWhich(k)
                setTyped('')
                act.reset()
              }}
              className={cn('h-11 rounded-md text-[13px] font-medium text-[var(--c-mute)] md:h-8', which === k && 'bg-[var(--c-pane)] text-[var(--c-off)] shadow-[var(--c-raised)]')}
            >
              {k === 'slate' ? 'Clean slate' : 'Forget topic'}
            </button>
          ))}
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--c-mute)]">
          {which === 'slate'
            ? `Deletes ${exact(topic.messages)} messages and starts a new thread. The purpose stays.`
            : 'Deletes the history and the purpose; it asks “what should I be here?” again.'}{' '}
          Type <span className="font-mono text-[var(--c-ink)]">{phrase}</span> to confirm.
        </p>
        <label htmlFor="sec-phrase" className="sr-only">Type {phrase} to confirm</label>
        <input
          id="sec-phrase"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore
          className="h-11 rounded-lg bg-[var(--c-sunken)] px-3 text-[16px] outline-none focus-visible:shadow-[0_0_0_2px_var(--c-off)] md:h-9 md:text-[14px]"
        />
        {act.error && <p role="alert" className="text-[13px] text-[var(--c-off)]">{act.error}</p>}
        {act.done && <p className="text-[13px] text-[var(--c-ok)]">Done.</p>}
        <button
          type="submit"
          disabled={!ready || act.pending}
          className="h-11 rounded-lg bg-[var(--c-off)] text-[14px] font-medium text-white transition-[scale,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-40 md:h-9"
        >
          {act.pending ? 'Working…' : which === 'slate' ? 'Clean slate' : 'Forget topic'}
        </button>
      </form>
      {off.error && <p role="alert" className="text-[13px] text-[var(--c-off)]">{off.error}</p>}
    </section>
  )
}
