// Details variant "Summary" — axis: read first, edit in place. Every fact is
// a quiet row; tapping a value turns just that row into its control. The
// danger zone sits last, separated by space, and confirms inline in the row.
import { useState, type ReactNode } from 'react'
import { ChevronDownIcon, ExternalLinkIcon, PencilIcon } from 'lucide-react'
import { PURPOSE_MAX } from '../../format'
import { Time } from '../../ui'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { MODES, Monogram, Status, VOICES, charCount, count, exact, modeLabel, useAction, useSimTopic, voiceLabel, type Actions, type Sim } from './shared'

export function SummaryPane({ id }: { id: number }) {
  const { topic, error, actions } = useSimTopic(id)
  if (error) return <p className="p-5 text-[14px] text-[var(--c-off)]">Couldn’t load this topic. {error.message}</p>
  if (!topic) return <PaneSkeleton />
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <header className="flex flex-col items-center gap-2 px-5 pt-6 pb-5 text-center">
        <Monogram name={topic.name} size={64} />
        <h2 className="w-full text-[18px] leading-snug font-semibold">
          <UserText lines={2}>{topic.name}</UserText>
        </h2>
        <Status topic={topic} />
        <UserText lines={1} className="w-full text-[12px] text-[var(--c-faint)]">{topic.group}</UserText>
      </header>

      <Purpose topic={topic} actions={actions} />

      <dl className="border-t border-[var(--c-line)]">
        <ChoiceRow label="Mode" value={modeLabel(topic.mode)} options={MODES.map(([v, l, d]) => ({ v, l, d }))} current={topic.mode} onPick={actions.setMode} />
        <ToggleRow label="Spoken replies" on={topic.voice_replies} onChange={actions.setVoiceReplies} />
        <ChoiceRow label="Voice" value={voiceLabel(topic.voice)} options={VOICES.map(([v, l]) => ({ v, l }))} current={topic.voice} onPick={actions.setVoice} />
        <Row label="Language">
          <span className="text-[var(--c-faint)]" title="The admin API doesn’t report a topic’s language yet">Not reported</span>
        </Row>
        <Row label="Messages">{count(topic.messages)}</Row>
        <Row label="Last active"><Time iso={topic.last_activity} relative /></Row>
        <Row label="T3 thread">
          {topic.thread_link ? (
            <a href={topic.thread_link} className="inline-flex items-center gap-1 text-[var(--c-accent)]">
              Open <ExternalLinkIcon className="size-3.5" aria-hidden />
            </a>
          ) : (
            <span className="text-[var(--c-faint)]">Starts with the next message</span>
          )}
        </Row>
      </dl>

      <AgentsMd topic={topic} />
      <Danger topic={topic} actions={actions} />
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-[var(--c-line)] px-5 text-[14px]">
      <dt className="shrink-0 text-[var(--c-mute)]">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  )
}

