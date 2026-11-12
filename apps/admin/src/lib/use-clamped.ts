// Whether a clamped element actually hides text: measured, not guessed from
// a character count (a 200-character CJK memory can need more lines than a
// 400-character English one). Re-measures when the element resizes, so it
// stays true across widths, fonts loading and rotation. Put the ref on the
// clamped element itself or on a wrapper whose first child is clamped.
import { useCallback, useEffect, useState } from 'react'

export function useClamped<T extends HTMLElement>(): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null)
  const [clamped, setClamped] = useState(false)
  const ref = useCallback((node: T | null) => setEl(node), [])
  useEffect(() => {
    if (!el) return
    const measure = () => {
      const target = (el.firstElementChild as HTMLElement | null) ?? el
      setClamped(target.scrollHeight > target.clientHeight + 1 || target.scrollWidth > target.clientWidth + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  return [ref, clamped]
}
