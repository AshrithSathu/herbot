// The router's fallbacks (loading, a page that failed, not found), on the
// redesign kit so they look like the rest of the panel.
import { useEffect } from 'react'
import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton, splitErrorId } from '@/components/hb/feedback'
import { plainReason } from '@/lib/reasons'
import { ShellPage } from '@/components/hb/shell'

/** Holds a page's shape while it loads. */
export function PageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pt-6 md:px-8 md:pt-8" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-3">
        <div className="h-9 w-48 rounded-md bg-sunken" />
        <div className="h-4 w-80 max-w-full rounded bg-sunken" />
      </div>
      <ListSkeleton rows={6} />
    </div>
  )
}

/** Fail loud: what broke, Retry first, and the E-id to look up in the logs. */
export function PageError({ error }: ErrorComponentProps) {
  const router = useRouter()
  const { reset } = useQueryErrorResetBoundary()
  useEffect(() => reset(), [reset])
  const message = error instanceof Error ? error.message : String(error)
  // Point at an E-id only when there is one to look up.
  const hasId = splitErrorId(message).id != null
  const known = plainReason(message)
  return (
    <ShellPage
      title="This page didn’t load"
      description={
        hasId
          ? 'If it keeps happening, look the E-id up in Logs or the herbot-core logs.'
          : (known?.sentence ?? 'If it keeps happening, check the herbot-core logs.')
      }
    >
      <InPlaceError title="What went wrong" error={error instanceof Error ? error : String(error)} onRetry={() => void router.invalidate()} />
    </ShellPage>
  )
}

export function NotFound() {
  return (
    <ShellPage title="Nothing here">
      <InPlaceEmpty
        title="That page doesn’t exist, or the topic was removed."
        action={
          <Button asChild variant="secondary">
            <Link to="/topics">See all topics</Link>
          </Button>
        }
      />
    </ShellPage>
  )
}
