// A topic's details (docs/design/DECISIONS.md, "Details pane": Summary).
// Facts read first as quiet rows; tap one to edit just that row, which saves
// on its own and reports its own failure; switches flip at once; the danger
// zone is last, each action confirmed with the guard its risk calls for.
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ExternalLinkIcon } from 'lucide-react'
import { saveMode, savePurpose, saveVoice, setEnabled, wipeTopic, type Topic, type TopicDetail } from '../../api'
import { PURPOSE_MAX, ago, charCount, compact, exact, purposeProblem } from '../../format'
import { keys } from '../../queries'
import { Button, Field, Segmented, TextArea, type Choice } from '@/components/hb/controls'
import { DangerAction, DangerZone, DetailRow, DetailSwitch, DetailsPane, DetailsSection } from '@/components/hb/details-pane'
import { notify, notifyFailure } from '@/components/hb/feedback'
import { TOPIC_MODES, topicModeLabel, type TopicMode } from '@/components/hb/modes'
import { StatusDot, topicTone } from '@/components/hb/status'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

export const VOICES = [
  ['alloy', 'Balanced'], ['ash', 'Grounded'], ['ballad', 'Expressive'],
  ['coral', 'Warm'], ['echo', 'Clear'], ['fable', 'Storytelling'],
  ['onyx', 'Deep'], ['nova', 'Bright'], ['sage', 'Calm'],
  ['shimmer', 'Gentle'], ['verse', 'Versatile'], ['marin', 'Conversational'], ['cedar', 'Steady'],
] as const

const voiceLabel = (v: string) => VOICES.find(([id]) => id === v)?.[1] ?? v

/** Patches the topic in the list and the detail caches, then refetches. */
export function useTopicCache(id: number) {
  const client = useQueryClient()
  return {
    patch(next: Partial<Topic>) {
      client.setQueryData<TopicDetail>(keys.topic(id), (old) => (old ? { ...old, conversation: { ...old.conversation, ...next } } : old))
      client.setQueryData<Topic[]>(keys.topicList, (old) => old?.map((t) => (t.id === id ? { ...t, ...next } : t)))
    },
    refresh: () => client.invalidateQueries({ queryKey: keys.topics }),
  }
}

export function TopicDetails({ detail, onClose }: { detail: TopicDetail; onClose: () => void }) {
  const t = detail.conversation
  return (
    <DetailsPane
      title={t.name}
      onClose={onClose}
      subtitle={
        <>
          <StatusDot status={topicTone(t)} />
          <span aria-hidden>·</span>
          <UserText className="min-w-0 flex-1" fallback="Untitled group">
            {t.group}
          </UserText>
        </>
      }
    >
      <DetailsSection>
        <DetailRow
          label="Purpose"
          block
          value={
            <UserText as="p" lines={3} fallback="No purpose yet" className="text-[13.5px] leading-relaxed">
              {t.purpose}
            </UserText>
          }
          edit={(done) => <PurposeEditor topic={t} onDone={done} />}
        />
      </DetailsSection>
      <Behaviour topic={t} />
      <About detail={detail} />
      <Danger topic={t} />
    </DetailsPane>
  )
}

