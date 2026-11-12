// New agent: a modal form (bottom sheet on phones) that creates a forum topic
// with a purpose (docs/design/DECISIONS.md, "Dialogs"). One dialog for the
// whole panel: <NewAgentHost /> is mounted once in the layout, and anything
// (the agents pane's +, ⌘K, the Overview and Topics pages) opens it with
// openNewAgent().
import { useRef, useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createTopic } from '../api'
import { charCount, purposeProblem, PURPOSE_MAX } from '../format'
import { keys, overviewQuery } from '../queries'
import { Field, TextArea, TextInput } from '@/components/hb/controls'
import { FormDialog } from '@/components/hb/dialogs'
import { notify } from '@/components/hb/feedback'

/** Telegram allows 128 characters in a topic name. */
const NAME_MAX = 128

let isOpen = false
const listeners = new Set<() => void>()
function setOpen(next: boolean) {
  if (isOpen === next) return
  isOpen = next
  for (const l of listeners) l()
}

/** Opens the panel's New agent dialog. */
export function openNewAgent() {
  setOpen(true)
}

function useOpen() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => isOpen,
    () => false,
  )
}

/** Mount once, inside the shell. */
export function NewAgentHost() {
  const open = useOpen()
  return <NewAgentDialog open={open} onOpenChange={setOpen} />
}

function NewAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  // Validate on submit, then on every change once a field has shown an error.
  const [tried, setTried] = useState(false)
  // One idempotency key per draft: a retry after a network failure can't
  // create the agent twice; editing the draft makes a new request.
  const key = useRef<{ draft: string; key: string } | null>(null)
  const client = useQueryClient()
  const navigate = useNavigate()
  // Creating a topic needs the running bot. Say so before the form is filled,
  // not after it fails; the fields stay editable so the draft is ready.
  const overview = useQuery({ ...overviewQuery, enabled: open })
  const telegramOff = overview.data != null && !overview.data.bot

  const create = useMutation({
    mutationFn: () => {
      const draft = `${name.trim()}\u0000${purpose.trim()}`
      if (key.current?.draft !== draft) key.current = { draft, key: crypto.randomUUID() }
      return createTopic({ data: { name: name.trim(), purpose: purpose.trim(), idempotencyKey: key.current.key } })
    },
    onSuccess: async ({ id }) => {
      await client.invalidateQueries({ queryKey: keys.topics })
      onOpenChange(false)
      setName('')
      setPurpose('')
      setTried(false)
      key.current = null
      notify('Agent created. Its topic is in the Herbot group.')
      await navigate({ to: '/topics/$id', params: { id } })
    },
  })

  const nameProblem = !name.trim()
    ? 'Give the agent a name, like “Trip planner”.'
    : charCount(name.trim()) > NAME_MAX
      ? `Keep the name under ${NAME_MAX} characters.`
      : null
  const nameError = tried ? (nameProblem ?? undefined) : undefined
  const purposeError = tried ? (purposeProblem(purpose) ?? undefined) : undefined

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        // A request in flight finishes before the dialog can close.
        if (create.isPending) return
        onOpenChange(o)
        if (!o) {
          create.reset()
          setTried(false)
        }
      }}
      title="New agent"
      description="Creates a topic in the Herbot group. Its purpose is what the agent is for."
      submitLabel="Create agent"
      pendingLabel="Creating…"
      pending={create.isPending}
      canSubmit={!telegramOff}
      error={create.error?.message ?? null}
      onSubmit={() => {
        setTried(true)
        if (nameProblem || purposeProblem(purpose)) {
          // Focus the first field with a problem.
          const first = document.getElementById(nameProblem ? 'new-agent-name' : 'new-agent-purpose')
          requestAnimationFrame(() => first?.focus())
          return
        }
        create.mutate()
      }}
    >
      {telegramOff && (
        <p role="note" className="rounded-lg bg-warning-soft px-3 py-2.5 text-[13.5px] text-ink">
          <span className="font-medium text-warning">Telegram isn’t connected.</span> Each agent is a topic in the Herbot group, so
          creating one needs the bot running. You can write the name and purpose now and create it once the bot is back.
        </p>
      )}
      <Field id="new-agent-name" label="Name" error={nameError}>
        {(p) => (
          <TextInput
            {...p}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            maxLength={NAME_MAX * 2}
            placeholder="Trip planner"
          />
        )}
      </Field>
      <Field
        id="new-agent-purpose"
        label="Purpose"
        error={purposeError}
        hint="At least three words, like “Help me plan trips”."
        counter={{ count: charCount(purpose), max: PURPOSE_MAX }}
      >
        {(p) => <TextArea {...p} value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={4} />}
      </Field>
    </FormDialog>
  )
}
