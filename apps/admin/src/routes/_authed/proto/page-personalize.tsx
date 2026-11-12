// Throwaway prototype route (emil-prototype): three Personalize page layouts
// on the real three-pane shell and stress data. Deleted when the redesign ships.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { FocusedVariant } from '../../../proto/pages/personalize/focused'
import { PreviewVariant } from '../../../proto/pages/personalize/preview'
import { StackedVariant } from '../../../proto/pages/personalize/stacked'

export const Route = createFileRoute('/_authed/proto/page-personalize')({
  staticData: { crumb: 'Personalize page prototype' },
  head: () => ({ meta: [{ title: 'Personalize page prototype · Herbot admin' }] }),
  component: PersonalizePagePrototype,
})

function PersonalizePagePrototype() {
  return (
    <Prototype
      position="top"
      variants={[
        { name: 'Stacked', render: () => <StackedVariant /> },
        { name: 'Preview', render: () => <PreviewVariant /> },
        { name: 'Focused', render: () => <FocusedVariant /> },
      ]}
    />
  )
}
