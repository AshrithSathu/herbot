import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { BrainIcon, SearchIcon, XIcon } from 'lucide-react'
import { deleteMemory, saveMemory, type Memory } from '../../api'
import { memoriesQuery, topicsQuery } from '../../queries'
import { charCount, plural } from '../../format'
import { EmptyState, ErrorNote, PageHeader, StaleWarning, Time, notify } from '../../ui'
import { UserText } from '@/components/user-text'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/memory')({
  loader: ({ context }) => context.queryClient.ensureQueryData(memoriesQuery),
  staticData: { crumb: 'Memory' },
  head: () => ({ meta: [{ title: 'Memory · Herbot admin' }] }),
  component: MemoryPage,
})

/** herbot-core's limits (personal.rs): 500 characters each, 200 in all. */
const MAX_CHARS = 500
const MAX_MEMORIES = 200
/** Rows rendered at first; the rest arrive in steps, so 300 long memories
 * don't make the page heavy before anyone asks for them. */
const PAGE = 50

/** Folds case and accents, so "cafe" finds "Café". */
function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function MemoryPage() {
  const { data: memories, error } = useSuspenseQuery(memoriesQuery)
  const topics = useQuery(topicsQuery)
  const topicName = useMemo(() => new Map((topics.data ?? []).map((t) => [t.id, t.name])), [topics.data])
  const [filter, setFilter] = useState('')
  const wanted = fold(useDeferredValue(filter).trim())
  const [limit, setLimit] = useState(PAGE)
  const [deleting, setDeleting] = useState<Memory | 'all' | null>(null)

  // Newest edits first: what you just changed is at the top.
  const sorted = useMemo(
    () => [...memories].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id),
    [memories],
  )
  const matches = useMemo(
    () => (wanted ? sorted.filter((m) => fold(m.content).includes(wanted)) : sorted),
    [sorted, wanted],
  )
  const shown = matches.slice(0, limit)
  const full = memories.length >= MAX_MEMORIES
  const over = memories.length - MAX_MEMORIES

  return (
    <>
      <PageHeader
        title="Memory"
        description="Facts and preferences every agent can recall. Agents add them when you say “remember…”; you can add, edit and forget them here. Never store secrets."
      />
      <StaleWarning error={error} />

      <section aria-labelledby="add-memory" className="flex flex-col gap-3">
        <h2 id="add-memory" className="text-base font-semibold tracking-tight">
          Add a memory
        </h2>
        {full ? (
          <ErrorNote title={over > 0 ? `${plural(memories.length, 'memory', 'memories')}, over the limit of ${MAX_MEMORIES}` : `At the limit of ${MAX_MEMORIES} memories`}>
            {over > 0
              ? `Forget at least ${plural(over + 1, 'memory', 'memories')} before adding another.`
              : 'Forget one before adding another.'}
          </ErrorNote>
        ) : (
          <MemoryEditor />
        )}
      </section>

      <section aria-labelledby="memories" className="flex flex-col gap-3">
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id="memories" className="text-base font-semibold tracking-tight">
            Memories{' '}
            <span className={cn('font-normal tabular-nums', over > 0 ? 'text-destructive' : 'text-muted-foreground')}>
              {memories.length.toLocaleString('en-GB')} / {MAX_MEMORIES}
            </span>
          </h2>
          {memories.length > 0 && (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting('all')}>
              Forget all…
            </Button>
          )}
        </div>

        {memories.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="memory-filter" className="sr-only">
              Filter memories
            </label>
            <div className="relative max-w-xl">
              <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="memory-filter"
                type="search"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value)
                  setLimit(PAGE)
                }}
                onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
                placeholder="Filter memories"
                autoComplete="off"
                spellCheck={false}
                className="h-9 w-full rounded-md border border-input bg-transparent pr-9 pl-9 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:h-11 md:text-sm dark:bg-input/30 [&::-webkit-search-cancel-button]:hidden"
              />
              {filter && (
                <button
                  type="button"
                  aria-label="Clear filter"
                  onClick={() => {
                    setFilter('')
                    document.getElementById('memory-filter')?.focus()
                  }}
                  className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground before:absolute before:-inset-1.5 hover:text-foreground"
                >
                  <XIcon className="size-4" aria-hidden />
                </button>
              )}
            </div>
            <p className="text-sm text-muted-foreground tabular-nums" role="status">
              {wanted ? `${plural(matches.length, 'memory', 'memories')} match` : null}
            </p>
          </div>
        )}

        {matches.length === 0 ? (
          wanted ? (
            <EmptyState icon={SearchIcon} title="No memory matches">
              Nothing contains “{filter.trim()}”. Try a shorter word.
            </EmptyState>
          ) : (
            <EmptyState icon={BrainIcon} title="No memories yet">
              Add a fact above, or tell any agent “remember that…” in Telegram.
            </EmptyState>
          )
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {shown.map((memory) => (
              <MemoryRow
                key={memory.id}
                memory={memory}
                source={memory.source_conversation_id == null ? null : (topicName.get(memory.source_conversation_id) ?? 'a deleted topic')}
                onForget={() => setDeleting(memory)}
              />
            ))}
          </ul>
        )}
        {matches.length > shown.length && (
          <Button variant="outline" className="self-start" onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, matches.length - shown.length)} more
            <span className="text-muted-foreground tabular-nums">
              ({(matches.length - shown.length).toLocaleString('en-GB')} left)
            </span>
          </Button>
        )}
      </section>

      <ForgetDialog target={deleting} onClose={() => setDeleting(null)} total={memories.length} />
    </>
  )
}

