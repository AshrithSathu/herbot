// Throwaway (emil-prototype): shared parts of the /proto/page-companions
// variants. The voice flow is simulated locally (OpenAI and Telegram are off
// in the stress env); the voice status, the agents and the conversation
// history are real. A state strip forces every phase so each can be judged.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { Message as MessageData } from '../../../api'
import { activityQuery, messagesQuery, topicsQuery } from '../../../queries'
import { COMPANIONS, type Companion, type VoicePhase } from '@/components/companion-avatar'
import { AgentList } from '@/components/hb/agent-list'
import { notify } from '@/components/hb/feedback'
import { AgentsHeader, Shell } from '@/components/hb/shell'
import { cn } from '@/lib/utils'

export { COMPANIONS, type Companion }

/** Every state the page has to design. `failed` covers a failed open and a
 * failed turn; `voice-off` is the server without OPENAI_API_KEY. */
export type Phase = VoicePhase | 'failed'
export type Failure = { kind: 'open' | 'turn'; message: string }

/** The real answer to "can the panel hear and speak?" (panel_voice.rs). */
export function useVoiceStatus() {
  return useQuery({
    queryKey: ['proto', 'voice-status'],
    queryFn: async () => {
      const r = await fetch('/api/voice/status')
      if (!r.ok) throw new Error(`Voice status failed (${r.status})`)
      return (await r.json()) as { transcribe: boolean; speak: boolean }
    },
    staleTime: 60_000,
  })
}

/** Worst-case history: the first page of topic 2's hostile messages. */
export function useHostileHistory(limit = 8): MessageData[] {
  const page = useInfiniteQuery(messagesQuery(2))
  return useMemo(() => (page.data?.pages.at(-1)?.messages ?? []).slice(-limit), [page.data, limit])
}

// What the simulated companion says, and what the simulated microphone hears.
const HEARD = [
  'So I keep thinking about the trip, but honestly I can’t decide between Kyoto and Osaka. مع ذلك أريد أن أرى المعابد.',
  'Remind me what we said yesterday about the long report, the one with 16 columns',
]
const REPLY: Record<string, string> = {
  Luma: 'Kyoto, if the temples matter most to you. What would make the trip feel finished?',
  Flint: 'Pick Osaka for food, Kyoto for quiet. One question: which do you want to remember in a year?',
  Pip: 'Try one day in each and see which one you want to go back to. Small experiment, big answer.',
  Orbit: 'Both, honestly. Start in Kyoto, end in Osaka, and let the last night decide.',
}

let nextId = 9_000_000
function message(fromBot: boolean, body: string, voice = false): MessageData {
  return { id: nextId++, sent_at: new Date().toISOString(), from_bot: fromBot, is_voice: voice, body, attachments: [] }
}

/** A forced state from the strip (?s=), for judging every phase. */
export type Forced = 'live' | 'connecting' | 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'failed-open' | 'failed-turn' | 'voice-off' | 'voice-on'
const FORCED: { id: Forced; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'connecting', label: 'Connecting' },
  { id: 'idle', label: 'Idle' },
  { id: 'listening', label: 'Listening' },
  { id: 'transcribing', label: 'Transcribing' },
  { id: 'thinking', label: 'Thinking' },
  { id: 'speaking', label: 'Speaking' },
  { id: 'failed-open', label: 'Open failed' },
  { id: 'failed-turn', label: 'Turn failed' },
  { id: 'voice-off', label: 'Voice off' },
  { id: 'voice-on', label: 'Voice on' },
]

function readForced(): Forced {
  if (typeof window === 'undefined') return 'live'
  const s = new URLSearchParams(location.search).get('s') as Forced | null
  return FORCED.some((f) => f.id === s) ? (s as Forced) : 'live'
}

