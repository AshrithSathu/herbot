// Throwaway prototype route (emil-prototype): three directions for the form
// control kit, in a realistic topic-settings form on real stress data.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { CardsControls } from '../../../proto/controls/cards'
import { PronouncedControls } from '../../../proto/controls/pronounced'
import { QuietControls } from '../../../proto/controls/quiet'

export const Route = createFileRoute('/_authed/proto/controls')({
  staticData: { crumb: 'Controls prototype' },
  head: () => ({ meta: [{ title: 'Controls prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      // Cards pins its save bar to the bottom.
      position="top"
      variants={[
        { name: 'Quiet', render: () => <QuietControls /> },
        { name: 'Pronounced', render: () => <PronouncedControls /> },
        { name: 'Cards', render: () => <CardsControls /> },
      ]}
    />
  ),
})
