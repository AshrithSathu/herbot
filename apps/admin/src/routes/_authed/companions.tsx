// Companions (docs/design/DECISIONS.md, "Companions": Call panel). The
// companion's conversation stays in the main pane like any topic; the voice
// call (avatar, what it's doing, the mic) docks in the details pane, which is
// beside the chat from 68.75rem and opens over it below that. Narrow screens
// also get a compact call bar in the header and a mic in the composer, so a
// voice turn never needs the panel open. Companions are real topics
// ("Companion · Luma"), so they also sit in the agents pane like any topic.
//
// Every state has its own words: opening, idle, getting the mic, listening
// (with a timer), writing it down, thinking, speaking, failed (with retry),
// and voice unavailable (no OPENAI_API_KEY: typing still works).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { MicIcon, MicOffIcon, PhoneIcon, SquareIcon, Volume2Icon, VolumeXIcon, XIcon } from 'lucide-react'
import { companionReply, createTopic, getMessages, listTopics, type Message as MessageData } from '../../api'
import { COMPANIONS, CompanionAvatar, type Companion, type VoicePhase } from '../../components/companion-avatar'
import { Composer } from '@/components/hb/composer'
import { Button, Segmented } from '@/components/hb/controls'
import { ChatSkeleton, InPlaceEmpty, InPlaceError, splitErrorId } from '@/components/hb/feedback'
import { FailedMessage, Message, MessageRow, Thinking } from '@/components/hb/message'
import { BackToAgents, ShellDetails, useShell } from '@/components/hb/shell'
import { cn } from '@/lib/utils'
import { plainReason } from '@/lib/reasons'

type Name = Companion['name']

export const Route = createFileRoute('/_authed/companions')({
  // ?c=Flint keeps the companion across reloads and Back.
  validateSearch: (s: Record<string, unknown>): { c?: Name } =>
    typeof s.c === 'string' && COMPANIONS.some((c) => c.name === s.c) ? { c: s.c } : {},
  staticData: { crumb: 'Companions', shell: 'page' },
  head: () => ({ meta: [{ title: 'Companions · Herbot admin' }] }),
  component: CompanionsPage,
})

function CompanionsPage() {
  const { c } = Route.useSearch()
  const companion = COMPANIONS.find((x) => x.name === c) ?? COMPANIONS[0]
  // A new companion is a new call: every recorder, player and timer of the
  // old one is torn down with it.
  return <Call key={companion.name} companion={companion} />
}

/* ------------------------------------------------------------------ voice */

/** The server can hear and speak only with OPENAI_API_KEY (panel_voice.rs). */
function useVoiceStatus() {
  return useQuery({
    queryKey: ['voice-status'],
    queryFn: async () => {
      const r = await fetch('/api/voice/status')
      if (!r.ok) throw new Error(`Voice status failed (${r.status})`)
      return (await r.json()) as { transcribe: boolean; speak: boolean }
    },
    staleTime: 5 * 60_000,
  })
}

/** "Error: x" → "x": errors are read by a person, not logged. */
function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^(Error:\s*)+/, '')
}

class VoiceOff extends Error {}

async function voiceRequest(action: 'speak' | 'transcribe', body: BodyInit): Promise<Response> {
  const response = await fetch(`/api/voice/${action}`, {
    method: 'POST',
    body,
    headers: typeof body === 'string' ? { 'content-type': 'application/json' } : {},
  })
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    const message = data.error ?? `Speech request failed (${response.status})`
    if (/OPENAI_API_KEY|is off/i.test(message)) throw new VoiceOff(message)
    throw new Error(message)
  }
  return response
}

type Session = { id: number; fallback: boolean; reason?: string }

