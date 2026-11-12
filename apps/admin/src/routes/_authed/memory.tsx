// Memory (docs/design/DECISIONS.md, "Memory"): one filterable Thread list,
// newest edits first; edit in place (⌘/Ctrl+Enter saves, Escape cancels);
// Show all for clamped text; Forget behind the Keep-first dialog with Undo.
// Over the 200 limit the add box gives way to the limit notice.
// herbot-core's limits (personal.rs): 500 characters a memory, 200 in all.
import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { HashIcon, MessageCircleIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { deleteMemory, saveMemory, type Memory, type Topic } from '../../api'
import { charCount, exact, when } from '../../format'
import { memoriesQuery, topicsQuery } from '../../queries'
import { Button, Field, SearchInput, TextArea } from '@/components/hb/controls'
import { ConfirmDialog } from '@/components/hb/dialogs'
import { InPlaceEmpty, InPlaceError, ListSkeleton, notify, notifyFailure } from '@/components/hb/feedback'
import { QuietAction, ThreadList } from '@/components/hb/rows'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { MetaLine } from '@/components/hb/status'
import { fold } from '@/components/hb/agent-list'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { useClamped } from '@/lib/use-clamped'

export const Route = createFileRoute('/_authed/memory')({
  loader: ({ context }) => context.queryClient.ensureQueryData(memoriesQuery),
  staticData: { crumb: 'Memory', shell: 'page' },
  head: () => ({ meta: [{ title: 'Memory · Herbot admin' }] }),
  component: MemoryPage,
})

const MEMORY_MAX = 500
const MEMORY_LIMIT = 200

/** ⌘ on Apple devices, Ctrl elsewhere; decided after mount (hydration). */
function useModKey(): string {
  const [key, setKey] = useState('Ctrl')
  useEffect(() => setKey(/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'), [])
  return key
}

function MemoryPage() {
  const q = useQuery(memoriesQuery)
  const topics = useQuery(topicsQuery)
  const byId = useMemo(() => new Map((topics.data ?? []).map((t) => [t.id, t])), [topics.data])
  const all = useMemo(() => [...(q.data ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id), [q.data])
  const [filter, setFilter] = useState('')
  const wanted = fold(useDeferredValue(filter).trim())
  const shown = useMemo(() => (wanted ? all.filter((m) => fold(m.content).includes(wanted)) : all), [all, wanted])
  const [editing, setEditing] = useState<number | null>(null)
  // Unsaved edits live here, above the virtualised list: a row scrolled out
  // of view or filtered away unmounts, but its draft survives and returns
  // with it.
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const setDraft = (id: number, text: string | null) =>
    setDrafts((d) => {
      const next = { ...d }
      if (text == null) delete next[id]
      else next[id] = text
      return next
    })
  const stopEditing = (id: number) => {
    setDraft(id, null)
    setEditing((e) => (e === id ? null : e))
  }
  const forget = useForget(all.length)

  return (
    <ShellPage
      title="Memory"
      description="Facts and preferences every agent can recall. Agents add them when you say “remember…”; you can add, edit and forget them here. Never store secrets."
      back={<BackToAgents />}
    >
      {q.isPending ? (
        <ListSkeleton rows={6} />
      ) : q.isError && all.length === 0 ? (
        <InPlaceError title="Couldn’t load memories" error={q.error} onRetry={() => q.refetch()} retrying={q.isRefetching} />
      ) : (
        <>
          <AddMemory count={all.length} />
          <section aria-labelledby="memories-heading" className="flex flex-col gap-3">
            <h2 id="memories-heading" className="flex items-baseline gap-2 text-[15px] font-semibold">
              Memories
              <span className={cn('text-[13px] font-normal tabular-nums', all.length > MEMORY_LIMIT ? 'font-medium text-destructive' : 'text-mute')}>
                {exact(all.length)} / {exact(MEMORY_LIMIT)}
              </span>
            </h2>
            {all.length === 0 ? (
              <InPlaceEmpty title="No memories yet">Say “remember that…” in any topic, or add one above. Every agent reads them.</InPlaceEmpty>
            ) : (
              <>
                <SearchInput label="Filter memories" value={filter} onValueChange={setFilter} placeholder={`Filter ${exact(all.length)} memories`} dir="auto" />
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
                    estimate={130}
                    title={(m) => (
                      <div className="font-normal">
                        {editing === m.id ? (
                          <MemoryEditor
                            memory={m}
                            text={drafts[m.id] ?? m.content}
                            onText={(t) => setDraft(m.id, t)}
                            onDone={() => stopEditing(m.id)}
                          />
                        ) : (
                          <MemoryText memory={m} />
                        )}
                      </div>
                    )}
                    meta={(m) => <MemoryFacts memory={m} topic={m.source_conversation_id == null ? null : (byId.get(m.source_conversation_id) ?? undefined)} />}
                    actions={(m) =>
                      editing === m.id ? null : (
                        <>
                          <QuietAction onClick={() => setEditing(m.id)} aria-label={`Edit memory #${m.id}`}>
                            <PencilIcon aria-hidden />
                            {drafts[m.id] != null ? 'Edit (unsaved)' : 'Edit'}
                          </QuietAction>
                          {/* Destructive apart from constructive, as in Tasks. */}
                          <span aria-hidden className="ml-auto" />
                          <QuietAction tone="danger" onClick={() => forget.ask(m)} aria-label={`Forget memory #${m.id}`}>
                            <Trash2Icon aria-hidden />
                            Forget…
                          </QuietAction>
                        </>
                      )
                    }
                  />
                )}
              </>
            )}
          </section>
        </>
      )}
      {forget.dialog}
    </ShellPage>
  )
}

/** The text: three lines, the rest on request (offered only when the clamp
 * measurably hides something, whatever the script). */
function MemoryText({ memory }: { memory: Memory }) {
  const [open, setOpen] = useState(false)
  const [ref, clamped] = useClamped<HTMLDivElement>()
  return (
    <div className="flex flex-col items-start gap-1">
      <div ref={ref} className="w-full min-w-0">
        <UserText as="p" lines={open ? 'all' : 3} className="text-[15px] leading-relaxed text-ink">
          {memory.content}
        </UserText>
      </div>
      {(clamped || open) && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="relative z-[1] text-[13px] font-medium text-mute underline-offset-2 before:absolute before:-inset-x-2 before:-inset-y-3 hover:text-ink hover:underline"
        >
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  )
}

/** #id · where it came from · when it changed. `topic` is null for memories
 * added in the panel, undefined when the topic is gone. */
function MemoryFacts({ memory, topic }: { memory: Memory; topic: Topic | null | undefined }) {
  return (
    <MetaLine>
      {[
        <span key="id" className="tabular-nums">
          #{memory.id}
        </span>,
        <Source key="source" topic={topic} />,
        <span key="when">
          updated{' '}
          <time dateTime={memory.updated_at} title={when(memory.updated_at)} suppressHydrationWarning>
            {when(memory.updated_at)}
          </time>
        </span>,
      ]}
    </MetaLine>
  )
}

function Source({ topic }: { topic: Topic | null | undefined }) {
  if (topic === null) return <span>added in the panel</span>
  if (topic === undefined) return <span className="italic">from a deleted topic</span>
  const Icon = topic.is_general ? MessageCircleIcon : HashIcon
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      from
      <Link
        to="/topics/$id"
        params={{ id: topic.id }}
        className="relative z-[1] inline-flex max-w-[26ch] min-w-0 items-center gap-1 self-center underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-3 hover:text-ink hover:underline"
      >
        <Icon aria-hidden className="size-3 shrink-0" />
        <UserText className="min-w-0">{topic.name}</UserText>
      </Link>
    </span>
  )
}

function useInvalidate() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: memoriesQuery.queryKey })
}