function Purpose({ topic, actions }: { topic: Sim; actions: Actions }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const save = useAction()
  const long = (topic.purpose ?? '').length > 240

  async function submit() {
    if (await save.run(() => actions.setPurpose(draft))) setEditing(false)
  }

  if (editing) {
    const n = charCount(draft.trim())
    return (
      <form
        className="flex flex-col gap-2 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label htmlFor="sum-purpose" className="text-[13px] font-medium text-[var(--c-mute)]">Purpose</label>
        <textarea
          id="sum-purpose"
          dir="auto"
          autoFocus={!('ontouchstart' in window)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit()
            if (e.key === 'Escape') setEditing(false)
          }}
          aria-invalid={Boolean(save.error)}
          aria-describedby="sum-purpose-help"
          rows={7}
          className="field-sizing-content max-h-[50dvh] min-h-32 w-full resize-none rounded-lg bg-[var(--c-sunken)] p-3 text-[16px] leading-relaxed outline-none [overflow-wrap:anywhere] focus-visible:shadow-[0_0_0_2px_var(--c-accent)] aria-[invalid=true]:shadow-[0_0_0_2px_var(--c-off)] md:text-[14px]"
        />
        <div id="sum-purpose-help" className="flex items-start justify-between gap-3 text-[12px]">
          {save.error ? <p role="alert" className="text-[var(--c-off)]">{save.error}</p> : <p className="text-[var(--c-faint)]">⌘↵ saves · Esc cancels</p>}
          <span className={cn('shrink-0 tabular-nums', n > PURPOSE_MAX ? 'text-[var(--c-off)]' : 'text-[var(--c-faint)]')}>
            {exact(n)} / {exact(PURPOSE_MAX)}
          </span>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} disabled={save.pending} className="h-11 rounded-lg px-3 text-[14px] font-medium hover:bg-[var(--c-sunken)] md:h-9">
            Cancel
          </button>
          <button type="submit" disabled={save.pending} className="h-11 rounded-lg bg-[var(--c-accent)] px-4 text-[14px] font-medium text-[var(--c-accent-ink)] transition-[scale] duration-150 ease-out active:scale-[0.97] disabled:opacity-70 md:h-9">
            {save.pending ? 'Saving…' : 'Save purpose'}
          </button>
        </div>
      </form>
    )
  }

  return (
    <section aria-labelledby="sum-purpose-h" className="px-5 pb-5">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 id="sum-purpose-h" className="text-[13px] font-medium text-[var(--c-mute)]">Purpose</h3>
        <button
          type="button"
          onClick={() => {
            setDraft(topic.purpose ?? '')
            save.reset()
            setEditing(true)
          }}
          className="relative -mr-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-[var(--c-accent)] before:absolute before:-inset-y-1.5 hover:bg-[var(--c-sunken)]"
        >
          <PencilIcon className="size-3.5" aria-hidden /> Edit
        </button>
      </div>
      {topic.purpose ? (
        <>
          <UserText as="p" lines={open ? 'all' : 3} className="text-[14px] leading-relaxed">{topic.purpose}</UserText>
          {long && (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="relative mt-1 text-[13px] font-medium text-[var(--c-mute)] before:absolute before:-inset-x-2 before:-inset-y-3 hover:text-[var(--c-ink)]">
              {open ? 'Show less' : `Show all ${exact(charCount(topic.purpose))} characters`}
            </button>
          )}
        </>
      ) : (
        <p className="text-[14px] text-[var(--c-mute)]">No purpose yet. It answers once you give it one.</p>
      )}
      {save.done && <p className="mt-2 text-[12px] text-[var(--c-ok)]">Purpose saved.</p>}
    </section>
  )
}

function ChoiceRow({ label, value, options, current, onPick }: {
  label: string
  value: string
  options: { v: string; l: string; d?: string }[]
  current: string
  onPick: (v: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const act = useAction()
  const id = `sum-${label.toLowerCase().replace(/\W/g, '')}`
  return (
    <div className="border-b border-[var(--c-line)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-12 w-full items-center justify-between gap-4 px-5 text-left text-[14px] hover:bg-[var(--c-sunken)]"
      >
        <span className="text-[var(--c-mute)]">{label}</span>
        <span className="flex items-center gap-1.5">
          {act.pending ? <span className="text-[var(--c-faint)]">Saving…</span> : value}
          <ChevronDownIcon className={cn('size-4 text-[var(--c-faint)] transition-transform duration-150 ease-out', open && 'rotate-180')} aria-hidden />
        </span>
      </button>
      {open && (
        <div id={id} role="radiogroup" aria-label={label} className="grid gap-0.5 px-3 pb-3">
          {options.map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={o.v === current}
              disabled={act.pending}
              onClick={async () => {
                if (await act.run(() => onPick(o.v))) setOpen(false)
              }}
              className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-left text-[14px] hover:bg-[var(--c-sunken)] aria-checked:bg-[var(--c-accent-soft)]"
            >
              <span className={cn('size-4 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--c-faint)]', o.v === current && 'shadow-[inset_0_0_0_5px_var(--c-accent)]')} aria-hidden />
              <span className="grid">
                <span>{o.l}</span>
                {o.d && <span className="text-[12px] text-[var(--c-mute)]">{o.d}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {act.error && <p role="alert" className="px-5 pb-3 text-[13px] text-[var(--c-off)]">{act.error}</p>}
    </div>
  )
}

function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => Promise<void> }) {
  const act = useAction()
  return (
    <div className="border-b border-[var(--c-line)]">
      <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-5 text-[14px]">
        <span className="text-[var(--c-mute)]">{label}</span>
        <Toggle on={on} pending={act.pending} onToggle={() => act.run(() => onChange(!on))} label={label} />
      </label>
      {act.error && <p role="alert" className="px-5 pb-3 text-[13px] text-[var(--c-off)]">{act.error}</p>}
    </div>
  )
}

export function Toggle({ on, pending, onToggle, label }: { on: boolean; pending?: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={pending}
      disabled={pending}
      onClick={onToggle}
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full transition-[background-color] duration-150 ease-out before:absolute before:-inset-2.5 disabled:opacity-70',
        on ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-faint)]/45',
      )}
    >
      <span
        aria-hidden
        className={cn('absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none', on && 'translate-x-4')}
      />
    </button>
  )
}

