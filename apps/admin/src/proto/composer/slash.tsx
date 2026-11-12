// Variant "Slash" — keyboard axis: a tall editor where typing "/" opens the
// mode commands (/fast, /think, /heavy, /deepsearch), the chosen mode sits as
// a token, Enter is a new line and Cmd/Ctrl+Enter sends. Attachments are
// listed inside the editor, under the text.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { LoaderIcon, PaperclipIcon, XIcon } from 'lucide-react'
import { formatBytes } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { ComposerFrame } from './frame'
import { MAX_CHARS, MODES, fileProblem, isMac, useComposer, type ComposerState } from './data'

export function SlashVariant() {
  const state = useComposer()
  return (
    <ComposerFrame state={state}>
      <SlashComposer s={state} />
    </ComposerFrame>
  )
}

function SlashComposer({ s }: { s: ComposerState }) {
  const box = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const query = /^\/(\w*)$/.exec(s.text)?.[1]?.toLowerCase()
  const matches = useMemo(
    () => (query === undefined ? [] : MODES.filter((m) => m.id.startsWith(query) || m.label.toLowerCase().startsWith(query))),
    [query],
  )
  const open = matches.length > 0 && !dismissed
  // The server can't know the OS; settle it after hydration (no mismatch).
  const [mod, setMod] = useState('Ctrl')
  useEffect(() => setMod(isMac() ? '⌘' : 'Ctrl'), [])

  function pick(i: number) {
    const m = matches[i]
    if (!m) return
    s.setMode(m.id)
    s.setText('')
    setActive(0)
    box.current?.focus()
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(Math.min(active, matches.length - 1))
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      s.send()
    }
  }

  const mode = MODES.find((m) => m.id === s.mode) ?? MODES[0]

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        s.send()
      }}
      className="relative flex flex-col gap-1.5"
    >
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Modes"
          className="absolute right-0 bottom-full left-0 mb-2 max-w-sm rounded-xl bg-[var(--c-pane)] p-1 shadow-[var(--c-raised)]"
        >
          {matches.map((m, i) => (
            <li
              key={m.id}
              id={`${listId}-${m.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault() // keep focus in the editor
                pick(i)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5', i === active && 'bg-[var(--c-sunken)]')}
            >
              <code className="w-24 shrink-0 font-mono text-[13px] text-[var(--c-accent)]">/{m.id}</code>
              <span className="min-w-0 text-xs text-[var(--c-mute)]">{m.hint}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col rounded-xl border border-[var(--c-line)] bg-[var(--c-pane)] transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-[var(--c-accent)] focus-within:shadow-[0_0_0_3px_var(--c-accent-soft)]">
        {s.mode !== 'auto' && (
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <span className="flex h-7 items-center gap-1 rounded-md bg-[var(--c-accent-soft)] pr-0.5 pl-2 text-xs font-medium text-[var(--c-accent)]">
              {mode.label}
              <button
                type="button"
                aria-label={`Clear mode ${mode.label}`}
                onClick={() => s.setMode('auto')}
                className="relative grid size-6 place-items-center rounded before:absolute before:-inset-2 hover:bg-[color-mix(in_oklch,var(--c-accent)_15%,transparent)]"
              >
                <XIcon className="size-3" aria-hidden />
              </button>
            </span>
            <span className="truncate text-xs text-[var(--c-mute)]">{mode.hint}</span>
          </div>
        )}
        <label htmlFor="slash-text" className="sr-only">Message this agent. Type / for modes.</label>
        <textarea
          id="slash-text"
          ref={box}
          rows={5}
          value={s.text}
          onChange={(e) => {
            s.setText(e.target.value)
            setDismissed(false)
            setActive(0)
          }}
          onKeyDown={onKey}
          placeholder="Write to the agent. Type / for a mode."
          role={open ? 'combobox' : undefined}
          aria-expanded={open || undefined}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
          aria-describedby="slash-status"
          className="scroller block max-h-[40vh] min-h-32 w-full resize-none bg-transparent px-3.5 py-3 text-base leading-6 outline-none placeholder:text-[var(--c-faint)] md:text-[15px]"
        />
        {s.files.length > 0 && (
          <ul aria-label="Attachments" className="mx-3 mb-2 flex flex-col divide-y divide-[var(--c-line)] rounded-lg border border-[var(--c-line)]">
            {s.files.map((f) => {
              const problem = fileProblem(f)
              return (
                <li key={f.id} className="flex min-h-11 items-center gap-2 pr-1 pl-3">
                  <PaperclipIcon className="size-3.5 shrink-0 text-[var(--c-faint)]" aria-hidden />
                  <UserText className="min-w-0 flex-1 text-[13px]">{f.name}</UserText>
                  <span className={cn('shrink-0 text-xs tabular-nums', problem ? 'font-medium text-[var(--c-off)]' : 'text-[var(--c-mute)]')}>
                    {problem ? 'Over 20 MB' : formatBytes(f.size)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => s.removeFile(f.id)}
                    className="grid size-9 shrink-0 place-items-center rounded-md text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] pointer-coarse:size-11"
                  >
                    <XIcon className="size-3.5" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex items-center gap-2 border-t border-[var(--c-line)] px-2 py-1.5">
          <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] has-focus-visible:ring-2 has-focus-visible:ring-[var(--c-accent)] pointer-coarse:h-11">
            <PaperclipIcon className="size-4" aria-hidden />
            Attach
            <input type="file" multiple className="sr-only" onChange={(e) => {
              s.addFiles(e.target.files)
              e.target.value = ''
            }} />
          </label>
          <span className={cn('ml-auto text-xs tabular-nums', s.over ? 'font-medium text-[var(--c-off)]' : 'text-[var(--c-faint)]')}>
            {s.count.toLocaleString('en-GB')} / {MAX_CHARS.toLocaleString('en-GB')}
          </span>
          <button
            type="submit"
            disabled={!s.canSend}
            className="flex h-9 items-center gap-2 rounded-lg bg-[var(--c-accent)] px-3.5 text-[13px] font-medium text-[var(--c-accent-ink)] transition-[opacity,scale] duration-150 ease-out active:scale-[0.96] disabled:bg-[var(--c-sunken)] disabled:text-[var(--c-faint)] pointer-coarse:h-11"
          >
            {s.sending && <LoaderIcon className="size-4 motion-safe:animate-spin" aria-hidden />}
            {s.sending ? 'Sending…' : 'Send'}
            {!s.sending && <kbd className="hidden font-sans text-[11px] opacity-70 [@media(pointer:fine)]:inline">{mod}↵</kbd>}
          </button>
        </div>
      </div>
      <p id="slash-status" role="status" className={cn('min-h-5 px-1 text-xs', s.problem ? 'text-[var(--c-off)]' : 'text-[var(--c-faint)]')}>
        {s.problem ?? `${mod}+Enter to send · Enter for a new line · / for a mode`}
      </p>
    </form>
  )
}
