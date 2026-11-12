// Variant 1 "In details": placement axis. Files belong to the topic's
// details: a section in the details pane beside the conversation (counted,
// filterable, every file downloadable), so the chat never leaves the screen.
import { useLayoutEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { PanelRightIcon } from 'lucide-react'
import { Button } from '@/components/hb/controls'
import { DetailsPane, DetailsSection } from '@/components/hb/details-pane'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { useShell } from '@/components/hb/shell'
import { StatusDot, topicTone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { compact } from '../../../format'
import { Conversation, DetailsBody, Frame, TitleBlock, useTopicDetail, useTopicParam } from '../topic/shared'
import { byName, FileRow, FilterBox, summary, useFiles, useFilter } from './shared'

export function SectionVariant() {
  const [id, select] = useTopicParam()
  return (
    <Frame topicId={id} onSelect={select} details={<Details id={id} />}>
      <Main id={id} />
    </Frame>
  )
}

function Main({ id }: { id: number }) {
  const topic = useTopicDetail(id)
  const { detailsOpen, setDetailsOpen } = useShell()
  useLayoutEffect(() => {
    // The files are what you came for: open the pane, even on phones.
    setDetailsOpen(true)
  }, [setDetailsOpen])
  return (
    <Conversation
      topicId={id}
      header={
        <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-line px-2 md:px-4">
          <TitleBlock topic={topic} facts={topic && <span className="tabular-nums">· {compact(topic.messages)} messages</span>} />
          <Button variant="ghost" size="icon" aria-label={detailsOpen ? 'Hide details' : 'Show details and files'} aria-pressed={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>
            <PanelRightIcon aria-hidden />
          </Button>
        </header>
      }
    />
  )
}

function Details({ id }: { id: number }) {
  const topic = useTopicDetail(id)
  const { setDetailsOpen } = useShell()
  if (!topic) return <ListSkeleton rows={6} lines={1} className="px-4 pt-16" />
  return (
    <DetailsPane
      title={topic.name}
      subtitle={
        <>
          <StatusDot status={topicTone(topic)} />
          <span aria-hidden>·</span>
          <UserText className="min-w-0 flex-1">{topic.group}</UserText>
        </>
      }
      onClose={() => setDetailsOpen(false)}
    >
      <Files id={id} />
      <DetailsBody topic={topic} />
    </DetailsPane>
  )
}

function Files({ id }: { id: number }) {
  const { query, entries, bytes } = useFiles(id)
  const sorted = entries.slice().sort(byName)
  const { q, setQ, shown, filtering } = useFilter(sorted)
  const scroller = useRef<HTMLDivElement>(null)
  const virtual = useVirtualizer({ count: shown.length, getScrollElement: () => scroller.current, estimateSize: () => 56, overscan: 8, initialRect: { width: 352, height: 384 } })
  return (
    <DetailsSection title="Files">
      {query.isPending ? (
        <ListSkeleton rows={4} lines={1} />
      ) : query.error && !query.data ? (
        <InPlaceError title="Couldn’t load the files" error={query.error} onRetry={() => query.refetch()} className="min-h-0 py-2" />
      ) : entries.length === 0 ? (
        <InPlaceEmpty title="No files yet" className="min-h-0 py-2">
          Files you send this agent and files it makes show up here.
        </InPlaceEmpty>
      ) : (
        <div className="flex flex-col gap-2 pb-1">
          <p className="text-[12.5px] text-mute tabular-nums" aria-live="polite">
            {summary(entries.length, bytes, filtering ? shown.length : undefined)}
          </p>
          {entries.length > 6 && <FilterBox id={`files-${id}`} q={q} setQ={setQ} total={entries.length} />}
          {shown.length === 0 ? (
            <p className="py-3 text-[13px] text-mute">
              No file matches.{' '}
              <button type="button" onClick={() => setQ('')} className="font-medium text-accent-strong underline-offset-2 hover:underline">
                Clear the filter
              </button>
            </p>
          ) : (
            <div ref={scroller} className="scroller -mx-3 max-h-[min(24rem,45dvh)] overflow-y-auto overscroll-contain">
              <ul aria-label="Files" className="relative" style={{ height: virtual.getTotalSize() }}>
                {virtual.getVirtualItems().map((item) => (
                  <li key={shown[item.index].key} data-index={item.index} ref={virtual.measureElement} className="absolute inset-x-0 top-0 border-b border-line" style={{ transform: `translateY(${item.start}px)` }}>
                    <FileRow entry={shown[item.index]} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </DetailsSection>
  )
}
