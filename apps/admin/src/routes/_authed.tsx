import type { ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { LayoutGridIcon, LogOutIcon, MessagesSquareIcon, ScrollTextIcon } from 'lucide-react'
import { logout } from '../api'
import { sessionQuery } from '../queries'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context }) => {
    const { signedIn } = await context.queryClient.ensureQueryData(sessionQuery)
    if (!signedIn) throw redirect({ to: '/login' })
  },
  component: Layout,
})

const navLink =
  'flex h-9 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground no-underline ' +
  'transition-[color,background-color,box-shadow] duration-150 ease-out pointer-coarse:h-11 ' +
  'hover:bg-accent hover:text-accent-foreground ' +
  // Active changes colour and surface, never weight, so nothing shifts.
  'data-[status=active]:bg-card data-[status=active]:text-foreground data-[status=active]:shadow-xs data-[status=active]:ring-1 data-[status=active]:ring-border ' +
  // Phones show words only, so the four items fit without scrolling.
  '[&_svg]:hidden [&_svg]:size-4 [&_svg]:shrink-0 md:[&_svg]:block'

function NavItem({ to, icon, children, exact }: { to: '/' | '/topics' | '/logs'; icon: ReactNode; children: string; exact?: boolean }) {
  return (
    <Link to={to} activeOptions={{ exact }} className={navLink}>
      {icon}
      {children}
    </Link>
  )
}

function Layout() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const signOut = useMutation({
    mutationFn: () => logout(),
    onSuccess: async () => {
      queryClient.clear()
      await router.navigate({ to: '/login' })
    },
  })

  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr] md:grid-cols-[13.5rem_minmax(0,1fr)] md:grid-rows-1">
      <a
        href="#content"
        className="sr-only rounded-md bg-card px-3 py-2 shadow-md focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>
      <nav
        aria-label="Main"
        className="sticky top-0 z-10 flex items-center gap-1 overflow-x-auto border-b bg-background px-3 py-2 pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] md:h-dvh md:flex-col md:items-stretch md:overflow-visible md:border-r md:border-b-0 md:px-3 md:py-5"
      >
        <div className="mr-1 flex shrink-0 items-center gap-2.5 px-1 md:mr-0 md:mb-5 md:px-2.5">
          <img src="/favicon.svg" alt="" width={24} height={24} className="size-6 rounded-md" />
          <div className="leading-tight">
            <div className="sr-only text-sm font-semibold tracking-tight md:not-sr-only">Herbot</div>
            <div className="hidden text-xs text-muted-foreground md:block">admin</div>
          </div>
        </div>
        <NavItem to="/" exact icon={<LayoutGridIcon aria-hidden />}>
          Overview
        </NavItem>
        <NavItem to="/topics" icon={<MessagesSquareIcon aria-hidden />}>
          Topics
        </NavItem>
        <NavItem to="/logs" icon={<ScrollTextIcon aria-hidden />}>
          Logs
        </NavItem>
        <Button
          variant="ghost"
          className="ml-auto shrink-0 justify-start px-2.5 text-muted-foreground md:mt-auto md:ml-0 [&_svg]:hidden md:[&_svg]:block"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          <LogOutIcon aria-hidden />
          {signOut.isPending ? 'Signing out…' : 'Sign out'}
        </Button>
      </nav>
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-8 px-4 pt-6 pb-16 outline-none md:px-10 md:pt-9"
      >
        <Outlet />
      </main>
    </div>
  )
}
