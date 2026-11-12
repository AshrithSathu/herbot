// Throwaway prototype route (emil-prototype): three status-and-count
// languages for the whole panel, on real stress data. Deleted when the
// redesign ships.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { GlyphVariant } from '../../../proto/status/glyph'
import { PillsVariant } from '../../../proto/status/pills'
import { SignalVariant } from '../../../proto/status/signal'

export const Route = createFileRoute('/_authed/proto/status')({
  staticData: { crumb: 'Status prototype' },
  head: () => ({ meta: [{ title: 'Status prototype · Herbot admin' }] }),
  component: StatusPrototype,
})

function StatusPrototype() {
  return (
    <Prototype
      variants={[
        { name: 'Pills', render: () => <PillsVariant /> },
        { name: 'Signal', render: () => <SignalVariant /> },
        { name: 'Glyph', render: () => <GlyphVariant /> },
      ]}
    />
  )
}
