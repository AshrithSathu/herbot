import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createTopic } from '../api'
import { keys } from '../queries'
import { ErrorNote } from '../ui'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
export function NewAgent() {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [purpose, setPurpose] = useState('')
  const client = useQueryClient(),
    navigate = useNavigate()
  const create = useMutation({
    mutationFn: () => createTopic({ data: { name, purpose } }),
    onSuccess: async ({ id }) => {
      await client.invalidateQueries({ queryKey: keys.topics })
      await navigate({ to: '/topics/$id', params: { id } })
    },
  })
  return (
    <div>
      <Button onClick={() => setOpen(!open)} aria-expanded={open}>
        New agent
      </Button>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!create.isPending) create.mutate()
          }}
          className="mt-4 flex max-w-xl flex-col gap-3 rounded-xl border bg-card p-5"
        >
          <label htmlFor="agent-name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="agent-name"
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
            required
            maxLength={12000}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Give it a purpose in at least three words."
          />
          <div className="flex gap-2">
            <Button disabled={create.isPending} type="submit">
              {create.isPending ? 'Creating…' : 'Create agent'}
            </Button>
            <Button variant="ghost" type="button" disabled={create.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {create.isError && <ErrorNote title="Couldn’t create agent">{create.error.message}</ErrorNote>}
        </form>
      )}
    </div>
  )
}
