// The panel's pages, in rail order and groups (docs/design/DECISIONS.md,
// "Navigation"). One list for the rail, the phone tab bar and ⌘K.
import { AlarmClockIcon, BrainIcon, LayoutGridIcon, MessagesSquareIcon, PlugIcon, ScrollTextIcon, SearchIcon, SlidersHorizontalIcon, SparklesIcon, type LucideIcon } from 'lucide-react'

export type PagePath = '/' | '/topics' | '/search' | '/tasks' | '/memory' | '/personalize' | '/companions' | '/connectors' | '/logs'

export type Page = { to: PagePath; label: string; icon: LucideIcon; group: 'Workspace' | 'Shared' | 'System'; exact: boolean }

export const PAGES: Page[] = [
  { to: '/', label: 'Overview', icon: LayoutGridIcon, group: 'Workspace', exact: true },
  { to: '/topics', label: 'Topics', icon: MessagesSquareIcon, group: 'Workspace', exact: true },
  { to: '/search', label: 'Search', icon: SearchIcon, group: 'Workspace', exact: true },
  { to: '/tasks', label: 'Tasks', icon: AlarmClockIcon, group: 'Workspace', exact: true },
  { to: '/memory', label: 'Memory', icon: BrainIcon, group: 'Shared', exact: true },
  { to: '/personalize', label: 'Personalize', icon: SlidersHorizontalIcon, group: 'Shared', exact: true },
  { to: '/companions', label: 'Companions', icon: SparklesIcon, group: 'Shared', exact: true },
  { to: '/connectors', label: 'Connectors', icon: PlugIcon, group: 'Shared', exact: true },
  { to: '/logs', label: 'Logs', icon: ScrollTextIcon, group: 'System', exact: false },
]

/** Phone tab bar after "Agents": the most used pages; the rest are under More. */
export const PHONE_TABS: PagePath[] = ['/', '/search', '/tasks']
