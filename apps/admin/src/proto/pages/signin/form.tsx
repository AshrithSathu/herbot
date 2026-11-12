// Throwaway (emil-prototype): the sign-in form both /proto-signin variants
// place. It calls the real `login` (wrong passwords wait 800 ms on the
// server), so pending, wrong, slowed-down and success are all real.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { login } from '../../../api'
import { keys } from '../../../queries'
import { Button, Field, TextInput } from '@/components/hb/controls'
import { InPlaceError } from '@/components/hb/feedback'

/** After this many wrong tries, explain the slowdown instead of just "wrong". */
const SLOW_AFTER = 3

export function SignInForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [missing, setMissing] = useState(false)
  const [visible, setVisible] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [wrongTries, setWrongTries] = useState(0)

  // Mouse and keyboard: focus the field. Phones: don't pop the keyboard
  // before they've seen the page.
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
        input.current?.select()
        return
      }
      queryClient.setQueryData(keys.session, { signedIn: true })
      await router.navigate({ to: '/' })
    },
  })
  const wrong = signIn.data && !signIn.data.ok
  const succeeded = signIn.data?.ok === true
  const problem = missing
    ? 'Enter your password.'
    : wrong
      ? wrongTries >= SLOW_AFTER
        ? `Wrong again (${wrongTries} tries). Each wrong try waits a moment to slow down guessing. Check Caps Lock and the keyboard layout.`
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
      <Field label="Password" id="password" error={problem} hint={capsLock ? 'Caps Lock is on.' : undefined}>
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
              className="h-11 pr-12 text-base!"
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
