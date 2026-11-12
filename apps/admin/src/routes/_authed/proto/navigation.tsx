// Throwaway prototype route (emil-prototype): three ways the non-chat pages
// live in the Conversation+ three-pane shell, on desktop and phone.
// Deleted when the redesign ships; nothing in production links here.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { CommandVariant } from '../../../proto/navigation/command'
import { RailVariant } from '../../../proto/navigation/rail'
import { SectionsVariant } from '../../../proto/navigation/sections'

export const Route = createFileRoute('/_authed/proto/navigation')({
  staticData: { crumb: 'Navigation prototype' },
  head: () => ({ meta: [{ title: 'Navigation prototype · Herbot admin' }] }),
  component: NavigationPrototype,
})

function NavigationPrototype() {
  return (
    <Prototype
      // Rail puts a tab bar at the bottom on phones.
      position="top"
      variants={[
        { name: 'Rail', render: () => <RailVariant /> },
        { name: 'Sections', render: () => <SectionsVariant /> },
        { name: 'Command', render: () => <CommandVariant /> },
      ]}
    />
  )
}
