// Variant "Transcript" — flat-row axis: no bubbles. Each message is a row
// with a monogram, the speaker and time in its header line and its actions
// beside them; text runs at a reading measure; long bodies fold by line
// count behind a rule; files collapse into a one-line summary.
import '@/proto/tokens.css'
import { useState } from 'react'
import { AlertCircleIcon, CheckIcon, ChevronDownIcon, CopyIcon, PaperclipIcon, PencilIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import type { Attachment, Message } from '../../api'
import { FilePreview, RichMessage, formatBytes } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { clock, plural, useElapsed, useWorstConversation, type Entry } from './data'

const FOLD_LINES = 12

export function TranscriptVariant() {
  const { topic, entries, pending, error } = useWorstConversation()
  return (
    <div className="hb fixed inset-0 z-[45] flex flex-col bg-[var(--c-pane)] antialiased">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--c-line)] px-4 sm:px-6">
        <UserText className="min-w-0 text-[15px] font-medium">{topic?.name}</UserText>
        <span className="shrink-0 text-xs text-[var(--c-mute)] tabular-nums">{topic ? plural(topic.messages, 'message') : ''}</span>
      </header>
      <main className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ol className="mx-auto flex max-w-[52rem] flex-col py-4" aria-label="Messages">
          {pending && <li className="px-6 py-10 text-sm text-[var(--c-mute)]">Loading the stress messages…</li>}
          {error && <li className="px-6 py-10 text-sm text-[var(--c-off)]">Couldn’t load messages. {error.message}</li>}
          {entries.map((e) => (
            <li key={e.kind === 'message' ? e.message.id : e.id} className="group/row border-b border-[var(--c-line)] last:border-b-0">
              {e.kind === 'message' && <MessageRow message={e.message} />}
              {e.kind === 'failed' && <FailedRow entry={e} />}
              {e.kind === 'thinking' && <ThinkingRow since={e.since} />}
            </li>
          ))}
        </ol>
      </main>
    </div>
  )
}

function Monogram({ you }: { you: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold',
        you ? 'bg-[var(--c-ink)] text-[var(--c-pane)]' : 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]',
      )}
    >
      {you ? 'A' : 'H'}
    </span>
  )
}

function Shell({ you, time, children, actions, tone }: {
  you: boolean
  time: string
  children: React.ReactNode
  actions?: React.ReactNode
  tone?: 'failed'
}) {
  return (
    <article aria-label={`${you ? 'You' : 'Agent'}, ${time}`} className={cn('flex gap-3 px-4 py-4 sm:px-6', tone === 'failed' && 'bg-[color-mix(in_oklch,var(--c-off)_6%,transparent)]')}>
      <Monogram you={you} />
      <div className="min-w-0 flex-1">
        <div className="flex min-h-8 items-center gap-2">
          <span className="text-sm font-semibold">{you ? 'You' : 'Herbot'}</span>
          <span className="text-xs text-[var(--c-faint)] tabular-nums">{time}</span>
          <div className="ml-auto flex">{actions}</div>
        </div>
        {children}
      </div>
    </article>
  )
}

function MessageRow({ message: m }: { message: Message }) {
  const lines = m.body.split('\n').length
  // Long prose with few line breaks still folds: estimate ~90 characters a line.
  const estimate = Math.max(lines, Math.ceil(m.body.length / 90))
  const long = estimate > FOLD_LINES + 4
  const [open, setOpen] = useState(false)
  return (
    <Shell you={!m.from_bot} time={clock(m.sent_at)} actions={m.body.trim() ? <Copy text={m.body} /> : null}>
      {m.is_voice && <p className="text-xs font-medium text-[var(--c-mute)]">Voice note · transcript</p>}
      {m.body.trim() && (
        <div className={cn('user-text max-w-[72ch] text-[15px]', long && !open && 'max-h-[19.5rem]')}>
          <RichMessage body={m.body} />
        </div>
      )}
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="group/fold mt-2 flex h-9 w-full items-center gap-3 text-xs font-medium text-[var(--c-mute)] hover:text-[var(--c-ink)] pointer-coarse:h-11"
        >
          <span className="h-px flex-1 bg-[var(--c-line)]" />
          <ChevronDownIcon className={cn('size-3.5 transition-transform duration-150 ease-out', open && 'rotate-180')} aria-hidden />
          {open ? 'Fold' : `Show about ${plural(estimate - FOLD_LINES, 'more line')}`}
          <span className="h-px flex-1 bg-[var(--c-line)]" />
        </button>
      )}
      {m.attachments.length > 0 && <FileSummary files={m.attachments} />}
    </Shell>
  )
}

