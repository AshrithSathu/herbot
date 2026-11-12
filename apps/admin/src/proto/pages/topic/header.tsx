// Variant 3 "Header": density axis. No separate details surface: the
// conversation header carries the facts in one line (state, mode, language,
// messages, last active), and "Details" expands the full editable details
// right under it, inside the conversation's own column, pushing the chat
// down. Escape or the button folds it back.
import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/hb/controls'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { ago, compact, exact } from '../../../format'
import { Conversation, DetailsBody, Frame, TitleBlock, modeLabel, useTopicDetail, useTopicParam } from './shared'

export function HeaderVariant() {
  const [id, select] = useTopicParam()
  return (
    <Frame topicId={id} onSelect={select}>
      <Main id={id} />
    </Frame>
  )
}

function Main({ id }: { id: number }) {
  const topic = useTopicDetail(id)
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => setOpen(false), [id])
  useEffect(() => {
    if (open) panel.current?.focus()
  }, [open])
  const mode = topic && modeLabel(topic.mode)
  return (
    <Conversation
      topicId={id}
      header={
        <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-line px-2 md:px-4">
          <TitleBlock
            topic={topic}
            facts={
              topic && (
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  <span aria-hidden>·</span>
                  <span className="shrink-0">{mode}</span>
                  <span aria-hidden className="max-sm:hidden">·</span>
                  <UserText className="max-w-[10rem] max-sm:hidden">{topic.language}</UserText>
                  <span aria-hidden>·</span>
                  <span className="shrink-0 tabular-nums" title={`${exact(topic.messages)} messages`}>
                    {compact(topic.messages)}
                  </span>
                  <span aria-hidden className="max-md:hidden">·</span>
                  <span className="shrink-0 max-md:hidden" suppressHydrationWarning>
                    {ago(topic.last_activity)}
                  </span>
                </span>
              )
            }
          />
          <Button variant="ghost" size="sm" aria-expanded={open} aria-controls="proto-topic-details" onClick={() => setOpen((o) => !o)} className="shrink-0">
            Details
            <ChevronDownIcon aria-hidden className={cn('transition-transform duration-150 ease-out', open && 'rotate-180')} />
          </Button>
        </header>
      }
      below={
        open && topic ? (
          <div
            id="proto-topic-details"
            ref={panel}
            tabIndex={-1}
            role="region"
            aria-label="Topic details"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setOpen(false)
              }
            }}
            className="scroller max-h-[min(62dvh,34rem)] shrink-0 overflow-y-auto overscroll-contain border-b border-line bg-sunken/50 outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200"
          >
            <div className="mx-auto w-full max-w-3xl px-1 sm:px-4">
              <DetailsBody topic={topic} compactFacts />
              <div className="flex justify-end px-4 pb-3">
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Fold details
                </Button>
              </div>
            </div>
          </div>
        ) : undefined
      }
    />
  )
}
