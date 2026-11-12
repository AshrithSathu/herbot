// Controls variant "Cards" — axes: radio cards that explain each choice;
// balanced buttons (medium, outlined secondary); labels inset inside the
// field's box, so a field and its name read as one object.
import { useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon, ExternalLinkIcon, PlayIcon, Trash2Icon } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { Confirm } from '../details/shared'
import { Toggle } from '../details/summary'
import { MODES, VOICES, useCopy, usePreview, useModKey, useSettingsForm, type Form } from './shared'

const ring = 'outline-none focus-visible:shadow-[0_0_0_2px_var(--c-accent)]'
const btn = cn('inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] px-4 text-[14px] font-medium transition-[scale,opacity,background-color] duration-150 ease-out active:scale-[0.97] disabled:opacity-40 md:h-10', ring)
const outline = cn(btn, 'shadow-[inset_0_0_0_1px_var(--c-line)] hover:bg-[var(--c-sunken)]')
const fill = cn(btn, 'bg-[var(--c-accent)] text-[var(--c-accent-ink)]')

export function CardsControls() {
  const f = useSettingsForm()
  return (
    <div className="hb fixed inset-0 z-[45] overflow-y-auto antialiased">
      <div className="mx-auto max-w-[680px] px-4 py-6 md:py-12">
        <Header />
        {f.loadError ? (
          <p className="mt-6 text-[14px] text-[var(--c-off)]">Couldn’t load the topic. {f.loadError.message}</p>
        ) : !f.ready ? (
          <p className="mt-6 text-[14px] text-[var(--c-mute)]">Loading…</p>
        ) : (
          <Fields f={f} />
        )}
        <Danger messages={f.messages} />
      </div>
    </div>
  )
}

function Header() {
  const copy = useCopy()
  return (
    <header className="flex items-center gap-2">
      <h1 className="min-w-0 flex-1 text-[20px] font-semibold tracking-tight">Topic settings</h1>
      {copy.state === 'failed' && <span role="alert" className="text-[12px] text-[var(--c-off)]">Couldn’t copy</span>}
      <button type="button" onClick={() => copy.copy(location.href)} className={cn(outline, 'w-11 px-0 md:w-10')} aria-label={copy.state === 'copied' ? 'Link copied' : 'Copy link'} title="Copy link">
        {copy.state === 'copied' ? <CheckIcon className="size-4 text-[var(--c-ok)]" aria-hidden /> : <CopyIcon className="size-4" aria-hidden />}
      </button>
      <a href="https://t3.codes" target="_blank" rel="noreferrer" className={cn(outline, 'w-11 px-0 md:w-10')} aria-label="Open in T3 Code" title="Open in T3 Code">
        <ExternalLinkIcon className="size-4" aria-hidden />
      </a>
    </header>
  )
}

/** The label sits inside the field's box; clicking anywhere in the box
 * focuses the control. */
function Inset({ id, label, aside, error, children }: { id: string; label: string; aside?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'flex cursor-text flex-col rounded-xl bg-[var(--c-pane)] px-3.5 pt-2.5 pb-1 shadow-[inset_0_0_0_1px_var(--c-line)] transition-[box-shadow] duration-150 ease-out focus-within:shadow-[inset_0_0_0_2px_var(--c-accent)]',
          error && 'shadow-[inset_0_0_0_2px_var(--c-off)] focus-within:shadow-[inset_0_0_0_2px_var(--c-off)]',
        )}
        onClick={() => document.getElementById(id)?.focus()}
      >
        <span className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className="text-[12px] font-medium text-[var(--c-mute)]">{label}</label>
          {aside}
        </span>
        {children}
      </div>
      {error && <p id={`${id}-error`} className="px-1 text-[13px] text-[var(--c-off)]">{error}</p>}
    </div>
  )
}

