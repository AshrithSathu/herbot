// Variant 1 "Pane": placement axis. The details are a permanent third pane
// beside the conversation (from 68.75rem), open by default and remembered
// when you hide it; below that width they open over the conversation, and
// on phones as a full screen with "‹ Chat".
import { useLayoutEffect } from 'react'
import { PanelRightIcon } from 'lucide-react'
import { Button } from '@/components/hb/controls'
import { DetailsPane } from '@/components/hb/details-pane'
import { ListSkeleton } from '@/components/hb/feedback'
import { useShell } from '@/components/hb/shell'
import { StatusDot, topicTone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { compact } from '../../../format'
import { Conversation, DetailsBody, Frame, TitleBlock, useTopicDetail, useTopicParam } from './shared'

const PREF = 'proto.topic.details'

export function PaneVariant() {
  const [id, select] = useTopicParam()
  return (
    <Frame topicId={id} onSelect={select} details={<Details id={id} />}>
      <Main id={id} />
    </Frame>
  )
}

function Main({ id }: { id: number }) {
  const topic = useTopicDetail(id)
  const { detailsOpen, setDetailsOpen } = useShell()
  // Open beside the conversation on wide screens unless you hid it.
  useLayoutEffect(() => {
    let hidden = false
    try {
      hidden = localStorage.getItem(PREF) === 'hidden'
    } catch {
      /* storage blocked: default to open */
    }
    if (!hidden && matchMedia('(min-width: 68.75rem)').matches) setDetailsOpen(true)
  }, [setDetailsOpen])
  const toggle = () => {
    const next = !detailsOpen
    setDetailsOpen(next)
    try {
      localStorage.setItem(PREF, next ? 'shown' : 'hidden')
    } catch {
      /* fine: just not remembered */
    }
  }
  return (
    <Conversation
      topicId={id}
      header={
        <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-line px-2 md:px-4">
          <TitleBlock topic={topic} facts={topic && <span className="tabular-nums">· {compact(topic.messages)} messages</span>} />
          <Button variant="ghost" size="icon" aria-label={detailsOpen ? 'Hide details' : 'Show details'} aria-pressed={detailsOpen} onClick={toggle} className={detailsOpen ? 'text-ink' : 'text-mute'}>
            <PanelRightIcon aria-hidden />
          </Button>
        </header>
      }
    />
  )
}

function Details({ id }: { id: number }) {
  const topic = useTopicDetail(id)
  const { setDetailsOpen } = useShell()
  if (!topic) return <ListSkeleton rows={6} lines={1} className="px-4 pt-16" />
  return (
    <DetailsPane
      title={topic.name}
      subtitle={
        <>
          <StatusDot status={topicTone(topic)} />
          <span aria-hidden>·</span>
          <UserText className="min-w-0 flex-1">{topic.group}</UserText>
        </>
      }
      onClose={() => {
        setDetailsOpen(false)
        try {
          localStorage.setItem(PREF, 'hidden')
        } catch {
          /* fine */
        }
      }}
    >
      <DetailsBody topic={topic} />
    </DetailsPane>
  )
}
