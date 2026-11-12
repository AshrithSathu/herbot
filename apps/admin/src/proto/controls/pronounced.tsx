// Controls variant "Pronounced" — axes: select menus for choices; heavy,
// solid buttons (44px everywhere, filled secondary, solid destructive);
// labels in a left column on wide screens, stacked on phones.
import { useState, type ReactNode } from 'react'
import { CheckIcon, ChevronDownIcon, CopyIcon, ExternalLinkIcon, PlayIcon, Trash2Icon } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { Confirm } from '../details/shared'
import { Toggle } from '../details/summary'
import { MODES, VOICES, useCopy, usePreview, useModKey, useSettingsForm, type Form } from './shared'

const focus = 'outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--c-pane)]'
const solid = cn('inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold transition-[scale,opacity,background-color] duration-150 ease-out active:scale-[0.96] disabled:opacity-40', focus)
const primary = cn(solid, 'bg-[var(--c-accent)] text-[var(--c-accent-ink)] shadow-[0_1px_2px_oklch(0_0_0/0.12),0_4px_12px_-4px_color-mix(in_oklch,var(--c-accent)_60%,transparent)]')
const secondary = cn(solid, 'bg-[var(--c-sunken)] text-[var(--c-ink)] shadow-[inset_0_0_0_1px_var(--c-line)] hover:bg-[color-mix(in_oklch,var(--c-sunken)_80%,var(--c-ink)_6%)]')
const danger = cn(solid, 'bg-[var(--c-off)] text-white')
const icon = cn('grid size-11 place-items-center rounded-xl bg-[var(--c-sunken)] text-[var(--c-ink)] shadow-[inset_0_0_0_1px_var(--c-line)] transition-[scale] duration-150 ease-out active:scale-[0.96]', focus)

export function PronouncedControls() {
  const f = useSettingsForm()
  return (
    <div className="hb fixed inset-0 z-[45] overflow-y-auto antialiased">
      <div className="mx-auto max-w-[760px] px-4 py-6 md:py-12">
        <Header />
        <section className="mt-5 rounded-2xl bg-[var(--c-pane)] shadow-[var(--c-raised)]">
          {f.loadError ? (
            <p className="p-6 text-[14px] text-[var(--c-off)]">Couldn’t load the topic. {f.loadError.message}</p>
          ) : !f.ready ? (
            <p className="p-6 text-[14px] text-[var(--c-mute)]">Loading…</p>
          ) : (
            <Fields f={f} />
          )}
        </section>
        <Danger messages={f.messages} />
      </div>
    </div>
  )
}

function Header() {
  const copy = useCopy()
  return (
    <header className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-[var(--c-mute)]">Topic</p>
        <h1 className="serif text-[28px] leading-tight font-semibold">Settings</h1>
      </div>
      {copy.state === 'failed' && <span role="alert" className="pb-3 text-[12px] text-[var(--c-off)]">Couldn’t copy</span>}
      <button type="button" className={icon} aria-label={copy.state === 'copied' ? 'Link copied' : 'Copy link'} title="Copy link" onClick={() => copy.copy(location.href)}>
        {copy.state === 'copied' ? <CheckIcon className="size-[18px] text-[var(--c-ok)]" aria-hidden /> : <CopyIcon className="size-[18px]" aria-hidden />}
      </button>
      <a href="https://t3.codes" target="_blank" rel="noreferrer" className={icon} aria-label="Open in T3 Code" title="Open in T3 Code">
        <ExternalLinkIcon className="size-[18px]" aria-hidden />
      </a>
    </header>
  )
}

