// Throwaway prototype route (emil-prototype): every non-happy state in three
// directions, on real stress data. Deleted when the redesign ships.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { InPlace } from '../../../proto/feedback/inplace'
import { StripVariant } from '../../../proto/feedback/strip'
import { ToastsVariant } from '../../../proto/feedback/toasts'

export const Route = createFileRoute('/_authed/proto/feedback')({
  staticData: { crumb: 'Feedback prototype' },
  head: () => ({ meta: [{ title: 'Feedback prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      // The composer and the state strip sit at the bottom.
      position="top"
      replay
      variants={[
        { name: 'In place', render: () => <InPlace /> },
        { name: 'Strip', render: () => <StripVariant /> },
        { name: 'Toasts', render: () => <ToastsVariant /> },
      ]}
    />
  ),
})
