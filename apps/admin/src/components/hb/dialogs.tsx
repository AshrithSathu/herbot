// Dialogs (docs/design/DECISIONS.md, "Dialogs"): a centred modal, a bottom
// sheet on phones; focus trapped and returned to the trigger. The guard
// matches the risk: typing a word for irreversible, rare actions (forgetting
// a topic); "Keep" as the primary with the red action alone below a rule for
// the rest (clean slate, forgetting a memory).
import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { XIcon } from 'lucide-react'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { Button, TextInput } from './controls'
import { splitErrorId } from './feedback'

const OVERLAY =
  'fixed inset-0 z-50 bg-[oklch(0_0_0/0.4)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150'

// Phones: a sheet from the bottom that clears the home indicator. From `md`:
// centred, scaling from 0.97 (never from 0), exits faster than it enters.
const CONTENT = cn(
  'fixed z-50 flex max-h-[min(90dvh,48rem)] flex-col bg-pane text-ink shadow-raised outline-none',
  'inset-x-0 bottom-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]',
  'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-250 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-180',
  'md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[min(32rem,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:pb-0',
  'md:data-[state=open]:slide-in-from-bottom-0 md:data-[state=open]:zoom-in-[0.97] md:data-[state=open]:fade-in-0 md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=closed]:zoom-out-[0.97] md:data-[state=closed]:fade-out-0',
)

type FrameProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  /** Blocks closing while a request runs. */
  busy?: boolean
  children: ReactNode
}

/**
 * Where focus goes when a dialog closes: back to whatever opened it, even
 * when the dialog was opened from state (no Radix trigger). If a confirmed
 * delete removed that element, focus moves to the row that took its place
 * in the same list ([data-hb-list] rows carry data-index), else the row
 * before it, else the list, else the main pane.
 */
function useReturnFocus(open: boolean) {
  const opener = useRef<{ el: HTMLElement; list: HTMLElement | null; index: number } | null>(null)
  // A layout effect runs before Radix moves focus into the dialog.
  useLayoutEffect(() => {
    if (!open) return
    const el = document.activeElement
    if (!(el instanceof HTMLElement) || el === document.body) return
    const list = el.closest<HTMLElement>('[data-hb-list]')
    const row = el.closest<HTMLElement>('[data-index]')
    opener.current = { el, list, index: row ? Number(row.dataset.index) : -1 }
  }, [open])
  return (event: Event) => {
    const saved = opener.current
    opener.current = null
    if (!saved) return
    event.preventDefault()
    const focusIn = (root: Element | null | undefined) => {
      const target = root?.matches('a,button,input,[tabindex]') ? root : root?.querySelector<HTMLElement>('a[href],button:not([disabled]),input,[tabindex]:not([tabindex="-1"])')
      if (target instanceof HTMLElement) {
        target.focus()
        return true
      }
      return false
    }
    if (saved.el.isConnected) {
      saved.el.focus()
      return
    }
    // The opener's row is gone (deleted): the next row now has its index.
    requestAnimationFrame(() => {
      const list = saved.list?.isConnected ? saved.list : null
      if (list && saved.index >= 0) {
        if (focusIn(list.querySelector(`[data-index="${saved.index}"]`))) return
        if (focusIn(list.querySelector(`[data-index="${saved.index - 1}"]`))) return
      }
      if (list) {
        list.tabIndex = -1
        list.focus()
        return
      }
      document.getElementById('content')?.focus()
    })
  }
}

function Frame({ open, onOpenChange, title, description, busy = false, children }: FrameProps) {
  const returnFocus = useReturnFocus(open)
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY} />
        <Dialog.Content
          className={CONTENT}
          onEscapeKeyDown={(e) => {
            // While a combobox's list is open (TopicPicker), Escape closes
            // the list, not the dialog: Radix hears Escape first, at the document.
            const t = e.target instanceof Element ? e.target : null
            if (busy || t?.closest('[role="combobox"][aria-expanded="true"]')) e.preventDefault()
          }}
          onPointerDownOutside={(e) => busy && e.preventDefault()}
          onCloseAutoFocus={returnFocus}
        >
          <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line md:hidden" />
          <div className="flex items-start gap-3 px-5 pt-4 md:pt-5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Dialog.Title className="text-[17px] leading-snug font-semibold text-balance">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-[13.5px] text-mute">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Dialog</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close" disabled={busy} className="-mt-1.5 -mr-2">
                <XIcon aria-hidden />
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ErrorLine({ error }: { error: Error | string | null | undefined }) {
  if (!error) return null
  const { id, text } = splitErrorId(typeof error === 'string' ? error : error.message)
  return (
    <p role="alert" className="text-[13px] text-destructive">
      {id && <span className="font-mono">{id} · </span>}
      <UserText lines={3} as="span">
        {text}
      </UserText>
    </p>
  )
}

