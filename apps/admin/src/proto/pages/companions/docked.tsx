// Variant "Call panel" (axis: a call docked beside the chat). The
// conversation stays in the main pane like any topic; the voice controls sit
// in the details pane as a call panel. Below the three-pane width a compact
// call bar in the conversation header carries the state and opens the panel.
import { useEffect, useRef, useState } from 'react'
import { LoaderIcon, MicIcon, MicOffIcon, PhoneIcon, SquareIcon, VolumeXIcon, XIcon } from 'lucide-react'
import { CompanionAvatar } from '@/components/companion-avatar'
import { Composer } from '@/components/hb/composer'
import { Button, Segmented } from '@/components/hb/controls'
import { splitErrorId } from '@/components/hb/feedback'
import { FailedMessage, Message, MessageRow, Thinking } from '@/components/hb/message'
import { BackToAgents, useShell } from '@/components/hb/shell'
import { cn } from '@/lib/utils'
import { COMPANIONS, Elapsed, Frame, StateStrip, avatarPhase, phaseLabel, useCompanionSim, useHostileHistory, type Sim } from './shared'

type Name = (typeof COMPANIONS)[number]['name']
const OPTIONS = COMPANIONS.map((c) => ({ value: c.name as Name, label: c.name, hint: c.tagline }))

export function Docked() {
  const [name, setName] = useState<Name>(COMPANIONS[0].name)
  const companion = COMPANIONS.find((c) => c.name === name)!
  const history = useHostileHistory()
  const sim = useCompanionSim(companion, history)
  return (
    <>
      <Frame strip details={<CallPanel sim={sim} />}>
        <Conversation sim={sim} name={name} onPick={setName} />
      </Frame>
      <StateStrip value={sim.forced} onChange={sim.force} />
    </>
  )
}

function Conversation({ sim, name, onPick }: { sim: Sim; name: Name; onPick: (n: Name) => void }) {
  const { setDetailsOpen, detailsOpen } = useShell()
  // Wide screens: the call panel is always beside the conversation.
  useEffect(() => {
    if (matchMedia('(min-width: 68.75rem)').matches) setDetailsOpen(true)
  }, [setDetailsOpen])
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = end.current?.closest('[data-hb-scroll]')
    if (el) el.scrollTop = el.scrollHeight
  }, [sim.transcript.length, sim.phase])

  const busy = sim.phase === 'thinking' || sim.phase === 'transcribing' || sim.phase === 'connecting' || sim.phase === 'listening'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2 border-b border-line px-3 pt-2 pb-3 md:px-5">
        <div className="flex min-h-11 items-center gap-2">
          <BackToAgents />
          <h1 className="shrink-0 font-serif text-[20px] leading-none font-semibold">Companions</h1>
          <span className="min-w-2 flex-1" />
          {/* Narrow screens: the call's state, one tap from the panel. */}
          <button
            type="button"
            onClick={() => setDetailsOpen(!detailsOpen)}
            className="flex h-9 min-w-0 shrink items-center gap-2 rounded-full px-3 text-[13px] text-mute shadow-[inset_0_0_0_var(--hair)_var(--line)] pointer-coarse:h-11 wide:hidden"
            aria-label={`Call with ${sim.companion.name}: ${phaseLabel(sim)}. Open the call panel`}
          >
            <span className={cn('size-2 shrink-0 rounded-full', sim.phase === 'listening' ? 'bg-destructive' : sim.phase === 'failed' ? 'bg-off' : sim.phase === 'speaking' ? 'bg-accent-strong' : 'bg-faint')} aria-hidden />
            <span className="min-w-0 truncate">{sim.phase === 'listening' && sim.recordingSince != null ? <>Listening <Elapsed since={sim.recordingSince} /></> : phaseLabel(sim)}</span>
            <PhoneIcon className="size-3.5 shrink-0" aria-hidden />
          </button>
        </div>
        <Segmented label="Companion" value={name} options={OPTIONS} onValueChange={onPick} />
      </header>

      <div data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
        </ol>
        <div ref={end} />
      </div>

      <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
        <div className="mx-auto max-w-3xl">
          <Composer
            key={sim.phase === 'failed' ? 'failed' : 'ok'}
            initialText={sim.phase === 'failed' ? '' : undefined}
            placeholder={`Message ${sim.companion.name}`}
            sending={sim.phase === 'thinking'}
            disabledReason={busy && sim.phase !== 'thinking' ? 'Wait for the voice turn to finish' : sim.phase === 'failed' && sim.failure?.kind === 'open' ? 'The conversation isn’t open' : undefined}
            onSend={({ text }) => sim.send(text)}
          />
        </div>
      </div>
    </div>
  )
}

