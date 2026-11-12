import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { routeTree } from './routeTree.gen'
import { isSignedOut } from './session'
import { NotFound, PageError, PageSkeleton } from './ui'

export function getRouter() {
  // One client per request on the server, one for the tab in the browser.
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => signInAgainIfSignedOut(error) }),
    mutationCache: new MutationCache({ onError: (error) => signInAgainIfSignedOut(error) }),
    defaultOptions: {
      queries: {
        // Fresh enough to skip refetching when you bounce between pages.
        staleTime: 5_000,
        // Fail loud: an error shows straight away instead of after silent retries.
        retry: false,
        refetchOnWindowFocus: true,
      },
    },
  })

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // The topic page's conversation owns its scroll (pinned to the latest
    // message, or a search hit): restoring another page's offsets onto its
    // scroller sent topic 2 thousands of pixels up and undid search jumps.
    scrollRestoration: ({ location }) => !location.pathname.startsWith('/topics/'),
    // Hovering a link runs its loader, which warms the query cache.
    defaultPreload: 'intent',
    // Let TanStack Query decide freshness, not the router's own cache.
    defaultPreloadStaleTime: 0,
    // Quick pages show no skeleton; slow ones show it long enough to not flicker.
    defaultPendingMs: 250,
    defaultPendingMinMs: 300,
    defaultPendingComponent: PageSkeleton,
    defaultErrorComponent: PageError,
    defaultNotFoundComponent: NotFound,
  })

  function signInAgainIfSignedOut(error: unknown) {
    if (!isSignedOut(error)) return
    queryClient.clear()
    // The session is gone either way; an unsaved-changes prompt can't save anything now.
    void router.navigate({ to: '/login', ignoreBlocker: true })
  }

  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
  interface StaticDataRouteOption {
    /** This page's name in the header breadcrumb; a function gets the loader's data. */
    crumb?: string | ((loaderData: unknown) => string | undefined)
    /** A list page shown before this one, when it isn't a parent route. */
    crumbParent?: { label: string; to: '/topics' | '/logs' }
    /** 'page': the route renders its own panes (ShellPage, a chat, a split)
     * and scrolls itself. Otherwise the layout gives it a padded, scrolling
     * column (pages not yet rebuilt on the hb kit). */
    shell?: 'page'
  }
}
