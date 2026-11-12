// Personalize, variant "Stacked" — axis: both texts on one page, one under
// the other, with a save bar that stays in view.
import { Field, TextArea } from '@/components/hb/controls'
import { InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { PageFrame } from '../tasks/frame'
import { Counter, FIELDS, LeaveGuard, SaveBar, usePreferencesDraft } from './shared'

export function StackedVariant() {
  return (
    <PageFrame>
      <StackedPage />
    </PageFrame>
  )
}

function StackedPage() {
  const draft = usePreferencesDraft()
  return (
    <ShellPage
      title="Personalize"
      description="Instructions and background every agent reads before answering, in every topic and in Telegram."
      back={<BackToAgents />}
    >
      {draft.q.isPending ? (
        <ListSkeleton rows={2} lines={2} />
      ) : draft.q.isError && !draft.q.data ? (
        <InPlaceError title="Couldn’t load your preferences" error={draft.q.error} onRetry={() => draft.q.refetch()} retrying={draft.q.isRefetching} />
      ) : (
        <form
          className="flex flex-col gap-8"
          onSubmit={(e) => {
            e.preventDefault()
            draft.submit()
          }}
        >
          {FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <Field id={`stacked-${f.key}`} label={f.label} hint={f.help}>
                {(p) => (
                  <TextArea
                    {...p}
                    aria-describedby={`${p['aria-describedby'] ?? ''} stacked-${f.key}-count`}
                    aria-invalid={draft.overBy(f.key) > 0 || undefined}
                    value={draft.value[f.key]}
                    onChange={(e) => draft.set(f.key, e.target.value)}
                    disabled={draft.save.isPending}
                    placeholder={f.placeholder}
                    className="min-h-48 sm:min-h-56"
                  />
                )}
              </Field>
              <div className="flex justify-end">
                <Counter draft={draft} k={f.key} id={`stacked-${f.key}-count`} />
              </div>
            </div>
          ))}
          <SaveBar draft={draft} />
        </form>
      )}
      <LeaveGuard draft={draft} />
    </ShellPage>
  )
}
