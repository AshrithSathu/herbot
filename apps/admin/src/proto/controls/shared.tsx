// Shared form model for the control-kit prototype (throwaway). Real topic
// data, the server's real rules; saving is simulated so every state shows.
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { charCount, PURPOSE_MAX, purposeProblem } from '../../format'
import { topicQuery } from '../../queries'
import '../tokens.css'

/** HTML-looking name, 8,000-character purpose, 9.9M messages. */
export const TOPIC = 5
export const NAME_MAX = 128

/** The five per-message modes, as a standing default for panel messages. */
export const MODES = [
  ['auto', 'Auto', 'Thinks as hard as the question needs'],
  ['fast', 'Fast', 'Quick answers, light reasoning'],
  ['think', 'Think', 'Thinks carefully before answering'],
  ['heavy', 'Heavy', 'Several sub-agents, best answer wins'],
  ['deepsearch', 'DeepSearch', 'Researches the web, with sources'],
] as const

export const VOICES = [
  ['alloy', 'Balanced'], ['ash', 'Grounded'], ['ballad', 'Expressive'], ['coral', 'Warm'],
  ['echo', 'Clear'], ['fable', 'Storytelling'], ['onyx', 'Deep'], ['nova', 'Bright'],
  ['sage', 'Calm'], ['shimmer', 'Gentle'], ['verse', 'Versatile'], ['marin', 'Conversational'], ['cedar', 'Steady'],
] as const

export type Values = { name: string; purpose: string; mode: string; voiceReplies: boolean; voice: string }
type Field = 'name' | 'purpose'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const TOKENISH = /\b(sk-[A-Za-z0-9]{8,}|\d{8,10}:AA[\w-]{20,})/

function problems(v: Values): Partial<Record<Field, string>> {
  const out: Partial<Record<Field, string>> = {}
  const name = v.name.trim()
  if (!name) out.name = 'Give the topic a name.'
  else if (charCount(name) > NAME_MAX) out.name = `Telegram allows ${NAME_MAX} characters; this is ${charCount(name)}.`
  const p = purposeProblem(v.purpose)
  if (p) out.purpose = p
  return out
}

/** Validate late, reward early: a field shows its problem after blur or a
 * submit attempt, then clears the moment it's fixed. */
export function useSettingsForm() {
  const detail = useQuery({ ...topicQuery(TOPIC), refetchInterval: false })
  const t = detail.data?.conversation
  const [saved, setSaved] = useState<Values | null>(null)
  const [values, setValues] = useState<Values | null>(null)
  const [shown, setShown] = useState<Set<Field>>(new Set())
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const firstInvalid = useRef<Field | null>(null)

  useEffect(() => {
    if (t && !saved) {
      const v = { name: t.name, purpose: t.purpose ?? '', mode: 'auto', voiceReplies: t.voice_replies, voice: t.voice }
      setSaved(v)
      setValues(v)
    }
  }, [t, saved])

  useEffect(() => {
    if (status !== 'saved') return
    const id = setTimeout(() => setStatus('idle'), 1600)
    return () => clearTimeout(id)
  }, [status])

  const all = values ? problems(values) : {}
  const errors: Partial<Record<Field, string>> = {}
  for (const f of shown) if (all[f]) errors[f] = all[f]
  const dirty = Boolean(values && saved && (Object.keys(values) as (keyof Values)[]).some((k) => values[k] !== saved[k]))

  function set<K extends keyof Values>(k: K, v: Values[K]) {
    setValues((x) => (x ? { ...x, [k]: v } : x))
    if (status === 'failed') setStatus('idle')
  }

  async function submit(): Promise<Field | null> {
    if (!values) return null
    const p = problems(values)
    const bad = (['name', 'purpose'] as Field[]).filter((f) => p[f])
    if (bad.length) {
      setShown(new Set([...shown, ...bad]))
      firstInvalid.current = bad[0]
      return bad[0]
    }
    setStatus('saving')
    setError(null)
    await wait(900)
    if (TOKENISH.test(values.purpose)) {
      setStatus('failed')
      setError('E-4107: secrets and token-like strings can’t be stored. Remove it and save again.')
      return null
    }
    setSaved(values)
    setStatus('saved')
    return null
  }

  return {
    ready: Boolean(values),
    loadError: detail.error,
    messages: t?.messages ?? 0,
    values: values ?? { name: '', purpose: '', mode: 'auto', voiceReplies: false, voice: 'marin' },
    set,
    errors,
    blur: (f: Field) => setShown((s) => new Set([...s, f])),
    dirty,
    discard: () => {
      if (saved) setValues(saved)
      setShown(new Set())
      setStatus('idle')
      setError(null)
    },
    submit,
    status,
    error,
    nameCount: charCount(values?.name.trim() ?? ''),
    purposeCount: charCount(values?.purpose.trim() ?? ''),
    PURPOSE_MAX,
  }
}

export type Form = ReturnType<typeof useSettingsForm>

/** Copy with a check for 1.5 s; reports failure instead of pretending. */
export function useCopy() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const id = setTimeout(() => setState('idle'), 1500)
    return () => clearTimeout(id)
  }, [state])
  return {
    state,
    copy: (text: string) =>
      navigator.clipboard.writeText(text).then(
        () => setState('copied'),
        () => setState('failed'),
      ),
  }
}

/** A pending-capable action for the toolbar ("Preview voice"). */
export function usePreview() {
  const [state, setState] = useState<'idle' | 'playing'>('idle')
  return {
    state,
    play: async () => {
      setState('playing')
      await wait(1400)
      setState('idle')
    },
  }
}

/** ⌘ on Apple platforms, Ctrl elsewhere — read after mount so the server
 * render and the first client render agree. */
export function useModKey() {
  const [key, setKey] = useState('Ctrl')
  useEffect(() => setKey(/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'), [])
  return key
}
