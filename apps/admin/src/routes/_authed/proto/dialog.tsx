// Throwaway prototype route (emil-prototype): confirm and form dialogs in
// three directions, on real stress data. Deleted when the redesign ships.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { InlineVariant } from '../../../proto/dialog/inline'
import { ModalVariant } from '../../../proto/dialog/modal'
import { SheetVariant } from '../../../proto/dialog/sheet'

export const Route = createFileRoute('/_authed/proto/dialog')({
  staticData: { crumb: 'Dialog prototype' },
  head: () => ({ meta: [{ title: 'Dialog prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      // Phone dialogs rise from the bottom; keep the picker out of their way.
      position="top"
      replay
      variants={[
        { name: 'Modal', render: () => <ModalVariant /> },
        { name: 'Sheet', render: () => <SheetVariant /> },
        { name: 'Inline', render: () => <InlineVariant /> },
      ]}
    />
  ),
})
