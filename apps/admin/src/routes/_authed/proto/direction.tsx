// Throwaway prototype route (emil-prototype): four visual directions for the
// whole panel, compared full size on real stress data. Deleted when the
// redesign ships; nothing in production links here.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { ConversationVariant } from '../../../proto/direction/conversation'
import { CurrentVariant } from '../../../proto/direction/current'
import { EditorialVariant } from '../../../proto/direction/editorial'
import { LedgerVariant } from '../../../proto/direction/ledger'

export const Route = createFileRoute('/_authed/proto/direction')({
  staticData: { crumb: 'Direction prototype' },
  head: () => ({ meta: [{ title: 'Direction prototype · Herbot admin' }] }),
  component: DirectionPrototype,
})

function DirectionPrototype() {
  return (
    <Prototype
      // Conversation pins its composer to the bottom centre.
      position="top"
      variants={[
        { name: 'Current', render: () => <CurrentVariant /> },
        { name: 'Ledger', render: () => <LedgerVariant /> },
        { name: 'Conversation', render: () => <ConversationVariant /> },
        { name: 'Editorial', render: () => <EditorialVariant /> },
      ]}
    />
  )
}
