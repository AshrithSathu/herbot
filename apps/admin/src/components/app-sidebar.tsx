import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useMatchRoute, useRouter } from '@tanstack/react-router'
import { HashIcon, LayoutGridIcon, LogOutIcon, MessageCircleIcon, MessagesSquareIcon, ScrollTextIcon } from 'lucide-react'
import { logout, type Topic } from '../api'
import { topicsQuery } from '../queries'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

const PAGES = [
  { to: '/', label: 'Overview', icon: LayoutGridIcon, exact: true },
  { to: '/topics', label: 'Topics', icon: MessagesSquareIcon, exact: true },
  { to: '/logs', label: 'Logs', icon: ScrollTextIcon, exact: false },
] as const

/** "Herbot HQ › Research" → "Research". */
function shortName(place: string): string {
  return place.split('›').pop()?.trim() || place
}

export function AppSidebar() {
  const matchRoute = useMatchRoute()
  const { isMobile, setOpenMobile } = useSidebar()
  // On a phone the sidebar is a sheet: close it once you've picked a page.
  const picked = () => isMobile && setOpenMobile(false)

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/" onClick={picked}>
                <img src="/favicon.svg" alt="" width={32} height={32} className="size-8 shrink-0 rounded-lg" />
                <span className="grid flex-1 leading-tight">
                  <span className="truncate font-semibold tracking-tight">Herbot</span>
                  <span className="truncate text-xs text-muted-foreground">admin</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Main">
            <SidebarMenu>
              {PAGES.map((page) => (
                <SidebarMenuItem key={page.to}>
                  <SidebarMenuButton
                    asChild
                    tooltip={page.label}
                    isActive={Boolean(matchRoute({ to: page.to, fuzzy: !page.exact }))}
                  >
                    <Link to={page.to} onClick={picked}>
                      <page.icon aria-hidden />
                      <span>{page.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
        <TopicLinks onPick={picked} />
      </SidebarContent>

      <SidebarFooter>
        <SignOut />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** Every agent, straight from the same cache the Topics page uses. */
function TopicLinks({ onPick }: { onPick: () => void }) {
  const pathname = useLocation({ select: (l) => l.pathname })
  const topics = useQuery(topicsQuery)
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Agents</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {topics.isPending
            ? [0, 1, 2].map((i) => (
                <SidebarMenuItem key={i}>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              ))
            : (topics.data ?? []).map((t) => (
                <SidebarMenuItem key={t.id}>
                  <SidebarMenuButton asChild isActive={pathname === `/topics/${t.id}`}>
                    <Link to="/topics/$id" params={{ id: t.id }} onClick={onPick}>
                      {t.is_general ? <MessageCircleIcon aria-hidden /> : <HashIcon aria-hidden />}
                      <span className={cn(!t.enabled && 'text-muted-foreground line-through decoration-1')}>
                        {shortName(t.place)}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                  <TopicDot topic={t} />
                </SidebarMenuItem>
              ))}
          {topics.isError && (
            <p className="px-2 text-xs text-destructive">Couldn’t load agents: {topics.error.message}</p>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** Status as a dot, with its meaning for screen readers and on hover. */
function TopicDot({ topic }: { topic: Topic }) {
  const [label, color] = !topic.enabled
    ? ['off', 'bg-destructive']
    : topic.setup_state === 'ready'
      ? ['ready', 'bg-success']
      : ['asking its purpose', 'bg-warning']
  return (
    <SidebarMenuBadge title={label}>
      <span className={cn('size-1.5 rounded-full', color)} aria-hidden />
      <span className="sr-only">{label}</span>
    </SidebarMenuBadge>
  )
}

function SignOut() {
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
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip="Sign out" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          <LogOutIcon aria-hidden />
          <span>{signOut.isPending ? 'Signing out…' : 'Sign out'}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
