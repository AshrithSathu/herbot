// Sign-in (docs/design/DECISIONS.md, "Sign-in"): the Card. A serif wordmark,
// one password field with show/hide, Caps Lock warned alongside any error,
// errors inline, the slowdown explained after three wrong tries, and where
// the password lives if it's forgotten.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { login } from '../api'
import { keys, sessionQuery } from '../queries'
import { Button, Field, TextInput } from '@/components/hb/controls'
import { InPlaceError } from '@/components/hb/feedback'

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
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-[max(1rem,env(safe-area-inset-left))] py-[max(2rem,env(safe-area-inset-top))] text-ink antialiased">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="font-serif text-[32px] leading-none font-semibold tracking-[-0.015em]">Herbot</h1>
        <p className="max-w-[30ch] text-[14px] text-mute text-balance">Sign in to the admin panel. Only you have the password.</p>
      </div>
      <div className="w-full max-w-[22rem] rounded-2xl bg-pane p-5 shadow-raised sm:p-6">
        <SignInForm />
      </div>
      <p className="max-w-[22rem] text-center text-[12.5px] text-faint">
        Forgot it? It’s <code className="font-mono text-mute">HERBOT_ADMIN_PASSWORD</code> in Herbot’s <code className="font-mono text-mute">.env</code>.
      </p>
    </main>
  )
}

function SignInForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  // Uncontrolled on purpose: whatever was typed or autofilled before the
  // page hydrated is kept, and read from the form on submit.
  const [missing, setMissing] = useState(false)
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [wrongTries, setWrongTries] = useState(0)

  // Mouse and keyboard: focus the field. Phones: don't pop the keyboard up
  // before the page has been seen.
  useEffect(() => {
    if (matchMedia('(pointer: fine)').matches) input.current?.focus()
  }, [])

  const submitting = useRef(false) // synchronous: a double submit sends one request
  const signIn = useMutation({
    mutationFn: (password: string) => login({ data: { password } }),
    onSettled: () => {
      submitting.current = false
    },
    onSuccess: async (result) => {
      if (!result.ok) {
        setWrongTries((n) => n + 1)
        return
      }
      queryClient.setQueryData(keys.session, { signedIn: true })
      await router.navigate({ to: '/' })
    },
  })
  const wrong = signIn.data && !signIn.data.ok
  const succeeded = signIn.data?.ok === true
  // After a wrong password, select it once the field is enabled again (it's
  // disabled while checking, and a disabled input can't take focus), so you
  // can retype straight away. Keyed on the try count, so each wrong try does it.
  useEffect(() => {
    if (wrongTries > 0 && !signIn.isPending) {
      input.current?.focus()
      input.current?.select()
    }
  }, [wrongTries, signIn.isPending])
  const problem = missing
    ? 'Enter your password.'
    : wrong
      ? wrongTries >= SLOW_AFTER
        ? `Wrong again (${wrongTries} tries). Each wrong try waits a moment to slow down guessing.`
        : 'That password isn’t right. Try again.'
      : undefined
  const caps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState?.('CapsLock') ?? false)

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
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
      {/* Password managers save a login as username + password. */}
      <input type="text" name="username" autoComplete="username" value="herbot-admin" readOnly hidden />
      <Field label="Password" id="password" error={problem} warning={capsLock ? 'Caps Lock is on.' : undefined}>
        {(props) => (
          <div className="relative">
            <TextInput
              {...props}
              ref={input}
              name="password"
              type={visible ? 'text' : 'password'}
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              disabled={signIn.isPending || succeeded}
              onKeyDown={caps}
              onKeyUp={caps}
              onBlur={() => setCapsLock(false)}
              onChange={() => {
                setMissing(false)
                if (wrong) signIn.reset()
              }}
              className="h-11 pr-12"
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
              className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-mute transition-[color] duration-150 ease-out before:absolute before:-inset-1 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {visible ? <EyeOffIcon className="size-4" aria-hidden /> : <EyeIcon className="size-4" aria-hidden />}
            </button>
          </div>
        )}
      </Field>

      {signIn.isError && (
        <InPlaceError
          className="min-h-0 py-0"
          title="Couldn’t reach the panel’s server"
          error={`${signIn.error.message}. Check that the panel is running, then try again.`}
        />
      )}

      <Button type="submit" variant="primary" className="h-11 w-full" pending={signIn.isPending || succeeded}>
        {succeeded ? 'Opening…' : signIn.isPending ? 'Checking…' : 'Sign in'}
      </Button>
    </form>
  )
}
