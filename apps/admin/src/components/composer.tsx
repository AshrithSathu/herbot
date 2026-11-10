// Writing to an agent from the panel. What you send leaves the box at once and
// shows in the chat as your bubble ("Sending…"); a failure stays on that
// bubble with Retry, Edit and Discard, and a request that hangs gives up after
// SEND_TIMEOUT instead of spinning forever. Retrying reuses the same
// idempotency key, so a message is never posted twice.
import { createContext, useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircleIcon, ArrowUpIcon, ChevronDownIcon, PaperclipIcon, XIcon } from 'lucide-react'
import { getActivity, sendMessage } from '../api'
import { keys } from '../queries'
import { ErrorNote } from '../ui'
import { formatBytes } from './rich-message'
import { Button } from './ui/button'
import { Spinner } from './ui/spinner'
import { cn } from '@/lib/utils'

/** Where the chat log wants the outgoing bubble and the typing indicator:
 * the end of the conversation, not inside the composer. */
export const OutboxContext = createContext<HTMLElement | null>(null)

const MAX_CHARS = 3500
const MAX_FILES = 10
const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 24 * 1024 * 1024
const SEND_TIMEOUT = 45_000

const MODES = [
  ['auto', 'Auto'],
  ['fast', 'Fast'],
  ['think', 'Think'],
  ['heavy', 'Heavy'],
  ['deepsearch', 'DeepSearch'],
] as const

