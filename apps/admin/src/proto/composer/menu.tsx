// Variant "Menu" — compact axis: a single row (attach · growing input · mode
// menu · send) with the attachments as cards in a tray above it. The mode is
// one button that opens a menu explaining each mode. Enter sends.
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { DropdownMenu } from 'radix-ui'
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, FileIcon, LoaderIcon, PlusIcon, XIcon } from 'lucide-react'
import { formatBytes } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { ComposerFrame } from './frame'
import { MAX_CHARS, MODES, autoGrow, fileProblem, useComposer, type ComposerState } from './data'

export function MenuVariant() {
  const state = useComposer()
  return (
    <ComposerFrame state={state}>
      <MenuComposer s={state} />
    </ComposerFrame>
  )
}

function MenuComposer({ s }: { s: ComposerState }) {
  const box = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => autoGrow(box.current, 200), [s.text])
  const mode = MODES.find((m) => m.id === s.mode) ?? MODES[0]

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    if (e.shiftKey && !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    s.send()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        s.send()
      }}
      className="flex flex-col gap-2"
    >
      {s.files.length > 0 && (
        <ul aria-label="Attachments" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {s.files.map((f) => {
            const problem = fileProblem(f)
            return (
              <li
                key={f.id}
                className={cn(
                  'flex min-h-14 min-w-0 items-center gap-3 rounded-xl bg-[var(--c-pane)] py-2 pr-1 pl-2.5 shadow-[var(--c-raised)]',
                  problem && 'ring-1 ring-[var(--c-off)]',
                )}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--c-sunken)] text-[var(--c-mute)]">
                  <FileIcon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <UserText className="text-sm font-medium">{f.name}</UserText>
                  <span className={cn('block text-xs tabular-nums', problem ? 'text-[var(--c-off)]' : 'text-[var(--c-mute)]')}>
                    {problem ?? formatBytes(f.size)}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => s.removeFile(f.id)}
                  className="grid size-10 shrink-0 place-items-center rounded-lg text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] pointer-coarse:size-11"
                >
                  <XIcon className="size-4" aria-hidden />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex items-end gap-1.5 rounded-[22px] bg-[var(--c-pane)] p-1.5 shadow-[var(--c-raised)] transition-[box-shadow] duration-150 ease-out focus-within:shadow-[var(--c-raised),0_0_0_3px_var(--c-accent-soft)]">
        <label
          title="Attach files"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] has-focus-visible:ring-2 has-focus-visible:ring-[var(--c-accent)] pointer-coarse:size-11"
        >
          <PlusIcon className="size-5" aria-hidden />
          <input type="file" multiple className="sr-only" aria-label="Attach files" onChange={(e) => {
            s.addFiles(e.target.files)
            e.target.value = ''
          }} />
        </label>
        <label htmlFor="menu-text" className="sr-only">Message this agent</label>
        <textarea
          id="menu-text"
          ref={box}
          rows={1}
          value={s.text}
          onChange={(e) => s.setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Message"
          aria-describedby="menu-status"
          className="block min-h-9 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-base leading-6 outline-none placeholder:text-[var(--c-faint)] md:text-[15px] pointer-coarse:min-h-11 pointer-coarse:py-2.5"
        />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            className="flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-[var(--c-mute)] outline-none hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] focus-visible:ring-2 focus-visible:ring-[var(--c-accent)] data-[state=open]:bg-[var(--c-sunken)] pointer-coarse:h-11"
            aria-label={`Mode for this message: ${mode.label}`}
          >
            <span className={cn(s.mode !== 'auto' && 'text-[var(--c-accent)]')}>{mode.label}</span>
            <ChevronDownIcon className="size-3.5" aria-hidden />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="end"
              sideOffset={8}
              collisionPadding={12}
              className="hb z-[60] w-72 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-xl bg-[var(--c-pane)] p-1 shadow-[var(--c-raised)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] duration-150"
            >
              <DropdownMenu.Label className="px-3 pt-2 pb-1 text-xs text-[var(--c-mute)]">Mode for this message</DropdownMenu.Label>
              <DropdownMenu.RadioGroup value={s.mode} onValueChange={(v) => s.setMode(v as typeof s.mode)}>
                {MODES.map((m) => (
                  <DropdownMenu.RadioItem
                    key={m.id}
                    value={m.id}
                    className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-[var(--c-sunken)]"
                  >
                    <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
                      <DropdownMenu.ItemIndicator>
                        <CheckIcon className="size-4 text-[var(--c-accent)]" aria-hidden />
                      </DropdownMenu.ItemIndicator>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{m.label}</span>
                      <span className="block text-xs text-[var(--c-mute)]">{m.hint}</span>
                    </span>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button
          type="submit"
          disabled={!s.canSend}
          aria-label={s.sending ? 'Sending' : 'Send message'}
          className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--c-accent)] text-[var(--c-accent-ink)] transition-[opacity,scale] duration-150 ease-out active:scale-[0.96] disabled:bg-[var(--c-sunken)] disabled:text-[var(--c-faint)] pointer-coarse:size-11"
        >
          {s.sending ? <LoaderIcon className="size-[18px] motion-safe:animate-spin" aria-hidden /> : <ArrowUpIcon className="size-[18px]" aria-hidden />}
        </button>
      </div>
      <p id="menu-status" role="status" className={cn('flex min-h-5 justify-between gap-3 px-4 text-xs', s.problem ? 'text-[var(--c-off)]' : 'text-[var(--c-faint)]')}>
        <span>{s.problem ?? 'Enter to send · Shift+Enter for a new line'}</span>
        {s.nearLimit && <span className="shrink-0 tabular-nums">{s.count.toLocaleString('en-GB')} / {MAX_CHARS.toLocaleString('en-GB')}</span>}
      </p>
    </form>
  )
}
