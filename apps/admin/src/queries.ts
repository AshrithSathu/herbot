// Every read the panel makes, as TanStack Query options. Loaders call
// `ensureQueryData` with these (so pages render on the server and links
// prefetch on hover); components read the same keys with `useSuspenseQuery`,
// so a page never fetches the same thing twice and mutations update in place.
import { queryOptions } from '@tanstack/react-query'
import { getError, getOverview, getTopic, getUiPrefs, listTopics, searchErrors, whoami } from './api'

export const keys = {
  session: ['session'] as const,
  uiPrefs: ['ui-prefs'] as const,
  overview: ['overview'] as const,
  /** Prefix of the list and every topic detail, so one invalidate hits all. */
  topics: ['topics'] as const,
  topicList: ['topics', 'list'] as const,
  topic: (id: number) => ['topics', 'detail', id] as const,
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
    // New messages show up while you watch.
    refetchInterval: 10_000,
  })

export const errorSearchQuery = (q: string) =>
  queryOptions({
    queryKey: keys.errorSearch(q),
    queryFn: () => searchErrors({ data: q }),
  })

export const errorQuery = (id: string) =>
  queryOptions({
    queryKey: keys.error(id),
    queryFn: () => getError({ data: id }),
    // An error never changes once recorded.
    staleTime: Infinity,
  })
