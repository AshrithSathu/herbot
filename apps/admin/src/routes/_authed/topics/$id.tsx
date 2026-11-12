// A topic (docs/design/DECISIONS.md, "Topic (chat home)": Pane). The
// conversation fills the main pane; its details are a permanent third pane
// on wide screens (hide/show remembered), an overlay below 68.75rem, and a
// full screen on phones. A Chat | Files switch in the header (kept in the
// URL as ?tab=files) swaps the conversation for the topic's files.
import { useEffect, type ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { PanelRightIcon } from 'lucide-react'
import type { Topic, TopicDetail } from '../../../api'
import { compact, exact } from '../../../format'
import { messagesQuery, topicQuery } from '../../../queries'
import { Button, Tab, TabList, TabPanel, Tabs } from '@/components/hb/controls'
import { topicModeLabel } from '@/components/hb/modes'
import { BackToAgents, ShellDetails, useShell } from '@/components/hb/shell'
import { useMedia } from '@/components/hb/use-media'
import { StatusDot, topicTone } from '@/components/hb/status'
import { Conversation, windowQuery } from '@/components/topic/conversation'
import { TopicDetails } from '@/components/topic/details'
import { TopicFiles } from '@/components/topic/files'
import { UserText } from '@/components/user-text'

type Search = { message?: number; tab?: 'files' | 'settings' }

export const Route = createFileRoute('/_authed/topics/$id')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    message: Number.isSafeInteger(Number(s.message)) && Number(s.message) > 0 ? Number(s.message) : undefined,
    // "settings" is the old tab: it now opens the details pane.
    tab: s.tab === 'files' || s.tab === 'settings' ? s.tab : undefined,
  }),
  params: {
    parse: ({ id }) => {
      const n = Number(id)
      if (!Number.isSafeInteger(n) || n <= 0) throw notFound()
      return { id: n }
    },
    stringify: ({ id }) => ({ id: String(id) }),
  },
  loaderDeps: ({ search }) => ({ message: search.message }),
  loader: async ({ context, params, deps }) => {
    const [detail] = await Promise.all([
      context.queryClient.ensureQueryData(topicQuery(params.id)),
      // A search hit opens the window around it; otherwise the newest messages.
      deps.message
        ? context.queryClient.ensureInfiniteQueryData(windowQuery(params.id, deps.message))
        : context.queryClient.ensureInfiniteQueryData(messagesQuery(params.id)),
    ])
    return detail
  },
  staticData: {
    shell: 'page',
    crumbParent: { label: 'Topics', to: '/topics' },
    crumb: (data) => (data as TopicDetail | undefined)?.conversation.name,
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.conversation.name.trim() || 'Topic'} · Herbot admin` }],
  }),
  component: TopicPage,
})

function TopicPage() {
  const { id } = Route.useParams()
  const { message, tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { detailsOpen, setDetailsOpen, phonePane } = useShell()
  // On phones the agents list can cover this pane: don't poll what you can't see.
  const twoPanes = useMedia('(min-width: 48rem)', true)
  const visible = twoPanes || phonePane === 'main'
  const { data: detail } = useSuspenseQuery(topicQuery(id, { poll: visible }))
  const t = detail.conversation
  const view = tab === 'files' ? 'files' : 'chat'

  // The old Settings tab's links open the details pane instead.
  useEffect(() => {
    if (tab !== 'settings') return
    setDetailsOpen(true)
    void navigate({ search: (s) => ({ ...s, tab: undefined }), replace: true })
  }, [tab, setDetailsOpen, navigate])

  const setView = (next: 'chat' | 'files') =>
    void navigate({ search: (s) => ({ ...s, tab: next === 'files' ? 'files' : undefined, message: next === 'files' ? undefined : s.message }), replace: true })

  const header = (
    <TopicHeader topic={t}>
      <ViewSwitch />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Topic details"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen(!detailsOpen)}
        className={detailsOpen ? 'text-ink' : 'text-mute'}
      >
        <PanelRightIcon aria-hidden />
      </Button>
    </TopicHeader>
  )

  const leaveTarget = () => void navigate({ search: (s) => ({ ...s, message: undefined }), replace: true })

  return (
    <>
      {/* Chat | Files: the kit's tabs (arrow keys, one tab stop, labelled panels). */}
      <Tabs value={view} onValueChange={setView} className="flex-1">
        <TabPanel value="chat">
          <Conversation key={t.id} topic={t} target={message} header={header} visible={visible} onLeaveTarget={leaveTarget} />
        </TabPanel>
        <TabPanel value="files">
          {header}
          <TopicFiles topicId={t.id} />
        </TabPanel>
      </Tabs>
      <ShellDetails defaultOpen>
        <TopicDetails key={t.id} detail={detail} onClose={() => setDetailsOpen(false)} />
      </ShellDetails>
    </>
  )
}

/** Back (phones), the name, one status line, then the header's controls. */
function TopicHeader({ topic: t, children }: { topic: Topic; children: ReactNode }) {
  const status = topicTone(t)
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-line px-2 md:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <BackToAgents />
        <div className="flex min-w-0 flex-1 flex-col py-2">
          <h1 className="min-w-0">
            <UserText className="text-[15px] font-semibold">{t.name}</UserText>
          </h1>
          <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-mute">
            <StatusDot status={status} />
            <span aria-hidden className="max-sm:hidden">·</span>
            <span className="shrink-0 tabular-nums max-sm:hidden" title={exact(t.messages)}>
              {compact(t.messages)} {t.messages === 1 ? 'message' : 'messages'}
            </span>
            {t.mode !== 'auto' && (
              <>
                <span aria-hidden>·</span>
                <span className="shrink-0">{topicModeLabel(t.mode)}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {children}
    </header>
  )
}

function ViewSwitch() {
  return (
    <TabList label="Topic views" className="self-stretch">
      <Tab value="chat" className="h-auto pointer-coarse:h-auto">Chat</Tab>
      <Tab value="files" className="h-auto pointer-coarse:h-auto">Files</Tab>
    </TabList>
  )
}
