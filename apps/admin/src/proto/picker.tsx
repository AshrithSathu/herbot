// Prototype harness (emil-prototype PICKER.md behaviour). Throwaway: nothing
// in production imports src/proto, and it is deleted when the redesign ships.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './picker.css'

export type Variant = { name: string; render: () => ReactNode }

/** Renders one variant at a time, full size, with the floating picker.
 * Keys 1–N and ←/→ switch, R replays; the choice persists in ?v=. */
export function Prototype({ variants, replay = false, position = 'bottom' }: {
  variants: Variant[]
  replay?: boolean
  position?: 'bottom' | 'top'
}) {
  // Start at variant 1 on the server and in the first client render (so they
  // match), then apply ?v= once mounted.
  const [current, setCurrent] = useState(0)
  useLayoutEffect(() => {
    const v = Number(new URLSearchParams(location.search).get('v')) - 1
    if (v > 0 && v < variants.length) setCurrent(v)
  }, [variants.length])
  const [mountKey, setMountKey] = useState(0)
  const nav = useRef<HTMLElement>(null)
  const highlight = useRef<HTMLSpanElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])

  const select = useCallback(
    (i: number) => {
      if (i < 0 || i >= variants.length) return
      setCurrent(i)
      setMountKey((k) => k + 1)
      const url = new URL(location.href)
      url.searchParams.set('v', String(i + 1))
      history.replaceState(history.state, '', url)
    },
    [variants.length],
  )

  const moveHighlight = useCallback(() => {
    const el = items.current[current]
    if (!el || !highlight.current) return
    highlight.current.style.width = `${el.offsetWidth}px`
    highlight.current.style.transform = `translateX(${el.offsetLeft}px)`
  }, [current])

  useLayoutEffect(moveHighlight, [moveHighlight])
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => nav.current?.setAttribute('data-ready', '')))
    window.addEventListener('resize', moveHighlight)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', moveHighlight)
    }
  }, [moveHighlight])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number.parseInt(e.key, 10)
      if (n >= 1 && n <= variants.length) select(n - 1)
      else if (e.key === 'ArrowRight') select((current + 1) % variants.length)
      else if (e.key === 'ArrowLeft') select((current - 1 + variants.length) % variants.length)
      else if (e.key === 'r' || e.key === 'R') setMountKey((k) => k + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [current, select, variants.length])

  return (
    <>
      <div key={mountKey}>{variants[current].render()}</div>
      <nav ref={nav} className="proto-picker" aria-label="Prototype variants" data-position={position === 'top' ? 'top' : undefined}>
        <span ref={highlight} className="proto-picker-highlight" aria-hidden="true" />
        {variants.map((v, i) => (
          <button
            key={v.name}
            ref={(el) => {
              items.current[i] = el
            }}
            type="button"
            className="proto-picker-item"
            data-active={i === current ? '' : undefined}
            aria-current={i === current ? 'true' : undefined}
            onClick={() => select(i)}
          >
            {v.name}
          </button>
        ))}
        {replay && (
          <>
            <span className="proto-picker-divider" aria-hidden="true" />
            <button type="button" className="proto-picker-item proto-picker-replay" aria-label="Replay animation (R)" onClick={() => setMountKey((k) => k + 1)}>
              ↻
            </button>
          </>
        )}
      </nav>
    </>
  )
}