/** Add a memory, or say plainly why you can't (over the limit). */
function AddMemory({ count }: { count: number }) {
  const [text, setText] = useState('')
  const mod = useModKey()
  const invalidate = useInvalidate()
  const add = useMutation({
    mutationFn: (content: string) => saveMemory({ data: { content } }),
    onSuccess: async () => {
      setText('')
      notify('Memory added. Every agent sees it from its next message.')
      await invalidate()
    },
  })
  const n = charCount(text.trim())
  if (count >= MEMORY_LIMIT) {
    const need = count - MEMORY_LIMIT + 1
    return (
      <div role="note" className="flex flex-col gap-1 rounded-lg bg-warning-soft px-3 py-2.5 text-[13.5px]">
        <span className="font-medium text-warning">
          {exact(count)} memories, {count > MEMORY_LIMIT ? 'over' : 'at'} the limit of {exact(MEMORY_LIMIT)}
        </span>
        <span className="text-ink">
          Forget at least {exact(need)} {need === 1 ? 'memory' : 'memories'} before adding another. Agents still read all of them.
        </span>
      </div>
    )
  }
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!text.trim() || n > MEMORY_MAX || add.isPending) return
    add.mutate(text.trim())
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Field
        label="Add a memory"
        counter={{ count: n, max: MEMORY_MAX }}
        error={add.error?.message ?? (n > MEMORY_MAX ? `${exact(n - MEMORY_MAX)} over the ${MEMORY_MAX}-character limit.` : undefined)}
        hint={`A fact or preference every agent should know. ${mod}+Enter adds it.`}
      >
        {(p) => (
          <TextArea
            {...p}
            value={text}
            disabled={add.isPending}
            onChange={(e) => {
              setText(e.target.value)
              if (add.isError) add.reset()
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
            }}
            placeholder="I prefer answers in metric units."
            className="min-h-20"
          />
        )}
      </Field>
      <Button type="submit" variant="primary" pending={add.isPending} disabled={!text.trim() || n > MEMORY_MAX} className="self-end">
        {add.isPending ? 'Adding…' : 'Add memory'}
      </Button>
    </form>
  )
}