export type Guard = { kind: 'typed'; word: string } | { kind: 'separated' }

type ConfirmProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** What's affected, shown verbatim (a hostile topic name, a memory). */
  subject?: string
  /** What happens: one short line each. */
  consequences: ReactNode[]
  /** What stays, so the reader knows the edges. */
  keeps?: ReactNode
  actionLabel: string
  /** The safe choice's label for the separated guard ("Keep editing"). */
  keepLabel?: string
  onConfirm: () => void
  guard: Guard
  pending?: boolean
  error?: Error | string | null
}

export function ConfirmDialog({ open, onOpenChange, title, subject, consequences, keeps, actionLabel, keepLabel = 'Keep everything', onConfirm, guard, pending = false, error }: ConfirmProps) {
  const [typed, setTyped] = useState('')
  const armed = guard.kind === 'separated' || typed.trim().toLowerCase() === guard.word
  const close = (o: boolean) => {
    if (!o) setTyped('')
    onOpenChange(o)
  }
  return (
    <Frame open={open} onOpenChange={close} title={title} busy={pending}>
      <form
        className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pt-3 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (armed && !pending) onConfirm()
        }}
      >
        {subject && (
          <div className="rounded-lg bg-sunken px-3 py-2.5 shadow-[inset_0_0_0_var(--hair)_var(--line)]">
            <UserText as="p" lines={2} className="text-[14px] font-medium">
              {subject}
            </UserText>
          </div>
        )}
        <ul className="flex flex-col gap-1.5 text-[14px]">
          {consequences.map((c, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span aria-hidden className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-off" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
        {keeps && <p className="text-[13px] text-mute">{keeps}</p>}
        {guard.kind === 'typed' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm-word" className="text-[13px] font-medium">
              Type <code className="rounded bg-sunken px-1 font-mono">{guard.word}</code> to confirm
            </label>
            <TextInput
              id="confirm-word"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={pending}
            />
          </div>
        )}
        <ErrorLine error={error} />
        {guard.kind === 'typed' ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={!armed} pending={pending} className="bg-destructive text-white hover:bg-[color-mix(in_oklch,var(--destructive)_88%,black)] dark:text-[oklch(0.16_0.02_25)]">
              {actionLabel}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Dialog.Close asChild>
              <Button variant="primary" disabled={pending} className="h-11 w-full">
                {keepLabel}
              </Button>
            </Dialog.Close>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
              <span className="text-[12.5px] text-mute">This can’t be undone.</span>
              <Button type="submit" variant="danger" pending={pending}>
                {actionLabel}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Frame>
  )
}

type FormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  submitLabel: string
  pendingLabel?: string
  onSubmit: () => void
  pending?: boolean
  canSubmit?: boolean
  error?: Error | string | null
  children: ReactNode
}

/** A form in a dialog: Enter submits from inputs, ⌘/Ctrl+Enter from text
 * areas; while it runs the dialog can't be closed. */
export function FormDialog({ open, onOpenChange, title, description, submitLabel, pendingLabel, onSubmit, pending = false, canSubmit = true, error, children }: FormDialogProps) {
  function submit(e: FormEvent) {
    e.preventDefault()
    if (canSubmit && !pending) onSubmit()
  }
  return (
    <Frame open={open} onOpenChange={onOpenChange} title={title} description={description} busy={pending}>
      <form
        className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pt-3 pb-5"
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e)
        }}
      >
        {children}
        <ErrorLine error={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Dialog.Close asChild>
            <Button variant="ghost" disabled={pending}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button type="submit" variant="primary" pending={pending} disabled={!canSubmit}>
            {pending ? (pendingLabel ?? submitLabel) : error ? 'Try again' : submitLabel}
          </Button>
        </div>
      </form>
    </Frame>
  )
}
