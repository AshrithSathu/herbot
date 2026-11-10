// Talks to herbot-core's admin API. Runs only on the panel's server; the
// admin token never reaches the browser.
import { env } from './env'

export class CoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function core<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${env.coreUrl()}/admin/api${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${env.adminToken()}`,
        ...(init.idempotencyKey ? { "idempotency-key": init.idempotencyKey } : {}),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new CoreError(`Can't reach herbot-core at ${env.coreUrl()}. Is it running?`, 502)
  }
  const data = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) {
    throw new CoreError(data?.error ?? `herbot-core answered ${response.status}`, response.status)
  }
  return data as T
}
