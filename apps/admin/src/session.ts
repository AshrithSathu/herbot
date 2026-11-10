// Shared between the panel's server and the browser.

/** What a server function throws when the session cookie is gone or expired. */
export const SIGNED_OUT = 'Signed out. Sign in again.'

export function isSignedOut(error: unknown): boolean {
  return error instanceof Error && error.message === SIGNED_OUT
}