/** Files as one line ("12 files · 186 GB") that opens into the full list. */
function FileSummary({ files }: { files: Attachment[] }) {
  const [open, setOpen] = useState(files.length === 1)
  const total = files.reduce((sum, f) => sum + f.size, 0)
  return (
    <div className="mt-2 max-w-[72ch]">
      {files.length > 1 && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 items-center gap-2 rounded-md px-2 -ml-2 text-sm text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] pointer-coarse:h-11"
        >
          <PaperclipIcon className="size-4" aria-hidden />
          <span className="tabular-nums">{plural(files.length, 'file')} · {formatBytes(total)}</span>
          <ChevronDownIcon className={cn('size-3.5 transition-transform duration-150 ease-out', open && 'rotate-180')} aria-hidden />
        </button>
      )}
      {open && (
        <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
          {files.map((f, i) => (
            <FilePreview key={`${f.path}-${i}`} file={f} className="border-[var(--c-line)] bg-[var(--c-pane)]" />
          ))}
        </div>
      )}
    </div>
  )
}

function Copy({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <button
      type="button"
      aria-label={state === 'copied' ? 'Copied' : 'Copy message'}
      title="Copy message"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setState('copied')
          setTimeout(() => setState('idle'), 1500)
        } catch {
          setState('failed')
        }
      }}
      className="grid size-8 place-items-center rounded-md text-[var(--c-faint)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] pointer-coarse:size-11"
    >
      {state === 'copied' ? <CheckIcon className="size-4 text-[var(--c-ok)]" aria-hidden /> : <CopyIcon className="size-4" aria-hidden />}
      <span className="sr-only" aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}</span>
    </button>
  )
}

function FailedRow({ entry }: { entry: Extract<Entry, { kind: 'failed' }> }) {
  const [state, setState] = useState<'failed' | 'retrying' | 'discarded'>('failed')
  if (state === 'discarded') return <p className="px-6 py-3 text-xs text-[var(--c-faint)]">Message discarded.</p>
  return (
    <Shell you time={clock(entry.sentAt)} tone="failed">
      <UserText as="p" lines="all" className={cn('max-w-[72ch] text-[15px]', state === 'retrying' && 'opacity-60')}>{entry.body}</UserText>
      <div role="alert" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--c-off)]">
          <AlertCircleIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="font-medium">{state === 'retrying' ? 'Sending…' : 'Not sent.'}</span>
          <UserText className="min-w-0 text-[var(--c-mute)]">{entry.error}</UserText>
        </span>
        <span className="flex gap-1">
          <TextButton icon={RotateCcwIcon} disabled={state === 'retrying'} onClick={() => {
            setState('retrying')
            setTimeout(() => setState('failed'), 1200)
          }}>Retry</TextButton>
          <TextButton icon={PencilIcon} onClick={() => setState('discarded')}>Edit</TextButton>
          <TextButton icon={Trash2Icon} onClick={() => setState('discarded')}>Discard</TextButton>
        </span>
      </div>
    </Shell>
  )
}

function TextButton({ icon: Icon, children, onClick, disabled }: { icon: typeof CopyIcon; children: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium hover:bg-[var(--c-sunken)] active:scale-[0.96] disabled:opacity-50 transition-[background-color,scale] duration-150 ease-out pointer-coarse:h-11"
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  )
}

function ThinkingRow({ since }: { since: number }) {
  const elapsed = useElapsed(since)
  return (
    <Shell you={false} time="now">
      <p role="status" className="flex items-center gap-2 text-[15px] text-[var(--c-mute)]">
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inset-0 rounded-full bg-[var(--c-accent)] opacity-60 motion-safe:animate-ping" />
          <span className="relative size-2 rounded-full bg-[var(--c-accent)]" />
        </span>
        Thinking <span className="tabular-nums">{elapsed}</span>
      </p>
    </Shell>
  )
}
