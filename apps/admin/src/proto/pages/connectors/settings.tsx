// Variant "Settings" (axis: connectors as one section of a settings page
// that also summarises Personalize, Memory, Voice and Telegram, each linking
// to where it's changed). An index of sections on wide screens.
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { charCount } from '../../../format'
import { memoriesQuery, overviewQuery, preferencesQuery } from '../../../queries'
import { InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { BackToAgents, ShellPage } from '@/components/hb/shell'
import { Dot } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { Frame, useVoiceStatus } from '../companions/shared'
import { TOOL_DOES, reach, useConnectors } from './shared'

const SECTIONS = [
  { id: 'you', label: 'You' },
  { id: 'memory', label: 'Memory' },
  { id: 'voice', label: 'Voice' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'connectors', label: 'Connectors' },
] as const

const MAX_MEMORIES = 200

export function Settings() {
  return (
    <Frame>
      <ShellPage wide back={<BackToAgents />} title="Settings" description="What every agent shares, and what they can reach. Each section links to where you change it.">
        <div className="grid gap-10 wide:grid-cols-[10rem_minmax(0,1fr)]">
          <nav aria-label="Settings sections" className="hidden wide:block">
            <ul className="sticky top-0 flex flex-col gap-0.5 text-[14px]">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="flex h-9 items-center rounded-lg px-2.5 text-mute transition-[background-color,color] duration-150 ease-out hover:bg-sunken hover:text-ink">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex min-w-0 flex-col gap-12">
            <You />
            <MemorySection />
            <Voice />
            <Telegram />
            <Connectors />
          </div>
        </div>
      </ShellPage>
    </Frame>
  )
}

function Section({ id, title, link, children }: { id: string; title: string; link?: { to: '/personalize' | '/memory'; label: string }; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
        <h2 id={`${id}-h`} className="text-[15px] font-semibold">
          {title}
        </h2>
        {link && (
          <Link to={link.to} className="relative inline-flex items-center gap-1 text-[13.5px] font-medium text-accent-strong before:absolute before:-inset-x-2 before:-inset-y-3 hover:underline">
            {link.label}
            <ArrowRightIcon className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-1 py-1 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <span className="text-[14px] text-mute">{label}</span>
      <div className="flex min-w-0 flex-col gap-0.5 text-[14px]">
        {value}
        {hint && <span className="text-[12.5px] text-faint">{hint}</span>}
      </div>
    </div>
  )
}

function You() {
  const q = useQuery(preferencesQuery)
  return (
    <Section id="you" title="You" link={{ to: '/personalize', label: 'Edit in Personalize' }}>
      {q.isPending ? (
        <ListSkeleton rows={2} />
      ) : q.isError ? (
        <InPlaceError title="Couldn’t read your preferences" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <Row
            label="Custom instructions"
            value={<UserText lines={2} as="p" fallback="None yet">{q.data.custom_instructions}</UserText>}
            hint={`${charCount(q.data.custom_instructions).toLocaleString('en-GB')} of 3,000 characters`}
          />
          <Row
            label="About you"
            value={<UserText lines={2} as="p" fallback="Nothing yet">{q.data.about_you}</UserText>}
            hint={`${charCount(q.data.about_you).toLocaleString('en-GB')} of 1,500 characters`}
          />
        </>
      )}
    </Section>
  )
}

function MemorySection() {
  const q = useQuery(memoriesQuery)
  const n = q.data?.length ?? 0
  return (
    <Section id="memory" title="Memory" link={{ to: '/memory', label: 'Manage memory' }}>
      {q.isPending ? (
        <ListSkeleton rows={1} lines={1} />
      ) : q.isError ? (
        <InPlaceError title="Couldn’t read memories" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Row
          label="Shared memories"
          value={
            <span className={cn('tabular-nums', n > MAX_MEMORIES && 'text-destructive')}>
              {n.toLocaleString('en-GB')} of {MAX_MEMORIES}
            </span>
          }
          hint={n > MAX_MEMORIES ? `Over the limit: agents can’t remember anything new until you forget ${(n - MAX_MEMORIES).toLocaleString('en-GB')}.` : 'Every topic’s agent can recall these.'}
        />
      )}
    </Section>
  )
}

function OnOff({ on, labels = ['On', 'Off'] }: { on: boolean; labels?: [string, string] }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Dot tone={on ? 'ok' : 'off'} />
      {on ? labels[0] : labels[1]}
    </span>
  )
}

function Voice() {
  const q = useVoiceStatus()
  return (
    <Section id="voice" title="Voice">
      {q.isPending ? (
        <ListSkeleton rows={2} lines={1} />
      ) : q.isError ? (
        <InPlaceError title="Couldn’t check voice" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <Row label="Hearing voice notes" value={<OnOff on={q.data.transcribe} />} hint={!q.data.transcribe ? 'Set OPENAI_API_KEY for herbot-core, then restart it.' : 'OpenAI transcription'} />
          <Row label="Spoken replies" value={<OnOff on={q.data.speak} />} hint={!q.data.speak ? 'Same key; each topic turns spoken replies on in its details.' : 'Each topic chooses its voice'} />
        </>
      )}
    </Section>
  )
}

function Telegram() {
  const q = useQuery(overviewQuery)
  return (
    <Section id="telegram" title="Telegram">
      {q.isPending ? (
        <ListSkeleton rows={1} lines={1} />
      ) : q.isError ? (
        <InPlaceError title="Couldn’t check the bot" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <Row
            label="Bot"
            value={<OnOff on={!!q.data.bot} labels={[`Connected as @${q.data.bot ?? ''}`, 'Not connected']} />}
            hint={!q.data.bot ? 'Set TELEGRAM_BOT_TOKEN for herbot-core. Until then agents can’t receive or send messages.' : undefined}
          />
          <Row label="Agents run on" value={<span className="font-mono text-[13px]">{q.data.agent}</span>} />
        </>
      )}
    </Section>
  )
}

function Connectors() {
  const q = useConnectors()
  return (
    <Section id="connectors" title="Connectors">
      {q.isPending ? (
        <ListSkeleton rows={4} lines={1} />
      ) : q.isError ? (
        <InPlaceError title="Couldn’t read the connectors" error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : (
        <>
          <Row
            label="MCP servers"
            value={
              q.data.servers.length === 0 ? (
                <span className="text-mute">
                  None. Add one under <code className="font-mono text-[12.5px]">[mcp_servers]</code> in <code className="font-mono text-[12.5px]">~/.codex/config.toml</code>.
                </span>
              ) : (
                <ul className="flex flex-col">
                  {q.data.servers.map((s) => (
                    <li key={`${s.source}:${s.name}`} className="flex min-w-0 items-baseline gap-2 border-b border-line py-2 last:border-0">
                      <UserText className="min-w-0 shrink font-medium">{s.name}</UserText>
                      <span className="shrink-0 text-[12.5px] text-faint">
                        {reach(s).kind} · {s.source}
                      </span>
                      <UserText className="min-w-0 flex-1 text-right font-mono text-[12px] text-faint">{reach(s).where}</UserText>
                    </li>
                  ))}
                </ul>
              )
            }
          />
          <Row
            label="Herbot’s tools"
            value={
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {q.data.tools.map((t) => (
                  <li key={t.name} className="flex min-w-0 flex-col" title={TOOL_DOES[t.name]}>
                    <span className="flex items-baseline gap-2">
                      <code className="font-mono text-[13px]">{t.name}</code>
                      {t.scope !== 'every topic' && <span className="text-[12px] text-faint">{t.scope}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            }
            hint="Every topic can use these on its own history; asking and posting to other topics is General’s."
          />
        </>
      )}
    </Section>
  )
}
