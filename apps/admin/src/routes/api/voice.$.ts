import { createFileRoute } from '@tanstack/react-router'
import { requireSignIn } from '../../server/auth'
import { env } from '../../server/env'
export const Route = createFileRoute('/api/voice/$')({
  server: {
    handlers: {
      // Whether the server can hear and speak (OPENAI_API_KEY), asked once
      // by Companions so it can say so before you try.
      GET: async ({ params }) => {
        requireSignIn()
        if (params._splat !== 'status') return new Response('Not found', { status: 404 })
        const response = await fetch(`${env.coreUrl()}/admin/api/voice/status`, {
          headers: { authorization: `Bearer ${env.adminToken()}` },
        })
        return new Response(response.body, {
          status: response.status,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        })
      },
      POST: async ({ params, request }) => {
        requireSignIn()
        if (request.headers.get('origin') !== new URL(request.url).origin)
          return new Response('Invalid origin', { status: 403 })
        const action = params._splat
        if (action !== 'speak' && action !== 'transcribe')
          return new Response('Not found', { status: 404 })
        const body =
          action === 'transcribe'
            ? await request.formData()
            : await request.text()
        const response = await fetch(
          `${env.coreUrl()}/admin/api/voice/${action}`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${env.adminToken()}`,
              ...(action === 'speak'
                ? { 'content-type': 'application/json' }
                : {}),
            },
            body,
          },
        )
        return new Response(response.body, {
          status: response.status,
          headers: {
            'content-type':
              response.headers.get('content-type') ?? 'application/json',
            'cache-control': 'no-store',
          },
        })
      },
    },
  },
})