function AgentsMd({ topic }: { topic: Sim }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="border-b border-[var(--c-line)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!topic.agents_md}
        className="flex min-h-12 w-full items-center justify-between gap-4 px-5 text-left text-[14px] hover:bg-[var(--c-sunken)] disabled:hover:bg-transparent"
      >
        <span className="text-[var(--c-mute)]">AGENTS.md</span>
        <span className="flex items-center gap-1.5 text-[var(--c-faint)]">
          {topic.agents_md ? (open ? 'Hide' : 'Show') : 'Written at setup'}
          {topic.agents_md && <ChevronDownIcon className={cn('size-4 transition-transform duration-150', open && 'rotate-180')} aria-hidden />}
        </span>
      </button>
      {open && topic.agents_md && (
        <pre className="scroller mx-5 mb-4 max-h-80 overflow-auto rounded-lg bg-[var(--c-sunken)] p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {topic.agents_md}
        </pre>
      )}
    </section>
  )
}

/** Danger zone: last, after a gap, each action confirmed inside its own row. */
function Danger({ topic, actions }: { topic: Sim; actions: Actions }) {
  const [asking, setAsking] = useState<null | 'slate' | 'forget' | 'off'>(null)
  const act = useAction()
  const items = [
    {
      key: 'slate' as const,
      title: 'Clean slate',
      what: `Deletes ${topic.messages === 1 ? '1 message' : `${exact(topic.messages)} messages`} and starts a new thread. The purpose stays.`,
      run: actions.cleanSlate,
    },
    { key: 'forget' as const, title: 'Forget this topic', what: 'Deletes its history and its purpose; it asks “what should I be here?” again.', run: actions.forget },
    topic.enabled
      ? { key: 'off' as const, title: 'Switch off', what: 'Messages there are ignored until you switch it back on.', run: () => actions.setEnabled(false) }
      : { key: 'off' as const, title: 'Switch on', what: 'It answers messages again.', run: () => actions.setEnabled(true) },
  ]
  return (
    <section aria-labelledby="sum-danger" className="mt-10 px-5 pb-8">
      <h3 id="sum-danger" className="mb-2 text-[13px] font-medium text-[var(--c-mute)]">Danger zone</h3>
      <ul className="overflow-hidden rounded-xl shadow-[inset_0_0_0_var(--hair)_var(--c-line)]">
        {items.map((it) => (
          <li key={it.key} className="border-b border-[var(--c-line)] p-4 last:border-b-0">
            {asking === it.key ? (
              <div className="flex flex-col gap-3">
                <p className="text-[14px] leading-relaxed"><span className="font-medium">{it.title}?</span> {it.what}</p>
                {act.error && <p role="alert" className="text-[13px] text-[var(--c-off)]">{act.error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setAsking(null)} disabled={act.pending} className="h-11 rounded-lg px-3 text-[14px] font-medium hover:bg-[var(--c-sunken)] md:h-9">
                    Keep it
                  </button>
                  <button
                    type="button"
                    disabled={act.pending}
                    onClick={async () => {
                      if (await act.run(it.run)) setAsking(null)
                    }}
                    className={cn('h-11 rounded-lg px-4 text-[14px] font-medium transition-[scale] duration-150 ease-out active:scale-[0.97] disabled:opacity-70 md:h-9', it.title === 'Switch on' ? 'bg-[var(--c-accent)] text-[var(--c-accent-ink)]' : 'bg-[var(--c-off)] text-white')}
                  >
                    {act.pending ? 'Working…' : it.title}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  act.reset()
                  setAsking(it.key)
                }}
                className="grid w-full gap-0.5 text-left"
              >
                <span className={cn('text-[14px] font-medium', it.title === 'Switch on' ? 'text-[var(--c-accent)]' : 'text-[var(--c-off)]')}>{it.title}…</span>
                <span className="text-[13px] text-[var(--c-mute)]">{it.what}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function PaneSkeleton() {
  return (
    <div className="flex flex-col items-center gap-3 p-6" aria-busy="true" aria-label="Loading topic">
      <span className="size-16 animate-pulse rounded-full bg-[var(--c-sunken)] motion-reduce:animate-none" />
      <span className="h-5 w-40 animate-pulse rounded bg-[var(--c-sunken)] motion-reduce:animate-none" />
      <span className="h-4 w-24 animate-pulse rounded bg-[var(--c-sunken)] motion-reduce:animate-none" />
    </div>
  )
}
