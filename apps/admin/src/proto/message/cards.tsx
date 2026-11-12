// Variant "Cards" — document axis: your prompts are slim lines marked by an
// accent rule; each agent reply is a card with an always-visible toolbar
// (time, length, copy). Long replies show a preview and open in place; files
// sit in a footer strip that scrolls sideways.
import '@/proto/tokens.css'
import { useState } from 'react'
import { AlertCircleIcon, CheckIcon, CopyIcon, FileIcon, FileImageIcon, PencilIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import type { Attachment, Message } from '../../api'
import { RichMessage, fileUrl, formatBytes } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { clock, isLong, plural, useElapsed, useWorstConversation, type Entry } from './data'

export function CardsVariant() {
  const { topic, entries, pending, error } = useWorstConversation()
  return (
    <div className="hb fixed inset-0 z-[45] flex flex-col antialiased">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--c-line)] bg-[var(--c-pane)] px-4 sm:px-6">
        <UserText className="min-w-0 flex-1 text-[15px] font-medium">{topic?.name}</UserText>
        <span className="shrink-0 text-xs text-[var(--c-mute)] tabular-nums">{topic ? plural(topic.messages, 'message') : ''}</span>
      </header>
      <main className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ol className="mx-auto flex max-w-3xl flex-col gap-3 px-3 py-6 sm:px-6" aria-label="Messages">
          {pending && <li className="py-10 text-sm text-[var(--c-mute)]">Loading the stress messages…</li>}
          {error && <li className="py-10 text-sm text-[var(--c-off)]">Couldn’t load messages. {error.message}</li>}
          {entries.map((e) => (
            <li key={e.kind === 'message' ? e.message.id : e.id} className="min-w-0">
              {e.kind === 'message' && (e.message.from_bot ? <ReplyCard message={e.message} /> : <Prompt message={e.message} />)}
              {e.kind === 'failed' && <FailedPrompt entry={e} />}
              {e.kind === 'thinking' && <ThinkingCard since={e.since} />}
            </li>
          ))}
        </ol>
      </main>
    </div>
  )
}

/** Your message: a slim line with an accent rule, folding after six lines. */
function Prompt({ message: m }: { message: Message }) {
  const long = isLong(m.body, 600, 6)
  const [open, setOpen] = useState(false)
  return (
    <article aria-label={`You, ${clock(m.sent_at)}`} className="flex min-w-0 gap-3 py-2 pl-3 border-l-2 border-[var(--c-accent)]">
      <div className="min-w-0 flex-1">
        <p className="mb-0.5 flex items-center gap-2 text-xs text-[var(--c-mute)]">
          <span className="font-medium text-[var(--c-ink)]">You</span>
          <time dateTime={m.sent_at} className="tabular-nums">{clock(m.sent_at)}</time>
          {m.is_voice && <span>· voice note</span>}
        </p>
        {m.body.trim() && (
          <div className={cn('user-text text-[15px] text-[var(--c-ink)]/90', long && !open && 'max-h-[9.5rem] [mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)]')}>
            <RichMessage body={m.body} />
          </div>
        )}
        {long && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="relative mt-1 text-xs font-medium text-[var(--c-accent)] before:absolute before:-inset-x-2 before:-inset-y-3 hover:underline">
            {open ? 'Show less' : 'Show your whole message'}
          </button>
        )}
        {m.attachments.length > 0 && <FileStrip files={m.attachments} />}
      </div>
    </article>
  )
}

function ReplyCard({ message: m }: { message: Message }) {
  const long = isLong(m.body, 900, 10)
  const [open, setOpen] = useState(false)
  const words = m.body.trim() ? m.body.trim().split(/\s+/).length : 0
  return (
    <article aria-label={`Agent reply, ${clock(m.sent_at)}`} className="min-w-0 overflow-hidden rounded-xl bg-[var(--c-pane)] shadow-[var(--c-raised)]">
      <div className="flex h-10 items-center gap-2 border-b border-[var(--c-line)] pr-1 pl-4 text-xs text-[var(--c-mute)]">
        <span className="font-medium text-[var(--c-ink)]">Herbot</span>
        <time dateTime={m.sent_at} className="tabular-nums">{clock(m.sent_at)}</time>
        {words > 0 && <span className="tabular-nums">· {plural(words, 'word')}</span>}
        {m.is_voice && <span>· voice</span>}
        <span className="ml-auto">{m.body.trim() && <Copy text={m.body} />}</span>
      </div>
      {m.body.trim() && (
        <div className={cn('user-text px-4 pt-3 pb-4 text-[15px]', long && !open && 'max-h-80 [mask-image:linear-gradient(to_bottom,black_calc(100%-5rem),transparent)]')}>
          <RichMessage body={m.body} />
        </div>
      )}
      {long && (
        <div className="px-4 pb-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="h-9 rounded-full border border-[var(--c-line)] px-4 text-sm font-medium transition-[background-color,scale] duration-150 ease-out hover:bg-[var(--c-sunken)] active:scale-[0.96] pointer-coarse:h-11"
          >
            {open ? 'Collapse reply' : 'Read the full reply'}
          </button>
        </div>
      )}
      {m.attachments.length > 0 && (
        <div className="border-t border-[var(--c-line)] bg-[var(--c-sunken)] px-4 py-2.5">
          <FileStrip files={m.attachments} />
        </div>
      )}
    </article>
  )
}

