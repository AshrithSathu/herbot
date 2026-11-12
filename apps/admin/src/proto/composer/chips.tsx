// Variant "Chips" — visible-modes axis: one card with the attachment chips
// on top, a one-line textarea that grows, and the five modes as a chip row
// you can see and tap. Enter sends; Shift+Enter is a new line.
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { ArrowUpIcon, LoaderIcon, PaperclipIcon, XIcon } from 'lucide-react'
import { formatBytes } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { ComposerFrame } from './frame'
import { MAX_CHARS, MODES, autoGrow, fileProblem, useComposer, type ComposerState } from './data'

export function ChipsVariant() {
  const state = useComposer()
  return (
    <ComposerFrame state={state}>
      <ChipsComposer s={state} />
    </ComposerFrame>
  )
}

function ChipsComposer({ s }: { s: ComposerState }) {
  const box = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => autoGrow(box.current, 240), [s.text])

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    if (e.shiftKey && !(e.metaKey || e.ctrlKey)) return // a new line
    e.preventDefault()
    s.send()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        s.send()
      }}
      className="flex flex-col gap-1.5"
    >
      <div className="rounded-2xl bg-[var(--c-pane)] shadow-[var(--c-raised)] transition-[box-shadow] duration-150 ease-out focus-within:shadow-[var(--c-raised),0_0_0_3px_var(--c-accent-soft)]">
        {s.files.length > 0 && (
          <ul aria-label="Attachments" className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {s.files.map((f) => {
              const problem = fileProblem(f)
              return (
                <li
                  key={f.id}
                  title={problem ?? f.name}
                  className={cn(
                    'flex h-11 max-w-60 shrink-0 items-center gap-2 rounded-xl border pr-1 pl-3',
                    problem ? 'border-[var(--c-off)] bg-[color-mix(in_oklch,var(--c-off)_6%,transparent)]' : 'border-[var(--c-line)] bg-[var(--c-sunken)]',
                  )}
                >
                  <span className="min-w-0">
                    <UserText className="text-[13px] font-medium">{f.name}</UserText>
                    <span className={cn('block text-[11px] tabular-nums', problem ? 'text-[var(--c-off)]' : 'text-[var(--c-mute)]')}>
                      {problem ? 'Over 20 MB' : formatBytes(f.size)}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => s.removeFile(f.id)}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--c-mute)] hover:bg-[var(--c-line)] hover:text-[var(--c-ink)] pointer-coarse:size-10"
                  >
                    <XIcon className="size-3.5" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <label htmlFor="chips-text" className="sr-only">Message this agent</label>
        <textarea
          id="chips-text"
          ref={box}
          rows={1}
          value={s.text}
          onChange={(e) => s.setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Message this agent"
          aria-describedby="chips-status"
          className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base leading-6 outline-none placeholder:text-[var(--c-faint)] md:text-[15px]"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <label
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)] has-focus-visible:ring-2 has-focus-visible:ring-[var(--c-accent)] pointer-coarse:size-11"
            title="Attach files"
          >
            <PaperclipIcon className="size-[18px]" aria-hidden />
            <input type="file" multiple className="sr-only" aria-label="Attach files" onChange={(e) => {
              s.addFiles(e.target.files)
              e.target.value = ''
            }} />
          </label>
          <ModeChips s={s} />
          {s.nearLimit && (
            <span className={cn('shrink-0 px-1 text-xs tabular-nums', s.over ? 'font-medium text-[var(--c-off)]' : 'text-[var(--c-mute)]')}>
              {(MAX_CHARS - s.count).toLocaleString('en-GB')}
            </span>
          )}
          <button
            type="submit"
            disabled={!s.canSend}
            aria-label={s.sending ? 'Sending' : 'Send message'}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--c-accent)] text-[var(--c-accent-ink)] transition-[opacity,scale] duration-150 ease-out active:scale-[0.96] disabled:bg-[var(--c-sunken)] disabled:text-[var(--c-faint)] pointer-coarse:size-11"
          >
            {s.sending ? <LoaderIcon className="size-[18px] motion-safe:animate-spin" aria-hidden /> : <ArrowUpIcon className="size-[18px]" aria-hidden />}
          </button>
        </div>
      </div>
      <p id="chips-status" role="status" className={cn('min-h-5 px-3 text-xs', s.problem ? 'text-[var(--c-off)]' : 'text-[var(--c-faint)]')}>
        {s.problem ?? 'Enter to send · Shift+Enter for a new line'}
      </p>
    </form>
  )
}

/** The modes as a radio group of chips: arrows move, the row scrolls on phones. */
function ModeChips({ s }: { s: ComposerState }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const index = MODES.findIndex((m) => m.id === s.mode)
  function onKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (index + step + MODES.length) % MODES.length
    s.setMode(MODES[next].id)
    refs.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-label="Mode for this message" onKeyDown={onKey} className="flex min-w-0 flex-1 gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] pr-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {MODES.map((m, i) => {
        const on = m.id === s.mode
        return (
          <button
            key={m.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={m.hint}
            onClick={() => s.setMode(m.id)}
            className={cn(
              // Weight stays put; selection is colour only (no layout shift).
              'h-8 shrink-0 rounded-full px-3 text-[13px] font-medium transition-[background-color,color] duration-150 ease-out pointer-coarse:h-11',
              on ? 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]' : 'text-[var(--c-mute)] hover:bg-[var(--c-sunken)] hover:text-[var(--c-ink)]',
            )}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
