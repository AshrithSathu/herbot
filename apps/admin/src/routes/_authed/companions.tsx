import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useReducer, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  MicIcon,
  SendIcon,
  SquareIcon,
  Volume2Icon,
} from 'lucide-react'
import { companionReply, createTopic, listTopics, getMessages } from '../../api'
import {
  COMPANIONS,
  CompanionAvatar,
  type Companion,
  type VoicePhase,
} from '../../components/companion-avatar'
import { RichMessage } from '../../components/rich-message'
import { Button } from '../../components/ui/button'
export const Route = createFileRoute('/_authed/companions')({
  staticData: { crumb: 'Companions' },
  component: Companions,
})
type Exchange = { role: 'you' | 'companion'; text: string }
type Session = { id: number; fallback: boolean }
type Connection =
  | { status: 'opening' }
  | { status: 'ready'; session: Session }
  | { status: 'failed' }
function transitionConnection(state: Connection, next: Connection): Connection {
  if (next.status === 'opening' || state.status === 'opening') return next
  return state
}

const LABELS: Record<VoicePhase, string> = {
  idle: 'Ready when you are',
  connecting: 'Opening conversation…',
  listening: 'Listening · tap to send',
  transcribing: 'Transcribing…',
  thinking: 'Thinking…',
  speaking: 'Speaking · tap the mic to interrupt',
}
async function voiceRequest(action: string, body: BodyInit): Promise<Response> {
  const response = await fetch(`/api/voice/${action}`, {
    method: 'POST',
    body,
    headers:
      typeof body === 'string' ? { 'content-type': 'application/json' } : {},
  })
  if (!response.ok) {
    const data = (await response.json()) as { error?: string }
    throw new Error(data.error ?? 'Speech request failed')
  }
  return response
}
function Companions() {
  const [chosen, choose] = useState<Companion | null>(null)
  return (
    <>
      {chosen ? (
        <VoiceConversation
          key={chosen.name}
          companion={chosen}
          onBack={() => choose(null)}
        />
      ) : (
        <>
          <div className="max-w-xl space-y-3">
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              A different kind of conversation
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Meet your companions
            </h1>
            <p className="text-pretty text-muted-foreground">
              Four original characters, each with a voice and a way of seeing
              things. Pick someone to talk to, or type what’s on your mind.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {COMPANIONS.map((c) => (
              <article
                key={c.name}
                className="flex flex-col rounded-2xl border bg-card p-6 text-card-foreground"
              >
                <div className="mx-auto h-48 w-56">
                  <CompanionAvatar companion={c} />
                </div>
                <div className="mt-4 flex items-baseline justify-between gap-3">
                  <h2 className="text-xl font-semibold">{c.name}</h2>
                  <span className="text-xs text-muted-foreground">
                    {c.voice} voice
                  </span>
                </div>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">
                  {c.tagline}
                </p>
                <Button
                  variant="secondary"
                  className="mt-5 min-h-11 w-full"
                  onClick={() => choose(c)}
                >
                  Talk with {c.name}
                </Button>
              </article>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            AI characters and AI-generated voices. Audio is sent to OpenAI for
            transcription. Conversations share your Herbot memory and appear in
            Telegram.
          </p>
        </>
      )}
    </>
  )
}
function VoiceConversation({
  companion: c,
  onBack,
}: {
  companion: Companion
  onBack: () => void
}) {
  const [phase, setPhase] = useState<VoicePhase>('connecting')
  const [connection, setConnection] = useReducer(transitionConnection, { status: 'opening' })
  const [attempt, setAttempt] = useState(0)
  const session = connection.status === 'ready' ? connection.session : null
  const [messages, setMessages] = useState<Exchange[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [hasAudio, setHasAudio] = useState(false)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
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
  const bottom = useRef<HTMLDivElement>(null)
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
        setNotice(value.fallback ? (value.reason ?? '') : '')
        if (!value.fallback) {
          const history = await getMessages({
            data: { id: value.id, limit: 30 },
          })
          if (disposed) return
          setMessages(
            history.messages.map((m) => ({
              role: m.from_bot ? 'companion' : 'you',
              text: m.body,
            })),
          )
        }
        setConnection({ status: 'ready', session: value })
        setPhase('idle')
      })
      .catch((e) => {
        if (!disposed) {
          setConnection({ status: 'failed' })
          setError(String(e))
          setPhase('idle')
        }
      })
    return () => {
      disposed = true
      active.current = false
      generation.current++
      const m = media.current
      clearTimeout(m.timer)
      if (m.recorder) { m.recorder.onstop = null; m.recorder.onerror = null; m.recorder.ondataavailable = null }
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
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [messages])
  async function send(text: string, transcribed = false) {
    if (!text.trim() || !session || busy.current || (!transcribed && (phase === 'listening' || phase === 'connecting' || phase === 'transcribing'))) return
    busy.current = true
    const turn = ++generation.current
    setError('')
    stopPlayback()
    setMessages((old) => [...old, { role: 'you', text }])
    setPhase('thinking')
    let replied = false
    try {
      const context = unlockAudio()
      const reply = await companionReply({
        data: {
          id: session.id,
          text: session.fallback
            ? `[Companion voice conversation: ${c.name}. For this reply only: ${c.purpose}]\n\n${text}`
            : text,
        },
      })
      if (!active.current || turn !== generation.current) return
      replied = true
      if (!transcribed) setDraft('')
      setMessages((old) => [...old, { role: 'companion', text: reply }])
      const response = await voiceRequest(
        'speak',
        JSON.stringify({ text: reply, voice: c.voice }),
      )
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
        setError('Audio playback failed. Try sending a new message.')
        stopPlayback()
        setPhase('idle')
      }
      if (context.state !== 'running')
        throw new Error('Your browser paused audio. Tap Play reply to hear it.')
      await audio.play()
      setPhase('speaking')
    } catch (e) {
      if (active.current && turn === generation.current) {
        setError(String(e))
        if (!replied) setDraft(text)
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
      if (media.current.recorder?.state === 'recording')
        media.current.recorder.stop()
      return
    }
    if (busy.current || !session) return
    stopPlayback()
    setError('')
    setPhase('connecting')
    busy.current = true
    try {
      unlockAudio()
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error(
          'Microphone recording needs a supported browser on HTTPS or localhost. You can type below.',
        )
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!active.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      media.current.stream = stream
      const mime = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((t) => MediaRecorder.isTypeSupported(t))
      if (!mime) {
        stream.getTracks().forEach((t) => t.stop())
        throw new Error('No supported recording format. You can type below.')
      }
      const recorder = new MediaRecorder(stream, { mimeType: mime })
      media.current.recorder = recorder
      const chunks: BlobPart[] = []
      let size = 0
      recorder.ondataavailable = (e) => {
        chunks.push(e.data)
        size += e.data.size
        if (size > 20 * 1024 * 1024 && recorder.state === 'recording')
          recorder.stop()
      }
      recorder.onerror = () => {
        recorder.onstop = null
        clearTimeout(media.current.timer)
        stream.getTracks().forEach((t) => t.stop())
        busy.current = false
        setError('Recording failed. Try again or type below.')
        setPhase('idle')
      }
      recorder.onstop = () => {
        busy.current = true
        clearTimeout(media.current.timer)
        stream.getTracks().forEach((t) => t.stop())
        setPhase('transcribing')
        const form = new FormData()
        form.set('audio', new Blob(chunks, { type: mime }), 'recording')
        void voiceRequest('transcribe', form)
          .then((r) => r.json())
          .then((data: { text: string }) => {
            busy.current = false
            if (!active.current) return
            if (!data.text.trim())
              throw new Error('No speech heard. Try again or type below.')
            return send(data.text, true)
          })
          .catch((e) => {
            busy.current = false
            if (active.current) {
              setError(String(e))
              setPhase('idle')
            }
          })
      }
      recorder.start(1000)
      setPhase('listening')
      busy.current = false
      media.current.timer = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, 600000)
    } catch (e) {
      busy.current = false
      if (active.current) {
        setError(String(e))
        setPhase('idle')
      }
    }
  }
  const waiting = ['connecting', 'transcribing', 'thinking'].includes(phase)
  return (
    <>
      <div className="flex items-center gap-3">
        <Button variant="ghost" className="min-h-11" onClick={onBack}>
          <ArrowLeftIcon />
          Companions
        </Button>
        <h1 className="text-xl font-semibold">{c.name}</h1>
      </div>
      {session?.fallback && (
        <div
          role="status"
          className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <strong>Using General · shared history</strong>
          <p className="mt-1">
            {notice} {c.name}’s character is included with each message. Other
            conversations in General share this memory.
          </p>
        </div>
      )}
      <section
        aria-label={`Talk with ${c.name}`}
        className="rounded-2xl border bg-card p-5 text-center sm:p-8"
      >
        <div className="mx-auto h-56 w-60">
          <CompanionAvatar companion={c} phase={phase} analyser={analyser} />
        </div>
        <p
          role="status"
          aria-live="polite"
          className="mb-5 min-h-6 text-sm text-muted-foreground"
        >
          {!session && phase === 'idle'
            ? 'Conversation unavailable'
            : phase === 'connecting' && session ? 'Opening microphone…' : LABELS[phase]}
        </p>
        <Button
          disabled={waiting || !session}
          aria-label={
            phase === 'listening'
              ? 'Stop recording and send'
              : phase === 'speaking'
                ? 'Interrupt and start listening'
                : 'Start listening'
          }
          aria-pressed={phase === 'listening'}
          onClick={() => void microphone()}
          className="size-20 rounded-full"
        >
          {phase === 'listening' ? (
            <SquareIcon className="size-7" />
          ) : (
            <MicIcon className="size-7" />
          )}
        </Button>
        {hasAudio && phase === 'idle' && (
          <Button
            variant="secondary"
            className="ml-3 min-h-11"
            onClick={() => {
              void (async () => {
                try {
                  await media.current.context?.resume()
                  await media.current.audio?.play()
                } catch (e) {
                  setError(String(e))
                }
              })()
            }}
          >
            <Volume2Icon />
            Play reply
          </Button>
        )}
        {phase === 'speaking' && (
          <Button
            variant="ghost"
            className="ml-3 min-h-11"
            onClick={() => {
              stopPlayback()
              setPhase('idle')
            }}
          >
            <Volume2Icon />
            Stop audio
          </Button>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Tap to start, tap again to send · up to 10 minutes
          <br />
          AI-generated voice · audio transcribed by OpenAI
        </p>
      </section>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive"
        >
          {error}
          {connection.status === 'failed' && <Button variant="link" onClick={() => setAttempt((n) => n + 1)}>Retry connection</Button>}
        </p>
      )}
      <section
        aria-label="Conversation transcript"
        className="max-h-96 min-h-24 space-y-5 overflow-y-auto rounded-xl border p-4"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Your conversation will appear here. Start with a thought, a
            question, or just hello.
          </p>
        )}
        {messages.map((m, i) => (
          <article key={i} className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {m.role === 'you' ? 'You' : c.name}
            </p>
            <RichMessage body={m.text} />
          </article>
        ))}
        <div ref={bottom} />
      </section>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send(draft)
        }}
        className="space-y-2"
      >
        <label htmlFor="companion-text" className="text-sm font-medium">
          Or type a message
        </label>
        <div className="flex gap-2">
          <input
            id="companion-text"
            className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-ring"
            value={draft}
            maxLength={session?.fallback ? 2700 : 3500}
            onChange={(e) => setDraft(e.target.value)}
            disabled={waiting || phase === 'listening' || !session}
          />
          <Button
            type="submit"
            className="min-h-11"
            disabled={
              !draft.trim() || waiting || phase === 'listening' || !session
            }
          >
            <SendIcon />
            <span className="sr-only sm:not-sr-only">Send</span>
          </Button>
        </div>
      </form>
    </>
  )
}
// Topic purpose and name identify companion ownership across devices; never repurpose another topic.
const opening = new Map<string, Promise<Session & { reason?: string }>>()
function openCompanion(c: Companion): Promise<Session & { reason?: string }> {
  const existing = opening.get(c.name)
  if (existing) return existing
  const promise = (async () => {
    const topics = await listTopics()
    const name = `Companion · ${c.name}`
    const found = topics.find(
      (t) =>
        t.place.split('›').pop()?.trim() === name &&
        t.purpose?.startsWith(c.purpose.slice(0, 80)),
    )
    if (found) {
      if (!found.enabled || found.setup_state !== 'ready')
        throw new Error(
          'This companion topic is disabled or needs setup. Open Topics to restore it.',
        )
      return { id: found.id, fallback: false }
    }
    try {
      const topic = await createTopic({ data: { name, purpose: c.purpose } })
      return { id: topic.id, fallback: false }
    } catch (e) {
      const general = topics.find(
        (t) => t.is_general && t.enabled && t.setup_state === 'ready',
      )
      if (!general)
        throw new Error(
          `Could not create the companion topic and General is unavailable: ${String(e)}`,
        )
      return { id: general.id, fallback: true, reason: String(e) }
    }
  })()
  opening.set(c.name, promise)
  void promise.finally(() => opening.delete(c.name)).catch(() => {})
  return promise
}