// Topic name and purpose identify a companion's topic across devices; never
// repurpose another topic. Opening is shared across StrictMode remounts and
// quick revisits, so one companion never gets two topics.
const opening = new Map<string, Promise<Session>>()
const creationKeys = new Map<string, string>()
function openCompanion(c: Companion): Promise<Session> {
  const existing = opening.get(c.name)
  if (existing) return existing
  const promise = (async (): Promise<Session> => {
    const topics = await listTopics()
    const name = `Companion · ${c.name}`
    const found = topics.find((t) => t.name.trim() === name && t.purpose?.startsWith(c.purpose.slice(0, 80)))
    if (found) {
      if (!found.enabled || found.setup_state !== 'ready')
        throw new Error(`${c.name}’s topic is switched off or not set up. Switch it back on under Topics.`)
      return { id: found.id, fallback: false }
    }
    try {
      if (!creationKeys.has(c.name)) creationKeys.set(c.name, crypto.randomUUID())
      const topic = await createTopic({ data: { name, purpose: c.purpose, idempotencyKey: creationKeys.get(c.name)! } })
      creationKeys.delete(c.name)
      return { id: topic.id, fallback: false }
    } catch (e) {
      // No topic of its own (Telegram can't create one): talk through General,
      // sending the character with each message.
      const general = topics.find((t) => t.is_general && t.enabled && t.setup_state === 'ready')
      if (!general) throw new Error(`Couldn’t create ${c.name}’s topic (${errorText(e)}), and General isn’t available either.`)
      return { id: general.id, fallback: true, reason: errorText(e) }
    }
  })()
  opening.set(c.name, promise)
  void promise.finally(() => opening.delete(c.name)).catch(() => {})
  return promise
}

let localId = -1
function local(fromBot: boolean, body: string, voice = false): MessageData {
  return { id: localId--, sent_at: new Date().toISOString(), from_bot: fromBot, is_voice: voice, body, attachments: [] }
}

type Connection = { status: 'opening' } | { status: 'ready'; session: Session } | { status: 'failed'; error: string }
type FailedTurn = { text: string; error: string; voice: boolean; at: string }

/** One voice conversation with one companion: the connection, the turn's
 * phase, the transcript, and every media resource it owns. */
