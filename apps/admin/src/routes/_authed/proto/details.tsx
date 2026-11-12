// Throwaway prototype route (emil-prototype): three directions for the topic
// details pane, judged inside the three-pane shell on real stress data.
import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { Frame, PICKS } from '../../../proto/details/shared'
import { SummaryPane } from '../../../proto/details/summary'
import { FormPane } from '../../../proto/details/form'
import { SectionsPane } from '../../../proto/details/sections'

export const Route = createFileRoute('/_authed/proto/details')({
  staticData: { crumb: 'Details prototype' },
  head: () => ({ meta: [{ title: 'Details prototype · Herbot admin' }] }),
  component: DetailsPrototype,
})

function DetailsPrototype() {
  const [topic, setTopic] = useState(PICKS[0])
  const frame = (pane: (id: number) => React.ReactNode) => () => (
    <Frame selected={topic} onSelect={setTopic} pane={<div key={topic} className="flex min-h-0 flex-1 flex-col">{pane(topic)}</div>} />
  )
  return (
    <Prototype
      position="top"
      variants={[
        { name: 'Summary', render: frame((id) => <SummaryPane id={id} />) },
        { name: 'Form', render: frame((id) => <FormPane id={id} />) },
        { name: 'Sections', render: frame((id) => <SectionsPane id={id} />) },
      ]}
    />
  )
}
