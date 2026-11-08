import { useSuspenseQuery } from '@tanstack/react-query'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { sessionQuery, topicsQuery, uiPrefsQuery } from '../queries'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context }) => {
    const { signedIn } = await context.queryClient.ensureQueryData(sessionQuery)
    if (!signedIn) throw redirect({ to: '/login' })
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(uiPrefsQuery),
      // The sidebar lists agents; warm it, but a failure here is the page's to report.
      context.queryClient.prefetchQuery(topicsQuery),
    ])
  },
  component: Layout,
})

function Layout() {
  const { data: prefs } = useSuspenseQuery(uiPrefsQuery)
  return (
    <SidebarProvider defaultOpen={prefs.sidebarOpen}>
      <a
        href="#content"
        className="sr-only rounded-md bg-card px-3 py-2 shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>
      <AppSidebar />
      <SidebarInset id="content" tabIndex={-1} className="min-w-0 outline-none">
        <SiteHeader />
        <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-8 px-4 pt-6 pb-16 md:px-8 md:pt-8">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
