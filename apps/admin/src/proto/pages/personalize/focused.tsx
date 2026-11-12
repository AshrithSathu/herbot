// Personalize, variant "Focused" — axis: one text at a time. Tabs switch
// between the two (a dot marks unsaved edits); each gets a tall editor with
// its guidance and examples you can add with one tap. One save for both.
import { useRef, useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { Field, TextArea } from '@/components/hb/controls'
import { InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { cn } from '@/lib/utils'
import { PageFrame } from '../tasks/frame'
import { Counter, FIELDS, LeaveGuard, SaveBar, usePreferencesDraft, type FieldKey } from './shared'

export function FocusedVariant() {
  return (
    <PageFrame>
      <FocusedPage />
    </PageFrame>
  )
}

function FocusedPage() {
  const draft = usePreferencesDraft()
  const [tab, setTab] = useState<FieldKey>('custom_instructions')
  const area = useRef<HTMLTextAreaElement>(null)
  const field = FIELDS.find((f) => f.key === tab)!
  const tabs = useRef<(HTMLButtonElement | null)[]>([])

  /** Adds an example on its own line where the text ends. */
  const addExample = (example: string) => {
    const text = draft.value[tab]
    draft.set(tab, text.trim() ? `${text.replace(/\s+$/, '')}\n${example}` : example)
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }

  return (
    <ShellPage
      title="Personalize"
      description="Two short texts every agent reads before answering. One at a time; save when both read right."
      back={<BackToAgents />}
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
          <div
            role="tablist"
            aria-label="Which text"
            className="flex border-b border-line"
            onKeyDown={(e) => {
              const i = FIELDS.findIndex((f) => f.key === tab)
              const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
              if (!step) return
              e.preventDefault()
              const next = (i + step + FIELDS.length) % FIELDS.length
              setTab(FIELDS[next].key)
              tabs.current[next]?.focus()
            }}
          >
            {FIELDS.map((f, i) => {
              const on = f.key === tab
              const dirty = draft.dirtyField(f.key)
              const over = draft.overBy(f.key) > 0
              return (
                <button
                  key={f.key}
                  ref={(el) => {
                    tabs.current[i] = el
                  }}
                  type="button"
                  role="tab"
                  id={`fc-tab-${f.key}`}
                  aria-selected={on}
                  aria-controls="fc-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => setTab(f.key)}
                  className={cn(
                    '-mb-px flex h-11 items-center gap-2 border-b-2 px-3 text-[14px] font-medium transition-[color,border-color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    on ? 'border-ink text-ink' : 'border-transparent text-mute hover:text-ink',
                  )}
                >
                  {f.label}
                  {(dirty || over) && (
                    <>
                      <span aria-hidden className={cn('size-1.5 rounded-full', over ? 'bg-off' : 'bg-warn')} />
                      <span className="sr-only">{over ? '(over the limit)' : '(unsaved)'}</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>
          <div id="fc-panel" role="tabpanel" aria-labelledby={`fc-tab-${tab}`} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Field id={`fc-${tab}`} label={field.label} hint={field.help}>
                {(p) => (
                  <TextArea
                    {...p}
                    ref={area}
                    key={tab}
                    aria-describedby={`${p['aria-describedby'] ?? ''} fc-${tab}-count`}
                    aria-invalid={draft.overBy(tab) > 0 || undefined}
                    value={draft.value[tab]}
                    onChange={(e) => draft.set(tab, e.target.value)}
                    disabled={draft.save.isPending}
                    placeholder={field.placeholder}
                    className="min-h-[min(50vh,28rem)]"
                  />
                )}
              </Field>
              <div className="flex justify-end">
                <Counter draft={draft} k={tab} id={`fc-${tab}-count`} />
              </div>
            </div>
            <section aria-labelledby="fc-examples" className="flex flex-col gap-2">
              <h2 id="fc-examples" className="text-[13px] font-medium text-ink">
                Examples
              </h2>
              <ul className="flex flex-wrap gap-2">
                {field.examples.map((ex) => (
                  <li key={ex}>
                    <button
                      type="button"
                      onClick={() => addExample(ex)}
                      disabled={draft.save.isPending}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-sunken px-3 text-left text-[13px] text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] transition-[background-color,scale] duration-150 ease-out hover:bg-accent-soft active:scale-[0.96] disabled:opacity-50 pointer-coarse:min-h-11"
                    >
                      <PlusIcon aria-hidden className="size-3.5 shrink-0 text-mute" />
                      {ex}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <SaveBar draft={draft} />
        </form>
      )}
      <LeaveGuard draft={draft} />
    </ShellPage>
  )
}