/** Files as chips in one row that scrolls sideways; each opens or downloads. */
function FileStrip({ files }: { files: Attachment[] }) {
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-1.5">
      <p className="text-xs text-[var(--c-mute)] tabular-nums">
        {plural(files.length, 'file')} · {formatBytes(files.reduce((s, f) => s + f.size, 0))}
      </p>
      <ul className="scroller -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {files.map((f, i) => {
          const Icon = f.kind === 'photo' ? FileImageIcon : FileIcon
          return (
            <li key={`${f.path}-${i}`} className="shrink-0">
              <a
                href={fileUrl(f.path)}
                download={f.name || true}
                className="flex h-11 max-w-56 items-center gap-2 rounded-lg border border-[var(--c-line)] bg-[var(--c-pane)] pr-3 pl-2 text-sm hover:bg-[var(--c-sunken)]"
              >
                <Icon className="size-4 shrink-0 text-[var(--c-mute)]" aria-hidden />
                <span className="min-w-0">
                  <UserText className="text-[13px] font-medium">{f.name}</UserText>
                  <span className="block text-[11px] text-[var(--c-mute)] tabular-nums">{formatBytes(f.size)}</span>
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Copy({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setState('copied')
          setTimeout(() => setState('idle'), 1500)
        } catch {
          setState('failed')
        }
      }}
      className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] pointer-coarse:h-11"
    >
      {state === 'copied' ? <CheckIcon className="size-3.5 text-[var(--c-ok)]" aria-hidden /> : <CopyIcon className="size-3.5" aria-hidden />}
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}</span>
    </button>
  )
}

function FailedPrompt({ entry }: { entry: Extract<Entry, { kind: 'failed' }> }) {
  const [state, setState] = useState<'failed' | 'retrying' | 'discarded'>('failed')
  if (state === 'discarded') return <p className="pl-3 text-xs text-[var(--c-faint)]">Message discarded.</p>
  return (
    <article aria-label={`You, ${clock(entry.sentAt)}, not sent`} className="flex min-w-0 flex-col gap-2 border-l-2 border-[var(--c-off)] py-2 pl-3">
      <p className="flex items-center gap-2 text-xs text-[var(--c-mute)]">
        <span className="font-medium text-[var(--c-ink)]">You</span>
        <span className="flex items-center gap-1 font-medium text-[var(--c-off)]">
          <AlertCircleIcon className="size-3.5" aria-hidden />
          {state === 'retrying' ? 'Sending…' : 'Not sent'}
        </span>
      </p>
      <UserText as="p" lines="all" className={cn('text-[15px]', state === 'retrying' && 'opacity-60')}>{entry.body}</UserText>
      <div role="alert" className="flex flex-col gap-1.5 rounded-lg bg-[color-mix(in_oklch,var(--c-off)_8%,transparent)] px-3 py-2">
        <UserText as="p" lines={2} className="text-xs">{entry.error}</UserText>
        <div className="flex flex-wrap gap-1.5">
          <Pill icon={RotateCcwIcon} primary disabled={state === 'retrying'} onClick={() => {
            setState('retrying')
            setTimeout(() => setState('failed'), 1200)
          }}>Retry</Pill>
          <Pill icon={PencilIcon} onClick={() => setState('discarded')}>Edit</Pill>
          <Pill icon={Trash2Icon} onClick={() => setState('discarded')}>Discard</Pill>
        </div>
      </div>
    </article>
  )
}

function Pill({ icon: Icon, children, onClick, primary, disabled }: { icon: typeof CopyIcon; children: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-[background-color,scale] duration-150 ease-out active:scale-[0.96] disabled:opacity-50 pointer-coarse:h-11',
        primary ? 'bg-[var(--c-accent)] text-[var(--c-accent-ink)]' : 'border border-[var(--c-line)] bg-[var(--c-pane)] hover:bg-[var(--c-sunken)]',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  )
}

function ThinkingCard({ since }: { since: number }) {
  const elapsed = useElapsed(since)
  return (
    <article aria-label="Agent reply, in progress" className="overflow-hidden rounded-xl bg-[var(--c-pane)] shadow-[var(--c-raised)]">
      <div className="flex h-10 items-center gap-2 border-b border-[var(--c-line)] px-4 text-xs text-[var(--c-mute)]">
        <span className="font-medium text-[var(--c-ink)]">Herbot</span>
        <span role="status" className="tabular-nums">· thinking {elapsed}</span>
      </div>
      <div className="flex flex-col gap-2 px-4 py-4" aria-hidden>
        {['92%', '78%', '56%'].map((w) => (
          <span key={w} className="h-3 rounded bg-[var(--c-sunken)] motion-safe:animate-pulse" style={{ width: w }} />
        ))}
      </div>
    </article>
  )
}
