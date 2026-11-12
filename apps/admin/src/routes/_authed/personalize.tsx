// Personalize (docs/design/DECISIONS.md, "Personalize"): the two texts beside
// a live PERSONAL.md preview, exactly as herbot-core writes it ("what every
// agent reads"); an Edit / What agents see switch below 80rem; a save bar
// that stays in view, ⌘/Ctrl+S, counters in code points, and a leave guard.
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useBlocker } from '@tanstack/react-router'
import { CheckIcon } from 'lucide-react'
import { savePreferences, type Memory, type Preferences } from '../../api'
import { charCount, exact } from '../../format'
import { memoriesQuery, preferencesQuery } from '../../queries'
import { Button, Field, TextArea } from '@/components/hb/controls'
import { ConfirmDialog } from '@/components/hb/dialogs'
import { InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/personalize')({
  loader: ({ context }) => context.queryClient.ensureQueryData(preferencesQuery),
  staticData: { crumb: 'Personalize', shell: 'page' },
  head: () => ({ meta: [{ title: 'Personalize · Herbot admin' }] }),
  component: PersonalizePage,
})

/** herbot-core's limits (personal.rs `set_preferences`). */
const FIELDS = [
  {
    key: 'custom_instructions',
    label: 'Custom instructions',
    limit: 3000,
    help: 'How every agent should answer: tone, length, format, language.',
    placeholder: 'Be concise. Use tables for comparisons. Cite sources.',
  },
  {
    key: 'about_you',
    label: 'About you',
    limit: 1500,
    help: 'Stable background that helps every agent: work, location, interests. Never secrets or passwords.',
    placeholder: 'I’m a software engineer in Hyderabad and I like Rust.',
  },
] as const

type FieldKey = (typeof FIELDS)[number]['key']
type Tab = 'edit' | 'preview'

/** PERSONAL.md exactly as herbot-core writes it (personal.rs `write_file`):
 * the trimmed texts, then every memory by id. */
function personalMd(prefs: Preferences, memories: Memory[]): string {
  let text = `# Ashrith's personalisation\n\n## Custom instructions\n\n${prefs.custom_instructions.trim()}\n\n## About you\n\n${prefs.about_you.trim()}\n\n## Memories\n\n`
  ;[...memories]
    .sort((a, b) => a.id - b.id)
    .forEach((m, i) => {
      text += `${i + 1}. [id: ${m.id}] ${m.content.replace(/\n/g, '\n   ')}\n`
    })
  return text
}

/** The draft over the saved preferences, saving, ⌘/Ctrl+S and the leave guard. */
function usePreferencesDraft() {
  const q = useQuery(preferencesQuery)
  const saved: Preferences = q.data ?? { custom_instructions: '', about_you: '' }
  const [draft, setDraft] = useState<Preferences | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const value = draft ?? saved
  const dirty = value.custom_instructions !== saved.custom_instructions || value.about_you !== saved.about_you
  const counts: Record<FieldKey, number> = { custom_instructions: charCount(value.custom_instructions), about_you: charCount(value.about_you) }
  const overBy = (k: FieldKey) => counts[k] - FIELDS.find((f) => f.key === k)!.limit
  const valid = overBy('custom_instructions') <= 0 && overBy('about_you') <= 0
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: (next: Preferences) => savePreferences({ data: next }),
    onSuccess: async (result) => {
      client.setQueryData(preferencesQuery.queryKey, result)
      setDraft(null)
      setSavedAt(Date.now())
      await client.invalidateQueries({ queryKey: preferencesQuery.queryKey })
    },
  })
  // "Saved" shows for a few seconds, then the bar goes back to "All changes saved".
  useEffect(() => {
    if (savedAt == null) return
    const id = setTimeout(() => setSavedAt(null), 4000)
    return () => clearTimeout(id)
  }, [savedAt])
  const canSave = dirty && valid && !save.isPending
  const submit = () => {
    if (canSave) save.mutate(value)
  }
  const set = (k: FieldKey, text: string) => {
    setDraft({ ...value, [k]: text })
    setSavedAt(null)
    if (save.isError) save.reset()
  }
  // ⌘/Ctrl+S saves from anywhere on the page (never the browser's Save As).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        submit()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  const leaving = useBlocker({
    shouldBlockFn: () => dirty && !save.isPending,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  })
  return { q, value, dirty, counts, overBy, valid, save, savedAt, canSave, submit, set, discard: () => setDraft(null), leaving }
}

type Draft = ReturnType<typeof usePreferencesDraft>