function MemoryRow({ memory, source, onForget }: { memory: Memory; source: string | null; onForget: () => void }) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const text = useRef<HTMLDivElement>(null)

  // Offer "Show all" only when the clamp actually hides something; that
  // depends on the width, so it's measured, not guessed from the length.
  useLayoutEffect(() => {
    const box = text.current?.firstElementChild as HTMLElement | null
    if (!box || expanded) return
    const check = () => setClamped(box.scrollHeight > box.clientHeight + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(box)
    return () => observer.disconnect()
  }, [memory.content, expanded])

  if (editing) {
    return (
      <li className="p-4 sm:px-5">
        <MemoryEditor memory={memory} onDone={() => setEditing(false)} />
      </li>
    )
  }
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div ref={text}>
          <UserText as="p" lines={expanded ? 'all' : 3} className="leading-relaxed">
            {memory.content}
          </UserText>
        </div>
        {(clamped || expanded) && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="relative self-start text-sm font-medium text-primary before:absolute before:-inset-x-2 before:-inset-y-2.5 hover:underline"
          >
            {expanded ? 'Show less' : 'Show all'}
          </button>
        )}
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">#{memory.id}</span>
          <span aria-hidden>·</span>
          {source == null ? (
            <span>added here</span>
          ) : (
            <span className="flex min-w-0 max-w-[24ch] items-center gap-1">
              <span className="shrink-0">from</span>
              <UserText className="min-w-0">{source}</UserText>
            </span>
          )}
          <span aria-hidden>·</span>
          <span>
            updated <Time iso={memory.updated_at} relative />
          </span>
        </p>
      </div>
      <div className="-ml-2 flex shrink-0 gap-1 sm:-mt-1 sm:ml-0">
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onForget}>
          Forget…
        </Button>
      </div>
    </li>
  )
}

