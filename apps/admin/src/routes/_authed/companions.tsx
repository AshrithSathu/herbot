import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useReducer, useRef, useState } from 'react'
import { ArrowLeftIcon, MicIcon, MicOffIcon, SendIcon, SquareIcon, Volume2Icon, VolumeXIcon } from 'lucide-react'
import { companionReply, createTopic, listTopics, getMessages } from '../../api'
import { COMPANIONS, CompanionAvatar, type Companion, type VoicePhase } from '../../components/companion-avatar'
import { RichMessage } from '../../components/rich-message'
import { PageHeader } from '../../ui'
import { Button } from '../../components/ui/button'
import { Spinner } from '../../components/ui/spinner'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/companions')({
  staticData: { crumb: 'Companions' },
  head: () => ({ meta: [{ title: 'Companions · Herbot admin' }] }),
  component: Companions,
})

type Exchange = { role: 'you' | 'companion'; text: string }
type Session = { id: number; fallback: boolean }
type Connection = { status: 'opening' } | { status: 'ready'; session: Session } | { status: 'failed' }
function transitionConnection(state: Connection, next: Connection): Connection {
  if (next.status === 'opening' || state.status === 'opening') return next
  return state
}

/** What the conversation is doing, in words, for the status line. */
const LABELS: Record<VoicePhase, string> = {
  idle: 'Tap the microphone and talk',
  connecting: 'Opening the conversation…',
  listening: 'Listening. Tap again to send',
  transcribing: 'Writing down what you said…',
  thinking: 'Thinking…',
  speaking: 'Speaking. Tap the microphone to interrupt',
}

/** "Error: x" → "x": errors are shown to a person, not logged. */
function errorText(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return text.replace(/^(Error:\s*)+/, '')
}

/** The server has no OpenAI key, so it can't hear or speak (panel_voice.rs). */
class VoiceOff extends Error {}
const VOICE_OFF_KEY = 'herbot.voice-off'
function rememberVoiceOff() {
  try {
    sessionStorage.setItem(VOICE_OFF_KEY, '1')
  } catch {
    /* storage can be blocked; the page still works */
  }
}
function voiceKnownOff(): boolean {
  try {
    return sessionStorage.getItem(VOICE_OFF_KEY) === '1'
  } catch {
    return false
  }
}

async function voiceRequest(action: 'speak' | 'transcribe', body: BodyInit): Promise<Response> {
  const response = await fetch(`/api/voice/${action}`, {
    method: 'POST',
    body,
    headers: typeof body === 'string' ? { 'content-type': 'application/json' } : {},
  })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    const message = data.error ?? `Speech request failed (${response.status})`
    if (/OPENAI_API_KEY|is off/i.test(message)) {
      rememberVoiceOff()
      throw new VoiceOff(message)
    }
    throw new Error(message)
  }
  return response
}

function Companions() {
  const [chosen, choose] = useState<Companion | null>(null)
  if (chosen) return <VoiceConversation key={chosen.name} companion={chosen} onBack={() => choose(null)} />
  return (
    <>
      <PageHeader
        title="Companions"
        description="Four original characters to talk with out loud or by typing. Each has its own voice and topic, and shares your Herbot memory."
      />
      <ul className="grid gap-4 sm:grid-cols-2">
        {COMPANIONS.map((c) => (
          <li key={c.name} className="flex flex-col rounded-xl border bg-card p-5">
            <div className="mx-auto h-36 w-40" aria-hidden>
              <CompanionAvatar companion={c} />
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-tight">{c.name}</h2>
              <span className="text-xs text-muted-foreground">voice: {c.voice}</span>
            </div>
            <p className="mt-1 flex-1 text-sm text-muted-foreground">{c.tagline}</p>
            <Button variant="secondary" className="mt-4 h-11 w-full" onClick={() => choose(c)}>
              Talk with {c.name}
            </Button>
          </li>
        ))}
      </ul>
      <p className="max-w-[65ch] text-xs text-muted-foreground">
        AI characters with AI-generated voices. Your audio goes to OpenAI to be transcribed. Conversations appear in
        Telegram like any topic.
      </p>
    </>
  )
}