function useCall(c: Companion) {
  const status = useVoiceStatus()
  const [connection, setConnection] = useState<Connection>({ status: 'opening' })
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<VoicePhase>('connecting')
  const [messages, setMessages] = useState<MessageData[]>([])
  const [failed, setFailed] = useState<FailedTurn | null>(null)
  // Voice problems that aren't a failed message (mic blocked, nothing heard).
  const [problem, setProblem] = useState('')
  const [voiceKnownOff, setVoiceKnownOff] = useState(false)
  const [hasAudio, setHasAudio] = useState(false)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [recordedAt, setRecordedAt] = useState<number | null>(null)
  const [thinkingSince, setThinkingSince] = useState(0)
  const [restore, setRestore] = useState<{ text: string; key: number } | undefined>()
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
  const sendKey = useRef<{ text: string; key: string } | null>(null)

  const session = connection.status === 'ready' ? connection.session : null
  const voiceOff = voiceKnownOff || (status.data ? !status.data.transcribe || !status.data.speak : false)

  const stopPlayback = useCallback(() => {
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
  }, [])

  function unlockAudio() {
    const context = media.current.context ?? new AudioContext()
    media.current.context = context
    void context.resume().catch(() => {})
    return context
  }

  function fail(e: unknown) {
    if (e instanceof VoiceOff) {
      setVoiceKnownOff(true)
      setProblem('')
    } else setProblem(errorText(e))
  }

  // Open (or find) the companion's topic, then load its recent history.
  useEffect(() => {
    active.current = true
    let disposed = false
    setConnection({ status: 'opening' })
    setPhase('connecting')
    setProblem('')
    void openCompanion(c)
      .then(async (value) => {
        if (disposed) return
        if (!value.fallback) {
          const history = await getMessages({ data: { id: value.id, limit: 30 } })
          if (disposed) return
          setMessages(history.messages)
        }
        setConnection({ status: 'ready', session: value })
        setPhase('idle')
      })
      .catch((e) => {
        if (disposed) return
        setConnection({ status: 'failed', error: errorText(e) })
        setPhase('idle')
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
        if (m.recorder.state === 'recording') m.recorder.stop()
      }
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

  async function send(text: string, transcribed = false) {
    if (!text.trim() || !session || busy.current) return
    if (!transcribed && (phase === 'listening' || phase === 'connecting' || phase === 'transcribing')) return
    busy.current = true
    const turn = ++generation.current
    setProblem('')
    setFailed(null)
    stopPlayback()
    setMessages((old) => [...old, local(false, text, transcribed)])
    setPhase('thinking')
    setThinkingSince(Date.now())
    // The same text keeps its idempotency key, so Retry never sends twice.
    if (sendKey.current?.text !== text) sendKey.current = { text, key: crypto.randomUUID() }
    let replied = false
    try {
      const context = voiceOff ? null : unlockAudio()
      const reply = await companionReply({
        data: {
          id: session.id,
          idempotencyKey: sendKey.current.key,
          text: session.fallback ? `[Companion voice conversation: ${c.name}. For this reply only: ${c.purpose}]\n\n${text}` : text,
        },
      })
      if (!active.current || turn !== generation.current) return
      replied = true
      sendKey.current = null
      setMessages((old) => [...old, local(true, reply)])
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
        setProblem('The reply’s audio couldn’t play. Its text is in the conversation.')
        stopPlayback()
        setPhase('idle')
      }
      if (context.state !== 'running') throw new Error('Your browser paused the audio. Tap “Play reply” to hear it.')
      await audio.play()
      setPhase('speaking')
    } catch (e) {
      if (!active.current || turn !== generation.current) return
      if (replied) {
        // The answer arrived; only its audio failed.
        fail(e)
        if (!media.current.audio) stopPlayback()
      } else {
        // No answer: take the message back out and show it as not sent.
        setMessages((old) => old.slice(0, -1))
        setFailed({ text, error: errorText(e), voice: transcribed, at: new Date().toISOString() })
      }
      setPhase('idle')
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
    setProblem('')
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
        setProblem('Recording stopped unexpectedly. Try again, or type instead.')
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
      // Ten minutes at most per recording, to cap cost.
      media.current.timer = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, 600_000)
    } catch (e) {
      busy.current = false
      if (!active.current) return
      const text = errorText(e)
      setProblem(/denied|NotAllowed|Permission/i.test(text) ? 'Microphone access is blocked. Allow it in the browser’s site settings, or type instead.' : text)
      setPhase('idle')
    }
  }

  /** Drop the recording without sending it. */
  function cancelRecording() {
    const m = media.current
    clearTimeout(m.timer)
    if (m.recorder) {
      m.recorder.onstop = null
      m.recorder.ondataavailable = null
      if (m.recorder.state === 'recording') m.recorder.stop()
    }
    m.stream?.getTracks().forEach((t) => t.stop())
    busy.current = false
    setRecordedAt(null)
    setPhase('idle')
  }

  return {
    status,
    connection,
    session,
    phase,
    messages,
    failed,
    problem,
    voiceOff,
    hasAudio,
    analyser,
    recordedAt,
    thinkingSince,
    restore,
    send: (text: string) => void send(text),
    microphone: () => void microphone(),
    cancelRecording,
    stopSpeaking: () => {
      stopPlayback()
      setPhase('idle')
    },
    playReply: () => {
      void (async () => {
        try {
          await media.current.context?.resume()
          await media.current.audio?.play()
        } catch (e) {
          fail(e)
        }
      })()
    },
    retryOpen: () => setAttempt((n) => n + 1),
    retryTurn: () => failed && void send(failed.text, failed.voice),
    editTurn: () => {
      if (!failed) return
      setRestore({ text: failed.text, key: Date.now() })
      setFailed(null)
    },
    discardTurn: () => setFailed(null),
    dismissProblem: () => setProblem(''),
  }
}

type CallState = ReturnType<typeof useCall>

/** What the call is doing, in words (the panel, the call bar, the mic's label). */
function statusText(call: CallState, c: Companion): string {
  if (call.connection.status === 'failed') return 'Couldn’t open the conversation'
  if (call.connection.status === 'opening') return 'Opening the conversation…'
  if (call.voiceOff && call.phase === 'idle') return `Type a message to ${c.name}`
  switch (call.phase) {
    case 'connecting':
      return 'Opening the microphone…'
    case 'idle':
      return 'Tap the microphone and talk'
    case 'listening':
      return 'Listening. Tap again to send'
    case 'transcribing':
      return 'Writing down what you said…'
    case 'thinking':
      return `${c.name} is thinking…`
    case 'speaking':
      return `${c.name} is speaking`
  }
}

/** The call bar's few words (the full sentence is its accessible name). */
function shortStatus(call: CallState): string {
  if (call.connection.status === 'failed') return 'Not open'
  if (call.connection.status === 'opening') return 'Opening…'
  if (call.voiceOff) return 'Voice off'
  switch (call.phase) {
    case 'connecting':
      return 'Mic…'
    case 'idle':
      return 'Voice'
    case 'listening':
      return 'Listening'
    case 'transcribing':
      return 'Writing it down'
    case 'thinking':
      return 'Thinking'
    case 'speaking':
      return 'Speaking'
  }
}

/* ------------------------------------------------------------------- page */

const OPTIONS = COMPANIONS.map((c) => ({ value: c.name, label: c.name, hint: `${c.tagline} Voice: ${c.voice}.` }))

function Call({ companion: c }: { companion: Companion }) {
  const call = useCall(c)
  const navigate = useNavigate({ from: Route.fullPath })
  const pick = (name: Name) => void navigate({ search: { c: name }, replace: true })
  return (
    <>
      <Conversation call={call} companion={c} onPick={pick} />
      <ShellDetails defaultOpen>
        <CallPanel call={call} companion={c} />
      </ShellDetails>
    </>
  )
}

function Conversation({ call, companion: c, onPick }: { call: CallState; companion: Companion; onPick: (n: Name) => void }) {
  const { detailsOpen, setDetailsOpen } = useShell()
  const end = useRef<HTMLDivElement>(null)

  // Follow the newest line inside the conversation (never the page). Writes
  // scrollTop only; nothing is returned from the effect.
  useEffect(() => {
    const el = end.current?.closest<HTMLElement>('[data-hb-scroll]')
    if (el) el.scrollTop = el.scrollHeight
  }, [call.messages.length, call.phase, call.failed])

  const opening = call.connection.status === 'opening'
  const openFailed = call.connection.status === 'failed'
  const voiceTurn = call.phase === 'listening' || call.phase === 'transcribing' || (call.phase === 'connecting' && !opening)
  const disabledReason = opening
    ? 'Opening the conversation…'
    : openFailed
      ? 'The conversation isn’t open'
      : voiceTurn
        ? 'Finish the voice turn first'
        : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-3 border-b border-line px-4 pt-6 pb-3 md:px-8 md:pt-8">
        <div className="flex min-h-11 items-center gap-2">
          <BackToAgents />
          <h1 className="font-serif text-[30px] leading-[1.1] font-semibold tracking-[-0.015em] md:text-[34px]">Companions</h1>
          <span className="min-w-2 flex-1" />
          <CallBar call={call} companion={c} open={detailsOpen} onToggle={() => setDetailsOpen(!detailsOpen)} />
        </div>
        <Segmented label="Companion" value={c.name} options={OPTIONS} onValueChange={onPick} />
      </header>

      {call.session?.fallback && (
        <div role="status" className="shrink-0 border-b border-line bg-warning-soft px-4 py-2.5 text-[13px] md:px-8">
          <p className="font-medium text-ink">Talking through General, with shared history</p>
          <p className="text-mute">
            Herbot couldn’t give {c.name} a topic of its own
            {(() => {
              const known = plainReason(call.session.reason)
              return known ? ` because ${known.because}` : ''
            })()}
            , so {c.name}’s character goes with each message and General’s other conversations share this history.
          </p>
        </div>
      )}

      <div data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col px-3 py-5 md:px-6">
          {opening ? (
            <ChatSkeleton />
          ) : openFailed ? (
            <InPlaceError title={`Couldn’t open the conversation with ${c.name}`} error={call.connection.status === 'failed' ? call.connection.error : ''} onRetry={call.retryOpen} />
          ) : call.messages.length === 0 && !call.failed && call.phase !== 'thinking' ? (
            <InPlaceEmpty title={`Say hello to ${c.name}`} className="my-auto">
              {call.voiceOff
                ? 'Type below. Voice needs OpenAI on the server, so this is a typed conversation for now. It shows here and in Telegram, like any topic.'
                : 'Talk out loud with the microphone, or type below. The conversation shows here and in Telegram, like any topic.'}
            </InPlaceEmpty>
          ) : (
            <ol aria-label={`Conversation with ${c.name}`} aria-live="polite" aria-relevant="additions" className="flex flex-col">
              {call.messages.map((m, i) => (
                <MessageRow key={m.id} side={m.from_bot ? 'agent' : 'you'} grouped={i > 0 && call.messages[i - 1].from_bot === m.from_bot}>
                  <Message message={m} />
                </MessageRow>
              ))}
              {call.failed && (
                <MessageRow side="you">
                  <FailedMessage
                    body={call.failed.text}
                    error={call.failed.error}
                    sentAt={call.failed.at}
                    retrying={call.phase === 'thinking'}
                    onRetry={call.retryTurn}
                    onEdit={call.editTurn}
                    onDiscard={call.discardTurn}
                  />
                </MessageRow>
              )}
              {call.phase === 'thinking' && (
                <MessageRow side="agent">
                  <Thinking since={call.thinkingSince} label={`${c.name} is thinking`} />
                </MessageRow>
              )}
            </ol>
          )}
          <div ref={end} />
        </div>
      </div>

      <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {call.problem && <Problem text={call.problem} onDismiss={call.dismissProblem} />}
          <Composer
            placeholder={`Message ${c.name}`}
            sending={call.phase === 'thinking'}
            disabledReason={disabledReason}
            restore={call.restore}
            // Companions take text and voice only, and reply in their own way.
            attachments={false}
            modes={false}
            voice={
              // The panel holds the big mic beside the chat; narrow screens
              // get one here so a voice turn needs no panel.
              <span className="wide:hidden">
                <MicButton call={call} companion={c} size="small" />
              </span>
            }
            onSend={({ text }) => call.send(text)}
          />
        </div>
      </div>
    </div>
  )
}

