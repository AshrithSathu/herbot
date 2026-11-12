// Every read the panel makes, as TanStack Query options. Loaders call
// `ensureQueryData` with these (so pages render on the server and links
// prefetch on hover); components read the same keys with `useSuspenseQuery`,
// so a page never fetches the same thing twice and mutations update in place.
import { infiniteQueryOptions, mutationOptions, queryOptions } from '@tanstack/react-query'
import { getMessagesAround, getTaskCounts, getErrorsTotal, listActivity, markRead, listMemories, getPreferences, listTasks, ERROR_PAGE, getError, getMessages, getOverview, getTopic, getUiPrefs, listTopics, searchErrors, whoami } from './api'

export const keys = {
  session: ['session'] as const,
  uiPrefs: ['ui-prefs'] as const,
  overview: ['overview'] as const,
  activity: ['activity'] as const,
  /** Prefix of the list and every topic detail, so one invalidate hits all. */
  topics: ['topics'] as const,
  topicList: ['topics', 'list'] as const,
  topic: (id: number) => ['topics', 'detail', id] as const,
  /** Not under `topics`: editing a topic shouldn't reload its whole history. */
  messages: (id: number) => ['messages', id] as const,
  errors: ['errors'] as const,
  errorSearch: (q: string) => ['errors', 'search', q] as const,
  error: (id: string) => ['errors', 'detail', id] as const,
}

/** Checked before every signed-in page; a minute of trust is plenty, since
 * any data call made after the cookie expires sends you to sign in anyway. */
export const sessionQuery = queryOptions({
  queryKey: keys.session,
  queryFn: () => whoami(),
  staleTime: 60_000,
})

/** Read once per page load; after that the sidebar keeps its own state. */
export const uiPrefsQuery = queryOptions({
  queryKey: keys.uiPrefs,
  queryFn: () => getUiPrefs(),
  staleTime: Infinity,
})

export const overviewQuery = queryOptions({
  queryKey: keys.overview,
  queryFn: () => getOverview(),
  refetchInterval: 15_000,
})

export const topicsQuery = queryOptions({
  queryKey: keys.topicList,
  queryFn: () => listTopics(),
  refetchInterval: 15_000,
})

export const topicQuery = (id: number) =>
  queryOptions({
    queryKey: keys.topic(id),
    queryFn: () => getTopic({ data: id }),
    // Small (no messages), so polling is cheap. A changed message count is
    // what tells the chat log to fetch what's new.
    refetchInterval: 2_000,
  })

/** A topic's history, newest page first; each next page is older. Pages
 * never refetch on their own: new messages are merged in by `after`. */
export const messagesQuery = (id: number) =>
  infiniteQueryOptions({
    queryKey: keys.messages(id),
    queryFn: ({ pageParam }) => getMessages({ data: { id, before: pageParam } }),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => (page.has_more ? (page.messages[0]?.id ?? null) : null),
    staleTime: Infinity,
  })

/** Newest first, 50 at a time; "Load older" asks for the next 50. */
export const errorSearchQuery = (q: string) =>
  infiniteQueryOptions({
    queryKey: keys.errorSearch(q),
    queryFn: ({ pageParam }) => searchErrors({ data: { q, before: pageParam } }),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => (page.length === ERROR_PAGE ? (page.at(-1)?.id ?? null) : null),
  })

export const errorQuery = (id: string) =>
  queryOptions({
    queryKey: keys.error(id),
    queryFn: () => getError({ data: id }),
    // An error never changes once recorded.
    staleTime: Infinity,
  })

export const memoriesQuery = queryOptions({
  queryKey: ['memories'], queryFn: () => listMemories(), refetchInterval: 10_000,
})
export const preferencesQuery = queryOptions({
  queryKey: ['preferences'], queryFn: () => getPreferences(), refetchInterval: 10_000,
})
export const tasksQuery = infiniteQueryOptions({
  queryKey: ['tasks'],
  initialPageParam: undefined as number | undefined,
  queryFn: ({ pageParam }) => listTasks({ data: { before: pageParam } }),
  getNextPageParam: (last) => last.length === 50 ? last[last.length - 1].id : undefined,
  refetchInterval: 15_000,
})

export const activityQuery = queryOptions({
  queryKey: keys.activity,
  queryFn: () => listActivity(),
  refetchInterval: 2_000,
})

/** Refresh list and detail markers after a successful acknowledgement. */
export const markReadMutation = (client: import('@tanstack/react-query').QueryClient) =>
  mutationOptions({
    mutationFn: (data: { id: number; through_message_id: number }) => markRead({ data }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.topics }),
  })

export const messagesAroundQuery = (id: number, around: number, limit = 30) =>
  queryOptions({
    queryKey: [...keys.messages(id), 'around', around, limit],
    queryFn: () => getMessagesAround({ data: { id, around, limit } }),
  })
export const taskCountsQuery = queryOptions({
  queryKey: ['tasks', 'counts'],
  queryFn: () => getTaskCounts(),
  refetchInterval: 15_000,
})
export const errorsTotalQuery = (q: string) => queryOptions({
  queryKey: [...keys.errors, 'total', q],
  queryFn: () => getErrorsTotal({ data: { q } }),
})
