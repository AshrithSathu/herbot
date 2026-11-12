// Controls variant "Quiet" — axes: segmented choices; quiet button weights
// (one small solid primary, everything else ghost or text); labels above.
import { useState } from 'react'
import { CheckIcon, CopyIcon, ExternalLinkIcon, PlayIcon, Trash2Icon } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { Confirm } from '../details/shared'
import { Toggle } from '../details/summary'
import { MODES, VOICES, useCopy, usePreview, useModKey, useSettingsForm, type Form } from './shared'

const focus = 'outline-none focus-visible:shadow-[0_0_0_2px_var(--c-accent)]'
const ghost = cn('inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-[14px] font-medium text-[var(--c-mute)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] active:scale-[0.97] disabled:opacity-50 md:h-8', focus)
const iconBtn = cn('relative grid size-11 place-items-center rounded-lg text-[var(--c-mute)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] active:scale-[0.96] md:size-8 md:before:absolute md:before:-inset-1', focus)

export function QuietControls() {
  const f = useSettingsForm()
  return (
    <div className="hb fixed inset-0 z-[45] overflow-y-auto antialiased">
      <div className="mx-auto max-w-[640px] px-4 py-6 md:py-12">
        <section className="rounded-2xl bg-[var(--c-pane)] shadow-[var(--c-raised)]">
          <Toolbar />
          {f.loadError ? (
            <p className="p-6 text-[14px] text-[var(--c-off)]">Couldn’t load the topic. {f.loadError.message}</p>
          ) : !f.ready ? (
            <p className="p-6 text-[14px] text-[var(--c-mute)]">Loading…</p>
          ) : (
            <Fields f={f} />
          )}
        </section>
        <DangerRow messages={f.messages} />
      </div>
    </div>
  )
}

function Toolbar() {
  const copy = useCopy()
  return (
    <header className="flex items-center gap-1 border-b border-[var(--c-line)] py-2 pr-2 pl-5">
      <h1 className="min-w-0 flex-1 text-[15px] font-semibold">Topic settings</h1>
      <button type="button" className={iconBtn} aria-label={copy.state === 'copied' ? 'Link copied' : 'Copy link'} title="Copy link" onClick={() => copy.copy(location.href)}>
        {copy.state === 'copied' ? <CheckIcon className="size-4 text-[var(--c-ok)]" aria-hidden /> : <CopyIcon className="size-4" aria-hidden />}
      </button>
      <a href="https://t3.codes" target="_blank" rel="noreferrer" className={iconBtn} aria-label="Open in T3 Code" title="Open in T3 Code">
        <ExternalLinkIcon className="size-4" aria-hidden />
      </a>
      {copy.state === 'failed' && <span role="alert" className="text-[12px] text-[var(--c-off)]">Couldn’t copy</span>}
    </header>
  )
}

