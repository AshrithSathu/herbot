import { useRef, useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ClockIcon } from 'lucide-react'
import { changeTask, createTask, type TaskInput } from '../../../api'
import { tasksQuery, topicsQuery } from '../../../queries'
import { EmptyState, ErrorNote, PageHeader, Section, StaleWarning, Time, notify } from '../../../ui'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'

export const Route = createFileRoute('/_authed/tasks/')({
  loader: async ({ context }) => { await Promise.all([context.queryClient.ensureQueryData(tasksQuery), context.queryClient.ensureQueryData(topicsQuery)]) },
  staticData: { crumb: 'Tasks' },
  head: () => ({ meta: [{ title: 'Tasks · Herbot admin' }] }),
  component: TasksPage,
})

const selectClass = 'h-10 w-full rounded-md border bg-background px-3 text-base focus-visible:ring-2 focus-visible:ring-ring'

function TasksPage() {
  const { data: tasks, error } = useSuspenseQuery(tasksQuery)
  const { data: topics } = useSuspenseQuery(topicsQuery)
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: ['tasks'] })
  const mutation = useMutation({
    mutationFn: (data: { id: number; action: 'pause' | 'resume' | 'cancel' | 'run' }) => changeTask({ data }),
    onSuccess: (_task, args) => notify(args.action === 'run' ? 'Run requested. It will start within 15 seconds when the topic is ready and on.' : 'Task updated.'),
    onSettled: refresh,
  })
  const visible = tasks.filter(t => t.status !== 'cancelled')
  return <>
    <PageHeader title="Tasks"><p className="text-sm text-muted-foreground">Scheduled prompts, answered by the agent in their topic.</p></PageHeader>
    <StaleWarning error={error} />
    <CreateTaskForm />
    <Section id="task-list" title="Scheduled tasks">
      {mutation.isError && <ErrorNote title="Couldn’t update task">{mutation.error.message}</ErrorNote>}
      {!visible.length && <EmptyState icon={ClockIcon} title="No tasks yet">Create a reminder or recurring prompt above.</EmptyState>}
      {visible.map(task => <Card key={task.id} className="py-5 shadow-xs"><CardContent className="flex flex-col gap-4 px-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-medium wrap-anywhere">{task.title || task.prompt}</h3>
          <p className="text-sm text-muted-foreground">{topics.find(t => t.id === task.conversation_id)?.place ?? `Topic #${task.conversation_id}`} · {task.status}</p>
          {task.title && <p className="max-w-[65ch] text-sm whitespace-pre-wrap wrap-anywhere">{task.prompt}</p>}
          <p className="text-sm text-muted-foreground">{task.cron ? `Recurring: ${task.cron} (${task.timezone})` : 'One-off reminder'} · Next: <Time iso={task.next_run_at} /> · {task.run_count} runs</p>
          {task.last_error && <ErrorNote title="Last run failed">{task.last_error}</ErrorNote>}
        </div>
        <div className="flex flex-wrap gap-2">
          {(task.status === 'active' || task.status === 'paused') && <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: task.id, action: task.status === 'active' ? 'pause' : 'resume' })}>{task.status === 'active' ? 'Pause' : 'Resume'}</Button>}
          <Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ id: task.id, action: 'run' })}>Run now</Button>
          <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" disabled={mutation.isPending}>Delete…</Button></AlertDialogTrigger>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this task?</AlertDialogTitle><AlertDialogDescription>Future runs will stop. A run already queued may still finish.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel autoFocus>Keep task</AlertDialogCancel><AlertDialogAction onClick={() => mutation.mutate({ id: task.id, action: 'cancel' })}>Delete task</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent></Card>)}
    </Section>
  </>
}

function CreateTaskForm() {
  const { data: topics } = useSuspenseQuery(topicsQuery)
  const [mode, setMode] = useState('once')
  const busy = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const client = useQueryClient()
  const create = useMutation({
    mutationFn: (data: TaskInput) => createTask({ data }),
    onSuccess: async () => { form.current?.reset(); setMode('once'); notify('Task created.'); await client.invalidateQueries({ queryKey: ['tasks'] }) },
    onSettled: () => { busy.current = false },
  })
  return <Section id="create-task" title="Create a task"><Card className="py-5 shadow-xs"><CardContent className="px-5">
    <form ref={form} className="flex max-w-2xl flex-col gap-5" onSubmit={e => {
      e.preventDefault(); if (busy.current) return
      const data = new FormData(e.currentTarget)
      const when = String(data.get('when') ?? '')
      const cron = mode === 'daily' ? '0 9 * * *' : mode === 'weekly' ? '0 9 * * MON' : String(data.get('cron') ?? '')
      busy.current = true
      create.mutate({ conversation_id: Number(data.get('topic')), prompt: String(data.get('prompt')), title: String(data.get('title')) || undefined, ...(mode === 'once' ? { when: new Date(when).toISOString() } : { cron, timezone: String(data.get('timezone')) || undefined }) })
    }}>
      <fieldset disabled={create.isPending} className="contents">
      <Field><FieldLabel htmlFor="task-topic">Topic</FieldLabel><select className={selectClass} id="task-topic" name="topic" required><option value="">Choose a topic</option>{topics.map(t => <option key={t.id} value={t.id}>{t.place}{!t.enabled ? ' (off)' : ''}</option>)}</select></Field>
      <Field><FieldLabel htmlFor="task-title">Title (optional)</FieldLabel><Input id="task-title" name="title" maxLength={200} /></Field>
      <Field><FieldLabel htmlFor="task-prompt">What should the agent do?</FieldLabel><Textarea id="task-prompt" name="prompt" required maxLength={16000} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} /></Field>
      <Field><FieldLabel htmlFor="task-mode">Schedule</FieldLabel><select className={selectClass} id="task-mode" value={mode} onChange={e => setMode(e.target.value)}><option value="once">Once</option><option value="daily">Daily at 9 am</option><option value="weekly">Every Monday at 9 am</option><option value="custom">Custom cron</option></select></Field>
      {mode === 'once' ? <Field><FieldLabel htmlFor="task-when">Date and time</FieldLabel><FieldDescription>Uses your browser’s local timezone.</FieldDescription><Input id="task-when" name="when" type="datetime-local" required /></Field> : <>
        {mode === 'custom' && <Field><FieldLabel htmlFor="task-cron">Cron expression</FieldLabel><FieldDescription>Minute hour day month weekday. Example: 0 9 * * MON-FRI</FieldDescription><Input id="task-cron" name="cron" required placeholder="0 9 * * *" /></Field>}
        <Field><FieldLabel htmlFor="task-timezone">IANA timezone (optional)</FieldLabel><FieldDescription>Leave blank to use the server timezone (Asia/Kolkata by default).</FieldDescription><Input id="task-timezone" name="timezone" placeholder="Asia/Kolkata" /></Field>
      </>}
      {create.isError && <ErrorNote title="Couldn’t create task">{create.error.message}</ErrorNote>}
      <Button type="submit" className="self-start" disabled={create.isPending}>{create.isPending && <Spinner />}{create.isPending ? 'Creating…' : 'Create task'}</Button>
      </fieldset>
    </form>
  </CardContent></Card></Section>
}
