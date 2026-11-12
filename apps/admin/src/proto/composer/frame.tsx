// The same surroundings for every composer variant: a conversation pane with
// real recent messages (previewed), then whatever you "send" locally, then
// the composer pinned to the bottom with the safe area respected.
import '@/proto/tokens.css'
import { useEffect, useRef, type ReactNode } from 'react'
import { AlertCircleIcon, CheckIcon, LoaderIcon, PaperclipIcon } from 'lucide-react'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { clock, useWorstConversation } from '../message/data'
import { MODES, type ComposerState } from './data'

export function ComposerFrame({ state, children }: { state: ComposerState; children: ReactNode }) {
  const { topic, entries } = useWorstConversation()
  const recent = entries.filter((e) => e.kind === 'message').slice(-4)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Block body: scrollIntoView returns a promise in current browsers, and
    // an effect may only return a cleanup function.
    end.current?.scrollIntoView({ block: 'end' })
  }, [state.sent.length])
  return (
    <div className="hb fixed inset-0 z-[45] flex flex-col antialiased">
      <header className="flex h-14 shrink-0 items-center border-b border-[var(--c-line)] bg-[var(--c-pane)] px-4 sm:px-6">
        <UserText className="min-w-0 text-[15px] font-medium">{topic?.name}</UserText>
      </header>
      <main className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ol className="mx-auto flex max-w-3xl flex-col gap-3 px-3 py-6 sm:px-6" aria-label="Messages">
          {recent.map((e) =>
            e.kind === 'message' ? (
              <li key={e.message.id} className={cn('flex', e.message.from_bot ? 'justify-start' : 'justify-end')}>
                <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px]', e.message.from_bot ? 'bg-[var(--c-pane)] shadow-[var(--c-raised)]' : 'bg-[var(--c-accent-soft)]')}>
                  <UserText as="p" lines={2} fallback={`${e.message.attachments.length} files`}>
                    {e.message.body}
                  </UserText>
                  <p className="mt-0.5 text-right text-[11px] text-[var(--c-faint)] tabular-nums">{clock(e.message.sent_at)}</p>
                </div>
              </li>
            ) : null,
          )}
          {state.sent.map((s) => (
            <li key={s.id} className="flex flex-col items-end gap-1">
              <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px]', s.status === 'failed' ? 'border border-dashed border-[var(--c-off)]' : 'bg-[var(--c-accent-soft)]', s.status === 'sending' && 'opacity-70')}>
                {s.text && <UserText as="p" lines={3}>{s.text}</UserText>}
                {s.files.length > 0 && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-[var(--c-mute)]">
                    <PaperclipIcon className="size-3" aria-hidden /> {s.files.length} {s.files.length === 1 ? 'file' : 'files'}
                  </p>
                )}
                <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[var(--c-faint)]">
                  {s.mode !== 'auto' && <span>{MODES.find((m) => m.id === s.mode)?.label} ·</span>}
                  {s.status === 'sending' && <><LoaderIcon className="size-3 motion-safe:animate-spin" aria-hidden /> Sending…</>}
                  {s.status === 'sent' && <><CheckIcon className="size-3" aria-hidden /> Sent (prototype, not delivered)</>}
                  {s.status === 'failed' && <span className="flex items-center gap-1 text-[var(--c-off)]"><AlertCircleIcon className="size-3" aria-hidden /> Not sent</span>}
                </p>
              </div>
              {s.status === 'failed' && (
                <div role="alert" className="flex max-w-[85%] flex-wrap items-center justify-end gap-x-2 text-xs text-[var(--c-mute)]">
                  <UserText className="min-w-0">{s.error}</UserText>
                  <button type="button" onClick={() => state.retry(s.id)} className="h-9 rounded-md px-2 font-medium text-[var(--c-ink)] hover:bg-[var(--c-sunken)] pointer-coarse:h-11">Retry</button>
                  <button type="button" onClick={() => state.discard(s.id)} className="h-9 rounded-md px-2 font-medium text-[var(--c-ink)] hover:bg-[var(--c-sunken)] pointer-coarse:h-11">Discard</button>
                </div>
              )}
            </li>
          ))}
          <div ref={end} />
        </ol>
      </main>
      <div className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto max-w-3xl">{children}</div>
      </div>
    </div>
  )
}
