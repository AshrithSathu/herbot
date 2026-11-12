// Details variant "Form" — axis: always editable. The pane is a settings
// form: every control is live, changes collect into one draft, and a save
// bar pinned to the pane's bottom commits them together. Facts sit in a
// compact strip at the top; the danger zone is a separate tinted card whose
// actions confirm in a dialog.
import { useEffect, useMemo, useState } from 'react'
import { ExternalLinkIcon } from 'lucide-react'
import { PURPOSE_MAX } from '../../format'
import { Time } from '../../ui'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { Confirm, MODES, Monogram, Status, VOICES, charCount, count, exact, useAction, useSimTopic, type Actions, type Sim } from './shared'
import { PaneSkeleton, Toggle } from './summary'

export function FormPane({ id }: { id: number }) {
  const { topic, error, actions } = useSimTopic(id)
  if (error) return <p className="p-5 text-[14px] text-[var(--c-off)]">Couldn’t load this topic. {error.message}</p>
  if (!topic) return <PaneSkeleton />
  return <Settings key={topic.id} topic={topic} actions={actions} />
}

type Draft = { purpose: string; mode: string; voice_replies: boolean; voice: string; enabled: boolean }
const fromTopic = (t: Sim): Draft => ({ purpose: t.purpose ?? '', mode: t.mode, voice_replies: t.voice_replies, voice: t.voice, enabled: t.enabled })

