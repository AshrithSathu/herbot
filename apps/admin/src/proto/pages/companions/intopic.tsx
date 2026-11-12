// Variant "Voice mode" (axis: the companion lives inside a topic's
// conversation). Companions are ordinary agents, pinned at the top of the
// agents pane; voice is a mode of the composer: a mic beside it that turns
// the composer into a recording bar, and the companion's state shows inline.
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoaderIcon, MicIcon, MicOffIcon, SquareIcon, VolumeXIcon, XIcon } from 'lucide-react'
import { topicsQuery } from '../../../queries'
import { CompanionAvatar } from '@/components/companion-avatar'
import { Composer } from '@/components/hb/composer'
import { Button } from '@/components/hb/controls'
import { InPlaceError } from '@/components/hb/feedback'
import { FailedMessage, Message, MessageRow, Thinking } from '@/components/hb/message'
import { AgentsHeader, BackToAgents, useShell } from '@/components/hb/shell'
import { cn } from '@/lib/utils'
import { COMPANIONS, Elapsed, Frame, StateStrip, avatarPhase, phaseLabel, useCompanionSim, useHostileHistory, type Companion, type Sim } from './shared'

export function InTopic() {
  const [companion, setCompanion] = useState<Companion>(COMPANIONS[0])
  const history = useHostileHistory()
  const sim = useCompanionSim(companion, history)
  return (
    <>
      <Frame strip agentsHeader={<PinnedCompanions active={companion.name} onPick={setCompanion} />}>
        <Conversation sim={sim} />
      </Frame>
      <StateStrip value={sim.forced} onChange={sim.force} />
    </>
  )
}

/** The agents pane's header, with the four companions pinned under it. */
function PinnedCompanions({ active, onPick }: { active: string; onPick: (c: Companion) => void }) {
  const topics = useQuery(topicsQuery)
  const { showMain } = useShell()
  return (
    <div className="shrink-0">
      <AgentsHeader count={topics.data?.length} />
      <div className="px-2 pb-2">
        <p className="px-2 pb-1 text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Companions</p>
        <ul aria-label="Companions">
          {COMPANIONS.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                aria-current={active === c.name ? 'true' : undefined}
                onClick={() => {
                  onPick(c)
                  showMain()
                }}
                className={cn(
                  'flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[14px] transition-[background-color] duration-150 ease-out hover:bg-sunken',
                  active === c.name && 'bg-accent-soft hover:bg-accent-soft',
                )}
              >
                <span className="h-8 w-9 shrink-0" aria-hidden>
                  <CompanionAvatar companion={c} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="shrink-0 text-[12px] text-faint">{c.voice}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mx-2 mt-2 h-[var(--hair)] bg-line" />
      </div>
    </div>
  )
}

function Conversation({ sim }: { sim: Sim }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = end.current?.closest('[data-hb-scroll]')
    if (el) el.scrollTop = el.scrollHeight
  }, [sim.transcript.length, sim.phase])
  const recording = sim.phase === 'listening' || sim.phase === 'transcribing' || (sim.phase === 'connecting' && sim.opened)
  const openFailed = sim.phase === 'failed' && sim.failure?.kind === 'open'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line px-3 md:px-5">
        <BackToAgents />
        <span className="h-10 w-11 shrink-0" aria-hidden>
          <CompanionAvatar companion={sim.companion} phase={avatarPhase(sim.phase)} />
        </span>
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-[15px] font-semibold">{sim.companion.name}</h1>
          <p role="status" aria-live="polite" className="truncate text-[12.5px] text-mute">
            {phaseLabel(sim)}
          </p>
        </div>
      </header>

      <div data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {openFailed ? (
          <div className="mx-auto max-w-3xl px-4 md:px-6">
            <InPlaceError title={`Couldn’t open ${sim.companion.name}’s conversation`} error={sim.failure!.message} onRetry={sim.retry} />
          </div>
        ) : (
          <ol aria-label={`Conversation with ${sim.companion.name}`} aria-live="polite" aria-relevant="additions" className="mx-auto flex max-w-3xl flex-col px-3 py-5 md:px-6">
            {sim.transcript.map((m, i) => (
              <MessageRow key={m.id} side={m.from_bot ? 'agent' : 'you'} grouped={i > 0 && sim.transcript[i - 1].from_bot === m.from_bot}>
                <Message message={m} />
              </MessageRow>
            ))}
            {sim.phase === 'failed' && sim.failure?.kind === 'turn' && (
              <MessageRow side="you">
                <FailedMessage
                  body={sim.draft || 'Remind me what we said yesterday about the long report'}
                  error={sim.failure.message}
                  sentAt={new Date().toISOString()}
                  onRetry={sim.retry}
                  onEdit={sim.dismiss}
                  onDiscard={() => {
                    sim.setDraft('')
                    sim.dismiss()
                  }}
                />
              </MessageRow>
            )}
            {sim.phase === 'thinking' && (
              <MessageRow side="agent">
                <Thinking since={Date.now()} label={`${sim.companion.name} is thinking`} />
              </MessageRow>
            )}
            {sim.phase === 'speaking' && !sim.voiceOff && (
              <MessageRow side="agent">
                <div className="flex items-center gap-2 text-[13px] text-mute">
                  <Level />
                  {sim.companion.name} is speaking
                  <Button variant="ghost" size="sm" onClick={sim.stopSpeaking}>
                    <VolumeXIcon aria-hidden />
                    Stop
                  </Button>
                </div>
              </MessageRow>
            )}
          </ol>
        )}
        <div ref={end} />
      </div>

      <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          {recording ? (
            <RecordingBar sim={sim} />
          ) : (
            <div className="min-w-0 flex-1">
              <Composer
                placeholder={`Message ${sim.companion.name}`}
                sending={sim.phase === 'thinking'}
                disabledReason={openFailed ? 'The conversation isn’t open' : sim.phase === 'connecting' ? 'Opening the conversation…' : undefined}
                onSend={({ text }) => sim.send(text)}
              />
            </div>
          )}
          {!recording && <MicToggle sim={sim} />}
        </div>
        {sim.voiceOff && (
          <p className="mx-auto mt-1.5 max-w-3xl text-[12px] text-faint">
            Voice needs <code className="font-mono text-[11.5px]">OPENAI_API_KEY</code>; typing works.
          </p>
        )}
      </div>
    </div>
  )
}

