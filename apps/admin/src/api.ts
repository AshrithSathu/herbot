// Server functions: the only way the browser reaches data. Each checks the
// signed-in cookie, then calls herbot-core with the admin token.
import { createServerFn } from '@tanstack/react-start'

/** Plain JSON, so server functions can serialize it. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface ErrorRow {
  error_id: string
  id: number
  kind: string
  message: string
  context: { [key: string]: Json }
  created_at: string
}

export interface Overview {
  bot: string | null
  agent: string
  conversations: number
  enabled_conversations: number
  messages: number
  active_threads: number
  errors_last_24h: number
  last_error: ErrorRow | null
}

export interface Topic {
  id: number
  place: string
  is_general: boolean
  purpose: string | null
  setup_state: 'new' | 'awaiting_purpose' | 'ready'
  enabled: boolean
  messages: number
  last_activity: string | null
  thread_link: string | null
}

export interface TopicDetail {
  conversation: Topic
  agents_md_path: string | null
  agents_md: string | null
  thread_id: string | null
  recent_messages: { sent_at: string; from_bot: boolean; is_voice: boolean; body: string }[]
}

export interface WipeResult {
  threads: number
  messages: number
  message: string
}

async function serverSide() {
  const auth = await import('./server/auth')
  const { core } = await import('./server/core')
  auth.requireSignIn()
  return core
}

export const whoami = createServerFn({ method: 'GET' }).handler(async () => {
  const { isSignedIn } = await import('./server/auth')
  return { signedIn: isSignedIn() }
})

export const login = createServerFn({ method: 'POST' })
  .validator((data: { password: string }) => {
    if (typeof data?.password !== 'string') throw new Error('Enter the password')
    return data
  })
  .handler(async ({ data }) => {
    const auth = await import('./server/auth')
    if (!auth.passwordMatches(data.password)) {
      await new Promise((r) => setTimeout(r, 800)) // slow down guessing
      return { ok: false as const, error: 'Wrong password.' }
    }
    auth.signIn()
    return { ok: true as const }
  })

export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  const { signOut } = await import('./server/auth')
  signOut()
  return { ok: true }
})

export const getOverview = createServerFn({ method: 'GET' }).handler(async () => {
  const core = await serverSide()
  return core<Overview>('/overview')
})

export const listTopics = createServerFn({ method: 'GET' }).handler(async () => {
  const core = await serverSide()
  return core<Topic[]>('/conversations')
})

export const getTopic = createServerFn({ method: 'GET' })
  .validator((id: number) => id)
  .handler(async ({ data: id }) => {
    const core = await serverSide()
    return core<TopicDetail>(`/conversations/${id}`)
  })

export const savePurpose = createServerFn({ method: 'POST' })
  .validator((data: { id: number; purpose: string }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide()
    return core<Topic>(`/conversations/${data.id}/purpose`, { method: 'PUT', body: { purpose: data.purpose } })
  })

export const setEnabled = createServerFn({ method: 'POST' })
  .validator((data: { id: number; enabled: boolean }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide()
    return core<Topic>(`/conversations/${data.id}/enabled`, { method: 'PUT', body: { enabled: data.enabled } })
  })

export const wipeTopic = createServerFn({ method: 'POST' })
  .validator((data: { id: number; kind: 'new' | 'forget' }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide()
    return core<WipeResult>(`/conversations/${data.id}/wipe`, { method: 'POST', body: { kind: data.kind } })
  })

export const searchErrors = createServerFn({ method: 'GET' })
  .validator((q: string) => q)
  .handler(async ({ data: q }) => {
    const core = await serverSide()
    return core<ErrorRow[]>(`/errors${q ? `?q=${encodeURIComponent(q)}` : ''}`)
  })

export const getError = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const core = await serverSide()
    return core<ErrorRow>(`/errors/${encodeURIComponent(id)}`)
  })
