// Throwaway prototype route (emil-prototype): three Tasks page layouts on the
// real three-pane shell and stress data. Deleted when the redesign ships.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { ByTopicVariant } from '../../../proto/pages/tasks/by-topic'
import { FilterVariant } from '../../../proto/pages/tasks/filter'
import { TimelineVariant } from '../../../proto/pages/tasks/timeline'

export const Route = createFileRoute('/_authed/proto/page-tasks')({
  staticData: { crumb: 'Tasks page prototype' },
  head: () => ({ meta: [{ title: 'Tasks page prototype · Herbot admin' }] }),
  component: TasksPagePrototype,
})

function TasksPagePrototype() {
  return (
    <Prototype
      position="top"
      variants={[
        { name: 'Filter', render: () => <FilterVariant /> },
        { name: 'Timeline', render: () => <TimelineVariant /> },
        { name: 'By topic', render: () => <ByTopicVariant /> },
      ]}
    />
  )
}
