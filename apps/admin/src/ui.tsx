// The panel's own building blocks, composed from shadcn/ui parts.
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { CheckIcon, CircleAlertIcon, CopyIcon, SearchXIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Topic } from './api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ago, topicStatus, when } from './format'

/** Re-renders every `ms` once mounted, so relative times stay true. */
function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now()) // the server's clock and locale may differ from yours
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** A timestamp: relative ("3 min ago") or absolute, with the other on hover. */
export function Time({ iso, relative = false }: { iso: string | null; relative?: boolean }) {
  const now = useTick(30_000)
  if (!iso) return <span>never</span>
  return (
    <time dateTime={iso} title={relative ? when(iso) : ago(iso, now)} suppressHydrationWarning>
      {relative ? ago(iso, now) : when(iso)}
    </time>
  )
}

/** On/off plus setup state, as one badge. */
export function TopicState({ topic }: { topic: Pick<Topic, 'enabled' | 'setup_state' | 'purpose'> }) {
  const { label, tone } = topicStatus(topic)
  return <Badge variant={tone}>{label}</Badge>
}

export function PageHeader({ title, description, children, className }: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-col gap-1.5', className)}>
      <h1 className="text-2xl leading-tight font-semibold tracking-tight wrap-anywhere">{title}</h1>
      {description && <p className="max-w-[65ch] text-muted-foreground wrap-anywhere">{description}</p>}
      {children}
    </header>
  )
}

export function Section({ id, title, action, children, className }: {
  id: string
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-3', className)}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

/** shadcn Empty: says why it's empty and what to do next. */
export function EmptyState({ icon: Icon, title, children, action, className, page = false }: {
  icon?: ComponentType<{ className?: string }>
  title: string
  /** The whole page is this state, so its title is the page's h1. */
  page?: boolean
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <Empty className={cn('border border-dashed p-6 md:p-8', className)}>
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon">
            <Icon aria-hidden />
          </EmptyMedia>
        )}
        <EmptyTitle>{page ? <h1>{title}</h1> : title}</EmptyTitle>
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}

/** Fail loud, next to whatever failed. */
export function ErrorNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="wrap-anywhere">{children}</AlertDescription>
    </Alert>
  )
}

/** A background refresh failed; the last good data stays on screen. */
export function StaleWarning({ error }: { error: Error | null }) {
  if (!error) return null
  return <ErrorNote title="Couldn’t refresh">{error.message} Showing the last data I had.</ErrorNote>
}

/** A short confirmation that stays up long enough to read. */
export function notify(message: string) {
  const words = message.trim().split(/\s+/).length
  toast.success(message, { duration: Math.min(10_000, Math.max(3_000, words * 300)) })
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copy, setCopy] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="min-h-11 min-w-11 text-muted-foreground"
      disabled={copy === 'copying'}
      onClick={async () => {
        clearTimeout(timer.current)
        setCopy('copying')
        try {
          await navigator.clipboard.writeText(text)
          setCopy('copied')
          timer.current = setTimeout(() => setCopy('idle'), 1500)
        } catch {
          setCopy('failed')
        }
      }}
    >
      {copy === 'copied' ? <CheckIcon className="text-success" aria-hidden /> : <CopyIcon aria-hidden />}
      <span aria-live="polite">{copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Copy failed. Retry' : label}</span>
    </Button>
  )
}

/** Holds the page's shape while a slow page loads. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  )
}

/** Fail loud: say what broke, offer a retry, point at the logs. */
export function PageError({ error }: ErrorComponentProps) {
  const router = useRouter()
  const { reset } = useQueryErrorResetBoundary()
  useEffect(() => reset(), [reset])
  const message = error instanceof Error ? error.message : String(error)
  return (
    <EmptyState
      page
      icon={TriangleAlertIcon}
      title="This page didn’t load"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => void router.invalidate()}>Try again</Button>
          <Button variant="ghost" asChild>
            <Link to="/">Go to overview</Link>
          </Button>
        </div>
      }
    >
      <span className="text-destructive">{message}</span>. If it keeps happening, check the herbot-core logs.
    </EmptyState>
  )
}

export function NotFound() {
  return (
    <EmptyState
      page
      icon={SearchXIcon}
      title="Nothing here"
      action={
        <Button asChild>
          <Link to="/topics">See all topics</Link>
        </Button>
      }
    >
      That page doesn’t exist, or the topic was removed.
    </EmptyState>
  )
}
