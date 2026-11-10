import { useReducer, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createTopic } from '../api'
import { keys } from '../queries'
import { isSignedOut } from '../session'
import { ErrorNote } from '../ui'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
type Creation =
  | { status: 'closed' | 'editing' }
  | { status: 'creating' }
  | { status: 'failed'; error: string }
  | { status: 'created'; id: number; error?: string }
function transitionCreation(state: Creation, next: Creation): Creation {
  const allowed: Record<Creation['status'], Creation['status'][]> = {
    closed: ['editing'],
    editing: ['closed', 'creating'],
    creating: ['created', 'failed'],
    failed: ['closed', 'creating', 'editing'],
    created: ['created'],
  }
  return allowed[state.status].includes(next.status) ? next : state
}
export function NewAgent() {
  const [state, setState] = useReducer(transitionCreation, { status: 'closed' })
  const open = state.status !== 'closed'
  const busy = useRef(false)
  const [name, setName] = useState(''),
    [purpose, setPurpose] = useState('')
  const client = useQueryClient(),
    navigate = useNavigate()
  async function continueToTopic(id: number) {
    try {
      await client.invalidateQueries({ queryKey: keys.topics })
      await navigate({ to: '/topics/$id', params: { id } })
    } catch (error) {
      setState({ status: 'created', id, error: String(error) })
    }
  }
  async function submit() {
    if (busy.current || state.status === 'created') return
    busy.current = true
    setState({ status: 'creating' })
    try {
      const { id } = await createTopic({ data: { name, purpose } })
      setState({ status: 'created', id })
      await continueToTopic(id)
    } catch (error) {
      if (isSignedOut(error)) {
        client.clear()
        await navigate({ to: '/login', ignoreBlocker: true })
      }
      setState({ status: 'failed', error: String(error) })
    } finally {
      busy.current = false
    }
  }
  return (
    <div>
      <Button disabled={state.status === 'creating' || state.status === 'created'} onClick={() => setState({ status: open ? 'closed' : 'editing' })} aria-expanded={open}>
        New agent
      </Button>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="mt-4 flex max-w-xl flex-col gap-3 rounded-xl border bg-card p-5"
        >
          <label htmlFor="agent-name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="agent-name"
            disabled={state.status === 'creating' || state.status === 'created'}
            required
            maxLength={128}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 rounded-lg border px-3"
          />
          <label htmlFor="agent-purpose" className="text-sm font-medium">
            What should this agent do?
          </label>
          <Textarea
            id="agent-purpose"
            disabled={state.status === 'creating' || state.status === 'created'}
            required
            maxLength={12000}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Give it a purpose in at least three words."
          />
          <div className="flex gap-2">
            <Button disabled={(state.status === 'creating' || state.status === 'created')} type="submit">
              {state.status === 'creating' ? 'Creating…' : state.status === 'created' ? 'Created' : 'Create agent'}
            </Button>
            <Button variant="ghost" type="button" disabled={(state.status === 'creating' || state.status === 'created')} onClick={() => setState({ status: 'closed' })}>
              Cancel
            </Button>
          </div>
          {state.status === 'failed' && <ErrorNote title="Couldn’t create agent">{state.error}</ErrorNote>}
          {state.status === 'created' && <p role="status">Agent created. {state.error}<Button type="button" variant="link" onClick={() => void continueToTopic(state.id)}>Open agent</Button></p>}
        </form>
      )}
    </div>
  )
}
