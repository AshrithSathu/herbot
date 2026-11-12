// Throwaway (emil-prototype): the real three-pane shell around a page
// prototype, so Tasks, Memory and Personalize variants are judged in place.
// Shared by the P3 page prototypes; deleted with src/proto.
import { useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { activityQuery, overviewQuery, topicsQuery } from '../../../queries'
import { AgentList } from '@/components/hb/agent-list'
import { Button } from '@/components/hb/controls'
import { notify, StatusStrip } from '@/components/hb/feedback'
import { AgentsHeader, Shell } from '@/components/hb/shell'

export function PageFrame({ children, details }: { children: ReactNode; details?: ReactNode }) {
  const topics = useQuery(topicsQuery)
  const activity = useQuery(activityQuery)
  const overview = useQuery(overviewQuery)
  const working = useMemo(
    () => new Set((activity.data ?? []).filter((a) => a.in_progress).map((a) => a.conversation_id)),
    [activity.data],
  )
  return (
    // Covers the current production shell while the prototype is judged.
    <div className="fixed inset-0 z-[45]">
      <Shell
        topics={topics.data}
        onSignOut={() => notify('Signing out is off in prototypes.')}
        strip={
          overview.data && !overview.data.bot ? (
            <StatusStrip>
              <span className="md:hidden">Telegram isn’t connected.</span>
              <span className="max-md:hidden">Telegram isn’t connected: agents can’t receive or send messages until the bot is running.</span>
            </StatusStrip>
          ) : undefined
        }
        agents={
          <AgentList
            topics={topics.data}
            pending={topics.isPending}
            error={topics.error}
            onRetry={() => topics.refetch()}
            isUnread={(t) => t.unread > 0}
            isWorking={(t) => working.has(t.id)}
            header={
              <AgentsHeader
                count={topics.data?.length}
                action={
                  <Button size="icon" variant="ghost" aria-label="New agent" onClick={() => notify('New agent opens its dialog here.')}>
                    <PlusIcon aria-hidden />
                  </Button>
                }
              />
            }
          />
        }
        details={details}
      >
        {children}
      </Shell>
    </div>
  )
}