/** The dark strip at the very bottom that forces a state (harness chrome). */
export function StateStrip({ value, onChange }: { value: Forced; onChange: (f: Forced) => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[2147483646] flex items-center gap-1 overflow-x-auto bg-[rgb(18,18,18)] px-3 py-1.5 text-[12px] text-white/60 [scrollbar-width:none]">
      <span className="shrink-0 pr-2 text-white/40">State</span>
      {FORCED.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onChange(f.id)}
          className={cn('h-7 shrink-0 rounded-full px-2.5 hover:text-white', value === f.id && 'bg-white/15 text-white')}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}

export type Sim = {
  companion: Companion
  phase: Phase
  /** When the current recording started (listening only). */
  recordingSince: number | null
  voiceOff: boolean
  /** The conversation has opened once (later "connecting" is the mic). */
  opened: boolean
  failure: Failure | null
  transcript: MessageData[]
  draft: string
  setDraft: (text: string) => void
  /** The mic: start listening, or stop and send what was heard. */
  mic: () => void
  /** Drop the recording without sending. */
  cancelRecording: () => void
  /** Stop the companion talking. */
  stopSpeaking: () => void
  send: (text: string) => void
  retry: () => void
  dismiss: () => void
  forced: Forced
  force: (f: Forced) => void
}

/** The voice conversation's state machine, simulated: connecting → idle →
 * listening → transcribing → thinking → speaking → idle; a typed message
 * skips straight to thinking; "fail" in a message fails the turn. */
export function useCompanionSim(companion: Companion, past: MessageData[]): Sim {
  const status = useVoiceStatus()
  const [forced, setForced] = useState<Forced>('live')
  const [phase, setPhase] = useState<Phase>('connecting')
  const [opened, setOpened] = useState(false)
  const [recordingSince, setRecordingSince] = useState<number | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [transcript, setTranscript] = useState<MessageData[]>([])
  const [draft, setDraft] = useState('')
  const [voiceOverride, setVoiceOverride] = useState<boolean | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const last = useRef('')
  const heard = useRef(0)

  const serverVoiceOff = status.data ? !status.data.transcribe || !status.data.speak : false
  const voiceOff = voiceOverride ?? serverVoiceOff

  const clear = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }, [])
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms))
  }, [])

  // Opening the conversation (finding or making the companion's topic).
  useEffect(() => {
    setForced(readForced())
    setPhase('connecting')
    setOpened(false)
    setTranscript(past)
    later(900, () => {
      setPhase('idle')
      setOpened(true)
    })
    return clear
    // the history arrives once; re-open only when the companion changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion.name])
  useEffect(() => {
    setTranscript((t) => (t.length === 0 ? past : t))
  }, [past])

  const reply = useCallback(
    (text: string) => {
      last.current = text
      setPhase('thinking')
      later(1400, () => {
        if (/fail/i.test(text)) {
          setFailure({ kind: 'turn', message: 'E-4005: Telegram is disabled; chat and topic creation need the running bot' })
          setTranscript((t) => t.slice(0, -1))
          setDraft(text)
          setPhase('failed')
          return
        }
        setTranscript((t) => [...t, message(true, REPLY[companion.name] ?? 'Tell me more.')])
        if (voiceOff) {
          setPhase('idle')
          return
        }
        setPhase('speaking')
        later(3200, () => setPhase('idle'))
      })
    },
    [companion.name, later, voiceOff],
  )

  const sim: Sim = {
    companion,
    phase,
    recordingSince,
    voiceOff,
    opened,
    failure,
    transcript,
    draft,
    setDraft,
    mic: () => {
      if (voiceOff) return
      if (phase === 'listening') {
        setRecordingSince(null)
        setPhase('transcribing')
        later(900, () => {
          const said = HEARD[heard.current++ % HEARD.length]
          setTranscript((t) => [...t, message(false, said, true)])
          reply(said)
        })
        return
      }
      if (phase === 'speaking') clear()
      if (phase !== 'idle' && phase !== 'speaking' && phase !== 'failed') return
      setFailure(null)
      setPhase('connecting')
      later(450, () => {
        setPhase('listening')
        setRecordingSince(Date.now())
      })
    },
    cancelRecording: () => {
      clear()
      setRecordingSince(null)
      setPhase('idle')
    },
    stopSpeaking: () => {
      clear()
      setPhase('idle')
    },
    send: (text) => {
      if (!text.trim() || phase === 'thinking' || phase === 'transcribing' || phase === 'connecting') return
      setFailure(null)
      setDraft('')
      setTranscript((t) => [...t, message(false, text.trim())])
      reply(text.trim())
    },
    retry: () => {
      if (failure?.kind === 'open') {
        setFailure(null)
        setOpened(false)
        setPhase('connecting')
        later(900, () => {
          setPhase('idle')
          setOpened(true)
        })
        return
      }
      const text = last.current
      setFailure(null)
      setDraft('')
      setTranscript((t) => [...t, message(false, text.replace(/fail/gi, 'try'))])
      reply(text.replace(/fail/gi, 'try'))
    },
    dismiss: () => {
      setFailure(null)
      setPhase('idle')
    },
    forced,
    force: (f) => {
      clear()
      setForced(f)
      const url = new URL(location.href)
      url.searchParams.set('s', f)
      history.replaceState(history.state, '', url)
      setFailure(null)
      setRecordingSince(null)
      switch (f) {
        case 'live':
          setVoiceOverride(null)
          setPhase('idle')
          break
        case 'voice-off':
          setVoiceOverride(true)
          setPhase('idle')
          break
        case 'voice-on':
          setVoiceOverride(false)
          setPhase('idle')
          break
        case 'failed-open':
          setFailure({ kind: 'open', message: 'E-4000: Telegram is disabled; chat and topic creation need the running bot' })
          setPhase('failed')
          break
        case 'failed-turn':
          setFailure({ kind: 'turn', message: 'E-4005: Telegram is disabled; chat and topic creation need the running bot' })
          setDraft('Remind me what we said yesterday about the long report, please fail this one')
          setPhase('failed')
          break
        case 'listening':
          setVoiceOverride(false)
          setRecordingSince(Date.now() - 42_000)
          setPhase('listening')
          break
        case 'speaking':
        case 'transcribing':
        case 'thinking':
          setVoiceOverride(false)
          setPhase(f)
          break
        default:
          setPhase(f)
      }
    },
  }
  // Re-apply a state forced from the URL once, after opening.
  const applied = useRef(false)
  useEffect(() => {
    if (!applied.current && phase === 'idle' && forced !== 'live') {
      applied.current = true
      sim.force(forced)
    }
  })
  return sim
}

/** "0:42" since recording started; tabular so digits don't jiggle. */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return <span className="tabular-nums">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
}

