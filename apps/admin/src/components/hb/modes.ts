// A topic's standing mode (conversations.mode, /mode in Telegram). Not the
// composer's per-message modes: DeepSearch is one message's job and can't be
// a topic's default, and the stored value "expert" reads as "Think".
export const TOPIC_MODES = [
  { value: 'auto', label: 'Auto', hint: 'Thinks as hard as the question needs' },
  { value: 'fast', label: 'Fast', hint: 'Quick answers, light reasoning' },
  { value: 'expert', label: 'Think', hint: 'Thinks carefully before every answer' },
  { value: 'heavy', label: 'Heavy', hint: 'Several sub-agents work in parallel' },
] as const

export type TopicMode = (typeof TOPIC_MODES)[number]['value']

/** "expert" → "Think"; unknown values show as stored. */
export function topicModeLabel(mode: string): string {
  return TOPIC_MODES.find((m) => m.value === mode)?.label ?? mode
}
