// Variant "Inline" — axis: nothing opens; the confirmation expands in place
// under the control that asked for it, so the page stays in view. Guard:
// hold to confirm (pointer, or hold Space/Enter).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { PlusIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACTS, ActRow, Consequences, Done, Loading, NewAgentForm, Stage, isTouch, triggerDanger, triggerQuiet, useAct, useStress, type Kind, type Stress } from './shared'

const HOLD_MS = 1200

export function InlineVariant() {
  const s = useStress()
  if (!s.ready) return <Loading />
  return (
    <Stage
      s={s}
      newAgent={<NewAgent />}
      cleanSlate={<Confirm kind="clean-slate" s={s} />}
      forgetTopic={<Confirm kind="forget-topic" s={s} />}
      forgetMemory={<Confirm kind="forget-memory" s={s} />}
    />
  )
}

/** Grows open from the control above it; closed, it's out of the tab order. */
function Expand({ open, id, label, children, onEscape }: { open: boolean; id: string; label: string; children: ReactNode; onEscape: () => void }) {
  return (
    <div
      className="k5-expand"
      data-open={open ? '' : undefined}
      inert={!open}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onEscape()
        }
      }}
    >
      <div>
        <section id={id} aria-label={label} className="pt-3">
          {open && children}
        </section>
      </div>
    </div>
  )
}

function NewAgent() {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  return (
    <div>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] pointer-coarse:h-11',
          open ? 'bg-[var(--c-sunken)] text-[var(--c-ink)]' : 'bg-[var(--c-accent)] text-[var(--c-accent-ink)]',
        )}
      >
        <PlusIcon className={cn('size-4 transition-transform duration-200', open && 'rotate-45')} aria-hidden />
        {open ? 'Close' : 'New agent'}
      </button>
      <Expand open={open} id={id} label="New agent" onEscape={close}>
        <div className="rounded-xl bg-[var(--c-sunken)]/60 p-3 shadow-[inset_0_0_0_1px_var(--c-line)]">
          <NewAgentForm onCancel={close} />
        </div>
      </Expand>
    </div>
  )
}

/** Press and hold to confirm; letting go early cancels. Space or Enter held
 * does the same from the keyboard. */
function HoldButton({ onConfirm, disabled, children, describedBy }: { onConfirm: () => void; disabled?: boolean; children: ReactNode; describedBy: string }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const stop = () => {
    window.clearTimeout(timer.current)
    setHolding(false)
  }
  const start = () => {
    if (disabled || holding) return
    setHolding(true)
    timer.current = window.setTimeout(() => {
      setHolding(false)
      onConfirm()
    }, HOLD_MS)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      disabled={disabled}
      aria-describedby={describedBy}
      data-holding={holding ? '' : undefined}
      style={{ '--hold': `${HOLD_MS}ms` } as React.CSSProperties}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start()
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault()
          start()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') stop()
      }}
      onBlur={stop}
      className="k5-hold relative inline-flex h-10 touch-none items-center overflow-hidden rounded-lg px-4 text-sm font-medium text-[var(--c-off)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--c-off)_45%,transparent)] select-none [-webkit-touch-callout:none] disabled:opacity-60 pointer-coarse:h-11"
    >
      <span aria-hidden className="k5-hold-fill absolute inset-0 bg-[color-mix(in_oklch,var(--c-off)_18%,transparent)]" />
      <span className="relative">{holding ? 'Keep holding…' : children}</span>
    </button>
  )
}

function Confirm({ kind, s }: { kind: Kind; s: Stress }) {
  const [open, setOpen] = useState(false)
  const act = useAct()
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const working = act.phase === 'working'
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  useEffect(() => {
    if (open && !isTouch()) cancel.current?.focus()
  }, [open])
  return (
    <ActRow
      kind={kind}
      s={s}
      trigger={
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-controls={id}
          disabled={working}
          onClick={() => (open ? close() : setOpen(true))}
          className={kind === 'forget-memory' ? triggerQuiet : triggerDanger}
        >
          {`${ACTS[kind].verb}…`}
        </button>
      }
      status={
        <>
          <Expand open={open} id={id} label={ACTS[kind].title} onEscape={close}>
            <div className="flex flex-col gap-3 rounded-xl p-4 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--c-off)_30%,transparent)]">
              <p className="text-sm font-semibold">{ACTS[kind].title}</p>
              <Consequences kind={kind} />
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <HoldButton
                  describedBy={`${id}-hint`}
                  disabled={working}
                  onConfirm={async () => {
                    await act.run()
                    setOpen(false)
                    // The trigger is disabled while working; focus it once it's re-enabled.
                    requestAnimationFrame(() => trigger.current?.focus())
                  }}
                >
                  {working ? 'Working…' : `Hold to ${ACTS[kind].verb.charAt(0).toLowerCase()}${ACTS[kind].verb.slice(1)}`}
                </HoldButton>
                <button ref={cancel} type="button" onClick={close} className="h-10 rounded-lg px-3 text-sm font-medium hover:bg-[var(--c-sunken)] pointer-coarse:h-11">
                  Cancel
                </button>
                <p id={`${id}-hint`} className="text-xs text-[var(--c-mute)]">
                  Press and hold for a second (or hold Space). Letting go cancels.
                </p>
              </div>
            </div>
          </Expand>
          {act.phase === 'done' && <Done kind={kind} onReset={act.reset} />}
        </>
      }
    />
  )
}