function PersonalizePage() {
  const draft = usePreferencesDraft()
  const memories = useQuery(memoriesQuery)
  const [tab, setTab] = useState<Tab>('edit')
  const file = personalMd(draft.value, memories.data ?? [])
  const lines = file.split('\n').length

  return (
    <ShellPage
      title="Personalize"
      description="What you write here goes into PERSONAL.md, which every agent reads before answering."
      back={<BackToAgents />}
      wide
    >
      {draft.q.isPending ? (
        <ListSkeleton rows={2} lines={2} />
      ) : draft.q.isError && !draft.q.data ? (
        <InPlaceError title="Couldn’t load your preferences" error={draft.q.error} onRetry={() => draft.q.refetch()} retrying={draft.q.isRefetching} />
      ) : (
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            draft.submit()
          }}
        >
          <div role="tablist" aria-label="Personalize view" className="flex gap-1 self-start rounded-lg bg-sunken p-0.5 shadow-[inset_0_0_0_var(--hair)_var(--line)] min-[80rem]:hidden">
            {(['edit', 'preview'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`pv-tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`pv-panel-${t}`}
                onClick={() => setTab(t)}
                className={cn(
                  'h-8 rounded-md px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 ease-out pointer-coarse:h-11',
                  tab === t ? 'bg-pane text-ink shadow-raised' : 'text-mute hover:text-ink',
                )}
              >
                {t === 'edit' ? 'Edit' : 'What agents see'}
              </button>
            ))}
          </div>
          <div className="grid gap-8 min-[80rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div id="pv-panel-edit" role="tabpanel" aria-labelledby="pv-tab-edit" className={cn('flex min-w-0 flex-col gap-8', tab !== 'edit' && 'max-[79.99rem]:hidden')}>
              {FIELDS.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <Field id={`pv-${f.key}`} label={f.label} hint={f.help}>
                    {(p) => (
                      <TextArea
                        {...p}
                        aria-describedby={[p['aria-describedby'], `pv-${f.key}-count`].filter(Boolean).join(' ')}
                        aria-invalid={draft.overBy(f.key) > 0 || undefined}
                        value={draft.value[f.key]}
                        onChange={(e) => draft.set(f.key, e.target.value)}
                        disabled={draft.save.isPending}
                        placeholder={f.placeholder}
                        className="min-h-44"
                      />
                    )}
                  </Field>
                  <div className="flex justify-end">
                    <Counter count={draft.counts[f.key]} limit={f.limit} id={`pv-${f.key}-count`} />
                  </div>
                </div>
              ))}
            </div>
            <section
              id="pv-panel-preview"
              role="tabpanel"
              aria-labelledby="pv-tab-preview"
              className={cn('flex min-w-0 flex-col gap-2', tab !== 'preview' && 'max-[79.99rem]:hidden')}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-[13px] font-medium text-ink">
                  PERSONAL.md <span className="font-normal text-mute">· what every agent reads</span>
                </h2>
                <span className={cn('text-[12.5px] tabular-nums', draft.dirty ? 'text-warning' : 'text-mute')}>
                  {draft.dirty ? 'Preview of unsaved edits; agents still read the saved version' : `${exact(lines)} lines · ${exact(memories.data?.length ?? 0)} memories`}
                </span>
              </div>
              <pre
                dir="auto"
                tabIndex={0}
                aria-label="PERSONAL.md preview"
                className="scroller max-h-[min(70vh,48rem)] min-h-64 overflow-y-auto rounded-lg bg-sunken px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {file}
              </pre>
              {memories.isError && <p className="text-[12.5px] text-destructive">Couldn’t load memories for the preview: {memories.error.message}</p>}
            </section>
          </div>
          <SaveBar draft={draft} />
        </form>
      )}
      <LeaveGuard draft={draft} />
    </ShellPage>
  )
}

/** "1,234 / 3,000"; amber near the limit, red and "N over" past it. */
function Counter({ count, limit, id }: { count: number; limit: number; id: string }) {
  const over = count > limit
  const near = !over && count >= limit * 0.9
  return (
    <p id={id} aria-live="polite" className={cn('text-[12.5px] tabular-nums', over ? 'font-medium text-destructive' : near ? 'text-warning' : 'text-mute')}>
      {over ? `${exact(count - limit)} over the ${exact(limit)}-character limit` : `${exact(count)} / ${exact(limit)}`}
    </p>
  )
}

/** Stays in view while you edit: what's going on, Discard, Save. */
function SaveBar({ draft }: { draft: Draft }) {
  const { save, savedAt, dirty, valid, canSave, submit, discard } = draft
  const [mod, setMod] = useState('Ctrl')
  useEffect(() => setMod(/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'), [])
  return (
    <div className="sticky bottom-0 z-[2] -mx-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-line bg-pane px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:-mx-8 md:px-8">
      <p role="status" aria-live="polite" className="mr-auto min-w-0 text-[13px] text-mute">
        {save.isPending ? (
          'Saving…'
        ) : save.isError ? (
          <span className="text-destructive">Couldn’t save: {save.error.message} Your text is still here.</span>
        ) : savedAt != null ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <CheckIcon aria-hidden className="size-4" />
            Saved. Agents use it from their next message.
          </span>
        ) : dirty ? (
          valid ? (
            'Unsaved changes'
          ) : (
            <span className="text-destructive">Shorten the text over the limit to save</span>
          )
        ) : (
          'All changes saved'
        )}
      </p>
      {dirty && (
        <Button variant="ghost" onClick={discard} disabled={save.isPending}>
          Discard
        </Button>
      )}
      <Button type="submit" variant="primary" disabled={!canSave} pending={save.isPending} title={`Save (${mod}+S)`}>
        {save.isPending ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  )
}

/** Leaving with unsaved edits asks first; staying is the main button. */
function LeaveGuard({ draft }: { draft: Draft }) {
  const { leaving } = draft
  return (
    <ConfirmDialog
      open={leaving.status === 'blocked'}
      onOpenChange={(o) => {
        if (!o) leaving.reset?.()
      }}
      title="Leave without saving?"
      consequences={['Your edits to Personalize are thrown away']}
      keeps="What you saved before stays as it is."
      actionLabel="Discard and leave"
      keepLabel="Keep editing"
      guard={{ kind: 'separated' }}
      onConfirm={() => leaving.proceed?.()}
    />
  )
}