/** A label column on wide screens; stacked on phones. */
function Row({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-[var(--c-line)] px-5 py-5 last:border-b-0 md:grid-cols-[200px_minmax(0,1fr)] md:gap-6 md:px-6">
      <div className="grid content-start gap-0.5 md:pt-2.5">
        {htmlFor ? <label htmlFor={htmlFor} className="text-[14px] font-semibold">{label}</label> : <span className="text-[14px] font-semibold">{label}</span>}
        {hint && <span className="text-[12px] text-[var(--c-mute)]">{hint}</span>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function Select({ id, value, onChange, children }: { id: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn('h-11 w-full appearance-none rounded-xl bg-[var(--c-sunken)] pr-10 pl-3.5 text-[16px] shadow-[inset_0_0_0_1px_var(--c-line)] md:text-[15px]', focus)}>
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[var(--c-mute)]" aria-hidden />
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
      onSubmit={async (e) => {
        e.preventDefault()
        const bad = await f.submit()
        if (bad) document.getElementById(`p-${bad}`)?.focus()
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') e.currentTarget.requestSubmit()
      }}
    >
      <Row label="Name" htmlFor="p-name" hint="As it appears in Telegram.">
        <input
          id="p-name"
          dir="auto"
          value={v.name}
          onChange={(e) => f.set('name', e.target.value)}
          onBlur={() => f.blur('name')}
          aria-invalid={Boolean(f.errors.name)}
          aria-describedby={f.errors.name ? 'p-name-error' : undefined}
          autoComplete="off"
          spellCheck={false}
          className={cn('h-11 w-full rounded-xl bg-[var(--c-sunken)] px-3.5 text-[16px] shadow-[inset_0_0_0_1px_var(--c-line)] aria-[invalid=true]:shadow-[inset_0_0_0_2px_var(--c-off)] md:text-[15px]', focus)}
        />
        {f.errors.name && <p id="p-name-error" className="mt-2 text-[13px] font-medium text-[var(--c-off)]">{f.errors.name}</p>}
      </Row>

      <Row
        label="Purpose"
        htmlFor="p-purpose"
        hint={<span className={cn('tabular-nums', f.purposeCount > f.PURPOSE_MAX && 'text-[var(--c-off)]')}>{f.purposeCount.toLocaleString('en-GB')} of {f.PURPOSE_MAX.toLocaleString('en-GB')}</span>}
      >
        <textarea
          id="p-purpose"
          dir="auto"
          value={v.purpose}
          onChange={(e) => f.set('purpose', e.target.value)}
          onBlur={() => f.blur('purpose')}
          aria-invalid={Boolean(f.errors.purpose)}
          aria-describedby={f.errors.purpose ? 'p-purpose-error' : undefined}
          rows={7}
          className={cn('max-h-[40dvh] min-h-40 w-full resize-y rounded-xl bg-[var(--c-sunken)] p-3.5 text-[16px] leading-relaxed shadow-[inset_0_0_0_1px_var(--c-line)] [overflow-wrap:anywhere] aria-[invalid=true]:shadow-[inset_0_0_0_2px_var(--c-off)] md:text-[15px]', focus)}
        />
        {f.errors.purpose && <p id="p-purpose-error" className="mt-2 text-[13px] font-medium text-[var(--c-off)]">{f.errors.purpose}</p>}
      </Row>

      <Row label="Default mode" htmlFor="p-mode" hint="For messages sent from the panel.">
        <Select id="p-mode" value={v.mode} onChange={(m) => f.set('mode', m)}>
          {MODES.map(([k, l, d]) => (
            <option key={k} value={k}>{l} — {d}</option>
          ))}
        </Select>
      </Row>

      <Row label="Spoken replies" hint="Replies also arrive as voice notes.">
        <label className="flex h-11 cursor-pointer items-center gap-3 text-[15px]">
          <Toggle on={v.voiceReplies} onToggle={() => f.set('voiceReplies', !v.voiceReplies)} label="Spoken replies" />
          {v.voiceReplies ? 'On' : 'Off'}
        </label>
      </Row>

      <Row label="Voice" htmlFor="p-voice">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Select id="p-voice" value={v.voice} onChange={(x) => f.set('voice', x)}>
              {VOICES.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </Select>
          </div>
          <button type="button" className={secondary} disabled={preview.state === 'playing'} onClick={preview.play}>
            {preview.state === 'playing' ? <Spinner className="size-4" /> : <PlayIcon className="size-4" aria-hidden />}
            <span className="max-sm:sr-only">{preview.state === 'playing' ? 'Playing…' : 'Preview'}</span>
          </button>
        </div>
      </Row>

      <footer className="flex flex-col gap-3 rounded-b-2xl bg-[var(--c-sunken)] px-5 py-4 sm:flex-row sm:items-center md:px-6">
        <p role={f.status === 'failed' ? 'alert' : 'status'} className={cn('min-w-0 flex-1 text-[14px]', f.status === 'failed' ? 'font-medium text-[var(--c-off)]' : 'text-[var(--c-mute)]')}>
          {f.status === 'failed' ? f.error : f.status === 'saved' ? <span className="inline-flex items-center gap-1.5 font-medium text-[var(--c-ok)]"><CheckIcon className="size-4" aria-hidden />Saved</span> : f.dirty ? 'You have unsaved changes.' : 'Everything is saved.'}
        </p>
        <div className="flex gap-2">
          <button type="button" className={cn(secondary, 'flex-1 sm:flex-none')} disabled={!f.dirty || f.status === 'saving'} onClick={f.discard}>
            Discard
          </button>
          <button type="submit" className={cn(primary, 'flex-1 sm:flex-none')} disabled={!f.dirty || f.status === 'saving'} title={`Save (${mod}+Enter)`}>
            {f.status === 'saving' && <Spinner className="size-4" />}
            {f.status === 'saving' ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </footer>
    </form>
  )
}

function Danger({ messages }: { messages: number }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  return (
    <section aria-labelledby="p-danger" className="mt-8 rounded-2xl bg-[var(--c-pane)] p-5 shadow-[var(--c-raised)] md:p-6">
      <h2 id="p-danger" className="text-[15px] font-semibold">Clean slate</h2>
      <p className="mt-1 text-[14px] text-[var(--c-mute)]">{done ? 'History cleared. The next message starts a new thread.' : `Deletes ${messages.toLocaleString('en-GB')} messages and starts a new thread. The purpose stays.`}</p>
      <button type="button" className={cn(danger, 'mt-4 w-full sm:w-auto')} onClick={() => setOpen(true)}>
        <Trash2Icon className="size-4" aria-hidden /> Clean slate…
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
    </section>
  )
}
