// Sends that failed in a topic, kept per topic so switching agents or
// reloading never loses them (the composer keeps drafts the same way). Text,
// mode and errors go to sessionStorage (this tab, this session); File objects
// can't be serialised, so they stay in memory for the session and a reload
// keeps only their names.
import type { Mode } from '@/components/hb/composer'

export type FailedSend = {
  key: string
  text: string
  mode: Mode
  at: string
  error: string
  /** Names of the attached files, so a reload can say what to re-attach. */
  fileNames: string[]
}

const failedKey = (topic: number) => `herbot.failed.${topic}`

/** Files for failed sends, by send key (in memory only). */
const failedFiles = new Map<string, File[]>()

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null // storage blocked or corrupt: start empty
  }
}

function write(key: string, value: unknown | null) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the draft lives only as long as the page.
  }
}

export function loadFailed(topic: number): FailedSend[] {
  const list = read<FailedSend[]>(failedKey(topic))
  return Array.isArray(list) ? list : []
}

export function saveFailed(topic: number, list: FailedSend[]) {
  write(failedKey(topic), list.length ? list : null)
  const keep = new Set(list.map((f) => f.key))
  for (const key of failedFiles.keys()) if (!keep.has(key) && key.startsWith(`${topic}:`)) failedFiles.delete(key)
}

export function rememberFiles(key: string, files: File[]) {
  if (files.length) failedFiles.set(key, files)
}

/** The files a failed send carried, if this session still has them. */
export function filesFor(key: string): File[] {
  return failedFiles.get(key) ?? []
}
