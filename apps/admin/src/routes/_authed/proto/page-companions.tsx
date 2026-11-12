// Throwaway (emil-prototype, Stage 3): the Companions page, three layouts.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '@/proto/picker'
import { Docked } from '@/proto/pages/companions/docked'
import { InTopic } from '@/proto/pages/companions/intopic'
import { Stage } from '@/proto/pages/companions/stage'

export const Route = createFileRoute('/_authed/proto/page-companions')({
  staticData: { crumb: 'Companions prototype' },
  head: () => ({ meta: [{ title: 'Companions prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      position="top"
      variants={[
        { name: 'Stage', render: () => <Stage /> },
        { name: 'Call panel', render: () => <Docked /> },
        { name: 'Voice mode', render: () => <InTopic /> },
      ]}
    />
  ),
})
