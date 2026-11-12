// Throwaway prototype route (emil-prototype): three agent-list rows for the
// Conversation+ shell's left pane, compared on 220 hostile agents.
// ?working=2,5 forces the working state for review (nothing runs in the
// stress environment). Deleted when the redesign ships.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { BriefVariant } from '../../../proto/agent-row/brief'
import { MonogramVariant } from '../../../proto/agent-row/monogram'
import { SignalVariant } from '../../../proto/agent-row/signal'

export const Route = createFileRoute('/_authed/proto/agent-row')({
  staticData: { crumb: 'Agent row prototype' },
  head: () => ({ meta: [{ title: 'Agent row prototype · Herbot admin' }] }),
  component: AgentRowPrototype,
})

function AgentRowPrototype() {
  return (
    <Prototype
      // On phones the list fills the screen to the bottom edge.
      position="top"
      variants={[
        { name: 'Monogram', render: () => <MonogramVariant /> },
        { name: 'Signal', render: () => <SignalVariant /> },
        { name: 'Brief', render: () => <BriefVariant /> },
      ]}
    />
  )
}