function CallPanel({ sim }: { sim: Sim }) {
  const { setDetailsOpen } = useShell()
  const waiting = sim.phase === 'connecting' || sim.phase === 'transcribing' || sim.phase === 'thinking'
  const listening = sim.phase === 'listening'
  const { id, text } = splitErrorId(sim.failure?.message ?? '')
  return (
    <section aria-label={`Call with ${sim.companion.name}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="text-[14px] font-medium">Voice</h2>
        <span className="text-[12px] text-faint">· {sim.companion.voice}</span>
        <span className="flex-1" />
        <Button variant="ghost" size="icon" aria-label="Close the call panel" className="wide:hidden" onClick={() => setDetailsOpen(false)}>
          <XIcon aria-hidden />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto px-5 py-8 text-center">
        <div className="h-36 w-40" aria-hidden>
          <CompanionAvatar companion={sim.companion} phase={avatarPhase(sim.phase)} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="font-serif text-[22px] leading-none font-semibold">{sim.companion.name}</p>
          <p role="status" aria-live="polite" className="min-h-5 text-[14px] text-mute">
            {phaseLabel(sim)}
            {listening && sim.recordingSince != null && (
              <span className="ml-1.5 font-medium text-ink">
                <Elapsed since={sim.recordingSince} />
              </span>
            )}
          </p>
        </div>

        {sim.phase === 'failed' && sim.failure?.kind === 'open' ? (
          <div role="alert" className="flex flex-col items-center gap-3">
            <p className="text-[13px] text-mute">
              {id && <span className="mr-1 font-mono text-[12px] text-ink">{id}</span>}
              {text}
            </p>
            <Button variant="primary" onClick={sim.retry}>
              Try again
            </Button>
          </div>
        ) : sim.voiceOff ? (
          <div className="flex max-w-[26ch] flex-col items-center gap-2">
            <span className="grid size-14 place-items-center rounded-full text-faint shadow-[inset_0_0_0_var(--hair)_var(--line)]" aria-hidden>
              <MicOffIcon className="size-5" />
            </span>
            <p className="text-[13px] text-mute">
              Voice needs <code className="font-mono text-[12px]">OPENAI_API_KEY</code>. Type in the conversation; replies arrive as text.
            </p>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={waiting}
              onClick={sim.mic}
              aria-pressed={listening}
              aria-label={listening ? 'Stop recording and send' : sim.phase === 'speaking' ? 'Interrupt and start listening' : 'Start listening'}
              className={cn(
                'grid size-16 place-items-center rounded-full outline-none transition-[background-color,scale] duration-150 ease-out active:scale-[0.96]',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-pane',
                'disabled:bg-sunken disabled:text-mute',
                listening ? 'bg-destructive text-white' : 'bg-accent-strong text-accent-ink hover:bg-[color-mix(in_oklch,var(--accent-strong)_88%,black)]',
              )}
            >
              {waiting ? <LoaderIcon className="size-6 motion-safe:animate-spin" aria-hidden /> : listening ? <SquareIcon className="size-5 fill-current" aria-hidden /> : <MicIcon className="size-6" aria-hidden />}
            </button>
            <div className="flex min-h-11 gap-2">
              {listening && (
                <Button variant="ghost" onClick={sim.cancelRecording}>
                  Cancel
                </Button>
              )}
              {sim.phase === 'speaking' && (
                <Button variant="ghost" onClick={sim.stopSpeaking}>
                  <VolumeXIcon aria-hidden />
                  Stop talking
                </Button>
              )}
            </div>
            <p className="text-[12px] text-faint">Up to 10 minutes per recording</p>
          </>
        )}
      </div>
    </section>
  )
}
