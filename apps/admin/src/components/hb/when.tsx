// A moment, written the panel's one way (lib/time.ts), with the full date on
// hover and in `dateTime`. Re-renders every 30 s so "12 min ago" stays true.
import { useEffect, useState } from 'react'
import { dayTime, fullDate, listTime, stamp } from '@/lib/time'
import { cn } from '@/lib/utils'

function useNow(every = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now()) // the server's clock may differ from yours
    const id = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(id)
  }, [every])
  return now
}

const FORMATS = { stamp, day: dayTime, list: listTime } as const

/** `stamp` (default) for past events: "12 min ago", "Today 19:37";
 * `day` for scheduled moments: "Tomorrow 09:00"; `list` for dense rows: "19:37", "Fri". */
export function When({ iso, format = 'stamp', className }: { iso: string; format?: keyof typeof FORMATS; className?: string }) {
  const now = useNow()
  return (
    <time dateTime={iso} title={fullDate(iso)} className={cn('tabular-nums', className)} suppressHydrationWarning>
      {FORMATS[format](iso, now)}
    </time>
  )
}
