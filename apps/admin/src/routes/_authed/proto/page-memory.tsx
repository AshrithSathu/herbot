// Throwaway prototype route (emil-prototype): three Memory page layouts on
// the real three-pane shell and stress data. Deleted when the redesign ships.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { BySourceVariant } from '../../../proto/pages/memory/by-source'
import { ListVariant } from '../../../proto/pages/memory/list'
import { ReaderVariant } from '../../../proto/pages/memory/reader'

export const Route = createFileRoute('/_authed/proto/page-memory')({
  staticData: { crumb: 'Memory page prototype' },
  head: () => ({ meta: [{ title: 'Memory page prototype · Herbot admin' }] }),
  component: MemoryPagePrototype,
})

function MemoryPagePrototype() {
  return (
    <Prototype
      position="top"
      variants={[
        { name: 'List', render: () => <ListVariant /> },
        { name: 'By source', render: () => <BySourceVariant /> },
        { name: 'Reader', render: () => <ReaderVariant /> },
      ]}
    />
  )
}
