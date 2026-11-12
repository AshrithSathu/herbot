// Throwaway (emil-prototype): what the three Memory layouts share, so they
// differ only in how the memories are organised. herbot-core's limits:
// 500 characters a memory, 200 memories (personal.rs).
import { useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HashIcon, MessageCircleIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { deleteMemory, saveMemory, type Memory, type Topic } from '../../../api'
import { charCount, exact, when } from '../../../format'
import { memoriesQuery, topicsQuery } from '../../../queries'
import { Button, Field, TextArea } from '@/components/hb/controls'
import { ConfirmDialog } from '@/components/hb/dialogs'
import { notify } from '@/components/hb/feedback'
import { QuietAction } from '@/components/hb/rows'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

export const MEMORY_MAX = 500
export const MEMORY_LIMIT = 200

export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Memories newest-edited first, the topics they came from, and a filter. */
export function useMemoryData(filter = '') {
  const q = useQuery(memoriesQuery)
  const topics = useQuery(topicsQuery)
  const byId = useMemo(() => new Map((topics.data ?? []).map((t) => [t.id, t])), [topics.data])
  const all = useMemo(() => [...(q.data ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id), [q.data])
  const wanted = fold(filter.trim())
  const shown = useMemo(() => (wanted ? all.filter((m) => fold(m.content).includes(wanted)) : all), [all, wanted])
  return { q, all, shown, byId, topics: topics.data ?? [] }
}

export type Source = { kind: 'topic'; topic: Topic } | { kind: 'panel' } | { kind: 'deleted'; id: number }

export function sourceOf(m: Memory, byId: Map<number, Topic>): Source {
  if (m.source_conversation_id == null) return { kind: 'panel' }
  const topic = byId.get(m.source_conversation_id)
  return topic ? { kind: 'topic', topic } : { kind: 'deleted', id: m.source_conversation_id }
}

export function sourceKey(s: Source): string {
  return s.kind === 'topic' ? `t${s.topic.id}` : s.kind
}

/** "from # Research", "added here", "from a deleted topic". */
export function SourceLabel({ source, plain = false, capital = false }: { source: Source; plain?: boolean; capital?: boolean }) {
  if (source.kind === 'panel') return <span>{capital ? 'Added' : 'added'} in the panel</span>
  if (source.kind === 'deleted') return <span className="italic">{capital ? 'From' : 'from'} a deleted topic</span>
  const Icon = source.topic.is_general ? MessageCircleIcon : HashIcon
  const name = (
    <span className="inline-flex max-w-[26ch] min-w-0 items-center gap-1 align-bottom">
      <Icon aria-hidden className="size-3 shrink-0" />
      <UserText className="min-w-0">{source.topic.name}</UserText>
    </span>
  )
  if (plain) return name
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1">
      {capital ? 'From' : 'from'}
      <Link
        to="/topics/$id"
        params={{ id: source.topic.id }}
        className="relative z-[1] min-w-0 underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-3 hover:text-ink hover:underline"
      >
        {name}
      </Link>
    </span>
  )
}

/** The memory's text: three lines, the rest on request (only offered when
 * the clamp actually hides something). */
export function MemoryText({ memory, lines = 3, className }: { memory: Memory; lines?: 2 | 3; className?: string }) {
  const [open, setOpen] = useState(false)
  const long = charCount(memory.content) > (lines === 2 ? 140 : 220) || memory.content.split('\n').length > lines
  return (
    <div className="flex flex-col items-start gap-1">
      <UserText as="p" lines={open ? 'all' : lines} className={cn('text-[15px] leading-relaxed text-ink', className)}>
        {memory.content}
      </UserText>
      {long && (
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

function useInvalidate() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: memoriesQuery.queryKey })
}

/** Add a memory, or say plainly why you can't (over the limit). */
export function AddMemory({ count, onAdded, autoFocus = false }: { count: number; onAdded?: (m: Memory) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const invalidate = useInvalidate()
  const add = useMutation({
    mutationFn: (content: string) => saveMemory({ data: { content } }),
    onSuccess: async (m) => {
      setText('')
      notify('Memory added. Every agent sees it from its next message.')
      await invalidate()
      onAdded?.(m)
    },
  })
  const n = charCount(text.trim())
  const over = count >= MEMORY_LIMIT
  if (over) {
    const need = count - MEMORY_LIMIT + 1
    return (
      <div role="note" className="flex flex-col gap-1 rounded-lg bg-warning-soft px-3 py-2.5 text-[13.5px]">
        <span className="font-medium text-warning">
          {exact(count)} memories, over the limit of {exact(MEMORY_LIMIT)}
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
      <Field label="Add a memory" counter={{ count: n, max: MEMORY_MAX }} error={add.error?.message} hint={`A fact or preference every agent should know. ${isMac() ? '⌘' : 'Ctrl'}+Enter adds it.`}>
        {(p) => (
          <TextArea
            {...p}
            value={text}
            autoFocus={autoFocus}
            disabled={add.isPending}
            onChange={(e) => {
              setText(e.target.value)
              if (add.isError) add.reset()
            }}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()}
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

/** Edit in place: Save (⌘/Ctrl+Enter), Cancel (Esc); errors next to the text. */
export function MemoryEditor({ memory, onDone }: { memory: Memory; onDone: () => void }) {
  const [text, setText] = useState(memory.content)
  const invalidate = useInvalidate()
  const save = useMutation({
    mutationFn: (content: string) => saveMemory({ data: { id: memory.id, content } }),
    onSuccess: async () => {
      notify('Memory saved.')
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
      <Field label={`Memory #${memory.id}`} counter={{ count: n, max: MEMORY_MAX }} error={save.error?.message ?? (n > MEMORY_MAX ? `${exact(n - MEMORY_MAX)} over the ${MEMORY_MAX}-character limit.` : undefined)}>
        {(p) => (
          <TextArea
            {...p}
            value={text}
            autoFocus
            disabled={save.isPending}
            onChange={(e) => setText(e.target.value)}
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

/** Forget, confirmed (Keep is the main button). Undo re-adds it when the
 * count allows; it comes back as "added in the panel" with a new number. */
export function useForget(count: number) {
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
                void saveMemory({ data: { content: m.content } })
                  .then(() => invalidate())
                  // No place in the page for this failure: the row is gone (kit gap).
                  .catch((e: Error) => toast.error(`Couldn’t bring the memory back: ${e.message}`))
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
      guard={{ kind: 'separated' }}
      pending={forget.isPending}
      error={forget.error}
      onConfirm={() => target && forget.mutate(target)}
    />
  )
  return { ask: setTarget, dialog }
}

/** Edit and Forget, quiet and always visible. */
export function MemoryActions({ onEdit, onForget }: { onEdit: () => void; onForget: () => void }) {
  return (
    <>
      <QuietAction onClick={onEdit}>
        <PencilIcon aria-hidden />
        Edit
      </QuietAction>
      <QuietAction tone="danger" onClick={onForget}>
        <Trash2Icon aria-hidden />
        Forget…
      </QuietAction>
    </>
  )
}

export function MemoryFacts({ memory, source }: { memory: Memory; source: Source }) {
  return (
    <>
      <span className="tabular-nums">#{memory.id}</span>
      <span aria-hidden>·</span>
      <SourceLabel source={source} />
      <span aria-hidden>·</span>
      <span>
        updated{' '}
        <time dateTime={memory.updated_at} title={when(memory.updated_at)} suppressHydrationWarning>
          {when(memory.updated_at)}
        </time>
      </span>
    </>
  )
}

/** Memories 299 / 200, red when over. */
export function CountBadge({ count }: { count: number }) {
  return (
    <span className={cn('text-[13px] font-normal tabular-nums', count > MEMORY_LIMIT ? 'font-medium text-destructive' : 'text-mute')}>
      {exact(count)} / {exact(MEMORY_LIMIT)}
    </span>
  )
}

export function FilterInput({ value, onChange, count, label = 'Filter memories' }: { value: string; onChange: (v: string) => void; count: number; label?: string }) {
  return (
    <div className="relative">
      <label htmlFor="memory-filter" className="sr-only">
        {label}
      </label>
      <input
        id="memory-filter"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        placeholder={`Filter ${exact(count)} memories`}
        autoComplete="off"
        spellCheck={false}
        dir="auto"
        className="h-10 w-full rounded-lg bg-sunken px-3 text-base text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] outline-none placeholder:text-faint focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] md:text-[14px] [&::-webkit-search-cancel-button]:hidden"
      />
    </div>
  )
}