function MicToggle({ sim }: { sim: Sim }) {
  const busy = sim.phase === 'thinking' || sim.phase === 'connecting' || (sim.phase === 'failed' && sim.failure?.kind === 'open')
  return (
    <Button
      variant="secondary"
      size="icon"
      className="mb-1 size-11 rounded-full"
      disabled={sim.voiceOff || busy}
      onClick={sim.mic}
      aria-label={sim.voiceOff ? 'Voice is off: Herbot needs OPENAI_API_KEY' : sim.phase === 'speaking' ? 'Interrupt and talk' : `Talk to ${sim.companion.name}`}
      title={sim.voiceOff ? 'Voice needs OPENAI_API_KEY' : undefined}
    >
      {sim.voiceOff ? <MicOffIcon aria-hidden /> : <MicIcon aria-hidden />}
    </Button>
  )
}

/** The composer while recording: cancel, the running time, send. */
function RecordingBar({ sim }: { sim: Sim }) {
  const transcribing = sim.phase === 'transcribing'
  const opening = sim.phase === 'connecting'
  return (
    <div role="group" aria-label="Recording" className="mb-1 flex min-h-[3.25rem] min-w-0 flex-1 items-center gap-3 rounded-2xl bg-pane px-2 shadow-raised">
      <Button variant="ghost" size="icon" aria-label="Cancel recording" disabled={transcribing} onClick={sim.cancelRecording}>
        <XIcon aria-hidden />
      </Button>
      <span className="flex min-w-0 flex-1 items-center gap-2.5 text-[14px]">
        {transcribing || opening ? (
          <>
            <LoaderIcon className="size-4 shrink-0 text-mute motion-safe:animate-spin" aria-hidden />
            <span className="truncate text-mute">{transcribing ? 'Writing down what you said…' : 'Opening the microphone…'}</span>
          </>
        ) : (
          <>
            <span className="size-2.5 shrink-0 rounded-full bg-destructive motion-safe:animate-pulse" aria-hidden />
            <span className="font-medium">{sim.recordingSince != null && <Elapsed since={sim.recordingSince} />}</span>
            <Level />
            <span className="sr-only">Recording</span>
          </>
        )}
      </span>
      <Button
        variant="primary"
        size="icon"
        className="rounded-full"
        aria-label="Stop and send"
        disabled={transcribing || opening}
        onClick={sim.mic}
      >
        <SquareIcon className="fill-current" aria-hidden />
      </Button>
    </div>
  )
}

/** A small level meter; still under reduced motion. */
function Level() {
  return (
    <span className="flex h-4 items-center gap-[3px]" aria-hidden>
      {[0.5, 0.9, 0.6, 1, 0.7].map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current text-mute motion-safe:animate-[level_900ms_ease-in-out_infinite]"
          style={{ height: `${h * 100}%`, animationDelay: `${i * 120}ms` }}
        />
      ))}
      <style>{'@keyframes level { 50% { transform: scaleY(0.4) } }'}</style>
    </span>
  )
}
