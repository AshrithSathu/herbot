import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { login } from '../api'
import { keys, sessionQuery } from '../queries'
import { ErrorNote } from '../ui'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/login')({
  beforeLoad: async ({ context }) => {
    const { signedIn } = await context.queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 })
    if (signedIn) throw redirect({ to: '/' })
  },
  head: () => ({ meta: [{ title: 'Sign in · Herbot admin' }] }),
  component: Login,
})

/** After this many wrong tries, explain the slowdown instead of just "wrong". */
const SLOW_AFTER = 3

function Login() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  // Uncontrolled on purpose: whatever was typed (or autofilled) before the
  // page finished hydrating is kept, and read from the form on submit.
  const [missing, setMissing] = useState(false)
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [wrongTries, setWrongTries] = useState(0)

  // Focus the field for mouse and keyboard users; on a phone, don't pop the
  // keyboard up before they've seen the page.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) input.current?.focus()
  }, [])

  const submitting = useRef(false) // synchronous: a double submit sends one request
  const signIn = useMutation({
    mutationFn: (pw: string) => login({ data: { password: pw } }),
    onSettled: () => {
      submitting.current = false
    },
    onSuccess: async (result) => {
      if (!result.ok) {
        setWrongTries((n) => n + 1)
        input.current?.select()
        return
      }
      queryClient.setQueryData(keys.session, { signedIn: true })
      await router.navigate({ to: '/' })
    },
  })
  const wrong = signIn.data && !signIn.data.ok
  const problem = missing
    ? 'Enter your password.'
    : wrong
      ? wrongTries >= SLOW_AFTER
        ? `Wrong password again (${wrongTries} tries). Each wrong try waits a moment to slow down guessing; check Caps Lock and your keyboard layout.`
        : 'That password isn’t right. Try again.'
      : null
  const succeeded = signIn.data?.ok === true

  const caps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-[max(1rem,env(safe-area-inset-left))] py-[max(2rem,env(safe-area-inset-top))]">
      <div className="flex w-full max-w-[22rem] flex-col gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <img src="/favicon.svg" alt="" width={44} height={44} className="size-11 rounded-xl" />
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">Sign in to Herbot</h1>
            <p className="text-sm text-muted-foreground">The admin panel for your agents. Only you have the password.</p>
          </div>
        </div>

        <form
          className="flex flex-col gap-5 rounded-xl border bg-card p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_4px_16px_-4px_rgb(0_0_0/0.06)]"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (submitting.current) return
            const password = String(new FormData(e.currentTarget).get('password') ?? '')
            if (!password) {
              setMissing(true)
              input.current?.focus()
              return
            }
            submitting.current = true
            signIn.mutate(password)
          }}
        >
          {/* Password managers save logins as username + password; give them a fixed username. */}
          <input type="text" name="username" autoComplete="username" value="herbot-admin" readOnly hidden />

          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <div className="relative">
              <input
                ref={input}
                id="password"
                name="password"
                type={visible ? 'text' : 'password'}
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                disabled={signIn.isPending || succeeded}
                aria-invalid={problem ? true : undefined}
                aria-describedby={[problem && 'password-error', capsLock && 'caps-lock'].filter(Boolean).join(' ') || undefined}
                onKeyDown={caps}
                onKeyUp={caps}
                onBlur={() => setCapsLock(false)}
                onChange={() => {
                  setMissing(false)
                  if (wrong) signIn.reset()
                }}
                className={cn(
                  'h-11 w-full min-w-0 rounded-md border border-input bg-transparent pr-12 pl-3 text-base shadow-xs outline-none',
                  'transition-[border-color,box-shadow] duration-150 ease-out',
                  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  'disabled:cursor-not-allowed disabled:opacity-60 dark:bg-input/30',
                  'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
                )}
              />
              <button
                type="button"
                onClick={() => {
                  setVisible((v) => !v)
                  input.current?.focus()
                }}
                aria-label={visible ? 'Hide password' : 'Show password'}
                aria-pressed={visible}
                aria-controls="password"
                className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-out before:absolute before:-inset-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {visible ? <EyeOffIcon className="size-4" aria-hidden /> : <EyeIcon className="size-4" aria-hidden />}
              </button>
            </div>
            {capsLock && !problem && (
              <p id="caps-lock" className="text-sm text-warning">
                Caps Lock is on.
              </p>
            )}
            {problem && (
              <p id="password-error" role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            )}
          </div>

          {signIn.isError && (
            <ErrorNote title="Couldn’t reach the panel’s server">
              {signIn.error.message} Check that the panel is running, then try again.
            </ErrorNote>
          )}

          <Button type="submit" className="h-11 w-full" disabled={signIn.isPending || succeeded}>
            {(signIn.isPending || succeeded) && <Spinner />}
            {succeeded ? 'Opening…' : signIn.isPending ? 'Checking…' : 'Sign in'}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Forgot it? It’s <code className="font-mono">HERBOT_ADMIN_PASSWORD</code> in Herbot’s <code className="font-mono">.env</code>.
        </p>
      </div>
    </main>
  )
}
