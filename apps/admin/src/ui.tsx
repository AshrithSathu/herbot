// The router's fallbacks (loading, a page that failed, not found), on the
// redesign kit so they look like the rest of the panel.
import { useEffect } from 'react'
import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'

/** Holds a page's shape while it loads. */
export function PageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 md:px-8" aria-busy="true" aria-label="Loading">
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
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-8 md:px-8">
      <InPlaceError
        title="This page didn’t load"
        error={error instanceof Error ? error : String(error)}
        onRetry={() => void router.invalidate()}
      />
    </div>
  )
}

export function NotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-8 md:px-8">
      <InPlaceEmpty
        title="Nothing here"
        action={
          <Button asChild variant="secondary">
            <Link to="/topics">See all topics</Link>
          </Button>
        }
      >
        That page doesn’t exist, or the topic was removed.
      </InPlaceEmpty>
    </div>
  )
}