/** Below 68.75rem the call panel isn't beside the chat: this pill says what
 * the call is doing and opens it. */
function CallBar({ call, companion: c, open, onToggle }: { call: CallState; companion: Companion; open: boolean; onToggle: () => void }) {
  const listening = call.phase === 'listening'
  const tone = call.connection.status === 'failed' || call.failed ? 'bg-off' : listening ? 'bg-destructive' : call.phase === 'speaking' ? 'bg-accent-strong' : 'bg-faint'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`Call with ${c.name}: ${statusText(call, c)}. ${open ? 'Close' : 'Open'} the call panel`}
      className="flex h-9 min-w-0 shrink items-center gap-2 rounded-full px-3 text-[13px] text-mute shadow-[inset_0_0_0_var(--hair)_var(--line)] transition-[color,background-color] duration-150 ease-out hover:bg-sunken hover:text-ink pointer-coarse:h-11 wide:hidden"
    >
      <span className={cn('size-2 shrink-0 rounded-full', tone)} aria-hidden />
      <span className="max-w-[24ch] min-w-0 truncate">
        {listening && call.recordedAt != null ? (
          <>
            Listening <Elapsed since={call.recordedAt} />
          </>
        ) : (
          shortStatus(call)
        )}
      </span>
      <PhoneIcon className="size-3.5 shrink-0" aria-hidden />
    </button>
  )
}

