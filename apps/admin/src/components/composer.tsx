import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpIcon, PaperclipIcon, XIcon } from 'lucide-react'
import { getActivity, sendMessage } from '../api'
import { keys } from '../queries'
import { ErrorNote } from '../ui'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
export function Composer({ id, enabled }: { id: number; enabled: boolean }) {
  const client = useQueryClient()
  const action = useRef<{ text: string; style: string; files: File[]; key: string } | null>(null)
  const [text, setText] = useState(''),
    [files, setFiles] = useState<File[]>([]),
    [style, setStyle] = useState('auto')
  const [fileError, setFileError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null),
    locked = useRef(false)
  const activity = useQuery({
    queryKey: ['activity', id],
    queryFn: () => getActivity({ data: id }),
    refetchInterval: 2000,
  })
  const send = useMutation({
    mutationFn: (data: FormData) => sendMessage({ data }),
    onSuccess: async () => {
      action.current = null
      setText('')
      setFiles([])
      await client.invalidateQueries({ queryKey: keys.messages(id) })
      await client.invalidateQueries({ queryKey: keys.topics })
      await client.invalidateQueries({ queryKey: ['activity', id] })
    },
    onSettled: () => {
      locked.current = false
    },
  })
  function add(incoming: File[]) {
    if (locked.current || !enabled) return
    if (
      files.length + incoming.length > 10 ||
      incoming.some((f) => f.size > 20 * 1024 * 1024) ||
      [...files, ...incoming].reduce((n, f) => n + f.size, 0) > 24 * 1024 * 1024
    ) {
      setFileError('Attach up to 10 files, each under 20 MB and under 24 MB together.')
      return
    }
    setFileError(null)
    setFiles((old) => [...old, ...incoming])
  }
  function submit() {
    if (locked.current || !enabled || (!text.trim() && !files.length)) return
    locked.current = true
    const data = new FormData()
    if (!action.current || action.current.text !== text || action.current.style !== style || action.current.files !== files)
      action.current = { text, style, files, key: crypto.randomUUID() }
    data.set('idempotencyKey', action.current.key)
    data.set('id', String(id))
    data.set('text', text)
    data.set('style', style)
    files.forEach((f) => data.append('files', f))
    send.mutate(data)
  }
  // TanStack's mutation status owns the request and its submitted snapshot.
  const pending = (send.isPending || send.isError) && send.variables
    ? String(send.variables.get('text') || send.variables.getAll('files').map((f) => (f as File).name).join(', '))
    : null
  return (
    <div className="flex flex-col gap-3">
      {pending && (
        <div
          className="ml-auto max-w-[88%] rounded-2xl bg-muted px-4 py-3 text-sm whitespace-pre-wrap"
          aria-live="polite"
        >
          {pending}
          <div className="mt-1 text-xs text-muted-foreground">{send.isError ? 'Not sent' : 'Sending…'}</div>
        </div>
      )}
      {activity.data?.in_progress && (
        <p role="status" className="px-2 text-sm text-muted-foreground">
          Herbot is thinking…
        </p>
      )}
      {activity.error && <ErrorNote title="Couldn’t check agent activity">{activity.error.message}</ErrorNote>}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          if (!send.isPending) add(Array.from(e.dataTransfer.files))
        }}
        className="rounded-2xl border bg-card p-3 shadow-xs focus-within:ring-2 focus-within:ring-ring/40"
      >
        <label htmlFor={`compose-${id}`} className="sr-only">
          Message this agent
        </label>
        <Textarea
          id={`compose-${id}`}
          value={text}
          disabled={!enabled || send.isPending}
          maxLength={3500}
          placeholder={enabled ? 'Ask anything…' : 'Turn this agent on to chat'}
          className="max-h-60 min-h-16 resize-none border-0 bg-transparent text-base shadow-none focus-visible:ring-0 field-sizing-content"
          onChange={(e) => {
            setText(e.target.value)
            send.reset()
          }}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault()
              add(Array.from(e.clipboardData.files))
            }
          }}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              window.matchMedia('(pointer:fine)').matches
            ) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 py-2">
            {files.map((f, i) => (
              <li key={i} className="flex min-w-0 items-center rounded-lg bg-muted pl-3 text-xs">
                <span className="max-w-40 truncate">{f.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 min-w-11"
                  disabled={send.isPending}
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((old) => old.filter((_, j) => i !== j))}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-11"
            aria-label="Attach files"
            disabled={!enabled || send.isPending}
            onClick={() => picker.current?.click()}
          >
            <PaperclipIcon />
          </Button>
          <select
            aria-label="Mode for this message"
            value={style}
            disabled={send.isPending}
            onChange={(e) => setStyle(e.target.value)}
            className="min-h-11 rounded-lg bg-background px-3 text-sm"
          >
            <option value="auto">Auto</option>
            <option value="fast">Fast</option>
            <option value="think">Think</option>
            <option value="heavy">Heavy</option>
            <option value="deepsearch">DeepSearch</option>
          </select>
          <Button
            type="submit"
            className="ml-auto min-h-11 min-w-11 rounded-full"
            disabled={!enabled || send.isPending || (!text.trim() && !files.length)}
            aria-label={send.isError ? 'Retry message' : 'Send message'}
          >
            <ArrowUpIcon />
          </Button>
        </div>
      </form>
      {fileError && <ErrorNote title="Couldn’t attach files">{fileError}</ErrorNote>}
      {send.isError && (
        <ErrorNote title="Message failed">
          {send.error.message}{' '}
          <Button variant="link" onClick={submit}>
            Retry
          </Button>
        </ErrorNote>
      )}
    </div>
  )
}
