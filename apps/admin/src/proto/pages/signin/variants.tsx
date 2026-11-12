// Throwaway (emil-prototype): the two /proto-signin layouts around the same
// form. "Card": centred, nothing else on the page. "Split": the product's
// identity on one side, the form on the other.
import { SignInForm } from './form'

function Forgot() {
  return (
    <p className="text-[12.5px] text-faint">
      Forgot it? It’s <code className="font-mono text-[12px]">HERBOT_ADMIN_PASSWORD</code> in Herbot’s <code className="font-mono text-[12px]">.env</code>.
    </p>
  )
}

/** Axis: a centred card, the page reduced to the one thing it's for. */
export function Card() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-[max(1rem,env(safe-area-inset-left))] py-[max(2rem,env(safe-area-inset-top))] text-ink antialiased">
      <div className="flex w-full max-w-[22rem] flex-col gap-7">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="font-serif text-[30px] leading-none font-semibold tracking-[-0.015em]">Herbot</p>
          <h1 className="text-[15px] text-mute">Sign in to the admin panel. Only you have the password.</h1>
        </div>
        <div className="rounded-2xl bg-pane p-6 shadow-raised">
          <SignInForm />
        </div>
        <div className="text-center">
          <Forgot />
        </div>
      </div>
    </main>
  )
}

const INSIDE = [
  ['Talk to any agent', 'Every Telegram topic is an agent; the conversation is here too.'],
  ['See what each is doing', 'Working, waiting for a purpose, switched off, failed.'],
  ['Shape what they share', 'Memory, custom instructions, voice and tools.'],
] as const

/** Axis: a split screen, the product's identity beside the form. */
export function Split() {
  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] bg-canvas text-ink antialiased md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:grid-rows-1">
      <section aria-label="Herbot" className="flex flex-col gap-2 px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-5 md:justify-between md:gap-8 md:px-12 md:py-14">
        <p className="font-serif text-[22px] leading-none font-semibold">Herbot</p>
        <p className="text-[14px] text-mute md:hidden">Your agents, one place.</p>
        <div className="flex max-w-[30rem] flex-col gap-6 max-md:hidden">
          <p className="font-serif text-[40px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance">Your agents, one place.</p>
          <ul className="flex flex-col">
            {INSIDE.map(([title, line]) => (
              <li key={title} className="flex flex-col gap-0.5 border-t border-line py-3">
                <span className="text-[14.5px] font-medium">{title}</span>
                <span className="text-[13.5px] text-mute">{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12.5px] text-faint max-md:hidden">A private panel for one person.</p>
      </section>
      <section aria-labelledby="signin-h" className="flex items-start justify-center bg-pane px-6 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] md:items-center md:rounded-l-3xl md:shadow-raised">
        <div className="flex w-full max-w-[22rem] flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 id="signin-h" className="text-[20px] font-semibold tracking-tight">
              Sign in
            </h1>
            <p className="text-[14px] text-mute">Only you have the password.</p>
          </div>
          <SignInForm />
          <Forgot />
        </div>
      </section>
    </main>
  )
}
