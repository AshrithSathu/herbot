import { useSyncExternalStore } from 'react'

/** The kit's breakpoint between two panes and three (68.75rem). */
export const WIDE_QUERY = '(min-width: 68.75rem)'

/** Whether a media query matches, kept live. `server` is the value during
 * server rendering and hydration (pick the common case to avoid a flash). */
export function useMedia(query: string, server = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => matchMedia(query).matches,
    () => server,
  )
}
