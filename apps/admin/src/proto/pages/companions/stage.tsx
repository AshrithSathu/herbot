// Variant "Stage" (axis: a full-screen voice stage). Picking a companion is
// its own page; talking takes over the main pane: the companion large in
// the middle, one mic button, the transcript tucked in a drawer below.
import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon, LoaderIcon, MicIcon, MicOffIcon, SendIcon, SquareIcon, VolumeXIcon } from 'lucide-react'
import { CompanionAvatar } from '@/components/companion-avatar'
import { Button, TextInput } from '@/components/hb/controls'
import { splitErrorId } from '@/components/hb/feedback'
import { Message, MessageRow } from '@/components/hb/message'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { cn } from '@/lib/utils'
import { COMPANIONS, Elapsed, Frame, StateStrip, avatarPhase, phaseLabel, useCompanionSim, useHostileHistory, type Companion, type Sim } from './shared'

export function Stage() {
  const [chosen, choose] = useState<Companion | null>(null)
  return (
    <Frame strip={!!chosen}>
      {chosen ? <Talk companion={chosen} onBack={() => choose(null)} /> : <Picker onPick={choose} />}
    </Frame>
  )
}

function Picker({ onPick }: { onPick: (c: Companion) => void }) {
  return (
    <ShellPage
      back={<BackToAgents />}
      title="Companions"
      description="Four original characters to talk with out loud or by typing. Each has its own voice and topic, and shares your Herbot memory."
    >
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {COMPANIONS.map((c) => (
          <li key={c.name} className="flex items-center gap-4 border-b border-line py-4">
            <div className="h-20 w-22 shrink-0" aria-hidden>
              <CompanionAvatar companion={c} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-serif text-[20px] leading-tight font-semibold">{c.name}</h2>
                <span className="text-[12px] text-faint">voice · {c.voice}</span>
              </div>
              <p className="text-[14px] text-mute">{c.tagline}</p>
              <Button variant="secondary" size="sm" className="mt-1 self-start" onClick={() => onPick(c)}>
                <MicIcon aria-hidden />
                Talk with {c.name}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="max-w-[60ch] text-[12.5px] text-faint">
        AI characters with AI-generated voices. Your audio goes to OpenAI to be transcribed. Each conversation is a topic in Telegram, like any other.
      </p>
    </ShellPage>
  )
}

function Talk({ companion, onBack }: { companion: Companion; onBack: () => void }) {
  const history = useHostileHistory()
  const sim = useCompanionSim(companion, history)
  // Typing is the way in when the server can't hear: open the transcript.
  const [drawer, setDrawer] = useState(false)
  useEffect(() => {
    if (sim.voiceOff) setDrawer(true)
  }, [sim.voiceOff])

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 md:px-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-1">
            ‹ Companions
          </Button>
          <span className="flex-1" />
          <span className="text-[12.5px] text-faint">voice · {companion.voice}</span>
        </header>

        <section aria-label={`${companion.name}, voice`} className={cn('flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto px-4 text-center [&>*]:shrink-0', drawer ? 'gap-2.5 py-3' : 'gap-4 py-6')}>
          <div className={cn(drawer ? 'h-24 w-26' : 'h-44 w-48 md:h-56 md:w-60')} aria-hidden>
            <CompanionAvatar companion={companion} phase={avatarPhase(sim.phase)} />
          </div>
          <h1 className={cn('font-serif leading-none font-semibold', drawer ? 'text-[20px]' : 'text-[28px]')}>{companion.name}</h1>
          <p role="status" aria-live="polite" className="min-h-6 text-[15px] text-mute">
            {phaseLabel(sim)}
            {sim.phase === 'listening' && sim.recordingSince != null && (
              <span className="ml-2 font-medium text-ink">
                <Elapsed since={sim.recordingSince} />
              </span>
            )}
          </p>

          {sim.phase === 'failed' && sim.failure ? (
            <FailureNote sim={sim} />
          ) : sim.voiceOff ? (
            <div className="flex max-w-[34ch] flex-col items-center gap-2">
              <span className="grid size-16 place-items-center rounded-full shadow-[inset_0_0_0_var(--hair)_var(--line)] text-faint" aria-hidden>
                <MicOffIcon className="size-6" />
              </span>
              <p className="text-[13.5px] text-mute">
                Herbot needs <code className="font-mono text-[12.5px]">OPENAI_API_KEY</code> to hear and speak. Type below; replies still arrive as text.
              </p>
            </div>
          ) : (
            <MicButton sim={sim} />
          )}

          <div className="flex min-h-11 items-center gap-2">
            {sim.phase === 'speaking' && !sim.voiceOff && (
              <Button variant="ghost" onClick={sim.stopSpeaking}>
                <VolumeXIcon aria-hidden />
                Stop talking
              </Button>
            )}
            {sim.phase === 'listening' && (
              <Button variant="ghost" onClick={sim.cancelRecording}>
                Cancel
              </Button>
            )}
          </div>
          {!sim.voiceOff && !drawer && <p className="text-[12px] text-faint">Up to 10 minutes per recording</p>}
        </section>

        <Drawer sim={sim} open={drawer} onToggle={() => setDrawer((o) => !o)} />
      </div>
      <StateStrip value={sim.forced} onChange={sim.force} />
    </>
  )
}

function MicButton({ sim }: { sim: Sim }) {
  const waiting = sim.phase === 'connecting' || sim.phase === 'transcribing' || sim.phase === 'thinking'
  const listening = sim.phase === 'listening'
  return (
    <button
      type="button"
      disabled={waiting}
      onClick={sim.mic}
      aria-pressed={listening}
      aria-label={listening ? 'Stop recording and send' : sim.phase === 'speaking' ? 'Interrupt and start listening' : 'Start listening'}
      className={cn(
        'grid size-[4.5rem] place-items-center rounded-full outline-none',
        'transition-[background-color,scale] duration-150 ease-out active:scale-[0.96]',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-pane',
        'disabled:cursor-default disabled:bg-sunken disabled:text-mute',
        listening ? 'bg-destructive text-white' : 'bg-accent-strong text-accent-ink hover:bg-[color-mix(in_oklch,var(--accent-strong)_88%,black)]',
      )}
    >
      {waiting ? (
        <LoaderIcon className="size-6 motion-safe:animate-spin" aria-hidden />
      ) : listening ? (
        <SquareIcon className="size-6 fill-current" aria-hidden />
      ) : (
        <MicIcon className="size-7" aria-hidden />
      )}
    </button>
  )
}

function FailureNote({ sim }: { sim: Sim }) {
  const { id, text } = splitErrorId(sim.failure?.message ?? '')
  return (
    <div role="alert" className="flex w-full max-w-[28rem] flex-col items-center gap-3">
      <p className="text-[13.5px] text-mute">
        {id && <span className="mr-1.5 font-mono text-[12.5px] text-ink">{id}</span>}
        {text}
      </p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={sim.retry}>
          {sim.failure?.kind === 'open' ? 'Try again' : 'Send again'}
        </Button>
        {sim.failure?.kind === 'turn' && (
          <Button variant="ghost" onClick={sim.dismiss}>
            Dismiss
          </Button>
        )}
      </div>
      {sim.failure?.kind === 'turn' && <p className="text-[12.5px] text-faint">Your message is back in the box below.</p>}
    </div>
  )
}

/** The transcript, tucked below the stage; typing lives here too. */
function Drawer({ sim, open, onToggle }: { sim: Sim; open: boolean; onToggle: () => void }) {
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sim.transcript.length, open])
  const busy = sim.phase === 'thinking' || sim.phase === 'transcribing' || sim.phase === 'connecting' || sim.phase === 'listening'
  return (
    <div className="shrink-0 border-t border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="stage-transcript"
        className="flex h-11 w-full items-center gap-2 px-4 text-[13.5px] font-medium text-mute hover:text-ink"
      >
        Transcript
        <span className="text-faint tabular-nums">{sim.transcript.length}</span>
        <span className="flex-1" />
        {open ? <ChevronDownIcon className="size-4" aria-hidden /> : <ChevronUpIcon className="size-4" aria-hidden />}
      </button>
      <div id="stage-transcript" hidden={!open}>
        <ol ref={list} aria-live="polite" aria-relevant="additions" className="scroller max-h-[min(22rem,38dvh)] overflow-y-auto overscroll-contain px-4 pb-3">
          {sim.transcript.map((m, i) => (
            <MessageRow key={m.id} side={m.from_bot ? 'agent' : 'you'} grouped={i > 0 && sim.transcript[i - 1].from_bot === m.from_bot}>
              <Message message={m} />
            </MessageRow>
          ))}
        </ol>
        <form
          className="flex items-center gap-2 border-t border-line px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault()
            sim.send(sim.draft)
          }}
        >
          <label htmlFor="stage-draft" className="sr-only">
            Message {sim.companion.name}
          </label>
          <TextInput
            id="stage-draft"
            dir="auto"
            value={sim.draft}
            onChange={(e) => sim.setDraft(e.target.value)}
            placeholder={`Message ${sim.companion.name}`}
            autoComplete="off"
            enterKeyHint="send"
            disabled={busy}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="primary" size="icon" aria-label="Send" disabled={!sim.draft.trim() || busy}>
            <SendIcon aria-hidden />
          </Button>
        </form>
      </div>
    </div>
  )
}
