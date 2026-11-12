// /logs/E-3999 (and /logs/3999): an error's address. Errors open in the
// Logs split view, selected; on phones that's the error on its own with a
// way back to the list. Kept as a route so every E-id link keeps working.
import { createFileRoute, redirect } from '@tanstack/react-router'
import { errorIdIn } from './index'

export const Route = createFileRoute('/_authed/logs/$id')({
  beforeLoad: ({ params }) => {
    const e = errorIdIn(params.id)
    throw redirect({ to: '/logs', search: e ? { e } : {}, replace: true })
  },
})
