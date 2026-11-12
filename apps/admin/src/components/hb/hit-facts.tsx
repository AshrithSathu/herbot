// Who wrote a search hit and when ("Agent · Today 20:45"), so identical
// snippets can be told apart: on the Search page and in ⌘K.
import type { SearchHit } from '../../api'
import { cn } from '@/lib/utils'
import { When } from './when'

export function HitFacts({ hit, className }: { hit: Pick<SearchHit, 'sent_at' | 'from_bot'>; className?: string }) {
  if (!hit.sent_at && hit.from_bot == null) return null
  return (
    <span className={cn('flex items-baseline gap-1.5 text-[12.5px] text-faint tabular-nums', className)}>
      {hit.from_bot != null && <span className="font-medium text-mute">{hit.from_bot ? 'Agent' : 'You'}</span>}
      {hit.from_bot != null && hit.sent_at && <span aria-hidden>·</span>}
      {hit.sent_at && <When iso={hit.sent_at} />}
    </span>
  )
}
