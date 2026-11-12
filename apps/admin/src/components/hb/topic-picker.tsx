// Picking a topic in a form (New task, moving things between topics): a
// combobox over every topic, typed to filter (case and accents folded), with
// hostile names kept inside their rows. Escape closes the list, not the
// dialog around it (dialogs.tsx defers to an open combobox).
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CheckIcon, ChevronsUpDownIcon, HashIcon, MessageCircleIcon } from 'lucide-react'
import type { Topic } from '../../api'
import { exact } from '../../format'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { fold } from './agent-list'
import { topicTone } from './status'

type Props = {
  id: string
  topics: Topic[]
  value: number | null
  onChange: (id: number | null) => void
  /** Explains why a topic that's off or not set up still can be picked. */
  warnUnready?: (label: string) => string
  'aria-invalid'?: true
  'aria-describedby'?: string
}

export function TopicPicker({ id, topics, value, onChange, warnUnready, ...aria }: Props) {
  const listId = useId()
  const selected = topics.find((t) => t.id === value) ?? null
  const [text, setText] = useState(selected?.name ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => setText(selected?.name ?? ''), [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const typed = selected && text === selected.name ? '' : text
  const matches = useMemo(() => {
    const wanted = fold(typed.trim())
    return wanted ? topics.filter((t) => fold(t.name).includes(wanted)) : topics
  }, [topics, typed])
  useEffect(() => setActive(0), [typed])
  useEffect(() => {
    // Statement body: scrollIntoView may return a promise; never return it.
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const pick = (t: Topic) => {
    onChange(t.id)
    setText(t.name)
    setOpen(false)
  }
  const warn = selected ? topicTone(selected) : null

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        {...aria}
        value={text}
        dir="auto"
        placeholder={`Search ${exact(topics.length)} topics`}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          if (selected && e.target.value !== selected.name) onChange(null)
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((i) => Math.min(i + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault()
            pick(matches[active])
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          }
        }}
        className="h-10 w-full min-w-0 rounded-lg bg-sunken pr-9 pl-3 text-base text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] outline-none placeholder:text-faint focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] pointer-fine:text-[14px]"
      />
      <ChevronsUpDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-mute" />
      {open && (
        <ul ref={list} id={listId} role="listbox" aria-label="Topics" className="scroller absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg bg-pane p-1 shadow-raised">
          {matches.length === 0 ? (
            <li className="px-3 py-2.5 text-[14px] text-mute">No topic matches that name.</li>
          ) : (
            matches.map((t, i) => {
              const s = topicTone(t)
              const Icon = t.is_general ? MessageCircleIcon : HashIcon
              return (
                <li
                  key={t.id}
                  id={`${listId}-${t.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={t.id === value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(t)}
                  onMouseMove={() => setActive(i)}
                  className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[14px] pointer-fine:min-h-9', i === active && 'bg-sunken')}
                >
                  <Icon aria-hidden className="size-3.5 shrink-0 text-mute" />
                  <UserText className="min-w-0 flex-1">{t.name}</UserText>
                  {s.tone !== 'ok' && <span className="shrink-0 text-[12px] text-mute">{s.short}</span>}
                  <CheckIcon aria-hidden className={cn('size-4 shrink-0', t.id === value ? 'opacity-100' : 'opacity-0')} />
                </li>
              )
            })
          )}
        </ul>
      )}
      {warn && warn.tone !== 'ok' && (
        <p className="mt-1.5 text-[12.5px] text-warning">
          {warnUnready ? warnUnready(warn.label) : `This topic is ${warn.label.toLowerCase()}; it acts once it’s on and set up.`}
        </p>
      )}
    </div>
  )
}
