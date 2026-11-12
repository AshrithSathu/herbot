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
import { Button } from '@/components/hb/controls'
import { topicModeLabel } from '@/components/hb/modes'
import { BackToAgents, ShellDetails, useShell } from '@/components/hb/shell'
import { StatusDot, topicTone } from '@/components/hb/status'
import { Conversation } from '@/components/topic/conversation'
import { TopicDetails } from '@/components/topic/details'
import { TopicFiles } from '@/components/topic/files'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

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
  loader: async ({ context, params }) => {
    const [detail] = await Promise.all([
      context.queryClient.ensureQueryData(topicQuery(params.id)),
      context.queryClient.ensureInfiniteQueryData(messagesQuery(params.id)),
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
  const { data: detail } = useSuspenseQuery(topicQuery(id))
  const t = detail.conversation
  const { message, tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { detailsOpen, setDetailsOpen } = useShell()
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
      <ViewSwitch view={view} onChange={setView} />
      <Button
        variant="ghost"
        size="icon"
        aria-label={detailsOpen ? 'Hide details' : 'Show details'}
        aria-pressed={detailsOpen}
        onClick={() => setDetailsOpen(!detailsOpen)}
        className={detailsOpen ? 'text-ink' : 'text-mute'}
      >
        <PanelRightIcon aria-hidden />
      </Button>
    </TopicHeader>
  )

  return (
    <>
      {view === 'chat' ? (
        <Conversation key={t.id} topic={t} target={message} header={header} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {header}
          <TopicFiles topicId={t.id} />
        </div>
      )}
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

function ViewSwitch({ view, onChange }: { view: 'chat' | 'files'; onChange: (view: 'chat' | 'files') => void }) {
  return (
    <div role="tablist" aria-label="Topic views" className="flex shrink-0 rounded-lg bg-sunken p-0.5">
      {(['chat', 'files'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => onChange(v)}
          className={cn(
            'h-8 rounded-md px-3 text-[13px] font-medium transition-[background-color,color] duration-150 ease-out pointer-coarse:h-10',
            view === v ? 'bg-pane text-ink shadow-raised' : 'text-mute hover:text-ink',
          )}
        >
          {v === 'chat' ? 'Chat' : 'Files'}
        </button>
      ))}
    </div>
  )
}
