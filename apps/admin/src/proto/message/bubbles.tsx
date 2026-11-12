// Variant "Bubbles" — messenger axis: the agent on the left, you on the right
// in a soft accent tint, long content folding inside the bubble, the time
// tucked in its corner and actions in a quiet row underneath.
import '@/proto/tokens.css'
import { useState } from 'react'
import { AlertCircleIcon, CheckIcon, CopyIcon, PencilIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import type { Attachment, Message } from '../../api'
import { FilePreview, RichMessage } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { clock, isLong, plural, useElapsed, useWorstConversation, type Entry } from './data'

export function BubblesVariant() {
  const { topic, entries, pending, error } = useWorstConversation()
  return (
    <div className="hb fixed inset-0 z-[45] flex flex-col antialiased">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--c-line)] bg-[var(--c-pane)] px-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--c-accent-soft)] text-sm font-medium text-[var(--c-accent)]">#</span>
        <div className="min-w-0">
          <UserText className="text-[15px] font-medium">{topic?.name}</UserText>
          <p className="text-xs text-[var(--c-mute)] tabular-nums">{topic ? plural(topic.messages, 'message') : ' '}</p>
        </div>
      </header>
      <main className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ol className="mx-auto flex max-w-3xl flex-col px-3 py-6 sm:px-6" aria-label="Messages">
          {pending && <li className="py-10 text-center text-sm text-[var(--c-mute)]">Loading the stress messages…</li>}
          {error && <li className="py-10 text-center text-sm text-[var(--c-off)]">Couldn’t load messages. {error.message}</li>}
          {entries.map((e, i) => (
            <Row key={key(e)} entry={e} grouped={i > 0 && side(entries[i - 1]) === side(e)} />
          ))}
        </ol>
      </main>
    </div>
  )
}

const key = (e: Entry) => (e.kind === 'message' ? e.message.id : e.id)
const side = (e: Entry): 'you' | 'agent' => (e.kind === 'message' ? (e.message.from_bot ? 'agent' : 'you') : e.kind === 'failed' ? 'you' : 'agent')

function Row({ entry, grouped }: { entry: Entry; grouped: boolean }) {
  const you = side(entry) === 'you'
  return (
    <li className={cn('flex min-w-0 flex-col', you ? 'items-end' : 'items-start', grouped ? 'mt-1' : 'mt-5 first:mt-0')}>
      {entry.kind === 'message' && <MessageBubble message={entry.message} />}
      {entry.kind === 'failed' && <FailedBubble entry={entry} />}
      {entry.kind === 'thinking' && <Thinking since={entry.since} />}
    </li>
  )
}

const BUBBLE = 'relative min-w-0 max-w-[min(42rem,88%)] rounded-[18px] px-3.5 py-2.5 text-[15px]'

function MessageBubble({ message: m }: { message: Message }) {
  const you = !m.from_bot
  // Production's fold point (chat-log FOLD_CHARS/FOLD_LINES), so a short code block never folds to one line.
  const long = isLong(m.body, 1500, 24)
  const [open, setOpen] = useState(false)
  const label = `${you ? 'You' : 'Agent'}, ${clock(m.sent_at)}`
  return (
    <>
      <article
        aria-label={label}
        className={cn(
          BUBBLE,
          you
            ? 'rounded-br-md bg-[var(--c-accent-soft)] text-[var(--c-ink)]'
            : 'rounded-bl-md bg-[var(--c-pane)] shadow-[var(--c-raised)]',
        )}
      >
        {m.is_voice && <p className="mb-1 text-xs font-medium text-[var(--c-mute)]">Voice note · transcript</p>}
        {m.body.trim() && (
          <div className={cn('user-text', long && !open && 'max-h-72 [mask-image:linear-gradient(to_bottom,black_calc(100%-4rem),transparent)]')}>
            <RichMessage body={m.body} />
          </div>
        )}
        {long && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="relative mt-1 text-sm font-medium text-[var(--c-accent)] before:absolute before:-inset-x-2 before:-inset-y-3 hover:underline"
          >
            {open ? 'Show less' : `Show all ${m.body.length.toLocaleString('en-GB')} characters`}
          </button>
        )}
        {m.attachments.length > 0 && <Files files={m.attachments} />}
        <time dateTime={m.sent_at} className="mt-1 block text-right text-[11px] text-[var(--c-faint)] tabular-nums">
          {clock(m.sent_at)}
        </time>
      </article>
      <Actions text={m.body} />
    </>
  )
}