function Fields({ f }: { f: Form }) {
  const preview = usePreview()
  const mod = useModKey()
  const v = f.values
  return (
    <form
      noValidate
      className="flex flex-col gap-6 p-5 md:p-6"
      onSubmit={async (e) => {
        e.preventDefault()
        const bad = await f.submit()
        if (bad) document.getElementById(`q-${bad}`)?.focus()
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') e.currentTarget.requestSubmit()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="q-name" className="text-[13px] font-medium">Name</label>
        <input
          id="q-name"
          dir="auto"
          value={v.name}
          onChange={(e) => f.set('name', e.target.value)}
          onBlur={() => f.blur('name')}
          aria-invalid={Boolean(f.errors.name)}
          aria-describedby={f.errors.name ? 'q-name-error' : undefined}
          autoComplete="off"
          spellCheck={false}
          className={cn('h-11 rounded-lg bg-[var(--c-sunken)] px-3 text-[16px] aria-[invalid=true]:shadow-[0_0_0_2px_var(--c-off)] md:h-9 md:text-[14px]', focus)}
        />
        {f.errors.name && <p id="q-name-error" className="text-[13px] text-[var(--c-off)]">{f.errors.name}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="q-purpose" className="text-[13px] font-medium">Purpose</label>
          <span className={cn('text-[12px] tabular-nums', f.purposeCount > f.PURPOSE_MAX ? 'text-[var(--c-off)]' : 'text-[var(--c-faint)]')}>
            {f.purposeCount.toLocaleString('en-GB')} / {f.PURPOSE_MAX.toLocaleString('en-GB')}
          </span>
        </div>
        <textarea
          id="q-purpose"
          dir="auto"
          value={v.purpose}
          onChange={(e) => f.set('purpose', e.target.value)}
          onBlur={() => f.blur('purpose')}
          aria-invalid={Boolean(f.errors.purpose)}
          aria-describedby={f.errors.purpose ? 'q-purpose-error' : undefined}
          rows={6}
          className={cn('max-h-[40dvh] min-h-32 resize-y rounded-lg bg-[var(--c-sunken)] p-3 text-[16px] leading-relaxed [overflow-wrap:anywhere] aria-[invalid=true]:shadow-[0_0_0_2px_var(--c-off)] md:text-[14px]', focus)}
        />
        {f.errors.purpose && <p id="q-purpose-error" className="text-[13px] text-[var(--c-off)]">{f.errors.purpose}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <p id="q-mode" className="text-[13px] font-medium">Default mode</p>
        <div role="radiogroup" aria-labelledby="q-mode" className="flex overflow-x-auto rounded-lg bg-[var(--c-sunken)] p-0.5 [scrollbar-width:none]">
          {MODES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={v.mode === key}
              onClick={() => f.set('mode', key)}
              className={cn('h-11 min-w-fit flex-1 rounded-md px-3 text-[13px] font-medium text-[var(--c-mute)] md:h-8', v.mode === key && 'bg-[var(--c-pane)] text-[var(--c-ink)] shadow-[var(--c-raised)]', focus)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-[var(--c-mute)]">{MODES.find(([k]) => k === v.mode)?.[2]}</p>
      </div>

      <div className="flex flex-col divide-y divide-[var(--c-line)]">
        <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 text-[14px]">
          Spoken replies
          <Toggle on={v.voiceReplies} onToggle={() => f.set('voiceReplies', !v.voiceReplies)} label="Spoken replies" />
        </label>
        <div className="flex min-h-12 items-center justify-between gap-3">
          <label htmlFor="q-voice" className="text-[14px]">Voice</label>
          <span className="flex items-center gap-1">
            <button type="button" className={ghost} disabled={preview.state === 'playing'} onClick={preview.play}>
              {preview.state === 'playing' ? <Spinner className="size-3.5" /> : <PlayIcon className="size-3.5" aria-hidden />}
              {preview.state === 'playing' ? 'Playing…' : 'Preview'}
            </button>
            <select id="q-voice" value={v.voice} onChange={(e) => f.set('voice', e.target.value)} className={cn('h-11 rounded-lg bg-transparent pr-1 text-right text-[16px] text-[var(--c-mute)] md:h-8 md:text-[14px]', focus)}>
              {VOICES.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </span>
        </div>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-[var(--c-line)] pt-4">
        <p role={f.status === 'failed' ? 'alert' : 'status'} className={cn('mr-auto min-w-0 text-[13px]', f.status === 'failed' ? 'text-[var(--c-off)]' : 'text-[var(--c-mute)]')}>
          {f.status === 'failed' ? f.error : f.status === 'saved' ? (
            <span className="inline-flex items-center gap-1 text-[var(--c-ok)]"><CheckIcon className="size-4" aria-hidden />Saved</span>
          ) : f.dirty ? 'Unsaved changes' : ''}
        </p>
        {f.dirty && (
          <button type="button" className={ghost} disabled={f.status === 'saving'} onClick={f.discard}>Discard</button>
        )}
        <button
          type="submit"
          disabled={f.status === 'saving' || !f.dirty}
          title={`Save (${mod}+Enter)`}
          className={cn('inline-flex h-11 items-center gap-1.5 rounded-lg bg-[var(--c-accent)] px-4 text-[14px] font-medium text-[var(--c-accent-ink)] transition-[scale,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-40 md:h-8', focus)}
        >
          {f.status === 'saving' && <Spinner className="size-3.5" />}
          {f.status === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </form>
  )
}

function DangerRow({ messages }: { messages: number }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  return (
    <div className="mt-6 flex items-center justify-between gap-4 px-1">
      <p className="text-[13px] text-[var(--c-mute)]">{done ? 'History cleared.' : 'Delete this topic’s history and start a new thread.'}</p>
      <button type="button" onClick={() => setOpen(true)} className={cn(ghost, 'shrink-0 whitespace-nowrap text-[var(--c-off)] hover:text-[var(--c-off)]')}>
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