function VoiceConversation({ companion: c, onBack }: { companion: Companion; onBack: () => void }) {
  const [phase, setPhase] = useState<VoicePhase>('connecting')
  const [connection, setConnection] = useReducer(transitionConnection, { status: 'opening' })
  const [attempt, setAttempt] = useState(0)
  const session = connection.status === 'ready' ? connection.session : null
  const [messages, setMessages] = useState<Exchange[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [voiceOff, setVoiceOff] = useState(false)
  const [hasAudio, setHasAudio] = useState(false)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [recordedAt, setRecordedAt] = useState<number | null>(null)
  const media = useRef<{
    recorder?: MediaRecorder
    stream?: MediaStream
    audio?: HTMLAudioElement
    source?: MediaElementAudioSourceNode
    analyser?: AnalyserNode
    context?: AudioContext
    url?: string
    timer?: ReturnType<typeof setTimeout>
  }>({})
  const active = useRef(true)
  const busy = useRef(false)
  const generation = useRef(0)
  const sendAction = useRef<{ text: string; key: string } | null>(null)
  const transcript = useRef<HTMLOListElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)

  // Ask the server up front; fall back to what an earlier try this session learned.
  useEffect(() => {
    setVoiceOff(voiceKnownOff())
    let live = true
    fetch('/api/voice/status')
      .then((r) => (r.ok ? (r.json() as Promise<{ transcribe: boolean; speak: boolean }>) : null))
      .then((s) => {
        if (live && s) setVoiceOff(!s.transcribe || !s.speak)
      })
      .catch(() => {
        /* unknown: the first speech request will tell */
      })
    return () => {
      live = false
    }
  }, [])

  function fail(e: unknown) {
    if (e instanceof VoiceOff) {
      setVoiceOff(true)
      setError('')
    } else setError(errorText(e))
  }

  function stopPlayback() {
    const m = media.current
    if (m.audio) {
      m.audio.onplay = null
      m.audio.onended = null
      m.audio.onerror = null
      m.audio.pause()
    }
    m.audio = undefined
    if (m.url) URL.revokeObjectURL(m.url)
    m.url = undefined
    m.source?.disconnect()
    m.analyser?.disconnect()
    m.source = undefined
    m.analyser = undefined
    setAnalyser(null)
    setHasAudio(false)
  }
  function unlockAudio() {
    const context = media.current.context ?? new AudioContext()
    media.current.context = context
    void context.resume().catch(() => {})
    return context
  }

  useEffect(() => {
    active.current = true
    let disposed = false
    setConnection({ status: 'opening' })
    setPhase('connecting')
    setError('')
    // Setup is shared across StrictMode remounts and rapid visits, preventing duplicate topics.
    void openCompanion(c)
      .then(async (value) => {
        if (disposed) return
        setNotice(value.fallback ? errorText(value.reason ?? '') : '')
        if (!value.fallback) {
          const history = await getMessages({ data: { id: value.id, limit: 30 } })
          if (disposed) return
          setMessages(history.messages.map((m) => ({ role: m.from_bot ? 'companion' : 'you', text: m.body })))
        }
        setConnection({ status: 'ready', session: value })
        setPhase('idle')
      })
      .catch((e) => {
        if (!disposed) {
          setConnection({ status: 'failed' })
          setError(errorText(e))
          setPhase('idle')
        }
      })
    return () => {
      disposed = true
      active.current = false
      generation.current++
      const m = media.current
      clearTimeout(m.timer)
      if (m.recorder) {
        m.recorder.onstop = null
        m.recorder.onerror = null
        m.recorder.ondataavailable = null
      }
      if (m.recorder?.state === 'recording') m.recorder.stop()
      m.stream?.getTracks().forEach((t) => t.stop())
      if (m.audio) {
        m.audio.onplay = null
        m.audio.onended = null
        m.audio.onerror = null
        m.audio.pause()
      }
      if (m.url) URL.revokeObjectURL(m.url)
      void m.context?.close()
    }
  }, [c, attempt])

  // Follow the newest line, inside the transcript only (never the page).
  useEffect(() => {
    const list = transcript.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, phase])

  async function send(text: string, transcribed = false) {
    if (!text.trim() || !session || busy.current || (!transcribed && (phase === 'listening' || phase === 'connecting' || phase === 'transcribing')))
      return
    busy.current = true
    const turn = ++generation.current
    setError('')
    stopPlayback()
    setMessages((old) => [...old, { role: 'you', text }])
    setPhase('thinking')
    if (sendAction.current?.text !== text) sendAction.current = { text, key: crypto.randomUUID() }
    let replied = false
    try {
      const context = voiceOff ? null : unlockAudio()
      const reply = await companionReply({
        data: {
          id: session.id,
          idempotencyKey: sendAction.current.key,
          text: session.fallback ? `[Companion voice conversation: ${c.name}. For this reply only: ${c.purpose}]\n\n${text}` : text,
        },
      })
      if (!active.current || turn !== generation.current) return
      replied = true
      sendAction.current = null
      if (!transcribed) setDraft('')
      setMessages((old) => [...old, { role: 'companion', text: reply }])
      if (!context) {
        setPhase('idle')
        return
      }
      const response = await voiceRequest('speak', JSON.stringify({ text: reply, voice: c.voice }))
      const blob = await response.blob()
      if (!active.current || turn !== generation.current) return
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      media.current.url = url
      media.current.audio = audio
      setHasAudio(true)
      audio.onplay = () => setPhase('speaking')
      const node = context.createAnalyser()
      node.fftSize = 256
      const source = context.createMediaElementSource(audio)
      media.current.source = source
      media.current.analyser = node
      source.connect(node)
      node.connect(context.destination)
      setAnalyser(node)
      audio.onended = () => {
        stopPlayback()
        if (active.current) setPhase('idle')
      }
      audio.onerror = () => {
        setError('The reply’s audio couldn’t play. The text is above.')
        stopPlayback()
        setPhase('idle')
      }
      if (context.state !== 'running') throw new Error('Your browser paused audio. Tap “Play reply” to hear it.')
      await audio.play()
      setPhase('speaking')
    } catch (e) {
      if (active.current && turn === generation.current) {
        fail(e)
        if (!replied) {
          // The message didn't get an answer: take it back out and put it in the box.
          setMessages((old) => old.slice(0, -1))
          setDraft(text)
        }
        if (!media.current.audio) stopPlayback()
        setPhase('idle')
      }
    } finally {
      busy.current = false
    }
  }

  async function microphone() {
    if (phase === 'listening') {
      if (busy.current) return
      busy.current = true
      setPhase('transcribing')
      setRecordedAt(null)
      if (media.current.recorder?.state === 'recording') media.current.recorder.stop()
      return
    }
    if (busy.current || !session || voiceOff) return
    stopPlayback()
    setError('')
    setPhase('connecting')
    busy.current = true
    try {
      unlockAudio()
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error('This browser can’t record here (it needs HTTPS or localhost). You can type instead.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!active.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      media.current.stream = stream
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t))
      if (!mime) {
        stream.getTracks().forEach((t) => t.stop())
        throw new Error('This browser has no recording format Herbot can read. You can type instead.')
      }
      const recorder = new MediaRecorder(stream, { mimeType: mime })
      media.current.recorder = recorder
      const chunks: BlobPart[] = []
      let size = 0
      recorder.ondataavailable = (e) => {
        chunks.push(e.data)
        size += e.data.size
        if (size > 20 * 1024 * 1024 && recorder.state === 'recording') recorder.stop()
      }
      recorder.onerror = () => {
        recorder.onstop = null
        clearTimeout(media.current.timer)
        stream.getTracks().forEach((t) => t.stop())
        busy.current = false
        setRecordedAt(null)
        setError('Recording stopped unexpectedly. Try again, or type instead.')
        setPhase('idle')
      }
      recorder.onstop = () => {
        busy.current = true
        clearTimeout(media.current.timer)
        stream.getTracks().forEach((t) => t.stop())
        setRecordedAt(null)
        setPhase('transcribing')
        const form = new FormData()
        form.set('audio', new Blob(chunks, { type: mime }), 'recording')
        void voiceRequest('transcribe', form)
          .then((r) => r.json())
          .then((data: { text: string }) => {
            busy.current = false
            if (!active.current) return
            if (!data.text.trim()) throw new Error('I didn’t hear any words. Try again a little closer to the mic.')
            return send(data.text, true)
          })
          .catch((e) => {
            busy.current = false
            if (active.current) {
              fail(e)
              setPhase('idle')
            }
          })
      }
      recorder.start(1000)
      setPhase('listening')
      setRecordedAt(Date.now())
      busy.current = false
      media.current.timer = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, 600_000)
    } catch (e) {
      busy.current = false
      if (active.current) {
        const text = errorText(e)
        // The browser said no to the microphone.
        setError(/denied|NotAllowed|Permission/i.test(text) ? 'Microphone access is blocked. Allow it in the browser’s site settings, or type instead.' : text)
        setPhase('idle')
      }
    }
  }

  const waiting = phase === 'connecting' || phase === 'transcribing' || phase === 'thinking'
  const failedToOpen = connection.status === 'failed'
  const status = failedToOpen
    ? 'Couldn’t open the conversation'
    : voiceOff && phase === 'idle'
      ? `Type a message to ${c.name}`
      : phase === 'connecting' && session
        ? 'Opening the microphone…'
        : LABELS[phase]

  return (
    <>
      <div className="flex flex-col gap-3">
        <Button variant="ghost" className="-ml-3 self-start" onClick={onBack}>
          <ArrowLeftIcon aria-hidden />
          All companions
        </Button>
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">{c.name}</h1>
      </div>

      {session?.fallback && (
        <div role="status" className="rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm">
          <p className="font-medium">Talking through General, with shared history</p>
          <p className="mt-1 text-muted-foreground wrap-anywhere">
            Herbot couldn’t make {c.name} a topic of its own{notice ? ` (${notice})` : ''}. {c.name}’s character is sent with
            each message, and General’s other conversations share this history.
          </p>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        {/* The stage: who you're talking to, what they're doing, and the one control. */}
        <section aria-label={`${c.name}, voice`} className="flex flex-col items-center rounded-xl border bg-card p-6 text-center">
          <div className="h-44 w-48">
            <CompanionAvatar companion={c} phase={phase} analyser={analyser} />
          </div>
          <p role="status" aria-live="polite" className="mt-2 min-h-10 text-sm text-balance text-muted-foreground">
            {status}
            {recordedAt != null && phase === 'listening' && <Elapsed since={recordedAt} />}
          </p>

          {voiceOff ? (
            <div className="mt-3 flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <span className="grid size-16 place-items-center rounded-full border border-dashed">
                <MicOffIcon className="size-6" aria-hidden />
              </span>
              <p className="max-w-[26ch]">
                Herbot needs <code className="font-mono text-xs">OPENAI_API_KEY</code> to hear and speak. Replies still arrive as text.
              </p>
            </div>
          ) : (
            <button
              type="button"
              disabled={waiting || !session}
              aria-label={phase === 'listening' ? 'Stop recording and send' : phase === 'speaking' ? 'Interrupt and start listening' : 'Start listening'}
              aria-pressed={phase === 'listening'}
              onClick={() => void microphone()}
              className={cn(
                'mt-3 grid size-18 place-items-center rounded-full text-primary-foreground shadow-sm outline-none',
                'transition-[background-color,scale] duration-150 ease-out active:scale-[0.96]',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card',
                'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none',
                phase === 'listening' ? 'bg-destructive' : 'bg-primary hover:bg-[color-mix(in_oklch,var(--primary)_86%,black)]',
              )}
            >
              {waiting ? (
                <Spinner className="size-6" />
              ) : phase === 'listening' ? (
                <SquareIcon className="size-6 fill-current" aria-hidden />
              ) : (
                <MicIcon className="size-7" aria-hidden />
              )}
            </button>
          )}

          <div className="mt-4 flex min-h-11 flex-wrap justify-center gap-2">
            {hasAudio && phase === 'idle' && (
              <Button
                variant="secondary"
                onClick={() => {
                  void (async () => {
                    try {
                      await media.current.context?.resume()
                      await media.current.audio?.play()
                    } catch (e) {
                      fail(e)
                    }
                  })()
                }}
              >
                <Volume2Icon aria-hidden />
                Play reply
              </Button>
            )}
            {phase === 'speaking' && (
              <Button
                variant="ghost"
                onClick={() => {
                  stopPlayback()
                  setPhase('idle')
                }}
              >
                <VolumeXIcon aria-hidden />
                Stop audio
              </Button>
            )}
          </div>
          {!voiceOff && <p className="mt-2 text-xs text-muted-foreground">Up to 10 minutes per recording</p>}
        </section>

        <div className="flex min-w-0 flex-col gap-3">
          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm">
              <p className="min-w-0 flex-1 text-destructive wrap-anywhere">{error}</p>
              {failedToOpen ? (
                <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setError('')}>
                  Dismiss
                </Button>
              )}
            </div>
          )}

          <section aria-label="Conversation" className="flex min-w-0 flex-col rounded-xl border bg-card">
            <ol
              ref={transcript}
              aria-live="polite"
              aria-relevant="additions"
              className="scroller flex max-h-[min(28rem,55dvh)] min-h-40 flex-col gap-4 overflow-y-auto overscroll-contain p-4 sm:p-5"
            >
              {messages.length === 0 && !waiting && (
                <li className="m-auto max-w-[36ch] text-center text-sm text-muted-foreground">
                  {failedToOpen ? 'Nothing here yet.' : `Say hello, or ask ${c.name} anything. Your conversation shows here.`}
                </li>
              )}
              {messages.map((m, i) => (
                <li key={i} className={cn('flex max-w-[85%] min-w-0 flex-col gap-1', m.role === 'you' ? 'self-end items-end' : 'self-start')}>
                  <span className="text-xs text-muted-foreground">{m.role === 'you' ? 'You' : c.name}</span>
                  <div className={cn('min-w-0 rounded-xl px-3.5 py-2.5 text-sm', m.role === 'you' ? 'bg-accent text-accent-foreground' : 'bg-muted')}>
                    <RichMessage body={m.text} />
                  </div>
                </li>
              ))}
              {phase === 'thinking' && (
                <li className="flex items-center gap-2 self-start text-sm text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {c.name} is thinking…
                </li>
              )}
            </ol>

            <form
              className="flex items-end gap-2 border-t p-3"
              onSubmit={(e) => {
                e.preventDefault()
                void send(draft)
              }}
            >
              <label htmlFor="companion-text" className="sr-only">
                Message {c.name}
              </label>
              <textarea
                ref={composer}
                id="companion-text"
                dir="auto"
                rows={1}
                placeholder={`Message ${c.name}`}
                className="field-sizing-content max-h-36 min-h-11 min-w-0 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-base leading-snug outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 md:text-sm"
                value={draft}
                maxLength={session?.fallback ? 2700 : 3500}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void send(draft)
                  }
                }}
                disabled={waiting || phase === 'listening' || !session}
              />
              <Button
                type="submit"
                size="icon"
                className="size-11 shrink-0"
                aria-label="Send"
                disabled={!draft.trim() || waiting || phase === 'listening' || !session}
              >
                <SendIcon aria-hidden />
              </Button>
            </form>
          </section>
          <p className="text-xs text-muted-foreground">Enter sends · Shift+Enter for a new line</p>
        </div>
      </div>
    </>
  )
}

