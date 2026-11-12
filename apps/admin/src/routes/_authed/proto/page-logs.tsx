// Throwaway page prototype (emil-prototype): three layouts for Logs, built
// from components/hb on stress data. Deleted with src/proto.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '@/proto/picker'
import { InlineVariant } from '@/proto/pages/logs/inline'
import { PagesVariant } from '@/proto/pages/logs/pages'
import { SplitVariant } from '@/proto/pages/logs/split'

export const Route = createFileRoute('/_authed/proto/page-logs')({
  staticData: { crumb: 'Logs prototype' },
  head: () => ({ meta: [{ title: 'Logs prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      position="top"
      variants={[
        { name: 'Pages', render: () => <PagesVariant /> },
        { name: 'Split', render: () => <SplitVariant /> },
        { name: 'Inline', render: () => <InlineVariant /> },
      ]}
    />
  ),
})