type Outgoing = {
  text: string
  files: File[]
  style: string
  key: string
  status: 'sending' | 'failed'
  error?: string
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Herbot didn’t confirm within ${ms / 1000} seconds. It may still arrive; retrying won’t send it twice.`,
          ),
        ),
      ms,
    )
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

function form(id: number, o: Outgoing): FormData {
  const data = new FormData()
  data.set('idempotencyKey', o.key)
  data.set('id', String(id))
  data.set('text', o.text)
  data.set('style', o.style)
  o.files.forEach((f) => data.append('files', f))
  return data
}

export function Composer({ id, enabled }: { id: number; enabled: boolean }) {
  const client = useQueryClient()
  const outbox = useContext(OutboxContext)
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [style, setStyle] = useState('auto')
  const [fileError, setFileError] = useState<string | null>(null)
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  // Set synchronously so a double press can't start two sends.
  const locked = useRef(false)

  const activity = useQuery({
    queryKey: ['activity', id],
    queryFn: () => getActivity({ data: id }),
    refetchInterval: 2_000,
    enabled,
  })

  const send = useMutation({
    mutationFn: (o: Outgoing) => withTimeout(sendMessage({ data: form(id, o) }), SEND_TIMEOUT),
    onSuccess: async () => {
      setOutgoing(null)
      // The topic's message count changes; the log fetches only what's new.
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.topic(id) }),
        client.invalidateQueries({ queryKey: keys.topicList }),
        client.invalidateQueries({ queryKey: ['activity', id] }),
      ])
    },
    onError: (error) => {
      setOutgoing((o) => (o ? { ...o, status: 'failed', error: error.message } : o))
    },
    onSettled: () => {
      locked.current = false
    },
  })

  function add(incoming: File[]) {
    if (!enabled || incoming.length === 0) return
    const next = [...files, ...incoming]
    const tooBig = incoming.find((f) => f.size > MAX_FILE_BYTES)
    if (next.length > MAX_FILES) {
      setFileError(`Attach up to ${MAX_FILES} files at a time.`)
    } else if (tooBig) {
      setFileError(`${tooBig.name} is ${formatBytes(tooBig.size)}. Each file must be under 20 MB.`)
    } else if (next.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
      setFileError('Together the files must stay under 24 MB.')
    } else {
      setFileError(null)
      setFiles(next)
    }
  }

  const empty = !text.trim() && files.length === 0
  const blocked = outgoing !== null

  function submit() {
    if (locked.current || !enabled || empty || blocked) return
    locked.current = true
    const o: Outgoing = { text, files, style, key: crypto.randomUUID(), status: 'sending' }
    setOutgoing(o)
    setText('')
    setFiles([])
    setFileError(null)
    send.mutate(o)
  }

  function retry() {
    if (!outgoing || locked.current) return
    locked.current = true
    const o = { ...outgoing, status: 'sending' as const, error: undefined }
    setOutgoing(o)
    send.mutate(o)
  }

  function edit() {
    if (!outgoing || outgoing.status === 'sending') return
    setText(outgoing.text)
    setFiles(outgoing.files)
    setStyle(outgoing.style)
    setOutgoing(null)
    send.reset()
    requestAnimationFrame(() => textarea.current?.focus())
  }

  const chars = Array.from(text).length
  const bubble = (outgoing || activity.data?.in_progress) && (
    <div className="flex flex-col gap-2 px-1 pb-2">
      {outgoing && <OutgoingBubble o={outgoing} onRetry={retry} onEdit={edit} onDiscard={() => { setOutgoing(null); send.reset() }} />}
      {activity.data?.in_progress && !outgoing && (
        <p
          role="status"
          className="flex w-fit items-center gap-2 self-start rounded-2xl rounded-bl-md border bg-card px-3.5 py-2.5 text-sm text-muted-foreground"
        >
          <Spinner className="size-3.5" />
          Herbot is thinking…
        </p>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-2">
      {bubble && (outbox ? createPortal(bubble, outbox) : bubble)}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          add(Array.from(e.dataTransfer.files))
        }}
        className={cn(
          'rounded-2xl border bg-card shadow-[0_1px_2px_oklch(0_0_0/0.04),0_4px_16px_-4px_oklch(0_0_0/0.08)] transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-ring/60',
          !enabled && 'bg-muted/50',
        )}
      >
        <label htmlFor={`compose-${id}`} className="sr-only">
          Message this agent
        </label>
        <textarea
          ref={textarea}
          id={`compose-${id}`}
          dir="auto"
          value={text}
          rows={1}
          disabled={!enabled}
          maxLength={MAX_CHARS}
          placeholder={enabled ? 'Message this agent…' : 'This agent is off. Turn it on in Settings to chat.'}
          className="block max-h-[40dvh] min-h-14 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:cursor-not-allowed"
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault()
              add(Array.from(e.clipboardData.files))
            }
          }}
          onKeyDown={(e) => {
            // Enter sends with a keyboard; on touch, Enter is a new line and the button sends.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia('(pointer: fine)').matches) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {files.length > 0 && (
          <ul aria-label="Attached files" className="flex flex-wrap gap-1.5 px-3 pt-1">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex h-9 max-w-full min-w-0 items-center gap-1 rounded-lg bg-muted pl-3 text-xs">
                <span dir="auto" className="user-text max-w-48 truncate" title={f.name}>
                  {f.name}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((old) => old.filter((_, j) => i !== j))}
                  className="relative grid size-8 place-items-center rounded-md text-muted-foreground before:absolute before:-inset-1 hover:text-foreground"
                >
                  <XIcon className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-1 p-1.5 pt-1">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              add(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 rounded-full text-muted-foreground"
            aria-label="Attach files"
            disabled={!enabled}
            onClick={() => picker.current?.click()}
          >
            <PaperclipIcon aria-hidden />
          </Button>
          <div className="relative">
            <label htmlFor={`mode-${id}`} className="sr-only">
              Mode for this message
            </label>
            <select
              id={`mode-${id}`}
              value={style}
              disabled={!enabled}
              onChange={(e) => setStyle(e.target.value)}
              className="h-9 appearance-none rounded-full border border-input bg-background pr-8 pl-3 text-sm font-medium outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:text-base"
            >
              {MODES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDownIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
          </div>
          <span className="ml-auto flex items-center gap-3 pr-1">
            {chars > MAX_CHARS - 500 && (
              <span className={cn('text-xs tabular-nums', chars >= MAX_CHARS ? 'text-destructive' : 'text-muted-foreground')}>
                {(MAX_CHARS - chars).toLocaleString('en-GB')} left
              </span>
            )}
            <span className="hidden text-xs text-muted-foreground pointer-fine:md:inline">
              {blocked ? 'Retry or discard the unsent message first' : 'Enter to send · Shift+Enter for a new line'}
            </span>
          </span>
          <Button
            type="submit"
            size="icon"
            className="size-11 shrink-0 rounded-full"
            disabled={!enabled || empty || blocked}
            aria-label={blocked ? 'Send (retry or discard the unsent message first)' : 'Send message'}
          >
            <ArrowUpIcon aria-hidden />
          </Button>
        </div>
      </form>
      {fileError && <ErrorNote title="Couldn’t attach">{fileError}</ErrorNote>}
      {activity.isError && enabled && (
        <p className="px-1 text-xs text-muted-foreground">Couldn’t check whether the agent is working: {activity.error.message}</p>
      )}
    </div>
  )
}

function OutgoingBubble({
  o,
  onRetry,
  onEdit,
  onDiscard,
}: {
  o: Outgoing
  onRetry: () => void
  onEdit: () => void
  onDiscard: () => void
}) {
  const failed = o.status === 'failed'
  return (
    <div
      className={cn(
        'flex max-w-[min(65ch,88%)] min-w-0 flex-col gap-1.5 self-end rounded-2xl rounded-br-md px-3.5 py-2',
        failed ? 'border border-destructive/40 bg-destructive-soft' : 'bg-accent text-accent-foreground opacity-80',
      )}
      aria-live="polite"
    >
      {o.text.trim() && (
        <p dir="auto" className="user-text text-[15px] whitespace-pre-wrap">
          {o.text}
        </p>
      )}
      {o.files.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {o.files.length === 1 ? (
            <span dir="auto" className="user-text">{o.files[0]!.name}</span>
          ) : (
            `${o.files.length} files`
          )}
        </p>
      )}
      {failed ? (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            <span className="wrap-anywhere">Not sent. {o.error}</span>
          </p>
          <div className="-mx-1.5 flex flex-wrap gap-1">
            <Button type="button" size="sm" variant="outline" className="h-9 bg-card" onClick={onRetry}>
              Retry
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-9" onClick={onEdit}>
              Edit
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-9 text-muted-foreground" onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </div>
      ) : (
        <span className="flex items-center gap-1.5 self-end text-[11px] text-muted-foreground">
          <Spinner className="size-3" />
          Sending…
        </span>
      )}
    </div>
  )
}
