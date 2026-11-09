import { createFileRoute } from '@tanstack/react-router'
import { requireSignIn } from '../../server/auth'
import { env } from '../../server/env'
export const Route = createFileRoute('/api/files/$')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        requireSignIn()
        const path = (params._splat ?? '').split('/').map(encodeURIComponent).join('/')
        const response = await fetch(`${env.coreUrl()}/admin/api/files/${path}`, {
          headers: {
            authorization: `Bearer ${env.adminToken()}`,
            ...(request.headers.has('range') ? { range: request.headers.get('range')! } : {}),
          },
        })
        const headers = new Headers()
        for (const key of [
          'content-type',
          'content-length',
          'content-disposition',
          'cache-control',
          'content-range',
          'accept-ranges',
          'content-security-policy',
          'x-content-type-options',
        ]) {
          const value = response.headers.get(key)
          if (value) headers.set(key, value)
        }
        return new Response(response.body, {
          status: response.status,
          headers,
        })
      },
    },
  },
})
