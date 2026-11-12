// Every signed-in page lives in the three-pane shell (docs/design/
// DECISIONS.md, Stage 1 and "Navigation"): the icon rail, the agents pane,
// the page, and a details pane when the page has one. One status strip on
// top says when Telegram isn't connected or herbot-core can't be reached.
import type { MouseEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, createFileRoute, redirect, useMatch, useRouter } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { logout, type Topic } from '../api'
import { activityQuery, overviewQuery, sessionQuery, topicsQuery } from '../queries'
import { AgentList } from '@/components/hb/agent-list'
import { plainReason } from '@/lib/reasons'
import { Button } from '@/components/hb/controls'
import { StatusStrip } from '@/components/hb/feedback'
import { NewAgentHost, openNewAgent } from '@/components/new-agent'
import { AgentsHeader, Shell, useShell } from '@/components/hb/shell'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context }) => {
    const { signedIn } = await context.queryClient.ensureQueryData(sessionQuery)
    if (!signedIn) throw redirect({ to: '/login' })
  },
  loader: async ({ context }) => {
    // The agents pane lists them; warm it, but a failure here is the pane's
    // to report (with Try again), not the page's.
    await context.queryClient.prefetchQuery(topicsQuery)
  },
  component: Layout,
})

function Layout() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const topics = useQuery(topicsQuery)
  const signOut = useMutation({
    mutationFn: () => logout(),
    onSuccess: async () => {
      queryClient.clear()
      await router.navigate({ to: '/login', ignoreBlocker: true })
    },
  })
  return (
    <Shell
      agents={<AgentsPane />}
      strip={<SystemStrip />}
      onSignOut={() => signOut.mutate()}
      signingOut={signOut.isPending}
      topics={topics.data}
      actions={[
        { id: 'new-agent', label: 'New agent', icon: PlusIcon, run: openNewAgent },
      ]}
    >
      <Page />
      <NewAgentHost />
    </Shell>
  )
}

/** Every page renders its own panes and scrolling (ShellPage, or the
 * topic's conversation); so do the router's fallbacks (ui.tsx). */
function Page() {
  return <Outlet />
}

function AgentsPane() {
  const topics = useQuery(topicsQuery)
  const activity = useQuery(activityQuery)
  const { showMain } = useShell()
  const match = useMatch({ from: '/_authed/topics/$id', shouldThrow: false })
  const activeId = match?.params.id
  const working = new Set((activity.data ?? []).filter((a) => a.in_progress).map((a) => a.conversation_id))
  return (
    <AgentList
      topics={topics.data}
      pending={topics.isPending}
      // Plain words for known reasons ("database error" isn't one).
      error={topics.isError ? new Error(plainReason(topics.error.message)?.sentence ?? 'Try again in a moment.') : null}
      onRetry={() => void topics.refetch()}
      retrying={topics.isFetching && topics.isError}
      activeId={activeId}
      isUnread={(t: Topic) => t.unread > 0}
      isWorking={(t: Topic) => working.has(t.id)}
      // On phones, picking an agent shows its conversation.
      onSelect={(_id: number, _e: MouseEvent<HTMLAnchorElement>) => showMain()}
      header={
        <AgentsHeader
          count={topics.data?.length}
          action={
            <Button size="icon" variant="ghost" aria-label="New agent" title="New agent" onClick={openNewAgent}>
              <PlusIcon aria-hidden />
            </Button>
          }
        />
      }
    />
  )
}

/** System-wide state only (DECISIONS.md, "Feedback states"). */
function SystemStrip() {
  const overview = useQuery(overviewQuery)
  if (overview.isError) {
    return (
      <StatusStrip tone="off" short="Can’t reach herbot-core">
        Can’t reach herbot-core, so nothing here is current. It retries every 15 seconds.
      </StatusStrip>
    )
  }
  if (overview.data && !overview.data.bot) {
    return (
      <StatusStrip short="Telegram is off">
        Telegram isn’t connected: agents can’t receive or send messages until the bot is running.
      </StatusStrip>
    )
  }
  return null
}
