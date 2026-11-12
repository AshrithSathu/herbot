// Throwaway prototype route (emil-prototype): three directions for a chat
// message, on topic 2's worst real content. Deleted when the redesign ships.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { BubblesVariant } from '../../../proto/message/bubbles'
import { CardsVariant } from '../../../proto/message/cards'
import { TranscriptVariant } from '../../../proto/message/transcript'

export const Route = createFileRoute('/_authed/proto/message')({
  staticData: { crumb: 'Message prototype' },
  head: () => ({ meta: [{ title: 'Message prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      position="top"
      variants={[
        { name: 'Bubbles', render: () => <BubblesVariant /> },
        { name: 'Transcript', render: () => <TranscriptVariant /> },
        { name: 'Cards', render: () => <CardsVariant /> },
      ]}
    />
  ),
})