function Fields({ f }: { f: Form }) {
  const preview = usePreview()
  const mod = useModKey()
  const v = f.values
  return (
    <form
      noValidate
      className="mt-6 flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault()
        const bad = await f.submit()
        if (bad) document.getElementById(`c-${bad}`)?.focus()
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') e.currentTarget.requestSubmit()
      }}
    >
      <Inset id="c-name" label="Name" error={f.errors.name}>
        <input
          id="c-name"
          dir="auto"
          value={v.name}
          onChange={(e) => f.set('name', e.target.value)}
          onBlur={() => f.blur('name')}
          aria-invalid={Boolean(f.errors.name)}
          aria-describedby={f.errors.name ? 'c-name-error' : undefined}
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full bg-transparent text-[16px] outline-none md:text-[15px]"
        />
      </Inset>

      <Inset
        id="c-purpose"
        label="Purpose"
        error={f.errors.purpose}
        aside={<span className={cn('text-[12px] tabular-nums', f.purposeCount > f.PURPOSE_MAX ? 'text-[var(--c-off)]' : 'text-[var(--c-faint)]')}>{f.purposeCount.toLocaleString('en-GB')} / {f.PURPOSE_MAX.toLocaleString('en-GB')}</span>}
      >
        <textarea
          id="c-purpose"
          dir="auto"
          value={v.purpose}
          onChange={(e) => f.set('purpose', e.target.value)}
          onBlur={() => f.blur('purpose')}
          aria-invalid={Boolean(f.errors.purpose)}
          aria-describedby={f.errors.purpose ? 'c-purpose-error' : undefined}
          rows={6}
          className="max-h-[40dvh] min-h-32 w-full resize-y bg-transparent py-1.5 text-[16px] leading-relaxed outline-none [overflow-wrap:anywhere] md:text-[15px]"
        />
      </Inset>

      <fieldset className="mt-2 flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-medium">Default mode <span className="font-normal text-[var(--c-mute)]">· for messages from the panel</span></legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map(([key, label, desc], i) => (
            <label
              key={key}
              className={cn(
                'relative flex min-h-16 cursor-pointer gap-3 rounded-xl bg-[var(--c-pane)] p-3.5 shadow-[inset_0_0_0_1px_var(--c-line)] transition-[box-shadow,background-color] duration-150 ease-out has-checked:bg-[var(--c-accent-soft)] has-checked:shadow-[inset_0_0_0_2px_var(--c-accent)] has-focus-visible:shadow-[inset_0_0_0_2px_var(--c-accent)]',
                i === MODES.length - 1 && MODES.length % 2 === 1 && 'sm:col-span-2',
              )}
            >
              <input type="radio" name="c-mode" value={key} checked={v.mode === key} onChange={() => f.set('mode', key)} className="sr-only" />
              <span className={cn('mt-0.5 size-4 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--c-faint)]', v.mode === key && 'shadow-[inset_0_0_0_5px_var(--c-accent)]')} aria-hidden />
              <span className="grid gap-0.5">
                <span className="text-[14px] font-medium">{label}</span>
                <span className="text-[13px] leading-snug text-[var(--c-mute)]">{desc}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-xl bg-[var(--c-pane)] px-3.5 shadow-[inset_0_0_0_1px_var(--c-line)]">
          <span className="grid">
            <span className="text-[14px] font-medium">Spoken replies</span>
            <span className="text-[12px] text-[var(--c-mute)]">Also as voice notes</span>
          </span>
          <Toggle on={v.voiceReplies} onToggle={() => f.set('voiceReplies', !v.voiceReplies)} label="Spoken replies" />
        </label>
        <Inset
          id="c-voice"
          label="Voice"
          aside={
            <button type="button" onClick={(e) => { e.stopPropagation(); void preview.play() }} disabled={preview.state === 'playing'} className="relative inline-flex items-center gap-1 text-[12px] font-medium text-[var(--c-accent)] before:absolute before:-inset-3 disabled:opacity-60">
              {preview.state === 'playing' ? <Spinner className="size-3" /> : <PlayIcon className="size-3" aria-hidden />}
              {preview.state === 'playing' ? 'Playing…' : 'Preview'}
            </button>
          }
        >
          <select id="c-voice" value={v.voice} onChange={(e) => f.set('voice', e.target.value)} className="-ml-1 h-9 w-full bg-transparent text-[16px] outline-none md:text-[15px]">
            {VOICES.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </Inset>
      </div>

      <footer className="sticky bottom-0 mt-4 flex items-center gap-2 border-t border-[var(--c-line)] bg-[var(--c-canvas)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p role={f.status === 'failed' ? 'alert' : 'status'} className={cn('min-w-0 flex-1 text-[13px]', f.status === 'failed' ? 'text-[var(--c-off)]' : 'text-[var(--c-mute)]')}>
          {f.status === 'failed' ? f.error : f.status === 'saved' ? <span className="inline-flex items-center gap-1 text-[var(--c-ok)]"><CheckIcon className="size-4" aria-hidden />Saved</span> : f.dirty ? 'Unsaved changes' : 'All saved'}
        </p>
        <button type="button" className={outline} disabled={!f.dirty || f.status === 'saving'} onClick={f.discard}>Discard</button>
        <button type="submit" className={fill} disabled={!f.dirty || f.status === 'saving'} title={`Save (${mod}+Enter)`}>
          {f.status === 'saving' && <Spinner className="size-3.5" />}
          {f.status === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </form>
  )
}

function Danger({ messages }: { messages: number }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  return (
    <div className="mt-10 flex flex-col items-start gap-3 rounded-xl p-4 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--c-off)_35%,transparent)] sm:flex-row sm:items-center">
      <p className="min-w-0 flex-1 text-[13px] text-[var(--c-mute)]">
        <span className="font-medium text-[var(--c-off)]">Clean slate.</span> {done ? 'History cleared.' : `Deletes ${messages.toLocaleString('en-GB')} messages and starts a new thread.`}
      </p>
      <button type="button" className={cn(outline, 'text-[var(--c-off)]')} onClick={() => setOpen(true)}>
        <Trash2Icon className="size-3.5" aria-hidden /> Clean slate…
      </button>
      <Confirm
        open={open}
        onOpenChange={setOpen}
        title="Clean slate?"
        body={`This deletes ${messages.toLocaleString('en-GB')} messages and starts a new thread. It can’t be undone.`}
        action="Clean slate"
        pending={pending}
        error={null}
        onConfirm={async () => {
          setPending(true)
          await new Promise((r) => setTimeout(r, 900))
          setPending(false)
          setOpen(false)
          setDone(true)
        }}
      />
    </div>
  )
}
