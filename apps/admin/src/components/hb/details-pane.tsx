// The topic details pane (docs/design/DECISIONS.md, "Details pane"): Summary
// as the base. Facts read first as quiet rows; tapping a value edits just that
// row, which saves on its own; the danger zone comes last. Its actions are
// confirmed in the decided dialogs (dialogs.tsx).
import { useState, type ReactNode } from 'react'
import { ChevronLeftIcon, PencilIcon, XIcon } from 'lucide-react'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { Button } from './controls'
import { ConfirmDialog, type Guard } from './dialogs'

type PaneProps = {
  title: string
  /** Under the title: status, group. */
  subtitle?: ReactNode
  /** Closes the pane (desktop) or goes back (phones). */
  onClose?: () => void
  /** The pane's accessible name ("Topic details", "Memory"). */
  label?: string
  /** The phone back button's label ("Back to the chat", "Back to memories"). */
  backLabel?: string
  children: ReactNode
  className?: string
}

export function DetailsPane({ title, subtitle, onClose, label = 'Topic details', backLabel = 'Back to the chat', children, className }: PaneProps) {
  return (
    <section aria-label={label} className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-2 md:px-4">
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={backLabel} className="wide:hidden">
            <ChevronLeftIcon aria-hidden />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 flex-col py-2">
          <UserText className="text-[15px] font-semibold">{title}</UserText>
          {subtitle && <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-mute">{subtitle}</div>}
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close details" className="hidden wide:inline-flex">
            <XIcon aria-hidden />
          </Button>
        )}
      </header>
      <div data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {children}
      </div>
    </section>
  )
}

export function DetailsSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col border-b border-line px-4 py-3 last:border-b-0">
      {title && <h3 className="pb-1 text-[11px] font-medium tracking-[0.06em] text-mute uppercase">{title}</h3>}
      <dl className="flex flex-col">{children}</dl>
    </section>
  )
}

type RowProps = {
  label: string
  /** The value as it reads. */
  value: ReactNode
  /** An editor for just this row; `done` closes it after a save. */
  edit?: (done: () => void) => ReactNode
  /** Long values (a purpose) go under the label instead of beside it. */
  block?: boolean
}

/** A fact; tap it (or its pencil) to edit just this one. */
export function DetailRow({ label, value, edit, block = false }: RowProps) {
  const [editing, setEditing] = useState(false)
  if (editing && edit) {
    return (
      <div className="flex flex-col gap-2 py-2.5">
        <dt className="text-[13px] font-medium text-ink">{label}</dt>
        <dd>{edit(() => setEditing(false))}</dd>
      </div>
    )
  }
  const content = (
    <>
      <dt className="shrink-0 text-[13.5px] text-mute">{label}</dt>
      <dd className={cn('min-w-0 text-[13.5px] text-ink', block ? 'w-full' : 'flex-1 text-right')}>{value}</dd>
    </>
  )
  if (!edit) {
    return <div className={cn('flex min-h-11 gap-3 py-2', block ? 'flex-col gap-1' : 'items-center')}>{content}</div>
  }
  return (
    <div className={cn('group relative flex min-h-11 gap-3 rounded-md py-2', block ? 'flex-col gap-1' : 'items-center')}>
      {content}
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${label.toLowerCase()}`}
        className="absolute inset-0 -mx-2 rounded-md transition-[background-color] duration-150 ease-out hover:bg-sunken/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PencilIcon aria-hidden className="absolute top-2.5 right-2 size-3.5 text-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 pointer-coarse:opacity-100" />
      </button>
    </div>
  )
}

/** The last section: destructive actions, apart from everything else. */
export function DangerZone({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="hb-danger" className="mt-2 flex flex-col gap-1 px-4 py-3">
      <h3 id="hb-danger" className="pb-1 text-[11px] font-medium tracking-[0.06em] text-destructive uppercase">
        Danger zone
      </h3>
      {children}
    </section>
  )
}

type DangerProps = {
  title: string
  description: ReactNode
  /** Button and dialog action label, e.g. "Start a clean slate". */
  actionLabel: string
  subject?: string
  consequences: ReactNode[]
  keeps?: ReactNode
  guard: Guard
  onConfirm: () => Promise<unknown> | void
}

/** One destructive action: what it does, a quiet red button, the dialog. */
export function DangerAction({ title, description, actionLabel, subject, consequences, keeps, guard, onConfirm }: DangerProps) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col">
        <span className="text-[14px] text-ink">{title}</span>
        <span className="text-[12.5px] text-mute">{description}</span>
      </div>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)} className="self-start sm:self-center">
        {actionLabel}…
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setError(null)
        }}
        title={`${actionLabel}?`}
        subject={subject}
        consequences={consequences}
        keeps={keeps}
        actionLabel={actionLabel}
        guard={guard}
        pending={pending}
        error={error}
        onConfirm={async () => {
          setPending(true)
          setError(null)
          try {
            await onConfirm()
            setOpen(false)
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            setPending(false)
          }
        }}
      />
    </div>
  )
}