/** Edit in place: Save (⌘/Ctrl+Enter) or Cancel (Escape); errors under the text. */
function MemoryEditor({ memory, text, onText, onDone }: { memory: Memory; text: string; onText: (t: string) => void; onDone: () => void }) {
  const setText = onText
  const invalidate = useInvalidate()
  const save = useMutation({
    mutationFn: (content: string) => saveMemory({ data: { id: memory.id, content } }),
    onSuccess: async () => {
      notify('Memory saved. Agents read the new text from their next message.')
      await invalidate()
      onDone()
    },
  })
  const n = charCount(text.trim())
  const changed = text.trim() !== memory.content.trim()
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!changed) return onDone()
    if (!text.trim() || n > MEMORY_MAX || save.isPending) return
    save.mutate(text.trim())
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Field
        label={`Memory #${memory.id}`}
        counter={{ count: n, max: MEMORY_MAX }}
        error={save.error?.message ?? (n > MEMORY_MAX ? `${exact(n - MEMORY_MAX)} over the ${MEMORY_MAX}-character limit.` : !text.trim() ? 'A memory can’t be empty; use Forget to remove it.' : undefined)}
      >
        {(p) => (
          <TextArea
            {...p}
            value={text}
            autoFocus
            disabled={save.isPending}
            onChange={(e) => {
              setText(e.target.value)
              if (save.isError) save.reset()
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
              if (e.key === 'Escape') {
                e.stopPropagation()
                onDone()
              }
            }}
            className="min-h-24"
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" pending={save.isPending} disabled={!text.trim() || n > MEMORY_MAX}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

/** Forget, confirmed with Keep as the main button. Undo adds the text back
 * when the limit allows (it returns as "added in the panel", with a new
 * number); a failed Undo can only be told in a toast, since its row is gone. */
function useForget(count: number) {
  const invalidate = useInvalidate()
  const [target, setTarget] = useState<Memory | null>(null)
  const forget = useMutation({
    mutationFn: (m: Memory) => deleteMemory({ data: { id: m.id } }),
    onSuccess: async (_r, m) => {
      setTarget(null)
      const canUndo = count - 1 < MEMORY_LIMIT
      notify(
        'Memory forgotten.',
        canUndo
          ? {
              run: () => {
                saveMemory({ data: { content: m.content } })
                  .then(() => invalidate())
                  .catch((e: Error) => notifyFailure(`Couldn’t bring the memory back: ${e.message}`))
              },
            }
          : undefined,
      )
      await invalidate()
    },
  })
  const dialog = (
    <ConfirmDialog
      open={target != null}
      onOpenChange={(o) => {
        if (!o) {
          setTarget(null)
          forget.reset()
        }
      }}
      title="Forget this memory?"
      subject={target?.content}
      consequences={['Every agent stops reading it from its next message']}
      keeps="Conversations where it came up stay as they are."
      actionLabel="Forget memory"
      keepLabel="Keep the memory"
      guard={{ kind: 'separated' }}
      pending={forget.isPending}
      error={forget.error}
      onConfirm={() => target && forget.mutate(target)}
    />
  )
  return { ask: setTarget, dialog }
}
