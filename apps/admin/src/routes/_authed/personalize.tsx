import { useEffect, useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useBlocker } from '@tanstack/react-router'
import { CheckIcon } from 'lucide-react'
import { savePreferences, type Preferences } from '../../api'
import { preferencesQuery } from '../../queries'
import { charCount } from '../../format'
import { ErrorNote, PageHeader, StaleWarning } from '../../ui'
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

export const Route = createFileRoute('/_authed/personalize')({
  loader: ({ context }) => context.queryClient.ensureQueryData(preferencesQuery),
  staticData: { crumb: 'Personalize' },
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
    placeholder: 'e.g. Be concise. Use tables for comparisons. Cite sources.',
  },
  {
    key: 'about_you',
    label: 'About you',
    limit: 1500,
    help: 'Stable background that helps every agent: work, location, interests. Never secrets or passwords.',
    placeholder: 'e.g. I’m a software engineer in Hyderabad and I like Rust.',
  },
] as const

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function PersonalizePage() {
  const { data: prefs, error } = useSuspenseQuery(preferencesQuery)
  const [draft, setDraft] = useState<Preferences | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const value = draft ?? prefs
  const dirty = value.custom_instructions !== prefs.custom_instructions || value.about_you !== prefs.about_you
  const counts = { custom_instructions: charCount(value.custom_instructions), about_you: charCount(value.about_you) }
  const valid = FIELDS.every((f) => counts[f.key] <= f.limit)
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: (next: Preferences) => savePreferences({ data: next }),
    onSuccess: async (saved) => {
      client.setQueryData(preferencesQuery.queryKey, saved)
      setDraft(null)
      setSavedAt(Date.now())
      await client.invalidateQueries({ queryKey: preferencesQuery.queryKey })
    },
  })
  const canSave = dirty && valid && !save.isPending
  const submit = () => canSave && save.mutate(value)

  // "Saved" confirms for a few seconds, then gets out of the way.
  useEffect(() => {
    if (savedAt == null) return
    const id = setTimeout(() => setSavedAt(null), 4000)
    return () => clearTimeout(id)
  }, [savedAt])

  const leaving = useBlocker({
    shouldBlockFn: () => dirty && !save.isPending,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  })
  const shortcut = `${isMac() ? '⌘' : 'Ctrl'}+S`

  return (
    <>
      <PageHeader
        title="Personalize"
        description="Instructions and background every agent reads before answering, in every topic and in Telegram."
      />
      <StaleWarning error={error} />
      <form
        className="flex max-w-3xl flex-col gap-8"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'Enter')) {
            e.preventDefault()
            submit()
          }
        }}
      >
        {FIELDS.map((field) => {
          const count = counts[field.key]
          const over = count > field.limit
          const near = !over && count >= field.limit * 0.9
          return (
            <div key={field.key} className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <label htmlFor={field.key} className="text-sm font-medium">
                  {field.label}
                </label>
                <p id={`${field.key}-help`} className="text-sm text-muted-foreground">
                  {field.help}
                </p>
              </div>
              <Textarea
                id={field.key}
                dir="auto"
                className="field-sizing-fixed min-h-44 resize-y leading-relaxed sm:min-h-52"
                placeholder={field.placeholder}
                disabled={save.isPending}
                value={value[field.key]}
                onChange={(e) => {
                  setDraft({ ...value, [field.key]: e.target.value })
                  setSavedAt(null)
                  if (save.isError) save.reset()
                }}
                aria-invalid={over || undefined}
                aria-describedby={`${field.key}-help ${field.key}-count`}
              />
              <p
                id={`${field.key}-count`}
                className={cn(
                  'self-end text-xs tabular-nums',
                  over ? 'text-destructive' : near ? 'text-warning' : 'text-muted-foreground',
                )}
              >
                {over
                  ? `${(count - field.limit).toLocaleString('en-GB')} over the ${field.limit.toLocaleString('en-GB')}-character limit`
                  : `${count.toLocaleString('en-GB')} / ${field.limit.toLocaleString('en-GB')}`}
              </p>
            </div>
          )
        })}

        {save.isError && <ErrorNote title="Couldn’t save">{save.error.message} Your text is still here; try again.</ErrorNote>}

        {/* Stays in view while you edit long text, so Save is never a scroll away. */}
        <div className="sticky bottom-0 z-[1] -mx-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-b-none sm:px-0">
          <p className="w-full text-sm text-muted-foreground sm:mr-auto sm:w-auto" role="status" aria-live="polite">
            {save.isPending ? (
              'Saving…'
            ) : savedAt != null ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <CheckIcon className="size-4" aria-hidden />
                Saved. Agents use it from their next message.
              </span>
            ) : dirty ? (
              valid ? 'Unsaved changes' : 'Shorten the text over the limit to save'
            ) : (
              'All changes saved'
            )}
          </p>
          {dirty && (
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>
              Discard
            </Button>
          )}
          <Button type="submit" disabled={!canSave} title={shortcut}>
            {save.isPending && <Spinner />}
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>

      <AlertDialog open={leaving.status === 'blocked'} onOpenChange={(open) => !open && leaving.reset?.()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>Your edits to Personalize haven’t been saved. Leaving throws them away.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus onClick={() => leaving.reset?.()}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-[color-mix(in_oklch,var(--destructive)_86%,black)]"
              onClick={() => leaving.proceed?.()}
            >
              Discard and leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
