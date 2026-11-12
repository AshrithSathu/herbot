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
  /** A list row: no context, message capped at 300 characters. */
  last_error: ErrorSummary | null
}

export interface Topic {
  id: number
  place: string
  /** The topic's own name: "General", "Topic 7" when unnamed. Prefer it to `place`. */
  name: string
  /** The group's title. */
  group: string
  is_general: boolean
  /** In the list, cut to 300 characters; whole in a topic's detail. */
  purpose: string | null
  setup_state: 'new' | 'awaiting_purpose' | 'ready'
  enabled: boolean
  voice_replies: boolean
  voice: string
  messages: number
  last_activity: string | null
  mode: string
  thread_link: string | null
  language: string
  private_mode: boolean
  /** Capped at 99. */
  unread: number
}

export interface TopicDetail {
  conversation: Topic
  agents_md_path: string | null
  agents_md: string | null
  thread_id: string | null
}

export interface Message {
  id: number
  sent_at: string
  from_bot: boolean
  is_voice: boolean
  body: string
  attachments: Attachment[]
}

/** Oldest first. `has_more`: another page exists in the direction asked. */
export interface MessagePage {
  messages: Message[]
  has_more: boolean
}

/** A row in the error list: no context, message capped at 300 characters. */
export type ErrorSummary = Omit<ErrorRow, 'context'>

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

/** UI state kept in cookies, read on the server so the first paint is right. */
export const getUiPrefs = createServerFn({ method: 'GET' }).handler(async () => {
  const { getCookie } = await import('@tanstack/react-start/server')
  // Written by shadcn's SidebarProvider when you collapse or expand it.
  return { sidebarOpen: getCookie('sidebar_state') !== 'false' }
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
    return core<Topic>(`/conversations/${data.id}/purpose`, {
      method: 'PUT',
      body: { purpose: data.purpose },
    })
  })

export const setEnabled = createServerFn({ method: 'POST' })
  .validator((data: { id: number; enabled: boolean }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide()
    return core<Topic>(`/conversations/${data.id}/enabled`, {
      method: 'PUT',
      body: { enabled: data.enabled },
    })
  })

export const wipeTopic = createServerFn({ method: 'POST' })
  .validator((data: { id: number; kind: 'new' | 'forget' }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide()
    return core<WipeResult>(`/conversations/${data.id}/wipe`, {
      method: 'POST',
      body: { kind: data.kind },
    })
  })

export const getMessages = createServerFn({ method: 'GET' })
  .validator((data: { id: number; before?: number | null; after?: number | null; limit?: number }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide()
    const params = new URLSearchParams()
    if (data.before != null) params.set('before', String(data.before))
    if (data.after != null) params.set('after', String(data.after))
    if (data.limit != null) params.set('limit', String(data.limit))
    const query = params.size ? `?${params}` : ''
    return core<MessagePage>(`/conversations/${data.id}/messages${query}`)
  })

/** Page size for the error list; a full page means there may be more. */
export const ERROR_PAGE = 50

export const searchErrors = createServerFn({ method: 'GET' })
  .validator((data: { q: string; before?: number | null }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide()
    const params = new URLSearchParams({ limit: String(ERROR_PAGE) })
    if (data.q) params.set('q', data.q)
    if (data.before != null) params.set('before', String(data.before))
    return core<ErrorSummary[]>(`/errors?${params}`)
  })

export const getError = createServerFn({ method: 'GET' })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const core = await serverSide()
    return core<ErrorRow>(`/errors/${encodeURIComponent(id)}`)
  })

export interface Memory {
  id: number
  content: string
  source_conversation_id: number | null
  created_at: string
  updated_at: string
}
export interface Preferences { custom_instructions: string; about_you: string }
export const listMemories = createServerFn({ method: 'GET' }).handler(async () => {
  const core = await serverSide()
  return core<Memory[]>('/memories')
})
export const saveMemory = createServerFn({ method: 'POST' })
  .validator((data: { id?: number; content: string }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide()
    return core<Memory>(data.id == null ? '/memories' : `/memories/${data.id}`, {
      method: data.id == null ? 'POST' : 'PUT', body: { content: data.content },
    })
  })
export const deleteMemory = createServerFn({ method: 'POST' })
  .validator((data: { id?: number }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide()
    return core<{ deleted: number }>(data.id == null ? '/memories' : `/memories/${data.id}`, { method: 'DELETE' })
  })
export const getPreferences = createServerFn({ method: 'GET' }).handler(async () => {
  const core = await serverSide()
  return core<Preferences>('/preferences')
})
export const savePreferences = createServerFn({ method: 'POST' })
  .validator((data: Preferences) => data)
  .handler(async ({ data }) => {
    const core = await serverSide()
    return core<Preferences>('/preferences', { method: 'PUT', body: data })
  })
export const saveVoice = createServerFn({ method: 'POST' })
  .validator((data: { id: number; voice_replies: boolean; voice: string }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide()
    return core<Topic>(`/conversations/${data.id}/voice`, {
      method: 'PUT', body: { voice_replies: data.voice_replies, voice: data.voice },
    })
  })
