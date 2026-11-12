// Variant "Sheet" — axis: actions open in a side sheet that stands where the
// details pane would (a full-height sheet on phones). Guard: separation, the
// safe choice is the primary button and the destructive act sits apart.
import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { cn } from '@/lib/utils'
import { ACTS, ActRow, Consequences, Done, Loading, NewAgentForm, Stage, Subject, isTouch, triggerDanger, triggerQuiet, useAct, useIsPhone, useStress, type Kind, type Stress } from './shared'

export function SheetVariant() {
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

function Side({ title, eyebrow, children, footer, locked = false, initialFocus }: {
  title: string
  eyebrow: string
  children: ReactNode
  footer?: ReactNode
  locked?: boolean
  initialFocus?: RefObject<HTMLElement | null> | 'self'
}) {
  const phone = useIsPhone()
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="k5-overlay fixed inset-0 z-50 bg-[oklch(0.2_0.02_245/0.28)]" />
      <Dialog.Content
        onOpenAutoFocus={(e) => {
          if (!initialFocus) return
          e.preventDefault()
          if (initialFocus !== 'self' && !isTouch()) initialFocus.current?.focus()
        }}
        onEscapeKeyDown={(e) => locked && e.preventDefault()}
        onPointerDownOutside={(e) => locked && e.preventDefault()}
        // .hb carries the tokens into the portal; its canvas background must not.
        style={{ background: 'var(--c-pane)' }}
        className={cn(
          'hb fixed z-50 flex flex-col bg-[var(--c-pane)] shadow-[var(--c-raised)] outline-none',
          phone
            ? 'k5-sheet-up inset-x-0 bottom-0 h-[92dvh] rounded-t-2xl'
            : 'k5-sheet-right top-2 right-2 bottom-2 w-[min(420px,calc(100vw-1rem))] rounded-xl',
        )}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b-[length:var(--hair)] border-[var(--c-line)] pr-2 pl-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium tracking-wide text-[var(--c-mute)] uppercase">{eyebrow}</p>
            <Dialog.Title className="truncate text-[15px] leading-tight font-semibold">{title}</Dialog.Title>
          </div>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <Dialog.Close disabled={locked} aria-label="Close" className="grid size-11 place-items-center rounded-lg text-[var(--c-mute)] hover:bg-[var(--c-sunken)] disabled:opacity-40">
            <XIcon className="size-4" aria-hidden />
          </Dialog.Close>
        </header>
        <div className="scroller flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">{children}</div>
        {footer && <footer className="shrink-0 border-t-[length:var(--hair)] border-[var(--c-line)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{footer}</footer>}
      </Dialog.Content>
    </Dialog.Portal>
  )
}

function NewAgent() {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <Dialog.Trigger className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--c-accent)] px-4 text-sm font-medium text-[var(--c-accent-ink)] transition-[scale] duration-150 ease-out active:scale-[0.96] pointer-coarse:h-11">
        <PlusIcon className="size-4" aria-hidden />
        New agent
      </Dialog.Trigger>
      <Side eyebrow="Agents" title="New agent" locked={pending} initialFocus="self">
        <p className="text-sm text-[var(--c-mute)]">It gets its own topic in your Telegram group and answers there.</p>
        <NewAgentForm onCancel={() => setOpen(false)} onPendingChange={setPending} />
      </Side>
    </Dialog.Root>
  )
}

function Confirm({ kind, s }: { kind: Kind; s: Stress }) {
  const [open, setOpen] = useState(false)
  const act = useAct()
  const keep = useRef<HTMLButtonElement>(null)
  const working = act.phase === 'working'
  return (
    <ActRow
      kind={kind}
      s={s}
      status={act.phase === 'done' && <Done kind={kind} onReset={act.reset} />}
      trigger={
        <Dialog.Root open={open} onOpenChange={(o) => !working && setOpen(o)}>
          <Dialog.Trigger className={kind === 'forget-memory' ? triggerQuiet : triggerDanger}>{ACTS[kind].verb}…</Dialog.Trigger>
          <Side
            eyebrow={kind === 'forget-memory' ? 'Memory' : 'Danger zone'}
            title={ACTS[kind].title}
            locked={working}
            initialFocus={keep}
            footer={
              <div className="flex flex-col">
                <Dialog.Close
                  ref={keep}
                  disabled={working}
                  className="h-11 w-full rounded-lg bg-[var(--c-ink)] text-sm font-medium text-[var(--c-pane)] transition-[scale] duration-150 ease-out active:scale-[0.96] disabled:opacity-50"
                >
                  {kind === 'forget-memory' ? 'Keep the memory' : 'Keep everything'}
                </Dialog.Close>
                {/* Apart from the safe choice: whitespace and a rule, never side by side. */}
                <div className="mt-6 flex items-center justify-between gap-3 border-t-[length:var(--hair)] border-[var(--c-line)] pt-4">
                  <p className="text-xs text-[var(--c-mute)]">This can’t be undone.</p>
                  <button
                    type="button"
                    disabled={working}
                    onClick={async () => {
                      await act.run()
                      setOpen(false)
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[var(--c-off)] shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--c-off)_40%,transparent)] transition-[background-color,scale] duration-150 ease-out hover:bg-[color-mix(in_oklch,var(--c-off)_8%,transparent)] active:scale-[0.96] disabled:opacity-60 pointer-coarse:h-11"
                  >
                    {working && <span className="size-3.5 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin" aria-hidden />}
                    {working ? 'Working…' : ACTS[kind].verb}
                  </button>
                </div>
              </div>
            }
          >
            <Subject kind={kind} s={s} />
            <Consequences kind={kind} />
          </Side>
        </Dialog.Root>
      }
    />
  )
}
