import { useEffect, useRef, type CSSProperties } from 'react'
export type VoicePhase =
  'idle' | 'connecting' | 'listening' | 'transcribing' | 'thinking' | 'speaking'
export interface Companion {
  name: string
  kind: 'moth' | 'pebble' | 'sprout' | 'comet'
  voice: string
  hue: number
  tagline: string
  purpose: string
}
export const COMPANIONS: Companion[] = [
  {
    name: 'Luma',
    kind: 'moth',
    voice: 'shimmer',
    hue: 55,
    tagline: 'A little light for late thoughts.',
    purpose:
      'You are Luma, an original lantern moth companion. Warm, curious and gently witty, you help Ashrith untangle thoughts with thoughtful questions. Keep spoken answers brief and natural. Never pretend to be human or a therapist.',
  },
  {
    name: 'Flint',
    kind: 'pebble',
    voice: 'cedar',
    hue: 235,
    tagline: 'Steady company. A dry sense of humor.',
    purpose:
      'You are Flint, an original river pebble companion. Grounded, practical and dryly funny, you help Ashrith find one useful next step. Be candid and kind. Keep spoken answers brief and natural. Never pretend to be human.',
  },
  {
    name: 'Pip',
    kind: 'sprout',
    voice: 'coral',
    hue: 145,
    tagline: 'Small ideas, room to grow.',
    purpose:
      'You are Pip, an original seedling companion. Playful, inventive and encouraging, you brainstorm with Ashrith and turn little ideas into experiments. Avoid empty praise. Keep spoken answers brief and natural. Never pretend to be human.',
  },
  {
    name: 'Orbit',
    kind: 'comet',
    voice: 'ballad',
    hue: 305,
    tagline: 'Follow a thought somewhere new.',
    purpose:
      'You are Orbit, an original small comet companion. Imaginative, inquisitive and a little philosophical, you explore stories and big questions with Ashrith. Separate facts from imagination. Keep spoken answers brief and natural. Never pretend to be human.',
  },
]
const PHASE_WORDS: Record<VoicePhase, string> = {
  idle: 'waiting',
  connecting: 'getting ready',
  listening: 'listening',
  transcribing: 'writing down what you said',
  thinking: 'thinking',
  speaking: 'speaking',
}

export function CompanionAvatar({
  companion: c,
  phase = 'idle',
  analyser,
  decorative = false,
}: {
  companion: Companion
  phase?: VoicePhase
  /** The reply's audio, so the mouth moves with it while speaking. */
  analyser?: AnalyserNode | null
  /** Hide it from screen readers when a status line already says the phase. */
  decorative?: boolean
}) {
  const mouth = useRef<SVGEllipseElement>(null)
  useEffect(() => {
    const calm = matchMedia('(prefers-reduced-motion: reduce)')
    if (!analyser || phase !== 'speaking') {
      mouth.current?.setAttribute('ry', '2')
      return
    }
    const samples = new Uint8Array(analyser.fftSize)
    let frame = 0
    const draw = () => {
      analyser.getByteTimeDomainData(samples)
      const rms = Math.sqrt(
        samples.reduce((sum, n) => sum + ((n - 128) / 128) ** 2, 0) /
          samples.length,
      )
      mouth.current?.setAttribute(
        'ry',
        String(calm.matches ? 2 : 2 + Math.min(14, rms * 65)),
      )
      frame = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(frame)
      mouth.current?.setAttribute('ry', '2')
    }
  }, [analyser, phase])
  return (
    <svg
      viewBox="0 0 240 220"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${c.name}, ${PHASE_WORDS[phase]}`}
      className={`companion-avatar is-${phase}`}
      style={{ '--companion-hue': c.hue } as CSSProperties}
    >
      <ellipse cx="120" cy="195" rx="55" ry="7" className="companion-shadow" />
      <g className="companion-body">
        {c.kind === 'moth' && (
          <g className="companion-wings">
            <path d="M112 94C45 20 10 99 85 145L112 135ZM128 94C195 20 230 99 155 145L128 135Z" />
            <path d="M109 139C54 119 49 184 109 166ZM131 139C186 119 191 184 131 166Z" />
          </g>
        )}
        {c.kind === 'sprout' && (
          <g className="companion-wings">
            <path d="M120 94C61 85 63 34 65 34C108 34 127 55 120 94ZM120 77C122 35 153 28 178 35C174 65 149 82 120 77Z" />
          </g>
        )}
        {c.kind === 'comet' && (
          <path
            d="M158 133L222 39L179 53L186 13L124 83Z"
            className="companion-wings"
          />
        )}
        <path
          d={
            c.kind === 'pebble'
              ? 'M58 143Q48 107 88 77Q127 51 165 98Q208 151 167 174Q96 203 65 171Z'
              : 'M79 139Q72 78 120 78Q168 78 161 139Q166 180 120 181Q74 180 79 139Z'
          }
          className="companion-face"
        />
        {c.kind === 'moth' && (
          <g className="companion-lines">
            <path d="M107 81L98 61M133 81L142 61" />
            <circle cx="97" cy="59" r="3" />
            <circle cx="143" cy="59" r="3" />
          </g>
        )}
        <g className="companion-eyes">
          <ellipse cx="102" cy="122" rx="4" ry="6" />
          <ellipse cx="138" cy="122" rx="4" ry="6" />
        </g>
        <ellipse
          ref={mouth}
          cx="120"
          cy="143"
          rx="7"
          ry="2"
          className="companion-mouth"
        />
        <path d="M89 139h8M143 139h8" className="companion-cheeks" />
      </g>
    </svg>
  )
}
