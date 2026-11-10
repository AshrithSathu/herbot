import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useMatchRoute, useRouter } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  AlarmClockIcon,
  BrainIcon,
  HashIcon,
  LayoutGridIcon,
  LogOutIcon,
  MessageCircleIcon,
  MessagesSquareIcon,
  PlugIcon,
  ScrollTextIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react'
import { logout, type Topic } from '../api'
import { ErrorNote } from '../ui'
import { topicStatus, type TopicStatus } from '../format'
import { topicsQuery } from '../queries'
import { UserText } from './user-text'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

type Page = { to: string; label: string; icon: typeof LayoutGridIcon; exact: boolean }

// Three short groups instead of one list of nine: what you look at, what
// shapes every agent, and the system underneath.
const NAV: { label: string; pages: Page[] }[] = [
  {
    label: 'Workspace',
    pages: [
      { to: '/', label: 'Overview', icon: LayoutGridIcon, exact: true },
      { to: '/topics', label: 'Topics', icon: MessagesSquareIcon, exact: true },
      { to: '/search', label: 'Search', icon: SearchIcon, exact: true },
      { to: '/tasks', label: 'Tasks', icon: AlarmClockIcon, exact: true },
    ],
  },
  {
    label: 'Shared',
    pages: [
      { to: '/memory', label: 'Memory', icon: BrainIcon, exact: true },
      { to: '/personalize', label: 'Personalize', icon: SlidersHorizontalIcon, exact: true },
      { to: '/companions', label: 'Companions', icon: SparklesIcon, exact: true },
      { to: '/connectors', label: 'Connectors', icon: PlugIcon, exact: true },
    ],
  },
  {
    label: 'System',
    pages: [{ to: '/logs', label: 'Logs', icon: ScrollTextIcon, exact: false }],
  },
]

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

      {/* The page links never scroll away; only the agent list scrolls. */}
      <SidebarContent className="flex-none overflow-visible">
        <nav aria-label="Main">
          {NAV.map((group) => (
            <SidebarGroup key={group.label} className="py-1">
              <SidebarGroupLabel className="h-6">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.pages.map((page) => (
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
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>

      <AgentList onPick={picked} />

      <SidebarFooter>
        <SignOut />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** Folds case and accents, so "cafe" finds "Café" and "RESEARCH" finds "Research". */
function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

/** Show a filter once the list is long enough to need one. */
const FILTER_FROM = 8

/** Every agent, from the same cache the Topics page uses. Virtualized: a
 * group with hundreds of topics renders only the rows in view. */
function AgentList({ onPick }: { onPick: () => void }) {
  const pathname = useLocation({ select: (l) => l.pathname })
  const topics = useQuery(topicsQuery)
  const [filter, setFilter] = useState('')
  const deferred = useDeferredValue(filter)
  const all = topics.data ?? []
  const shown = useMemo(() => {
    const wanted = fold(deferred.trim())
    return wanted ? all.filter((t) => fold(t.name).includes(wanted)) : all
  }, [all, deferred])

  const scroller = useRef<HTMLDivElement>(null)
  const rows = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scroller.current,
    // 32px rows, 44px on touch screens (see sidebarMenuButtonVariants).
    estimateSize: () => (typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 48 : 36),
    overscan: 8,
    initialRect: { width: 240, height: 600 },
  })

  return (
    <SidebarGroup className="min-h-0 flex-1 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel className="h-6 justify-between">
        <span>Agents</span>
        {all.length > 0 && <span className="tabular-nums">{all.length.toLocaleString('en-GB')}</span>}
      </SidebarGroupLabel>
      {all.length >= FILTER_FROM && (
        <div className="relative px-2 pt-1 pb-2">
          <label htmlFor="agent-filter" className="sr-only">
            Filter agents
          </label>
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-[calc(50%-2px)] text-muted-foreground" />
          <input
            id="agent-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            placeholder="Filter agents"
            autoComplete="off"
            spellCheck={false}
            className="h-8 w-full rounded-md border border-sidebar-border bg-background pr-8 pl-7 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
              aria-label="Clear filter"
              className="absolute top-1/2 right-3 grid size-6 -translate-y-[calc(50%-2px)] place-items-center rounded text-muted-foreground before:absolute before:-inset-2 hover:text-foreground"
            >
              <XIcon className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}
      <div ref={scroller} className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {topics.isPending ? (
          <SidebarMenu>
            {[0, 1, 2, 3].map((i) => (
              <SidebarMenuItem key={i}>
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        ) : topics.isError ? (
          <p className="px-2 text-xs text-destructive">Couldn’t load agents. {topics.error.message}</p>
        ) : shown.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {all.length === 0 ? 'No agents yet.' : 'No agent matches that name.'}
          </p>
        ) : (
          <ul className="relative w-full" style={{ height: rows.getTotalSize() }}>
            {rows.getVirtualItems().map((row) => {
              const t = shown[row.index]
              return (
                <li
                  key={t.id}
                  data-index={row.index}
                  ref={rows.measureElement}
                  className="absolute inset-x-0 top-0 pb-1"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <AgentLink topic={t} active={pathname === `/topics/${t.id}`} onPick={onPick} />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </SidebarGroup>
  )
}

const DOT: Record<TopicStatus['tone'], string> = {
  danger: 'bg-destructive',
  success: 'bg-success',
  warning: 'bg-warning',
  muted: 'bg-muted-foreground/60',
}

function AgentLink({ topic, active, onPick }: { topic: Topic; active: boolean; onPick: () => void }) {
  const status = topicStatus(topic)
  const Icon = topic.is_general ? MessageCircleIcon : HashIcon
  return (
    <SidebarMenuButton asChild isActive={active}>
      <Link to="/topics/$id" params={{ id: topic.id }} onClick={onPick}>
        <Icon aria-hidden />
        <UserText className={cn('min-w-0 flex-1', !topic.enabled && 'text-muted-foreground')}>{topic.name}</UserText>
        <span className={cn('size-1.5 shrink-0 rounded-full', DOT[status.tone])} title={status.label} aria-hidden />
        <span className="sr-only"> ({status.label})</span>
      </Link>
    </SidebarMenuButton>
  )
}

function SignOut() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const signOut = useMutation({
    mutationFn: () => logout(),
    onSuccess: async () => {
      queryClient.clear()
      await router.navigate({ to: '/login', ignoreBlocker: true })
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
      {signOut.isError && <ErrorNote title="Couldn’t sign out">{signOut.error.message} Try again.</ErrorNote>}
    </SidebarMenu>
  )
}
