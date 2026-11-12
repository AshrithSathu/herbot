// Throwaway (emil-prototype, Stage 3): the Connectors page, two layouts.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '@/proto/picker'
import { List } from '@/proto/pages/connectors/list'
import { Settings } from '@/proto/pages/connectors/settings'

export const Route = createFileRoute('/_authed/proto/page-connectors')({
  staticData: { crumb: 'Connectors prototype' },
  head: () => ({ meta: [{ title: 'Connectors prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      variants={[
        { name: 'List', render: () => <List /> },
        { name: 'Settings', render: () => <Settings /> },
      ]}
    />
  ),
})
