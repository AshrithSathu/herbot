// Stage 3 page prototype: where a topic's details live around the
// conversation. Throwaway (emil-prototype); nothing in production links here.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '@/proto/picker'
import { PaneVariant } from '@/proto/pages/topic/pane'
import { DrawerVariant } from '@/proto/pages/topic/drawer'
import { HeaderVariant } from '@/proto/pages/topic/header'

export const Route = createFileRoute('/_authed/proto/page-topic')({
  staticData: { crumb: 'Topic page prototype' },
  head: () => ({ meta: [{ title: 'Topic page · prototype' }] }),
  component: () => (
    <Prototype
      position="top"
      variants={[
        { name: 'Pane', render: () => <PaneVariant /> },
        { name: 'Drawer', render: () => <DrawerVariant /> },
        { name: 'Header', render: () => <HeaderVariant /> },
      ]}
    />
  ),
})