/** "0:42" since recording started; tabular so the digits don't jiggle. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return <span className="ml-1.5 font-medium text-foreground tabular-nums">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
}

// Topic purpose and name identify companion ownership across devices; never repurpose another topic.
const opening = new Map<string, Promise<Session & { reason?: string }>>()
const creationKeys = new Map<string, string>()
function openCompanion(c: Companion): Promise<Session & { reason?: string }> {
  const existing = opening.get(c.name)
  if (existing) return existing
  const promise = (async () => {
    const topics = await listTopics()
    const name = `Companion · ${c.name}`
    const found = topics.find((t) => t.name.trim() === name && t.purpose?.startsWith(c.purpose.slice(0, 80)))
    if (found) {
      if (!found.enabled || found.setup_state !== 'ready')
        throw new Error(`${c.name}’s topic is switched off or not set up. Turn it back on under Topics.`)
      return { id: found.id, fallback: false }
    }
    try {
      if (!creationKeys.has(c.name)) creationKeys.set(c.name, crypto.randomUUID())
      const topic = await createTopic({ data: { name, purpose: c.purpose, idempotencyKey: creationKeys.get(c.name)! } })
      creationKeys.delete(c.name)
      return { id: topic.id, fallback: false }
    } catch (e) {
      const general = topics.find((t) => t.is_general && t.enabled && t.setup_state === 'ready')
      if (!general) throw new Error(`Couldn’t create ${c.name}’s topic (${errorText(e)}), and General isn’t available either.`)
      return { id: general.id, fallback: true, reason: errorText(e) }
    }
  })()
  opening.set(c.name, promise)
  void promise.finally(() => opening.delete(c.name)).catch(() => {})
  return promise
}
