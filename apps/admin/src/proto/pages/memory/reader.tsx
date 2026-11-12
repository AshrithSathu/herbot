// Memory, variant "Reader" — axis: a two-column reader. The list in the main
// pane (two lines each); the selected memory opens whole in the shell's
// details pane, where it's edited and forgotten. Below 68.75rem the pane
// opens over the list; on phones it's a full screen with a back button.
import { useDeferredValue, useEffect, useState } from 'react'
import { PlusIcon } from 'lucide-react'
import type { Memory } from '../../../api'
import { charCount, exact, when } from '../../../format'
import { Button } from '@/components/hb/controls'
import { DetailRow, DetailsPane, DetailsSection } from '@/components/hb/details-pane'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { STRETCH, ThreadList } from '@/components/hb/rows'
import { BackToAgents, ShellPage, useShell } from '@/components/hb/shell'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { PageFrame } from '../tasks/frame'
import { AddMemory, CountBadge, FilterInput, MEMORY_LIMIT, MEMORY_MAX, MemoryEditor, SourceLabel, sourceOf, useForget, useMemoryData } from './shared'

type Selection = { kind: 'memory'; id: number } | { kind: 'new' } | null

export function ReaderVariant() {
  const [selected, setSelected] = useState<Selection>(null)
  return (
    <PageFrame details={<ReaderDetails selected={selected} onSelect={setSelected} />}>
      <ReaderList selected={selected} onSelect={setSelected} />
    </PageFrame>
  )
}

function ReaderList({ selected, onSelect }: { selected: Selection; onSelect: (s: Selection) => void }) {
  const [filter, setFilter] = useState('')
  const { q, all, shown, byId } = useMemoryData(useDeferredValue(filter))
  const { setDetailsOpen } = useShell()
  const open = (s: Selection) => {
    onSelect(s)
    setDetailsOpen(true)
  }
  // Wide screens open the newest memory, so the reader is never empty.
  useEffect(() => {
    if (selected == null && all.length > 0 && matchMedia('(min-width: 68.75rem)').matches) open({ kind: 'memory', id: all[0].id })
  }, [all.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ShellPage
      title="Memory"
      description="Facts and preferences every agent can recall. Pick one to read it whole, edit it or forget it."
      back={<BackToAgents />}
      actions={
        <Button variant="primary" onClick={() => open({ kind: 'new' })} disabled={all.length >= MEMORY_LIMIT} title={all.length >= MEMORY_LIMIT ? `Over the limit of ${MEMORY_LIMIT}` : undefined}>
          <PlusIcon aria-hidden />
          New memory
        </Button>
      }
    >
      {q.isPending ? (
        <ListSkeleton rows={8} />
      ) : q.isError && all.length === 0 ? (
        <InPlaceError title="Couldn’t load memories" error={q.error} onRetry={() => q.refetch()} retrying={q.isRefetching} />
      ) : all.length === 0 ? (
        <InPlaceEmpty
          title="No memories yet"
          action={
            <Button variant="primary" onClick={() => open({ kind: 'new' })}>
              <PlusIcon aria-hidden />
              New memory
            </Button>
          }
        >
          Say “remember that…” in any topic, or add one here. Every agent reads them.
        </InPlaceEmpty>
      ) : (
        <section aria-labelledby="reader-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="reader-heading" className="flex items-baseline gap-2 text-[15px] font-semibold">
              Memories <CountBadge count={all.length} />
            </h2>
            {all.length > MEMORY_LIMIT && (
              <span className="text-[13px] text-destructive">Forget {exact(all.length - MEMORY_LIMIT + 1)} to add more</span>
            )}
          </div>
          <FilterInput value={filter} onChange={setFilter} count={all.length} />
          {shown.length === 0 ? (
            <InPlaceEmpty
              title="No memory matches that"
              action={
                <Button variant="secondary" onClick={() => setFilter('')}>
                  Clear filter
                </Button>
              }
            />
          ) : (
            <ThreadList
              label="Memories"
              items={shown}
              itemKey={(m) => m.id}
              estimate={84}
              title={(m) => {
                const on = selected?.kind === 'memory' && selected.id === m.id
                return (
                  <button
                    type="button"
                    aria-current={on || undefined}
                    onClick={() => open({ kind: 'memory', id: m.id })}
                    className={cn('block w-full min-w-0 text-left font-normal outline-none focus-visible:underline', STRETCH)}
                  >
                    <UserText as="span" lines={2} className={cn('text-[14.5px] leading-relaxed', on ? 'text-accent-strong' : 'text-ink')}>
                      {m.content}
                    </UserText>
                  </button>
                )
              }}
              meta={(m) => (
                <>
                  <span className="tabular-nums">#{m.id}</span>
                  <span aria-hidden>·</span>
                  <SourceLabel source={sourceOf(m, byId)} plain />
                </>
              )}
            />
          )}
        </section>
      )}
    </ShellPage>
  )
}

function ReaderDetails({ selected, onSelect }: { selected: Selection; onSelect: (s: Selection) => void }) {
  const { all, byId } = useMemoryData()
  const { setDetailsOpen } = useShell()
  const [editing, setEditing] = useState(false)
  const forget = useForget(all.length)
  const close = () => setDetailsOpen(false)
  useEffect(() => setEditing(false), [selected])

  if (selected?.kind === 'new') {
    return (
      <DetailsPane title="New memory" onClose={close}>
        <div className="px-4 py-4">
          <AddMemory
            count={all.length}
            autoFocus
            onAdded={(m) => onSelect({ kind: 'memory', id: m.id })}
          />
        </div>
      </DetailsPane>
    )
  }
  const memory: Memory | undefined = selected ? all.find((m) => m.id === selected.id) : undefined
  if (!memory) {
    return (
      <DetailsPane title="Memory" onClose={close}>
        <InPlaceEmpty title={selected ? 'This memory is gone' : 'Pick a memory'} className="px-4">
          {selected ? 'It was forgotten, maybe by an agent. Pick another one.' : 'Its whole text, where it came from and its actions show here.'}
        </InPlaceEmpty>
      </DetailsPane>
    )
  }
  const source = sourceOf(memory, byId)
  return (
    <DetailsPane title={`Memory #${memory.id}`} subtitle={<SourceLabel source={source} plain />} onClose={close}>
      <div className="px-4 py-4">
        {editing ? (
          <MemoryEditor memory={memory} onDone={() => setEditing(false)} />
        ) : (
          <div className="flex flex-col items-start gap-3">
            <UserText as="p" lines="all" className="text-[15.5px] leading-relaxed text-ink">
              {memory.content}
            </UserText>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        )}
      </div>
      <DetailsSection title="About">
        <DetailRow label="From" value={<SourceLabel source={source} plain />} />
        <DetailRow label="Length" value={<span className="tabular-nums">{exact(charCount(memory.content))} / {MEMORY_MAX}</span>} />
        <DetailRow label="Added" value={<time dateTime={memory.created_at}>{when(memory.created_at)}</time>} />
        <DetailRow label="Changed" value={<time dateTime={memory.updated_at}>{when(memory.updated_at)}</time>} />
      </DetailsSection>
      <section aria-label="Forget" className="flex flex-col gap-2 px-4 py-3">
        <p className="text-[12.5px] text-mute">Agents stop reading it from their next message.</p>
        <Button variant="danger" size="sm" className="self-start" onClick={() => forget.ask(memory)}>
          Forget this memory…
        </Button>
      </section>
      {forget.dialog}
    </DetailsPane>
  )
}