/** A voice problem that isn't a failed message: says what to do, dismissable. */
function Problem({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const { id, text: body } = splitErrorId(text)
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-destructive-soft py-2 pr-1 pl-3 text-[13px] shadow-[inset_0_0_0_var(--hair)_color-mix(in_srgb,var(--off)_35%,transparent)]">
      <p className="min-w-0 flex-1 py-1.5 text-ink [overflow-wrap:anywhere]">
        {id && <span className="mr-1.5 font-mono text-[12px] text-mute">{id}</span>}
        {body}
      </p>
      <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss}>
        <XIcon aria-hidden />
      </Button>
    </div>
  )
}

/** The mic: start listening, stop and send, or interrupt the companion. */
function MicButton({ call, companion: c, size }: { call: CallState; companion: Companion; size: 'large' | 'small' }) {
  const ready = call.connection.status === 'ready'
  const waiting = call.phase === 'connecting' || call.phase === 'transcribing' || call.phase === 'thinking'
  const listening = call.phase === 'listening'
  if (call.voiceOff) {
    if (size === 'small') return null
    return (
      <span className="grid size-16 place-items-center rounded-full text-faint shadow-[inset_0_0_0_var(--hair)_var(--line)]" aria-hidden>
        <MicOffIcon className="size-6" />
      </span>
    )
  }
  const label = listening ? 'Stop recording and send' : call.phase === 'speaking' ? `Interrupt ${c.name} and start listening` : 'Start listening'
  return (
    <button
      type="button"
      disabled={waiting || !ready}
      onClick={call.microphone}
      aria-pressed={listening}
      aria-label={label}
      className={cn(
        'grid shrink-0 place-items-center rounded-full outline-none',
        'transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96]',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-pane',
        'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-faint',
        size === 'large' ? 'size-16' : 'size-9 pointer-coarse:size-11',
        listening
          ? 'bg-destructive text-white'
          : size === 'large'
            ? 'bg-accent-strong text-accent-ink hover:bg-[color-mix(in_oklch,var(--accent-strong)_88%,black)]'
            : 'text-mute hover:bg-sunken hover:text-ink',
      )}
    >
      {waiting && call.phase !== 'thinking' ? (
        <span className={cn('rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin', size === 'large' ? 'size-6' : 'size-4')} aria-hidden />
      ) : listening ? (
        <SquareIcon className={cn('fill-current', size === 'large' ? 'size-5' : 'size-3.5')} aria-hidden />
      ) : (
        <MicIcon className={size === 'large' ? 'size-6' : 'size-[18px]'} aria-hidden />
      )}
    </button>
  )
}