/** Four files, then the rest on request: a 12-file message stays a bubble. */
function Files({ files }: { files: Attachment[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? files : files.slice(0, 4)
  return (
    <div className="mt-2 flex w-[min(24rem,70vw)] max-w-full flex-col gap-1.5">
      {shown.map((f, i) => (
        <FilePreview key={`${f.path}-${i}`} file={f} className="border-[var(--c-line)] bg-[var(--c-pane)]" />
      ))}
      {files.length > 4 && (
        <button
          type="button"
          onClick={() => setAll((a) => !a)}
          className="h-11 rounded-lg text-sm font-medium text-[var(--c-accent)] hover:bg-[var(--c-sunken)]"
        >
          {all ? 'Show fewer files' : `Show ${files.length - 4} more files`}
        </button>
      )}
    </div>
  )
}

/** Copy under every bubble: visible on hover or focus with a mouse, always on touch. */
function Actions({ text }: { text: string }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  if (!text.trim()) return null
  return (
    <div className="flex opacity-100 transition-opacity duration-150 ease-out [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [li:hover_&]:opacity-100 [li:focus-within_&]:opacity-100">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text)
            setCopied('copied')
            setTimeout(() => setCopied('idle'), 1500)
          } catch {
            setCopied('failed')
          }
        }}
        className="flex h-9 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] pointer-coarse:h-11"
      >
        {copied === 'copied' ? <CheckIcon className="size-3.5 text-[var(--c-ok)]" aria-hidden /> : <CopyIcon className="size-3.5" aria-hidden />}
        <span aria-live="polite">{copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}</span>
      </button>
    </div>
  )
}

function FailedBubble({ entry }: { entry: Extract<Entry, { kind: 'failed' }> }) {
  const [state, setState] = useState<'failed' | 'retrying' | 'discarded'>('failed')
  if (state === 'discarded') return <p className="text-xs text-[var(--c-faint)]">Message discarded.</p>
  return (
    <>
      <article
        aria-label={`You, ${clock(entry.sentAt)}, not sent`}
        className={cn(BUBBLE, 'rounded-br-md border border-dashed border-[var(--c-off)] bg-transparent', state === 'retrying' && 'opacity-60')}
      >
        <UserText as="p" lines="all">{entry.body}</UserText>
        <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-[var(--c-off)]">
          <AlertCircleIcon className="size-3" aria-hidden />
          {state === 'retrying' ? 'Sending…' : 'Not sent'}
        </p>
      </article>
      <div role="alert" className="mt-1 flex max-w-[min(42rem,88%)] flex-col items-end gap-1">
        <UserText as="p" lines={2} className="text-right text-xs text-[var(--c-mute)]">{entry.error}</UserText>
        <div className="flex gap-1">
          <ActionButton
            icon={RotateCcwIcon}
            disabled={state === 'retrying'}
            onClick={() => {
              setState('retrying')
              setTimeout(() => setState('failed'), 1200)
            }}
          >
            Retry
          </ActionButton>
          <ActionButton icon={PencilIcon} onClick={() => setState('discarded')}>Edit</ActionButton>
          <ActionButton icon={Trash2Icon} onClick={() => setState('discarded')}>Discard</ActionButton>
        </div>
      </div>
    </>
  )
}

function ActionButton({ icon: Icon, children, onClick, disabled }: { icon: typeof CopyIcon; children: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-[var(--c-ink)] transition-[background-color,scale] duration-150 ease-out hover:bg-[var(--c-sunken)] active:scale-[0.96] disabled:opacity-50 pointer-coarse:h-11"
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  )
}

function Thinking({ since }: { since: number }) {
  const elapsed = useElapsed(since)
  return (
    <div role="status" className={cn(BUBBLE, 'flex items-center gap-2.5 rounded-bl-md bg-[var(--c-pane)] shadow-[var(--c-raised)]')}>
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-[var(--c-mute)] motion-safe:animate-pulse"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
      <span className="text-sm text-[var(--c-mute)] tabular-nums">Thinking · {elapsed}</span>
    </div>
  )
}