function MemoryEditor({ memory, onDone }: { memory?: Memory; onDone?: () => void }) {
  const [content, setContent] = useState(memory?.content ?? '')
  const [touched, setTouched] = useState(false)
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: () => saveMemory({ data: { id: memory?.id, content: content.trim() } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: memoriesQuery.queryKey })
      setContent('')
      setTouched(false)
      onDone?.()
      notify(memory ? 'Memory updated' : 'Memory added')
    },
  })
  const id = `memory-${memory?.id ?? 'new'}`
  const count = charCount(content.trim())
  const tooLong = count > MAX_CHARS
  const unchanged = memory != null && content.trim() === memory.content.trim()
  const ready = count > 0 && !tooLong && !unchanged && !save.isPending
  const problem = tooLong ? `Keep it to ${MAX_CHARS} characters; it’s ${count.toLocaleString('en-GB')}.` : null

  const submit = () => {
    setTouched(true)
    if (ready) save.mutate()
  }

  return (
    <form
      className="flex max-w-2xl flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label htmlFor={id} className={cn('text-sm font-medium', !memory && 'sr-only')}>
        {memory ? `Edit memory #${memory.id}` : 'What should every agent remember?'}
      </label>
      <Textarea
        id={id}
        dir="auto"
        value={content}
        disabled={save.isPending}
        autoFocus={memory != null}
        placeholder={memory ? undefined : 'e.g. I prefer metric units and short answers.'}
        onChange={(e) => {
          setContent(e.target.value)
          if (save.isError) save.reset()
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape' && onDone && !save.isPending) onDone()
        }}
        aria-invalid={(touched || tooLong) && problem ? true : undefined}
        aria-describedby={`${id}-count${problem ? ` ${id}-problem` : ''}`}
        className="max-h-72 min-h-20 resize-y leading-relaxed"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p
          id={`${id}-count`}
          className={cn('text-xs tabular-nums', tooLong ? 'text-destructive' : count > MAX_CHARS * 0.9 ? 'text-warning' : 'text-muted-foreground')}
        >
          {count.toLocaleString('en-GB')} / {MAX_CHARS} characters
        </p>
        <div className="flex gap-2">
          {onDone && (
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={onDone}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={!ready} title={`${isMac() ? '⌘' : 'Ctrl'}+Enter`}>
            {save.isPending && <Spinner />}
            {save.isPending ? 'Saving…' : memory ? 'Save changes' : 'Add memory'}
          </Button>
        </div>
      </div>
      {problem && (
        <p id={`${id}-problem`} className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {save.isError && <ErrorNote title={memory ? 'Couldn’t save the memory' : 'Couldn’t add the memory'}>{save.error.message}</ErrorNote>}
    </form>
  )
}

function ForgetDialog({ target, total, onClose }: { target: Memory | 'all' | null; total: number; onClose: () => void }) {
  const client = useQueryClient()
  const remove = useMutation({
    mutationFn: (what: Memory | 'all') => deleteMemory({ data: what === 'all' ? {} : { id: what.id } }),
    onSuccess: async (_, what) => {
      await client.invalidateQueries({ queryKey: memoriesQuery.queryKey })
      onClose()
      notify(what === 'all' ? 'Every memory forgotten' : 'Memory forgotten')
    },
  })
  const all = target === 'all'
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !remove.isPending) {
          remove.reset()
          onClose()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{all ? `Forget all ${plural(total, 'memory', 'memories')}?` : 'Forget this memory?'}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              {all ? (
                <p>Every agent loses them at once. Custom instructions and what Herbot knows about you stay. This can’t be undone.</p>
              ) : (
                target && (
                  <>
                    <UserText as="p" lines={3} className="rounded-md border bg-muted/50 px-3 py-2 text-foreground">
                      {target.content}
                    </UserText>
                    <p>Every agent stops recalling it. This can’t be undone.</p>
                  </>
                )
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError && <ErrorNote title="Couldn’t forget">{remove.error.message}</ErrorNote>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Keep {all ? 'them' : 'it'}</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            className="bg-destructive text-white hover:bg-[color-mix(in_oklch,var(--destructive)_86%,black)]"
            onClick={(e) => {
              e.preventDefault()
              if (target) remove.mutate(target)
            }}
          >
            {remove.isPending && <Spinner />}
            {remove.isPending ? 'Forgetting…' : all ? 'Forget all' : 'Forget'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
