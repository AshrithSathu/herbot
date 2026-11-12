// Stage 3 page prototype: the overview. Throwaway (emil-prototype).
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '@/proto/picker'
import { Figures } from '@/proto/pages/overview/figures'
import { Inbox } from '@/proto/pages/overview/inbox'
import { Since } from '@/proto/pages/overview/since'

export const Route = createFileRoute('/_authed/proto/page-overview')({
  staticData: { crumb: 'Overview prototype' },
  head: () => ({ meta: [{ title: 'Overview prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      position="top"
      variants={[
        { name: 'Figures', render: () => <Figures /> },
        { name: 'Inbox', render: () => <Inbox /> },
        { name: 'Since', render: () => <Since /> },
      ]}
    />
  ),
})
