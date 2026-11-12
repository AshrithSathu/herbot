// Variant "Modal" — axis: a centred modal (a bottom sheet on phones) with a
// typed guard: destruction waits until you type the word "forget".
import { useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { cn } from '@/lib/utils'
import { ACTS, ActRow, Consequences, Done, Loading, NewAgentForm, Stage, Subject, isTouch, triggerDanger, triggerQuiet, useAct, useIsPhone, useStress, type Kind, type Stress } from './shared'

export function ModalVariant() {
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

/** Centred on desktop, a bottom sheet on phones; overlay and panel share timing. */
function Panel({ title, description, children, locked = false, initialFocus }: {
  title: string
  description?: ReactNode
  children: ReactNode
  locked?: boolean
  /** Where focus lands on open; 'self' leaves it to the content (the form autofocuses its first field). */
  initialFocus?: RefObject<HTMLElement | null> | 'self'
}) {
  const phone = useIsPhone()
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="k5-overlay fixed inset-0 z-50 bg-[oklch(0.2_0.02_245/0.42)]" />
      <Dialog.Content
        onOpenAutoFocus={(e) => {
          if (!initialFocus) return
          e.preventDefault()
          if (initialFocus !== 'self' && !isTouch()) initialFocus.current?.focus()
        }}
        onEscapeKeyDown={(e) => locked && e.preventDefault()}
        onPointerDownOutside={(e) => locked && e.preventDefault()}
        className={cn(
          'hb fixed z-50 flex flex-col gap-4 bg-[var(--c-pane)] p-5 shadow-[var(--c-raised)] outline-none',
          phone
            ? 'k5-sheet-up inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]'
            : 'k5-modal top-1/2 left-1/2 max-h-[85dvh] w-[min(480px,calc(100vw-2rem))] overflow-y-auto rounded-2xl',
        )}
        // .hb carries the tokens into the portal; its canvas background must not.
        style={phone ? { background: 'var(--c-pane)' } : { background: 'var(--c-pane)', transform: 'translate(-50%, -50%)' }}
      >
        {phone && <div aria-hidden className="mx-auto -mt-2 h-1 w-9 rounded-full bg-[var(--c-line)]" />}
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Dialog.Title className="text-lg font-semibold tracking-tight">{title}</Dialog.Title>
            {description ? <Dialog.Description className="text-sm text-[var(--c-mute)]">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
          </div>
          <Dialog.Close
            disabled={locked}
            aria-label="Close"
            className="-mt-2 -mr-2 grid size-10 shrink-0 place-items-center rounded-lg text-[var(--c-mute)] hover:bg-[var(--c-sunken)] disabled:opacity-40 pointer-coarse:size-11"
          >
            <XIcon className="size-4" aria-hidden />
          </Dialog.Close>
        </div>
        {children}
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
      <Panel title="New agent" description="It gets its own topic in your Telegram group and answers there." locked={pending} initialFocus="self">
        <NewAgentForm onCancel={() => setOpen(false)} onPendingChange={setPending} />
      </Panel>
    </Dialog.Root>
  )
}

const WORD = 'forget'

function Confirm({ kind, s }: { kind: Kind; s: Stress }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const act = useAct()
  const id = useId()
  const cancel = useRef<HTMLButtonElement>(null)
  const word = useRef<HTMLInputElement>(null)
  const ready = typed.trim().toLowerCase() === WORD
  const working = act.phase === 'working'
  // A memory is cheap to lose and easy to re-add: no typed guard for it.
  const guarded = kind !== 'forget-memory'
  return (
    <ActRow
      kind={kind}
      s={s}
      status={act.phase === 'done' && <Done kind={kind} onReset={act.reset} />}
      trigger={
        <Dialog.Root
          open={open}
          onOpenChange={(o) => {
            if (working) return
            setOpen(o)
            if (!o) setTyped('')
          }}
        >
          <Dialog.Trigger className={kind === 'forget-memory' ? triggerQuiet : triggerDanger}>{ACTS[kind].verb}…</Dialog.Trigger>
          <Panel title={ACTS[kind].title} locked={working} initialFocus={guarded ? word : cancel}>
            <form
              className="flex flex-col gap-4"
              onSubmit={async (e) => {
                e.preventDefault()
                if (guarded && !ready) return
                await act.run()
                setOpen(false)
                setTyped('')
              }}
            >
              <Subject kind={kind} s={s} />
              <Consequences kind={kind} />
              {guarded && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={id} className="text-sm">
                    Type <span className="rounded bg-[var(--c-sunken)] px-1.5 py-0.5 font-mono text-[13px]">{WORD}</span> to confirm
                  </label>
                  <input
                    ref={word}
                    id={id}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    disabled={working}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-1p-ignore
                    className="h-11 rounded-lg bg-[var(--c-sunken)] px-3 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-ink)]/25 md:text-sm"
                  />
                  <p className="text-xs text-[var(--c-mute)]">A word, not the topic’s name: names here can be 128 characters of anything.</p>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <Dialog.Close ref={cancel} disabled={working} className="h-10 rounded-lg px-4 text-sm font-medium hover:bg-[var(--c-sunken)] disabled:opacity-50 pointer-coarse:h-11">
                  Cancel
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={(guarded && !ready) || working}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--c-off)] px-4 text-sm font-medium text-[var(--c-accent-ink)] transition-[opacity,scale] duration-150 ease-out active:scale-[0.96] disabled:opacity-40 pointer-coarse:h-11"
                >
                  {working && <span className="size-3.5 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin" aria-hidden />}
                  {working ? 'Working…' : ACTS[kind].verb}
                </button>
              </div>
            </form>
          </Panel>
        </Dialog.Root>
      }
    />
  )
}
