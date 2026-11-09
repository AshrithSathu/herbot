import { useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useBlocker } from '@tanstack/react-router'
import { savePreferences, type Preferences } from '../../api'
import { preferencesQuery } from '../../queries'
import { charCount } from '../../format'
import { ErrorNote, PageHeader, StaleWarning, notify } from '../../ui'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

export const Route = createFileRoute('/_authed/personalize')({
  loader: ({ context }) => context.queryClient.ensureQueryData(preferencesQuery),
  staticData: { crumb: 'Personalize' },
  head: () => ({ meta: [{ title: 'Personalize · Herbot admin' }] }),
  component: PersonalizePage,
})
function PersonalizePage() {
  const { data: prefs, error } = useSuspenseQuery(preferencesQuery)
  const [draft, setDraft] = useState<Preferences | null>(null)
  const value = draft ?? prefs
  const dirty = value.custom_instructions !== prefs.custom_instructions || value.about_you !== prefs.about_you
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: () => savePreferences({ data: value }),
    onSuccess: async (saved) => {
      client.setQueryData(preferencesQuery.queryKey, saved)
      setDraft(null)
      await client.invalidateQueries({ queryKey: preferencesQuery.queryKey })
      notify('Personalisation saved')
    },
  })
  const leaving = useBlocker({ shouldBlockFn: () => dirty && !save.isPending, enableBeforeUnload: () => dirty, withResolver: true })
  const fields = [
    { key: 'custom_instructions', label: 'Custom instructions', limit: 3000, help: 'How should Herbot answer? These instructions apply in every topic.' },
    { key: 'about_you', label: 'What should Herbot know about you?', limit: 1500, help: 'Stable background that helps every agent. Never include secrets or credentials.' },
  ] as const
  const valid = fields.every((field) => charCount(value[field.key]) <= field.limit)
  return <>
    <PageHeader title="Personalize" description="Your instructions and background, shared across all topics." />
    <StaleWarning error={error} />
    <Card className="max-w-3xl py-5 shadow-xs"><CardContent className="px-5"><form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (dirty && valid && !save.isPending) save.mutate() }}>
      {fields.map((field) => <Field key={field.key}><FieldLabel htmlFor={field.key}>{field.label}</FieldLabel><FieldDescription id={`${field.key}-help`}>{field.help}</FieldDescription><Textarea id={field.key} className="field-sizing-fixed min-h-40 resize-y leading-relaxed wrap-anywhere" disabled={save.isPending} value={value[field.key]} onChange={(e) => setDraft({ ...value, [field.key]: e.target.value })} aria-invalid={charCount(value[field.key]) > field.limit || undefined} aria-describedby={`${field.key}-help ${field.key}-count`} /><FieldDescription id={`${field.key}-count`} className="tabular-nums">{charCount(value[field.key])} / {field.limit} characters</FieldDescription></Field>)}
      <div className="flex gap-2"><Button disabled={!dirty || !valid || save.isPending}>{save.isPending && <Spinner />}{save.isPending ? 'Saving…' : 'Save changes'}</Button>{dirty && <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>Discard changes</Button>}</div>
      {save.isError && <ErrorNote title="Couldn’t save">{save.error.message}</ErrorNote>}
    </form></CardContent></Card>
    <AlertDialog open={leaving.status === 'blocked'} onOpenChange={(open) => !open && leaving.reset?.()}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard your personalisation changes?</AlertDialogTitle><AlertDialogDescription>You have unsaved edits. Leaving now throws them away.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel autoFocus onClick={() => leaving.reset?.()}>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => leaving.proceed?.()}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>
}
