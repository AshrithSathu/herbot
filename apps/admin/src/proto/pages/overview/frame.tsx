// Shared frame for the page prototypes (overview, topics): the kit's Shell
// with the real agent list, a short system strip and the real New agent
// dialog. Throwaway with src/proto.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { createTopic } from '../../../api'
import { charCount, purposeProblem, PURPOSE_MAX } from '../../../format'
import { activityQuery, keys, overviewQuery, topicsQuery } from '../../../queries'
import { AgentList } from '@/components/hb/agent-list'
import { Button, Field, TextArea, TextInput } from '@/components/hb/controls'
import { FormDialog } from '@/components/hb/dialogs'
import { notify, StatusStrip } from '@/components/hb/feedback'
import { AgentsHeader, Shell, useShell } from '@/components/hb/shell'

/** The set of agents with a turn running or queued. */
export function useWorking() {
  const activity = useQuery(activityQuery)
  return useMemo(() => new Set((activity.data ?? []).filter((a) => a.in_progress).map((a) => a.conversation_id)), [activity.data])
}

/** Full-screen over the production shell, like the kit. */
export function Frame({ children, agents, details }: { children: ReactNode; agents?: ReactNode; details?: ReactNode }) {
  const topics = useQuery(topicsQuery)
  const overview = useQuery(overviewQuery)
  const working = useWorking()
  const [newAgent, setNewAgent] = useState(false)
  return (
    <div className="fixed inset-0 z-[45]">
      <Shell
        topics={topics.data}
        onSignOut={() => notify('Signing out is off in the prototype.')}
        actions={[{ id: 'new-agent', label: 'New agent', icon: PlusIcon, run: () => setNewAgent(true) }]}
        strip={
          overview.data && !overview.data.bot ? (
            <StatusStrip>Telegram isn’t connected. Agents can’t reply until the bot runs.</StatusStrip>
          ) : undefined
        }
        agents={
          agents ?? (
            <AgentList
              topics={topics.data}
              pending={topics.isPending}
              error={topics.error}
              onRetry={() => topics.refetch()}
              isUnread={(t) => t.unread > 0}
              isWorking={(t) => working.has(t.id)}
              header={<FrameAgentsHeader count={topics.data?.length} onNew={() => setNewAgent(true)} />}
            />
          )
        }
        details={details}
      >
        <NewAgentContext.Provider value={() => setNewAgent(true)}>{children}</NewAgentContext.Provider>
      </Shell>
      <NewAgentDialog open={newAgent} onOpenChange={setNewAgent} />
    </div>
  )
}

const NewAgentContext = createContext<() => void>(() => {})
/** Opens the New agent dialog from anywhere inside the frame. */
export function useNewAgent() {
  return useContext(NewAgentContext)
}

function FrameAgentsHeader({ count, onNew }: { count?: number; onNew: () => void }) {
  const { showMain } = useShell()
  return (
    <AgentsHeader
      count={count}
      action={
        <Button
          size="icon"
          variant="ghost"
          aria-label="New agent"
          onClick={() => {
            onNew()
            showMain()
          }}
        >
          <PlusIcon aria-hidden />
        </Button>
      }
    />
  )
}

/** The real New agent form: one idempotency key per draft, the server's
 * error (with its E-id) shown in the dialog. */
export function NewAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [tried, setTried] = useState(false)
  const key = useRef<{ draft: string; key: string } | null>(null)
  const client = useQueryClient()
  const navigate = useNavigate()
  // Opened from state (no Radix trigger), so remember what to refocus on close.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null
    else if (opener.current?.isConnected) {
      const el = opener.current
      requestAnimationFrame(() => el.focus())
    }
  }, [open])
  const create = useMutation({
    mutationFn: () => {
      const draft = `${name}\u0000${purpose}`
      if (key.current?.draft !== draft) key.current = { draft, key: crypto.randomUUID() }
      return createTopic({ data: { name: name.trim(), purpose: purpose.trim(), idempotencyKey: key.current.key } })
    },
    onSuccess: async ({ id }) => {
      await client.invalidateQueries({ queryKey: keys.topics })
      onOpenChange(false)
      notify('Agent created.')
      await navigate({ to: '/topics/$id', params: { id } })
    },
  })
  const nameError = tried && !name.trim() ? 'Give the agent a name.' : undefined
  const purposeError = tried ? (purposeProblem(purpose) ?? undefined) : undefined
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (create.isPending) return
        onOpenChange(o)
        if (!o) create.reset()
      }}
      title="New agent"
      description="Creates a topic in the Herbot group with this purpose."
      submitLabel={create.isError ? 'Try again' : 'Create agent'}
      pendingLabel="Creating…"
      pending={create.isPending}
      error={create.error?.message ?? null}
      onSubmit={() => {
        setTried(true)
        if (!name.trim() || purposeProblem(purpose)) return
        create.mutate()
      }}
    >
      <Field label="Name" error={nameError}>
        {(p) => <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={128} />}
      </Field>
      <Field label="Purpose" error={purposeError} hint="At least three words, like “Help me plan trips”." counter={{ count: charCount(purpose), max: PURPOSE_MAX }}>
        {(p) => <TextArea {...p} value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={4} />}
      </Field>
    </FormDialog>
  )
}
