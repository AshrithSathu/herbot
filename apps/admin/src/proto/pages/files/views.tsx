// The topic header for the files variants that take over the main pane:
// identity plus a Chat | Files switch (Chat is the same conversation as the
// topic prototypes). Throwaway.
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Conversation, TitleBlock, useTopicDetail } from '../topic/shared'

export type View = 'chat' | 'files'

export function TopicViews({ topicId, files }: { topicId: number; files: (header: ReactNode) => ReactNode }) {
  const [view, setView] = useState<View>('files')
  const topic = useTopicDetail(topicId)
  const header = (
    <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-2 md:px-4">
      <TitleBlock topic={topic} />
      <div role="tablist" aria-label="Topic views" className="flex shrink-0 rounded-lg bg-sunken p-0.5">
        {(['chat', 'files'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={cn(
              'h-8 rounded-md px-3 text-[13px] font-medium transition-[background-color,color] duration-150 ease-out pointer-coarse:h-10',
              view === v ? 'bg-pane text-ink shadow-raised' : 'text-mute hover:text-ink',
            )}
          >
            {v === 'chat' ? 'Chat' : 'Files'}
          </button>
        ))}
      </div>
    </header>
  )
  return view === 'chat' ? <Conversation topicId={topicId} header={header} /> : <>{files(header)}</>
}
