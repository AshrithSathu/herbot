import { Fragment } from 'react'
import { Link, useMatches } from '@tanstack/react-router'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

/** Sidebar toggle plus where you are, built from each route's `staticData.crumb`. */
export function SiteHeader() {
  const crumbs = useMatches({
    select: (matches) =>
      matches.flatMap((m) => {
        const crumb = m.staticData.crumb
        const label = typeof crumb === 'function' ? crumb(m.loaderData) : crumb
        if (!label) return []
        const parent = m.staticData.crumbParent
        return [
          ...(parent ? [{ id: `${m.id}-parent`, label: parent.label, path: parent.to }] : []),
          { id: m.id, label, path: m.pathname },
        ]
      }),
  })

  return (
    <header className="sticky top-0 z-10 flex h-14 min-w-0 shrink-0 items-center gap-2 border-b bg-background pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] md:rounded-t-xl md:px-4">
      <SidebarTrigger className="size-9 text-muted-foreground" />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0">
        <BreadcrumbList>
          {crumbs.map((c, i) => (
            <Fragment key={c.id}>
              {i > 0 && <BreadcrumbSeparator className="hidden sm:flex" />}
              <BreadcrumbItem className={i < crumbs.length - 1 ? 'hidden sm:inline-flex' : undefined}>
                {i === crumbs.length - 1 ? (
                  <BreadcrumbPage dir="auto" className="user-text block max-w-[min(40ch,60vw)] truncate" title={c.label}>
                    {c.label.trim() || 'Untitled'}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild className="user-text block max-w-[20ch] truncate">
                    <Link to={c.path} dir="auto" title={c.label}>
                      {c.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  )
}