function Behaviour({ topic: t }: { topic: Topic }) {
  const cache = useTopicCache(t.id)
  const enabled = useMutation({
    mutationFn: (on: boolean) => setEnabled({ data: { id: t.id, enabled: on } }),
    onMutate: (on) => {
      const before = t.enabled
      cache.patch({ enabled: on })
      return { before }
    },
    onError: (_e, _on, ctx) => ctx && cache.patch({ enabled: ctx.before }),
    onSettled: () => void cache.refresh(),
  })
  const mode = useMutation({
    mutationFn: (m: TopicMode) => saveMode({ data: { id: t.id, mode: m } }),
    onSuccess: (_r, m) => cache.patch({ mode: m }),
    onSettled: () => void cache.refresh(),
  })
  const voice = useMutation({
    mutationFn: (s: { voice_replies: boolean; voice: string }) => saveVoice({ data: { id: t.id, ...s } }),
    onMutate: (s) => {
      const before = { voice_replies: t.voice_replies, voice: t.voice }
      cache.patch(s)
      return { before }
    },
    onError: (_e, _s, ctx) => ctx && cache.patch(ctx.before),
    onSettled: () => void cache.refresh(),
  })

  return (
    <DetailsSection title="Behaviour">
      <DetailSwitch
        label="Answering"
        description={t.enabled ? 'Messages here go to the agent' : 'Switched off: messages here are ignored'}
        checked={enabled.isPending ? (enabled.variables ?? t.enabled) : t.enabled}
        onCheckedChange={(on) => enabled.mutate(on)}
        pending={enabled.isPending}
        error={enabled.error && `Couldn’t switch it ${enabled.variables ? 'on' : 'off'}. ${enabled.error.message}`}
      />
      <DetailRow
        label="Mode"
        value={
          <span className={cn(mode.isPending && 'text-faint')}>
            {topicModeLabel(mode.isPending ? (mode.variables ?? t.mode) : t.mode)}
            {mode.isPending ? ' · saving…' : ''}
          </span>
        }
        edit={(done) => (
          <div className="flex flex-col gap-2">
            <Segmented
              label="Mode"
              value={(mode.isPending ? mode.variables : t.mode) as TopicMode}
              options={TOPIC_MODES as unknown as Choice<TopicMode>[]}
              disabled={mode.isPending}
              onValueChange={(v) =>
                mode.mutate(v, {
                  onSuccess: done,
                  onError: (e) => notifyFailure(`Couldn’t change the mode. ${e.message}`),
                })
              }
            />
            <div>
              <Button size="sm" variant="ghost" onClick={done}>
                Done
              </Button>
            </div>
          </div>
        )}
      />
      {mode.error && !mode.isPending && <p className="pb-1 text-[12.5px] text-destructive">Couldn’t change the mode. {mode.error.message}</p>}
      <DetailSwitch
        label="Spoken replies"
        description="Replies also arrive as voice notes"
        checked={t.voice_replies}
        onCheckedChange={(on) => voice.mutate({ voice_replies: on, voice: t.voice })}
        pending={voice.isPending}
        error={voice.error && `Couldn’t save the voice settings. ${voice.error.message}`}
      />
      <DetailRow
        label="Voice"
        value={voiceLabel(t.voice)}
        edit={(done) => (
          <Field label="Voice">
            {(props) => (
              <select
                {...props}
                value={t.voice}
                disabled={voice.isPending}
                onChange={(e) => voice.mutate({ voice_replies: t.voice_replies, voice: e.target.value }, { onSuccess: done })}
                className="h-11 w-full rounded-lg bg-sunken px-3 text-base text-ink outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] pointer-fine:h-10 pointer-fine:text-[14px]"
              >
                {VOICES.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
      />
      <DetailRow label="Language" value={<span title="Set it with /language in the topic">{t.language || 'English'}</span>} />
      <DetailRow label="Private" value={<span title="Set it with /private in the topic">{t.private_mode ? 'On: nothing is stored' : 'Off'}</span>} />
    </DetailsSection>
  )
}

function About({ detail }: { detail: TopicDetail }) {
  const t = detail.conversation
  const [showAgents, setShowAgents] = useState(false)
  const agentsMd = detail.agents_md ?? ''
  const long = agentsMd.split('\n').length > 14
  return (
    <DetailsSection title="Activity">
      <DetailRow label="Messages" value={<span className="tabular-nums" title={exact(t.messages)}>{compact(t.messages)}</span>} />
      <DetailRow label="Last active" value={<span suppressHydrationWarning>{ago(t.last_activity)}</span>} />
      <DetailRow
        label="T3 thread"
        value={
          t.thread_link ? (
            <a href={t.thread_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-strong underline-offset-2 hover:underline">
              Open in T3 <ExternalLinkIcon aria-hidden className="size-3.5" />
            </a>
          ) : (
            <span className="text-mute">Starts with the next message</span>
          )
        }
      />
      <div className="flex flex-col gap-1.5 py-2">
        <dt className="text-[13.5px] text-mute">AGENTS.md</dt>
        <dd className="flex min-w-0 flex-col gap-1.5">
          {detail.agents_md_path && (
            <UserText className="font-mono text-[12px] text-faint">{`agents/${detail.agents_md_path}`}</UserText>
          )}
          {agentsMd ? (
            <>
              <pre
                aria-label="AGENTS.md contents"
                className={cn(
                  'scroller overflow-auto rounded-lg bg-sunken p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]',
                  long && !showAgents && 'max-h-56 [mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]',
                )}
              >
                {agentsMd}
              </pre>
              {long && (
                <button
                  type="button"
                  aria-expanded={showAgents}
                  onClick={() => setShowAgents((o) => !o)}
                  className="relative self-start text-[13px] font-medium text-accent-strong before:absolute before:-inset-x-2 before:-inset-y-3 hover:underline"
                >
                  {showAgents ? 'Show less' : 'Show all of AGENTS.md'}
                </button>
              )}
            </>
          ) : (
            <span className="text-[13px] text-mute">
              {t.purpose ? 'Not on disk yet. Saving the purpose writes it.' : 'Written once the topic has a purpose.'}
            </span>
          )}
        </dd>
      </div>
    </DetailsSection>
  )
}

function Danger({ topic: t }: { topic: Topic }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  async function wipe(kind: 'new' | 'forget') {
    const result = await wipeTopic({ data: { id: t.id, kind } })
    await Promise.all([
      client.resetQueries({ queryKey: keys.messages(t.id) }),
      client.invalidateQueries({ queryKey: keys.topics }),
    ])
    notify(result.message)
    if (kind === 'forget') await navigate({ to: '/topics/$id', params: { id: t.id }, search: {} })
  }
  return (
    <DangerZone>
      <DangerAction
        title="Start a clean slate"
        description="Deletes its history and threads; keeps the purpose."
        actionLabel="Start a clean slate"
        subject={t.name}
        consequences={['Deletes its message history in Herbot', 'Deletes its Codex threads in T3']}
        keeps="Keeps the purpose, AGENTS.md, its tasks and the Telegram topic."
        guard={{ kind: 'separated' }}
        onConfirm={() => wipe('new')}
      />
      <DangerAction
        title="Forget this topic"
        description="Deletes everything, including the purpose."
        actionLabel="Forget this topic"
        subject={t.name}
        consequences={['Deletes the history, the threads, the purpose and AGENTS.md', 'The next message asks what it should be']}
        keeps="Keeps the Telegram topic and shared memories."
        guard={{ kind: 'typed', word: 'forget' }}
        onConfirm={() => wipe('forget')}
      />
    </DangerZone>
  )
}

function PurposeEditor({ topic: t, onDone }: { topic: Topic; onDone: () => void }) {
  const cache = useTopicCache(t.id)
  const [text, setText] = useState(t.purpose ?? '')
  const [touched, setTouched] = useState(false)
  const problem = purposeProblem(text)
  const chars = charCount(text.trim())
  const save = useMutation({
    mutationFn: () => savePurpose({ data: { id: t.id, purpose: text.trim() } }),
    onSuccess: (updated) => {
      cache.patch(updated)
      void cache.refresh()
      notify('Purpose saved. AGENTS.md was rewritten.')
      onDone()
    },
  })
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (!problem) save.mutate()
      }}
    >
      <Field
        label="Purpose"
        error={(touched && problem) || (save.error && `Couldn’t save it. ${save.error.message}`) || undefined}
        counter={{ count: chars, max: PURPOSE_MAX }}
      >
        {(props) => (
          <TextArea
            {...props}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
              if (e.key === 'Escape') onDone()
            }}
            rows={8}
            dir="auto"
            autoFocus={typeof window !== 'undefined' && matchMedia('(pointer: fine)').matches}
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" pending={save.isPending}>
          Save purpose
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
