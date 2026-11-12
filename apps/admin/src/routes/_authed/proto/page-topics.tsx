// Stage 3 page prototype: managing topics. Throwaway (emil-prototype).
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '@/proto/picker'
import { Grouped } from '@/proto/pages/topics/grouped'
import { Ledger } from '@/proto/pages/topics/ledger'
import { Manage } from '@/proto/pages/topics/manage'

export const Route = createFileRoute('/_authed/proto/page-topics')({
  staticData: { crumb: 'Topics prototype' },
  head: () => ({ meta: [{ title: 'Topics prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      position="top"
      variants={[
        { name: 'Ledger', render: () => <Ledger /> },
        { name: 'Grouped', render: () => <Grouped /> },
        { name: 'Manage', render: () => <Manage /> },
      ]}
    />
  ),
})
