import { useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { BrainIcon } from 'lucide-react'
import { deleteMemory, saveMemory, type Memory } from '../../api'
import { memoriesQuery } from '../../queries'
import { charCount } from '../../format'
import { EmptyState, ErrorNote, PageHeader, Section, StaleWarning, notify } from '../../ui'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

export const Route = createFileRoute('/_authed/memory')({
  loader: ({ context }) => context.queryClient.ensureQueryData(memoriesQuery),
  staticData: { crumb: 'Memory' },
  head: () => ({ meta: [{ title: 'Memory · Herbot admin' }] }),
  component: MemoryPage,
})

function MemoryPage() {
  const { data: memories, error } = useSuspenseQuery(memoriesQuery)
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<Memory | 'all' | null>(null)
  const client = useQueryClient()
  const remove = useMutation({
    mutationFn: () => deleteMemory({ data: deleting === 'all' ? {} : { id: deleting!.id } }),
    onSuccess: async () => {
      setDeleting(null)
      await client.invalidateQueries({ queryKey: memoriesQuery.queryKey })
      notify('Memories updated')
    },
  })
  const shown = memories.filter((m) => m.content.toLowerCase().includes(search.toLowerCase()))
  return <>
    <PageHeader title="Memory" description="Facts and preferences shared by every topic. Never add secrets or credentials." />
    <StaleWarning error={error} />
    <Section id="add-memory" title="Add a memory"><MemoryEditor /></Section>
    <Section id="memories" title={`${memories.length} / 200 memories`} action={<Button variant="outline" disabled={!memories.length} onClick={() => { remove.reset(); setDeleting('all') }}>Forget all</Button>}>
      <Field className="max-w-xl"><FieldLabel htmlFor="memory-search">Search memories</FieldLabel><Input id="memory-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
      <div className="mt-4 flex flex-col gap-3">
        {shown.map((memory) => <MemoryRow key={memory.id} memory={memory} onDelete={() => { remove.reset(); setDeleting(memory) }} />)}
        {!shown.length && <EmptyState icon={BrainIcon} title={search ? 'No matching memories' : 'No memories yet'}>{search ? 'Try fewer words.' : 'Add a stable fact above or ask Herbot to remember one in Telegram.'}</EmptyState>}
      </div>
    </Section>
    <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && !remove.isPending && setDeleting(null)}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleting === 'all' ? 'Forget every memory?' : 'Forget this memory?'}</AlertDialogTitle><AlertDialogDescription>{deleting === 'all' ? 'This removes all shared memories. Custom instructions and about-you stay.' : 'This memory will be removed from every topic.'}</AlertDialogDescription></AlertDialogHeader>
        {remove.isError && <ErrorNote title="Couldn’t forget">{remove.error.message}</ErrorNote>}
        <AlertDialogFooter><AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={remove.isPending} onClick={(e) => { e.preventDefault(); remove.mutate() }}>{remove.isPending ? 'Forgetting…' : 'Forget'}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
function MemoryRow({ memory, onDelete }: { memory: Memory; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  return <Card className="py-5 shadow-xs"><CardContent className="px-5">
    {editing ? <MemoryEditor memory={memory} onDone={() => setEditing(false)} /> : <div className="flex flex-wrap items-start gap-3"><p className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere"><span className="text-muted-foreground">#{memory.id} </span>{memory.content}</p><div className="flex gap-2"><Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button><Button variant="outline" onClick={onDelete}>Forget</Button></div></div>}
  </CardContent></Card>
}
function MemoryEditor({ memory, onDone }: { memory?: Memory; onDone?: () => void }) {
  const [content, setContent] = useState(memory?.content ?? '')
  const client = useQueryClient()
  const save = useMutation({
    mutationFn: () => saveMemory({ data: { id: memory?.id, content } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: memoriesQuery.queryKey })
      setContent(''); onDone?.(); notify('Memory saved')
    },
  })
  const count = charCount(content)
  return <form className="flex max-w-2xl flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (content.trim() && count <= 500 && !save.isPending) save.mutate() }}>
    <Field><FieldLabel htmlFor={`memory-${memory?.id ?? 'new'}`}>{memory ? `Edit memory #${memory.id}` : 'What should Herbot remember?'}</FieldLabel><Textarea id={`memory-${memory?.id ?? 'new'}`} value={content} disabled={save.isPending} onChange={(e) => setContent(e.target.value)} aria-describedby={`count-${memory?.id ?? 'new'}`} /><FieldDescription id={`count-${memory?.id ?? 'new'}`} className="tabular-nums">{count} / 500 characters</FieldDescription></Field>
    <div className="flex gap-2"><Button disabled={!content.trim() || count > 500 || save.isPending}>{save.isPending && <Spinner />}{save.isPending ? 'Saving…' : memory ? 'Save changes' : 'Add memory'}</Button>{onDone && <Button type="button" variant="ghost" disabled={save.isPending} onClick={onDone}>Cancel</Button>}</div>
    {save.isError && <ErrorNote title="Couldn’t save">{save.error.message}</ErrorNote>}
  </form>
}
