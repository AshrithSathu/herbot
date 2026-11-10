import { useSyncExternalStore } from 'react'

const noSubscribe = () => () => {}

/** False on the server and during hydration, true after. For anything that
 * depends on the browser (timezone, platform) and must not mismatch. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  )
}

/** The shortcut modifier for this device: ⌘ on Apple, Ctrl elsewhere, and
 * both until the browser has said which. */
export function useModifierKey(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'),
    () => '⌘/Ctrl',
  )
}