function Settings({ topic, actions }: { topic: Sim; actions: Actions }) {
  const saved = useMemo(() => fromTopic(topic), [topic])
  const [draft, setDraft] = useState<Draft>(saved)
  const [touched, setTouched] = useState(false)
  const save = useAction()
  const dirtyKeys = (Object.keys(draft) as (keyof Draft)[]).filter((k) => draft[k] !== saved[k])
  const dirty = dirtyKeys.length > 0
  const n = charCount(draft.purpose.trim())
  const purposeError = touched && draft.purpose !== saved.purpose && n > PURPOSE_MAX ? `Keep it under ${exact(PURPOSE_MAX)} characters.` : null

  useEffect(() => {
    if (!save.done) return
    const t = setTimeout(save.reset, 1800)
    return () => clearTimeout(t)
  }, [save.done, save.reset])

  async function commit() {
    await save.run(async () => {
      if (draft.purpose !== saved.purpose) await actions.setPurpose(draft.purpose)
      if (draft.mode !== saved.mode) await actions.setMode(draft.mode)
      if (draft.voice_replies !== saved.voice_replies) await actions.setVoiceReplies(draft.voice_replies)
      if (draft.voice !== saved.voice) await actions.setVoice(draft.voice)
      if (draft.enabled !== saved.enabled) await actions.setEnabled(draft.enabled)
    })
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        void commit()
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'Enter') && dirty) {
          e.preventDefault()
          void commit()
        }
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-8">
        <header className="flex items-center gap-3">
          <Monogram name={topic.name} size={44} />
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
            <h2 className="text-[16px] leading-snug font-semibold"><UserText>{topic.name}</UserText></h2>
            <Status topic={topic} />
          </div>
        </header>

        <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-[var(--c-line)] text-[13px] shadow-[inset_0_0_0_var(--hair)_var(--c-line)]">
          <Fact label="Messages">{count(topic.messages)}</Fact>
          <Fact label="Active"><Time iso={topic.last_activity} relative /></Fact>
          <Fact label="Language"><span className="text-[var(--c-faint)]" title="The admin API doesn’t report it yet">—</span></Fact>
        </dl>
        <p className="mt-2 flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--c-faint)]">
          <span className="shrink-0">in</span>
          <UserText className="min-w-0">{topic.group}</UserText>
          {topic.thread_link && (
            <a href={topic.thread_link} className="ml-auto inline-flex shrink-0 items-center gap-1 text-[var(--c-accent)]">
              T3 thread <ExternalLinkIcon className="size-3" aria-hidden />
            </a>
          )}
        </p>

        <div className="mt-6 flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="form-purpose" className="text-[13px] font-medium">Purpose</label>
              <span className={cn('text-[12px] tabular-nums', n > PURPOSE_MAX ? 'text-[var(--c-off)]' : 'text-[var(--c-faint)]')}>
                {exact(n)} / {exact(PURPOSE_MAX)}
              </span>
            </div>
            <textarea
              id="form-purpose"
              dir="auto"
              value={draft.purpose}
              placeholder="What should this agent do? For example, “Help me plan trips.”"
              onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))}
              onBlur={() => setTouched(true)}
              aria-invalid={Boolean(purposeError)}
              rows={6}
              className="max-h-[40dvh] min-h-36 w-full resize-y rounded-lg bg-[var(--c-sunken)] p-3 text-[16px] leading-relaxed outline-none [overflow-wrap:anywhere] placeholder:text-[var(--c-faint)] focus-visible:shadow-[0_0_0_2px_var(--c-accent)] aria-[invalid=true]:shadow-[0_0_0_2px_var(--c-off)] md:text-[14px]"
            />
            {purposeError && <p role="alert" className="text-[13px] text-[var(--c-off)]">{purposeError}</p>}
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[13px] font-medium">Mode</legend>
            <div className="grid gap-1">
              {MODES.map(([v, l, d]) => (
                <label key={v} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-[14px] shadow-[inset_0_0_0_var(--hair)_var(--c-line)] has-checked:bg-[var(--c-accent-soft)] has-checked:shadow-[inset_0_0_0_1px_var(--c-accent)] has-focus-visible:shadow-[inset_0_0_0_2px_var(--c-accent)]">
                  <input type="radio" name="form-mode" value={v} checked={draft.mode === v} onChange={() => setDraft((x) => ({ ...x, mode: v }))} className="sr-only" />
                  <span className={cn('size-4 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--c-faint)]', draft.mode === v && 'shadow-[inset_0_0_0_5px_var(--c-accent)]')} aria-hidden />
                  <span className="grid">
                    <span className="font-medium">{l}</span>
                    <span className="text-[12px] text-[var(--c-mute)]">{d}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-3">
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-[14px]">
              <span className="grid">
                <span className="font-medium">Spoken replies</span>
                <span className="text-[12px] text-[var(--c-mute)]">Replies also arrive as voice notes.</span>
              </span>
              <Toggle on={draft.voice_replies} onToggle={() => setDraft((d) => ({ ...d, voice_replies: !d.voice_replies }))} label="Spoken replies" />
            </label>
            <div className="flex items-center justify-between gap-4">
              <label htmlFor="form-voice" className="text-[14px] font-medium">Voice</label>
              <select
                id="form-voice"
                value={draft.voice}
                onChange={(e) => setDraft((d) => ({ ...d, voice: e.target.value }))}
                className="h-11 min-w-40 rounded-lg bg-[var(--c-sunken)] px-3 text-[16px] outline-none focus-visible:shadow-[0_0_0_2px_var(--c-accent)] md:h-9 md:text-[14px]"
              >
                {VOICES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-[14px]">
              <span className="grid">
                <span className="font-medium">Answering</span>
                <span className="text-[12px] text-[var(--c-mute)]">Off: messages there are ignored.</span>
              </span>
              <Toggle on={draft.enabled} onToggle={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))} label="Answering" />
            </label>
          </div>

          {topic.agents_md && (
            <details className="group rounded-xl shadow-[inset_0_0_0_var(--hair)_var(--c-line)]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-[14px] font-medium">
                AGENTS.md <span className="text-[12px] font-normal text-[var(--c-faint)] group-open:hidden">Show</span>
              </summary>
              <pre className="scroller mx-3 mb-3 max-h-72 overflow-auto rounded-lg bg-[var(--c-sunken)] p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {topic.agents_md}
              </pre>
            </details>
          )}

          <DangerCard topic={topic} actions={actions} />
        </div>
      </div>

      <div
        className={cn(
          'flex shrink-0 items-center gap-3 border-t border-[var(--c-line)] bg-[var(--c-pane)] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          !dirty && !save.done && !save.error && 'hidden',
        )}
      >
        <p className={cn('min-w-0 flex-1 text-[13px]', save.error ? 'text-[var(--c-off)]' : 'text-[var(--c-mute)]')} role={save.error ? 'alert' : 'status'}>
          {save.error ?? (save.pending ? 'Saving…' : save.done && !dirty ? 'Saved.' : `${dirtyKeys.length} unsaved ${dirtyKeys.length === 1 ? 'change' : 'changes'}`)}
        </p>
        {dirty && (
          <>
            <button type="button" disabled={save.pending} onClick={() => setDraft(saved)} className="h-11 shrink-0 rounded-lg px-3 text-[14px] font-medium hover:bg-[var(--c-sunken)] md:h-9">
              Discard
            </button>
            <button type="submit" disabled={save.pending} className="h-11 shrink-0 rounded-lg bg-[var(--c-accent)] px-4 text-[14px] font-medium text-[var(--c-accent-ink)] transition-[scale] duration-150 ease-out active:scale-[0.97] disabled:opacity-70 md:h-9">
              {save.pending ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>
    </form>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5 bg-[var(--c-pane)] px-3 py-2.5">
      <dt className="text-[11px] text-[var(--c-mute)]">{label}</dt>
      <dd className="truncate text-[15px] font-medium">{children}</dd>
    </div>
  )
}

function DangerCard({ topic, actions }: { topic: Sim; actions: Actions }) {
  const [asking, setAsking] = useState<null | 'slate' | 'forget'>(null)
  const act = useAction()
  const copy = {
    slate: { title: 'Clean slate?', body: `This deletes ${exact(topic.messages)} messages and starts a new thread. The purpose stays. It can’t be undone.`, action: 'Clean slate', run: actions.cleanSlate },
    forget: { title: 'Forget this topic?', body: 'This deletes its history and purpose; it asks “what should I be here?” again. It can’t be undone.', action: 'Forget topic', run: actions.forget },
  }
  const c = asking ? copy[asking] : null
  return (
    <section aria-labelledby="form-danger" className="rounded-xl bg-[color-mix(in_oklch,var(--c-off)_6%,var(--c-pane))] p-4 shadow-[inset_0_0_0_var(--hair)_color-mix(in_oklch,var(--c-off)_30%,transparent)]">
      <h3 id="form-danger" className="text-[13px] font-medium text-[var(--c-off)]">Danger zone</h3>
      <p className="mt-0.5 text-[12px] text-[var(--c-mute)]">These can’t be undone.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => { act.reset(); setAsking('slate') }} className="h-11 rounded-lg bg-[var(--c-pane)] px-3 text-[14px] font-medium text-[var(--c-off)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--c-off)_35%,transparent)] md:h-9">
          Clean slate…
        </button>
        <button type="button" onClick={() => { act.reset(); setAsking('forget') }} className="h-11 rounded-lg bg-[var(--c-pane)] px-3 text-[14px] font-medium text-[var(--c-off)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--c-off)_35%,transparent)] md:h-9">
          Forget topic…
        </button>
      </div>
      {c && (
        <Confirm
          open
          onOpenChange={(o) => !o && setAsking(null)}
          title={c.title}
          body={c.body}
          action={c.action}
          pending={act.pending}
          error={act.error}
          onConfirm={async () => {
            if (await act.run(c.run)) setAsking(null)
          }}
        />
      )}
    </section>
  )
}
