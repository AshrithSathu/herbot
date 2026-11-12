// Personalize, variant "Preview" — axis: editor beside a live preview of
// PERSONAL.md, exactly what every agent reads. Side by side from 80rem;
// below that an Edit | Preview switch.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { exact } from '../../../format'
import { memoriesQuery } from '../../../queries'
import { Field, TextArea } from '@/components/hb/controls'
import { InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { cn } from '@/lib/utils'
import { PageFrame } from '../tasks/frame'
import { Counter, FIELDS, LeaveGuard, personalMd, SaveBar, usePreferencesDraft } from './shared'

export function PreviewVariant() {
  return (
    <PageFrame>
      <PreviewPage />
    </PageFrame>
  )
}

type Tab = 'edit' | 'preview'

function PreviewPage() {
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
                        aria-describedby={`${p['aria-describedby'] ?? ''} pv-${f.key}-count`}
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
                    <Counter draft={draft} k={f.key} id={`pv-${f.key}-count`} />
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