/** What the companion is doing, in words. */
export function phaseLabel(sim: Sim): string {
  const c = sim.companion.name
  if (sim.phase === 'failed') return sim.failure?.kind === 'open' ? 'Couldn’t open the conversation' : 'That message didn’t go through'
  if (sim.voiceOff && (sim.phase === 'idle' || sim.phase === 'speaking')) return `Type a message to ${c}`
  switch (sim.phase) {
    case 'connecting':
      return sim.opened ? 'Opening the microphone…' : 'Opening the conversation…'
    case 'idle':
      return 'Tap the microphone and talk'
    case 'listening':
      return 'Listening. Tap again to send'
    case 'transcribing':
      return 'Writing down what you said…'
    case 'thinking':
      return `${c} is thinking…`
    case 'speaking':
      return `${c} is speaking`
  }
}

/** The avatar's phase (it has no "failed" pose). */
export function avatarPhase(phase: Phase): VoicePhase {
  return phase === 'failed' ? 'idle' : phase
}

/** The real shell around a variant: the agents pane with all 220 agents,
 * the rail, ⌘K. Covers the old production shell while it's reviewed. */
export function Frame({ children, details, strip = false, agentsHeader }: { children: ReactNode; details?: ReactNode; strip?: boolean; agentsHeader?: ReactNode }) {
  const topics = useQuery(topicsQuery)
  const activity = useQuery(activityQuery)
  const working = useMemo(() => new Set((activity.data ?? []).filter((a) => a.in_progress).map((a) => a.conversation_id)), [activity.data])
  return (
    <div className={cn('fixed inset-x-0 top-0 z-[45] [&>div]:h-full!', strip ? 'bottom-10' : 'bottom-0')}>
      <Shell
        topics={topics.data}
        onSignOut={() => notify('Signing out is disabled in the prototype.')}
        details={details}
        agents={
          <AgentList
            topics={topics.data}
            pending={topics.isPending}
            error={topics.error}
            onRetry={() => topics.refetch()}
            isUnread={(t) => t.unread > 0}
            isWorking={(t) => working.has(t.id)}
            header={agentsHeader ?? <AgentsHeader count={topics.data?.length} />}
          />
        }
      >
        {children}
      </Shell>
    </div>
  )
}
