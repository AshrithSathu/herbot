// Throwaway prototype route (emil-prototype): three row patterns for every
// list page, on real stress data. Deleted when the redesign ships.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { CardsVariant } from '../../../proto/rows/cards'
import { LedgerVariant } from '../../../proto/rows/ledger'
import { ThreadVariant } from '../../../proto/rows/thread'

export const Route = createFileRoute('/_authed/proto/rows')({
  staticData: { crumb: 'Rows prototype' },
  head: () => ({ meta: [{ title: 'Rows prototype · Herbot admin' }] }),
  component: RowsPrototype,
})

function RowsPrototype() {
  return (
    <Prototype
      variants={[
        { name: 'Ledger', render: () => <LedgerVariant /> },
        { name: 'Thread', render: () => <ThreadVariant /> },
        { name: 'Index cards', render: () => <CardsVariant /> },
      ]}
    />
  )
}
