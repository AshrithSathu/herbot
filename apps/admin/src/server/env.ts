// Server-only settings. Read lazily so a missing value fails loudly on use.

function required(name: string, minLength = 1): string {
  const value = process.env[name]?.trim()
  if (!value || value.length < minLength) {
    throw new Error(
      `${name} is not set${minLength > 1 ? ` (needs at least ${minLength} characters)` : ''}. Add it to the repo's .env.`,
    )
  }
  return value
}

export const env = {
  coreUrl: () => (process.env.HERBOT_CORE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, ''),
  adminToken: () => required('HERBOT_ADMIN_TOKEN', 32),
  password: () => required('HERBOT_ADMIN_PASSWORD', 12),
  sessionSecret: () => required('HERBOT_SESSION_SECRET', 32),
}
