// Throwaway (emil-prototype): what the three Personalize layouts share: the
// draft, saving, the unsaved-changes guard, the save bar, and PERSONAL.md as
// herbot-core writes it (personal.rs), so the preview is exact.
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { CheckIcon } from 'lucide-react'
import { savePreferences, type Memory, type Preferences } from '../../../api'
import { charCount, exact } from '../../../format'
import { preferencesQuery } from '../../../queries'
import { Button } from '@/components/hb/controls'
import { ConfirmDialog } from '@/components/hb/dialogs'
import { cn } from '@/lib/utils'

export const FIELDS = [
  {
    key: 'custom_instructions',
    label: 'Custom instructions',
    limit: 3000,
    help: 'How every agent should answer: tone, length, format, language.',
    placeholder: 'Be concise. Use tables for comparisons. Cite sources.',
    examples: ['Answer in British English.', 'Lead with the answer, then the reasoning.', 'Use tables for comparisons; cite sources as links.'],
  },
  {
    key: 'about_you',
    label: 'About you',
    limit: 1500,
    help: 'Stable background that helps every agent: work, location, interests. Never secrets or passwords.',
    placeholder: 'I’m a software engineer in Hyderabad and I like Rust.',
    examples: ['I’m a software engineer in Hyderabad.', 'I prefer metric units and 24-hour times.', 'I read Telegram on my phone, so keep replies short.'],
  },
] as const

export type FieldKey = (typeof FIELDS)[number]['key']

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const shortcut = () => `${isMac() ? '⌘' : 'Ctrl'}+S`

/** The draft over the saved preferences, saving, and leaving safely. */
export function usePreferencesDraft() {
  const q = useQuery(preferencesQuery)
  const saved: Preferences = q.data ?? { custom_instructions: '', about_you: '' }
  const [draft, setDraft] = useState<Preferences | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const value = draft ?? saved
  const dirtyField = (k: FieldKey) => value[k] !== saved[k]
  const dirty = dirtyField('custom_instructions') || dirtyField('about_you')
  const counts = { custom_instructions: charCount(value.custom_instructions), about_you: charCount(value.about_you) }
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
  useEffect(() => {
    if (savedAt == null) return
    const id = setTimeout(() => setSavedAt(null), 4000)
    return () => clearTimeout(id)
  }, [savedAt])
  const canSave = dirty && valid && !save.isPending
  const submit = () => canSave && save.mutate(value)
  const set = (k: FieldKey, text: string) => {
    setDraft({ ...value, [k]: text })
    setSavedAt(null)
    if (save.isError) save.reset()
  }
  // ⌘/Ctrl+S anywhere on the page saves.
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
  return { q, saved, value, dirty, dirtyField, counts, overBy, valid, save, savedAt, canSave, submit, set, discard: () => setDraft(null), leaving }
}

export type Draft = ReturnType<typeof usePreferencesDraft>

/** "1,234 / 3,000"; amber near the limit, red and "N over" past it. */
export function Counter({ draft, k, id }: { draft: Draft; k: FieldKey; id?: string }) {
  const limit = FIELDS.find((f) => f.key === k)!.limit
  const count = draft.counts[k]
  const over = count > limit
  const near = !over && count >= limit * 0.9
  return (
    <p id={id} aria-live="polite" className={cn('text-[12.5px] tabular-nums', over ? 'font-medium text-destructive' : near ? 'text-warning' : 'text-mute')}>
      {over ? `${exact(count - limit)} over the ${exact(limit)}-character limit` : `${exact(count)} / ${exact(limit)}`}
    </p>
  )
}

/** Stays in view while you edit: what's going on, Discard, Save. */
export function SaveBar({ draft, className }: { draft: Draft; className?: string }) {
  const { save, savedAt, dirty, valid, canSave, submit, discard } = draft
  return (
    <div
      className={cn(
        'sticky bottom-0 z-[2] -mx-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-line bg-pane px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:-mx-8 md:px-8',
        className,
      )}
    >
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
      <Button variant="primary" onClick={submit} disabled={!canSave} pending={save.isPending} title={shortcut()}>
        {save.isPending ? 'Saving…' : 'Save changes'}
      </Button>
    </div>
  )
}

/** Leaving with unsaved edits asks first. Keep (stay) is the main button. */
export function LeaveGuard({ draft }: { draft: Draft }) {
  const { leaving } = draft
  return (
    <ConfirmDialog
      open={leaving.status === 'blocked'}
      onOpenChange={(o) => !o && leaving.reset?.()}
      title="Leave without saving?"
      consequences={['Your edits to Personalize are thrown away']}
      keeps="What you saved before stays as it is."
      actionLabel="Discard and leave"
      guard={{ kind: 'separated' }}
      onConfirm={() => leaving.proceed?.()}
    />
  )
}

/** PERSONAL.md exactly as herbot-core writes it (personal.rs `write_file`):
 * the trimmed texts, then every memory by id. */
export function personalMd(prefs: Preferences, memories: Memory[]): string {
  let text = `# Ashrith's personalisation\n\n## Custom instructions\n\n${prefs.custom_instructions.trim()}\n\n## About you\n\n${prefs.about_you.trim()}\n\n## Memories\n\n`
  const byId = [...memories].sort((a, b) => a.id - b.id)
  byId.forEach((m, i) => {
    text += `${i + 1}. [id: ${m.id}] ${m.content.replace(/\n/g, '\n   ')}\n`
  })
  return text
}
