// "New agent": creates a forum topic with a purpose, then opens it.
import { useEffect, useId, useReducer, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { PlusIcon, XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { createTopic } from '../api'
import { charCount, PURPOSE_MAX, purposeProblem } from '../format'
import { keys } from '../queries'
import { isSignedOut } from '../session'
import { ErrorNote } from '../ui'
import { Button } from './ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { Kbd } from './ui/kbd'
import { Spinner } from './ui/spinner'
import { Textarea } from './ui/textarea'
import { cn } from '@/lib/utils'

/** Telegram's limit for a forum topic's name. */
const NAME_MAX = 128
/** Past this, a stuck request is reported instead of spinning forever. */
const TIMEOUT_MS = 30_000

type Creation =
  | { status: 'editing' }
  | { status: 'creating' }
  | { status: 'failed'; error: string }
  /** Created, but opening it failed: the agent exists, so offer to open it. */
  | { status: 'created'; id: number; error: string }

type Event =
  | { type: 'submit' }
  | { type: 'failed'; error: string }
  | { type: 'opened-failed'; id: number; error: string }
  | { type: 'reset' }

/** The only moves the dialog can make; anything else is ignored. */
function creation(state: Creation, event: Event): Creation {
  switch (event.type) {
    case 'submit':
      return state.status === 'editing' || state.status === 'failed' ? { status: 'creating' } : state
    case 'failed':
      return state.status === 'creating' ? { status: 'failed', error: event.error } : state
    case 'opened-failed':
      return state.status === 'creating' ? { status: 'created', id: event.id, error: event.error } : state
    case 'reset':
      return state.status === 'creating' ? state : { status: 'editing' }
  }
}

function nameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Give it a name, like “Trip planner”.'
  if (charCount(trimmed) > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`
  return null
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Herbot didn’t answer within 30 seconds. Check that herbot-core is running, then try again.')),
        TIMEOUT_MS,
      ),
    ),
  ])
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/^Error:\s*/, '')
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function NewAgent({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [state, send] = useReducer(creation, { status: 'editing' })
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  // Errors show once a field was left or a submit was tried, never while typing the first word.
  const [touched, setTouched] = useState({ name: false, purpose: false })
  // One key per draft: a retry of the same draft can't create a second agent.
  const action = useRef<{ draft: string; key: string } | null>(null)
  const client = useQueryClient()
  const navigate = useNavigate()
  const ids = { name: useId(), purpose: useId(), purposeHint: useId() }
  const nameInput = useRef<HTMLInputElement>(null)
  const purposeInput = useRef<HTMLTextAreaElement>(null)

  const busy = state.status === 'creating'
  const nameError = touched.name ? nameProblem(name) : null
  const purposeError = touched.purpose ? purposeProblem(purpose) : null
  const purposeChars = charCount(purpose.trim())

  // Closing the dialog keeps the draft; a fresh open starts in "editing".
  useEffect(() => {
    if (open) send({ type: 'reset' })
  }, [open])

  async function openAgent(id: number) {
    await client.invalidateQueries({ queryKey: keys.topics })
    await navigate({ to: '/topics/$id', params: { id } })
    setOpen(false)
    setName('')
    setPurpose('')
    setTouched({ name: false, purpose: false })
    action.current = null
  }

  async function submit() {
    if (busy) return
    setTouched({ name: true, purpose: true })
    // Take the user to the first thing to fix.
    if (nameProblem(name)) return nameInput.current?.focus()
    if (purposeProblem(purpose)) return purposeInput.current?.focus()
    send({ type: 'submit' })
    const draft = JSON.stringify([name.trim(), purpose.trim()])
    if (action.current?.draft !== draft) action.current = { draft, key: crypto.randomUUID() }
    let id: number
    try {
      ;({ id } = await withTimeout(
        createTopic({ data: { name: name.trim(), purpose: purpose.trim(), idempotencyKey: action.current.key } }),
      ))
    } catch (error) {
      if (isSignedOut(error)) {
        client.clear()
        await navigate({ to: '/login', ignoreBlocker: true })
        return
      }
      send({ type: 'failed', error: message(error) })
      return
    }
    try {
      await openAgent(id)
    } catch (error) {
      send({ type: 'opened-failed', id, error: message(error) })
    }
  }

  return (
    <DialogPrimitive.Root
      open={open}
      // A request in flight can't be abandoned halfway: wait for its answer.
      onOpenChange={(next) => !busy && setOpen(next)}
    >
      <DialogPrimitive.Trigger asChild>
        <Button className={cn('pl-3', className)}>
          <PlusIcon aria-hidden />
          New agent
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 animation-duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=closed]:animation-duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
          className={cn(
            'fixed z-50 flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden border bg-card shadow-lg outline-none',
            // Phone: a sheet from the bottom, clear of the home indicator. Larger: centred.
            'inset-x-0 bottom-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]',
            'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-0',
            'animation-duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=closed]:animation-duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95',
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
            <div className="flex flex-col gap-1">
              <DialogPrimitive.Title className="text-lg leading-tight font-semibold tracking-tight">New agent</DialogPrimitive.Title>
              <p className="text-sm text-pretty text-muted-foreground">
                Herbot makes a topic in your group and gives it this purpose.
              </p>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-2 shrink-0 text-muted-foreground" disabled={busy} aria-label="Close">
                <XIcon aria-hidden />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            className="flex min-h-0 flex-col"
          >
            <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-5 py-5 sm:px-6">
              <Field data-invalid={Boolean(nameError) || undefined}>
                <FieldLabel htmlFor={ids.name}>Name</FieldLabel>
                <Input
                  ref={nameInput}
                  id={ids.name}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  disabled={busy}
                  aria-invalid={Boolean(nameError) || undefined}
                  aria-describedby={nameError ? `${ids.name}-error` : undefined}
                  autoComplete="off"
                  maxLength={NAME_MAX * 2}
                  placeholder="Trip planner"
                  autoFocus
                />
                {nameError && <FieldError id={`${ids.name}-error`}>{nameError}</FieldError>}
              </Field>

              <Field data-invalid={Boolean(purposeError) || undefined}>
                <FieldLabel htmlFor={ids.purpose}>What should it do?</FieldLabel>
                <Textarea
                  ref={purposeInput}
                  id={ids.purpose}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, purpose: true }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      void submit()
                    }
                  }}
                  disabled={busy}
                  aria-invalid={Boolean(purposeError) || undefined}
                  aria-describedby={purposeError ? `${ids.purpose}-error` : ids.purposeHint}
                  className="max-h-[40dvh] min-h-28"
                  placeholder="Help me plan trips: flights, hotels and a day-by-day plan."
                />
                {purposeError ? (
                  <FieldError id={`${ids.purpose}-error`}>{purposeError}</FieldError>
                ) : (
                  <FieldDescription id={ids.purposeHint} className="flex justify-between gap-3">
                    <span>It becomes the agent’s instructions. You can change it later.</span>
                    {purposeChars > PURPOSE_MAX * 0.8 && (
                      <span className="shrink-0 tabular-nums">
                        {purposeChars.toLocaleString('en-GB')} / {PURPOSE_MAX.toLocaleString('en-GB')}
                      </span>
                    )}
                  </FieldDescription>
                )}
              </Field>

              {state.status === 'failed' && <ErrorNote title="Couldn’t create the agent">{state.error}</ErrorNote>}
              {state.status === 'created' && (
                <ErrorNote title="Created, but couldn’t open it">
                  {state.error}{' '}
                  <button type="button" className="underline underline-offset-3" onClick={() => void openAgent(state.id)}>
                    Open the agent
                  </button>
                </ErrorNote>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t bg-muted/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
              <span className="hidden text-xs text-muted-foreground sm:mr-auto sm:inline">
                <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd> <Kbd>Enter</Kbd> to create
              </span>
              <DialogPrimitive.Close asChild>
                <Button type="button" variant="ghost" disabled={busy}>
                  Cancel
                </Button>
              </DialogPrimitive.Close>
              <Button type="submit" disabled={busy || state.status === 'created'} aria-live="polite">
                {busy && <Spinner aria-hidden />}
                {busy ? 'Creating…' : state.status === 'failed' ? 'Try again' : 'Create agent'}
              </Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
