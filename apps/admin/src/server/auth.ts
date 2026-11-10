// A tiny signed-cookie session: "<expires-at>.<hmac>". No state on the
// server; changing HERBOT_SESSION_SECRET signs everyone out.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { deleteCookie, getCookie, getRequestProtocol, setCookie } from '@tanstack/react-start/server'
import { SIGNED_OUT } from '../session'
import { env } from './env'

const COOKIE = 'herbot_admin'
const LIFETIME_SECONDS = 7 * 24 * 60 * 60

function sign(expiresAt: number): string {
  return createHmac('sha256', env.sessionSecret()).update(`herbot-admin:${expiresAt}`).digest('base64url')
}

function sameText(a: string, b: string): boolean {
  // Hash first so lengths always match for timingSafeEqual.
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function sessionValue(nowSeconds: number): string {
  const expiresAt = nowSeconds + LIFETIME_SECONDS
  return `${expiresAt}.${sign(expiresAt)}`
}

export function isValidSession(value: string | undefined, nowSeconds: number): boolean {
  if (!value) return false
  const [raw, signature] = value.split('.')
  const expiresAt = Number(raw)
  if (!Number.isInteger(expiresAt) || !signature || expiresAt < nowSeconds) return false
  return sameText(signature, sign(expiresAt))
}

export function isSignedIn(): boolean {
  return isValidSession(getCookie(COOKIE), Math.floor(Date.now() / 1000))
}

export function requireSignIn(): void {
  if (!isSignedIn()) throw new Error(SIGNED_OUT)
}

export function passwordMatches(given: string): boolean {
  return sameText(given, env.password())
}

export function signIn(): void {
  setCookie(COOKIE, sessionValue(Math.floor(Date.now() / 1000)), {
    httpOnly: true,
    sameSite: 'strict',
    secure: getRequestProtocol() === 'https',
    path: '/',
    maxAge: LIFETIME_SECONDS,
  })
}

export function signOut(): void {
  deleteCookie(COOKIE, { path: '/' })
}