/** The voice call, docked in the details pane. */
function CallPanel({ call, companion: c }: { call: CallState; companion: Companion }) {
  const { setDetailsOpen } = useShell()
  const failed = call.connection.status === 'failed'
  const listening = call.phase === 'listening'
  return (
    <section aria-label={`Call with ${c.name}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-2 md:px-4">
        <div className="flex min-w-0 flex-1 flex-col py-2 pl-2 md:pl-0">
          <h2 className="text-[15px] font-semibold">Voice call</h2>
          <p className="text-[12.5px] text-mute">
            {c.name} · voice {c.voice}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close the call panel" className="wide:hidden" onClick={() => setDetailsOpen(false)}>
          <XIcon aria-hidden />
        </Button>
      </header>

      <div data-hb-scroll className="scroller flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto overscroll-contain px-5 pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
        <div className="h-36 w-40">
          <CompanionAvatar companion={c} phase={failed ? 'idle' : call.phase} analyser={call.analyser} decorative />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <p className="font-serif text-[24px] leading-none font-semibold">{c.name}</p>
          <p role="status" aria-live="polite" className="min-h-5 text-[14px] text-balance text-mute">
            {statusText(call, c)}
            {listening && call.recordedAt != null && (
              <span className="ml-1.5 font-medium text-ink">
                <Elapsed since={call.recordedAt} />
              </span>
            )}
          </p>
        </div>

        {failed ? (
          <div className="flex flex-col items-center gap-3">
            <p className="max-w-[30ch] text-[13px] text-mute">The conversation didn’t open. The reason is beside the chat.</p>
            <Button variant="primary" onClick={call.retryOpen}>
              Try again
            </Button>
          </div>
        ) : call.voiceOff ? (
          <div className="flex max-w-[28ch] flex-col items-center gap-3">
            <MicButton call={call} companion={c} size="large" />
            <p className="text-[13px] text-mute">
              Voice needs <code className="font-mono text-[12px]">OPENAI_API_KEY</code> on the server. Type in the conversation; replies arrive as text.
            </p>
          </div>
        ) : (
          <>
            <MicButton call={call} companion={c} size="large" />
            <div className="flex min-h-11 flex-wrap justify-center gap-2">
              {listening && (
                <Button variant="ghost" onClick={call.cancelRecording}>
                  Cancel recording
                </Button>
              )}
              {call.phase === 'speaking' && (
                <Button variant="ghost" onClick={call.stopSpeaking}>
                  <VolumeXIcon aria-hidden />
                  Stop talking
                </Button>
              )}
              {call.hasAudio && call.phase === 'idle' && (
                <Button variant="secondary" onClick={call.playReply}>
                  <Volume2Icon aria-hidden />
                  Play reply
                </Button>
              )}
            </div>
            <p className="text-[12px] text-faint">Up to 10 minutes per recording</p>
          </>
        )}

        <div className="mt-auto flex w-full flex-col items-center gap-2 border-t border-line pt-4 text-[12.5px] text-mute">
          {call.session && !call.session.fallback && (
            <Link to="/topics/$id" params={{ id: call.session.id }} className="font-medium text-accent-strong underline-offset-2 hover:underline">
              Open {c.name}’s topic
            </Link>
          )}
          <p className="max-w-[34ch] text-pretty">
            An original AI character with an AI voice. Your audio goes to OpenAI to be written down.
          </p>
        </div>
      </div>
    </section>
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
  return <span className="tabular-nums">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
}
