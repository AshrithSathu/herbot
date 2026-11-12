// Variant 2 "Drawer": interaction axis. The conversation always has the
// whole main pane; the details exist only on demand, as a modal drawer from
// the right edge (full screen on phones) that traps focus and returns it to
// the ⓘ button. Two panes at every width.
import { useState } from 'react'
import { Dialog } from 'radix-ui'
import { InfoIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/hb/controls'
import { ListSkeleton } from '@/components/hb/feedback'
import { StatusDot, topicTone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { compact } from '../../../format'
import { Conversation, DetailsBody, Frame, TitleBlock, useTopicDetail, useTopicParam } from './shared'

export function DrawerVariant() {
  const [id, select] = useTopicParam()
  return (
    <Frame topicId={id} onSelect={select}>
      <Main id={id} />
    </Frame>
  )
}

function Main({ id }: { id: number }) {
  const topic = useTopicDetail(id)
  const [open, setOpen] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Conversation
        topicId={id}
        header={
          <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-line px-2 md:px-4">
            <TitleBlock topic={topic} facts={topic && <span className="tabular-nums">· {compact(topic.messages)} messages</span>} />
            <Dialog.Trigger asChild>
              <Button variant="ghost" size="icon" aria-label="Topic details">
                <InfoIcon aria-hidden />
              </Button>
            </Dialog.Trigger>
          </header>
        }
      />
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[oklch(0_0_0/0.32)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-180 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-250" />
        <Dialog.Content
          aria-describedby={undefined}
          className="hb fixed inset-0 z-50 flex flex-col bg-pane text-ink outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right-8 data-[state=closed]:fade-out-0 data-[state=closed]:duration-180 data-[state=closed]:ease-in data-[state=open]:animate-in data-[state=open]:slide-in-from-right-8 data-[state=open]:fade-in-0 data-[state=open]:duration-250 data-[state=open]:ease-[cubic-bezier(0.32,0.72,0,1)] md:inset-y-2 md:right-2 md:left-auto md:w-[26rem] md:rounded-2xl md:shadow-raised"
        >
          <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-2 pt-[env(safe-area-inset-top)] md:px-4">
            <div className="flex min-w-0 flex-1 flex-col py-2 pl-2 md:pl-0">
              <Dialog.Title className="min-w-0 text-[15px] font-semibold">
                <UserText>{topic?.name}</UserText>
              </Dialog.Title>
              {topic && (
                <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-mute">
                  <StatusDot status={topicTone(topic)} />
                  <span aria-hidden>·</span>
                  <UserText className="min-w-0 flex-1">{topic.group}</UserText>
                </div>
              )}
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close details">
                <XIcon aria-hidden />
              </Button>
            </Dialog.Close>
          </header>
          <div className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {topic ? <DetailsBody topic={topic} /> : <ListSkeleton rows={6} lines={1} className="px-4 pt-4" />}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
