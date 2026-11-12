// Known failure reasons from herbot-core, in plain words for the middle of a
// sentence. Raw server text ("database error", "Telegram is off: Herbot
// can't send messages…") never goes into a sentence;
// unknown reasons stay out of it (the error itself is in Logs).
type Reason = { sentence: string; because: string }

const KNOWN: [RegExp, Reason][] = [
  [/telegram is (disabled|off)|telegram isn.t connected|bot isn.t running/i, { sentence: 'Telegram isn’t connected.', because: 'Telegram isn’t connected' }],
  [/not enough rights to create a topic|manage topics/i, { sentence: 'The bot needs the “Manage topics” right in the Herbot group.', because: 'the bot can’t create topics in the Herbot group' }],
  [/database error|db: unreachable|can.t reach herbot-core|fetch failed|econnrefused|bad gateway|service unavailable/i, { sentence: 'Herbot’s server isn’t answering.', because: 'Herbot’s server isn’t answering' }],
]

/** A known reason, or null for anything else. */
export function plainReason(message: string | null | undefined): Reason | null {
  if (!message) return null
  for (const [pattern, reason] of KNOWN) if (pattern.test(message)) return reason
  return null
}