export interface Task {
  id: number; conversation_id: number; title: string | null; prompt: string;
  once_at: string | null; cron: string | null; timezone: string;
  next_run_at: string | null; last_run_at: string | null; run_count: number;
  status: 'active' | 'paused' | 'done' | 'cancelled'; last_error: string | null;
}
export interface TaskInput {
  conversation_id: number; prompt: string; title?: string;
  when?: string; cron?: string; timezone?: string;
}
export const listTasks = createServerFn({ method: 'GET' })
  .validator((data: { before?: number }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide(); return core<Task[]>(`/tasks${data.before ? `?before=${data.before}` : ''}`)
  })
export const createTask = createServerFn({ method: 'POST' })
  .validator((data: TaskInput) => data)
  .handler(async ({ data }) => {
    const core = await serverSide(); return core<Task>('/tasks', { method: 'POST', body: data })
  })
export const changeTask = createServerFn({ method: 'POST' })
  .validator((data: { id: number; action: 'pause' | 'resume' | 'cancel' | 'run' }) => data)
  .handler(async ({ data }) => {
    const core = await serverSide(); return core<Task>(`/tasks/${data.id}/${data.action}`, { method: 'POST' })
  })
export interface Attachment {
  kind: string
  path: string
  name: string
  mime: string | null
  size: number
}
export interface SearchHit {
  id: number
  conversation_id: number
  name: string
  snippet: string
}
export const getActivity = createServerFn({ method: 'GET' })
  .validator((id: number) => id)
  .handler(async ({ data }) => (await serverSide())<Activity>(`/conversations/${data}/activity`))
export const getFiles = createServerFn({ method: 'GET' })
  .validator((id: number) => id)
  .handler(async ({ data }) => (await serverSide())<Attachment[]>(`/conversations/${data}/files`))
export const saveMode = createServerFn({ method: 'POST' })
  .validator((data: { id: number; mode: string }) => data)
  .handler(async ({ data }) =>
    (await serverSide())<{ mode: string }>(`/conversations/${data.id}/mode`, {
      method: 'PUT',
      body: { mode: data.mode },
    }),
  )
export const createTopic = createServerFn({ method: 'POST' })
  .validator((data: { name: string; purpose: string; idempotencyKey: string }) => data)
  .handler(async ({ data }) =>
    (await serverSide())<{ id: number }>('/topics', {
      method: 'POST',
      idempotencyKey: data.idempotencyKey,
      body: data,
    }),
  )
export const searchMessages = createServerFn({ method: 'GET' })
  .validator((data: { q: string; before?: number }) => data)
  .handler(async ({ data }) =>
    (await serverSide())<SearchHit[]>(
      `/search?${new URLSearchParams({ q: data.q, ...(data.before ? { before: String(data.before) } : {}) })}`,
    ),
  )
export const getConnectors = createServerFn({ method: 'GET' }).handler(async () =>
  (await serverSide())<{
    servers: {
      name: string
      source: string
      command: string | null
      url: string | null
    }[]
    /** Herbot's own MCP tools and who may use them (hub::TOOLS). */
    tools: { name: string; scope: string }[]
  }>('/connectors'),
)
export const sendMessage = createServerFn({ method: 'POST' })
  .validator((data: FormData) => {
    if (!(data instanceof FormData)) throw new Error('Expected a message form')
    return data
  })
  .handler(async ({ data }) => {
    const { requireSignIn } = await import('./server/auth')
    requireSignIn()
    const { env } = await import('./server/env')
    const id = Number(data.get('id'))
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid topic')
    data.delete('id')
    const idempotencyKey = String(data.get('idempotencyKey') || '')
    data.delete('idempotencyKey')
    const response = await fetch(`${env.coreUrl()}/admin/api/conversations/${id}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.adminToken()}`, "idempotency-key": idempotencyKey },
      body: data,
    })
    const result = (await response.json()) as {
      error?: string
      message_id?: number
    }
    if (!response.ok) throw new Error(result.error ?? 'Message failed')
    return result
  })

export const companionReply = createServerFn({ method: 'POST' })
  .validator((data: { id: number; text: string; idempotencyKey: string }) => data)
  .handler(async ({ data }) => {
    const { requireSignIn } = await import('./server/auth')
    requireSignIn()
    const { env } = await import('./server/env')
    if (!Number.isSafeInteger(data.id) || data.id < 1) throw new Error('Invalid topic')
    const form = new FormData(); form.set('text', data.text)
    const response = await fetch(`${env.coreUrl()}/admin/api/conversations/${data.id}/messages?wait=true`, {
      method: 'POST', headers: { authorization: `Bearer ${env.adminToken()}`, 'idempotency-key': data.idempotencyKey }, body: form,
    })
    const result = await response.json() as { reply: string; error?: string }
    if (!response.ok) throw new Error(result.error ?? 'Conversation failed')
    return result.reply
  })

export interface Activity { in_progress: boolean }
export interface ConversationActivity extends Activity { conversation_id: number }
export interface ReadMarker { through_message_id: number }

export const listActivity = createServerFn({ method: 'GET' }).handler(async () =>
  (await serverSide())<ConversationActivity[]>('/activity'),
)

export const markRead = createServerFn({ method: 'POST' })
  .validator((data: { id: number; through_message_id: number }) => {
    if (!Number.isSafeInteger(data.id) || data.id < 1 ||
        !Number.isSafeInteger(data.through_message_id) || data.through_message_id < 1) {
      throw new Error('Invalid conversation or message ID')
    }
    return data
  })
  .handler(async ({ data }) =>
    (await serverSide())<ReadMarker>(`/conversations/${data.id}/read`, {
      method: 'POST', body: { through_message_id: data.through_message_id },
    }),
  )
