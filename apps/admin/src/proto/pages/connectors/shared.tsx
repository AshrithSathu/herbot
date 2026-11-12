// Throwaway (emil-prototype): shared data for the /proto/page-connectors
// variants. Servers and tools come from the real /admin/api/connectors.
import { useQuery } from '@tanstack/react-query'
import { getConnectors } from '../../../api'

export type Server = { name: string; source: string; command: string | null; url: string | null }
export type Tool = { name: string; scope: string }

export function useConnectors() {
  return useQuery({ queryKey: ['proto', 'connectors'], queryFn: () => getConnectors(), staleTime: 30_000 })
}

/** One line on what each herbot-mcp tool does (herbot-mcp's tool docs). */
export const TOOL_DOES: Record<string, string> = {
  list_topics: 'Lists the topics it can see',
  search_messages: 'Searches stored history',
  read_topic: 'Reads a topic’s recent messages',
  ask_topic: 'Asks another topic’s agent and waits for its answer',
  post_to_topic: 'Posts a message into another topic',
  remember: 'Saves a shared memory',
  recall: 'Finds shared memories',
  forget: 'Forgets a shared memory',
  schedule_task: 'Schedules a one-off or recurring prompt',
  list_tasks: 'Lists scheduled tasks',
  pause_task: 'Pauses a task',
  resume_task: 'Resumes a paused task',
  cancel_task: 'Cancels a task',
}

/** Where a server runs: a URL is remote; a command is local to this machine. */
export function reach(s: Server): { kind: 'Remote' | 'Local'; where: string } {
  if (s.url) return { kind: 'Remote', where: s.url }
  return { kind: 'Local', where: s.command ?? 'command not shown' }
}
